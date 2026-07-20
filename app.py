"""
PARTIU QUADRA — App do CLIENTE (quem aluga)

Aplicacao do jogador: busca quadras, reserva, paga e conversa com as arenas.
O painel do dono virou um app separado (pasta gerente/, porta 5001). Os dois
compartilham o pacote `shared` (dados + estado persistido), entao chat e
reservas ficam sincronizados.

Rodar:  python app.py     ->  http://localhost:5000
"""
from flask import Flask, render_template, request, redirect, url_for

from shared import data, store

app = Flask(__name__)
# URL do app do Gerente (para o botao "Virar parceiro" / troca de papel)
app.config["GERENTE_URL"] = "http://localhost:5001"

QUADRAS = data.QUADRAS
ESPORTES = data.ESPORTES
HORARIOS_PADRAO = data.HORARIOS_PADRAO
HERO_IMG = data.HERO_IMG
USER_LOC = data.USER_LOC


@app.context_processor
def inject_nav():
    """Badges dinamicos da sidebar (mensagens nao lidas do jogador)."""
    return {"nav": {
        "solicitacoes": store.count_solicitacoes(),
        "msg_jog": store.unread(store.convs_do_jogador(), "jogador"),
        "msg_ger": store.unread(store.convs_do_gerente(), "gerente"),
    }}


# ---------------------------------------------------------------------------
# PWA
# ---------------------------------------------------------------------------

@app.route("/manifest.webmanifest")
def manifest():
    resp = app.send_static_file("manifest.webmanifest")
    resp.headers["Content-Type"] = "application/manifest+json"
    return resp


@app.route("/sw.js")
def service_worker():
    resp = app.send_static_file("sw.js")
    resp.headers["Content-Type"] = "application/javascript"
    resp.headers["Service-Worker-Allowed"] = "/"
    resp.headers["Cache-Control"] = "no-cache"
    return resp


@app.route("/offline")
def offline():
    return render_template("offline.html")


# ---------------------------------------------------------------------------
# MOBILE — visao de quem aluga
# ---------------------------------------------------------------------------

@app.route("/")
def index():
    destaques = sorted(QUADRAS, key=lambda q: q["nota"], reverse=True)[:4]
    return render_template("index.html", esportes=ESPORTES, destaques=destaques, hero=HERO_IMG)


@app.route("/buscar")
def buscar():
    local = request.args.get("local") or "Goiania, GO"
    esporte = request.args.get("esporte", "")
    raio = request.args.get("raio", "5")
    resultados = QUADRAS
    if esporte:
        resultados = [q for q in resultados if q["esporte"] == esporte]
    resultados = sorted(resultados, key=lambda q: q["distancia"])
    return render_template("resultados.html", quadras=resultados, local=local,
                           esporte=esporte, raio=raio, esportes=ESPORTES, user_loc=USER_LOC)


@app.route("/quadra/<int:quadra_id>")
def quadra(quadra_id):
    q = data.get_quadra(quadra_id)
    if not q:
        return redirect(url_for("buscar"))
    return render_template("quadra.html", quadra=q, horarios=HORARIOS_PADRAO, dias=data.proximos_dias())


@app.route("/reservas")
def reservas():
    return render_template("reservas.html", reservas=data.reservas_jogador())


@app.route("/pagamento/<int:quadra_id>")
def pagamento(quadra_id):
    q = data.get_quadra(quadra_id)
    if not q:
        return redirect(url_for("buscar"))
    hora = request.args.get("hora", "19:00")
    dur = data.clamp_dur(request.args.get("dur", 1))
    preco = q["preco"]
    subtotal = preco * dur
    return render_template("pagamento.html", quadra=q, hora=hora, hora_fim=data.hora_somar(hora, dur),
                           dur=dur, preco=preco, subtotal=subtotal, total=round(subtotal, 2))


@app.route("/confirmado/<int:quadra_id>")
def confirmado(quadra_id):
    q = data.get_quadra(quadra_id)
    if not q:
        return redirect(url_for("buscar"))
    hora = request.args.get("hora", "19:00")
    dur = data.clamp_dur(request.args.get("dur", 1))
    return render_template("confirmado.html", quadra=q, hora=hora, hora_fim=data.hora_somar(hora, dur), dur=dur)


# ---------------------------------------------------------------------------
# DESKTOP (SaaS do cliente)
# ---------------------------------------------------------------------------

@app.route("/pc")
@app.route("/pc/explorar")
def pc_explorar():
    local = request.args.get("local") or "Goiania, GO"
    esporte = request.args.get("esporte", "")
    raio = request.args.get("raio", "5")
    resultados = QUADRAS
    if esporte:
        resultados = [q for q in resultados if q["esporte"] == esporte]
    resultados = sorted(resultados, key=lambda q: q["distancia"])
    return render_template("desktop/explorar.html", quadras=resultados, local=local,
                           esporte=esporte, raio=raio, esportes=ESPORTES, user_loc=USER_LOC)


@app.route("/pc/quadra/<int:quadra_id>")
def pc_quadra(quadra_id):
    q = data.get_quadra(quadra_id)
    if not q:
        return redirect(url_for("pc_explorar"))
    conv = store.conversa_jogador_arena(q["nome"])
    return render_template("desktop/quadra.html", quadra=q, horarios=HORARIOS_PADRAO,
                           dias=data.proximos_dias(), galeria=data.galeria_quadra(q),
                           chat_cid=(conv["id"] if conv else None))


