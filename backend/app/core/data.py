"""Constantes, dados-semente (mock) e helpers puros — sem estado mutável."""
from datetime import datetime, timedelta

# Duas taxas: a do jogador entra por cima do preco da quadra, a da arena
# sai por dentro do repasse. TAXA_PLATAFORMA aponta para a do jogador, que
# e a usada no checkout.
TAXA_JOGADOR = 0.09
TAXA_ARENA = 0.03
TAXA_PLATAFORMA = TAXA_JOGADOR

IMG = "https://images.unsplash.com/"
IMG_PARAMS = "?auto=format&fit=crop&w=900&q=80"

LOGGED_JOGADOR = "Gabriel Lisboa"
LOGGED_ARENA = "Arena Bola na Rede"

ESPORTES = ["Futebol Society", "Beach Tennis", "Volei", "Basquete", "Tenis", "Futsal"]

QUADRAS = [
    {"id": 1, "nome": "Arena Bola na Rede", "esporte": "Futebol Society", "bairro": "Jardim Goias",
     "distancia": 1.2, "nota": 4.8, "avaliacoes": 214, "preco": 120,
     "foto": IMG + "photo-1556056504-5c7696c4c28d" + IMG_PARAMS,
     "tags": ["Grama sintetica", "Iluminada", "Vestiario"]},
    {"id": 2, "nome": "Beach Point Arena", "esporte": "Beach Tennis", "bairro": "Setor Bueno",
     "distancia": 2.5, "nota": 4.9, "avaliacoes": 388, "preco": 90,
     "foto": IMG + "photo-1626224583764-f87db24ac4ea" + IMG_PARAMS,
     "tags": ["Areia", "Coberta", "Bar"]},
    {"id": 3, "nome": "Quadra do Ze", "esporte": "Futsal", "bairro": "Setor Sul",
     "distancia": 0.8, "nota": 4.5, "avaliacoes": 97, "preco": 80,
     "foto": IMG + "photo-1577223625816-7546f13df25d" + IMG_PARAMS,
     "tags": ["Piso oficial", "Coberta", "Vestiario"]},
    {"id": 4, "nome": "Volei Sand Club", "esporte": "Volei", "bairro": "Setor Oeste",
     "distancia": 3.4, "nota": 4.7, "avaliacoes": 142, "preco": 70,
     "foto": IMG + "photo-1612872087720-bb876e2e67d1" + IMG_PARAMS,
     "tags": ["Areia", "Estacionamento", "Bar"]},
    {"id": 5, "nome": "Top Spin Tenis", "esporte": "Tenis", "bairro": "Alto da Gloria",
     "distancia": 4.1, "nota": 4.6, "avaliacoes": 73, "preco": 110,
     "foto": IMG + "photo-1595435934249-5df7ed86e1c0" + IMG_PARAMS,
     "tags": ["Saibro", "Iluminada", "Aulas"]},
    {"id": 6, "nome": "Cesta Cheia Basquete", "esporte": "Basquete", "bairro": "Setor Marista",
     "distancia": 4.8, "nota": 4.4, "avaliacoes": 51, "preco": 75,
     "foto": IMG + "photo-1546519638-68e109498ffc" + IMG_PARAMS,
     "tags": ["Coberta", "Arquibancada", "Vestiario"]},
]

COORDS = {
    1: (-16.7060, -49.2350), 2: (-16.7050, -49.2770), 3: (-16.6870, -49.2620),
    4: (-16.6780, -49.2720), 5: (-16.7150, -49.2470), 6: (-16.6950, -49.2650),
}
USER_LOC = (-19.9300, -43.9400)
for _q in QUADRAS:
    _q["lat"], _q["lng"] = COORDS[_q["id"]]

HERO_IMG = IMG + "photo-1459865264687-595d652de67e?auto=format&fit=crop&w=1600&q=80"

GALERIA_POOL = [
    "photo-1556056504-5c7696c4c28d", "photo-1577223625816-7546f13df25d",
    "photo-1546519638-68e109498ffc", "photo-1595435934249-5df7ed86e1c0",
    "photo-1612872087720-bb876e2e67d1", "photo-1592656094267-764a45160876",
]

HORARIOS_PADRAO = [
    {"hora": "08:00", "status": "ocupado"}, {"hora": "09:00", "status": "livre"},
    {"hora": "10:00", "status": "livre"}, {"hora": "11:00", "status": "livre"},
    {"hora": "12:00", "status": "ocupado"}, {"hora": "13:00", "status": "livre"},
    {"hora": "14:00", "status": "ocupado"}, {"hora": "15:00", "status": "livre"},
    {"hora": "16:00", "status": "livre"}, {"hora": "17:00", "status": "livre"},
    {"hora": "18:00", "status": "ocupado"}, {"hora": "19:00", "status": "livre"},
    {"hora": "20:00", "status": "livre"}, {"hora": "21:00", "status": "livre"},
    {"hora": "22:00", "status": "livre"},
]

