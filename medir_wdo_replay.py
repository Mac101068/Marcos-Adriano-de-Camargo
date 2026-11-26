# -*- coding: utf-8 -*-
"""
medir_wdo_replay.py — Medição de Pullback Retest e Anti-Clímax no Mini-Dólar (WDOZ26)
RoboFluxoB3 — Laboratório Quantitativo

Objetivo:
Verificar se o padrão comprovado no WIN (Anti-Clímax Score 4..6 + Pullback) também se replica
no Mini-Dólar B3 sobre os dados reais de data/wdoz26_ticks.csv.gz (outubro a novembro).

Especificação WDO:
  Tick size: 0.5 pt
  Box size: 2.5 pt (5R)
  SL: 2.5 pt (1 box)
  TP: 5.0 pt (2 boxes)
  Pullback testado: 1.0 pt e 1.5 pt (meio box)
"""

import os
import sys
import argparse
from datetime import datetime
import pandas as pd

from bot_mt5_ciclo15 import EVAL_CONFIG, RenkoFlowEngine, flow_trend

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

RAIZ = os.path.dirname(os.path.abspath(__file__))
CAMINHO_WDO = os.path.join(RAIZ, "data", "wdoz26_ticks.csv.gz")

SL_PONTOS = 2.5
TP_PONTOS = 5.0
TICK_SIZE = 0.5
BOX_POINTS = 2.5
JANELA_FILTRO = 20
INICIO_PADRAO = "08:55"
FIM_PADRAO = "18:00"

EVAL_CONFIG.update({
    "strategy_mode": "PYRAMID_FLOW_CONFLUENCE",
    "adaptive": True,
    "percentile": 0.6,
    "consolidation_enabled": True,
    "consolidation_lookback": 10,
    "consolidation_er_max": 0.35,
    "exhaustion_enabled": False,
    "anti_absorption_enabled": True,
    "pyramid_static_floor": 30,  # Piso de WDO
    "flow_trend_filter": False,
    "flow_trend_lookback": JANELA_FILTRO,
})


class CarteiraWDO:
    def __init__(self, nome, pullback_pts=0.0, min_score=0, max_score=10, max_wait_boxes=2):
        self.nome = nome
        self.pullback_pts = pullback_pts
        self.min_score = min_score
        self.max_score = max_score
        self.max_wait_boxes = max_wait_boxes
        
        self.pos = None
        self.pendente = None
        self.trades = []

    def _fechar(self, preco, motivo):
        p = self.pos
        ganho = (preco - p["entrada"]) if p["lado"] == "BUY" else (p["entrada"] - preco)
        self.trades.append({
            "lado": p["lado"],
            "entrada": p["entrada"],
            "saida": preco,
            "pontos": ganho,
            "motivo": motivo,
            "score": p["score"],
            "tendencia": p["tendencia"],
            "hora": p["hora"],
        })
        self.pos = None

    def no_tick(self, preco):
        if self.pendente:
            lado_pend = self.pendente["lado"]
            alvo_p = self.pendente["preco_limite"]
            filled = (preco <= alvo_p) if lado_pend == "BUY" else (preco >= alvo_p)
            if filled:
                if self.pos:
                    if self.pos["lado"] != lado_pend:
                        self._fechar(alvo_p, "FLIP")
                self.pos = {
                    "lado": lado_pend,
                    "entrada": alvo_p,
                    "indice": self.pendente["indice"],
                    "tendencia": self.pendente["tendencia"],
                    "score": self.pendente["score"],
                    "hora": self.pendente["hora"],
                }
                self.pendente = None

        if self.pos:
            p = self.pos
            entrada = p["entrada"]
            if p["lado"] == "BUY":
                if preco <= entrada - SL_PONTOS:
                    self._fechar(entrada - SL_PONTOS, "SL")
                elif preco >= entrada + TP_PONTOS:
                    self._fechar(entrada + TP_PONTOS, "TP")
            else:
                if preco >= entrada + SL_PONTOS:
                    self._fechar(entrada + SL_PONTOS, "SL")
                elif preco <= entrada - TP_PONTOS:
                    self._fechar(entrada - TP_PONTOS, "TP")

    def no_box(self, box_idx):
        if self.pendente:
            if box_idx - self.pendente["indice"] >= self.max_wait_boxes:
                self.pendente = None

    def no_sinal(self, preco_close, lado, indice, tendencia, score, hora):
        contra = (lado == "BUY" and tendencia < 0) or (lado == "SELL" and tendencia > 0)
        if contra:
            return True

        if not (self.min_score <= score <= self.max_score):
            return True

        if self.pullback_pts <= 0.0:
            if self.pos:
                if self.pos["lado"] == lado:
                    return False
                self._fechar(preco_close, "FLIP")
            self.pos = {
                "lado": lado,
                "entrada": preco_close,
                "indice": indice,
                "tendencia": tendencia,
                "score": score,
                "hora": hora,
            }
            return False
        else:
            lim_price = (preco_close - self.pullback_pts) if lado == "BUY" else (preco_close + self.pullback_pts)
            self.pendente = {
                "lado": lado,
                "preco_limite": lim_price,
                "indice": indice,
                "tendencia": tendencia,
                "score": score,
                "hora": hora,
            }
            return False

    def encerrar_dia(self, preco):
        self.pendente = None
        if self.pos:
            self._fechar(preco, "FIM")


