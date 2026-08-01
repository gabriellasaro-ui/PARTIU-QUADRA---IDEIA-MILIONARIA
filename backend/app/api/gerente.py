from fastapi import APIRouter, Query
from ..core import data, store, domain

router = APIRouter(prefix="/api/gerente", tags=["gerente"])


@router.get("/dashboard")
def dashboard():
    return {"g": domain.gerente_dados()}


@router.get("/agenda")
def agenda(semana: int = Query(0)):
    offset = max(-12, min(12, semana))
    return {"ag": domain.agenda_semana(offset)}


@router.get("/reservas")
def reservas():
    return {"reservas": store.reservas()}


@router.get("/quadras")
def quadras():
    minhas = [
        {**data.QUADRAS[0], "rotulo": "Society 1", "ativa": True, "ocup": 78},
        {**data.QUADRAS[2], "rotulo": "Society 2", "ativa": True, "ocup": 64},
        {**data.QUADRAS[3], "rotulo": "Areia", "ativa": False, "ocup": 0},
    ]
    return {"quadras": minhas, "esportes": data.ESPORTES}


@router.get("/financeiro")
def financeiro():
    g = domain.gerente_dados()

    def _repasse(periodo, bruto, status, cls):
        com = round(bruto * data.TAXA_PLATAFORMA, 2)
        return {"periodo": periodo, "bruto": bruto, "comissao": com,
                "liquido": round(bruto - com, 2), "status": status, "cls": cls}

    repasses = [
        _repasse("Esta semana", g["bruto"], "Em aberto", "pendente"),
        _repasse("23–29 jun", 4980, "Pago", "pago"),
        _repasse("16–22 jun", 5320, "Pago", "pago"),
        _repasse("09–15 jun", 4610, "Pago", "pago"),
    ]
    return {"g": g, "repasses": repasses}


@router.get("/avaliacoes")
def avaliacoes():
    avaliacoes = [
        {"cliente": "Lucas Andrade", "nota": 5, "quando": "há 2 dias", "texto": "Quadra impecável, gramado novo e iluminação ótima pra jogar à noite."},
        {"cliente": "Marina Souza", "nota": 5, "quando": "há 5 dias", "texto": "Vestiário limpo e atendimento rápido. Voltarei com certeza."},
        {"cliente": "Rafael Lima", "nota": 4, "quando": "há 1 semana", "texto": "Muito boa, só faltou estacionamento mais perto. No mais, top."},
        {"cliente": "Time da Firma", "nota": 5, "quando": "há 2 semanas", "texto": "Melhor society da região, reserva pelo app é super prática."},
    ]
    dist = [{"n": 5, "qtd": 168}, {"n": 4, "qtd": 32}, {"n": 3, "qtd": 9}, {"n": 2, "qtd": 3}, {"n": 1, "qtd": 2}]
    total = sum(d["qtd"] for d in dist)
    media = round(sum(d["n"] * d["qtd"] for d in dist) / total, 1)
    return {"avaliacoes": avaliacoes, "dist": dist, "total": total, "media": media}


@router.get("/config")
def config():
    return {"taxa": int(data.TAXA_PLATAFORMA * 100)}
