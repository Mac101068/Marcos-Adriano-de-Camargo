"""O filtro de cor do fluxo ajuda? Mede em fita REAL, com o mesmo motor da ponte.

A ideia do operador: o painel FLUXO pinta verde/vermelho conforme a agressão do box, e a
linha sobe ou desce. Se a leitura for de tendência, então em fluxo de alta só o robô de
compra deveria operar, e em fluxo de baixa só o de venda.

Este script não opina: ele alimenta o RenkoFlowEngine (o motor que a ponte usa de verdade,
`check_convergence`) com a fita gravada em data/pregoes, coleta os sinais e mede o resultado
de cada um — antes e depois do filtro. Três definições de "tendência" são testadas, porque
"cor do indicador" admite mais de uma leitura:

  CVD   — sinal de (CVD atual − CVD de N boxes atrás). É a inclinação da linha do painel.
  COR   — soma dos sinais do delta dos últimos N boxes. É a maioria das cores dos candles.
  PRECO — sinal de (close atual − close de N boxes atrás). É a tendência de preço pura,
           incluída como linha de base: se o fluxo não bater o preço, o filtro é enfeite.

Resultado de um sinal = movimento a favor, em pontos, do close do box que sinalizou até o
close de K boxes depois. Não é backtest de PnL (não há stop/alvo): é a MEDIDA DE ACERTO do
sinal, que é o que o filtro promete melhorar.

Rodar:  venv\\Scripts\\python.exe avaliar_filtro_fluxo.py --dias 5
"""
import argparse
import os
import sys

import pandas as pd

from bot_mt5_ciclo15 import EVAL_CONFIG, RenkoFlowEngine

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

RAIZ = os.path.dirname(os.path.abspath(__file__))
PASTA = os.path.join(RAIZ, "data", "pregoes")
TICK_SIZE_WIN = 5.0
BOX_POINTS = 50.0  # 10R do WIN, a escala do motor

# Defaults do app, para o motor julgar como julga em produção.
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
})


def carregar_ticks(caminho):
    df = pd.read_csv(caminho).dropna(subset=["time_msc"])
    if "last" in df.columns:
        df["last"] = df["last"].replace(0, pd.NA).fillna(df["bid"])
    return df.to_dict("records")


def rodar_dia(caminho, symbol="WINZ26"):
    engine = RenkoFlowEngine(symbol=symbol, box_points=BOX_POINTS, tick_size=TICK_SIZE_WIN,
                             min_delta_threshold=150)
    sinais = []
    for t in carregar_ticks(caminho):
        flags = int(t.get("flags") or 0)
        vol = int(t.get("volume") or t.get("volume_real") or 1)
        preco = float(t.get("last") or t.get("bid") or t.get("ask") or 0)
        if preco <= 0:
            continue
        agressor = "BUY" if (flags & 32) else ("SELL" if (flags & 64) else "CROSS")
        box, sinal, _motivo = engine.process_tick(preco, vol, agressor, int(t["time_msc"]))
        if box and sinal:
            sinais.append({"i": box["index"], "lado": sinal, "preco": box["close"],
                           "delta": box["delta"]})
    return engine.boxes, sinais


def tendencia(boxes, i, janela, modo):
    if i - janela < 0:
        return 0
    if modo == "CVD":
        d = boxes[i].get("cvd_at_close", 0) - boxes[i - janela].get("cvd_at_close", 0)
    elif modo == "COR":
        d = sum((1 if boxes[j].get("delta", 0) > 0 else -1 if boxes[j].get("delta", 0) < 0 else 0)
                for j in range(i - janela + 1, i + 1))
    else:  # PRECO
        d = boxes[i]["close"] - boxes[i - janela]["close"]
    return (d > 0) - (d < 0)


def resultado(boxes, i, lado, k):
    """Movimento a favor, em pontos, do close do box i até o close de i+k."""
    if i + k >= len(boxes):
        return None
    movimento = boxes[i + k]["close"] - boxes[i]["close"]
    return movimento if lado == "BUY" else -movimento


