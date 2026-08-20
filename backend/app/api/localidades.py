"""Estados e municipios do Brasil (fonte: IBGE).

Servido daqui, e nao consultado no IBGE a cada uso, por tres motivos: o app
para de depender de um servico de terceiro para preencher um campo de
cadastro; o navegador nao faz request para fora (nao vaza IP de quem se
cadastra); e a lista inteira vira 83 KB de arquivo estatico em vez de 2,4 MB
baixados toda vez.

A troca e que a lista congela na data da geracao. Municipio novo no Brasil e
raro (o ultimo foi em 2013 antes de Boa Esperanca do Norte); quando houver,
basta regerar o JSON.
"""
import json
from functools import lru_cache
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query, status

router = APIRouter(prefix="/api/localidades", tags=["localidades"])

_ARQUIVO = Path(__file__).resolve().parent.parent / "data" / "municipios.json"


@lru_cache(maxsize=1)
def _dados() -> dict:
    return json.loads(_ARQUIVO.read_text(encoding="utf-8"))


@router.get("/estados")
def estados():
    return {"estados": _dados()["estados"]}


@router.get("/estados/{uf}/cidades")
def cidades(uf: str, q: str = Query("", max_length=80)):
    cidades_da_uf = _dados()["cidades"].get(uf.strip().upper())
    if cidades_da_uf is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="UF não encontrada")
    termo = q.strip().casefold()
    if termo:
        # casefold e nao lower: pega maiuscula acentuada tambem.
        cidades_da_uf = [c for c in cidades_da_uf if termo in c.casefold()]
    return {"cidades": cidades_da_uf}
