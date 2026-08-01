from fastapi import APIRouter, Query
from ..core import store

router = APIRouter(prefix="/api/mensagens", tags=["mensagens"])


@router.get("")
def listar_conversas(role: str = Query("jogador")):
    if role == "gerente":
        convs = store.convs_do_gerente()
    else:
        convs = store.convs_do_jogador()
    return {"conversas": convs}


@router.get("/{cid}")
def conversa_detalhe(cid: int):
    c = store.get_conversa(cid)
    if not c:
        return {"error": "Conversa nao encontrada"}, 404
    return {"conversa": c}


@router.post("/{cid}/enviar")
def enviar_mensagem(cid: int, texto: str = Query(""), de: str = Query("jogador")):
    c = store.add_mensagem(cid, de, texto)
    if not c:
        return {"error": "Conversa nao encontrada"}, 404
    return {"conversa": c}


@router.get("/nav/badges")
def badges(role: str = Query("jogador")):
    if role == "gerente":
        return {
            "solicitacoes": store.count_solicitacoes(),
            "msg_ger": store.unread(store.convs_do_gerente(), "gerente"),
            "msg_jog": store.unread(store.convs_do_jogador(), "jogador"),
        }
    return {
        "solicitacoes": store.count_solicitacoes(),
        "msg_jog": store.unread(store.convs_do_jogador(), "jogador"),
        "msg_ger": store.unread(store.convs_do_gerente(), "gerente"),
    }
