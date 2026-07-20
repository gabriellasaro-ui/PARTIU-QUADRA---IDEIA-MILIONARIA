"""Pacote compartilhado entre os apps Cliente e Gerente do Partiu Quadra.

- data.py    : constantes, dados-semente (mock) e helpers puros (sem estado).
- store.py   : estado MUTAVEL persistido em JSON (reservas + conversas), para
               que os dois apps (processos separados) fiquem sincronizados.
- domain.py  : lógica que compõe data + store (agenda, dashboard do gerente).
"""