def calcular_estatisticas(trades):
    if not trades:
        return {
            "n": 0, "total": 0.0, "media": 0.0, "acerto": 0.0,
            "tp": 0, "sl": 0, "flip": 0, "fim": 0,
            "max_dd": 0.0, "fator_lucro": 0.0
        }
    pts = [t["pontos"] for t in trades]
    total = sum(pts)
    vitorias = [p for p in pts if p > 0]
    derrotas = [p for p in pts if p < 0]
    soma_vitorias = sum(vitorias)
    soma_derrotas = abs(sum(derrotas))
    fator_lucro = (soma_vitorias / soma_derrotas) if soma_derrotas > 0 else (99.0 if soma_vitorias > 0 else 0.0)

    curva = []
    acum = 0.0
    pico = 0.0
    max_dd = 0.0
    for p in pts:
        acum += p
        curva.append(acum)
        if acum > pico:
            pico = acum
        dd = pico - acum
        if dd > max_dd:
            max_dd = dd

    tp = sum(1 for t in trades if t["motivo"] == "TP")
    sl = sum(1 for t in trades if t["motivo"] == "SL")
    fl = sum(1 for t in trades if t["motivo"] == "FLIP")
    fim = sum(1 for t in trades if t["motivo"] == "FIM")
    acerto = (len(vitorias) / len(trades) * 100.0) if trades else 0.0

    return {
        "n": len(trades),
        "total": total,
        "media": total / len(trades),
        "acerto": acerto,
        "tp": tp,
        "sl": sl,
        "flip": fl,
        "fim": fim,
        "max_dd": max_dd,
        "fator_lucro": fator_lucro
    }


