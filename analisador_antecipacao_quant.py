# -*- coding: utf-8 -*-
"""
analisador_antecipacao_quant.py — Estudo de Antecipação Fluxo -> Preço (Sem Look-ahead)
Laboratório Quantitativo RoboFluxoB3.

Objetivo:
Processar um CSV de microestrutura (`LAB_MICROESTRUTURA_*.csv`) e gerar a base de estudo
com rótulos (labels) estritamente causais para as janelas de reação futura do preço:
- delta_preco_100ms
- delta_preco_500ms
- delta_preco_1s
- delta_preco_5s

Princípio Metodológico:
- Cada linha 'i' representa o estado conhecido NO INSTANTE t.
- As colunas de reação futura são preenchidas buscando o primeiro evento onde t' >= t + delta_t.
- Os labels são mantidos separados das features de entrada para não gerar viés.
"""

import os
import sys
import csv
import bisect
from typing import List, Dict, Any, Optional

def calcular_antecipacao_arquivo(caminho_csv_entrada: str, caminho_csv_saida: Optional[str] = None) -> str:
    if not os.path.exists(caminho_csv_entrada):
        raise FileNotFoundError(f"Arquivo não encontrado: {caminho_csv_entrada}")

    if caminho_csv_saida is None:
        base, ext = os.path.splitext(caminho_csv_entrada)
        caminho_csv_saida = f"{base}_COM_LABELS{ext}"

    linhas = []
    with open(caminho_csv_entrada, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        header_original = reader.fieldnames or []
        for row in reader:
            linhas.append(row)

    if not linhas:
        print(f"⚠️ [LAB QUANT] Arquivo vazio: {caminho_csv_entrada}")
        return caminho_csv_saida

    # Extrai listas de timestamps (msc) e preços como float
    timestamps = [int(r["timestamp_evento_msc"]) for r in linhas]
    precos = [float(r["preco_ultimo"]) for r in linhas]
    n = len(linhas)

    novas_colunas = [
        "delta_preco_100ms",
        "delta_preco_500ms",
        "delta_preco_1s",
        "delta_preco_5s",
        "deslocou_favoravel_1s",     # 1 se preço andou a favor da agressão, 0 se contra ou neutro
        "absorcao_detectada_1s"       # 1 se agressão foi alta mas o preço não avançou a favor
    ]

    novo_header = list(header_original) + novas_colunas

    janelas_ms = [100, 500, 1000, 5000]

    with open(caminho_csv_saida, "w", newline="", encoding="utf-8") as f_out:
        writer = csv.DictWriter(f_out, fieldnames=novo_header)
        writer.writeheader()

        for i in range(n):
            t_orig = timestamps[i]
            p_orig = precos[i]
            row = dict(linhas[i])
            lado = row.get("lado_agressor", "CROSS")
            vol = int(row.get("volume_negocio", 1))

            deltas_janela = {}
            for j_ms in janelas_ms:
                alvo_t = t_orig + j_ms
                idx = bisect.bisect_left(timestamps, alvo_t, lo=i)
                if idx < n:
                    p_futuro = precos[idx]
                    deltas_janela[j_ms] = round(p_futuro - p_orig, 4)
                else:
                    deltas_janela[j_ms] = ""  # Janela além do fim do arquivo

            row["delta_preco_100ms"] = deltas_janela[100]
            row["delta_preco_500ms"] = deltas_janela[500]
            row["delta_preco_1s"] = deltas_janela[1000]
            row["delta_preco_5s"] = deltas_janela[5000]

            # Hipótese Observável de Absorção vs Deslocamento em 1s
            dp_1s = deltas_janela[1000]
            if dp_1s != "":
                dp_num = float(dp_1s)
                if lado == "BUY":
                    row["deslocou_favoravel_1s"] = 1 if dp_num > 0 else 0
                    # Absorção: agrediu na compra com volume mas preço caiu ou ficou no mesmo nível
                    row["absorcao_detectada_1s"] = 1 if (dp_num <= 0 and vol >= 5) else 0
                elif lado == "SELL":
                    row["deslocou_favoravel_1s"] = 1 if dp_num < 0 else 0
                    # Absorção: agrediu na venda com volume mas preço subiu ou ficou no mesmo nível
                    row["absorcao_detectada_1s"] = 1 if (dp_num >= 0 and vol >= 5) else 0
                else:
                    row["deslocou_favoravel_1s"] = 0
                    row["absorcao_detectada_1s"] = 0
            else:
                row["deslocou_favoravel_1s"] = ""
                row["absorcao_detectada_1s"] = ""

            writer.writerow(row)

    print(f" ✅ [LAB QUANT] Base processada com labels causais: {caminho_csv_saida} ({n} linhas).", flush=True)
    return caminho_csv_saida

if __name__ == "__main__":
    if len(sys.argv) > 1:
        calcular_antecipacao_arquivo(sys.argv[1])
    else:
        print("Uso: python analisador_antecipacao_quant.py <caminho_do_csv_microestrutura>")
