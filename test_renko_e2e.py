"""
Teste de ponta a ponta do modo RENKO_PIRAMIDE_CONFLUENCIA.
1) Leitura de tick no formato real do MT5 (numpy.void)
2) Conexão com o MT5 e replay de ticks históricos (ordens SIMULADAS, nada é enviado)
"""
import sys
import time
import numpy as np

sys.stdout.reconfigure(encoding="utf-8")

from fluxo_atemporal_modulo import extrair_dados_tick

# ── 1) Tick no formato numpy.void (como o MT5 entrega ao vivo) ──
dt = np.dtype([('time', 'i8'), ('bid', 'f8'), ('ask', 'f8'), ('last', 'f8'), ('volume', 'u8'),
               ('time_msc', 'i8'), ('flags', 'u4'), ('volume_real', 'f8')])
a = np.zeros(2, dtype=dt)
a[0] = (0, 130000, 130005, 130005, 3, 1, 32 | 8 | 16, 3.0)   # agressão compradora
a[1] = (0, 130000, 130005, 130000, 2, 2, 64 | 8 | 16, 2.0)   # agressão vendedora
r0, r1 = extrair_dados_tick(a[0]), extrair_dados_tick(a[1])
print("[1] numpy.void ->", r0, r1)
assert r0[2] == "BUY" and r1[2] == "SELL", "Classificação de agressor falhou"
print("[1] OK: leitura de tick do MT5 funcionando\n")

# ── 2) Replay com ticks reais ──
import web_app
from config import ATIVO_ALVO

web_app.state.strategy_mode = "RENKO_PIRAMIDE_CONFLUENCIA"
if not web_app.validar_e_conectar():
    print("[2] MT5 indisponível:", web_app.state.error)
    sys.exit(2)

ativo = sys.argv[1] if len(sys.argv) > 1 else ATIVO_ALVO
ok, msg = web_app.start_simulation(ativo=ativo, velocidade=100, num_ticks=200000, posicao="inicio")
print("[2]", ok, msg)
if not ok:
    sys.exit(3)

inicio = time.time()
while web_app.state.running and time.time() - inicio < 240:
    time.sleep(1)

st = web_app.get_status()
cd = web_app.get_chart_data()
print(f"\n[2] Ticks processados: {st['simulation_processed_ticks']:,}/{st['simulation_total_ticks']:,}")
print(f"[2] Boxes Renko: {len(cd['renko_boxes'])} | CVD final: {cd['cvd']:+.0f}")
print(f"[2] Sinais: {st['signals_count']} | Ordens simuladas: {st['orders_count']}")
print("\n--- Últimos logs ---")
for linha in st["logs"][-25:]:
    print(linha)
