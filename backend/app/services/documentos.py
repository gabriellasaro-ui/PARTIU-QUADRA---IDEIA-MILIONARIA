"""CNPJ: o digito que se confere aqui, e o que so a Receita sabe.

DUAS CAMADAS, e elas respondem perguntas diferentes.

`cnpj_valido` e aritmetica pura: pega erro de digitacao sem depender de rede.
Nao prova que a empresa existe — 11.111.111/1111-80 passa no calculo e nao
existe. Serve para nao mandar lixo a consulta e para avisar a pessoa na hora.

`consultar_cnpj` pergunta a BrasilAPI, no mesmo molde do ViaCEP em
`api/localidades.py`: httpx com timeout curto, cache em memoria e FALHA EM
SILENCIO UTIL. Servico de terceiro fora do ar nao pode travar um cadastro.

O que essa consulta traz e o ponto todo: o CNAE. O codigo 9311-5/00 — gestao de
instalacoes esportivas — e o sinal mais barato que existe de que aquilo e mesmo
uma quadra. Ele vai para a FICHA e aparece para quem analisa; nunca recusa
sozinho, porque quadra registrada no CNPJ do restaurante da familia e comum
demais para virar recusa automatica.
"""
import logging
import re

logger = logging.getLogger(__name__)

#: Gestao de instalacoes esportivas. O CNAE que a gente ESPERA ver.
CNAE_INSTALACOES_ESPORTIVAS = "9311-5/00"

_SO_DIGITOS = re.compile(r"\D")


def limpar_cnpj(valor: str | None) -> str:
    """Sem mascara. Com ela o mesmo CNPJ entra de duas formas e a checagem de
    duplicado deixa de funcionar."""
    return _SO_DIGITOS.sub("", valor or "")


def cnpj_valido(valor: str | None) -> bool:
    cnpj = limpar_cnpj(valor)
    if len(cnpj) != 14:
        return False
    # Todos os digitos iguais passam na conta dos verificadores (o resto da 0
    # nos dois), entao precisam de corte explicito. E o caso que quem testa
    # digita primeiro: 00000000000000.
    if cnpj == cnpj[0] * 14:
        return False

    def digito(base: str) -> str:
        pesos = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2][-len(base):]
        soma = sum(int(d) * p for d, p in zip(base, pesos))
        resto = soma % 11
        return "0" if resto < 2 else str(11 - resto)

    return cnpj[12] == digito(cnpj[:12]) and cnpj[13] == digito(cnpj[:13])


#: Cache SO DE ACERTO. Ver o porque em `_buscar`.
_CACHE: dict[str, dict] = {}


def _buscar(cnpj: str):
    """Consulta a BrasilAPI, guardando apenas o que deu certo.

    ⚠️ NAO usar `@lru_cache` aqui, e a razao e concreta: o decorador guarda o
    retorno QUALQUER QUE SEJA ELE, inclusive o `None` de uma falha. Um tropeco
    de rede na primeira consulta congelava aquele CNPJ como "nao da para
    consultar" pelo resto da vida do processo — e o sintoma era o pior tipo:
    o campo nunca mais preenchia, sem erro nenhum aparecendo.

    Foi o que aconteceu no primeiro teste de ponta a ponta. O mesmo defeito ja
    esta documentado em `services/localidades.js` para a lista de estados; aqui
    ele voltou por outro caminho.
    """
    if cnpj in _CACHE:
        return _CACHE[cnpj]

    import httpx

    try:
        with httpx.Client(timeout=6.0) as cliente:
            r = cliente.get(f"https://brasilapi.com.br/api/cnpj/v1/{cnpj}")
        if r.status_code != 200:
            # 404 e resposta legitima ("nao existe"), mas nao vale guardar: um
            # CNPJ recem-aberto passa a existir dias depois.
            return None
        dados = r.json()
    except Exception as erro:
        # Silencio para quem cadastra, log para quem investiga: sem a linha
        # abaixo, "a consulta nunca preenche nada" viraria um misterio.
        logger.warning("Consulta de CNPJ falhou (%s): %s", cnpj, erro)
        return None

    if len(_CACHE) > 256:
        _CACHE.clear()
    _CACHE[cnpj] = dados
    return dados


def consultar_cnpj(valor: str | None) -> dict | None:
    """Razao social, situacao e CNAE — ou None se nao deu para saber.

    None nao e erro: e "nao consegui perguntar". Quem chama segue em frente.
    """
    cnpj = limpar_cnpj(valor)
    if not cnpj_valido(cnpj):
        return None
    dados = _buscar(cnpj)
    if not dados:
        return None

    cnae = str(dados.get("cnae_fiscal") or "").strip()
    descricao = (dados.get("cnae_fiscal_descricao") or "").strip()
    return {
        "cnpj": cnpj,
        "razaoSocial": (dados.get("razao_social") or "").strip(),
        "nomeFantasia": (dados.get("nome_fantasia") or "").strip(),
        "situacao": (dados.get("descricao_situacao_cadastral") or "").strip(),
        "cnae": cnae,
        "cnaeDescricao": descricao,
        # O sinal que interessa a quem analisa, ja mastigado. A BrasilAPI
        # devolve o CNAE sem mascara (9311500), entao a comparacao e por
        # digito e nao pelo codigo formatado.
        "cnaeEsportivo": cnae.replace("-", "").replace("/", "") == "9311500",
        "cidade": (dados.get("municipio") or "").strip(),
        "estado": (dados.get("uf") or "").strip(),
    }
