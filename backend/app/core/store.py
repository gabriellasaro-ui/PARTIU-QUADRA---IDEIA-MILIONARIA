"""Estado MUTAVEL (reservas + conversas) persistido em JSON."""
import copy
import json
import os
import tempfile
from datetime import datetime

from . import data

_FILE = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "state.json")


def _seed():
    return {
        "reservas": copy.deepcopy(data.SEED_RESERVAS),
        "conversas": copy.deepcopy(data.SEED_CONVERSAS),
    }


def _load():
    if not os.path.exists(_FILE):
        _save(_seed())
    try:
        with open(_FILE, encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError):
        state = _seed()
        _save(state)
        return state


def _save(state):
    d = os.path.dirname(_FILE)
    fd, tmp = tempfile.mkstemp(dir=d, suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(state, f, ensure_ascii=False, indent=2)
        os.replace(tmp, _FILE)
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)


def reset():
    _save(_seed())


def reservas():
    return _load()["reservas"]


def get_reserva(rid):
    return next((r for r in _load()["reservas"] if r["id"] == rid), None)


def set_status(rid, status):
    state = _load()
    r = next((x for x in state["reservas"] if x["id"] == rid), None)
    if r:
        r["status"] = status
        _save(state)
    return r


def count_solicitacoes():
    return sum(1 for r in _load()["reservas"] if r["status"] == "Solicitada")


def conversas():
    return _load()["conversas"]


def get_conversa(cid):
    return next((c for c in _load()["conversas"] if c["id"] == cid), None)


def convs_do_jogador():
    return [c for c in _load()["conversas"] if c["jogador"] == data.LOGGED_JOGADOR]


def convs_do_gerente():
    return [c for c in _load()["conversas"] if c["arena"] == data.LOGGED_ARENA]


def unread(convs, me):
    return sum(1 for c in convs if c["mensagens"] and c["mensagens"][-1]["de"] != me)


def conversa_arena_cliente(cliente):
    return next((c for c in _load()["conversas"]
                 if c["arena"] == data.LOGGED_ARENA and c["jogador"] == cliente), None)


def conversa_jogador_arena(arena):
    return next((c for c in _load()["conversas"]
                 if c["jogador"] == data.LOGGED_JOGADOR and c["arena"] == arena), None)


def _next_conv_id(state):
    return max((c["id"] for c in state["conversas"]), default=0) + 1


def add_mensagem(cid, de, texto):
    state = _load()
    c = next((x for x in state["conversas"] if x["id"] == cid), None)
    if c and texto:
        c["mensagens"].append({"de": de, "texto": texto, "hora": datetime.now().strftime("%H:%M")})
        _save(state)
    return c


def avisar_cliente(reserva, texto):
    state = _load()
    c = next((x for x in state["conversas"]
              if x["arena"] == data.LOGGED_ARENA and x["jogador"] == reserva["cliente"]), None)
    if not c:
        c = {"id": _next_conv_id(state), "jogador": reserva["cliente"], "arena": data.LOGGED_ARENA,
             "quadra": reserva.get("quadra") or data.LOGGED_ARENA,
             "assunto": "Reserva " + reserva.get("data", ""), "mensagens": []}
        state["conversas"].append(c)
    c["mensagens"].append({"de": "gerente", "texto": texto, "hora": datetime.now().strftime("%H:%M")})
    _save(state)
    return c