DIAS_SEMANA_LBL = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"]
DIAS_SEMANA_FULL = {"Seg": "Segunda", "Ter": "Terça", "Qua": "Quarta", "Qui": "Quinta",
                    "Sex": "Sexta", "Sáb": "Sábado", "Dom": "Domingo"}
FATURAMENTO_SEMANA = [540, 620, 380, 740, 920, 1180, 860]
HEAT_HORAS = list(range(8, 24))
HORA_W = {8: .45, 9: .40, 10: .45, 11: .50, 12: .55, 13: .45, 14: .50, 15: .58,
          16: .62, 17: .72, 18: .88, 19: 1.0, 20: 1.0, 21: .92, 22: .70, 23: .45}
DIA_W = {"Seg": .85, "Ter": .90, "Qua": .78, "Qui": .95, "Sex": 1.05, "Sáb": 1.12, "Dom": .96}
MESES_ABREV = ["jan", "fev", "mar", "abr", "mai", "jun",
               "jul", "ago", "set", "out", "nov", "dez"]

SEED_RESERVAS = [
    {"id": 9, "cliente": "Gabriel Lisboa", "telefone": "(62) 99888-0001", "quadra": "Society 1", "data": "Sáb, 06/07", "hora": "19:00 – 20:00", "valor": 120, "status": "Solicitada"},
    {"id": 1, "cliente": "Lucas Andrade", "telefone": "(62) 99140-2210", "quadra": "Society 1", "data": "Hoje", "hora": "08:00 – 09:00", "valor": 120, "status": "Solicitada"},
    {"id": 2, "cliente": "Equipe Os Galáticos", "telefone": "(62) 99777-1180", "quadra": "Society 1", "data": "Hoje", "hora": "14:00 – 16:00", "valor": 240, "status": "Pago"},
    {"id": 3, "cliente": "Marina Souza", "telefone": "(62) 98120-5567", "quadra": "Society 2", "data": "Amanhã", "hora": "18:00 – 19:00", "valor": 120, "status": "Solicitada"},
    {"id": 4, "cliente": "Pelada do Trabalho", "telefone": "(62) 99604-7781", "quadra": "Society 1", "data": "Amanhã", "hora": "20:00 – 21:00", "valor": 120, "status": "Pendente"},
    {"id": 5, "cliente": "Rafael Lima", "telefone": "(62) 99333-0092", "quadra": "Society 2", "data": "Amanhã", "hora": "21:00 – 22:00", "valor": 120, "status": "Confirmado"},
    {"id": 6, "cliente": "Time da Firma", "telefone": "(62) 98800-4521", "quadra": "Society 1", "data": "Qui, 02/07", "hora": "19:00 – 20:00", "valor": 120, "status": "Confirmado"},
    {"id": 7, "cliente": "Amigos da Bola", "telefone": "(62) 99012-3344", "quadra": "Society 2", "data": "Sex, 03/07", "hora": "20:00 – 22:00", "valor": 240, "status": "Solicitada"},
    {"id": 8, "cliente": "Galera do Bairro", "telefone": "(62) 99455-8890", "quadra": "Society 1", "data": "Sáb, 04/07", "hora": "16:00 – 17:00", "valor": 120, "status": "Confirmado"},
]

SEED_CONVERSAS = [
    {"id": 1, "jogador": "Gabriel Lisboa", "arena": "Arena Bola na Rede",
     "quadra": "Arena Bola na Rede", "assunto": "Reserva de sábado 19h",
     "mensagens": [
         {"de": "jogador", "texto": "Fala! Reservei sábado às 19h. A quadra tem colete pra emprestar?", "hora": "09:12"},
         {"de": "gerente", "texto": "Opa, Gabriel! Tem sim, 10 coletes. Quantos vocês vão precisar?", "hora": "09:15"},
         {"de": "jogador", "texto": "Uns 6 tá ótimo. Valeu!", "hora": "09:16"},
         {"de": "gerente", "texto": "Fechado, deixo separado na recepção. Bom jogo!", "hora": "09:17"},
     ]},
    {"id": 2, "jogador": "Gabriel Lisboa", "arena": "Beach Point Arena",
     "quadra": "Beach Point Arena", "assunto": "Beach tennis domingo",
     "mensagens": [
         {"de": "gerente", "texto": "Oi Gabriel, seu horário de domingo 10h está confirmado. Precisa de raquete?", "hora": "18:40"},
     ]},
    {"id": 3, "jogador": "Lucas Andrade", "arena": "Arena Bola na Rede",
     "quadra": "Society 1", "assunto": "Solicitação de hoje 08h",
     "mensagens": [
         {"de": "jogador", "texto": "Boa! Mandei a solicitação das 8h de hoje, consegue confirmar?", "hora": "07:05"},
     ]},
    {"id": 4, "jogador": "Marina Souza", "arena": "Arena Bola na Rede",
     "quadra": "Society 2", "assunto": "Reserva de amanhã 18h",
     "mensagens": [
         {"de": "jogador", "texto": "Dá pra estender pra 2 horas amanhã? Vamos ser mais gente.", "hora": "21:30"},
     ]},
]


