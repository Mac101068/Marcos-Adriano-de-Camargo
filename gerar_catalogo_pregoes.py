# -*- coding: utf-8 -*-
"""
Gera o CATÁLOGO DOS RECORTES POR PREGÃO para o seletor do navegador.

O navegador (React) não tem acesso ao disco: ele só enxerga o que a ponte
WebSocket (bot_mt5_ciclo15.py) devolve. Como a ponte exige o MetaTrader 5 no ar
(sem MT5 ela nem sobe), o catálogo ficava inacessível sempre que o terminal
estava fechado.

Este script quebra essa dependência: ele varre `data/pregoes/` e grava um JSON
estático em `interface_github/public/pregoes.json`, que o Vite serve tanto no
dev (http://localhost:3000/pregoes.json) quanto no build de produção (pasta
`public/` é copiada para `dist/`).

Fonte única da verdade: `backtest_ticks_reais.list_local_pregoes()` — a mesma
função usada pela ação WebSocket `LIST_LOCAL_PREGOES`. O navegador prefere o
catálogo da ponte (dados mais frescos) e usa este arquivo como base.

Uso:
    .\\venv\\Scripts\\python.exe gerar_catalogo_pregoes.py
"""

import json
import os
from datetime import datetime

import backtest_ticks_reais

BASE_DIR = r"C:\Users\Lucas\Documents\RoboFluxoB3"

DESTINO = os.path.join(BASE_DIR, "interface_github", "public", "pregoes.json")

# Símbolos que o catálogo cobre: o vigente de cada ativo e a série contínua do
# Bitcoin (prefixo `bit_cont` no disco).
SIMBOLOS = ["WINZ26", "WDOZ26", "BITX26", "BIT$"]


def montar_catalogo():
    """Monta {símbolo: [pregões]} a partir dos recortes gravados em disco."""
    catalogo = {}

    for simbolo in SIMBOLOS:
        try:
            pregoes = backtest_ticks_reais.list_local_pregoes(simbolo)
        except Exception as exc:  # pragma: no cover - defensivo
            print(f"  ⚠️  {simbolo}: falha ao listar ({exc})")
            pregoes = []

        catalogo[simbolo.upper()] = pregoes
        print(f"  📦 {simbolo.upper()}: {len(pregoes)} pregões")

    return catalogo


def main():
    print("=" * 78)
    print("📚 Gerando catálogo de pregões para o seletor do navegador")
    print("=" * 78)

    catalogo = montar_catalogo()

    conteudo = {
        "generatedAt": datetime.now().isoformat(timespec="seconds"),
        "symbols": catalogo,
    }

    os.makedirs(os.path.dirname(DESTINO), exist_ok=True)

    with open(DESTINO, "w", encoding="utf-8") as arquivo:
        json.dump(conteudo, arquivo, indent=2, ensure_ascii=False)

    total = sum(len(lista) for lista in catalogo.values())
    print(f"✅ Catálogo gravado em {DESTINO} ({total} pregões no total)")


if __name__ == "__main__":
    main()
