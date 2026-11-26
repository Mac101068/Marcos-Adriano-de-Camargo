#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
forense_zeros_pnl.py

AUDITORIA FORENSE READ-ONLY DOS TRADES COM "ZERO PnL".
Cruza o JSONL de trades (data/trades_2026-11-19.json) com o extrato de deals
do MT5 (data/auditoria/deals_20261119.csv) para analisar a causa raiz microestrutural.

Uso:
    python forense_zeros_pnl.py
    python forense_zeros_pnl.py --data 2026-11-19
    python forense_zeros_pnl.py --data 2026-11-19 --limite 30
"""

import os
import sys
import csv
import json
import argparse
from datetime import datetime

# Garante suporte UTF-8 no terminal Windows
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

RAIZ = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(RAIZ, "data")
AUDIT_DIR = os.path.join(DATA_DIR, "auditoria")

MAGIC_MAP = {
    102030: "Robô Principal (10R Pirâmide)",
    999999: "Boleta Manual (Operador)",
    100001: "RoboCompra (Hedge)",
    100002: "RoboVenda (Hedge)",
    150101: "Custom (#150101)",
    150102: "Custom (#150102)",
    150201: "Varal Manual Compra",
    150202: "Varal Manual Venda",
    150301: "Custom (#150301)",
    206001: "Custom (#206001)",
    206002: "Custom (#206002)",
    26092301: "Custom (#26092301)",
    0: "Manual Direto MT5 (0)"
}

ACTIONS_FECHAMENTO = {
    "CLOSE_POSITION", "CLOSE_PARCIAL", "TAKE_PROFIT", "STOP_LOSS",
    "HARD_CAP_CLOSED", "ZERAGEM_ACCEPTED", "PARCIAL_ACCEPTED"
}


def parse_args():
    parser = argparse.ArgumentParser(description="Forense dos Trades com Zero PnL")
    parser.add_argument("--data", type=str, default="2026-11-19", help="Data do pregão (YYYY-MM-DD)")
    parser.add_argument("--limite", type=int, default=25, help="Quantidade de linhas detalhadas a exibir na tabela (padrão: 25)")
    return parser.parse_args()


def parse_datetime(dt_str):
    if not dt_str:
        return None
    formatos = [
        "%Y-%m-%d %H:%M:%S.%f",
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%dT%H:%M:%S.%fZ",
        "%Y-%m-%dT%H:%M:%SZ",
        "%Y-%m-%d %H:%M"
    ]
    for fmt in formatos:
        try:
            return datetime.strptime(dt_str[:26], fmt)
        except Exception:
            pass
    return None


def carregar_dados(data_iso):
    data_compact = data_iso.replace("-", "")
    json_path = os.path.join(DATA_DIR, f"trades_{data_iso}.json")
    csv_path = os.path.join(AUDIT_DIR, f"deals_{data_compact}.csv")

    trades = []
    if os.path.isfile(json_path):
        with open(json_path, "r", encoding="utf-8", errors="replace") as f:
            for linha in f:
                linha = linha.strip()
                if linha:
                    try:
                        trades.append(json.loads(linha))
                    except Exception:
                        pass
    else:
        print(f"❌ Arquivo JSON não encontrado: {json_path}")

    deals = []
    if os.path.isfile(csv_path):
        with open(csv_path, "r", encoding="utf-8", errors="replace") as f:
            reader = csv.DictReader(f)
            for row in reader:
                deals.append(row)
    else:
        print(f"⚠️ Arquivo de deals CSV não encontrado: {csv_path}")

    return trades, deals, json_path, csv_path


def main():
    args = parse_args()
    data_iso = args.data
    trades, deals, json_path, csv_path = carregar_dados(data_iso)

    print("=" * 105)
    print(f"🔬 FORENSE MICROESTRUTURAL DE TRADES COM ZERO PnL — Pregão: {data_iso}")
    print("=" * 105)
    print(f"• Arquivo JSON de Trades : {json_path} ({len(trades)} eventos)")
    print(f"• Extrato de Deals MT5   : {csv_path} ({len(deals)} deals da corretora)")
    print("-" * 105)

    # 1. Filtra fechamentos com PnL == 0.0
    fechamentos_zero = []
    for t in trades:
        act = str(t.get("action", "")).upper()
        st = str(t.get("status", "")).upper()
        is_closing = any(k in act for k in ACTIONS_FECHAMENTO) or "CLOSE" in st or "ZERAR" in st
        pnl = float(t.get("result_pnl", 0.0) or 0.0)
        if is_closing and abs(pnl) < 1e-6:
            fechamentos_zero.append(t)

    total_zeros = len(fechamentos_zero)
    print(f"\n🎯 Total de Operações de Fechamento com PnL == 0.00: \033[33m{total_zeros}\033[0m")
    if total_zeros == 0:
        print("✅ Nenhuma operação com PnL zerado encontrada!")
        return

    # Indexação dos deals MT5 para cruzamento rápido
    # deals_by_order: order_ticket -> list of deals
    # deals_by_deal: deal_ticket -> deal
    deals_by_order = {}
    deals_by_deal = {}
    deals_in_by_magic_sym = {}

    for d in deals:
        ord_id = str(d.get("order", "")).strip()
        dl_id = str(d.get("deal", "")).strip()
        if ord_id:
            deals_by_order.setdefault(ord_id, []).append(d)
        if dl_id:
            deals_by_deal[dl_id] = d

        # Mapeia deals de entrada (IN) por magic e símbolo para cálculo de Delta T e Preço IN
        entrada = str(d.get("entrada", "")).strip().upper()
        if entrada == "IN":
            mg = str(d.get("magic", "")).strip()
            sym = str(d.get("simbolo", "")).strip().upper()
            deals_in_by_magic_sym.setdefault((mg, sym), []).append(d)

    # Ordena os deals IN por horário
    for k in deals_in_by_magic_sym:
        deals_in_by_magic_sym[k].sort(key=lambda x: f"{x.get('data','')} {x.get('hora','')}")

    # Estatísticas agregadas
    stats_magic = {}
    stats_ativo = {}
    stats_delta_t = {
        "< 1s (Ultra-rápido / Cancel)": 0,
        "1s - 5s (Scalping Flash)": 0,
        "5s - 30s (Curto)": 0,
        "> 30s (Posicional)": 0,
        "Sem Deal no MT5 (Simulado/Bloq)": 0
    }
    stats_tipo_entrada = {}
    total_comissao = 0.0
    total_swap = 0.0
    qtd_com_deal_mt5 = 0
    qtd_lucro_real_mt5 = 0  # Casos onde MT5 teve lucro real mas o JSON registrou 0.0 (código antigo)

    dna_registros = []

    for t in fechamentos_zero:
        ticket = str(t.get("ticket", "")).strip()
        pos_ticket = str(t.get("position_ticket", "")).strip()
        magic = int(t.get("magic", 0) or 0)
        sym = str(t.get("symbol", "N/A")).upper()
        ativo_base = "WIN" if "WIN" in sym else ("WDO" if "WDO" in sym else ("BIT" if "BIT" in sym else sym))
        t_ts = parse_datetime(t.get("timestamp"))

        # Contagem por magic e ativo
        stats_magic[magic] = stats_magic.get(magic, 0) + 1
        stats_ativo[ativo_base] = stats_ativo.get(ativo_base, 0) + 1

        # Busca deal correspondente no MT5
        deal_match = None
        for cand in [ticket, pos_ticket]:
            if cand and cand in deals_by_order:
                deal_match = deals_by_order[cand][-1]
                break
            if cand and cand in deals_by_deal:
                deal_match = deals_by_deal[cand]
                break

        # Fallback de busca no MT5 por horário aproximado e magic/símbolo se não achou por ticket direto
        if not deal_match and t_ts:
            mg_str = str(magic)
            cands = []
            for d in deals:
                if str(d.get("magic", "")).strip() == mg_str and str(d.get("simbolo", "")).strip().upper() == sym:
                    d_dt_str = f"{d.get('data','')} {d.get('hora','')}"
                    d_ts = parse_datetime(d_dt_str)
                    if d_ts and abs((t_ts - d_ts).total_seconds()) <= 2.0:
                        cands.append(d)
            if cands:
                # Prioriza deal de saída (OUT)
                outs = [c for c in cands if str(c.get("entrada", "")).strip().upper() in ("OUT", "OUT_BY")]
                deal_match = outs[-1] if outs else cands[-1]

        # Extração do DNA da operação
        tipo_entrada = "SEM_DEAL"
        p_in = None
        p_out = None
        delta_t_sec = None
        comiss = 0.0
        swap = 0.0
        mt5_profit = None

        if deal_match:
            qtd_com_deal_mt5 += 1
            tipo_entrada = str(deal_match.get("entrada", "OUT")).strip().upper() or "OUT"
            stats_tipo_entrada[tipo_entrada] = stats_tipo_entrada.get(tipo_entrada, 0) + 1
            p_out = float(deal_match.get("preco", 0.0) or 0.0)
            comiss = float(deal_match.get("comissao", 0.0) or 0.0)
            swap = float(deal_match.get("swap", 0.0) or 0.0)
            mt5_profit = float(deal_match.get("profit", 0.0) or 0.0)
            total_comissao += comiss
            total_swap += swap

            if abs(mt5_profit) > 1e-6:
                qtd_lucro_real_mt5 += 1

            # Busca deal IN correspondente para achar Delta T e Preço de Entrada
            in_list = deals_in_by_magic_sym.get((str(deal_match.get("magic")), sym), [])
            d_out_ts = parse_datetime(f"{deal_match.get('data','')} {deal_match.get('hora','')}")
            if in_list and d_out_ts:
                # O deal IN mais recente que ocorreu antes ou no mesmo segundo do OUT
                anteriores = [i for i in in_list if parse_datetime(f"{i.get('data','')} {i.get('hora','')}") <= d_out_ts]
                if anteriores:
                    chosen_in = anteriores[-1]
                    p_in = float(chosen_in.get("preco", 0.0) or 0.0)
                    in_ts = parse_datetime(f"{chosen_in.get('data','')} {chosen_in.get('hora','')}")
                    if in_ts:
                        delta_t_sec = (d_out_ts - in_ts).total_seconds()
        else:
            stats_tipo_entrada["SEM_DEAL_MT5"] = stats_tipo_entrada.get("SEM_DEAL_MT5", 0) + 1

        # Classificação por Delta T
        if delta_t_sec is None:
            stats_delta_t["Sem Deal no MT5 (Simulado/Bloq)"] += 1
        elif delta_t_sec < 1.0:
            stats_delta_t["< 1s (Ultra-rápido / Cancel)"] += 1
        elif delta_t_sec <= 5.0:
            stats_delta_t["1s - 5s (Scalping Flash)"] += 1
        elif delta_t_sec <= 30.0:
            stats_delta_t["5s - 30s (Curto)"] += 1
        else:
            stats_delta_t["> 30s (Posicional)"] += 1

        # Diagnóstico da causa raiz
        if not deal_match:
            causa = "Ordem Rejeitada / Simulação / Demo Bloqueada"
        elif abs(mt5_profit) > 1e-6:
            causa = f"CÓDIGO ANTIGO (MT5 teve R$ {mt5_profit:+.2f}, mas log gravou 0.0)"
        elif p_in is not None and abs(p_in - p_out) < 1e-4:
            causa = "Empate Perfeito (Preço IN == Preço OUT)"
        else:
            causa = f"MT5 Reportou Profit R$ {mt5_profit:.2f}"

        dna_registros.append({
            "ticket": ticket or pos_ticket or "-",
            "magic": magic,
            "ativo": ativo_base,
            "tipo_entrada": tipo_entrada,
            "preco_in": p_in,
            "preco_out": p_out if p_out else float(t.get("exec_price", 0.0) or 0.0),
            "delta_t": delta_t_sec,
            "comiss": comiss,
            "swap": swap,
            "mt5_profit": mt5_profit,
            "causa": causa
        })

    # 2. Exibição da Tabela de DNA (Amostra / Detalhamento)
    print(f"\n📋 AMOSTRA FORENSE DAS OPERAÇÕES COM ZERO PnL (Primeiras {min(args.limite, total_zeros)} de {total_zeros}):")
    print("┌────────────┬────────┬────────┬──────────┬───────────┬───────────┬─────────┬──────────────┬────────────────────────────────────────────────────────┐")
    print("│ Ticket     │ Magic  │ Ativo  │ Tipo MT5 │ Preço IN  │ Preço OUT │ Delta T │ Lucro MT5    │ Causa Raiz Diagnosticada                               │")
    print("├────────────┼────────┼────────┼──────────┼───────────┼───────────┼─────────┼──────────────┼────────────────────────────────────────────────────────┤")

    for r in dna_registros[:args.limite]:
        tkt = str(r["ticket"])[:10]
        mg = str(r["magic"])[:6]
        atv = str(r["ativo"])[:6]
        tp = str(r["tipo_entrada"])[:8]
        pin_s = f"{r['preco_in']:,.1f}" if r["preco_in"] else "-"
        pout_s = f"{r['preco_out']:,.1f}" if r["preco_out"] else "-"
        dt_s = f"{r['delta_t']:.1f}s" if r["delta_t"] is not None else "N/A"
        prof_s = f"R$ {r['mt5_profit']:,.2f}" if r["mt5_profit"] is not None else "N/A"
        causa_s = str(r["causa"])[:54]

        print(f"│ {tkt:<10} │ {mg:<6} │ {atv:<6} │ {tp:<8} │ {pin_s:>9} │ {pout_s:>9} │ {dt_s:>7} │ {prof_s:>12} │ {causa_s:<54} │")

    print("└────────────┴────────┴────────┴──────────┴───────────┴───────────┴─────────┴──────────────┴────────────────────────────────────────────────────────┘")

    # 3. Agrupamento Estatístico
    print("\n" + "=" * 105)
    print("📊 AGRUPAMENTO ESTATÍSTICO DO DNA DOS 133 ZEROS:")
    print("=" * 105)

    print("\n1️⃣  DISTRIBUIÇÃO POR MAGIC NUMBER:")
    for m, qtd in sorted(stats_magic.items(), key=lambda x: x[1], reverse=True):
        desc = MAGIC_MAP.get(m, f"Custom (#{m})")
        pct = (qtd / total_zeros) * 100
        print(f"   • Magic {m:<8} ({desc:<28}): {qtd:>3} operações ({pct:>5.1f}%)")

    print("\n2️⃣  DISTRIBUIÇÃO POR ATIVO:")
    for atv, qtd in sorted(stats_ativo.items(), key=lambda x: x[1], reverse=True):
        pct = (qtd / total_zeros) * 100
        print(f"   • Ativo {atv:<6}: {qtd:>3} operações ({pct:>5.1f}%)")

    print("\n3️⃣  TEMPO DE PERMANÊNCIA (DELTA T ENTRE ABERTURA E FECHAMENTO):")
    for faixa, qtd in stats_delta_t.items():
        pct = (qtd / total_zeros) * 100
        print(f"   • {faixa:<35}: {qtd:>3} operações ({pct:>5.1f}%)")

    print("\n4️⃣  TIPO DE ENTRADA NO EXTRATO MT5:")
    for tp, qtd in sorted(stats_tipo_entrada.items(), key=lambda x: x[1], reverse=True):
        pct = (qtd / total_zeros) * 100
        print(f"   • Tipo {tp:<12}: {qtd:>3} operações ({pct:>5.1f}%)")

    print("\n5️⃣  CUSTOS E CORRETAGEM MT5:")
    print(f"   • Total de Comissões Pagas nos Zeros : R$ {abs(total_comissao):,.2f}")
    print(f"   • Total de Swap Pago nos Zeros      : R$ {abs(total_swap):,.2f}")

    print("\n" + "=" * 105)
    print("💡 CONCLUSÃO E DIAGNÓSTICO FORENSE:")
    print(f"   • Deals encontrados no MT5: {qtd_com_deal_mt5} de {total_zeros} ({qtd_com_deal_mt5/total_zeros*100:.1f}%)")
    print(f"   • Fechamentos que TINHAM lucro real na corretora (mas gravou 0.0 no JSON): \033[36m{qtd_lucro_real_mt5}\033[0m")
    print(f"   • Fechamentos sem deal ou bloqueados pela ponte/DEMO: \033[33m{total_zeros - qtd_com_deal_mt5}\033[0m")
    print("=" * 105 + "\n")


if __name__ == "__main__":
    main()
