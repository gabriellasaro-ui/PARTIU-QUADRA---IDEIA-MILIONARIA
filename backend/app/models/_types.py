"""Tipos compartilhados dos models, compativeis com Postgres e SQLite.

JSONB no Postgres; no SQLite (testes) cai para JSON generico.
"""
from sqlalchemy import JSON
from sqlalchemy.dialects.postgresql import JSONB as _PG_JSONB

JSONVariant = JSON().with_variant(_PG_JSONB, "postgresql")
