"""
Descompactador de base de ticks reais da B3 para outras estações de trabalho.
Gera os arquivos .csv a partir dos .csv.gz versionados no Git.
"""
import gzip
import shutil
import glob
import os

data_dir = os.path.join(os.path.dirname(__file__), 'data')
gz_files = glob.glob(os.path.join(data_dir, '*.csv.gz'))

print(f"📦 Descompactando {len(gz_files)} arquivos de ticks reais para a pasta data/...")
for gz in gz_files:
    csv_out = gz[:-3]  # remove .gz
    if not os.path.exists(csv_out) or os.path.getmtime(gz) > os.path.getmtime(csv_out):
        with gzip.open(gz, 'rb') as f_in:
            with open(csv_out, 'wb') as f_out:
                shutil.copyfileobj(f_in, f_out)
        mb = os.path.getsize(csv_out) / (1024 * 1024)
        print(f"  ✅ {os.path.basename(csv_out)} ({mb:.1f} MB) restaurado com sucesso.")
    else:
        print(f"  ℹ️ {os.path.basename(csv_out)} já existe e está atualizado.")

print("🏁 Base de ticks 100% pronta para Replay e Backtest nesta estação!")
