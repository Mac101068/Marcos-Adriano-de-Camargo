"""Quanto os sinais que o filtro de fluxo mata rendem COM A SAÍDA REAL DOS ROBÔS.

A medição anterior (avaliar_filtro_fluxo.py) olhava só o movimento a 3 boxes. Aqui a
simulação usa as regras de saída que estão no bot_mt5_ciclo15.py:

  SL 50 pts · TP 100 pts (spec do WIN)
  FLIP: sinal oposto zera e vira (HOLD_MAIN_UNTIL_FLIP / CLOSE_ALL_ON_FLIP)

Duas carteiras rodam sobre a MESMA fita e o MESMO motor, em paralelo:
  A — sem filtro: todo sinal que o motor der entra (é o robô de hoje).
  B — com filtro: só entra o sinal que concorda com a inclinação do CVD (20 boxes).

As duas têm estado próprio, porque com o filtro ligado um sinal oposto que seria
descartado também deixa de zerar a posição — a saída muda junto com a entrada.

O que interessa no relatório final: os negócios de A abertos por sinal CONTRA a cor do
fluxo. Se eles somam prejuízo, o filtro ganha o que eles perdem.

Rodar:  venv\\Scripts\\python.exe medir_filtro_replay.py --dias 22
"""
import argparse
import os
import sys

import pandas as pd

from bot_mt5_ciclo15 import EVAL_CONFIG, RenkoFlowEngine, flow_trend

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

RAIZ = os.path.dirname(os.path.abspath(__file__))
PASTA = os.path.join(RAIZ, "data", "pregoes")

SL_PONTOS = 50.0    # spec do WIN em bot_mt5_ciclo15.py
TP_PONTOS = 100.0
JANELA_FILTRO = 20

EVAL_CONFIG.update({
    "strategy_mode": "PYRAMID_FLOW_CONFLUENCE",
    "adaptive": True,
    "percentile": 0.6,
    "consolidation_enabled": True,
    "consolidation_lookback": 10,
    "consolidation_er_max": 0.35,
    "exhaustion_enabled": False,
    "anti_absorption_enabled": True,
    "pyramid_static_floor": 50,
    "flow_trend_filter": False,  # o filtro é aplicado AQUI, não no motor: as duas carteiras
                                 # precisam ver o mesmo conjunto de sinais brutos.
    "flow_trend_lookback": JANELA_FILTRO,
})


class Carteira:
    """Uma posição por vez, saída por SL, TP ou FLIP — como a ordem mãe do robô."""

    def __init__(self, nome, com_filtro):
        self.nome = nome
        self.com_filtro = com_filtro
        self.pos = None  # dict: lado, entrada, indice, tendencia
        self.trades = []

    def _fechar(self, preco, motivo):
        p = self.pos
        ganho = (preco - p["entrada"]) if p["lado"] == "BUY" else (p["entrada"] - preco)
        self.trades.append({
            "lado": p["lado"], "entrada": p["entrada"], "saida": preco,
            "pontos": ganho, "motivo": motivo, "tendencia": p["tendencia"],
        })
        self.pos = None

    def no_tick(self, preco):
        if not self.pos:
            return
        p = self.pos
        if p["lado"] == "BUY":
            if preco <= p["entrada"] - SL_PONTOS:
                self._fechar(p["entrada"] - SL_PONTOS, "SL")
            elif preco >= p["entrada"] + TP_PONTOS:
                self._fechar(p["entrada"] + TP_PONTOS, "TP")
        else:
            if preco >= p["entrada"] + SL_PONTOS:
                self._fechar(p["entrada"] + SL_PONTOS, "SL")
            elif preco <= p["entrada"] - TP_PONTOS:
                self._fechar(p["entrada"] - TP_PONTOS, "TP")

    def no_sinal(self, preco, lado, indice, tendencia):
        """Devolve True se o sinal foi DESCARTADO pelo filtro (e por isso não age)."""
        contra = (lado == "BUY" and tendencia < 0) or (lado == "SELL" and tendencia > 0)
        if self.com_filtro and contra:
            return True
        if self.pos:
            if self.pos["lado"] == lado:
                return False  # já está do lado do sinal: sem pirâmide nesta medição
            self._fechar(preco, "FLIP")
        self.pos = {"lado": lado, "entrada": preco, "indice": indice, "tendencia": tendencia}
        return False

    def encerrar_dia(self, preco):
        if self.pos:
            self._fechar(preco, "FIM")


