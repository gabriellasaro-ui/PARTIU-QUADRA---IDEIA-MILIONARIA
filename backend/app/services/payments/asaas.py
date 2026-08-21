"""Provedor de pagamento Asaas — Pix e cartao de verdade.

Substitui o MockProvider, que gerava um "copia-e-cola" que nao era pagavel e
se confirmava sozinho.

Por que Asaas
-------------
O modelo de repasse deste projeto (models/settlement.py) e periodico: a Qadras
recebe o valor cheio e acerta com a arena depois, por periodo, com comissao e
comprovante. Isso dispensa split no adquirente — basta UMA conta recebedora, o
que torna a integracao muito mais simples e e exatamente o que o codigo ja
antecipava ("'asaas' entra no futuro sem reescrever o dominio").

Contrato da API (docs.asaas.com, consultado em 08/2026)
-------------------------------------------------------
  POST /v3/customers                 cria/acha o pagador
  POST /v3/payments                  cria a cobranca
  GET  /v3/payments/{id}/pixQrCode   devolve encodedImage + payload
  POST /v3/payments/{id}/refund      estorno

  Autenticacao: header `access_token` com a API key.
  Webhook: header `asaas-access-token` com o token configurado no painel.

Cuidado com a fila de webhook
-----------------------------
O Asaas interrompe a fila depois de 15 respostas nao-2xx seguidas, e guarda os
eventos por apenas 14 dias. Por isso `parse_webhook` devolve None (e a rota
responde 200 com ignored=true) para evento que nao interessa, em vez de erro:
recusar com 4xx um `PAYMENT_CREATED` qualquer derrubaria a fila inteira e os
pagamentos seguintes nunca chegariam.
"""
import hmac
import logging
from datetime import timedelta

import requests

from ...core.config import settings
from ...core.timezone import now_local
from .base import PaymentIntent, PaymentProvider, WebhookResult

logger = logging.getLogger(__name__)

#: Header que o Asaas usa no callback (nao e o mesmo da API).
WEBHOOK_TOKEN_HEADER = "asaas-access-token"

BASE_SANDBOX = "https://api-sandbox.asaas.com"
BASE_PRODUCAO = "https://api.asaas.com"

#: Timeout curto de proposito: isto roda dentro do request do jogador, que
#: esta olhando para a tela. Melhor falhar rapido e deixar tentar de novo do
#: que segurar a conexao por um minuto.
TIMEOUT_S = 12

#: billingType do Asaas para o `method` do dominio.
_COBRANCA = {"pix": "PIX", "card": "CREDIT_CARD"}

#: Eventos que significam dinheiro recebido. CONFIRMED e RECEIVED sao ambos
#: sucesso: no Pix chegam juntos, no cartao CONFIRMED vem primeiro (capturado)
#: e RECEIVED depois (liquidado). Tratar so um dos dois deixaria metade dos
#: pagamentos pendurados.
_EVENTOS_PAGOS = {"PAYMENT_CONFIRMED", "PAYMENT_RECEIVED"}

#: Eventos que encerram a cobranca sem dinheiro.
_EVENTOS_FALHA = {
    "PAYMENT_OVERDUE",
    "PAYMENT_DELETED",
    "PAYMENT_REPROVED_BY_RISK_ANALYSIS",
    "PAYMENT_CREDIT_CARD_CAPTURE_REFUSED",
    "PAYMENT_CHARGEBACK_REQUESTED",
}

_EVENTOS_ESTORNO = {"PAYMENT_REFUNDED"}


class AsaasError(RuntimeError):
    """Falha de comunicacao ou recusa da API do Asaas."""


