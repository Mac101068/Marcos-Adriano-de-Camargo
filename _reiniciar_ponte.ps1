$ErrorActionPreference = 'SilentlyContinue'
Set-Location 'c:\Users\Lucas\Documents\RoboFluxoB3'

$alvos = Get-CimInstance Win32_Process -Filter "Name='python.exe'" | Where-Object { $_.CommandLine -match 'bot_mt5_ciclo15' }
"PID(s) da ponte encontradas: " + (($alvos | ForEach-Object { $_.ProcessId }) -join ', ') | Out-File '_restart.txt' -Encoding utf8

foreach ($p in $alvos) { Stop-Process -Id $p.ProcessId -Force }
Start-Sleep -Seconds 3

# Trava ligada: este lancador nao herda nada do iniciar_robo.cmd. Start-Process herda o
# ambiente deste processo, entao a variavel precisa existir aqui.
$env:ORDERS_BLOCKED = '1'

Start-Process cmd -ArgumentList '/c', 'cd /d c:\Users\Lucas\Documents\RoboFluxoB3 && venv\Scripts\python.exe -u bot_mt5_ciclo15.py >> ponte_mt5_live.log 2>&1' -WindowStyle Hidden
Start-Sleep -Seconds 10

$porta = Get-NetTCPConnection -LocalPort 8765 -State Listen | Select-Object -First 1
"PORTA 8765 LISTENANDO PID=" + $porta.OwningProcess | Out-File '_restart.txt' -Append -Encoding utf8