def rodar_dia(caminho):
    engine = RenkoFlowEngine(symbol="WINZ26", box_points=50.0, tick_size=5.0, min_delta_threshold=150)
    todas = Carteira("sem filtro", com_filtro=False)
    filtrada = Carteira("com filtro", com_filtro=True)
    ultimo = 0.0

    for t in pd.read_csv(caminho).dropna(subset=["time_msc"]).to_dict("records"):
        flags = int(t.get("flags") or 0)
        vol = int(t.get("volume") or t.get("volume_real") or 1)
        preco = float(t.get("last") or t.get("bid") or t.get("ask") or 0)
        if preco <= 0:
            continue
        ultimo = preco
        agressor = "BUY" if (flags & 32) else ("SELL" if (flags & 64) else "CROSS")

        # SL/TP são checados tick a tick, antes de julgar o box: o preço tocou primeiro.
        todas.no_tick(preco)
        filtrada.no_tick(preco)

        box, sinal, _motivo = engine.process_tick(preco, vol, agressor, int(t["time_msc"]))
        if box and sinal:
            tendencia = flow_trend(engine.boxes[:-1], box, JANELA_FILTRO)
            todas.no_sinal(preco, sinal, box["index"], tendencia)
            filtrada.no_sinal(preco, sinal, box["index"], tendencia)

    todas.encerrar_dia(ultimo)
    filtrada.encerrar_dia(ultimo)
    return todas.trades, filtrada.trades


def estat(trades):
    if not trades:
        return "    0 negócios"
    pts = [t["pontos"] for t in trades]
    tp = sum(1 for t in trades if t["motivo"] == "TP")
    sl = sum(1 for t in trades if t["motivo"] == "SL")
    fl = sum(1 for t in trades if t["motivo"] == "FLIP")
    fim = sum(1 for t in trades if t["motivo"] == "FIM")
    vitorias = sum(1 for p in pts if p > 0)
    return (f"    {len(trades):>4} negócios | total {sum(pts):+9.1f} pts | média {sum(pts) / len(pts):+7.2f} | "
            f"acerto {100 * vitorias / len(trades):5.1f}% | TP {tp} SL {sl} FLIP {fl} FIM {fim}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dias", type=int, default=22)
    args = ap.parse_args()

    arquivos = sorted(f for f in os.listdir(PASTA)
                      if f.startswith("winz26_ticks_") and f.endswith(".csv.gz"))
    arquivos = [os.path.join(PASTA, f) for f in arquivos[-args.dias:]]

    tudo_sem, tudo_com = [], []
    print(f"\n=== SAÍDA REAL (SL {SL_PONTOS:.0f} · TP {TP_PONTOS:.0f} · FLIP) — "
          f"{len(arquivos)} pregões de fita real ===")
    for caminho in arquivos:
        sem, com = rodar_dia(caminho)
        tudo_sem.extend(sem)
        tudo_com.extend(com)
        dia = os.path.basename(caminho).replace("winz26_ticks_", "").replace(".csv.gz", "")
        print(f"\n{dia}")
        print(f"  sem filtro : {estat(sem)}")
        print(f"  com filtro : {estat(com)}")

    print("\n=== TOTAL ===")
    print(f"  sem filtro : {estat(tudo_sem)}")
    print(f"  com filtro : {estat(tudo_com)}")

    print(f"\n=== OS SINAIS QUE O FILTRO MATA (carteira sem filtro, janela {JANELA_FILTRO}b) ===")
    def is_matado(t):
        return (t["lado"] == "BUY" and t["tendencia"] < 0) or (t["lado"] == "SELL" and t["tendencia"] > 0)

    matados = [t for t in tudo_sem if is_matado(t)]
    mantidos = [t for t in tudo_sem if not is_matado(t)]
    print(f"  matados  : {estat(matados)}")
    print(f"  mantidos : {estat(mantidos)}")
    if matados:
        pts = sorted(t["pontos"] for t in matados)
        print(f"  matados — melhor {pts[-1]:+.0f} pts | pior {pts[0]:+.0f} pts | "
              f"mediana {pts[len(pts) // 2]:+.0f} pts")
        por_lado = {}
        for t in matados:
            n, s = por_lado.get(t["lado"], (0, 0.0))
            por_lado[t["lado"]] = (n + 1, s + t["pontos"])
        for lado, (n, s) in por_lado.items():
            print(f"  matados {lado:<4}: {n:>3} negócios | total {s:+8.1f} pts | média {s / n:+7.2f}")

    print("\nLeitura: se os matados somam prejuízo, o filtro tira do caminho o que custa;")
    print("se somam lucro, ele está cortando o lado que pagava — e o número acima diz quanto.")


if __name__ == "__main__":
    main()
