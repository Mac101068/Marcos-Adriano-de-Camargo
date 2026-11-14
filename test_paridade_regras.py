"""Prova de paridade: a ponte julga o box com as regras que a tela desenha.

Rodar: venv\\Scripts\\python.exe test_paridade_regras.py

O teste dirige o motor que EXECUTA (RenkoFlowEngine.check_convergence, do
bot_mt5_ciclo15.py) com os casos que o log do pregão de 05/Nov/2026 registrou — inclusive
os que viraram ordem errada — e exige o mesmo veredito que o avaliador da tela
(interface_github/src/utils/convergenceEvaluator.ts) daria. Sem este casamento, a tela
mostra um sinal filtrado e o robô opera outro critério.
"""
import sys

import copy
import time

from bot_mt5_ciclo15 import EVAL_CONFIG, ENGINES, RenkoFlowEngine, apply_ea_config, efficiency_ratio, is_exhausted_flow

# O console do Windows é cp850/cp1252 e morre em UnicodeEncodeError ao imprimir travessão
# com a saída redirecionada — que é exatamente o modo como log, launcher e agente rodam isto.
# Forçar UTF-8 no stdout é o que faz o mesmo script valer nas duas máquinas sem perder acento.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

CONFIG_ORIGINAL = copy.deepcopy(EVAL_CONFIG)
FAILS = []


def check(nome, obtido, esperado):
    ok = obtido == esperado
    FAILS.append(nome) if not ok else None
    print(("  ✅ " if ok else "  ❌ ") + f"{nome} | esperado={esperado} obtido={obtido}")


def novo_motor(min_delta=150, simbolo="WINZ26"):
    return RenkoFlowEngine(symbol=simbolo, box_points=50.0, tick_size=5.0, min_delta_threshold=min_delta)


def caixa(index, direcao, delta, close, cvd=0.0):
    return {
        "index": index,
        "direction": direcao,
        "open": close - (50 if direcao == "UP" else -50),
        "close": close,
        "high": close,
        "low": close,
        "ticks_count": 1,
        "buy_volume": max(0, delta),
        "sell_volume": max(0, -delta),
        "delta": delta,
        "cvd_at_close": cvd,
        "timestamp": int(time.time() * 1000),
    }


def julgar(motor, box):
    """Igual ao process_tick: o box entra na lista ANTES de ser julgado."""
    motor.boxes.append(box)
    return motor.check_convergence(box)


def configurar(**kwargs):
    for k, v in kwargs.items():
        EVAL_CONFIG[k] = v


print("\n=== A. Filtro de Delta incondicional (o furo do log de hoje) ===")
# Adaptativo ligado, mas sem estatística de sessão: o corte cai no piso do ativo (WIN = 300).
configurar(strategy_mode="PYRAMID_FLOW_CONFLUENCE", adaptive=True, consolidation_enabled=False, exhaustion_enabled=False)
m = novo_motor(150)
check("WIN UP Δ -686 (virou BUY no log)", julgar(m, caixa(0, "UP", -686, 169695.0))[0], None)
check("WIN UP Δ 299 (1 abaixo do piso do ativo)", julgar(m, caixa(1, "UP", 299, 169745.0))[0], None)
check("WIN UP Δ 300 (no fio do piso de 300)", julgar(m, caixa(2, "UP", 300, 169795.0))[0], "BUY")
check("WIN UP Δ 2500 (verde forte, sob o teto)", julgar(m, caixa(3, "UP", 2500, 169845.0))[0], "BUY")
check("WIN DOWN Δ -2500 (vermelho forte, sob o teto)", julgar(m, caixa(4, "DOWN", -2500, 169795.0))[0], "SELL")
check("WIN UP Δ 3300 (acima do teto anti-clímax de 3200)", julgar(m, caixa(5, "UP", 3300, 169745.0))[0], None)
check("WIN DOWN Δ -100 (abaixo do piso)", julgar(m, caixa(6, "DOWN", -100, 169695.0))[0], None)

print("\n=== B. BITX: base 50 (antes 20) — o que o log deixou passar ===")
mb = novo_motor(50, "BITX26")
check("BIT UP Δ -11 (virou BUY no log)", julgar(mb, caixa(6, "UP", -11, 437900.0))[0], None)
check("BIT UP Δ -6 (virou BUY no log)", julgar(mb, caixa(7, "UP", -6, 438200.0))[0], None)
check("BIT UP Δ 10 (virou BUY no log)", julgar(mb, caixa(8, "UP", 10, 438100.0))[0], None)
check("BIT DOWN Δ -7 (virou SELL no log)", julgar(mb, caixa(9, "DOWN", -7, 438000.0))[0], None)
check("BIT UP Δ 74 (agressão real)", julgar(mb, caixa(10, "UP", 74, 438300.0))[0], "BUY")

