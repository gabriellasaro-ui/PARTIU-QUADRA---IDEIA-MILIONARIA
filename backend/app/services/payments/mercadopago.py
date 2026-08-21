"""Provedor de pagamento Mercado Pago — Pix de verdade.

Substitui o MockProvider, que gerava um "copia-e-cola" que nao era pagavel e
se confirmava sozinho.

Contrato da API (mercadopago.com.br/developers, consultado em 08/2026)
----------------------------------------------------------------------
  POST /v1/payments                cria a cobranca
  GET  /v1/payments/{id}           consulta o status
  POST /v1/payments/{id}/refunds   estorno

  Autenticacao: `Authorization: Bearer {access_token}`.
  Duplicidade: header `X-Idempotency-Key` na criacao.

O QR do Pix vem na PROPRIA resposta da criacao, em
`point_of_interaction.transaction_data` — nao ha segunda chamada.

O webhook nao diz o que aconteceu
---------------------------------
Esta e a diferenca que mais pega quem vem de outro adquirente: a notificacao
do Mercado Pago traz apenas `{"type": "payment", "data": {"id": ...}}`. Ela
avisa que ALGO mudou naquele pagamento, e nao o que mudou. O status precisa
ser buscado com GET /v1/payments/{id}.

Confiar num campo de status vindo do corpo da notificacao seria confiar em
quem POSTou — e o corpo e publico. A consulta e o que torna a confirmacao
verificavel.

Assinatura do webhook
---------------------
Header `x-signature: ts=<epoch>,v1=<hmac>`. O manifesto assinado e

    id:{data.id};request-id:{x-request-id};ts:{ts};

com HMAC-SHA256 e o segredo gerado no painel (Webhooks > Configurar
notificacao). O `data.id` vai em MINUSCULAS: o Mercado Pago as vezes entrega
o id em maiusculas na notificacao, e sem normalizar o hash nunca bate — e o
sintoma e "assinatura invalida em producao, valida em teste".
"""
import hashlib
import hmac
import json
import logging
from datetime import timedelta

import requests

from ...core.config import settings
from ...core.timezone import now_local
from .base import PaymentIntent, PaymentProvider, WebhookResult

logger = logging.getLogger(__name__)

BASE_URL = "https://api.mercadopago.com"

#: Timeout curto: isto roda dentro do request do jogador, que esta olhando
#: para a tela. Melhor falhar rapido do que segurar a conexao.
TIMEOUT_S = 12

#: status do Mercado Pago -> estado do nosso dominio.
_PAGOS = {"approved"}
_FALHAS = {"rejected", "cancelled"}
_ESTORNOS = {"refunded", "charged_back"}
#: "pending", "in_process" e "authorized" nao mudam a reserva: ela ja esta
#: aguardando pagamento. Notificar isso de novo nao acrescenta nada.


class MercadoPagoError(RuntimeError):
    """Falha de comunicacao ou recusa da API do Mercado Pago."""


