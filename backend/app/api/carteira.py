from fastapi import APIRouter, Query

router = APIRouter(prefix="/api/carteira", tags=["carteira"])


@router.get("")
def carteira():
    transacoes = [
        {"data": "Hoje", "desc": "Reserva · Arena Bola na Rede", "valor": -126.00},
        {"data": "Ontem", "desc": "Cashback por indicação", "valor": 20.00},
        {"data": "28/06", "desc": "Reserva · Beach Point Arena", "valor": -94.50},
        {"data": "25/06", "desc": "Adição de saldo via Pix", "valor": 150.00},
        {"data": "20/06", "desc": "Reserva · Vôlei Sand Club", "valor": -73.50},
    ]
    return {"saldo": 85.00, "transacoes": transacoes}


@router.get("/adicionar")
def adicionar_saldo():
    return {"saldo": 85.00, "valores": [30, 50, 100, 200]}


@router.post("/adicionar")
def salvar_adicao():
    return {"message": "Saldo adicionado via Pix"}


@router.get("/cupons")
def cupons():
    cupons = [
        {"codigo": "PARTIU10", "desc": "R$ 10 de bônus na sua próxima reserva"},
        {"codigo": "AMIGO20", "desc": "R$ 20 ao indicar um amigo que reservar"},
        {"codigo": "NOITE15", "desc": "15% de desconto em horários da noite"},
    ]
    return {"cupons": cupons}


@router.post("/cupom/aplicar")
def aplicar_cupom(codigo: str = Query("")):
    cod = codigo.strip().upper() or "cupom"
    return {"message": "Cupom %s aplicado com sucesso" % cod}