print("\n=== C. Piso estático da Pirâmide: max(piso 300, minDelta) ===")
configurar(adaptive=False)
mw = novo_motor(30)  # WDO: base 30, mas o gate da Pirâmide nunca aceita menos que o piso de 300
check("WDO UP Δ 90 com base 30", julgar(mw, caixa(0, "UP", 90, 5.0))[0], None)
check("WDO UP Δ 300 com base 30 (no piso)", julgar(mw, caixa(1, "UP", 300, 5.0))[0], "BUY")

print("\n=== D. Filtro de consolidação (Efficiency Ratio) ===")
configurar(adaptive=True, consolidation_enabled=True, consolidation_lookback=10, consolidation_er_max=0.35)
acum = novo_motor(150)
# Range curto: 9 boxes alternando em degraus de 50 pts — saldo 1 degrau, caminho 450 pts.
p_prev = 169645.0
for i in range(9):
    dir_i = "UP" if i % 2 == 0 else "DOWN"
    close_i = p_prev + (50 if dir_i == "UP" else -50)
    acum.boxes.append(caixa(i, dir_i, 200 if dir_i == "UP" else -200, close_i))
    p_prev = close_i
er = efficiency_ratio(acum.boxes, caixa(9, "UP", 2500, p_prev + 50), 10)
print(f"     ER medido no range = {er:.3f} (bloqueia abaixo de {EVAL_CONFIG['consolidation_er_max']})")
check("UP Δ 2500 dentro de acumulação", julgar(acum, caixa(9, "UP", 2500, p_prev + 50))[0], None)
configurar(consolidation_enabled=False)
check("mesmo box com filtro desligado", julgar(acum, caixa(10, "UP", 2500, p_prev + 50))[0], "BUY")

print("\n=== E. Filtro de exaustão de fluxo ===")
configurar(consolidation_enabled=False, exhaustion_enabled=True, exhaustion_ratio=0.7)
exausto = novo_motor(150)
exausto.boxes.append(caixa(0, "UP", 500, 169695.0))
check("unidade is_exhausted_flow(300 vs 500)", is_exhausted_flow(exausto.boxes, caixa(1, "UP", 300, 169745.0), 0.7), True)
check("unidade is_exhausted_flow(360 vs 500)", is_exhausted_flow(exausto.boxes, caixa(1, "UP", 360, 169745.0), 0.7), False)
check("UP Δ 300 após Δ 500 (fluxo emagrecendo)", julgar(exausto, caixa(1, "UP", 300, 169745.0))[0], None)
configurar(exhaustion_enabled=False)
check("mesmo box com filtro desligado", julgar(exausto, caixa(2, "UP", 300, 169795.0))[0], "BUY")

print("\n=== F. Limiar CALCULADO da sessão (percentil), não número físico ===")
configurar(adaptive=True, exhaustion_enabled=False)
sessao = novo_motor(150)
agora = time.time()
for d in [100, 120, 140, 160, 180, 200, 220, 240, 260, 1000]:
    sessao.regime_meter.feed_closed_box(agora * 1000, 500, d)
pct_sessao = EVAL_CONFIG["percentile"]
limiar = sessao.regime_meter.get_percentile_limit(150, "BUY", pct_sessao)
print(f"     P{int(pct_sessao * 100)} das agressões de compra deste pregão = {limiar}")
check(f"P{int(pct_sessao * 100)} das magnitudes = 240", limiar, 240)
check("UP Δ 200 (abaixo do percentil e do piso)", julgar(sessao, caixa(10, "UP", 200, 169695.0))[0], None)
check("UP Δ 2000 (acima do piso de 300)", julgar(sessao, caixa(11, "UP", 2000, 169745.0))[0], "BUY")

print("\n=== G. SYNC_EA_CONFIG: a tela manda nas regras ===")
ENGINES["WINZ26"] = novo_motor(150)
apply_ea_config({
    "symbol": "WINZ26",
    "minDeltaThreshold": 250,
    "adaptiveThresholdEnabled": False,
    "consolidationFilterEnabled": True,
    "exhaustionFilterEnabled": True,
    "strategyMode": "PULLBACK_RETEST",
})
check("piso de segurança do WIN religa o adaptativo (tela pediu False)", EVAL_CONFIG["adaptive"], True)
check("EVAL_CONFIG.strategy_mode veio da tela", EVAL_CONFIG["strategy_mode"], "PULLBACK_RETEST")
check("EVAL_CONFIG.exhaustion_enabled veio da tela", EVAL_CONFIG["exhaustion_enabled"], True)
check("base de Delta do WINZ26 respeita o piso de 300", ENGINES["WINZ26"].min_delta_threshold, 300)
apply_ea_config({"strategyMode": "PYRAMID_FLOW_CONFLUENCE", "adaptiveThresholdEnabled": True, "exhaustionFilterEnabled": False})
check("SYNC parcial não zera os demais filtros", EVAL_CONFIG["consolidation_enabled"], True)

