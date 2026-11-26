#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
medir_piramide_replay.py

Compara o desempenho da estratégia de Piramidação sobre a FITA REAL (data/pregoes/*.csv.gz):
  1. Base_Sem_Piramide    : Apenas Ordem Mãe simples (1 ctro, SL 50 / TP 100 / FLIP).
  2. Piramide_Atual       : Pirâmide como hoje (adiciona a cada box a favor, BE da mãe só no TP, trailing colado a 1 tick).
  3. Piramide_Otimizada   : Pirâmide com Breakeven imediato no fill, trailing com respiro de 1 box (N-1) e filtro de flow_score >= 7.

100% Read-Only: Não altera arquivos, não envia ordens ao MT5, usa replay histórico local.
"""

import argparse
import os
import sys
from datetime import datetime
import pandas as pd

from bot_mt5_ciclo15 import EVAL_CONFIG, RenkoFlowEngine, flow_trend

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

RAIZ = os.path.dirname(os.path.abspath(__file__))
PASTA = os.path.join(RAIZ, "data", "pregoes")

SL_PONTOS = 50.0
TP_PONTOS = 100.0
BE_OFFSET = 15.0  # +15 pts no WIN para cobrir custos de corretagem e emolumentos B3
MAX_PYRAMIDS = 2
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
    "flow_trend_filter": True,
    "flow_trend_lookback": JANELA_FILTRO,
})


class SimuladorBaseSemPiramide:
    """Modelo 1: Apenas Ordem Mãe simples (1 contrato fixo)."""
    def __init__(self):
        self.pos = None
        self.trades = []

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

    def on_box(self, box, sinal):
        if not sinal:
            return
        preco = box["close"]
        lado = sinal
        if self.pos:
            if self.pos["lado"] != lado:
                self._fechar(preco, "FLIP")
                self.pos = {"lado": lado, "entrada": preco, "vol": 1.0}
        else:
            self.pos = {"lado": lado, "entrada": preco, "vol": 1.0}

    def _fechar(self, preco, motivo):
        p = self.pos
        pts = (preco - p["entrada"]) if p["lado"] == "BUY" else (p["entrada"] - preco)
        self.trades.append({
            "lado": p["lado"], "pontos": pts, "vol": 1.0,
            "pnl_financeiro": pts * 0.20, "motivo": motivo
        })
        self.pos = None

    def encerrar_dia(self, preco):
        if self.pos:
            self._fechar(preco, "FIM")


class SimuladorPiramideAtual:
    """Modelo 2: Pirâmide Atual (Trailing colado a 1 tick, BE só no TP da pirâmide)."""
    def __init__(self):
        self.main_pos = None
        self.pyr_positions = []
        self.trades = []

    def no_tick(self, preco):
        # 1. Checa posições de pirâmide
        for pyr in list(self.pyr_positions):
            lado = pyr["lado"]
            if lado == "BUY":
                if preco <= pyr["sl"]:
                    self._fechar_pyr(pyr, pyr["sl"], "SL_PYR")
                elif preco >= pyr["tp"]:
                    self._fechar_pyr(pyr, pyr["tp"], "TP_PYR")
                    # No modelo atual, mover mãe para BE somente no TP da pirâmide
                    if self.main_pos:
                        be_preco = self.main_pos["entrada"] + (BE_OFFSET if lado == "BUY" else -BE_OFFSET)
                        if (lado == "BUY" and be_preco > self.main_pos["sl"]) or (lado == "SELL" and be_preco < self.main_pos["sl"]):
                            self.main_pos["sl"] = be_preco
            else:
                if preco >= pyr["sl"]:
                    self._fechar_pyr(pyr, pyr["sl"], "SL_PYR")
                elif preco <= pyr["tp"]:
                    self._fechar_pyr(pyr, pyr["tp"], "TP_PYR")
                    if self.main_pos:
                        be_preco = self.main_pos["entrada"] - BE_OFFSET
                        if be_preco < self.main_pos["sl"]:
                            self.main_pos["sl"] = be_preco

        # 2. Checa posição mãe
        if self.main_pos:
            m = self.main_pos
            if m["lado"] == "BUY":
                if preco <= m["sl"]:
                    self._fechar_main(m["sl"], "SL_MAIN")
                elif preco >= m["tp"]:
                    self._fechar_main(m["tp"], "TP_MAIN")
            else:
                if preco >= m["sl"]:
                    self._fechar_main(m["sl"], "SL_MAIN")
                elif preco <= m["tp"]:
                    self._fechar_main(m["tp"], "TP_MAIN")

    def on_box(self, box, sinal):
        preco = box["close"]
        b_dir = box.get("direction")
        b_open = float(box.get("open", preco))

        # Trailing colado a 1 tick (regra atual de bot_mt5_ciclo15.py:2141)
        if self.main_pos:
            is_buy = self.main_pos["lado"] == "BUY"
            if is_buy and b_dir == "UP":
                cand_sl = b_open - 5.0
                if cand_sl > self.main_pos["sl"]:
                    self.main_pos["sl"] = cand_sl
            elif not is_buy and b_dir == "DOWN":
                cand_sl = b_open + 5.0
                if cand_sl < self.main_pos["sl"]:
                    self.main_pos["sl"] = cand_sl

        # Flip de posição se vier sinal oposto
        if sinal:
            if self.main_pos and self.main_pos["lado"] != sinal:
                self._zerar_tudo(preco, "FLIP")
                self._abrir_main(sinal, preco)
                return

            if not self.main_pos:
                self._abrir_main(sinal, preco)
            elif len(self.pyr_positions) < MAX_PYRAMIDS:
                # Piramidação: adiciona no mesmo lado
                sl = preco - SL_PONTOS if sinal == "BUY" else preco + SL_PONTOS
                tp = preco + TP_PONTOS if sinal == "BUY" else preco - TP_PONTOS
                self.pyr_positions.append({"lado": sinal, "entrada": preco, "sl": sl, "tp": tp, "vol": 1.0})

    def _abrir_main(self, lado, preco):
        sl = preco - SL_PONTOS if lado == "BUY" else preco + SL_PONTOS
        tp = preco + TP_PONTOS if lado == "BUY" else preco - TP_PONTOS
        self.main_pos = {"lado": lado, "entrada": preco, "sl": sl, "tp": tp, "vol": 1.0}

    def _fechar_main(self, preco, motivo):
        m = self.main_pos
        pts = (preco - m["entrada"]) if m["lado"] == "BUY" else (m["entrada"] - preco)
        self.trades.append({
            "tipo": "MAIN", "lado": m["lado"], "pontos": pts, "vol": 1.0,
            "pnl_financeiro": pts * 0.20, "motivo": motivo
        })
        self.main_pos = None

    def _fechar_pyr(self, pyr, preco, motivo):
        pts = (preco - pyr["entrada"]) if pyr["lado"] == "BUY" else (pyr["entrada"] - preco)
        self.trades.append({
            "tipo": "PYR", "lado": pyr["lado"], "pontos": pts, "vol": 1.0,
            "pnl_financeiro": pts * 0.20, "motivo": motivo
        })
        self.pyr_positions.remove(pyr)

    def _zerar_tudo(self, preco, motivo):
        if self.main_pos:
            self._fechar_main(preco, motivo)
        for pyr in list(self.pyr_positions):
            self._fechar_pyr(pyr, preco, motivo)

    def encerrar_dia(self, preco):
        self._zerar_tudo(preco, "FIM")


class SimuladorPiramideOtimizada:
    """Modelo 3: Pirâmide Otimizada (BE imediato no fill, trailing com folga de 1 box, filtro score >= 7)."""
    def __init__(self):
        self.main_pos = None
        self.pyr_positions = []
        self.trades = []
        self.prev_box = None

    def no_tick(self, preco):
        # 1. Checa pirâmides
        for pyr in list(self.pyr_positions):
            lado = pyr["lado"]
            if lado == "BUY":
                if preco <= pyr["sl"]:
                    self._fechar_pyr(pyr, pyr["sl"], "SL_PYR")
                elif preco >= pyr["tp"]:
                    self._fechar_pyr(pyr, pyr["tp"], "TP_PYR")
            else:
                if preco >= pyr["sl"]:
                    self._fechar_pyr(pyr, pyr["sl"], "SL_PYR")
                elif preco <= pyr["tp"]:
                    self._fechar_pyr(pyr, pyr["tp"], "TP_PYR")

        # 2. Checa posição mãe
        if self.main_pos:
            m = self.main_pos
            if m["lado"] == "BUY":
                if preco <= m["sl"]:
                    self._fechar_main(m["sl"], "SL_MAIN")
                elif preco >= m["tp"]:
                    self._fechar_main(m["tp"], "TP_MAIN")
            else:
                if preco >= m["sl"]:
                    self._fechar_main(m["sl"], "SL_MAIN")
                elif preco <= m["tp"]:
                    self._fechar_main(m["tp"], "TP_MAIN")

    def on_box(self, box, sinal):
        preco = box["close"]
        b_dir = box.get("direction")
        flow_score = box.get("flow_score", 5)
        delta_atual = float(box.get("delta", 0.0))

        # Trailing Stop com Respiro de 1 Box (N-1): Stop fica atrás do box ANTERIOR
        if self.main_pos and self.prev_box:
            is_buy = self.main_pos["lado"] == "BUY"
            prev_open = float(self.prev_box.get("open", 0.0))
            if is_buy and b_dir == "UP":
                cand_sl = prev_open - 5.0  # Mínima do box anterior
                if cand_sl > self.main_pos["sl"]:
                    self.main_pos["sl"] = cand_sl
            elif not is_buy and b_dir == "DOWN":
                cand_sl = prev_open + 5.0  # Máxima do box anterior
                if cand_sl < self.main_pos["sl"]:
                    self.main_pos["sl"] = cand_sl

        # Flip de posição
        if sinal:
            if self.main_pos and self.main_pos["lado"] != sinal:
                self._zerar_tudo(preco, "FLIP")
                self._abrir_main(sinal, preco)
                self.prev_box = box
                return

            if not self.main_pos:
                self._abrir_main(sinal, preco)
            elif len(self.pyr_positions) < MAX_PYRAMIDS:
                # FILTRO DE CONVICÇÃO: Só piramida com Score Institucional >= 7 e Delta saudável
                delta_ok = delta_atual > 0 if sinal == "BUY" else delta_atual < 0
                if flow_score >= 7 and delta_ok:
                    sl = preco - SL_PONTOS if sinal == "BUY" else preco + SL_PONTOS
                    tp = preco + TP_PONTOS if sinal == "BUY" else preco - TP_PONTOS
                    self.pyr_positions.append({"lado": sinal, "entrada": preco, "sl": sl, "tp": tp, "vol": 1.0})

                    # 🛡️ REGRA DE OURO: Breakeven IMEDIATO na Ordem Mãe assim que a Pirâmide entra!
                    be_preco = self.main_pos["entrada"] + (BE_OFFSET if sinal == "BUY" else -BE_OFFSET)
                    if (sinal == "BUY" and be_preco > self.main_pos["sl"]) or (sinal == "SELL" and be_preco < self.main_pos["sl"]):
                        self.main_pos["sl"] = be_preco

        self.prev_box = box

    def _abrir_main(self, lado, preco):
        sl = preco - SL_PONTOS if lado == "BUY" else preco + SL_PONTOS
        tp = preco + TP_PONTOS if lado == "BUY" else preco - TP_PONTOS
        self.main_pos = {"lado": lado, "entrada": preco, "sl": sl, "tp": tp, "vol": 1.0}

    def _fechar_main(self, preco, motivo):
        m = self.main_pos
        pts = (preco - m["entrada"]) if m["lado"] == "BUY" else (m["entrada"] - preco)
        self.trades.append({
            "tipo": "MAIN", "lado": m["lado"], "pontos": pts, "vol": 1.0,
            "pnl_financeiro": pts * 0.20, "motivo": motivo
        })
        self.main_pos = None

    def _fechar_pyr(self, pyr, preco, motivo):
        pts = (preco - pyr["entrada"]) if pyr["lado"] == "BUY" else (pyr["entrada"] - preco)
        self.trades.append({
            "tipo": "PYR", "lado": pyr["lado"], "pontos": pts, "vol": 1.0,
            "pnl_financeiro": pts * 0.20, "motivo": motivo
        })
        self.pyr_positions.remove(pyr)

    def _zerar_tudo(self, preco, motivo):
        if self.main_pos:
            self._fechar_main(preco, motivo)
        for pyr in list(self.pyr_positions):
            self._fechar_pyr(pyr, preco, motivo)

    def encerrar_dia(self, preco):
        self._zerar_tudo(preco, "FIM")


def rodar_dia(caminho, inicio=INICIO_PADRAO, fim=FIM_PADRAO):
    engine = RenkoFlowEngine(symbol="WINZ26", box_points=50.0, tick_size=5.0, min_delta_threshold=150)
    sim_base = SimuladorBaseSemPiramide()
    sim_atual = SimuladorPiramideAtual()
    sim_otim = SimuladorPiramideOtimizada()

    ultimo = 0.0
    for t in pd.read_csv(caminho).dropna(subset=["time_msc"]).to_dict("records"):
        flags = int(t.get("flags") or 0)
        vol = int(t.get("volume") or t.get("volume_real") or 1)
        preco = float(t.get("last") or t.get("bid") or t.get("ask") or 0)
        if preco <= 0:
            continue
        hora = datetime.fromtimestamp(int(t["time_msc"]) / 1000).strftime("%H:%M")
        if hora >= fim:
            break
        if hora < inicio:
            continue
        ultimo = preco
        agressor = "BUY" if (flags & 32) else ("SELL" if (flags & 64) else "CROSS")

        # 1. Tick-by-tick stops
        sim_base.no_tick(preco)
        sim_atual.no_tick(preco)
        sim_otim.no_tick(preco)

        # 2. Processa motor Renko
        box, sinal, _motivo = engine.process_tick(preco, vol, agressor, int(t["time_msc"]))
        if box:
            sim_base.on_box(box, sinal)
            sim_atual.on_box(box, sinal)
            sim_otim.on_box(box, sinal)

    sim_base.encerrar_dia(ultimo)
    sim_atual.encerrar_dia(ultimo)
    sim_otim.encerrar_dia(ultimo)

    return sim_base.trades, sim_atual.trades, sim_otim.trades


def sumario_estat(trades, rotulo):
    if not trades:
        return f"{rotulo:<22}:      0 negócios"
    pts = sum(t["pontos"] for t in trades)
    fin = sum(t["pnl_financeiro"] for t in trades)
    vitorias = sum(1 for t in trades if t["pontos"] > 0)
    taxa = (vitorias / len(trades)) * 100 if trades else 0.0
    return (f"{rotulo:<22}: {len(trades):>4} fills | PnL Total: {pts:>+9.1f} pts (R$ {fin:>+8.2f}) | "
            f"Taxa Acerto: {taxa:>5.1f}%")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dias", type=int, default=10, help="Quantidade de pregões históricos para ensaio")
    ap.add_argument("--inicio", default=INICIO_PADRAO)
    ap.add_argument("--fim", default=FIM_PADRAO)
    args = ap.parse_args()

    arquivos = sorted(f for f in os.listdir(PASTA)
                      if f.startswith("winz26_ticks_") and f.endswith(".csv.gz"))
    arquivos = [os.path.join(PASTA, f) for f in arquivos[-args.dias:]]

    print(f"\n{'=' * 85}")
    print(f"  ENSAIO DE REPLAY FORENSE: MODELOS DE PIRAMIDAÇÃO ({len(arquivos)} DIAS REAIS DE WIN)")
    print(f"  Janela: {args.inicio} às {args.fim} | SL: {SL_PONTOS:.0f} pts | TP: {TP_PONTOS:.0f} pts")
    print(f"{'=' * 85}")

    all_base, all_atual, all_otim = [], [], []

    for caminho in arquivos:
        dia_str = os.path.basename(caminho).replace("winz26_ticks_", "").replace(".csv.gz", "")
        t_base, t_atual, t_otim = rodar_dia(caminho, inicio=args.inicio, fim=args.fim)
        all_base.extend(t_base)
        all_atual.extend(t_atual)
        all_otim.extend(t_otim)

        p_base = sum(t["pontos"] for t in t_base)
        p_atual = sum(t["pontos"] for t in t_atual)
        p_otim = sum(t["pontos"] for t in t_otim)
        print(f"[{dia_str}] Base: {p_base:>+7.1f} pts | Pirâmide Atual: {p_atual:>+7.1f} pts | Pirâmide Otimizada: {p_otim:>+7.1f} pts")

    print(f"\n{'-' * 85}")
    print(f"  RESULTADO CONSOLIDADO ACUMULADO NOS {len(arquivos)} PREGÕES:")
    print(f"{'-' * 85}")
    print(sumario_estat(all_base, "1. Base (Sem Pirâmide)"))
    print(sumario_estat(all_atual, "2. Pirâmide Atual"))
    print(sumario_estat(all_otim, "3. Pirâmide Otimizada"))
    print(f"{'-' * 85}\n")


if __name__ == "__main__":
    main()
