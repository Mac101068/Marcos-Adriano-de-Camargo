# -*- coding: utf-8 -*-
"""
========================================================================================
ORGANIZADOR E SINCRONIZADOR DE REPLAYS DE PREGÃO (JANELA ROLANTE DE 10 DIAS)
========================================================================================
Gerencia a base de replays em `data/pregoes/` mantendo sempre exatamente os 10 últimos
pregões para cada ativo (por padrão: WINZ26, WDOZ26 e BITX26), usando o Mini-Índice
como ativo base de calendário de negociação.

Funcionamento:
1. Conecta ao MetaTrader 5 (ou usa a base local como fallback inteligente).
2. Identifica os últimos 10 pregões oficiais a partir do Mini-Índice (WIN).
3. Para cada um dos ativos:
   - Garante a presença do arquivo de ticks compactado (.csv.gz) para os 10 pregões.
   - Baixa do MT5 caso falte algum dia; se o MT5 estiver offline, extrai da base local.
   - ROTAÇÃO / EXPURGO AUTOMÁTICO: se houver mais de 10 pregões gravados para o ativo,
     deleta automaticamente os pregões mais antigos, mantendo estritamente a janela de 10 dias.
4. Atualiza automaticamente o catálogo `interface_github/public/pregoes.json` para
   que a interface React reflita imediatamente as opções atualizadas no seletor de replay.

Uso:
    .\\venv\\Scripts\\python.exe organizar_replays_10dias.py
    .\\venv\\Scripts\\python.exe organizar_replays_10dias.py --janela 10 --base WINZ26
========================================================================================
"""
import sys
import os
import glob
import re
import gzip
import argparse
from datetime import datetime, timedelta
import pandas as pd

# Suporte a acentuação e UTF-8 no Windows
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

RAIZ = os.path.dirname(os.path.abspath(__file__))
PASTA_PREGOES = os.path.join(RAIZ, "data", "pregoes")
DESTINO_CATALOGO = os.path.join(RAIZ, "interface_github", "public", "pregoes.json")
COLUNAS_OFICIAIS = ['time_msc', 'bid', 'ask', 'last', 'volume', 'flags']
OFFSET_BRT = pd.Timedelta(hours=3)

MT5_PATH_DEFAULT = os.getenv("MT5_PATH", r"C:\Program Files\MetaTrader 5 Terminal\terminal64.exe")

try:
    import MetaTrader5 as mt5
    MT5_AVAILABLE = True
except ImportError:
    mt5 = None
    MT5_AVAILABLE = False


def conectar_mt5(path=None):
    """Tenta conectar ao MT5 com tratamento gracioso de falha."""
    if not MT5_AVAILABLE:
        return False
    caminho = path or MT5_PATH_DEFAULT
    # Tenta conectar sem spawn primeiro (caso já esteja rodando)
    if mt5.initialize():
        return True
    if os.path.exists(caminho):
        if mt5.initialize(path=caminho):
            return True
    return False


def obter_ultimos_pregoes_mt5(simbolo_base: str, n_dias: int):
    """Consulta os últimos N dias de pregão com negociação no MT5 usando velas D1."""
    if not mt5.symbol_select(simbolo_base, True):
        return []
    # Busca velas diárias recentes (últimas 40 para garantir achar os 10 pregões úteis)
    rates = mt5.copy_rates_from_pos(simbolo_base, mt5.TIMEFRAME_D1, 0, 45)
    if rates is None or len(rates) == 0:
        return []

    df_rates = pd.DataFrame(rates)
    # Filtra velas que tiveram volume de negócio real
    df_rates = df_rates[df_rates['tick_volume'] > 0]
    df_rates['dt'] = pd.to_datetime(df_rates['time'], unit='s')
    df_rates['dia_str'] = df_rates['dt'].dt.strftime('%Y%m%d')

    dias_ordenados = sorted(df_rates['dia_str'].unique(), reverse=True)
    return dias_ordenados[:n_dias]


def obter_ultimos_pregoes_local(simbolo_base: str, n_dias: int):
    """Fallback: descobre os últimos N pregões a partir dos arquivos já salvos em disco."""
    prefixo = simbolo_base.lower().replace("$", "_cont")
    padrao = os.path.join(PASTA_PREGOES, f"{prefixo}_ticks_*.csv*")
    dias = set()
    for arq in glob.glob(padrao):
        m = re.search(r"_ticks_(\d{8})\.csv(?:\.gz)?$", arq)
        if m:
            dias.add(m.group(1))

    # Se tiver poucos dias fatiados, verifica se há na base acumulada
    if len(dias) < n_dias:
        for ext in (".csv", ".csv.gz"):
            acumulado = os.path.join(RAIZ, "data", f"{prefixo}_ticks{ext}")
            if os.path.exists(acumulado):
                try:
                    # Ler apenas o suficiente para mapear datas
                    for chunk in pd.read_csv(acumulado, usecols=['time_msc'], chunksize=500_000):
                        momento = pd.to_datetime(chunk['time_msc'], unit='ms') - OFFSET_BRT
                        dias.update(momento.dt.strftime('%Y%m%d').unique())
                except Exception:
                    pass

    return sorted(dias, reverse=True)[:n_dias]


