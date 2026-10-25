@echo off
title RoboFluxoB3 - Conexao MetaTrader 5 ao Vivo
chcp 65001 > nul
echo =====================================================================
echo  RoboFluxoB3 - Ponte de Conexao MetaTrader 5 (WINZ26 / B3)
echo =====================================================================
echo.
echo Verificando MetaTrader 5...
echo Ativo Alvo: WINZ26
echo Estrategia: Piramide & Confluencia Renko 10R
echo Servidor WebSocket: ws://localhost:8765
echo.
echo Iniciando ponte Python MT5...
.\venv\Scripts\python.exe bot_mt5_convergencia_10r.py
pause
