"""Configuracao de logging (Fase 12).

Uma funcao `setup_logging` chamada no boot do app (main.py). Usa apenas a
stdlib: formatter chave=valor (facil de grep/parse) com nivel controlado por
`LOG_LEVEL`. Configurado UMA vez; chamadas subsequentes sao no-ops.
"""
import logging
import sys

_CONFIGURED = False


class _KeyValueFormatter(logging.Formatter):
    def format(self, record):
        base = {
            "ts": self.formatTime(record, "%Y-%m-%dT%H:%M:%S%z"),
            "level": record.levelname,
            "logger": record.name,
            "msg": record.getMessage(),
        }
        if record.exc_info:
            base["exc"] = self.formatException(record.exc_info)
        extra = getattr(record, "extra_fields", None)
        if extra:
            base.update(extra)
        return " ".join(f"{k}={v!r}" for k, v in base.items())


def setup_logging(level: str = "INFO") -> None:
    global _CONFIGURED
    if _CONFIGURED:
        return
    _CONFIGURED = True

    root = logging.getLogger()
    root.setLevel(getattr(logging, str(level).upper(), logging.INFO))
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(_KeyValueFormatter())
    root.handlers[:] = [handler]


def log_extra(fields: dict) -> dict:
    """`logging.getLogger(name).info("...", extra={"extra_fields": {...}})`."""
    return {"extra_fields": fields}
