from pydantic import BaseModel


class Quadra(BaseModel):
    id: int
    nome: str
    esporte: str
    bairro: str
    distancia: float
    nota: float
    avaliacoes: int
    preco: float
    foto: str
    tags: list[str]
    lat: float
    lng: float


class QuadraDetalhada(Quadra):
    galeria: list[str] = []
    horarios: list[dict] = []
    dias: list[dict] = []
    avaliacoes_mock: list[dict] = []


class Horario(BaseModel):
    hora: str
    status: str
