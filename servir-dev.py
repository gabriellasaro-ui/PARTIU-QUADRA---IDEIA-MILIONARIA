"""Servidor estatico de desenvolvimento — sem cache.

`python -m http.server` nao manda Cache-Control. Sem ele o navegador aplica
cache heuristico: guarda CSS e JS por conta propria e continua servindo a versao
antiga depois de uma alteracao. O sintoma e cruel porque nao parece cache — o
HTML novo chega, o JS velho nao entende, e a tela quebra de um jeito que parece
bug de codigo. Custou duas rodadas de "ta bugado" que eram so arquivo velho.

`no-store` resolve de vez em desenvolvimento. Em producao vale o contrario:
cache longo com hash no nome do arquivo.
"""
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class SemCache(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, *args):
        pass  # o console fica utilizavel


if __name__ == "__main__":
    porta = int(sys.argv[1]) if len(sys.argv) > 1 else 5175
    raiz = sys.argv[2] if len(sys.argv) > 2 else "."
    handler = partial(SemCache, directory=raiz)
    print(f"servindo {raiz} em http://0.0.0.0:{porta} (sem cache)")
    ThreadingHTTPServer(("0.0.0.0", porta), handler).serve_forever()