print("\n=== H. Defaults da ponte (o app sobrescreve no SYNC) ===")
check("adaptive ligada por padrão", CONFIG_ORIGINAL["adaptive"], True)
check("percentil P70 por padrão", CONFIG_ORIGINAL["percentile"], 0.7)
check("filtro de acumulação ligado por padrão", CONFIG_ORIGINAL["consolidation_enabled"], True)
check("janela ER = 10 boxes", CONFIG_ORIGINAL["consolidation_lookback"], 10)
check("ER máximo = 0,35", CONFIG_ORIGINAL["consolidation_er_max"], 0.35)
check("exaustão ligada por padrão", CONFIG_ORIGINAL["exhaustion_enabled"], True)
check("piso estático = 300", CONFIG_ORIGINAL["pyramid_static_floor"], 300)
check("teto anti-clímax = 3200", CONFIG_ORIGINAL["max_delta_ceiling"], 3200)
check("filtro de tendência do fluxo ligado por padrão", CONFIG_ORIGINAL["flow_trend_filter"], True)
check("janela padrão do filtro de fluxo = 20 boxes", CONFIG_ORIGINAL["flow_trend_lookback"], 20)

for k, v in CONFIG_ORIGINAL.items():
    EVAL_CONFIG[k] = v
ENGINES.pop("WINZ26", None)

print("\n=== I. Filtro de tendência do fluxo (a cor do indicador) ===")
from bot_mt5_ciclo15 import flow_trend

configurar(strategy_mode="PYRAMID_FLOW_CONFLUENCE", adaptive=True, consolidation_enabled=False,
           exhaustion_enabled=False, flow_trend_lookback=10, flow_trend_filter=False)

# Série com CVD CAINDO (fluxo vermelho) e um box verde teimoso no fim: é o sinal que o filtro existe
# para matar — comprar contra o fluxo do pregão.
caindo = novo_motor(150)
for i in range(12):
    caindo.boxes.append(caixa(i, "DOWN", -400, 169695.0 - i * 50, cvd=float(1200 - i * 100)))
check("tendência medida (CVD caindo)", flow_trend(caindo.boxes[:-1], caindo.boxes[-1], 10), -1)
check("BUY contra o fluxo, filtro DESLIGADO",
      julgar(caindo, caixa(12, "UP", 2500, 169695.0 - 12 * 50 + 50, cvd=0.0))[0], "BUY")
configurar(flow_trend_filter=True)
check("mesmo BUY com filtro LIGADO",
      julgar(caindo, caixa(13, "UP", 2500, 169695.0 - 12 * 50 + 100, cvd=0.0))[0], None)

# Espelho: CVD subindo com SELL força o robô de venda a calar.
subindo = novo_motor(150)
for i in range(12):
    subindo.boxes.append(caixa(i, "UP", 400, 169695.0 + i * 50, cvd=float(i * 100)))
check("tendência medida (CVD subindo)", flow_trend(subindo.boxes[:-1], subindo.boxes[-1], 10), 1)
check("SELL contra o fluxo com filtro LIGADO",
      julgar(subindo, caixa(12, "DOWN", -2500, 169695.0 + 12 * 50 - 50, cvd=1200.0))[0], None)
configurar(flow_trend_filter=False)
check("mesmo SELL com filtro DESLIGADO",
      julgar(subindo, caixa(13, "DOWN", -2500, 169695.0 + 12 * 50 - 100, cvd=1300.0))[0], "SELL")

# A favor da tendência nada muda: o filtro reduz lado, não bloqueia o lado certo.
configurar(flow_trend_filter=True)
check("BUY a favor do fluxo com filtro LIGADO",
      julgar(subindo, caixa(14, "UP", 2500, 169695.0 + 14 * 50, cvd=1500.0))[0], "BUY")
check("janela maior que a série não bloqueia",
      flow_trend(subindo.boxes[:2], subindo.boxes[2], 30), 0)
configurar(flow_trend_filter=False)

print("\n" + "=" * 62)
if FAILS:
    print(f"❌ {len(FAILS)} VEREDITO(S) FORA DA REGRA DA TELA:")
    for f in FAILS:
        print("   - " + f)
    raise SystemExit(1)
print("✅ PARIDADE CONFIRMADA: a ponte julga exatamente como a tela desenha.")
