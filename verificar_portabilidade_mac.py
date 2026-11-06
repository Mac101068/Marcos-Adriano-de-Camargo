"""Bancada de portabilidade: roda a validação como se estivesse no macOS.

Este projeto tem duas máquinas (Windows com MT5 e Mac sem MT5). O risco silencioso é
um teste passar aqui e ser INJOGÁVEL lá — porque o `import MetaTrader5` no topo de um
módulo qualquer derruba o processo inteiro num sistema onde o pacote não existe.

Aqui o import MetaTrader5 (e o da ponte, que depende dele) é bloqueado no meta_path e
o teste roda igual. Se a guarda estiver errada, ISTO FALHA em vez de pular -- que é
exatamente o que aconteceria no outro computador.

Uso:
    python verificar_portabilidade_mac.py            # roda o replay
    python verificar_portabilidade_mac.py test_paridade_regras.py

Verde = exit 0 com os pulos contados e justificados. Amarelo = pulou o que deveria
rodar de verdade; ler as linhas PULO antes de comemorar.
"""
from __future__ import annotations

import importlib.abc
import runpy
import sys
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):  # Windows entrega cp850; o relatório tem acento
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")

AQUI = Path(__file__).resolve().parent
BLOQUEADOS = {"MetaTrader5", "bot_mt5_ciclo15"}
ALVOS_PADRAO = ["test_replay_dados.py"]


class SemMT5(importlib.abc.MetaPathFinder):
    """Faz o interpretador achar que o MetaTrader5 não está instalado."""

    def find_spec(self, fullname, path=None, target=None):
        if fullname in BLOQUEADOS:
            raise ImportError(f"[simulacao macOS] No module named {fullname!r}")
        return None


def main() -> int:
    alvos = sys.argv[1:] or ALVOS_PADRAO
    sys.meta_path.insert(0, SemMT5())
    for nome in alvos:
        alvo = AQUI / nome
        print(f"\n=== {nome} sem MetaTrader5 ===")
        runpy.run_path(str(alvo), run_name="__main__")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
