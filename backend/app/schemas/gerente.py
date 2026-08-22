"""DTOs do painel do gerente (Fase 8).

Todos os contratos sao camelCase (padrao dos outros modulos) e os valores
monetarios chegam em reais (float) — o frontend do gerente le `valor`/`bruto`
assim. Os centavos ficam no banco.
"""
from datetime import date
from pydantic import BaseModel, Field, field_validator
from typing import Optional


class BookingCreate(BaseModel):
    courtId: str
    date: str  # YYYY-MM-DD
    hora: str = "19:00"
    dur: int = 1
    clientName: str = ""
    clientPhone: str = ""
    clientEmail: str = ""
    valor: Optional[float] = None  # override opcional do valor (reserva manual)


class MensalistaCreate(BaseModel):
    courtId: str
    date: str  # YYYY-MM-DD (primeira sessao)
    hora: str = "19:00"
    dur: int = 1
    dia: int = Field(ge=0, le=6)  # dia da semana 0=segunda..6=domingo
    clientName: str = ""
    clientPhone: str = ""
    clientEmail: str = ""


#: Quantas fotos a quadra precisa ter para entrar na vitrine.
#:
#: Uma foto so nao vende quadra nenhuma: quem escolhe onde jogar quer ver o
#: piso, a iluminacao, o vestiario e o entorno. Com uma imagem, o anuncio e uma
#: promessa sem prova, e a arena que caprichou fica igual a que nao caprichou.
#:
#: O numero e regra de PRODUTO e mora aqui, e nao espalhado pela tela: mudar de
#: ideia depois deve ser trocar esta linha.
MIN_FOTOS_QUADRA = 5


def _validar_fotos(fotos: list[str]) -> list[str]:
    limpas = [f.strip() for f in (fotos or []) if isinstance(f, str) and f.strip()]
    if len(limpas) < MIN_FOTOS_QUADRA:
        raise ValueError(
            f"Envie pelo menos {MIN_FOTOS_QUADRA} fotos da quadra "
            f"(você enviou {len(limpas)})"
        )
    for f in limpas:
        # O conteudo vem do painel e termina num `src` na tela do jogador.
        if not (f.startswith("data:image/") or f.startswith(("http://", "https://"))):
            raise ValueError("Formato de imagem invalido")
    return limpas


class CourtCreate(BaseModel):
    nome: str
    esporte: str
    preco: float
    precoMensalista: Optional[float] = None
    descricao: Optional[str] = None
    abertura: str = "08:00"
    fechamento: str = "23:00"
    duracaoMinima: int = 1
    comodidades: list[str] = []
    fotos: list[str] = []

    @field_validator("fotos")
    @classmethod
    def _fotos_suficientes(cls, v):
        return _validar_fotos(v)


class CourtUpdate(BaseModel):
    """PATCH: campo ausente significa "nao mexe".

    `fotos` so e validado quando VEM no corpo. Sem essa distincao, salvar o
    preco de uma quadra recusaria o pedido inteiro por falta de fotos que
    ninguem estava tentando mudar.
    """

    nome: Optional[str] = None
    esporte: Optional[str] = None
    preco: Optional[float] = None
    precoMensalista: Optional[float] = None
    descricao: Optional[str] = None
    abertura: Optional[str] = None
    fechamento: Optional[str] = None
    duracaoMinima: Optional[int] = None
    comodidades: Optional[list[str]] = None
    fotos: Optional[list[str]] = None
    ativa: Optional[bool] = None
    visivel: Optional[bool] = None
    destaque: Optional[bool] = None

    @field_validator("fotos")
    @classmethod
    def _fotos_suficientes(cls, v):
        if v is None:
            return v
        return _validar_fotos(v)


class AvaliacaoReply(BaseModel):
    resposta: str = Field(min_length=1)


class CouponCreate(BaseModel):
    codigo: str = Field(min_length=3, max_length=30)
    descontoPercent: int = Field(ge=1, le=100)
    courtId: Optional[str] = None
    expiraEm: Optional[str] = None  # YYYY-MM-DD
    maxUsos: Optional[int] = None


class ArenaProfileUpdate(BaseModel):
    nome: Optional[str] = None
    descricao: Optional[str] = None
    telefone: Optional[str] = None
    email: Optional[str] = None
    pixChave: Optional[str] = None
    endereco: Optional[str] = None
    cidade: Optional[str] = None
    estado: Optional[str] = None
    #: Data URL ou URL http. String vazia remove a logo e volta para a inicial
    #: do nome da arena.
    logo: Optional[str] = None


class ArenaConfigUpdate(BaseModel):
    notificaReserva: Optional[bool] = None
    notificaPagamento: Optional[bool] = None
    notificaAvaliacao: Optional[bool] = None
    notificaResumo: Optional[bool] = None


class DesativacaoBody(BaseModel):
    motivo: str = Field(min_length=3)
    periodo: Optional[str] = None  # ex.: "15 dias" / "definitivo"
