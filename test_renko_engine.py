import sys
from fluxo_atemporal_modulo import RenkoFlowEngine

# O console do Windows é cp850/cp1252 e morre em UnicodeEncodeError ao imprimir travessão
# com a saída redirecionada — que é exatamente o modo como log, launcher e agente rodam isto.
# Forçar UTF-8 no stdout é o que faz o mesmo script valer nas duas máquinas sem perder acento.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

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
