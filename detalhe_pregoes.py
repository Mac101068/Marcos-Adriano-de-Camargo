import sys
import os
import json
from datetime import datetime, timedelta
import numpy as np

sys.stdout.reconfigure(encoding="utf-8")

import web_app
from fluxo_atemporal_modulo import RenkoFlowEngine, check_market_accumulation
from backtest_renko import preparar_ticks, VALOR_PONTO_WIN
from comparativo_delta_20r import BacktestSimulador

pregoes = []
dia = datetime.now()
tentativas = 0
while len(pregoes) < 5 and tentativas < 15:
    if tentativas > 0:
        dia -= timedelta(days=1)
    tentativas += 1
    if dia.weekday() >= 5:
        continue
    d_str = dia.strftime("%Y-%m-%d")
    df, info = web_app.buscar_ticks_historicos("WINZ26", d_str, num_ticks=None)
    if df is not None and len(df) > 0:
        if not any(p["info"] == info for p in pregoes):
            pregoes.append({"info": info, "ticks": preparar_ticks(df)})

print("\n" + "=" * 90)
print(f"{'Data':<12} | {'Ops':<6} | {'Acerto %':<8} | {'Pontos':<10} | {'Resultado R$':<14} | {'Drawdown':<10} | {'Status':<15}")
print("-" * 90)

for p in pregoes:
    bt = BacktestSimulador(min_delta=100, box_pts=100, tp_pir=100.0, custo_pts=5.0, daily_meta=1000.0, daily_stop=800.0)
    ticks = p["ticks"]
    for i in range(len(ticks["preco"])):
        bt.on_tick(ticks["preco"][i], ticks["vol"][i], int(ticks["agg"][i]), ticks["hora"][i])
    bt.finalizar(ticks["preco"][-1], ticks["hora"][-1])
    res = bt.resumo()
    status = bt.lock_reason if bt.lock_reason else "FINALIZADO"
    print(f"{p['info']:<12} | {res['ops']:<6} | {res['acerto']:>6.1f}%  | {res['pts']:>+8,.0f}  | R$ {res['reais']:>+10,.2f} | R$ {res['dd']:>7,.2f} | {status:<15}")

print("=" * 90)
