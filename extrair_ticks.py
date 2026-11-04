"""
========================================================================================
EXTRATOR DE TICKS REAIS B3 (XP METATRADER 5)
========================================================================================
Extrai ticks reais do MetaTrader 5 e salva em formato padronizado CSV:
Colunas: ['time_msc', 'bid', 'ask', 'last', 'volume', 'flags']
Destino: data/<ativo>_ticks.csv
Compatível com: WINZ26, WDOZ26, BITX26, BIT$, WDO$, etc.
========================================================================================
"""

import MetaTrader5 as mt5
import pandas as pd
from datetime import datetime
import os
import sys
import argparse

CAMINHO_MT5 = r"C:\Program Files\MetaTrader 5 Terminal\terminal64.exe"

ATIVOS_CONFIG = {
    "WINZ26": {
        "inicio": datetime(2026, 9, 1),
        "fim": datetime(2026, 11, 4, 23, 59, 59),
        "desc": "Mini-Índice B3 (Contrato Vigente)"
    },
    "WDOZ26": {
        "inicio": datetime(2026, 10, 1),
        "fim": datetime(2026, 11, 4, 23, 59, 59),
        "desc": "Mini-Dólar B3 (Contrato Vigente)"
    },
    "BITX26": {
        "inicio": datetime(2026, 10, 1),
        "fim": datetime(2026, 11, 4, 23, 59, 59),
        "desc": "Bitcoin Futuro B3 (Contrato Vigente)"
    },
    "BIT$": {
        "inicio": datetime(2026, 10, 1),
        "fim": datetime(2026, 11, 4, 23, 59, 59),
        "desc": "Bitcoin Futuro B3 (Série Contínua)"
    }
}

def extrair_para_csv(ativo: str, data_inicio: datetime, data_fim: datetime):
    print(f"\n=======================================================")
    print(f"📥 Solicitando ticks de {ativo}...")
    print(f"   Período: {data_inicio.date()} até {data_fim.date()}")
    print(f"=======================================================")

    if not mt5.symbol_select(ativo, True):
        print(f"❌ Erro: não foi possível selecionar o ativo {ativo}")
        return False

    ticks = mt5.copy_ticks_range(ativo, data_inicio, data_fim, mt5.COPY_TICKS_ALL)
    
    if ticks is None or len(ticks) == 0:
        print(f"❌ Falha ao copiar ticks de {ativo}:", mt5.last_error())
        return False

    print(f"✅ Total de ticks recebidos: {len(ticks):,}")
    df = pd.DataFrame(ticks)
    
    if 'time_msc' not in df.columns:
        df['time_msc'] = df['time'] * 1000

    colunas = ['time_msc', 'bid', 'ask', 'last', 'volume', 'flags']
    df_filtrado = df[colunas]

    nome_sanitizado = ativo.lower().replace("$", "_cont")
    caminho_csv = f"data/{nome_sanitizado}_ticks.csv"
    os.makedirs("data", exist_ok=True)
    
    df_filtrado.to_csv(caminho_csv, index=False)
    tamanho_mb = os.path.getsize(caminho_csv) / (1024 * 1024)
    print(f"💾 Ticks salvos com sucesso em: {caminho_csv} ({tamanho_mb:.2f} MB)")
    print(f"   Início: {pd.to_datetime(df_filtrado['time_msc'].iloc[0], unit='ms')}")
    print(f"   Fim:    {pd.to_datetime(df_filtrado['time_msc'].iloc[-1], unit='ms')}")
    return True

def main():
    parser = argparse.ArgumentParser(description="Extração padronizada de ticks MT5 B3")
    parser.add_argument("--ativo", type=str, default="TODOS", help="Símbolo do ativo (ex: WDOZ26, BITX26, WINZ26, TODOS)")
    args = parser.parse_args()

    print("🔌 Conectando ao MetaTrader 5 Terminal...")
    if not mt5.initialize(path=CAMINHO_MT5):
        print("❌ Erro ao inicializar MT5:", mt5.last_error())
        return

    ativo_escolhido = args.ativo.upper()

    if ativo_escolhido == "TODOS":
        for sym, cfg in ATIVOS_CONFIG.items():
            extrair_para_csv(sym, cfg["inicio"], cfg["fim"])
    elif ativo_escolhido in ATIVOS_CONFIG:
        cfg = ATIVOS_CONFIG[ativo_escolhido]
        extrair_para_csv(ativo_escolhido, cfg["inicio"], cfg["fim"])
    else:
        data_fim = datetime.now()
        data_inicio = datetime(data_fim.year, data_fim.month, 1)
        extrair_para_csv(ativo_escolhido, data_inicio, data_fim)

    mt5.shutdown()
    print("\n🏁 Processo de extração concluído!")

if __name__ == "__main__":
    main()

