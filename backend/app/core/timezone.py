"""Fuso do produto: America/Sao_Paulo.

Toda regra que depende de "agora" (aberta neste momento, geracao de
horarios) usa este relogio — nunca datetime.now() puro.
"""
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from .config import settings

TZ = ZoneInfo(settings.timezone)


def now_local() -> datetime:
    return datetime.now(TZ)


def local_date_today() -> str:
    return now_local().strftime("%Y-%m-%d")


def utc_now() -> datetime:
    return datetime.now(timezone.utc)
