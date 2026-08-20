"""Formas de pagamento.

Saldo, extrato e cupom sairam: manter saldo de usuario e atividade de
instituicao de pagamento, e o app nao e isso. O que sobra e o meio de
pagamento usado em cada reserva.

`cartaoDisponivel` existe porque a tela mentia. O checkout mostrava "Cartao
de credito — Final 4321" e a carteira listava um "Visa final 4321": markup
fixo, cartao que nunca existiu, numero que nao era de ninguem. Pior, o botao
"Adicionar cartao" abria um formulario que pedia numero e CVV, descartava
tudo e respondia "Cartao adicionado com sucesso".

Enquanto nao houver adquirente, o servidor diz que o cartao nao esta
disponivel e o front desenha isso — em vez de cada tela decidir sozinha. No
dia em que a tokenizacao entrar, e so este endpoint mudar: nenhuma tela
precisa ser tocada de novo.
"""

from fastapi import APIRouter

router = APIRouter(prefix="/api/carteira", tags=["pagamento"])


@router.get("")
def formas_de_pagamento():
    return {
        "cartoes": [],
        "pix": True,
        "cartaoDisponivel": False,
        "cartaoMotivo": "Ainda não temos adquirente de cartão. Por enquanto, só Pix.",
    }
