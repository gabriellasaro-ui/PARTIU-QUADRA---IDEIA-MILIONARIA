"""Seed idempotente — popula dados demo apenas se as tabelas estiverem vazias.

Executado pelo entrypoint do container no primeiro boot (e pode ser chamado
manualmente com `python -m app.seed`). Nunca duplica dados em redeploys.
"""
import uuid
from datetime import datetime, timezone

from sqlalchemy import select

from .auth.security import hash_password
from .core.database import SessionLocal
from .models import ROLE_ADMIN, ROLE_GERENTE, ROLE_JOGADOR, User

DEMO_PASSWORD = "qadras123"

DEMO_USERS = [
    {
        "email": "gabriel@email.com",
        "name": "Gabriel Lisboa",
        "role": ROLE_JOGADOR,
        "provider": "password",
        "city": "Goiania",
        "state": "GO",
    },
    {
        "email": "dono@arenabolanarede.com.br",
        "name": "Dono Arena Bola na Rede",
        "role": ROLE_GERENTE,
        "provider": "password",
        "city": "Goiania",
        "state": "GO",
    },
    {
        "email": "admin@qadras.com.br",
        "name": "Admin Qadras",
        "role": ROLE_ADMIN,
        "provider": "password",
        "city": "Goiania",
        "state": "GO",
    },
]


def seed() -> int:
    with SessionLocal() as db:
        already = db.execute(select(User.id).limit(1)).first()
        if already:
            return 0

        now = datetime.now(timezone.utc)
        for data in DEMO_USERS:
            db.add(
                User(
                    id=uuid.uuid4(),
                    last_active_at=now,
                    password_hash=hash_password(DEMO_PASSWORD),
                    **data,
                )
            )
        db.commit()
        return len(DEMO_USERS)


if __name__ == "__main__":
    created = seed()
    if created:
        print(f"seed: {created} usuarios criados")
    else:
        print("seed: tabela nao vazia, nada feito")