class AsaasProvider(PaymentProvider):
    name = "asaas"

    def __init__(self) -> None:
        chave = (settings.asaas_api_key or "").strip()
        if not chave:
            # Sem chave nao ha o que tentar. Falhar aqui, na criacao do
            # provider, e melhor do que descobrir no meio de uma reserva.
            raise AsaasError(
                "ASAAS_API_KEY vazia. Defina no .env antes de usar "
                "PAYMENT_PROVIDER=asaas."
            )
        self._chave = chave
        self._base = (
            BASE_SANDBOX
            if (settings.asaas_ambiente or "").strip().lower() != "producao"
            else BASE_PRODUCAO
        )

    # ------------------------------------------------------------------ HTTP

    def _chamar(self, metodo: str, caminho: str, corpo: dict | None = None) -> dict:
        url = f"{self._base}{caminho}"
        try:
            resposta = requests.request(
                metodo,
                url,
                json=corpo,
                headers={
                    "access_token": self._chave,
                    "Content-Type": "application/json",
                    # O Asaas pede identificacao do integrador nos headers.
                    "User-Agent": f"Qadras/{settings.app_version}",
                },
                timeout=TIMEOUT_S,
            )
        except requests.RequestException as erro:
            raise AsaasError(f"Asaas indisponivel: {erro}") from erro

        if resposta.status_code >= 400:
            # A chave NUNCA entra no log: ela da acesso total a conta.
            logger.warning(
                "Asaas %s %s -> %s: %s",
                metodo, caminho, resposta.status_code, resposta.text[:300],
            )
            raise AsaasError(
                f"Asaas recusou {metodo} {caminho} ({resposta.status_code})"
            )
        return resposta.json() if resposta.content else {}

    # -------------------------------------------------------------- pagador

    def _cliente_do_usuario(self, booking) -> str:
        """Id do pagador no Asaas, criando na primeira vez.

        O vinculo mora no `externalReference` do proprio Asaas, e nao numa
        coluna nova: assim a integracao entra sem migracao de banco. O custo e
        uma consulta a mais por cobranca, o que e barato perto de uma mudanca
        de schema em producao.
        """
        externo = str(booking.user_id or booking.id)

        achados = self._chamar("GET", f"/v3/customers?externalReference={externo}")
        for item in achados.get("data") or []:
            if item.get("id"):
                return item["id"]

        # `name` e obrigatorio; `cpfCnpj` nao e para Pix, e nao pedimos CPF no
        # cadastro (o campo saiu do perfil a pedido).
        criado = self._chamar(
            "POST",
            "/v3/customers",
            {
                "name": booking.client_name or "Jogador Qadras",
                "email": booking.client_email or None,
                "mobilePhone": booking.client_phone or None,
                "externalReference": externo,
                "notificationDisabled": True,
            },
        )
        if not criado.get("id"):
            raise AsaasError("Asaas nao devolveu id do cliente")
        return criado["id"]

    # ------------------------------------------------------------- cobranca

    def create_payment(self, *, booking, amounts: dict) -> PaymentIntent:
        metodo = (booking.payment_method or "pix").lower()
        total_cents = int(amounts["total_cents"])
        vence_em = now_local() + timedelta(
            minutes=settings.booking_payment_expire_minutes
        )

        cobranca = self._chamar(
            "POST",
            "/v3/payments",
            {
                "customer": self._cliente_do_usuario(booking),
                "billingType": _COBRANCA.get(metodo, "PIX"),
                # O Asaas trabalha em reais decimais; o dominio guarda centavos.
                "value": round(total_cents / 100, 2),
                "dueDate": vence_em.date().isoformat(),
                # Amarra a cobranca a reserva: se um webhook chegar sem o
                # provider_ref reconhecido, ainda da para rastrear pelo codigo.
                "externalReference": booking.code,
                "description": f"Reserva {booking.code} - Qadras",
            },
        )
        ref = cobranca.get("id")
        if not ref:
            raise AsaasError("Asaas nao devolveu id da cobranca")

        copia_e_cola = None
        imagem = None
        if _COBRANCA.get(metodo, "PIX") == "PIX":
            # QR em chamada separada, como a API define. Se falhar, a cobranca
            # JA existe — derrubar tudo aqui deixaria uma cobranca orfa no
            # Asaas e a reserva sem pagamento. O jogador consegue pagar pelo
            # link da fatura, entao seguimos sem o QR.
            try:
                qr = self._chamar("GET", f"/v3/payments/{ref}/pixQrCode")
                copia_e_cola = qr.get("payload")
                imagem = qr.get("encodedImage")
                if imagem:
                    imagem = f"data:image/png;base64,{imagem}"
            except AsaasError:
                logger.warning("QR Pix nao veio para a cobranca %s", ref)

        return PaymentIntent(
            provider=self.name,
            method=metodo,
            provider_ref=ref,
            amount_cents=total_cents,
            qr_code=copia_e_cola,
            qr_code_image=imagem,
            expires_at=vence_em,
            payload={
                "invoiceUrl": cobranca.get("invoiceUrl"),
                "status": cobranca.get("status"),
            },
        )

    # -------------------------------------------------------------- webhook

    def parse_webhook(self, headers, body: bytes) -> WebhookResult | None:
        if not body:
            return None
        if not self._token_confere(headers):
            # Assinatura invalida nao e "evento desconhecido": e alguem se
            # passando pelo Asaas. None faz a rota responder ignored, sem
            # mover dinheiro.
            logger.warning("Webhook Asaas com token invalido")
            return None

        import json

        try:
            dados = json.loads(body)
        except ValueError:
            return None

        evento = dados.get("event")
        cobranca = dados.get("payment") or {}
        ref = cobranca.get("id")
        if not evento or not ref:
            return None

        if evento in _EVENTOS_PAGOS:
            status = "confirmed"
        elif evento in _EVENTOS_FALHA:
            status = "failed"
        elif evento in _EVENTOS_ESTORNO:
            status = "refunded"
        else:
            # PAYMENT_CREATED, PAYMENT_UPDATED, eventos de split... nao
            # mudam o estado da reserva. Devolver None faz a rota responder
            # 200/ignored, que e o que mantem a fila do Asaas viva.
            return None

        valor = cobranca.get("value")
        return WebhookResult(
            # `id` do evento, e nao da cobranca: e o que torna o callback
            # idempotente quando o Asaas reenvia o mesmo evento.
            webhook_id=str(dados.get("id") or f"asaas-{evento}-{ref}"),
            status=status,
            provider_ref=str(ref),
            amount_cents=int(round(float(valor) * 100)) if valor is not None else None,
            payload=dados,
        )

    def _token_confere(self, headers) -> bool:
        esperado = (settings.payment_webhook_secret or "").strip()
        if not esperado:
            # Producao nao passa daqui: Settings recusa o boot sem segredo
            # quando o provedor e real.
            return True
        enviado = ""
        for chave, valor in dict(headers or {}).items():
            if str(chave).lower() == WEBHOOK_TOKEN_HEADER:
                enviado = str(valor)
                break
        # compare_digest, e nao ==: comparacao comum vaza o tamanho do prefixo
        # correto pelo tempo de resposta.
        return hmac.compare_digest(enviado, esperado)

    # -------------------------------------------------------------- estorno

    def refund(self, payment) -> bool:
        if not payment or not payment.provider_ref:
            return False
        try:
            self._chamar("POST", f"/v3/payments/{payment.provider_ref}/refund")
            return True
        except AsaasError:
            logger.warning("Estorno recusado para %s", payment.provider_ref)
            return False