def get_quadra(quadra_id):
    return next((q for q in QUADRAS if q["id"] == quadra_id), None)


def hora_somar(hora, horas):
    h = int(str(hora).split(":")[0]) + int(horas)
    return f"{h:02d}:00"


def clamp_dur(valor):
    try:
        return max(1, min(3, int(valor)))
    except (TypeError, ValueError):
        return 1


def galeria_quadra(q):
    extras = [IMG + p + IMG_PARAMS for p in GALERIA_POOL if p not in q["foto"]]
    return [q["foto"]] + extras[:2]


def proximos_dias(qtd=7):
    dias_semana = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sab", "Dom"]
    hoje = datetime.now()
    saida = []
    for i in range(qtd):
        d = hoje + timedelta(days=i)
        saida.append({
            "label": "Hoje" if i == 0 else ("Amanha" if i == 1 else dias_semana[d.weekday()]),
            "dia": d.day, "ativo": i == 0,
        })
    return saida


def reservas_jogador():
    plano = [
        (1, "Hoje", "19:00", 1, "Confirmada", "pago"),
        (2, "Amanha", "08:00", 1, "Confirmada", "confirmado"),
        (4, "Sex, 12/06", "20:00", 1, "Aguardando pagamento", "pendente"),
    ]
    out = []
    for qid, data_, hora, dur, status, cls in plano:
        q = get_quadra(qid)
        out.append({
            "id": q["id"], "nome": q["nome"], "esporte": q["esporte"], "bairro": q["bairro"],
            "foto": q["foto"], "valor": round(q["preco"] * dur, 2),
            "data": data_, "hora": f"{hora} – {hora_somar(hora, dur)}",
            "status": status, "status_class": cls,
        })
    return out


def money(v):
    return "R$ " + f"{int(round(v)):,}".replace(",", ".")


def heatmap_ocupacao():
    rows = []
    for h in HEAT_HORAS:
        cells = []
        for d in DIAS_SEMANA_LBL:
            occ = min(100, round(HORA_W[h] * DIA_W[d] * 100))
            cells.append({"occ": occ, "b": min(4, occ // 20), "dia": d, "hora": f"{h:02d}h"})
        rows.append({"hora": f"{h:02d}h", "cells": cells})
    return rows


def _nice_max(v):
    if v <= 0:
        return 100
    mag = 10 ** (len(str(int(v))) - 1)
    for step in (1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10):
        if step * mag >= v:
            return int(step * mag)
    return int(10 * mag)


def line_chart(values, labels, w=600, h=212, pad_top=20, pad_bottom=30, pad_left=42, pad_right=20):
    n = len(values)
    plot_h = h - pad_top - pad_bottom
    x0, x1 = pad_left, w - pad_right
    usable = x1 - x0
    maxv = _nice_max(max(values)) or 100
    step = usable / (n - 1) if n > 1 else usable
    pts = []
    for i, v in enumerate(values):
        x = round(x0 + i * step, 1)
        y = round(pad_top + (1 - v / maxv) * plot_h, 1)
        pts.append({"x": x, "y": y, "val": v, "lab": labels[i]})
    base_y = round(pad_top + plot_h, 1)
    line = "M " + " L ".join(f'{p["x"]} {p["y"]}' for p in pts)
    area = (f'M {pts[0]["x"]} {base_y} '
            + " ".join(f'L {p["x"]} {p["y"]}' for p in pts)
            + f' L {pts[-1]["x"]} {base_y} Z')
    grid = [{"y": round(pad_top + (gi / 4) * plot_h, 1), "lab": int(maxv * (1 - gi / 4))}
            for gi in range(5)]
    return {"w": w, "h": h, "line": line, "area": area, "points": pts, "grid": grid,
            "base_y": base_y, "peak": values.index(max(values)),
            "plot_x0": x0, "plot_x1": x1}
