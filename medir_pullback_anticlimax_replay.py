# -*- coding: utf-8 -*-
"""
medir_pullback_anticlimax_replay.py — Medição de Pullback Retest e Filtro Anti-Clímax
RoboFluxoB3 — Laboratório Quantitativo

Objetivo:
Avaliar as 2 alavancas de performance nos 22 pregões reais do WIN:
1. Entrada em Pullback (Half Box / 25 pts) vs Entrada a Mercado no Fechamento (Market on Close).
2. Filtro Anti-Clímax (foco no fluxo sustentável Score 4..6, eliminando o clímax de exaustão).
3. Efeito combinado: Pullback 25 pts + Anti-Clímax.
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
PASTA = os.path.join(RAIZ, "data", "pregoes")

SL_PONTOS = 50.0
TP_PONTOS = 100.0
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
    "pyramid_static_floor": 50,
    "flow_trend_filter": False,
    "flow_trend_lookback": JANELA_FILTRO,
})


class CarteiraPullback:
    def __init__(self, nome, pullback_pts=0.0, min_score=0, max_score=10, max_wait_boxes=2):
        self.nome = nome
        self.pullback_pts = pullback_pts  # 0.0 = Market on Close, 25.0 = Half Box, 50.0 = Box Open
        self.min_score = min_score
        self.max_score = max_score
        self.max_wait_boxes = max_wait_boxes
        
        self.pos = None        # Posição ativa
        self.pendente = None   # Ordem limitada pendente
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
        # 1. Se tem ordem pendente de pullback, verifica fill
        if self.pendente:
            lado_pend = self.pendente["lado"]
            alvo_p = self.pendente["preco_limite"]
            filled = (preco <= alvo_p) if lado_pend == "BUY" else (preco >= alvo_p)
            if filled:
                # Fill confirmado no preço limite
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

        # 2. Se tem posição ativa, monitora SL e TP
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
        # Expira ordem pendente se passar do limite de caixas sem fill
        if self.pendente:
            if box_idx - self.pendente["indice"] >= self.max_wait_boxes:
                self.pendente = None

    def no_sinal(self, preco_close, lado, indice, tendencia, score, hora):
        contra = (lado == "BUY" and tendencia < 0) or (lado == "SELL" and tendencia > 0)
        if contra:
            return True

        if not (self.min_score <= score <= self.max_score):
            return True  # Barrado pelo filtro de score

        if self.pullback_pts <= 0.0:
            # Entrada a Mercado no Fechamento
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
            # Entrada Limitada em Pullback
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


def carregar_ticks(caminho, inicio=None, fim=None):
    df = pd.read_csv(caminho).dropna(subset=["time_msc"])
    if "last" in df.columns:
        df["last"] = pd.to_numeric(df["last"], errors="coerce").replace(0, pd.NA)
        df["last"] = df["last"].fillna(df["bid"])
    if inicio or fim:
        horas = pd.to_datetime(df["time_msc"], unit="ms").dt.strftime("%H:%M")
        if inicio:
            df = df[horas >= inicio]
        if fim:
            df = df[horas < fim]
    return df.to_dict("records")


def rodar_dia(caminho, inicio=INICIO_PADRAO, fim=FIM_PADRAO):
    engine = RenkoFlowEngine(symbol="WINZ26", box_points=50.0, tick_size=5.0, min_delta_threshold=150)

    carteiras = {
        "1. Base (Close, Sem Filtro Score)": CarteiraPullback("Base", pullback_pts=0.0, min_score=0, max_score=10),
        "2. Anti-Clímax (Close, Score 4..6)": CarteiraPullback("AntiClimax Close", pullback_pts=0.0, min_score=4, max_score=6),
        "3. Pullback 25pts (Todos Scores)": CarteiraPullback("PB 25pts Todos", pullback_pts=25.0, min_score=0, max_score=10),
        "4. Pullback 25pts (Score 4..6)": CarteiraPullback("PB 25pts Score 4..6", pullback_pts=25.0, min_score=4, max_score=6),
        "5. Pullback 25pts (Score >= 5)": CarteiraPullback("PB 25pts Score >= 5", pullback_pts=25.0, min_score=5, max_score=10),
        "6. Pullback 50pts (Box Open, Todos)": CarteiraPullback("PB 50pts Todos", pullback_pts=50.0, min_score=0, max_score=10),
    }

    ticks = carregar_ticks(caminho, inicio=inicio, fim=fim)
    ultimo = 0.0

    for t in ticks:
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
                hora_sinal = datetime.fromtimestamp(ts / 1000).strftime("%H:%M")
                for c in carteiras.values():
                    c.no_sinal(preco, sinal, box["index"], tend, score, hora_sinal)

    for c in carteiras.values():
        c.encerrar_dia(ultimo)

    return {k: c.trades for k, c in carteiras.items()}


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
    ap = argparse.ArgumentParser()
    ap.add_argument("--dias", type=int, default=22)
    ap.add_argument("--inicio", default=INICIO_PADRAO)
    ap.add_argument("--fim", default=FIM_PADRAO)
    args = ap.parse_args()

    arquivos = sorted(f for f in os.listdir(PASTA) if f.startswith("winz26_ticks_") and f.endswith(".csv.gz"))
    arquivos = [os.path.join(PASTA, f) for f in arquivos[-args.dias:]]

    print(f"🔬 [LAB QUANT] Medindo Pullback Retest (25pts/50pts) e Anti-Clímax em {len(arquivos)} pregões...", flush=True)

    acumulados = {
        "1. Base (Close, Sem Filtro Score)": [],
        "2. Anti-Clímax (Close, Score 4..6)": [],
        "3. Pullback 25pts (Todos Scores)": [],
        "4. Pullback 25pts (Score 4..6)": [],
        "5. Pullback 25pts (Score >= 5)": [],
        "6. Pullback 50pts (Box Open, Todos)": [],
    }

    for i, caminho in enumerate(arquivos, 1):
        dia = os.path.basename(caminho).replace("winz26_ticks_", "").replace(".csv.gz", "")
        trades_dia = rodar_dia(caminho, inicio=args.inicio, fim=args.fim)
        for k, tr in trades_dia.items():
            acumulados[k].extend(tr)
        
        b_pts = sum(t["pontos"] for t in trades_dia["1. Base (Close, Sem Filtro Score)"])
        pb_pts = sum(t["pontos"] for t in trades_dia["3. Pullback 25pts (Todos Scores)"])
        pb_opt = sum(t["pontos"] for t in trades_dia["4. Pullback 25pts (Score 4..6)"])
        print(f"  [{i:>2}/{len(arquivos)}] {dia} | Base: {b_pts:+5.0f} pt | PB25: {pb_pts:+5.0f} pt | PB25+Opt: {pb_opt:+5.0f} pt", flush=True)

    print("\n" + "=" * 105)
    print("📊 RESULTADO COMPARATIVO: MERCADO FECHAMENTO vs PULLBACK RETEST vs ANTI-CLÍMAX (22 DIAS)")
    print("=" * 105)
    header = f"{'Estratégia':<36} | {'Trades':>6} | {'PnL Total':>10} | {'Média':>7} | {'Acerto':>7} | {'PF':>5} | {'Max DD':>8} | {'TP / SL / FLIP'}"
    print(header)
    print("-" * 105)

    for k, tr in acumulados.items():
        st = calcular_estatisticas(tr)
        detalhe = f"{st['tp']} / {st['sl']} / {st['flip']}"
        print(f"{k:<36} | {st['n']:>6} | {st['total']:>+9.0f} pt | {st['media']:>+6.1f} | {st['acerto']:>6.1f}% | {st['fator_lucro']:>5.2f} | {st['max_dd']:>7.0f} pt | {detalhe}")

    print("=" * 105)


if __name__ == "__main__":
    main()
