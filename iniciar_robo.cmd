@echo off
setlocal EnableExtensions
chcp 65001 >nul
cd /d "%~dp0"

REM ===========================================================
REM  Robo Fluxo B3 - sobe a ponte MT5 e o frontend juntos
REM  MODO SEGURO: ORDERS_BLOCKED=1 (nenhuma ordem de entrada sai)
REM ===========================================================

set "ORDERS_BLOCKED=1"
set "PY=venv\Scripts\python.exe"
set "PORTA_PONTE=8765"
set "PORTA_WEB=3000"

REM Caminhos absolutos: evita pegar o netstat/timeout do Git no PATH
set "SYS=%SystemRoot%\System32"
set "NETSTAT=%SYS%\netstat.exe"
set "FINDSTR=%SYS%\findstr.exe"
set "ESPERA=%SYS%\timeout.exe"
if not exist "%ESPERA%" set "ESPERA=%SYS%\ping.exe -n 3 127.0.0.1 -w 1000"

echo ============================================================
echo   ROBO FLUXO B3 - subida em MODO SEGURO
echo   ORDERS_BLOCKED=1 ^-^> a ponte NAO envia ordens
echo ============================================================
echo.

REM ---------------------- PONTE ----------------------
"%NETSTAT%" -ano | "%FINDSTR%" /r /c:":%PORTA_PONTE% .*LISTENING" >nul
if not errorlevel 1 (
    echo [ponte]    ja rodando na porta %PORTA_PONTE%
    echo            ATENCAO: se ela foi iniciada sem a trava, feche a janela/PID
    echo            e rode este script de novo para garantir o modo seguro.
) else (
    if not exist "%PY%" (
        echo [ponte]    ERRO: nao encontrei "%PY%"
        echo            Rode: python -m venv venv ^&^& venv\Scripts\pip install -r requirements.txt
    ) else (
        echo [ponte]    iniciando em modo seguro...
        start "Ponte MT5" /min cmd /c "%PY% -u bot_mt5_ciclo15.py >> ponte_mt5_live.log 2>&1"
    )
)

REM --------------------- FRONTEND --------------------
"%NETSTAT%" -ano | "%FINDSTR%" /r /c:":%PORTA_WEB% .*LISTENING" >nul
if not errorlevel 1 (
    echo [frontend] ja rodando na porta %PORTA_WEB%
) else (
    if not exist "interface_github\package.json" (
        echo [frontend] ERRO: nao encontrei interface_github\package.json
    ) else (
        echo [frontend] iniciando...
        start "Frontend B3" /min cmd /c "cd /d interface_github && npm run dev >> ..\dev_frontend.log 2>&1"
    )
)

REM ---------------------- ESPERA ---------------------
echo.
echo Aguardando as portas responderem (ate 30s)...
set /a _t=0
:espera
"%ESPERA%" /t 2 /nobreak >nul 2>&1 || ping -n 3 127.0.0.1 >nul 2>&1
"%NETSTAT%" -ano | "%FINDSTR%" /r /c:":%PORTA_PONTE% .*LISTENING" >nul && set "_ponte=1"
"%NETSTAT%" -ano | "%FINDSTR%" /r /c:":%PORTA_WEB% .*LISTENING" >nul && set "_web=1"
if defined _ponte if defined _web goto :relatorio
set /a _t+=2
if %_t% lss 30 goto :espera

:relatorio
echo.
echo ------------------------ ESTADO ------------------------
set "_s=PARADA"
if defined _ponte set "_s=OK"
echo   Ponte    %PORTA_PONTE%: %_s%
set "_s=PARADO"
if defined _web set "_s=OK"
echo   Frontend %PORTA_WEB%: %_s%
echo.
echo   Interface: http://localhost:3000
echo   Logs:      ponte_mt5_live.log  e  dev_frontend.log
echo.
echo   A trava do ambiente so cai reiniciando a ponte SEM este script.
echo   Nao faca isso a menos que queira operar de verdade.
echo --------------------------------------------------------
echo.

if defined _web start "" http://localhost:3000

pause
