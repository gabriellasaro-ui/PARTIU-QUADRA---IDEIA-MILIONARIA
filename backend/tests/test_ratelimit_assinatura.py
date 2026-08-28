"""Todo endpoint com @limiter.limit precisa de `response` na assinatura.

O limitador roda com `headers_enabled=True`: ele escreve os cabecalhos de
limite NA RESPOSTA, e para isso procura um parametro chamado `response` na
assinatura da funcao. Sem ele, o endpoint estoura com 500 no primeiro acesso.

E ISSO NAO APARECE EM DESENVOLVIMENTO. `RATE_LIMIT_ENABLED=false` no .env e na
suite desliga o limitador, e o decorador vira um no-op — a funcao roda inteira
sem passar por ele. Foi assim que tres endpoints novos subiram para o servidor
com 262 testes verdes e responderam 500 no primeiro toque.

Por isso este teste le o CODIGO-FONTE em vez de chamar a rota: ligar o
limitador de verdade na suite mudaria o comportamento de todos os outros
testes (429 aleatorios conforme a ordem), e a falha aqui nao e de execucao —
e de assinatura. Um `ast` responde com certeza e sem efeito colateral.
"""
import ast
import pathlib

API = pathlib.Path(__file__).resolve().parent.parent / "app" / "api"


def _limitados(arquivo: pathlib.Path):
    """(nome, tem_response) de cada funcao decorada com @limiter.limit."""
    arvore = ast.parse(arquivo.read_text(encoding="utf-8"))
    for no in ast.walk(arvore):
        if not isinstance(no, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        for dec in no.decorator_list:
            alvo = dec.func if isinstance(dec, ast.Call) else dec
            nome = ""
            if isinstance(alvo, ast.Attribute):
                nome = alvo.attr
                if isinstance(alvo.value, ast.Name):
                    nome = f"{alvo.value.id}.{alvo.attr}"
            if nome != "limiter.limit":
                continue
            args = [a.arg for a in no.args.args + no.args.kwonlyargs]
            yield no.name, ("response" in args), ("request" in args)


def test_todo_endpoint_limitado_recebe_response():
    faltando = []
    encontrados = 0
    for arquivo in sorted(API.glob("*.py")):
        for nome, tem_response, tem_request in _limitados(arquivo):
            encontrados += 1
            if not tem_response:
                faltando.append(f"{arquivo.name}::{nome} (sem `response`)")
            if not tem_request:
                faltando.append(f"{arquivo.name}::{nome} (sem `request`)")

    # Se este numero cair para zero, o teste passou a nao medir nada — sinal de
    # que o decorador mudou de nome ou de forma.
    assert encontrados >= 5, f"esperava achar endpoints limitados, achei {encontrados}"
    assert not faltando, (
        "Endpoint com @limiter.limit sem os parametros que o limitador exige.\n"
        "Sem `response` ele estoura 500 em producao (headers_enabled=True), e a\n"
        "suite NAO pega isso porque RATE_LIMIT_ENABLED=false desliga o decorador:\n  "
        + "\n  ".join(faltando)
    )
