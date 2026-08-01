from fastapi import APIRouter
from ..core import data, store

router = APIRouter(prefix="/api/reservas", tags=["reservas"])


@router.get("")
def listar_reservas():
    return {"reservas": data.reservas_jogador()}


@router.get("/todas")
def todas_reservas():
    return {"reservas": store.reservas()}


@router.get("/{rid}")
def detalhe_reserva(rid: int):
    r = store.get_reserva(rid)
    if not r:
        return {"error": "Reserva nao encontrada"}, 404
    comissao = round(r["valor"] * data.TAXA_PLATAFORMA, 2)
    repasse = round(r["valor"] - comissao, 2)
    conv = store.conversa_arena_cliente(r["cliente"])
    return {
        "r": r,
        "comissao": comissao,
        "repasse": repasse,
        "taxa": int(data.TAXA_PLATAFORMA * 100),
        "chat_cid": conv["id"] if conv else None,
    }


@router.post("/{rid}/status")
def atualizar_status(rid: int, status: str):
    r = store.set_status(rid, status)
    if not r:
        return {"error": "Reserva nao encontrada"}, 404
    return {"reserva": r}


@router.post("/{rid}/aprovar")
def aprovar_reserva(rid: int):
    r = store.set_status(rid, "Confirmado")
    if not r:
        return {"error": "Reserva nao encontrada"}, 404
    store.avisar_cliente(
        r,
        "Boa notícia! Sua reserva na %s para %s (%s) foi confirmada. Te espero na quadra."
        % (r["quadra"], r["data"], r["hora"]),
    )
    return {"reserva": r, "message": "Reserva aprovada"}


@router.post("/{rid}/recusar")
def recusar_reserva(rid: int):
    r = store.set_status(rid, "Recusada")
    if not r:
        return {"error": "Reserva nao encontrada"}, 404
    store.avisar_cliente(
        r,
        "Oi! Infelizmente não consigo confirmar sua reserva na %s para %s (%s). Me chama aqui que a gente acha outro horário."
        % (r["quadra"], r["data"], r["hora"]),
    )
    return {"reserva": r, "message": "Reserva recusada"}


@router.post("/{rid}/pagar")
def pagar_reserva(rid: int):
    r = store.set_status(rid, "Pago")
    if not r:
        return {"error": "Reserva nao encontrada"}, 404
    store.avisar_cliente(
        r,
        "Recebemos o pagamento da sua reserva na %s (%s, %s). Está tudo certo, bom jogo!"
        % (r["quadra"], r["data"], r["hora"]),
    )
    return {"reserva": r, "message": "Pagamento confirmado"}


@router.post("/{rid}/cancelar")
def cancelar_reserva(rid: int):
    r = store.set_status(rid, "Cancelada")
    if not r:
        return {"error": "Reserva nao encontrada"}, 404
    store.avisar_cliente(
        r,
        "Precisei cancelar sua reserva na %s (%s, %s). Desculpa o transtorno — me chama aqui para remarcar."
        % (r["quadra"], r["data"], r["hora"]),
    )
    return {"reserva": r, "message": "Reserva cancelada"}
