import sys
from fluxo_atemporal_modulo import RenkoFlowEngine

engine = RenkoFlowEngine(box_points=50)

# Simular ticks subindo e revertendo
ticks = [
    (130000, 10, 'BUY'),
    (130025, 50, 'BUY'),
    (130050, 120, 'BUY'), # Fecha box 0 UP (130000 -> 130050)
    (130080, 80, 'BUY'),
    (130100, 100, 'BUY'), # Fecha box 1 UP (130050 -> 130100)
    (130050, 60, 'SELL'),
    (130000, 200, 'SELL'), # Reversão de 2 boxes (100 pts): fecha box 2 DOWN (130050 -> 130000)
]

for p, v, agg in ticks:
    box, sig, reason = engine.process_tick(p, v, agg)
    if box:
        print(f"Box #{box['index']}: {box['direction']} Open={box['open']} Close={box['close']} Delta={box['delta']} Signal={sig} Reason={reason}")

print("Total de boxes fechados:", len(engine.boxes))
print("CVD Final:", engine.cvd)
