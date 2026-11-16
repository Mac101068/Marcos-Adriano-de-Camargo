import sys
from datetime import datetime
from bot_mt5_ciclo15 import get_time_based_regime, RenkoFlowEngine

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

base_date = '2026-11-10 '
horas = [
    '09:15:00',
    '10:15:00',
    '11:00:00',
    '12:30:00',
    '13:45:00',
    '14:30:00',
    '16:15:00',
    '17:15:00',
    '18:00:00'
]

print("=== TESTE DA GRADE DE REGIME POR HORÁRIO DA FITA ===")
for h in horas:
    dt = datetime.strptime(base_date + h, '%Y-%m-%d %H:%M:%S')
    ts_msc = int(dt.timestamp() * 1000)
    res = get_time_based_regime(ts_msc)
    print(f"[{h}] Fase: {res['phase']:15} | P{int(res['percentile']*100)} | DivMin: {int(res['flow_divergence_min']*100)}% | Piso: {res['floor_multiple']}x | {res['desc']}")

print("\n=== TESTE DE JULGAMENTO DE BOX NO MEIO-DIA VS ABERTURA ===")
eng = RenkoFlowEngine(symbol="WINZ26", box_points=50.0, tick_size=5.0, min_delta_threshold=150)
for d in [100, 120, 140, 160, 180, 200, 220, 240, 260, 280]:
    eng.regime_meter.feed_closed_box(int(datetime.strptime(base_date + '09:30:00', '%Y-%m-%d %H:%M:%S').timestamp() * 1000), 500, d)

# Box às 09:35 (Abertura): P70 ~ 220, DivMin 15%
ts_abertura = int(datetime.strptime(base_date + '09:35:00', '%Y-%m-%d %H:%M:%S').timestamp() * 1000)
box_abertura = {
    "index": 1,
    "direction": "UP",
    "open": 169000,
    "close": 169050,
    "delta": 280,
    "total_volume": 1400, # 280 / 1400 = 20% div (passa no 15% da abertura, mas reprova no 25% do almoço)
    "timestamp": ts_abertura,
}
eng.boxes.append(box_abertura)
sig_ab, r_ab = eng.check_convergence(box_abertura)
print(f"Abertura (09:35): Sinal={sig_ab} | Motivo={box_abertura['audit']['motivo']} | Fase={box_abertura['audit']['fase_horario']}")

# Mesmo box às 12:35 (Meio-dia): P80 ~ 240, DivMin 25%
ts_almoço = int(datetime.strptime(base_date + '12:35:00', '%Y-%m-%d %H:%M:%S').timestamp() * 1000)
box_almoco = {
    "index": 2,
    "direction": "UP",
    "open": 169050,
    "close": 169100,
    "delta": 350,
    "total_volume": 2000, # 350 / 2000 = 17.5% div (< 25% exigido no almoço)
    "timestamp": ts_almoço,
}
eng.boxes.append(box_almoco)
sig_al, r_al = eng.check_convergence(box_almoco)
print(f"Meio-dia (12:35): Sinal={sig_al} | Motivo={box_almoco['audit']['motivo']} | Fase={box_almoco['audit']['fase_horario']}")
