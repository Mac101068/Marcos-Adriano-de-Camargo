@echo off
title Backtest Quantitativo - Ticks Reais B3 (XP MT5)
chcp 65001 > nul

:MENU
cls
echo =====================================================================
echo    ROBO QUANTITATIVO B3 - MOTOR DE BACKTEST COM TICKS REAIS
echo =====================================================================
echo.
echo  [1] Listar todos os pregoes disponiveis com ticks reais
echo  [2] Rodar Backtest de HOJE (2026-11-04)
echo  [3] Rodar Backtest de ONTEM (2026-11-03)
echo  [4] Escolher DATA e tamanho do RENKO (Personalizado)
echo  [5] Sair
echo.
echo =====================================================================
set /p opt="Escolha uma opcao (1-5): "

if "%opt%"=="1" goto LISTAR
if "%opt%"=="2" goto HOJE
if "%opt%"=="3" goto ONTEM
if "%opt%"=="4" goto CUSTOM
if "%opt%"=="5" goto FIM

:LISTAR
cls
.\venv\Scripts\python.exe backtest_ticks_reais.py --list
echo.
pause
goto MENU

:HOJE
cls
echo Rodando backtest com ticks de hoje em 10R...
.\venv\Scripts\python.exe backtest_ticks_reais.py --date 2026-11-04 --r 10
echo.
pause
goto MENU

:ONTEM
cls
echo Rodando backtest com ticks de ontem em 10R...
.\venv\Scripts\python.exe backtest_ticks_reais.py --date 2026-11-03 --r 10
echo.
pause
goto MENU

:CUSTOM
cls
echo Digite a data no formato AAAA-MM-DD (ex: 2026-10-30):
set /p DATA_INPUT="Data: "
echo Digite o tamanho em R (ex: 10 para 10R, 15 para 15R, 20 para 20R):
set /p R_INPUT="Renko R: "
cls
echo Rodando backtest para %DATA_INPUT% no Renko %R_INPUT%R...
.\venv\Scripts\python.exe backtest_ticks_reais.py --date %DATA_INPUT% --r %R_INPUT%
echo.
pause
goto MENU

:FIM
exit