def resumo(sinais, boxes, k, filtro=None):
    """Devolve (n, media, mediana, acerto%) dos sinais que passam no filtro."""
    vals = []
    for s in sinais:
        if filtro is not None and not filtro(s):
            continue
        r = resultado(boxes, s["i"], s["lado"], k)
        if r is not None:
            vals.append(r)
    if not vals:
        return 0, 0.0, 0.0, 0.0
    vals_sorted = sorted(vals)
    med = vals_sorted[len(vals_sorted) // 2]
    return (len(vals), sum(vals) / len(vals), med, 100.0 * sum(1 for v in vals if v > 0) / len(vals))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dias", type=int, default=5, help="quantos pregões do catálogo usar")
    ap.add_argument("--janelas", default="5,10,20")
    args = ap.parse_args()

    arquivos = sorted(f for f in os.listdir(PASTA) if f.startswith("winz26_ticks_") and f.endswith(".csv.gz"))
    arquivos = [os.path.join(PASTA, f) for f in arquivos[-args.dias:]]
    janelas = [int(x) for x in args.janelas.split(",")]
    horizontes = [1, 3, 5]

    print(f"\n=== FILTRO DE COR DO FLUXO — {len(arquivos)} pregão(ões) de fita real ===")
    dias = []
    total_sinais = 0

    for caminho in arquivos:
        boxes, sinais = rodar_dia(caminho)
        total_sinais += len(sinais)
        dia = os.path.basename(caminho).replace("winz26_ticks_", "").replace(".csv.gz", "")
        buys = sum(1 for s in sinais if s["lado"] == "BUY")
        print(f"\n{dia}: {len(boxes)} boxes | {len(sinais)} sinais ({buys} BUY / {len(sinais) - buys} SELL)")
        dias.append((boxes, sinais))

    print(f"\n=== AGREGADO ({total_sinais} sinais brutos) — resultado a 3 boxes ===")
    print("  filtro          n      n_filt   média(bruto→filtrado)   acerto(bruto→filtrado)")
    boxes_all, sinais_all = [], []
    for boxes, sinais in dias:
        base = len(boxes_all)
        boxes_all.extend(boxes)
        for x in sinais:
            sinais_all.append({**x, "i": x["i"] + base})

    n0, m0, _med0, a0 = resumo(sinais_all, boxes_all, 3)
    print(f"  {'(sem filtro)':<14} {n0:>5}    {'-':>6}    {m0:+7.2f} pts                                  {a0:5.1f}%")
    for modo in ("CVD", "COR", "PRECO"):
        for j in janelas:
            nf, mf, medf, af = resumo(
                sinais_all, boxes_all, 3,
                filtro=lambda s, m=modo, jj=j: tendencia(boxes_all, s["i"], jj, m) == (
                    1 if s["lado"] == "BUY" else -1))
            print(f"  {modo+' '+str(j)+'b':<14} {n0:>5}    {nf:>6}    {m0:+7.2f} → {mf:+7.2f}    "
                  f"{a0:5.1f}% → {af:5.1f}%")

    print("\n=== DIAGNÓSTICO: sinal contra a cor do fluxo (o que o filtro mataria) ===")
    for j in janelas:
        contra = [s for s in sinais_all
                  if tendencia(boxes_all, s["i"], j, "COR") == (1 if s["lado"] == "SELL" else -1)]
        if contra:
            n, m, _md, a = resumo(contra, boxes_all, 3)
            print(f"  janela {j:>2}b: {n:>4} sinais contra a cor | média {m:+7.2f} pts | acerto {a:5.1f}%")

    print("\nLeitura: se a média filtrada não superar a bruta com folga, o filtro não paga o")
    print("custo em sinais perdidos — e o número de sinais mortos diz quanto custa.")


if __name__ == "__main__":
    main()
