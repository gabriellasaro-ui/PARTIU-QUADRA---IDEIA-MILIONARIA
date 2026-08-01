from fastapi import APIRouter, Query
from ..core import data

router = APIRouter(prefix="/api/quadras", tags=["quadras"])


@router.get("")
def listar_quadras(
    local: str = Query("Goiania, GO"),
    esporte: str = Query(""),
    raio: str = Query("5"),
):
    resultados = data.QUADRAS
    if esporte:
        resultados = [q for q in resultados if q["esporte"] == esporte]
    resultados = sorted(resultados, key=lambda q: q["distancia"])
    return {
        "quadras": resultados,
        "local": local,
        "esporte": esporte,
        "raio": raio,
        "user_loc": list(data.USER_LOC),
        "esportes": data.ESPORTES,
    }


@router.get("/esportes")
def listar_esportes():
    return {"esportes": data.ESPORTES}


@router.get("/destaques")
def destaques():
    destaques = sorted(data.QUADRAS, key=lambda q: q["nota"], reverse=True)[:4]
    return {"destaques": destaques, "hero": data.HERO_IMG, "esportes": data.ESPORTES}


@router.get("/{quadra_id}")
def detalhe_quadra(quadra_id: int):
    q = data.get_quadra(quadra_id)
    if not q:
        return {"error": "Quadra nao encontrada"}, 404
    return {
        "quadra": q,
        "horarios": data.HORARIOS_PADRAO,
        "dias": data.proximos_dias(),
        "galeria": data.galeria_quadra(q),
        "avaliacoes_mock": [
            {"autor": "Mariana Alves", "data": "Há 2 semanas", "nota": 5,
             "texto": "Quadra muito bem cuidada, iluminação ótima e atendimento rápido."},
            {"autor": "João Pedro", "data": "Há 1 mês", "nota": 5,
             "texto": "A reserva foi tranquila. O vestiário estava limpo e o horário começou pontualmente."},
            {"autor": "Rafael Costa", "data": "Há 2 meses", "nota": 4,
             "texto": "Boa estrutura para jogar com a turma. Voltaria a reservar sem dúvida."},
        ],
    }


@router.get("/{quadra_id}/resumo")
def resumo_quadra(quadra_id: int, hora: str = Query("19:00"), dur: int = Query(1)):
    q = data.get_quadra(quadra_id)
    if not q:
        return {"error": "Quadra nao encontrada"}, 404
    dur = data.clamp_dur(dur)
    preco = q["preco"]
    subtotal = preco * dur
    service_fee = round(subtotal * 0.05, 2)
    return {
        "quadra": q,
        "hora": hora,
        "hora_fim": data.hora_somar(hora, dur),
        "dur": dur,
        "preco": preco,
        "subtotal": subtotal,
        "service_fee": service_fee,
        "total": round(subtotal + service_fee, 2),
    }
