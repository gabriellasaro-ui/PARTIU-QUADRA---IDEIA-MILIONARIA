# Qadras — Plataforma de Reserva de Quadras Esportivas

Plataforma para encontrar e alugar quadras esportivas, com pagamento no app e chat entre jogador e dono.

## Arquitetura

```
/
├── backend/          → FastAPI (API REST)
│   ├── app/
│   │   ├── api/      → Endpoints (quadras, reservas, mensagens, etc.)
│   │   ├── core/     → Dados, estado, lógica de domínio
│   │   ├── schemas/  → Pydantic DTOs
│   │   └── main.py   → FastAPI app
│   ├── requirements.txt
│   └── state.json    → Dados persistidos
│
├── www/              → SPA completa servida pelo backend (HTML + CSS + JS vanilla)
│   ├── assets/       → CSS, JS, ícones, vendor
│   ├── components/   → Fragmentos HTML reutilizáveis
│   ├── pages/        → Conteúdo das telas
│   ├── services/     → API client, auth, storage
│   ├── config/       → Rotas, constantes
│   ├── index.html    → Mobile app (PWA)
│   ├── pc.html       → Desktop app (jogador)
│   └── dashboard.html→ Desktop app (gerente)
│
├── www-usuario/      → Frontend do jogador (webDir do Capacitor)
├── www-gerente/      → Frontend do gerente
├── www-admin/        → Painel administrativo
├── capacitor.config.json
└── package.json
```

## Como rodar

```bash
pip install -r backend/requirements.txt

# Backend FastAPI (porta 8000)
cd backend
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

# Frontend (http://localhost:8095 — alternativa para dev sem FastAPI)
python -m http.server 8095 --bind 127.0.0.1 --directory www
```

- **Mobile**: http://localhost:8000 (ou http://localhost:8095 sem backend)
- **Desktop (jogador)**: http://localhost:8000/pc.html
- **Dashboard (gerente)**: http://localhost:8000/dashboard.html

## Funcionalidades

- Explorar quadras por esporte e localização
- Calendário interativo com disponibilidade
- Fluxo de reserva com etapas (horário → pagamento → aprovação)
- Chat em tempo real entre jogador e arena
- Dashboard do gerente com KPIs, heatmap e agenda
- Carteira virtual, cupons e extrato
- PWA instalável (service worker + manifest)
- Compatível com Capacitor (Android/iOS)

## Tecnologias

- **Backend**: FastAPI, Pydantic
- **Frontend**: HTML, CSS, JavaScript vanilla (SPA)
- **Mobile**: Capacitor, PWA
- **Dados**: JSON file (state.json) — preparado para PostgreSQL

## Migração de Flask para FastAPI

O projeto foi migrado de Flask + Jinja2 para FastAPI + SPA vanilla.
O backend fornece apenas JSON via API REST. O frontend é totalmente
independente e pode ser substituído por React, Vue ou qualquer framework.