class MercadoPagoProvider(PaymentProvider):
    name = "mercadopago"

    def __init__(self) -> None:
        token = (settings.mercadopago_access_token or "").strip()
        if not token:
            # Falhar na criacao do provider e melhor do que descobrir no meio
            # de uma reserva, com o jogador olhando para a tela.
            raise MercadoPagoError(
                "MERCADOPAGO_ACCESS_TOKEN vazio. Defina no .env antes de usar "
                "PAYMENT_PROVIDER=mercadopago."
            )
        self._token = token

    # ------------------------------------------------------------------ HTTP

    def _chamar(
        self, metodo: str, caminho: str, corpo: dict | None = None,
        *, idempotencia: str | None = None,
    ) -> dict:
        cabecalhos = {
            "Authorization": f"Bearer {self._token}",
            "Content-Type": "application/json",
        }
        if idempotencia:
            cabecalhos["X-Idempotency-Key"] = idempotencia
        try:
            resposta = requests.request(
                metodo, f"{BASE_URL}{caminho}", json=corpo,
                headers=cabecalhos, timeout=TIMEOUT_S,
            )
        except requests.RequestException as erro:
            raise MercadoPagoError(f"Mercado Pago indisponivel: {erro}") from erro

        if resposta.status_code >= 400:
            # O token NUNCA entra no log: da acesso a conta inteira.
            logger.warning(
                "MercadoPago %s %s -> %s: %s",
                metodo, caminho, resposta.status_code, resposta.text[:300],
            )
            raise MercadoPagoError(
                f"Mercado Pago recusou {metodo} {caminho} ({resposta.status_code})"
            )
        return resposta.json() if resposta.content else {}

    # ------------------------------------------------------------- cobranca

    def create_payment(self, *, booking, amounts: dict) -> PaymentIntent:
        metodo = (booking.payment_method or "pix").lower()
        if metodo != "pix":
            # Cartao exige tokenizacao no NAVEGADOR (MercadoPago.js): o numero
            # nunca pode chegar ao nosso servidor. Enquanto o front nao gerar
            # esse token, aceitar "card" aqui criaria uma cobranca sem forma de
            # pagamento. A tela ja mostra cartao como "Em breve".
            raise MercadoPagoError(
                "Cartao ainda nao esta disponivel: falta a tokenizacao no "
                "front (MercadoPago.js). Use Pix."
            )

        total_cents = int(amounts["total_cents"])
        expira_em = now_local() + timedelta(
            minutes=settings.booking_payment_expire_minutes
        )

        corpo = {
            # A API trabalha em reais decimais; o dominio guarda centavos.
            "transaction_amount": round(total_cents / 100, 2),
            "description": f"Reserva {booking.code} - Qadras",
            "payment_method_id": "pix",
            "payer": {
                "email": booking.client_email or "jogador@qadras.com.br",
                "first_name": (booking.client_name or "Jogador").split(" ")[0],
            },
            # Precisa de offset de fuso; now_local() ja e consciente.
            "date_of_expiration": expira_em.isoformat(),
            # Amarra a cobranca a reserva: se um webhook chegar com id que nao
            # reconhecemos, ainda da para rastrear pelo codigo.
            "external_reference": booking.code,
        }
        if settings.mercadopago_notification_url.strip():
            corpo["notification_url"] = settings.mercadopago_notification_url.strip()

        # Idempotencia pela reserva: se a rede cair depois do POST e o jogador
        # tentar de novo, o Mercado Pago devolve a MESMA cobranca em vez de
        # criar uma segunda para o mesmo horario.
        cobranca = self._chamar(
            "POST", "/v1/payments", corpo, idempotencia=f"qadras-{booking.code}"
        )

        ref = cobranca.get("id")
        if not ref:
            raise MercadoPagoError("Mercado Pago nao devolveu id da cobranca")

        dados_pix = (cobranca.get("point_of_interaction") or {}).get(
            "transaction_data"
        ) or {}
        imagem = dados_pix.get("qr_code_base64")

        return PaymentIntent(
            provider=self.name,
            method="pix",
            provider_ref=str(ref),
            amount_cents=total_cents,
            qr_code=dados_pix.get("qr_code"),
            qr_code_image=f"data:image/png;base64,{imagem}" if imagem else None,
            expires_at=expira_em,
            payload={
                "ticketUrl": dados_pix.get("ticket_url"),
                "status": cobranca.get("status"),
            },
        )

    # -------------------------------------------------------------- webhook

    def parse_webhook(self, headers, body: bytes, query=None) -> WebhookResult | None:
        if not body:
            return None
        try:
            notificacao = json.loads(body)
        except ValueError:
            return None

        # So notificacao de pagamento interessa. Merchant order, chargeback e
        # afins chegam no mesmo endereco.
        if notificacao.get("type") not in (None, "payment"):
            return None

        dados = notificacao.get("data") or {}
        # O manifesto usa o data.id da QUERY; o corpo traz o mesmo valor e
        # serve de reserva quando a query nao chega.
        id_pagamento = str((query or {}).get("data.id") or dados.get("id") or "")
        if not id_pagamento:
            return None

        if not self._assinatura_confere(headers, id_pagamento):
            # Assinatura invalida nao e "evento desconhecido": e alguem se
            # passando pelo Mercado Pago. Devolver None faz a rota responder
            # 200/ignored, sem mover dinheiro nenhum.
            logger.warning("Webhook Mercado Pago com assinatura invalida")
            return None

        # A notificacao NAO diz o que aconteceu — so que algo mudou. O status
        # vem da API, que e a unica fonte que o remetente do POST nao controla.
        try:
            pagamento = self._chamar("GET", f"/v1/payments/{id_pagamento}")
        except MercadoPagoError:
            # Deixa o Mercado Pago reenviar: devolver None responde 200 e
            # encerraria a tentativa. Aqui queremos a repeticao.
            raise

        situacao = str(pagamento.get("status") or "").lower()
        if situacao in _PAGOS:
            estado = "confirmed"
        elif situacao in _FALHAS:
            estado = "failed"
        elif situacao in _ESTORNOS:
            estado = "refunded"
        else:
            # pending / in_process / authorized: a reserva ja esta aguardando
            # pagamento, entao nao ha o que mudar.
            return None

        valor = pagamento.get("transaction_amount")
        return WebhookResult(
            # Chave de idempotencia: id do pagamento + situacao. O Mercado Pago
            # reenvia a MESMA notificacao ate receber 2xx, e manda notificacoes
            # novas a cada mudanca. Chavear so pelo id do pagamento descartaria
            # a aprovacao como se fosse repeticao do "pendente".
            webhook_id=f"mp-{id_pagamento}-{situacao}",
            status=estado,
            provider_ref=str(id_pagamento),
            amount_cents=int(round(float(valor) * 100)) if valor is not None else None,
            payload={"status": situacao, "externalReference": pagamento.get("external_reference")},
        )

    def _assinatura_confere(self, headers, id_pagamento: str) -> bool:
        segredo = (settings.payment_webhook_secret or "").strip()
        if not segredo:
            # Producao nao passa daqui: Settings recusa o boot sem segredo.
            return True

        cabecalhos = {str(k).lower(): str(v) for k, v in dict(headers or {}).items()}
        assinatura = cabecalhos.get("x-signature", "")
        if not assinatura:
            return False

        # "ts=1704908010,v1=618c8534..."
        partes = {}
        for pedaco in assinatura.split(","):
            if "=" in pedaco:
                chave, _, valor = pedaco.partition("=")
                partes[chave.strip()] = valor.strip()
        ts = partes.get("ts")
        recebido = partes.get("v1")
        if not ts or not recebido:
            return False

        # MINUSCULAS no id: o Mercado Pago as vezes entrega o id em maiusculas
        # na notificacao e assina a versao minuscula. Sem normalizar, o hash
        # nunca bate — e falha so em producao, onde os ids tem letras.
        manifesto = f"id:{id_pagamento.lower()};"
        pedido = cabecalhos.get("x-request-id")
        if pedido:
            manifesto += f"request-id:{pedido};"
        manifesto += f"ts:{ts};"

        esperado = hmac.new(
            segredo.encode(), manifesto.encode(), hashlib.sha256
        ).hexdigest()
        # compare_digest, e nao ==: comparacao comum vaza o tamanho do prefixo
        # correto pelo tempo de resposta.
        return hmac.compare_digest(esperado, recebido)

    # -------------------------------------------------------------- estorno

    def refund(self, payment) -> bool:
        if not payment or not payment.provider_ref:
            return False
        try:
            self._chamar(
                "POST",
                f"/v1/payments/{payment.provider_ref}/refunds",
                {},
                idempotencia=f"qadras-estorno-{payment.provider_ref}",
            )
            return True
        except MercadoPagoError:
            logger.warning("Estorno recusado para %s", payment.provider_ref)
            return False
