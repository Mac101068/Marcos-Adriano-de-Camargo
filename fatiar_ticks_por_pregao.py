"""
========================================================================================
FATIADOR DE TICKS REAIS POR PREGÃO
========================================================================================
Lê a base acumulada (data/<ativo>_ticks.csv) e gera uma saída por sessão de pregão,
no fuso de Brasília (UTC-3), compatível com backtest_ticks_reais.py.

Por padrão gera .csv.gz (um arquivo por dia, ~5-13 MB) — economiza o disco de
quem guarda meses de fita. Use --csv para gravar os CSVs puros.

Os recortes NÃO vão para o Git: `data/` é ignorado de propósito (a política está
no .gitignore). O que o replay consome viaja pronto em interface_github/dados/.

Uso:
    python fatiar_ticks_por_pregao.py
    python fatiar_ticks_por_pregao.py --ativo WDOZ26 --csv
========================================================================================
"""
import sys

import argparse
import glob
import gzip
import os

import pandas as pd

# O console do Windows é cp850/cp1252 e morre em UnicodeEncodeError ao imprimir travessão
# com a saída redirecionada — que é exatamente o modo como log, launcher e agente rodam isto.
# Forçar UTF-8 no stdout é o que faz o mesmo script valer nas duas máquinas sem perder acento.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

COLUNAS = ['time_msc', 'bid', 'ask', 'last', 'volume', 'flags']
OFFSET_BR = pd.Timedelta(hours=3)   # horário de Brasília = UTC-3


def fatiar(csv_entrada: str, pasta_saida: str, prefixo: str, comprimir: bool, chunk: int):
    if not os.path.exists(csv_entrada):
        print(f"❌ Base não encontrada: {csv_entrada}")
        return {}, {}

    os.makedirs(pasta_saida, exist_ok=True)
    extensao = ".csv.gz" if comprimir else ".csv"
    handles = {}
    contagem = {}
    limite = {}

    try:
        for pedaco in pd.read_csv(csv_entrada, usecols=COLUNAS, chunksize=chunk):
            momento = pd.to_datetime(pedaco['time_msc'], unit='ms') - OFFSET_BR
            pedaco = pedaco.assign(_dia=momento.dt.strftime('%Y%m%d'))

            for dia, grupo in pedaco.groupby('_dia'):
                if dia not in handles:
                    caminho = os.path.join(pasta_saida, f"{prefixo}_ticks_{dia}{extensao}")
                    if comprimir:
                        arquivo = gzip.open(caminho, 'wt', encoding='utf-8', newline='')
                    else:
                        arquivo = open(caminho, 'w', encoding='utf-8', newline='')
                    arquivo.write(','.join(COLUNAS) + '\n')
                    handles[dia] = arquivo
                    contagem[dia] = 0
                    limite[dia] = [grupo['last'].max(), grupo['last'].min()]

                grupo = grupo.drop(columns=['_dia'])
                grupo.to_csv(handles[dia], index=False, header=False)
                contagem[dia] += len(grupo)

                positivos = grupo.loc[grupo['last'] > 0, 'last']
                if len(positivos):
                    limite[dia][0] = max(limite[dia][0], positivos.max())
                    limite[dia][1] = min(limite[dia][1], positivos.min())

            print(f"  → {len(contagem)} pregões processados...", end='\r', flush=True)
    finally:
        for arquivo in handles.values():
            arquivo.close()

    return contagem, limite


def main():
    parser = argparse.ArgumentParser(description="Fatiador de ticks reais por pregão")
    parser.add_argument("--ativo", type=str, default="WINZ26", help="Ativo alvo (padrão: WINZ26)")
    parser.add_argument("--csv", type=str, default=None, help="Caminho da base acumulada")
    parser.add_argument("--out", type=str, default=os.path.join("data", "pregoes"), help="Pasta de saída")
    parser.add_argument("--csv-puro", action="store_true", help="Grava CSV descomprimido em vez de .csv.gz")
    parser.add_argument("--chunk", type=int, default=2_000_000, help="Linhas por bloco de leitura")
    args = parser.parse_args()

    prefixo = args.ativo.lower().replace("$", "_cont")
    entrada = args.csv or os.path.join("data", f"{prefixo}_ticks.csv")

    print(f"\n📥 Base: {entrada}")
    print(f"📂 Saída: {args.out} ({'CSV puro' if args.csv_puro else 'CSV.GZ'})")

    contagem, limite = fatiar(entrada, args.out, prefixo, not args.csv_puro, args.chunk)

    if not contagem:
        return

    print(f"\n✅ {len(contagem)} pregões gerados ({sum(contagem.values()):,} ticks)")

    arquivos = glob.glob(os.path.join(args.out, f"{prefixo}_ticks_*"))
    total_mb = sum(os.path.getsize(a) for a in arquivos) / (1024 * 1024)

    for dia in sorted(contagem):
        maximo, minimo = limite[dia]
        print(f"   {dia}  {contagem[dia]:>9,} ticks   last {minimo:,.0f}..{maximo:,.0f}")

    print(f"\n💾 {len(arquivos)} arquivos · {total_mb:,.1f} MB no total")

    # Atualiza o catálogo que o navegador usa no seletor de pregões.
    try:
        import gerar_catalogo_pregoes

        gerar_catalogo_pregoes.main()
    except Exception as exc:
        print(f"⚠️  Catálogo do navegador não atualizado: {exc}")

    print("🏁 Fatiamento concluído!")


if __name__ == "__main__":
    main()