def main():
    print(f"🔬 [LAB QUANT WDO] Carregando base consolidada do Mini-Dólar: {CAMINHO_WDO}...", flush=True)
    df = pd.read_csv(CAMINHO_WDO).dropna(subset=["time_msc"])
    if "last" in df.columns:
        df["last"] = pd.to_numeric(df["last"], errors="coerce").replace(0, pd.NA)
        df["last"] = df["last"].fillna(df["bid"])

    # Adiciona data e hora
    dts = pd.to_datetime(df["time_msc"], unit="ms")
    df["data_str"] = dts.dt.strftime("%Y%m%d")
    df["hora_str"] = dts.dt.strftime("%H:%M")
    
    # Filtra horário regular (08:55 às 18:00)
    df = df[(df["hora_str"] >= INICIO_PADRAO) & (df["hora_str"] < FIM_PADRAO)]

    dias = sorted(df["data_str"].unique())
    print(f"   Total de dias identificados na fita do WDO: {len(dias)} pregões ({dias[0]} a {dias[-1]})\n", flush=True)

    carteiras = {
        "1. Base (Close, Sem Filtro Score)": CarteiraWDO("Base", pullback_pts=0.0, min_score=0, max_score=10),
        "2. Anti-Clímax (Close, Score 4..6)": CarteiraWDO("AntiClimax Close", pullback_pts=0.0, min_score=4, max_score=6),
        "3. Pullback 1.0pt (Todos Scores)": CarteiraWDO("PB 1.0pt Todos", pullback_pts=1.0, min_score=0, max_score=10),
        "4. Pullback 1.0pt (Score 4..6)": CarteiraWDO("PB 1.0pt Score 4..6", pullback_pts=1.0, min_score=4, max_score=6),
        "5. Pullback 1.5pt (Score 4..6)": CarteiraWDO("PB 1.5pt Score 4..6", pullback_pts=1.5, min_score=4, max_score=6),
        "6. Pullback 2.5pt (Box Open, Score 4..6)": CarteiraWDO("PB 2.5pt Box Open", pullback_pts=2.5, min_score=4, max_score=6),
    }

    engine = RenkoFlowEngine(symbol="WDOZ26", box_points=BOX_POINTS, tick_size=TICK_SIZE, min_delta_threshold=30)

    for i, dia in enumerate(dias, 1):
        df_dia = df[df["data_str"] == dia].to_dict("records")
        ultimo = 0.0

        for t in df_dia:
            flags = int(t.get("flags") or 0)
            vol = int(t.get("volume") or t.get("volume_real") or 1)
            preco = float(t.get("last") or t.get("bid") or t.get("ask") or 0)
            if preco <= 0:
                continue
            ts = int(t["time_msc"])
            ultimo = preco
            agressor = "BUY" if (flags & 32) else ("SELL" if (flags & 64) else "CROSS")

            for c in carteiras.values():
                c.no_tick(preco)

            box, sinal, _motivo = engine.process_tick(preco, vol, agressor, ts)
            if box:
                for c in carteiras.values():
                    c.no_box(box["index"])

                if sinal:
                    tend = flow_trend(engine.boxes[:-1], box, JANELA_FILTRO)
                    score = box.get("flow_score", 5)
                    hora_sinal = t["hora_str"]
                    for c in carteiras.values():
                        c.no_sinal(preco, sinal, box["index"], tend, score, hora_sinal)

        for c in carteiras.values():
            c.encerrar_dia(ultimo)

        # Progresso
        b_p = sum(t["pontos"] for t in carteiras["1. Base (Close, Sem Filtro Score)"].trades[-10:])
        opt_p = sum(t["pontos"] for t in carteiras["4. Pullback 1.0pt (Score 4..6)"].trades[-10:])
        print(f"  [{i:>2}/{len(dias)}] {dia} | Dia concluído", flush=True)

    print("\n" + "=" * 105)
    print(f"📊 RESULTADO COMPARATIVO NO MINI-DÓLAR WDO ({len(dias)} PREGÕES REAIS)")
    print("=" * 105)
    header = f"{'Estratégia WDO':<38} | {'Trades':>6} | {'PnL Total':>10} | {'Média':>7} | {'Acerto':>7} | {'PF':>5} | {'Max DD':>8} | {'TP / SL / FLIP'}"
    print(header)
    print("-" * 105)

    for k, c in carteiras.items():
        st = calcular_estatisticas(c.trades)
        detalhe = f"{st['tp']} / {st['sl']} / {st['flip']}"
        print(f"{k:<38} | {st['n']:>6} | {st['total']:>+9.1f} pt | {st['media']:>+6.2f} | {st['acerto']:>6.1f}% | {st['fator_lucro']:>5.2f} | {st['max_dd']:>7.1f} pt | {detalhe}")

    print("=" * 105)


if __name__ == "__main__":
    main()
