# Plano de Arquitetura: HTML + CSS + JavaScript + Capacitor + FastAPI

## Objetivo

Desenvolver uma única aplicação capaz de atender:

-   Web
-   Android
-   iOS

utilizando a mesma base de código do frontend.

## Stack

  Camada     Tecnologia
  ---------- ------------------------------
  Frontend   HTML + CSS + JavaScript
  Mobile     Capacitor
  Web        Mesmo frontend
  Backend    FastAPI
  Banco      PostgreSQL
  Cache      Redis
  ORM        SQLAlchemy
  Deploy     Docker + EasyPanel + Traefik

## Arquitetura

``` text
                 Usuário
                     │
        ┌────────────┼────────────┐
        │            │            │
        ▼            ▼            ▼
      Web        Android       iOS
        │            │            │
        └────────────┼────────────┘
                     │
           HTML + CSS + JavaScript
                     │
              Capacitor (Mobile)
                     │
                 HTTPS / REST
                     │
                  FastAPI
                     │
       ┌─────────────┼─────────────┐
       ▼             ▼             ▼
 PostgreSQL       Redis        Storage
```

## Estrutura do projeto

``` text
meu-app/

backend/
├── app/
├── models/
├── repositories/
├── services/
├── schemas/
├── Dockerfile

frontend/
├── index.html
├── login.html
├── dashboard.html
├── css/
├── js/
│   ├── api.js
│   ├── auth.js
│   ├── utils.js
│   ├── router.js
│   ├── pages/
│   ├── services/
│   └── components/
├── assets/
├── android/
├── ios/
├── capacitor.config.ts
└── package.json
```

## Organização do JavaScript

Separar responsabilidades:

-   api.js
-   auth.js
-   storage.js
-   http.js
-   config.js
-   utils.js
-   pages/
-   services/
-   components/

Evitar arquivos gigantes contendo toda a lógica da aplicação.

## Comunicação

``` text
JavaScript
    ↓
fetch()
    ↓
FastAPI
    ↓
PostgreSQL
```

Centralizar chamadas HTTP em `api.js`.

## Capacitor

O Capacitor reutiliza o frontend existente:

``` text
HTML + CSS + JavaScript
        ↓
    Capacitor
        ↓
 Android / iOS
```

Na Web, o mesmo frontend é servido normalmente.

## Recursos nativos

Através dos plugins do Capacitor:

-   Câmera
-   GPS
-   Biometria
-   Arquivos
-   Notificações Push
-   Clipboard
-   Compartilhamento

## Roadmap

1.  Modelar domínio
2.  Desenvolver o FastAPI
3.  Configurar PostgreSQL
4.  Implementar autenticação JWT
5.  Criar API REST
6.  Organizar frontend HTML/CSS/JS
7.  Integrar com a API
8.  Disponibilizar versão Web
9.  Integrar Capacitor
10. Gerar Android
11. Gerar iOS
12. Adicionar recursos nativos
13. Testes
14. Docker + EasyPanel
15. Publicação Web
16. Publicação na Play Store
17. Publicação na App Store

## Princípios

-   Uma única base de código para Web, Android e iOS.
-   Toda regra de negócio permanece no FastAPI.
-   Frontend responsável apenas pela interface e comunicação com a API.
-   Reaproveitamento máximo do projeto atual em HTML, CSS e JavaScript.