@app.route("/pc/checkout/<int:quadra_id>")
def pc_checkout(quadra_id):
    q = data.get_quadra(quadra_id)
    if not q:
        return redirect(url_for("pc_explorar"))
    hora = request.args.get("hora", "19:00")
    dur = data.clamp_dur(request.args.get("dur", 1))
    preco = q["preco"]
    subtotal = preco * dur
    return render_template("desktop/checkout.html", quadra=q, hora=hora, hora_fim=data.hora_somar(hora, dur),
                           dur=dur, preco=preco, subtotal=subtotal, total=round(subtotal, 2))


@app.route("/pc/reserva/<int:quadra_id>")
def pc_reserva_ok(quadra_id):
    q = data.get_quadra(quadra_id)
    if not q:
        return redirect(url_for("pc_explorar"))
    hora = request.args.get("hora", "19:00")
    dur = data.clamp_dur(request.args.get("dur", 1))
    return render_template("desktop/reserva_ok.html", quadra=q, hora=hora,
                           hora_fim=data.hora_somar(hora, dur), dur=dur)


@app.route("/pc/reservas")
def pc_reservas():
    return render_template("desktop/reservas.html", reservas=data.reservas_jogador())


@app.route("/pc/favoritos")
def pc_favoritos():
    favs = [data.get_quadra(1), data.get_quadra(2), data.get_quadra(4)]
    return render_template("desktop/j_favoritos.html", quadras=favs)


@app.route("/pc/carteira")
def pc_carteira():
    transacoes = [
        {"data": "Hoje", "desc": "Reserva · Arena Bola na Rede", "valor": -126.00},
        {"data": "Ontem", "desc": "Cashback por indicação", "valor": 20.00},
        {"data": "28/06", "desc": "Reserva · Beach Point Arena", "valor": -94.50},
        {"data": "25/06", "desc": "Adição de saldo via Pix", "valor": 150.00},
        {"data": "20/06", "desc": "Reserva · Vôlei Sand Club", "valor": -73.50},
    ]
    return render_template("desktop/j_carteira.html", saldo=85.00, transacoes=transacoes)


@app.route("/pc/carteira/adicionar", methods=["GET", "POST"])
def pc_carteira_adicionar():
    if request.method == "POST":
        return redirect(url_for("pc_carteira", toast="Saldo adicionado via Pix"))
    return render_template("desktop/j_carteira_adicionar.html", saldo=85.00, valores=[30, 50, 100, 200])


@app.route("/pc/carteira/cartao", methods=["GET", "POST"])
def pc_carteira_cartao():
    if request.method == "POST":
        return redirect(url_for("pc_carteira", toast="Cartão adicionado com sucesso"))
    return render_template("desktop/j_carteira_cartao.html")


@app.route("/pc/carteira/cupom", methods=["GET", "POST"])
def pc_carteira_cupom():
    if request.method == "POST":
        codigo = (request.form.get("codigo") or "cupom").strip().upper()
        return redirect(url_for("pc_carteira", toast="Cupom %s aplicado com sucesso" % codigo))
    cupons = [
        {"codigo": "PARTIU10", "desc": "R$ 10 de bônus na sua próxima reserva"},
        {"codigo": "AMIGO20", "desc": "R$ 20 ao indicar um amigo que reservar"},
        {"codigo": "NOITE15", "desc": "15% de desconto em horários da noite"},
    ]
    return render_template("desktop/j_carteira_cupom.html", cupons=cupons)


@app.route("/pc/sair")
def pc_logout():
    return redirect(url_for("index"))


@app.route("/pc/perfil", methods=["GET", "POST"])
def pc_perfil():
    if request.method == "POST":
        return redirect(url_for("pc_perfil", toast="Perfil salvo com sucesso"))
    stats = {"jogos": 12, "reservas": 8, "favoritas": 3, "esporte_fav": "Futebol Society"}
    conquistas = [
        {"icon": "i-check", "title": "Pontual", "desc": "100% de presença", "on": True},
        {"icon": "i-flame", "title": "Veterano", "desc": "10+ jogos", "on": True},
        {"icon": "i-map", "title": "Explorador", "desc": "5 quadras diferentes", "on": True},
        {"icon": "i-star", "title": "Avaliador", "desc": "Faça 3 avaliações", "on": False},
    ]
    return render_template("desktop/j_perfil.html", stats=stats, esportes=ESPORTES,
                           proximo=data.reservas_jogador()[0], conquistas=conquistas)


@app.route("/pc/config", methods=["GET", "POST"])
def pc_config():
    if request.method == "POST":
        return redirect(url_for("pc_config", toast="Configurações salvas"))
    return render_template("desktop/j_config.html", esportes=ESPORTES)


# ---------------------------------------------------------------------------
# CHAT (lado do jogador)
# ---------------------------------------------------------------------------

@app.route("/pc/mensagens")
@app.route("/pc/mensagens/<int:cid>")
def pc_mensagens(cid=None):
    convs = store.convs_do_jogador()
    ativa = store.get_conversa(cid) if cid else (convs[0] if convs else None)
    return render_template("desktop/chat.html", role="jogador", me="jogador", convs=convs, ativa=ativa,
                           ep_thread="pc_mensagens", ep_send="pc_mensagem_enviar")


@app.route("/pc/mensagens/<int:cid>/enviar", methods=["POST"])
def pc_mensagem_enviar(cid):
    texto = (request.form.get("texto") or "").strip()
    if texto:
        store.add_mensagem(cid, "jogador", texto)
    return redirect(url_for("pc_mensagens", cid=cid))


if __name__ == "__main__":
    app.run(debug=True, port=5000)
