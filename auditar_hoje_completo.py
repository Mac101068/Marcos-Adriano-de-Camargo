#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
auditar_hoje_completo.py
Auditoria minuciosa dos trades, deals, ordens e boleta de hoje (23/11/2026).
"""
import os
import glob
import json
import pandas as pd

def main():
    print("=" * 80)
    print(" AUDITORIA COMPLETA DO PREGÃO DE HOJE: 23/11/2026")
    print("=" * 80)

    # 1. CONTA MT5
    print("\n--- 1. CONTA MT5 HOJE (conta_20261123.csv) ---")
    if os.path.exists("data/auditoria/conta_20261123.csv"):
        df_conta = pd.read_csv("data/auditoria/conta_20261123.csv")
        print(df_conta.to_string())
    else:
        print("Arquivo conta_20261123.csv não encontrado.")

    # 2. DEALS DO MT5
    print("\n--- 2. DEALS MT5 OFICIAIS (deals_20261123.csv) ---")
    if os.path.exists("data/auditoria/deals_20261123.csv"):
        df_deals = pd.read_csv("data/auditoria/deals_20261123.csv")
        print(f"Total de registros de deals: {len(df_deals)}")
        
        # Lucro líquido e bruto
        sym_col = "simbolo" if "simbolo" in df_deals.columns else "symbol"
        ent_col = "entrada" if "entrada" in df_deals.columns else "entry"
        com_col = "comissao" if "comissao" in df_deals.columns else "commission"

        lucro_total = df_deals["profit"].sum()
        comissao_total = df_deals[com_col].sum() if com_col in df_deals.columns else 0.0
        taxas_total = df_deals["fee"].sum() if "fee" in df_deals.columns else 0.0
        swap_total = df_deals["swap"].sum() if "swap" in df_deals.columns else 0.0
        resultado_liquido = lucro_total + comissao_total + taxas_total + swap_total

        print(f"Lucro Bruto: R$ {lucro_total:+.2f}")
        print(f"Comissão   : R$ {comissao_total:+.2f}")
        print(f"Taxas B3   : R$ {taxas_total:+.2f}")
        print(f"Swap       : R$ {swap_total:+.2f}")
        print(f"Resultado Líquido do Dia: R$ {resultado_liquido:+.2f}")

        print("\n[Deals por Símbolo e Magic]")
        agrupado = df_deals.groupby([sym_col, "magic"])["profit"].agg(
            deals="count",
            pnl="sum",
            min_lucro="min",
            max_lucro="max"
        ).reset_index()
        print(agrupado.to_string(index=False))

        # Tipos de entrada no MT5 (IN vs OUT)
        if ent_col in df_deals.columns:
            print("\n[Distribuição por Entrada/Saída]")
            print(df_deals.groupby(ent_col)["profit"].agg(["count", "sum"]))

        # Fechamentos com lucro zero no extrato
        deals_out = df_deals[df_deals[ent_col].astype(str).str.upper().isin(["OUT", "1"])] if ent_col in df_deals.columns else df_deals
        zeros_extrato = len(deals_out[deals_out["profit"] == 0.0])
        lucrativos = len(deals_out[deals_out["profit"] > 0.0])
        prejuizos = len(deals_out[deals_out["profit"] < 0.0])
        print(f"\nDeals de saída (OUT): {len(deals_out)} | Lucro: {lucrativos} | Prejuízo: {prejuizos} | Zero: {zeros_extrato}")

    # 3. TRILHA DE ORDENS JSON
    print("\n--- 3. TRILHA JSON DO ROBÔ (trades_2026-11-23.json) ---")
    json_path = "data/trades_2026-11-23.json"
    if os.path.exists(json_path):
        trades = []
        with open(json_path, "r", encoding="utf-8", errors="ignore") as f:
            for l in f:
                if l.strip():
                    try:
                        trades.append(json.loads(l))
                    except:
                        pass
        print(f"Total de eventos gravados no JSON: {len(trades)}")
        acoes = {}
        magics = {}
        pnl_fechamentos = 0.0
        fech_total = 0
        fech_pnl_ok = 0
        fech_pnl_zero = 0
        slippages = []
        tickets_unicos = set()

        for t in trades:
            act = t.get("action", "OUTRO")
            acoes[act] = acoes.get(act, 0) + 1
            mg = t.get("magic", 0)
            magics[mg] = magics.get(mg, 0) + 1
            tk = t.get("ticket") or t.get("position_ticket")
            if tk:
                tickets_unicos.add(tk)

            slp = t.get("slippage")
            if slp is not None:
                slippages.append(float(slp))

            pnl = t.get("result_pnl")
            if any(k in act.upper() for k in ["CLOSE", "PARCIAL", "TAKE", "STOP"]):
                fech_total += 1
                if pnl is not None and abs(float(pnl)) > 1e-6:
                    fech_pnl_ok += 1
                    pnl_fechamentos += float(pnl)
                else:
                    fech_pnl_zero += 1

        print("Ações executadas/registradas:")
        for a, c in sorted(acoes.items(), key=lambda x: -x[1]):
            print(f"  {a:<25}: {c}")

        print("Magics ativos no JSON:")
        for m, c in sorted(magics.items(), key=lambda x: -x[1]):
            print(f"  Magic {m:<10}: {c} eventos")

        print(f"\nFechamentos no JSON: {fech_total} total | {fech_pnl_ok} PnL OK ({pnl_fechamentos:+.2f}) | {fech_pnl_zero} PnL Zero")
        if slippages:
            print(f"Slippage médio de execução: {sum(slippages)/len(slippages):.2f} pts | min={min(slippages):.1f} | max={max(slippages):.1f} | amostra={len(slippages)}")

    # 4. TRILHA DE ORDENS CSV E RECUSAS
    print("\n--- 4. AUDITORIA DE ORDENS E MOTIVOS DE RECUSA (ordens_*.csv) ---")
    for csv_file in glob.glob("data/auditoria/ordens_*_20261123.csv"):
        df_ord = pd.read_csv(csv_file)
        sym = os.path.basename(csv_file).replace("ordens_", "").replace("_20261123.csv", "")
        print(f"\n[{sym}] Total de tentativas: {len(df_ord)}")
        print("Motivos registrados:")
        print(df_ord["motivo"].value_counts().to_string())

if __name__ == "__main__":
    main()
