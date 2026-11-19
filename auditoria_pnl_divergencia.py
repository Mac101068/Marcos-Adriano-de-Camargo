#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
auditoria_pnl_divergencia.py

AUDITORIA READ-ONLY da divergencia de PnL entre o robo e a corretora.

- Le data/trades_<data>.json        (visao do robo: sinal, volume, result_pnl interno)
- Le data/auditoria/deals_<data>.csv (visao da corretora: execucao real, profit R$)
- Pareia por ticket (order/deal) e, como fallback, por timestamp+ativo+volume.
- Compara PnL do robo x PnL da corretora, calcula divergencia e sugere a causa.

NAO modifica nada. Apenas le e imprime no console. Depende so da stdlib.

Uso:
    python auditoria_pnl_divergencia.py                # usa 2026-11-18
    python auditoria_pnl_divergencia.py 2026-11-18
"""

import os
import sys
import csv
import json
import glob
import statistics
from datetime import datetime

BASE = os.path.dirname(os.path.abspath(__file__))


def _f(x):
    try:
        return float(x)
    except (TypeError, ValueError):
        return 0.0


def localizar(candidatos, padroes):
    """Procura o arquivo em varios caminhos. Devolve o caminho ou None."""
    for c in candidatos:
        p = c if os.path.isabs(c) else os.path.join(BASE, c)
        if os.path.isfile(p):
            return p
    for pat in padroes:
        achados = sorted(glob.glob(os.path.join(BASE, pat), recursive=True))
        if achados:
            return achados[-1]
    return None


def carregar_trades(caminho):
    registros = []
    invalidos = 0
    with open(caminho, "r", encoding="utf-8") as fh:
        for linha in fh:
            linha = linha.strip()
            if not linha:
                continue
            try:
                registros.append(json.loads(linha))
            except Exception:
                invalidos += 1
    return registros, invalidos


def carregar_deals(caminho):
    with open(caminho, "r", encoding="utf-8-sig", newline="") as fh:
        return list(csv.DictReader(fh))


def ts_trade(t):
    s = t.get("timestamp") or t.get("timestamp_iso") or ""
    s = s.replace("T", " ").replace("Z", "")
    for fmt in ("%Y-%m-%d %H:%M:%S.%f", "%Y-%m-%d %H:%M:%S"):
        try:
            return datetime.strptime(s[:26], fmt)
        except ValueError:
            continue
    return None


def ts_deal(d):
    try:
        return datetime.strptime(d["data"] + " " + d["hora"], "%Y-%m-%d %H:%M:%S")
    except (KeyError, ValueError):
        return None


def parear(trades, deals):
    """Pareia deals de saida (realizacao) com registros de trade."""
    por_ticket = {}
    for t in trades:
        tk = t.get("ticket")
        if tk is not None:
            por_ticket[str(tk)] = t

    execs = [t for t in trades if t.get("status") in ("EXECUTED", "CONFIRMED")]

    pares = []
    sem_par = []
    for d in deals:
        if (d.get("entrada") or "").upper() != "OUT":
            continue
        order = str(d.get("order") or "")
        deal = str(d.get("deal") or "")
        simbolo = d.get("simbolo")
        volume = _f(d.get("volume"))
        pnl_broker = _f(d.get("profit"))

        t = por_ticket.get(order) or por_ticket.get(deal)
        origem = "ticket" if t else None

        if t is None:
            dt_deal = ts_deal(d)
            melhor = None
            menor = None
            for e in execs:
                if e.get("symbol") != simbolo:
                    continue
                if abs(_f(e.get("volume")) - volume) > 1e-6:
                    continue
                dte = ts_trade(e)
                if dte is None or dt_deal is None:
                    continue
                dif = abs((dte - dt_deal).total_seconds())
                if dif <= 5.0 and (menor is None or dif < menor):
                    menor = dif
                    melhor = e
            if melhor is not None:
                t = melhor
                origem = "timestamp+ativo+volume"

        if t is None:
            sem_par.append(d)
            continue

        pares.append({
            "deal": d,
            "trade": t,
            "origem": origem,
            "pnl_broker": pnl_broker,
            "simbolo": simbolo,
            "ticket": order or deal,
            "volume": volume,
        })
    return pares, sem_par


def hipotese_linha(pnl_robo, pnl_broker, div, volume):
    if abs(div) < 1e-9:
        return "OK: sem divergencia"
    if abs(pnl_robo) < 1e-9 and abs(pnl_broker) > 1e-9:
        return "PnL interno nao registrado (result_pnl=0): divergencia = 100% do valor da corretora"
    if volume > 0:
        return "Divergencia por contrato = R$ %.2f" % (div / volume)
    return "Verificar"


def classificar_global(pares):
    if not pares:
        return "Sem operacoes pareadas para classificar."
    robos_zerados = sum(1 for p in pares if abs(_f(p["trade"].get("result_pnl"))) < 1e-9)
    if robos_zerados == len(pares):
        return ("CAUSA RAIZ: em TODAS as %d operacoes pareadas o campo result_pnl do robo "
                "vale 0. O robo nao esta persistindo o PnL financeiro; a divergencia e "
                "integral (100%%). Nao e slippage nem taxa: e ausencia de calculo/registro."
                % len(pares))
    vals_div = [p["pnl_broker"] - _f(p["trade"].get("result_pnl")) for p in pares]
    por_contrato = [((p["pnl_broker"] - _f(p["trade"].get("result_pnl"))) / p["volume"])
                    for p in pares if p["volume"] > 0]
    if por_contrato and len(set(round(x, 2) for x in por_contrato)) <= 1:
        return "Divergencia proporcional ao volume -> possivel erro no valor do ponto / numero de contratos."
    media = statistics.mean(vals_div)
    if statistics.pstdev(vals_div) < max(1.0, 0.05 * (abs(media) or 1.0)):
        return "Divergencia ~fixa por operacao -> possivel taxa/corretagem nao contabilizada pelo robo."
    return "Divergencia variavel -> possivel slippage (preco de sinal x preco de execucao) nao calculado."


def main():
    data = sys.argv[1] if len(sys.argv) > 1 else "2026-11-18"
    dcomp = data.replace("-", "")

    cam_trades = ["data/trades_%s.json" % data, "data/trades_%s.json" % dcomp]
    pad_trades = ["data/trades_%s*.json" % data, "**/trades_%s*.json" % data]

    cam_deals = [
        "data/auditoria/deals_%s.csv" % dcomp,
        "data/deals_%s.csv" % dcomp,
        "data/auditoria/deals_%s.csv" % data,
        "data/deals_%s.csv" % data,
    ]
    pad_deals = ["data/**/deals_%s*.csv" % dcomp, "**/deals_%s*.csv" % dcomp]

    trades_path = localizar(cam_trades, pad_trades)
    deals_path = localizar(cam_deals, pad_deals)

    print("=" * 78)
    print(" AUDITORIA DE DIVERGENCIA DE PnL  (READ-ONLY)")
    print(" Data de referencia:", data)
    print("=" * 78)

    if not trades_path:
        print("[ERRO] Nao encontrei o arquivo de trades do robo.")
        print("       Tentei:", ", ".join(cam_trades))
        print("       Caminho esperado:", os.path.join(BASE, "data", "trades_%s.json" % data))
        sys.exit(2)
    if not deals_path:
        print("[ERRO] Nao encontrei o arquivo de deals da corretora.")
        print("       Tentei:", ", ".join(cam_deals))
        print("       Caminho esperado:", os.path.join(BASE, "data", "auditoria", "deals_%s.csv" % dcomp))
        sys.exit(2)

    print(" Trades (robo)     :", os.path.relpath(trades_path, BASE))
    print(" Deals (corretora) :", os.path.relpath(deals_path, BASE))

    trades, invalidos = carregar_trades(trades_path)
    deals = carregar_deals(deals_path)
    print(" Registros de trade:", len(trades), "| invalidos:", invalidos)
    print(" Deals da corretora:", len(deals))
    print("-" * 78)

    pares, sem_par = parear(trades, deals)
    print(" Operacoes pareadas (realizacao):", len(pares))
    print(" Deals de saida sem par no log   :", len(sem_par))
    print("-" * 78)
    print(" %-8s %-12s %14s %14s %14s %9s" % (
        "ATIVO", "TICKET", "PnL_ROBO(R$)", "PnL_CORR(R$)", "DIVERG(R$)", "DIV_%"))
    print("-" * 78)

    total_robo = 0.0
    total_corr = 0.0
    exibir = pares[:60]
    for p in exibir:
        robo = _f(p["trade"].get("result_pnl"))
        corr = p["pnl_broker"]
        div = corr - robo
        divp = (div / corr * 100.0) if abs(corr) > 1e-9 else 0.0
        total_robo += robo
        total_corr += corr
        print(" %-8s %-12s %14.2f %14.2f %14.2f %8.1f%%" % (
            str(p["simbolo"])[:8], str(p["ticket"])[:12], robo, corr, div, divp))

    if len(pares) > len(exibir):
        print(" ... (%d operacoes omitidas na tabela)" % (len(pares) - len(exibir)))

    print("-" * 78)
    print(" TOTAIS pareados: robo = R$ %.2f | corretora = R$ %.2f | divergencia = R$ %.2f"
          % (total_robo, total_corr, total_corr - total_robo))
    net_all = sum(_f(d.get("profit")) for d in deals if (d.get("entrada") or "").upper() == "OUT")
    print(" Net da corretora (TODAS as saidas): R$ %.2f" % net_all)
    print("-" * 78)

    print(" HIPOTESES POR OPERACAO (amostra):")
    for p in exibir[:15]:
        robo = _f(p["trade"].get("result_pnl"))
        corr = p["pnl_broker"]
        div = corr - robo
        print("   %-8s %-12s -> %s" % (
            str(p["simbolo"])[:8], str(p["ticket"])[:12],
            hipotese_linha(robo, corr, div, p["volume"])))

    print("-" * 78)
    print(" CLASSIFICACAO GLOBAL:")
    print("  ", classificar_global(pares))
    print("=" * 78)


if __name__ == "__main__":
    main()