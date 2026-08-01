"""Lógica que compõe dados-semente (data) com o estado persistido (store)."""
from datetime import datetime, timedelta

from . import data, store


def agenda_semana(offset=0):
    dias = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"]
    hoje = datetime.now()
    seg = hoje - timedelta(days=hoje.weekday()) + timedelta(weeks=offset)
    start_h, end_h = 7, 23
    hour_h = 48

    raw = [
        (0, 19, 1, "Pelada Vingança", "pago"), (0, 20, 1, "Time da Firma", "confirmado"),
        (1, 8, 1, "Treino Sub-15", "pago"), (1, 20, 2, "Os Galáticos", "pago"),
        (2, 18, 1, "Rachão do Bairro", "pendente"), (2, 21, 1, "Marina e amigos", "confirmado"),
        (3, 7, 1, "Aula particular", "confirmado"), (3, 19, 1, "Pelada do Trabalho", "pago"),
        (4, 18, 2, "Resenha FC", "pago"), (4, 21, 1, "Galera do Setor", "pendente"),
        (5, 9, 1, "Torneio amador", "confirmado"), (5, 16, 2, "Final do campeonato", "pago"),
        (5, 19, 1, "Amigos da Bola", "pago"), (6, 10, 1, "Pelada de domingo", "pago"),
        (6, 17, 1, "Família Souza", "confirmado"),
    ]
    cls_label = {"pago": "Pago", "confirmado": "Confirmado", "pendente": "Aguardando"}
    colunas = []
    for i, d in enumerate(dias):
        dt = seg + timedelta(days=i)
        evs = []
        for (di, s, dur, cli, cls) in raw:
            if di != i:
                continue
            conv = store.conversa_arena_cliente(cli)
            hh = sum(ord(ch) for ch in cli)
            evs.append({
                "top": (s - start_h) * hour_h, "height": dur * hour_h - 4,
                "cliente": cli, "hora": f"{s:02d}:00 – {s + dur:02d}:00", "cls": cls,
                "status": cls_label.get(cls, cls.title()), "dia": f"{d}, {dt.day}",
                "chat_cid": conv["id"] if conv else None,
                "quadra": "Society 1" if (i + s) % 2 == 0 else "Society 2",
                "dur": dur, "dur_txt": "1 hora" if dur == 1 else f"{dur} horas",
                "valor": dur * 120,
                "telefone": f"(62) 9{8000 + hh % 2000:04d}-{1000 + (hh * 7) % 9000:04d}",
                "codigo": f"PQ-{(hh + s * 17) % 10000:04d}",
            })
        colunas.append({"dia": d, "num": dt.day, "hoje": dt.date() == hoje.date(), "eventos": evs})

    dom = seg + timedelta(days=6)
    if offset == 0:
        rotulo = "Esta semana"
    elif seg.month == dom.month:
        rotulo = f"{seg.day}–{dom.day} {data.MESES_ABREV[dom.month - 1]}"
    else:
        rotulo = (f"{seg.day} {data.MESES_ABREV[seg.month - 1]} – "
                  f"{dom.day} {data.MESES_ABREV[dom.month - 1]}")

    return {
        "colunas": colunas, "horas": list(range(start_h, end_h)), "hour_h": hour_h,
        "altura": (end_h - start_h) * hour_h, "offset": offset, "rotulo": rotulo,
    }


def gerente_dados():
    fat = data.FATURAMENTO_SEMANA
    bruto = sum(fat)
    comissao = round(bruto * data.TAXA_PLATAFORMA, 2)
    repasse = round(bruto - comissao, 2)

    heat = data.heatmap_ocupacao()
    todas = [c["occ"] for row in heat for c in row["cells"]]
    ocup_media = round(sum(todas) / len(todas))

    def faixa_avg(horas):
        vals = [c["occ"] for row in heat if int(row["hora"][:2]) in horas for c in row["cells"]]
        return round(sum(vals) / len(vals))

    faixas = [
        {"lab": "Manhã", "sub": "08h–12h", "occ": faixa_avg(range(8, 12))},
        {"lab": "Tarde", "sub": "12h–18h", "occ": faixa_avg(range(12, 18))},
        {"lab": "Noite", "sub": "18h–23h", "occ": faixa_avg(range(18, 24))},
    ]

    melhor_i = fat.index(max(fat))
    pior_i = fat.index(min(fat))
    melhor_dia = data.DIAS_SEMANA_FULL[data.DIAS_SEMANA_LBL[melhor_i]]
    pior_dia = data.DIAS_SEMANA_FULL[data.DIAS_SEMANA_LBL[pior_i]]
    nobre = faixa_avg([19, 20])

    insights = [
        {"icon": "i-trend", "tone": "good", "title": f"{melhor_dia} é seu melhor dia",
         "text": f"{data.money(max(fat))} em reservas. Mantenha a noite toda aberta."},
        {"icon": "i-flame", "tone": "good", "title": "Horário nobre quase lotado",
         "text": f"19h–21h com {nobre}% de ocupação. Há espaço para preço dinâmico."},
        {"icon": "i-down", "tone": "warn", "title": f"{pior_dia} é o dia mais fraco",
         "text": "Crie um pacote ou promoção para encher os horários ociosos."},
    ]

    kpis = [
        {"label": "Faturamento (7 dias)", "val": data.money(bruto), "delta": "+12%", "icon": "i-wallet", "feature": True},
        {"label": "Ticket médio", "val": "R$ 112", "delta": "+3%", "icon": "i-dollar", "feature": False},
        {"label": "Reservas (7 dias)", "val": "47", "delta": "+8", "icon": "i-calendar", "feature": False},
        {"label": "Ocupação média", "val": f"{ocup_media}%", "delta": "+5%", "icon": "i-clock", "feature": False},
    ]

    rsv = store.reservas()
    sample = [{"cliente": r["cliente"], "data": r["data"], "horario": r["hora"],
               "valor": r["valor"], "status": r["status"]} for r in rsv[:6]]

    return {
        "kpis": kpis,
        "chart": data.line_chart(fat, data.DIAS_SEMANA_LBL),
        "heat": heat, "heat_dias": data.DIAS_SEMANA_LBL, "faixas": faixas, "insights": insights,
        "bruto": bruto, "comissao": comissao, "repasse": repasse,
        "ticket_medio": 112, "ocupacao": ocup_media,
        "faturamento_hoje": sum(r["valor"] for r in rsv if r["data"] == "Hoje"),
        "novos_clientes": 18, "reservas_semana": 47,
        "reservas": sample, "horarios": data.HORARIOS_PADRAO,
        "taxa": int(data.TAXA_PLATAFORMA * 100),
        "data_hoje": datetime.now().strftime("%d/%m/%Y"),
        "reservas_hoje": len([r for r in rsv if r["data"] == "Hoje"]),
    }
