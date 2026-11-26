#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
auditoria_pos_pregao_20261120.py

Script de Auditoria Forense Pós-Pregão (100% READ-ONLY).
Analisa os arquivos gerados pelo robô (JSONL de trades e CSV de ordens)
e confronta com extrato de deals da corretora para o pregão.

Uso:
    python auditoria_pos_pregao_20261120.py
    python auditoria_pos_pregao_20261120.py --data 2026-11-20
    python auditoria_pos_pregao_20261120.py --data 2026-11-19 --debug
"""

import os
import sys
import glob
import json
import csv
import argparse
from datetime import datetime

# Garante suporte UTF-8 no terminal Windows
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

RAIZ = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(RAIZ, "data")
AUDIT_DIR = os.path.join(DATA_DIR, "auditoria")

# Mapeamento oficial de Magics do projeto
MAGIC_MAP = {
    102030: "Robô Principal (10R Pirâmide)",
    999999: "Boleta Manual (Operador)",
    100001: "RoboCompra (Hedge)",
    100002: "RoboVenda (Hedge)",
    150201: "Varal Manual Compra",
    150202: "Varal Manual Venda",
    0:      "Manual Direto no MT5 (Magic 0)"
}

ACTIONS_FECHAMENTO = {
    "CLOSE_POSITION", "CLOSE_PARCIAL", "TAKE_PROFIT", "STOP_LOSS",
    "HARD_CAP_CLOSED", "ZERAGEM_ACCEPTED", "PARCIAL_ACCEPTED"
}


def parse_args():
    parser = argparse.ArgumentParser(description="Auditoria Forense Pós-Pregão")
    parser.add_argument(
        "--data",
        type=str,
        default="2026-11-20",
        help="Data do pregão (YYYY-MM-DD ou YYYYMMDD). Padrão: 2026-11-20 (ou hoje se existir)"
    )
    parser.add_argument(
        "--debug",
        action="store_true",
        help="Exibe listagem detalhada de operações de fechamento e anomalias"
    )
    return parser.parse_args()


def normalizar_datas(data_str):
    """Devolve tupla (YYYY-MM-DD, YYYYMMDD)."""
    s = str(data_str).strip().replace("/", "-")
    if len(s) == 8 and s.isdigit():
        iso = f"{s[:4]}-{s[4:6]}-{s[6:]}"
        compact = s
    elif len(s) == 10 and "-" in s:
        iso = s
        compact = s.replace("-", "")
    else:
        # Fallback para hoje
        now = datetime.now()
        iso = now.strftime("%Y-%m-%d")
        compact = now.strftime("%Y%m%d")
    return iso, compact


def carregar_jsonl_trades(caminho):
    registros = []
    if not os.path.isfile(caminho):
        return registros
    with open(caminho, "r", encoding="utf-8", errors="replace") as fh:
        for num_l, linha in enumerate(fh, 1):
            linha = linha.strip()
            if not linha:
                continue
            try:
                d = json.loads(linha)
                registros.append(d)
            except Exception as e:
                print(f"⚠️ [AVISO] Linha {num_l} corrompida no JSON ignorada: {e}", file=sys.stderr)
    return registros


def carregar_csvs_ordens(data_compact):
    padrao = os.path.join(AUDIT_DIR, f"ordens_*_{data_compact}.csv")
    arquivos = glob.glob(padrao)
    fallback = os.path.join(AUDIT_DIR, f"ordens_{data_compact}.csv")
    if os.path.isfile(fallback) and fallback not in arquivos:
        arquivos.append(fallback)

    linhas = []
    for arq in arquivos:
        try:
            with open(arq, "r", encoding="utf-8", errors="replace") as f:
                reader = csv.DictReader(f)
                for row in reader:
                    linhas.append(row)
        except Exception:
            pass
    return linhas, arquivos


def carregar_csvs_deals(data_compact):
    caminho = os.path.join(AUDIT_DIR, f"deals_{data_compact}.csv")
    deals = []
    if os.path.isfile(caminho):
        try:
            with open(caminho, "r", encoding="utf-8", errors="replace") as f:
                reader = csv.DictReader(f)
                for row in reader:
                    deals.append(row)
        except Exception:
            pass
    return deals, caminho


def formatar_moeda(val):
    if val >= 0:
        return f"\033[32mR$ {val:,.2f}\033[0m"
    return f"\033[31m-R$ {abs(val):,.2f}\033[0m"


def main():
    args = parse_args()
    data_iso, data_compact = normalizar_datas(args.data)

    caminho_trades = os.path.join(DATA_DIR, f"trades_{data_iso}.json")

    # Se 2026-11-20 não existir no momento do teste mas existir a data de hoje, avisa
    if not os.path.isfile(caminho_trades):
        hoje_iso = datetime.now().strftime("%Y-%m-%d")
        caminho_hoje = os.path.join(DATA_DIR, f"trades_{hoje_iso}.json")
        if os.path.isfile(caminho_hoje) and args.data == "2026-11-20":
            print(f"ℹ️ Arquivo para {data_iso} não encontrado. Utilizando pregão de hoje ({hoje_iso}).")
            data_iso, data_compact = normalizar_datas(hoje_iso)
            caminho_trades = caminho_hoje

    trades = carregar_jsonl_trades(caminho_trades)
    ordens, arqs_ordens = carregar_csvs_ordens(data_compact)
    deals, caminho_deals = carregar_csvs_deals(data_compact)

    print("=" * 80)
    print(f"📊 RELATÓRIO DE AUDITORIA FORENSE PÓS-PREGÃO — {data_iso}")
    print("=" * 80)
    print(f"• Trilha JSONL : {caminho_trades} ({len(trades)} eventos)")
    print(f"• Trilha CSV   : {len(arqs_ordens)} arquivo(s) encontrado(s) ({len(ordens)} ordens)")
    print(f"• Extrato Deals: {caminho_deals if deals else 'Nenhum CSV de deals gravado'}")
    print("-" * 80)

    if not trades and not ordens:
        print(f"❌ Nenhum registro de operação encontrado para o dia {data_iso}.")
        print("Verifique se o bot rodou com a data correta ou se os arquivos estão em data/.")
        sys.exit(0)

    # 1. SEGMENTAÇÃO DE OPERAÇÕES E CONTRATOS
    vol_por_ativo = {}
    pnl_por_magic = {}
    trades_fechamento = []
    trades_abertura = []
    ordens_rejeitadas = []

    for t in trades:
        sym = str(t.get("symbol", "N/A")).upper()
        # Normalização de ativo
        ativo_base = "WIN" if "WIN" in sym else ("WDO" if "WDO" in sym else ("BIT" if "BIT" in sym else sym))
        vol = float(t.get("volume", 0) or 0)
        action = str(t.get("action", "")).upper()
        status = str(t.get("status", "")).upper()
        magic = int(t.get("magic", 0) or 0)
        pnl = float(t.get("result_pnl", 0.0) or 0.0)

        # Contabiliza contratos negociados
        vol_por_ativo[ativo_base] = vol_por_ativo.get(ativo_base, 0) + vol

        # Filtra fechamentos
        is_close = any(act in action for act in ACTIONS_FECHAMENTO) or "CLOSE" in status or "ZERAR" in status
        if is_close:
            trades_fechamento.append(t)
            if magic not in pnl_por_magic:
                pnl_por_magic[magic] = {"pnl": 0.0, "qtd": 0, "win": 0, "loss": 0, "zero": 0}
            pnl_por_magic[magic]["pnl"] += pnl
            pnl_por_magic[magic]["qtd"] += 1
            if pnl > 0.001:
                pnl_por_magic[magic]["win"] += 1
            elif pnl < -0.001:
                pnl_por_magic[magic]["loss"] += 1
            else:
                pnl_por_magic[magic]["zero"] += 1
        else:
            trades_abertura.append(t)

        if "REJECTED" in status or "FAILED" in status or "ERROR" in status:
            ordens_rejeitadas.append(t)

    # 2. RESUMO DE CONTRATOS E ATIVOS
    print("\n📦 CONTRATOS NEGOCIADOS POR ATIVO:")
    for atv, v in sorted(vol_por_ativo.items()):
        print(f"   • {atv:<8}: {int(v)} contrato(s)")

    # 3. PnL POR MAGIC NUMBER
    print("\n💰 RESULTADO FINANCEIRO (PnL) POR ORIGEM (MAGIC):")
    total_pnl = 0.0
    total_fechamentos = 0
    total_wins = 0
    total_losses = 0
    total_zeros = 0

    print("┌────────────┬──────────────────────────────────────┬───────┬──────┬──────┬──────┬──────────────────┐")
    print("│ Magic      │ Descrição / Estratégia               │ Fech. │ Win  │ Loss │ Zero │ PnL Líquido      │")
    print("├────────────┼──────────────────────────────────────┼───────┼──────┼──────┼──────┼──────────────────┤")
    for m, info in sorted(pnl_por_magic.items()):
        desc = MAGIC_MAP.get(m, f"Customizado (#{m})")[:36]
        m_pnl = info["pnl"]
        total_pnl += m_pnl
        total_fechamentos += info["qtd"]
        total_wins += info["win"]
        total_losses += info["loss"]
        total_zeros += info["zero"]
        pnl_str = f"R$ {m_pnl:,.2f}" if m_pnl >= 0 else f"-R$ {abs(m_pnl):,.2f}"
        print(f"│ {m:<10} │ {desc:<36} │ {info['qtd']:<5} │ {info['win']:<4} │ {info['loss']:<4} │ {info['zero']:<4} │ {pnl_str:>16} │")
    print("└────────────┴──────────────────────────────────────┴───────┴──────┴──────┴──────┴──────────────────┘")

    # 4. AUDITORIA DO FIX DE PnL (FORENSE)
    fech_zerados = [t for t in trades_fechamento if abs(float(t.get("result_pnl", 0.0) or 0.0)) < 1e-6]
    fech_com_pnl = [t for t in trades_fechamento if abs(float(t.get("result_pnl", 0.0) or 0.0)) >= 1e-6]

    print("\n🔬 AUDITORIA FORENSE DA GRAVAÇÃO DE PnL (FIX RESULT_PNL):")
    print(f"   • Total de Fechamentos Identificados: {len(trades_fechamento)}")
    print(f"   • Fechamentos com PnL gravado (!= 0) : \033[32m{len(fech_com_pnl)}\033[0m")
    cor_zerados = "\033[31m" if fech_zerados else "\033[32m"
    print(f"   • Fechamentos com PnL Zerado (== 0)  : {cor_zerados}{len(fech_zerados)}\033[0m")

    if fech_zerados:
        print("\n   ⚠️ ALERTA: Há fechamentos que ainda registraram 0.00 de PnL:")
        for z in fech_zerados[:5]:
            act = z.get("action", "CLOSE")
            tkt = z.get("ticket", z.get("position_ticket", "-"))
            st = z.get("status", "-")
            cmt = z.get("comment", "-")
            print(f"      - Action: {act} | Ticket: {tkt} | Status: {st} | Comment: {cmt}")
        if len(fech_zerados) > 5:
            print(f"      ... e mais {len(fech_zerados) - 5} operação(ões).")

    # 5. ESTATÍSTICAS DE PERFORMANCE
    if total_wins + total_losses > 0:
        win_rate = (total_wins / (total_wins + total_losses)) * 100
    else:
        win_rate = 0.0

    print("\n📈 ESTATÍSTICAS DO PREGÃO:")
    print(f"   • PnL Total Consolidado : {formatar_moeda(total_pnl)}")
    print(f"   • Win Rate Geral        : {win_rate:.1f}% ({total_wins}W / {total_losses}L / {total_zeros}E)")

    # 6. SLIPPAGE MÉDIO
    slippages = []
    for t in trades:
        slp = t.get("slippage")
        if slp is not None:
            try:
                slippages.append(float(slp))
            except Exception:
                pass
    if slippages:
        med_slp = sum(slippages) / len(slippages)
        print(f"   • Slippage Médio        : {med_slp:+.2f} pts ({len(slippages)} medições)")

    # 7. REJEIÇÕES E ERROS
    print("\n🛡️ AUDITORIA DE REJEIÇÕES / ERROS:")
    if ordens_rejeitadas:
        print(f"   ❌ {len(ordens_rejeitadas)} evento(s) com erro ou rejeição:")
        for r in ordens_rejeitadas[:5]:
            print(f"      - {r.get('timestamp', '')} | Action: {r.get('action')} | Motivo: {r.get('reason', r.get('comment', 'Rejeitada'))}")
    else:
        print("   ✅ Nenhuma ordem rejeitada ou abortada pela corretora.")

    # 8. MODO DEBUG
    if args.debug and trades_fechamento:
        print("\n" + "=" * 80)
        print("🔍 DETALHAMENTO DE FECHAMENTOS (--DEBUG)")
        print("=" * 80)
        print(f"{'Horário':<19} | {'Action':<15} | {'PnL (R$)':<10} | {'ExecPrice':<9} | {'Ticket':<10} | {'Magic':<7} | {'Comment'}")
        print("-" * 80)
        for t in trades_fechamento[-15:]:
            ts = str(t.get("timestamp", ""))[:19]
            act = str(t.get("action", ""))[:15]
            pnl_val = float(t.get("result_pnl", 0.0) or 0.0)
            ep = str(t.get("exec_price", "-"))[:9]
            tkt = str(t.get("ticket", t.get("position_ticket", "-")))[:10]
            mg = str(t.get("magic", "-"))[:7]
            cmt = str(t.get("comment", "-"))[:25]
            print(f"{ts:<19} | {act:<15} | {pnl_val:>10.2f} | {ep:<9} | {tkt:<10} | {mg:<7} | {cmt}")

    print("\n" + "=" * 80)
    print("📋 VEREDITO FINAL DA AUDITORIA:")
    if len(fech_zerados) == 0 and len(fech_com_pnl) > 0:
        print("   ✅ AUDITORIA CONFORME: 100% dos fechamentos registraram PnL correto.")
    elif len(fech_zerados) > 0 and len(fech_com_pnl) > 0:
        pct_ok = (len(fech_com_pnl) / len(trades_fechamento)) * 100
        print(f"   ⚠️ PARCIALMENTE CONFORME: {pct_ok:.1f}% dos fechamentos com PnL registrado ({len(fech_zerados)} zerados).")
    elif len(trades_fechamento) == 0:
        print("   ℹ️ Nenhuma ordem de fechamento realizada neste pregão.")
    else:
        print("   ❌ NÃO CONFORME: Todos os fechamentos estão com PnL zerado.")
    print("=" * 80 + "\n")


if __name__ == "__main__":
    main()
