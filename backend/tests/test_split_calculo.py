"""A conta do split — onde um centavo errado vira discussao com a arena.

O contrato com o dono da quadra e "3% + o que a taxa do meio de pagamento
passar de 0,99%". Estes testes sao o que garante que o numero no extrato do
Mercado Pago bate com o numero que o painel do gerente promete.
"""
import pytest

from app.core.config import settings
from app.services.payments import split

#: Reserva de R$ 100,00: jogador paga R$ 109,89 (subtotal + 9% do total).
SUBTOTAL = 10_000
TOTAL = 10_989


def test_o_exemplo_canonico_pix():
    """Pix a 0,99%: a taxa cabe no teto, entao a arena recebe os 97% cheios."""
    c = split.calcular(SUBTOTAL, TOTAL, fee_rate=0.0099)
    assert c["comissao_bruta_cents"] == 1_289          # 12,89% do subtotal
    assert c["taxa_mp_estimada_cents"] == 109          # R$ 1,09
    assert c["absorvido_pela_qadras_cents"] == 109     # tudo, abaixo do teto
    assert c["application_fee_cents"] == 1_180         # R$ 11,80
    assert c["repasse_estimado_cents"] == 9_700        # R$ 97,00 exatos


def test_pix_barato_sobra_para_a_qadras():
    """Teto e limite, nao cota: taxa menor nao obriga a gastar os 0,99%."""
    c = split.calcular(SUBTOTAL, TOTAL, fee_rate=0.0049)
    assert c["absorvido_pela_qadras_cents"] == 54
    assert c["application_fee_cents"] == 1_235         # R$ 12,35, nao 11,80
    assert c["repasse_estimado_cents"] == 9_700        # arena segue com 97,00


def test_cartao_caro_trava_a_margem_da_qadras():
    """O que passa do teto e da arena — foi exatamente essa a escolha."""
    c = split.calcular(SUBTOTAL, TOTAL, fee_rate=0.0498)
    assert c["taxa_mp_estimada_cents"] == 548
    assert c["absorvido_pela_qadras_cents"] == 109     # so o teto
    assert c["application_fee_cents"] == 1_180         # margem TRAVADA
    assert c["repasse_estimado_cents"] < 9_700         # a arena absorve o resto


@pytest.mark.parametrize("taxa", [0.0049, 0.0099, 0.0149, 0.0199, 0.0498])
def test_a_margem_da_qadras_nunca_cai_abaixo_do_piso(taxa):
    """A propriedade que justifica o teto: o cartao nao come a comissao."""
    c = split.calcular(SUBTOTAL, TOTAL, fee_rate=taxa)
    assert c["application_fee_cents"] >= 1_180


@pytest.mark.parametrize("taxa", [0.0, 0.0049, 0.0099])
def test_abaixo_do_teto_a_arena_recebe_97_por_cento_exatos(taxa):
    """A promessa do contrato, para todo Pix dentro do teto."""
    c = split.calcular(SUBTOTAL, TOTAL, fee_rate=taxa)
    assert c["repasse_estimado_cents"] == round(SUBTOTAL * 0.97)


def test_taxa_arredonda_para_CIMA():
    """Subestimar em um centavo faz a arena receber 96,99 em vez de 97,00.

    Era o unico jeito de a regra falhar silenciosamente: o erro nao aparece em
    lugar nenhum, so na conta do dono da quadra.
    """
    # 10.001 * 0,0099 = 99,0099 -> tem de virar 100, nao 99.
    c = split.calcular(SUBTOTAL, 10_001, fee_rate=0.0099)
    assert c["taxa_mp_estimada_cents"] == 100


def test_taxa_absurda_do_vendedor_nao_derruba_a_comissao():
    """O teto torna impossivel a taxa do vendedor comer a comissao.

    Escrito primeiro esperando application_fee = 0 com fee_rate=0.99, e o
    teste falhou: o `min(taxa, teto)` ja limita o que a Qadras absorve, entao
    a comissao fica intacta em 11,80 por mais cara que seja a conta da arena.
    Vale registrar — e a propriedade que o teto compra.
    """
    c = split.calcular(SUBTOTAL, TOTAL, fee_rate=0.99)
    assert c["application_fee_cents"] == 1_180


def test_application_fee_nunca_fica_negativo(monkeypatch):
    """Teto mal configurado nao pode virar erro opaco do lado do MP.

    Pela taxa do vendedor isso e inalcancavel (teste acima). O unico caminho
    e alguem pôr um teto absurdo em MERCADOPAGO_FEE_ABSORBED_CAP.
    """
    monkeypatch.setattr(
        settings, "mercadopago_fee_absorbed_cap", 0.5, raising=False
    )
    c = split.calcular(SUBTOTAL, TOTAL, fee_rate=0.5)
    assert c["application_fee_cents"] == 0


def test_comissao_bruta_bate_com_o_relatorio_do_admin():
    """A MESMA expressao de admin.py:107 — se divergir, a conciliacao quebra."""
    esperado = round(
        SUBTOTAL * (settings.player_fee_rate + settings.arena_fee_rate)
    )
    assert split.calcular(SUBTOTAL, TOTAL)["comissao_bruta_cents"] == esperado


def test_fee_rate_none_usa_o_presumido_do_config():
    a = split.calcular(SUBTOTAL, TOTAL, fee_rate=None)
    b = split.calcular(SUBTOTAL, TOTAL, fee_rate=settings.mercadopago_default_fee_rate)
    assert a == b


def test_em_reais_converte_para_o_formato_do_mp():
    """O MP espera reais decimais; o dominio inteiro guarda centavos."""
    assert split.em_reais(1_180) == 11.80
    assert split.em_reais(0) == 0.0


def test_reserva_zerada_nao_explode():
    c = split.calcular(0, 0)
    assert c["application_fee_cents"] == 0
    assert c["repasse_estimado_cents"] == 0
