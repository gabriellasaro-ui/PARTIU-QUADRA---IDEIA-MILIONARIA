"""Quanto a Qadras retem em cada cobranca (split de pagamentos 1:1).

Regra de negocio, decidida em 21-22/09/2026 (ver IMPLEMENTAR_MERCADO PAGO.md):

  - O jogador paga `subtotal + 9% do total`.
  - A arena cede 3% do subtotal.
  - A Qadras retem as DUAS pontas: 12,89% do subtotal.
  - A Qadras BANCA a taxa do Mercado Pago ate um teto (0,99% do valor pago);
    o que exceder o teto fica com a arena.

Com subtotal de R$ 100,00 e Pix a 0,99%:

    jogador paga      109,89
    MP retem            1,09   (abaixo do teto -> a Qadras banca tudo)
    application_fee    11,80   = 12,89 - 1,09
    arena recebe       97,00   = 109,89 - 1,09 - 11,80
    Qadras liquido     11,80

No cartao a 4,98% a taxa estoura o teto: a Qadras banca 1,09, a arena banca o
resto, e a margem da Qadras fica travada em 11,80. Foi essa a escolha — a
margem nao desaba quando o meio de pagamento e caro.

POR QUE `ceil` NA TAXA
----------------------
Subestimar a taxa em um centavo faz a arena receber 96,99 em vez dos 97,00
prometidos, que e exatamente o que esta regra existe para evitar. O centavo de
sobra e custo da Qadras, e e barato perto de explicar a diferenca ao dono.
"""
import math

from ...core.config import settings


def calcular(
    subtotal_cents: int, total_cents: int, fee_rate: float | None = None
) -> dict:
    """Decompoe a cobranca. Valores em CENTAVOS (o dominio inteiro usa centavos).

    `fee_rate` e a taxa do Mercado Pago NAQUELA conta de arena — em split 1:1
    a tarifa aplicada e a do vendedor, nao a da Qadras, e ela e negociavel.
    None cai no presumido do config ate o `fee_details` da primeira cobranca
    real dizer o valor verdadeiro.
    """
    subtotal_cents = max(0, int(subtotal_cents or 0))
    total_cents = max(0, int(total_cents or 0))
    taxa = settings.mercadopago_default_fee_rate if fee_rate is None else fee_rate

    # A MESMA expressao de admin.py:107 e seed.py:714. Reutilizada de proposito:
    # se o split usar uma conta propria, o extrato do MP e o relatorio de
    # receita divergem — e a divergencia so aparece na conciliacao do mes.
    comissao_bruta = round(
        subtotal_cents * (settings.player_fee_rate + settings.arena_fee_rate)
    )
    taxa_mp = math.ceil(total_cents * max(0.0, taxa))
    teto = math.ceil(total_cents * max(0.0, settings.mercadopago_fee_absorbed_cap))
    absorvido = min(taxa_mp, teto)

    # max(0, ...): protege contra configuracao absurda (teto maior que a
    # comissao). O MP recusaria application_fee negativo com um erro opaco.
    application_fee = max(0, comissao_bruta - absorvido)

    return {
        "comissao_bruta_cents": comissao_bruta,
        "taxa_mp_estimada_cents": taxa_mp,
        "absorvido_pela_qadras_cents": absorvido,
        "application_fee_cents": application_fee,
        # O que a arena recebe SE a taxa estimada acertar. O valor real so se
        # sabe pelo `fee_details` da resposta do pagamento.
        "repasse_estimado_cents": total_cents - taxa_mp - application_fee,
    }


def em_reais(application_fee_cents: int) -> float:
    """O MP espera `application_fee` em reais decimais, nao em centavos."""
    return round(int(application_fee_cents) / 100, 2)
