from pydantic import BaseModel
from typing import Optional


class Dashboard(BaseModel):
    kpis: list[dict]
    chart: dict
    heat: list[dict]
    heat_dias: list[str]
    faixas: list[dict]
    insights: list[dict]
    bruto: float
    comissao: float
    repasse: float
    ticket_medio: float
    ocupacao: int
    faturamento_hoje: float
    novos_clientes: int
    reservas_semana: int
    reservas: list[dict]
    horarios: list[dict]
    taxa: int
    data_hoje: str
    reservas_hoje: int


class Agenda(BaseModel):
    colunas: list[dict]
    horas: list[int]
    hour_h: int
    altura: int
    offset: int
    rotulo: str


class QuadraForm(BaseModel):
    nome: Optional[str] = None
    esporte: Optional[str] = None
    bairro: Optional[str] = None
    preco: Optional[float] = None
