"""
Varredura do filtro de delta em vários pregões (ticks reais do MT5).
Uso: python backtest_dia.py [ATIVO] [N_PREGOES]
"""
import sys
import time
from datetime import datetime, timedelta

sys.stdout.reconfigure(encoding="utf-8")

import web_app
from backtest_renko import preparar_ticks, rodar_backtest, VALOR_PONTO_WIN
from config import ATIVO_ALVO

ativo = sys.argv[1] if len(sys.argv) > 1 else ATIVO_ALVO
n_pregoes = int(sys.argv[2]) if len(sys.argv) > 2 else 5
FILTROS = [150, 1000, 2000, 3000, 4000, 5000, 7500, 10000]
CUSTO_PTS = 5  # premissa: 1 tick de escorregamento + taxas por operação (ida e volta)

if not web_app.validar_e_conectar():
    print("MT5 indisponível:", web_app.state.error)
    sys.exit(2)

# ── Coleta dos pregões ──
pregoes = {}
dia = datetime.now()
tentativas = 0
while len(pregoes) < n_pregoes and tentativas < 20:
    tentativas += 1
    dia -= timedelta(days=1) if tentativas > 1 or dia.weekday() >= 5 else timedelta(0)
    if dia.weekday() >= 5:
        continue
    df, info = web_app.buscar_ticks_historicos(ativo, dia.strftime("%Y-%m-%d"), num_ticks=None)
    if df is None or info in pregoes:
        continue
    pregoes[info] = preparar_ticks(df)
    t = pregoes[info]
    print(f"Pregão {info}: {len(t['preco']):,} ticks ({t['hora'][0]} → {t['hora'][-1]})")

if not pregoes:
    print("Nenhum pregão encontrado.")
    sys.exit(3)

# ── Varredura ──
print(f"\nAtivo {ativo} | {len(pregoes)} pregões | custo {CUSTO_PTS} pts/operação | 1 contrato mãe + 1 por pirâmide\n")
print(f"{'Filtro':>7} | {'Sinais':>6} | {'Ops':>5} | {'Pts brutos':>10} | {'Pts líq.':>9} | {'R$ líq.':>9} | {'Acerto':>6} | {'Pior DD':>8} | {'Dias +':>6}")
print("-" * 92)
resultados = []
for f in FILTROS:
    t0 = time.time()
    sinais = ops = 0
    bruto = liq = 0.0
    acertos = []
    dd_max = 0.0
    dias_pos = 0
    for info, ticks in pregoes.items():
        bt_b = rodar_backtest(ticks, f, custo_pts=0)
        bt_l = rodar_backtest(ticks, f, custo_pts=CUSTO_PTS)
        rb, rl = bt_b.resumo(), bt_l.resumo()
        sinais += rl['sinais']
        ops += rl['operacoes']
        bruto += rb['pts']
        liq += rl['pts']
        if rl['operacoes']:
            acertos.append(rl['acerto'])
        dd_max = max(dd_max, rl['max_dd_pts'])
        dias_pos += 1 if rl['pts'] > 0 else 0
    acerto = sum(acertos) / len(acertos) if acertos else 0
    resultados.append((f, liq))
    print(f"{f:>7} | {sinais:>6} | {ops:>5} | {bruto:>10.0f} | {liq:>9.0f} | {liq * VALOR_PONTO_WIN:>9.2f} | {acerto:>5.1f}% | {dd_max:>8.0f} | {dias_pos:>3}/{len(pregoes)}")

# ── Detalhe por dia do melhor filtro ──
melhor = max(resultados, key=lambda x: x[1])[0]
print(f"\nDetalhe por pregão (filtro {melhor}, líquido):")
for info, ticks in pregoes.items():
    r = rodar_backtest(ticks, melhor, custo_pts=CUSTO_PTS).resumo()
    print(f"  {info}: {r['operacoes']:>4} ops | {r['pts']:>7.0f} pts (mãe {r['pts_mae']:.0f} / pirâmides {r['pts_pir']:.0f}) | R$ {r['reais']:>8.2f} | DD {r['max_dd_pts']:.0f}")
