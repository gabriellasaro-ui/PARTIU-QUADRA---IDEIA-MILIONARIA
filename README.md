# 🏟️ Partiu Quadra — Mockup

Plataforma para **encontrar e alugar quadras esportivas**, com pagamento no app e chat entre jogador e dono. A plataforma fica com **5% de comissão** no repasse do dono.

Feito em **Python (Flask) + HTML + CSS**. Tema **verde e branco**.

## 🧩 Arquitetura — dois apps separados

O projeto foi separado em **duas aplicações independentes** que compartilham um módulo comum:

```
PARTIU QUADRA/
├── app.py              → App do CLIENTE (jogador)   · porta 5000
├── gerente/
│   ├── app.py          → App do GERENTE (dono)      · porta 5001
│   └── templates/      → telas do gerente (desktop + mobile)
├── shared/             → MÓDULO COMPARTILHADO pelos dois apps
│   ├── data.py         → constantes, dados-semente e helpers puros
│   ├── store.py        → estado mutável persistido em JSON (state.json)
│   └── domain.py       → agenda + dashboard (compõe data + store)
├── templates/          → telas do cliente (desktop + mobile)
└── static/             → CSS/JS/ícones (compartilhados pelos dois apps)
```

**Por que `shared/`?** Como os dois apps rodam em processos separados, guardar o
estado em memória não sincroniza. O `store.py` persiste **reservas e conversas**
num arquivo `shared/state.json` que os dois leem e escrevem — assim uma reserva
**aprovada no Gerente** e uma **mensagem enviada no Cliente** aparecem dos dois
lados na hora. (Em produção, isso vira um banco de dados.)

## ▶️ Como rodar (os dois ao mesmo tempo)

```bash
pip install flask

# terminal 1 — app do cliente
python app.py           # http://localhost:5000

# terminal 2 — app do gerente
python gerente/app.py   # http://localhost:5001
```

| App | URL | Descrição |
|-----|-----|-----------|
| **Cliente** | http://localhost:5000/pc | Explorar, reservar, pagar, carteira, chat |
| **Cliente (mobile)** | http://localhost:5000 | Versão celular (PWA) |
| **Gerente** | http://localhost:5001/pc/gerente | Dashboard, reservas, agenda, financeiro, chat |
| **Gerente (mobile)** | http://localhost:5001/gerente | Painel no celular |

Os links de troca de papel ("Jogador ↔ Gerente", "Virar parceiro") pulam de um
app para o outro. Os endereços ficam em `app.config["GERENTE_URL"]` /
`app.config["CLIENTE_URL"]` (dá para sobrescrever por variável de ambiente).

## Demonstração do fluxo sincronizado
1. No **Gerente** (5001), vá em **Reservas** e **aprove** a solicitação do Gabriel.
2. No **Cliente** (5000), abra **Mensagens** — a confirmação chegou no chat.
3. Responda pelo Cliente e veja a resposta aparecer no chat do Gerente.

> ⚠️ Mockup: dados fictícios, sem login/banco/pagamento reais. Para recomeçar do
> zero: `python -c "from shared import store; store.reset()"`.

## Próximos passos (produto real)
- Login/cadastro e sessão (hoje o usuário logado é fixo)
- Banco de dados no lugar do `state.json`
- Gateway de pagamento (Pix/cartão) com split automático dos 5%
- Cliente cria a reserva → notifica o dono; notificações push; avaliações
