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
# Adaptativo ligado, mas sem 10 boxes de estatística: cai em base × fator = base (150).
configurar(strategy_mode="PYRAMID_FLOW_CONFLUENCE", adaptive=True, consolidation_enabled=False, exhaustion_enabled=False)
m = novo_motor(150)
check("WIN UP Δ -686 (virou BUY no log)", julgar(m, caixa(0, "UP", -686, 169695.0))[0], None)
check("WIN UP Δ 149 (1 abaixo do limiar)", julgar(m, caixa(1, "UP", 149, 169745.0))[0], None)
check("WIN UP Δ 150 (no fio do limiar)", julgar(m, caixa(2, "UP", 150, 169795.0))[0], "BUY")
check("WIN UP Δ 3782 (verde forte)", julgar(m, caixa(3, "UP", 3782, 169845.0))[0], "BUY")
check("WIN DOWN Δ -4582 (vermelho forte)", julgar(m, caixa(4, "DOWN", -4582, 169795.0))[0], "SELL")
check("WIN DOWN Δ -100 (abaixo do limiar)", julgar(m, caixa(5, "DOWN", -100, 169745.0))[0], None)

print("\n=== B. BITX: base 50 (antes 20) — o que o log deixou passar ===")
mb = novo_motor(50, "BITX26")
check("BIT UP Δ -11 (virou BUY no log)", julgar(mb, caixa(6, "UP", -11, 437900.0))[0], None)
check("BIT UP Δ -6 (virou BUY no log)", julgar(mb, caixa(7, "UP", -6, 438200.0))[0], None)
check("BIT UP Δ 10 (virou BUY no log)", julgar(mb, caixa(8, "UP", 10, 438100.0))[0], None)
check("BIT DOWN Δ -7 (virou SELL no log)", julgar(mb, caixa(9, "DOWN", -7, 438000.0))[0], None)
check("BIT UP Δ 74 (agressão real)", julgar(mb, caixa(10, "UP", 74, 438300.0))[0], "BUY")

print("\n=== C. Piso estático da tela: max(50, minDelta) ===")
configurar(adaptive=False)
mw = novo_motor(30)  # WDO: base 30, mas o gate da Pirâmide nunca aceita menos de 50
check("WDO UP Δ 40 com base 30", julgar(mw, caixa(0, "UP", 40, 5.0))[0], None)
check("WDO UP Δ 60 com base 30", julgar(mw, caixa(1, "UP", 60, 5.0))[0], "BUY")

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
er = efficiency_ratio(acum.boxes, caixa(9, "UP", 4000, p_prev + 50), 10)
print(f"     ER medido no range = {er:.3f} (bloqueia abaixo de {EVAL_CONFIG['consolidation_er_max']})")
check("UP Δ 4000 dentro de acumulação", julgar(acum, caixa(9, "UP", 4000, p_prev + 50))[0], None)
configurar(consolidation_enabled=False)
check("mesmo box com filtro desligado", julgar(acum, caixa(10, "UP", 4000, p_prev + 50))[0], "BUY")

print("\n=== E. Filtro de exaustão de fluxo ===")
configurar(consolidation_enabled=False, exhaustion_enabled=True, exhaustion_ratio=0.7)
exausto = novo_motor(150)
exausto.boxes.append(caixa(0, "UP", 500, 169695.0))
check("unidade is_exhausted_flow(300 vs 500)", is_exhausted_flow(exausto.boxes, caixa(1, "UP", 300, 169745.0), 0.7), True)
check("unidade is_exhausted_flow(360 vs 500)", is_exhausted_flow(exausto.boxes, caixa(1, "UP", 360, 169745.0), 0.7), False)
check("UP Δ 300 após Δ 500 (fluxo emagrecendo)", julgar(exausto, caixa(1, "UP", 300, 169745.0))[0], None)
configurar(exhaustion_enabled=False)
check("mesmo box com filtro desligado", julgar(exausto, caixa(2, "UP", 300, 169795.0))[0], "BUY")

print("\n=== F. Limiar CALCULADO da sessão (P60), não número físico ===")
configurar(adaptive=True, exhaustion_enabled=False)
sessao = novo_motor(150)
agora = time.time()
for d in [100, 120, 140, 160, 180, 200, 220, 240, 260, 1000]:
    sessao.regime_meter.feed_closed_box(agora * 1000, 500, d)
limiar = sessao.regime_meter.get_percentile_limit(150, "BUY", EVAL_CONFIG["percentile"])
print(f"     P60 das agressões de compra deste pregão = {limiar}")
check("P60 = 6º percentil das magnitudes", limiar, 220)
check("UP Δ 200 (abaixo do P60)", julgar(sessao, caixa(10, "UP", 200, 169695.0))[0], None)
check("UP Δ 240 (acima do P60)", julgar(sessao, caixa(11, "UP", 240, 169745.0))[0], "BUY")

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
check("EVAL_CONFIG.adaptive veio da tela", EVAL_CONFIG["adaptive"], False)
check("EVAL_CONFIG.strategy_mode veio da tela", EVAL_CONFIG["strategy_mode"], "PULLBACK_RETEST")
check("EVAL_CONFIG.exhaustion_enabled veio da tela", EVAL_CONFIG["exhaustion_enabled"], True)
check("base de Delta do WINZ26 veio da tela", ENGINES["WINZ26"].min_delta_threshold, 250)
apply_ea_config({"strategyMode": "PYRAMID_FLOW_CONFLUENCE", "adaptiveThresholdEnabled": True, "exhaustionFilterEnabled": False})
check("SYNC parcial não zera os demais filtros", EVAL_CONFIG["consolidation_enabled"], True)

print("\n=== H. Defaults da ponte = defaults do app ===")
check("adaptive ligada como no app", CONFIG_ORIGINAL["adaptive"], True)
check("percentil P60 como no app", CONFIG_ORIGINAL["percentile"], 0.6)
check("filtro de acumulação ligado como no app", CONFIG_ORIGINAL["consolidation_enabled"], True)
check("janela ER = 10 boxes como no app", CONFIG_ORIGINAL["consolidation_lookback"], 10)
check("ER máximo = 0,35 como no app", CONFIG_ORIGINAL["consolidation_er_max"], 0.35)
check("exaustão desligada como no app", CONFIG_ORIGINAL["exhaustion_enabled"], False)
check("piso estático = 50 como no app", CONFIG_ORIGINAL["pyramid_static_floor"], 50)

for k, v in CONFIG_ORIGINAL.items():
    EVAL_CONFIG[k] = v
ENGINES.pop("WINZ26", None)

print("\n" + "=" * 62)
if FAILS:
    print(f"❌ {len(FAILS)} VEREDITO(S) FORA DA REGRA DA TELA:")
    for f in FAILS:
        print("   - " + f)
    raise SystemExit(1)
print("✅ PARIDADE CONFIRMADA: a ponte julga exatamente como a tela desenha.")
