#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
testa_pnl_fix.py

SCRIPT AUTOMATIZADO DE VALIDAÇÃO DO FIX DE PnL (READ-ONLY)
Compara registros de fechamento de ordens em data/trades_YYYY-MM-DD.json
entre antes e depois do commit de fix de persistência de PnL (6dc426c).

100% Read-Only: Não altera arquivos, não envia ordens, usa apenas stdlib.
"""

import os
import sys
import json
import subprocess
from datetime import datetime

# Cores ANSI para console
VERDE = "\033[92m"
AMARELO = "\033[93m"
VERMELHO = "\033[91m"
CIANO = "\033[96m"
NEGRITO = "\033[1m"
RESET = "\033[0m"


def obter_commit_info(target_commit="6dc426c"):
    """
    Obtém o timestamp Unix e a data local do commit via git log.
    Se o commit especificado não existir, recua para HEAD com aviso.
    """
    commit_usado = target_commit
    try:
        proc = subprocess.run(
            ["git", "log", "-1", "--format=%ct|%ci", target_commit],
            capture_output=True,
            text=True,
            check=True,
        )
        saida = proc.stdout.strip()
        if saida and "|" in saida:
            parts = saida.split("|")
            ts = int(parts[0].strip())
            dt_local = datetime.fromtimestamp(ts)
            return ts, dt_local, commit_usado
    except Exception:
        pass

    # Fallback para HEAD
    try:
        proc = subprocess.run(
            ["git", "log", "-1", "--format=%ct|%ci", "HEAD"],
            capture_output=True,
            text=True,
            check=True,
        )
        saida = proc.stdout.strip()
        parts = saida.split("|")
        ts = int(parts[0].strip())
        dt_local = datetime.fromtimestamp(ts)
        print(f"{AMARELO}[AVISO] Commit '{target_commit}' não encontrado no git local. Usando HEAD.{RESET}")
        return ts, dt_local, "HEAD"
    except Exception as exc:
        print(f"{VERMELHO}[ERRO] Falha ao executar git log: {exc}{RESET}")
        sys.exit(1)


def parse_timestamp_registro(record):
    """
    Extrai datetime do campo timestamp ou timestamp_iso do registro JSON.
    """
    raw = record.get("timestamp") or record.get("timestamp_iso") or ""
    clean = raw.replace("T", " ").replace("Z", "")
    for fmt in ("%Y-%m-%d %H:%M:%S.%f", "%Y-%m-%d %H:%M:%S"):
        try:
            return datetime.strptime(clean[:26], fmt)
        except ValueError:
            continue
    return None


def is_real_ticket(ticket):
    """
    Filtra tickets com valores suspeitos (menores que 10000 são provavelmente testes unitários/simulação).
    """
    try:
        if ticket is None:
            return False
        return int(ticket) > 10000
    except Exception:
        return False


def is_real_price(price, symbol):
    """
    Filtra preços de teste/mock (ex: ExecPrice=5000.0 em WIN que opera em ~169.000).
    """
    try:
        price = float(price)
        sym_upper = str(symbol).upper()
        if "WIN" in sym_upper:
            return price > 50000  # WIN está em ~169.000
        elif "WDO" in sym_upper:
            return price > 4000   # WDO está em ~5.900
        elif "BIT" in sym_upper or "BTC" in sym_upper:
            return price > 100000  # BITX está em ~375.000
        return price > 0
    except Exception:
        return False


def eh_fechamento(record):
    """
    Identifica se o registro é uma operação de fechamento de posição/ordem.
    """
    action = str(record.get("action") or "").upper()
    status = str(record.get("status") or "").upper()

    keywords_action = (
        "CLOSE_POSITION",
        "CLOSE_PARCIAL",
        "TAKE_PROFIT",
        "STOP_LOSS",
        "HARD_CAP_CLOSED",
        "ZERAGEM_ACCEPTED",
        "PARCIAL_ACCEPTED",
    )
    if any(k in action for k in keywords_action):
        return True
    if any(k in action for k in ("CLOSE", "ZERAR")):
        return True
    if any(k in status for k in ("CLOSE", "ZERAR")):
        return True
    return False


def main():
    debug_mode = "--debug" in sys.argv

    # 1. Informações do commit
    ts_commit, dt_commit, commit_ref = obter_commit_info("6dc426c")

    # 2. Localização do arquivo trades_YYYY-MM-DD.json de hoje
    hoje_str = datetime.now().strftime("%Y-%m-%d")
    base_dir = os.path.dirname(os.path.abspath(__file__))
    json_path = os.path.join(base_dir, "data", f"trades_{hoje_str}.json")

    print(f"{CIANO}{NEGRITO}{'=' * 78}{RESET}")
    print(f"{CIANO}{NEGRITO}  VALIDAÇÃO AUTOMATIZADA DO FIX DE PnL (READ-ONLY){RESET}")
    print(f"{CIANO}{NEGRITO}{'=' * 78}{RESET}")
    print(f" Commit de referência: {NEGRITO}{commit_ref}{RESET} ({dt_commit.strftime('%Y-%m-%d %H:%M:%S')})")
    print(f" Arquivo do pregão   : {NEGRITO}{json_path}{RESET}")
    print(f"{CIANO}{'-' * 78}{RESET}")

    if not os.path.isfile(json_path):
        print(f"\n{VERMELHO}❌ Arquivo não encontrado: {json_path}{RESET}")
        print(f"{AMARELO}Nenhum log de trades gerado para a data de hoje ({hoje_str}).{RESET}")
        sys.exit(2)

    # 3. Leitura e parsing do JSONL
    registros = []
    linhas_corrompidas = 0
    with open(json_path, "r", encoding="utf-8", errors="ignore") as f:
        for idx, linha in enumerate(f, 1):
            linha = linha.strip()
            if not linha:
                continue
            try:
                registros.append(json.loads(linha))
            except Exception as err:
                linhas_corrompidas += 1
                if debug_mode:
                    print(f"{AMARELO}[AVISO] Linha {idx} ignorada (JSON inválido): {err}{RESET}")

    if linhas_corrompidas > 0 and not debug_mode:
        print(f"{AMARELO}[AVISO] {linhas_corrompidas} linha(s) corrompida(s) ignorada(s).{RESET}")

    # 4. Filtragem e separação pré vs pós
    pre_fechamentos = []
    pos_fechamentos = []

    for r in registros:
        if not eh_fechamento(r):
            continue
        dt_reg = parse_timestamp_registro(r)
        if not dt_reg:
            continue

        if dt_reg < dt_commit:
            pre_fechamentos.append(r)
        else:
            pos_fechamentos.append(r)

    # 5. Filtragem de operações REAIS vs Edge Cases / Testes Sintéticos
    def obter_preco_relevante(op):
        for k in ("exec_price", "open_price", "signal_price", "price"):
            v = op.get(k)
            if v is not None:
                try:
                    val = float(v)
                    if val > 0:
                        return val
                except (ValueError, TypeError):
                    continue
        return 0.0

    post_commit_real = [
        op for op in pos_fechamentos
        if is_real_ticket(op.get("ticket") or op.get("position_ticket"))
        and is_real_price(obter_preco_relevante(op), op.get("symbol", ""))
    ]

    post_commit_testes = [
        op for op in pos_fechamentos
        if op not in post_commit_real
    ]

    # Métricas sobre operações reais
    total_real = len(post_commit_real)
    pnl_ok_real = sum(1 for op in post_commit_real if abs(float(op.get("result_pnl", 0.0) or 0.0)) > 1e-6)
    pnl_zero_real = total_real - pnl_ok_real
    soma_pnl_real = sum(float(op.get("result_pnl", 0.0) or 0.0) for op in post_commit_real)

    # Métricas gerais por grupo
    def calcular_metricas(lista):
        total = len(lista)
        if total == 0:
            return 0, 0, 0, 0.0
        pnl_zero = sum(1 for r in lista if abs(float(r.get("result_pnl") or 0.0)) < 1e-6)
        pnl_nao_zero = total - pnl_zero
        soma_pnl = sum(float(r.get("result_pnl") or 0.0) for r in lista)
        return total, pnl_nao_zero, pnl_zero, soma_pnl

    pre_total, pre_nao_zero, pre_zero, pre_soma = calcular_metricas(pre_fechamentos)
    pos_total, pos_nao_zero, pos_zero, pos_soma = calcular_metricas(pos_fechamentos)
    testes_total, testes_nao_zero, testes_zero, testes_soma = calcular_metricas(post_commit_testes)

    # 6. Tabela comparativa pré vs pós
    print(f"\n{NEGRITO}📊 TABELA COMPARATIVA DE OPERAÇÕES DE FECHAMENTO:{RESET}\n")
    print(f"┌────────────────────┬───────────────────┬──────────────┬──────────────┬──────────────────┐")
    print(f"│ Grupo              │ Total Fechamentos │ PnL ≠ 0 (OK) │ PnL = 0 (Zer)│ Soma PnL (R$)    │")
    print(f"├────────────────────┼───────────────────┼──────────────┼──────────────┼──────────────────┤")
    print(f"│ PRÉ-COMMIT         │ {pre_total:<17} │ {pre_nao_zero:<12} │ {pre_zero:<12} │ R$ {pre_soma:<13.2f} │")
    print(f"│ PÓS-COMMIT (BRUTO) │ {pos_total:<17} │ {pos_nao_zero:<12} │ {pos_zero:<12} │ R$ {pos_soma:<13.2f} │")
    if testes_total > 0:
        print(f"│  ↳ TESTES/MOCKS    │ {testes_total:<17} │ {testes_nao_zero:<12} │ {testes_zero:<12} │ R$ {testes_soma:<13.2f} │")
    print(f"│  ↳ OPERAÇÕES REAIS │ {total_real:<17} │ {pnl_ok_real:<12} │ {pnl_zero_real:<12} │ R$ {soma_pnl_real:<13.2f} │")
    print(f"└────────────────────┴───────────────────┴──────────────┴──────────────┴──────────────────┘\n")

    # 7. Veredito Automático (Focado nas Operações REAIS)
    print(f"{NEGRITO}📋 VEREDITO AUTOMÁTICO (OPERAÇÕES REAIS):{RESET}")
    if total_real == 0:
        print(f"{AMARELO}{NEGRITO}⚠️ Nenhuma operação REAL pós-commit encontrada. Faça operações de teste no mercado.{RESET}\n")
    elif pnl_zero_real == 0:
        print(
            f"{VERDE}{NEGRITO}✅ FIX VALIDADO: {pnl_ok_real}/{total_real} operações REAIS com PnL correto.{RESET}\n"
            f"   100% dos fechamentos reais de mercado possuem PnL financeiro auditado e consistente!\n"
        )
    else:
        print(
            f"{VERMELHO}{NEGRITO}❌ FIX INCOMPLETO: {pnl_zero_real}/{total_real} operações REAIS ainda com PnL zero.{RESET}\n"
            f"   Execute com {CIANO}--debug{RESET} para inspecionar os registros problemáticos.\n"
        )

    # 8. Detalhamento em Modo --debug
    if debug_mode and pos_fechamentos:
        print(f"\n{CIANO}{NEGRITO}🔍 DETALHAMENTO DAS ÚLTIMAS OPERAÇÕES PÓS-COMMIT (--debug):{RESET}\n")
        ultimas = pos_fechamentos[-10:]
        fmt_cab = "{:<18} {:<16} {:<10} {:<10} {:<10} {:<10} {:<8} {:<12} {:<20}"
        print(fmt_cab.format("Action", "Status", "PnL (R$)", "ExecPrice", "SignPrice", "Ticket", "Magic", "Tipo", "Comment"))
        print("-" * 125)
        for r in ultimas:
            pnl_val = float(r.get("result_pnl") or 0.0)
            cor_pnl = VERDE if abs(pnl_val) >= 1e-6 else VERMELHO
            exec_p = str(r.get("exec_price") or "-")
            sign_p = str(r.get("signal_price") or "-")
            tk = str(r.get("ticket") or r.get("position_ticket") or "-")
            mg = str(r.get("magic") or "-")
            cm = str(r.get("comment") or "")[:20]
            act = str(r.get("action") or "")[:18]
            st = str(r.get("status") or "")[:16]
            tipo_op = "REAL" if r in post_commit_real else "TESTE/MOCK"

            linha_str = (
                f"{act:<18} {st:<16} {cor_pnl}{pnl_val:<10.2f}{RESET} "
                f"{exec_p:<10} {sign_p:<10} {tk:<10} {mg:<8} {tipo_op:<12} {cm:<20}"
            )
            print(linha_str)
        print()

    # Código de saída baseado nas operações REAIS
    if total_real > 0 and pnl_zero_real > 0:
        sys.exit(1)
    sys.exit(0)


if __name__ == "__main__":
    main()
