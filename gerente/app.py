"""
PARTIU QUADRA — App do GERENTE (dono da quadra)  ·  standalone

Aplicacao independente do painel de gestao. Roda sozinha (porta 5001) e usa o
pacote `shared` (dados + estado persistido em JSON) para ficar sincronizada com
o app do Cliente — reservas aprovadas e mensagens aparecem nos dois lados.

Rodar:  python gerente/app.py     ->  http://localhost:5001
"""
import os
import sys

# permite importar o pacote `shared` que fica na raiz do projeto
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from flask import Flask, render_template, request, redirect, url_for  # noqa: E402

from shared import data, store, domain  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
app = Flask(
    __name__,
    static_folder=os.path.join(ROOT, "static"),        # CSS/JS compartilhados
    template_folder=os.path.join(HERE, "templates"),   # absoluto: nao depende de como e iniciado
)
# URL do app do Cliente (para os links "Ver como jogador" / "Sair")
app.config["CLIENTE_URL"] = os.environ.get("CLIENTE_URL", "http://localhost:5000")

TAXA = data.TAXA_PLATAFORMA


@app.context_processor
def inject_nav():
    """Badges dinamicos da sidebar."""
    return {"nav": {
        "solicitacoes": store.count_solicitacoes(),
        "msg_ger": store.unread(store.convs_do_gerente(), "gerente"),
        "msg_jog": store.unread(store.convs_do_jogador(), "jogador"),
    }}


# ---------------------------------------------------------------------------
# HOME / MOBILE
# ---------------------------------------------------------------------------

@app.route("/")
def home():
    return redirect(url_for("pc_gerente"))


@app.route("/gerente")
def gerente():
    return render_template("gerente.html", g=domain.gerente_dados(), quadra=data.QUADRAS[0])


# ---------------------------------------------------------------------------
# DASHBOARD (desktop)
# ---------------------------------------------------------------------------

@app.route("/pc/gerente")
def pc_gerente():
    return render_template("desktop/gerente.html", g=domain.gerente_dados())


# ---------------------------------------------------------------------------
# RESERVAS
# ---------------------------------------------------------------------------

@app.route("/pc/gerente/reservas")
def pc_gerente_reservas():
    return render_template("desktop/g_reservas.html", reservas=store.reservas())


@app.route("/pc/gerente/reservas/nova", methods=["GET", "POST"])
def pc_gerente_reserva_nova():
    if request.method == "POST":
        return redirect(url_for("pc_gerente_reservas", toast="Reserva criada com sucesso"))
    quadras = ["Society 1", "Society 2", "Areia"]
    return render_template("desktop/g_reserva_nova.html", quadras=quadras)


@app.route("/pc/gerente/reservas/<int:rid>")
def pc_gerente_reserva(rid):
    r = store.get_reserva(rid)
    if not r:
        return redirect(url_for("pc_gerente_reservas"))
    comissao = round(r["valor"] * TAXA, 2)
    repasse = round(r["valor"] - comissao, 2)
    conv = store.conversa_arena_cliente(r["cliente"])
    return render_template(
        "desktop/g_reserva_detalhe.html",
        r=r, comissao=comissao, repasse=repasse, taxa=int(TAXA * 100),
        chat_cid=(conv["id"] if conv else None),
    )


@app.route("/pc/gerente/reservas/<int:rid>/aprovar", methods=["POST"])
def pc_gerente_reserva_aprovar(rid):
    r = store.set_status(rid, "Confirmado")
    if not r:
        return redirect(url_for("pc_gerente_reservas"))
    store.avisar_cliente(r, "Boa notícia! Sua reserva na %s para %s (%s) foi confirmada. Te espero na quadra." % (r["quadra"], r["data"], r["hora"]))
    return redirect(url_for("pc_gerente_reservas", toast="Reserva de %s aprovada — cliente avisado no chat" % r["cliente"]))


@app.route("/pc/gerente/reservas/<int:rid>/recusar", methods=["POST"])
def pc_gerente_reserva_recusar(rid):
    r = store.set_status(rid, "Recusada")
    if not r:
        return redirect(url_for("pc_gerente_reservas"))
    store.avisar_cliente(r, "Oi! Infelizmente não consigo confirmar sua reserva na %s para %s (%s). Me chama aqui que a gente acha outro horário." % (r["quadra"], r["data"], r["hora"]))
    return redirect(url_for("pc_gerente_reservas", toast="Reserva de %s recusada — cliente avisado no chat" % r["cliente"]))


@app.route("/pc/gerente/reservas/<int:rid>/pagar", methods=["POST"])
def pc_gerente_reserva_pagar(rid):
    r = store.set_status(rid, "Pago")
    if not r:
        return redirect(url_for("pc_gerente_reservas"))
    store.avisar_cliente(r, "Recebemos o pagamento da sua reserva na %s (%s, %s). Está tudo certo, bom jogo!" % (r["quadra"], r["data"], r["hora"]))
    return redirect(url_for("pc_gerente_reserva", rid=rid, toast="Pagamento confirmado — cliente avisado"))


@app.route("/pc/gerente/reservas/<int:rid>/cancelar", methods=["POST"])
def pc_gerente_reserva_cancelar(rid):
    r = store.set_status(rid, "Cancelada")
    if not r:
        return redirect(url_for("pc_gerente_reservas"))
    store.avisar_cliente(r, "Precisei cancelar sua reserva na %s (%s, %s). Desculpa o transtorno — me chama aqui para remarcar." % (r["quadra"], r["data"], r["hora"]))
    return redirect(url_for("pc_gerente_reservas", toast="Reserva cancelada — cliente avisado no chat"))


