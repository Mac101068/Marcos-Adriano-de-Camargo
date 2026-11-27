<#
.SYNOPSIS
    Sincronizador automático da janela rolante de 10 pregões de replay (WIN, WDO, BIT).
.DESCRIPTION
    Executa organizar_replays_10dias.py utilizando o Python do ambiente virtual do projeto,
    garantindo que exatamente os 10 pregões mais recentes sejam mantidos para cada ativo,
    expurgando automaticamente dias antigos e atualizando a interface React.
#>

$ErrorActionPreference = "Stop"
$Raiz = Split-Path -Parent $MyInvocation.MyCommand.Definition
Set-Location $Raiz

Write-Host "==========================================================================" -ForegroundColor Cyan
Write-Host "🔄 SINCRONIZADOR DE REPLAYS B3 — JANELA ROLANTE DE 10 DIAS" -ForegroundColor Cyan
Write-Host "==========================================================================" -ForegroundColor Cyan

$PythonExe = Join-Path $Raiz "venv\Scripts\python.exe"
if (-not (Test-Path $PythonExe)) {
    Write-Host "❌ Python do ambiente virtual não encontrado em $PythonExe" -ForegroundColor Red
    exit 1
}

& $PythonExe "organizar_replays_10dias.py" --janela 10 --base "WINZ26" --ativos "WINZ26" "WDOZ26" "BITX26"

if ($LASTEXITCODE -eq 0) {
    Write-Host "`n✅ Janela rolante de 10 pregões sincronizada com sucesso!" -ForegroundColor Green
} else {
    Write-Host "`n❌ Falha na execução da sincronização (Código $LASTEXITCODE)." -ForegroundColor Red
}
