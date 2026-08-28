"""Todo import de terceiro do codigo de producao precisa estar no requirements.

O `httpx` ficou de fora e o modo de falhar foi o pior possivel: na maquina de
desenvolvimento ele entra na venv DE CARONA com o TestClient do pytest, entao
tudo passava aqui — suite verde, navegador funcionando. No container, que
instala so o requirements.txt, o `import httpx` estourava e TRES rotas
respondiam 500: busca de CEP, consulta de CNPJ e envio do codigo de
verificacao.

Nenhuma delas aparece nos testes com o servico real, porque os tres sao
chamadas externas — entao nem um teste de integracao pegaria. O que pega e
olhar a lista de imports contra a lista de dependencias, que e o que este
arquivo faz.

Dependencia de producao nao pode depender de ferramenta de teste para existir.
"""
import ast
import pathlib
import sys

RAIZ = pathlib.Path(__file__).resolve().parent.parent
APP = RAIZ / "app"

#: Nome do import -> nome do pacote no PyPI, quando diferem.
PACOTE = {
    "jwt": "pyjwt",
    "google": "google-auth",
    "firebase_admin": "firebase-admin",
    "pydantic_settings": "pydantic-settings",
    "email_validator": "email-validator",
    # starlette vem dentro do fastapi; nao tem linha propria de proposito.
    "starlette": "fastapi",
}


def _imports_de_terceiro():
    vistos: dict[str, set[str]] = {}
    padrao = set(sys.stdlib_module_names)
    for arquivo in APP.rglob("*.py"):
        if "__pycache__" in str(arquivo):
            continue
        arvore = ast.parse(arquivo.read_text(encoding="utf-8"))
        for no in ast.walk(arvore):
            nomes = []
            if isinstance(no, ast.Import):
                nomes = [a.name.split(".")[0] for a in no.names]
            elif isinstance(no, ast.ImportFrom) and no.level == 0 and no.module:
                nomes = [no.module.split(".")[0]]
            for nome in nomes:
                if nome in padrao or nome == "app":
                    continue
                vistos.setdefault(nome, set()).add(
                    str(arquivo.relative_to(RAIZ)).replace("\\", "/")
                )
    return vistos


def _declarados() -> set[str]:
    """Os pacotes DECLARADOS, lendo so as linhas de dependencia.

    Procurar a palavra no arquivo inteiro nao serve: o proprio comentario que
    explica por que o httpx esta ali contem "httpx", e o teste passava mesmo
    com a linha removida. Descobri isso tentando quebra-lo de proposito — sem
    esse passo, o teste teria ficado no repositorio provando nada.
    """
    nomes = set()
    for linha in (RAIZ / "requirements.txt").read_text(encoding="utf-8").splitlines():
        linha = linha.split("#", 1)[0].strip()
        if not linha:
            continue
        # `pacote==1.2.3`, `pacote[extra]==1.2.3`, `pacote>=1.0`
        nome = linha.split("==")[0].split(">=")[0].split("<")[0].split("[")[0]
        nomes.add(nome.strip().lower())
    return nomes


def test_todo_import_de_producao_esta_no_requirements():
    req = _declarados()
    faltando = []
    for nome, arquivos in sorted(_imports_de_terceiro().items()):
        pacote = PACOTE.get(nome, nome).lower()
        if pacote not in req:
            faltando.append(f"{nome} (pacote `{pacote}`) — usado em {', '.join(sorted(arquivos))}")

    assert not faltando, (
        "Import de terceiro sem linha no requirements.txt.\n"
        "Aqui ele pode existir de carona em outra dependencia (o httpx entra com\n"
        "o TestClient do pytest); no container, que instala so este arquivo, o\n"
        "import estoura e a rota responde 500:\n  " + "\n  ".join(faltando)
    )