# ---------------------------------------------------------------------------
# AGENDA / FINANCEIRO / QUADRAS / AVALIACOES / CONFIG
# ---------------------------------------------------------------------------

@app.route("/pc/gerente/agenda")
def pc_gerente_agenda():
    try:
        offset = int(request.args.get("semana", 0))
    except (TypeError, ValueError):
        offset = 0
    offset = max(-12, min(12, offset))
    return render_template("desktop/g_agenda.html", ag=domain.agenda_semana(offset))


@app.route("/pc/gerente/financeiro")
def pc_gerente_financeiro():
    g = domain.gerente_dados()

    def _repasse(periodo, bruto, status, cls):
        com = round(bruto * TAXA, 2)
        return {"periodo": periodo, "bruto": bruto, "comissao": com,
                "liquido": round(bruto - com, 2), "status": status, "cls": cls}

    repasses = [
        _repasse("Esta semana", g["bruto"], "Em aberto", "pendente"),
        _repasse("23–29 jun", 4980, "Pago", "pago"),
        _repasse("16–22 jun", 5320, "Pago", "pago"),
        _repasse("09–15 jun", 4610, "Pago", "pago"),
    ]
    return render_template("desktop/g_financeiro.html", g=g, repasses=repasses)


@app.route("/pc/gerente/quadras")
def pc_gerente_quadras():
    minhas = [
        {**data.QUADRAS[0], "rotulo": "Society 1", "ativa": True, "ocup": 78},
        {**data.QUADRAS[2], "rotulo": "Society 2", "ativa": True, "ocup": 64},
        {**data.QUADRAS[3], "rotulo": "Areia", "ativa": False, "ocup": 0},
    ]
    return render_template("desktop/g_quadras.html", quadras=minhas)


@app.route("/pc/gerente/quadras/nova", methods=["GET", "POST"])
def pc_gerente_quadra_nova():
    if request.method == "POST":
        return redirect(url_for("pc_gerente_quadras", toast="Quadra cadastrada com sucesso"))
    return render_template("desktop/g_quadra_form.html", quadra=None, esportes=data.ESPORTES)


@app.route("/pc/gerente/quadras/<int:quadra_id>/editar", methods=["GET", "POST"])
def pc_gerente_quadra_editar(quadra_id):
    q = data.get_quadra(quadra_id)
    if not q:
        return redirect(url_for("pc_gerente_quadras"))
    if request.method == "POST":
        return redirect(url_for("pc_gerente_quadras", toast="Quadra atualizada"))
    return render_template("desktop/g_quadra_form.html", quadra=q, esportes=data.ESPORTES)


@app.route("/pc/gerente/avaliacoes")
def pc_gerente_avaliacoes():
    avaliacoes = [
        {"cliente": "Lucas Andrade", "nota": 5, "quando": "há 2 dias", "texto": "Quadra impecável, gramado novo e iluminação ótima pra jogar à noite."},
        {"cliente": "Marina Souza", "nota": 5, "quando": "há 5 dias", "texto": "Vestiário limpo e atendimento rápido. Voltarei com certeza."},
        {"cliente": "Rafael Lima", "nota": 4, "quando": "há 1 semana", "texto": "Muito boa, só faltou estacionamento mais perto. No mais, top."},
        {"cliente": "Time da Firma", "nota": 5, "quando": "há 2 semanas", "texto": "Melhor society da região, reserva pelo app é super prática."},
    ]
    dist = [{"n": 5, "qtd": 168}, {"n": 4, "qtd": 32}, {"n": 3, "qtd": 9}, {"n": 2, "qtd": 3}, {"n": 1, "qtd": 2}]
    total = sum(d["qtd"] for d in dist)
    media = round(sum(d["n"] * d["qtd"] for d in dist) / total, 1)
    return render_template("desktop/g_avaliacoes.html", avaliacoes=avaliacoes, dist=dist, total=total, media=media)


@app.route("/pc/gerente/config", methods=["GET", "POST"])
def pc_gerente_config():
    if request.method == "POST":
        return redirect(url_for("pc_gerente_config", toast="Configurações salvas com sucesso"))
    return render_template("desktop/g_config.html", taxa=int(TAXA * 100))


# ---------------------------------------------------------------------------
# CHAT (lado do gerente)
# ---------------------------------------------------------------------------

@app.route("/pc/gerente/mensagens")
@app.route("/pc/gerente/mensagens/<int:cid>")
def pc_gerente_mensagens(cid=None):
    convs = store.convs_do_gerente()
    ativa = store.get_conversa(cid) if cid else (convs[0] if convs else None)
    return render_template(
        "desktop/chat.html", role="gerente", me="gerente", convs=convs, ativa=ativa,
        ep_thread="pc_gerente_mensagens", ep_send="pc_gerente_mensagem_enviar",
    )


@app.route("/pc/gerente/mensagens/<int:cid>/enviar", methods=["POST"])
def pc_gerente_mensagem_enviar(cid):
    texto = (request.form.get("texto") or "").strip()
    if texto:
        store.add_mensagem(cid, "gerente", texto)
    return redirect(url_for("pc_gerente_mensagens", cid=cid))


if __name__ == "__main__":
    app.run(debug=True, port=5001)
