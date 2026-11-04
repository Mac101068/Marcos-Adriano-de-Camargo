"""
========================================================================================
EXTRATOR PADRÃO DE HISTÓRICO DE TICKS B3 (XP METATRADER 5)
========================================================================================
Exporta o histórico tick-a-tick oficial no mesmo padrão do 'winz26_ticks.csv':
Colunas: ['time_msc', 'bid', 'ask', 'last', 'volume', 'flags']
Destino: data/<ativo>_ticks.csv em robo_renko e RoboFluxoB3
========================================================================================
"""

import sys
import os
import shutil
from datetime import datetime
import pandas as pd
import MetaTrader5 as mt5

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

CAMINHO_MT5 = r"C:\Program Files\MetaTrader 5 Terminal\terminal64.exe"

DESTINOS = [
    r"C:\Users\Lucas\Documents\robo_renko\data",
    r"C:\Users\Lucas\Documents\RoboFluxoB3\data"
]

def exportar_ticks(ativo: str, data_inicio: datetime, data_fim: datetime):
    print(f"\n=======================================================")
    print(f"🚀 INICIANDO EXTRAÇÃO: {ativo}")
    print(f"Período: {data_inicio.strftime('%Y-%m-%d %H:%M')} até {data_fim.strftime('%Y-%m-%d %H:%M')}")
    print(f"=======================================================")

    if not mt5.symbol_select(ativo, True):
        print(f"❌ Erro: não foi possível selecionar o ativo {ativo}")
        return False

    print(f"📥 Solicitando ticks ao MetaTrader 5...")
    ticks = mt5.copy_ticks_range(ativo, data_inicio, data_fim, mt5.COPY_TICKS_ALL)

    if ticks is None or len(ticks) == 0:
        print(f"❌ Falha ao copiar ticks de {ativo}: {mt5.last_error()}")
        return False

    total_ticks = len(ticks)
    print(f"✅ {total_ticks:,} ticks recebidos com sucesso!")

    df = pd.DataFrame(ticks)
    if 'time_msc' not in df.columns:
        df['time_msc'] = df['time'] * 1000

    colunas = ['time_msc', 'bid', 'ask', 'last', 'volume', 'flags']
    df_filtrado = df[colunas]

    # Nome do arquivo padronizado (ex: wdoz26_ticks.csv, bitx26_ticks.csv)
    # Substitui '$' por '_cont' para compatibilidade de sistema de arquivos se necessário, ou mantém direto
    nome_sanitizado = ativo.lower().replace("$", "_cont")
    nome_arquivo = f"{nome_sanitizado}_ticks.csv"

    primeiro_tick = pd.to_datetime(df_filtrado['time_msc'].iloc[0], unit='ms')
    ultimo_tick = pd.to_datetime(df_filtrado['time_msc'].iloc[-1], unit='ms')
    memoria_mb = df_filtrado.memory_usage(deep=True).sum() / 1024 / 1024

    print(f"📊 Resumo dos dados:")
    print(f"   - Primeiro Tick: {primeiro_tick}")
    print(f"   - Último Tick:   {ultimo_tick}")
    print(f"   - Memória RAM:   {memoria_mb:.2f} MB")

    for dest in DESTINOS:
        os.makedirs(dest, exist_ok=True)
        caminho_csv = os.path.join(dest, nome_arquivo)
        print(f"💾 Salvando em: {caminho_csv}...")
        df_filtrado.to_csv(caminho_csv, index=False)
        tamanho_mb = os.path.getsize(caminho_csv) / 1024 / 1024
        print(f"   ✅ Arquivo gravado ({tamanho_mb:.2f} MB)")

    return True

def main():
    print("🔌 Conectando ao MetaTrader 5...")
    if not mt5.initialize(path=CAMINHO_MT5):
        print("❌ Erro ao inicializar MT5:", mt5.last_error())
        return

    # Ativos e períodos para extração no mesmo padrão de winz26:
    # 1. WDOZ26: Mini Dólar vigente (outubro até hoje)
    # 2. BITX26: Bitcoin Futuro B3 vigente (outubro até hoje)
    # 3. BIT$: Série contínua Bitcoin (outubro até hoje)
    
    tarefas = [
        {
            "ativo": "WDOZ26",
            "inicio": datetime(2026, 10, 1, 0, 0, 0),
            "fim": datetime(2026, 11, 4, 23, 59, 59)
        },
        {
            "ativo": "BITX26",
            "inicio": datetime(2026, 10, 1, 0, 0, 0),
            "fim": datetime(2026, 11, 4, 23, 59, 59)
        },
        {
            "ativo": "BIT$",
            "inicio": datetime(2026, 10, 1, 0, 0, 0),
            "fim": datetime(2026, 11, 4, 23, 59, 59)
        }
    ]

    for t in tarefas:
        exportar_ticks(t["ativo"], t["inicio"], t["fim"])

    mt5.shutdown()
    print("\n🎉 Todas as extrações foram finalizadas com sucesso!")

if __name__ == "__main__":
    main()

