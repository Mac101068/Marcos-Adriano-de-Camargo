# -*- coding: utf-8 -*-
"""
medir_flow_score_replay.py — Medição de Impacto do Flow Conviction Score na Fita Real (22 pregões)
RoboFluxoB3 — Laboratório Quantitativo

Objetivo:
Medir empiricamente se a estratificação por Flow Score (0 a 10) separa trades vencedores
de perdedores na base histórica real (data/pregoes/winz26_ticks_*.csv.gz), respondendo:
1. Qual o PnL acumulado em cada nível de score (Score < 6 vs 6..7 vs >= 8)?
2. Exigir score mínimo (ex: >= 7 ou >= 8) transforma o resultado de zero-a-zero em lucro líquido?
3. O que acontece com a taxa de acerto e o drawdown?
4. Qual o efeito de Break-Even após +50 pts (1 box a favor)?

Uso:
  venv\\Scripts\\python.exe medir_flow_score_replay.py --dias 22
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

# Defaults idênticos aos do motor de produção
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
    "flow_trend_filter": False,  # Filtro avaliado nas carteiras
    "flow_trend_lookback": JANELA_FILTRO,
})


class CarteiraScore:
    """Simulação de carteira orientada a score mínimo e gestão de saída."""

    def __init__(self, nome, min_score=0, usar_tendencia=True, break_even_pts=None):
        self.nome = nome
        self.min_score = min_score
        self.usar_tendencia = usar_tendencia
        self.break_even_pts = break_even_pts
        self.pos = None
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
        if not self.pos:
            return
        p = self.pos
        entrada = p["entrada"]
        sl = p["sl_atual"]

        if p["lado"] == "BUY":
            # Atualiza Break-Even se ativado
            if self.break_even_pts and not p["be_ativado"]:
                if preco >= entrada + self.break_even_pts:
                    p["sl_atual"] = entrada  # Move stop para a entrada
                    p["be_ativado"] = True
                    sl = entrada

            if preco <= sl:
                motivo = "BE" if (p["be_ativado"] and abs(sl - entrada) < 1.0) else "SL"
                self._fechar(sl, motivo)
            elif preco >= entrada + TP_PONTOS:
                self._fechar(entrada + TP_PONTOS, "TP")
        else:
            if self.break_even_pts and not p["be_ativado"]:
                if preco <= entrada - self.break_even_pts:
                    p["sl_atual"] = entrada
                    p["be_ativado"] = True
                    sl = entrada

            if preco >= sl:
                motivo = "BE" if (p["be_ativado"] and abs(sl - entrada) < 1.0) else "SL"
                self._fechar(sl, motivo)
            elif preco <= entrada - TP_PONTOS:
                self._fechar(entrada - TP_PONTOS, "TP")

    def no_sinal(self, preco, lado, indice, tendencia, score, hora):
        contra = (lado == "BUY" and tendencia < 0) or (lado == "SELL" and tendencia > 0)
        if self.usar_tendencia and contra:
            return True  # Barrado pelo filtro de tendência

        if score < self.min_score:
            return True  # Barrado pelo filtro de score mínimo

        if self.pos:
            if self.pos["lado"] == lado:
                return False  # Já posicionado no mesmo lado
            self._fechar(preco, "FLIP")

        sl_inicial = (preco - SL_PONTOS) if lado == "BUY" else (preco + SL_PONTOS)
        self.pos = {
            "lado": lado,
            "entrada": preco,
            "sl_atual": sl_inicial,
            "be_ativado": False,
            "indice": indice,
            "tendencia": tendencia,
            "score": score,
            "hora": hora,
        }
        return False

    def encerrar_dia(self, preco):
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
        "Base (Tendência, Score >= 0)": CarteiraScore("Base", min_score=0, usar_tendencia=True),
        "Score >= 5": CarteiraScore("Score >= 5", min_score=5, usar_tendencia=True),
        "Score >= 6": CarteiraScore("Score >= 6", min_score=6, usar_tendencia=True),
        "Score >= 7": CarteiraScore("Score >= 7", min_score=7, usar_tendencia=True),
        "Score >= 8": CarteiraScore("Score >= 8", min_score=8, usar_tendencia=True),
        "Score >= 7 + Break-Even 50pts": CarteiraScore("Score >= 7 + BE", min_score=7, usar_tendencia=True, break_even_pts=50.0),
        "Score >= 8 + Break-Even 50pts": CarteiraScore("Score >= 8 + BE", min_score=8, usar_tendencia=True, break_even_pts=50.0),
    }

    todos_sinais = []
    ultimo = 0.0

    ticks = carregar_ticks(caminho, inicio=inicio, fim=fim)
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
        if box and sinal:
            tend = flow_trend(engine.boxes[:-1], box, JANELA_FILTRO)
            score = box.get("flow_score", 5)
            hora_sinal = datetime.fromtimestamp(ts / 1000).strftime("%H:%M")
            todos_sinais.append({
                "index": box["index"],
                "sinal": sinal,
                "preco": preco,
                "tendencia": tend,
                "score": score,
                "hora": hora_sinal
            })
            for c in carteiras.values():
                c.no_sinal(preco, sinal, box["index"], tend, score, hora_sinal)

    for c in carteiras.values():
        c.encerrar_dia(ultimo)

    return {k: c.trades for k, c in carteiras.items()}, todos_sinais


def calcular_estatisticas(trades):
    if not trades:
        return {
            "n": 0, "total": 0.0, "media": 0.0, "acerto": 0.0,
            "tp": 0, "sl": 0, "be": 0, "flip": 0, "fim": 0,
            "max_dd": 0.0, "fator_lucro": 0.0
        }
    pts = [t["pontos"] for t in trades]
    total = sum(pts)
    vitorias = [p for p in pts if p > 0]
    derrotas = [p for p in pts if p < 0]
    soma_vitorias = sum(vitorias)
    soma_derrotas = abs(sum(derrotas))
    fator_lucro = (soma_vitorias / soma_derrotas) if soma_derrotas > 0 else (99.0 if soma_vitorias > 0 else 0.0)

    # Drawdown máximo
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
    be = sum(1 for t in trades if t["motivo"] == "BE")
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
        "be": be,
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

    print(f"🔬 [LAB QUANT] Medindo Impacto do Flow Score em {len(arquivos)} pregões reais (WINZ26)...", flush=True)
    print(f"   Configuração: SL {SL_PONTOS:.0f} pts | TP {TP_PONTOS:.0f} pts | Janela {args.inicio} às {args.fim}\n", flush=True)

    acumulados = {
        "Base (Tendência, Score >= 0)": [],
        "Score >= 5": [],
        "Score >= 6": [],
        "Score >= 7": [],
        "Score >= 8": [],
        "Score >= 7 + Break-Even 50pts": [],
        "Score >= 8 + Break-Even 50pts": [],
    }
    todos_os_sinais = []

    for i, caminho in enumerate(arquivos, 1):
        dia = os.path.basename(caminho).replace("winz26_ticks_", "").replace(".csv.gz", "")
        trades_dia, sinais_dia = rodar_dia(caminho, inicio=args.inicio, fim=args.fim)
        todos_os_sinais.extend(sinais_dia)
        for k, tr in trades_dia.items():
            acumulados[k].extend(tr)
        
        # Log de progresso compacto
        b_pts = sum(t["pontos"] for t in trades_dia["Base (Tendência, Score >= 0)"])
        s7_pts = sum(t["pontos"] for t in trades_dia["Score >= 7"])
        s8be_pts = sum(t["pontos"] for t in trades_dia["Score >= 8 + Break-Even 50pts"])
        print(f"  [{i:>2}/{len(arquivos)}] {dia} | Base: {b_pts:+5.0f} pts | Score>=7: {s7_pts:+5.0f} pts | Score>=8+BE: {s8be_pts:+5.0f} pts", flush=True)

    print("\n" + "=" * 95)
    print("📊 RESULTADO CONSOLIDADO POR ESTRATÉGIA / CONVICÇÃO (22 PREGÕES)")
    print("=" * 95)
    header = f"{'Estratégia':<32} | {'Trades':>6} | {'PnL Total':>10} | {'Média':>7} | {'Acerto':>7} | {'PF':>5} | {'Max DD':>8} | {'TP / SL / BE / FLIP'}"
    print(header)
    print("-" * 95)

    for k, tr in acumulados.items():
        st = calcular_estatisticas(tr)
        detalhe = f"{st['tp']} / {st['sl']} / {st['be']} / {st['flip']}"
        print(f"{k:<32} | {st['n']:>6} | {st['total']:>+9.0f} pt | {st['media']:>+6.1f} | {st['acerto']:>6.1f}% | {st['fator_lucro']:>5.2f} | {st['max_dd']:>7.0f} pt | {detalhe}")

    print("=" * 95)

    # Análise de distribuição por faixa de score na carteira base
    base_trades = acumulados["Base (Tendência, Score >= 0)"]
    print("\n🔍 ESTRATIFICAÇÃO DOS TRADES POR FAIXA EXATA DE SCORE (Carteira Base):")
    print("-" * 75)
    faixas = [
        ("Score 0 a 4 (Muito Baixo)", lambda s: s < 5),
        ("Score 5 a 6 (Marginal)", lambda s: 5 <= s <= 6),
        ("Score 7 (Moderado)", lambda s: s == 7),
        ("Score 8 a 10 (Alta Convicção)", lambda s: s >= 8),
    ]
    for label, fn in faixas:
        sub = [t for t in base_trades if fn(t["score"])]
        st = calcular_estatisticas(sub)
        print(f"  {label:<30} | {st['n']:>4} trades | Total: {st['total']:>+8.0f} pts | Média: {st['media']:>+6.1f} | Acerto: {st['acerto']:>5.1f}% | PF: {st['fator_lucro']:>4.2f}")

    print("-" * 75)


if __name__ == "__main__":
    main()