def baixar_dia_mt5(ativo: str, dia_str: str, destino_gz: str):
    """Baixa os ticks de um pregão específico diretamente do MT5 e salva comprimido."""
    if not MT5_AVAILABLE:
        return False
    if not mt5.symbol_select(ativo, True):
        print(f"  ⚠️ Não foi possível selecionar o símbolo {ativo} no MT5")
        return False

    dt_dia = datetime.strptime(dia_str, "%Y%m%d")
    dt_inicio = datetime(dt_dia.year, dt_dia.month, dt_dia.day, 0, 0, 0)
    dt_fim = datetime(dt_dia.year, dt_dia.month, dt_dia.day, 23, 59, 59)

    print(f"  📥 [MT5] Baixando ticks de {ativo} para o pregão {dia_str}...")
    ticks = mt5.copy_ticks_range(ativo, dt_inicio, dt_fim, mt5.COPY_TICKS_ALL)
    if ticks is None or len(ticks) == 0:
        print(f"  ⚠️ Nenhum tick retornado pelo MT5 para {ativo} no dia {dia_str}")
        return False

    df = pd.DataFrame(ticks)
    if 'time_msc' not in df.columns and 'time' in df.columns:
        df['time_msc'] = df['time'] * 1000

    colunas_presentes = [c for c in COLUNAS_OFICIAIS if c in df.columns]
    for c in COLUNAS_OFICIAIS:
        if c not in df.columns:
            df[c] = 0

    df_salvar = df[COLUNAS_OFICIAIS]
    os.makedirs(os.path.dirname(destino_gz), exist_ok=True)

    with gzip.open(destino_gz, 'wt', encoding='utf-8', newline='') as f_out:
        df_salvar.to_csv(f_out, index=False)

    tam_mb = os.path.getsize(destino_gz) / (1024 * 1024)
    print(f"  ✅ [MT5] Salvo {destino_gz} ({len(df_salvar):,} ticks, {tam_mb:.2f} MB)")
    return True


def extrair_dia_base_acumulada(ativo: str, dia_str: str, destino_gz: str):
    """Extrai um pregão específico a partir de data/<ativo>_ticks.csv ou .csv.gz."""
    prefixo = ativo.lower().replace("$", "_cont")
    caminhos_candidatos = [
        os.path.join(RAIZ, "data", f"{prefixo}_ticks.csv"),
        os.path.join(RAIZ, "data", f"{prefixo}_ticks.csv.gz"),
    ]

    fonte = None
    for c in caminhos_candidatos:
        if os.path.exists(c):
            fonte = c
            break

    if not fonte:
        return False

    print(f"  📦 [CACHE LOCAL] Extraindo dia {dia_str} para {ativo} de {os.path.basename(fonte)}...")
    pedacos_do_dia = []

    try:
        for chunk in pd.read_csv(fonte, usecols=COLUNAS_OFICIAIS, chunksize=500_000):
            momento = pd.to_datetime(chunk['time_msc'], unit='ms') - OFFSET_BRT
            filtro = (momento.dt.strftime('%Y%m%d') == dia_str)
            sub = chunk[filtro]
            if len(sub) > 0:
                pedacos_do_dia.append(sub)

        if not pedacos_do_dia:
            return False

        df_final = pd.concat(pedacos_do_dia, ignore_index=True)
        os.makedirs(os.path.dirname(destino_gz), exist_ok=True)
        with gzip.open(destino_gz, 'wt', encoding='utf-8', newline='') as f_out:
            df_final.to_csv(f_out, index=False)

        tam_mb = os.path.getsize(destino_gz) / (1024 * 1024)
        print(f"  ✅ [CACHE LOCAL] Gerado {destino_gz} ({len(df_final):,} ticks, {tam_mb:.2f} MB)")
        return True
    except Exception as exc:
        print(f"  ❌ Falha ao extrair da base local: {exc}")
        return False


