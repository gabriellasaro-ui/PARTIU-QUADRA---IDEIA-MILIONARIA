"""Formas de pagamento.

Saldo, extrato e cupom sairam: manter saldo de usuario e atividade de
instituicao de pagamento, e o app nao e isso. O que sobra e o meio de
pagamento usado em cada reserva.

TODO: quando houver adquirente, este modulo passa a listar e tokenizar
cartao. Hoje o cartao e markup fixo no cliente.
"""

from fastapi import APIRouter

router = APIRouter(prefix="/api/carteira", tags=["pagamento"])


@router.get("")
def formas_de_pagamento():
    return {"cartoes": [], "pix": True}
