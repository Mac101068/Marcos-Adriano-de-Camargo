@echo off
title RoboFluxoB3 - Conexao MetaTrader 5 ao Vivo (Ciclo 15)
chcp 65001 > nul
echo =====================================================================
echo  RoboFluxoB3 - Ponte de Conexao MetaTrader 5 (WINZ26 / B3 - Ciclo 15)
echo =====================================================================
echo.
echo Verificando MetaTrader 5...
echo Ativo Alvo: WINZ26
echo Estrategia: Piramide & Confluencia Renko 10R (Ciclo 15)
echo Servidor WebSocket: ws://localhost:8765
echo.
echo Iniciando ponte Python MT5...
.\venv\Scripts\python.exe -u bot_mt5_ciclo15.py
pause