def garantir_pregoes_ativo(ativo: str, dias_alvo: list, mt5_conectado: bool):
    """Garante que todos os dias_alvo estejam presentes em data/pregoes/."""
    prefixo = ativo.lower().replace("$", "_cont")
    os.makedirs(PASTA_PREGOES, exist_ok=True)

    for dia in dias_alvo:
        destino_gz = os.path.join(PASTA_PREGOES, f"{prefixo}_ticks_{dia}.csv.gz")
        destino_csv = os.path.join(PASTA_PREGOES, f"{prefixo}_ticks_{dia}.csv")

        # Se já existe arquivo válido (acima de 10KB)
        if (os.path.exists(destino_gz) and os.path.getsize(destino_gz) > 10_000) or \
           (os.path.exists(destino_csv) and os.path.getsize(destino_csv) > 10_000):
            print(f"  ✓ {ativo} | {dia}: já disponível em disco.")
            continue

        sucesso = False
        if mt5_conectado:
            sucesso = baixar_dia_mt5(ativo, dia, destino_gz)

        if not sucesso:
            sucesso = extrair_dia_base_acumulada(ativo, dia, destino_gz)

        if not sucesso:
            print(f"  ⚠️ {ativo} | {dia}: dados não disponíveis (nem no MT5 nem no cache local).")


def aplicar_rotacao_limpeza(ativo: str, dias_manter: list):
    """Remove pregões antigos do ativo que estiverem fora da lista dias_manter."""
    prefixo = ativo.lower().replace("$", "_cont")
    padrao = os.path.join(PASTA_PREGOES, f"{prefixo}_ticks_*.csv*")
    arquivos = glob.glob(padrao)

    removidos = 0
    mantidos = 0

    for arq in arquivos:
        m = re.search(r"_ticks_(\d{8})\.csv(?:\.gz)?$", arq)
        if not m:
            continue
        dia = m.group(1)
        if dia not in dias_manter:
            try:
                os.remove(arq)
                print(f"  🗑️ [EXPURGO] Removido pregão antigo: {os.path.basename(arq)}")
                removidos += 1
            except Exception as exc:
                print(f"  ⚠️ Erro ao remover {arq}: {exc}")
        else:
            mantidos += 1

    print(f"  📊 {ativo}: {mantidos} arquivos preservados, {removidos} arquivos antigos expurgados.")


def atualizar_catalogo_interface():
    """Gera pregoes.json atualizado em interface_github/public/."""
    import gerar_catalogo_pregoes
    print("\n📚 Sincronizando catálogo de pregões na interface...")
    gerar_catalogo_pregoes.main()


def main():
    parser = argparse.ArgumentParser(description="Organizador de replays B3 com janela rolante de 10 dias")
    parser.add_argument("--janela", type=int, default=10, help="Quantidade de pregões a manter (padrão: 10)")
    parser.add_argument("--base", type=str, default="WINZ26", help="Ativo base para calendário de pregões (padrão: WINZ26)")
    parser.add_argument("--ativos", nargs="+", default=["WINZ26", "WDOZ26", "BITX26"], help="Lista de ativos a sincronizar")
    args = parser.parse_args()

    print("=" * 80)
    print(f"🔄 SINCRONIZADOR DE REPLAYS B3 — JANELA ROLANTE DE {args.janela} PREGÕES")
    print(f"   Ativo base (calendário): {args.base}")
    print(f"   Ativos gerenciados:      {', '.join(args.ativos)}")
    print("=" * 80)

    # 1. Tentar conectar ao MT5
    print("\n🔌 Verificando conexão com o MetaTrader 5...")
    mt5_conectado = conectar_mt5()
    if mt5_conectado:
        print("✅ MetaTrader 5 conectado com sucesso.")
    else:
        print("⚠️ MetaTrader 5 indisponível no momento — operando em modo CACHE LOCAL / DISCO.")

    # 2. Obter os 10 últimos pregões oficiais a partir da base
    dias_alvo = []
    if mt5_conectado:
        dias_alvo = obter_ultimos_pregoes_mt5(args.base, args.janela)

    if not dias_alvo or len(dias_alvo) < args.janela:
        dias_local = obter_ultimos_pregoes_local(args.base, args.janela)
        # Combina e ordena
        dias_combinados = sorted(set(dias_alvo + dias_local), reverse=True)
        dias_alvo = dias_combinados[:args.janela]

    print(f"\n📅 Janela Oficial dos {len(dias_alvo)} Pregões Selecionados (Base {args.base}):")
    for idx, d in enumerate(dias_alvo, 1):
        dt_format = f"{d[:4]}-{d[4:6]}-{d[6:]}"
        print(f"   {idx:02d}. {dt_format} ({d})")

    # 3. Garantir dados e aplicar rotação para cada ativo
    for ativo in args.ativos:
        print(f"\n⚙️ Processando ativo: {ativo}...")
        garantir_pregoes_ativo(ativo, dias_alvo, mt5_conectado)
        aplicar_rotacao_limpeza(ativo, dias_alvo)

    # 4. Desconectar MT5 se estava aberto
    if mt5_conectado:
        mt5.shutdown()

    # 5. Atualizar catálogo da interface
    atualizar_catalogo_interface()

    print("\n" + "=" * 80)
    print("✅ Sincronização e organização de replays concluída com sucesso!")
    print(f"   Cada ativo agora possui estritamente os {len(dias_alvo)} pregões mais recentes.")
    print("=" * 80)


if __name__ == "__main__":
    main()
