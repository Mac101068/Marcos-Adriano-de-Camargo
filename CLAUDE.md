# RoboFluxoB3

As instruções do projeto estão em [`AGENTS.md`](AGENTS.md) — leia antes de qualquer mudança.

Resumo: robô Renko de fluxo B3 (Python, `bot_mt5_ciclo15.py` = ponte :8765 + motor) com
interface React em `interface_github/` (repo git separado). Conta DEMO `50534540`, ponte
sempre com `ORDERS_BLOCKED=1` pelo lançador `_reiniciar_ponte.ps1`. Verificação usa o venv:
`venv/Scripts/python.exe test_paridade_regras.py` (47 asserts, 0 falhas) e
`npx tsc --noEmit` na interface. Commit só sob pedido.
