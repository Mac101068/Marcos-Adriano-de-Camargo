# -*- coding: utf-8 -*-
"""Teste sintético do coletor de microestrutura e do analisador de labels.

Usa a API real de coletor_microestrutura.MicrostructureCollector (a mesma que o motor
chama em mt5_stream_loop) numa pasta temporária, sem MT5 e sem rede.
"""
import os
import csv
import shutil
import tempfile

from coletor_microestrutura import MicrostructureCollector, COLUNAS_MICROESTRUTURA
from analisador_antecipacao_quant import calcular_antecipacao_arquivo

FALHAS = []


def check(nome, esperado, obtido):
    ok = esperado == obtido
    print(f"  {'[OK]' if ok else '[FALHA]'} {nome} | esperado={esperado} obtido={obtido}")
    if not ok:
        FALHAS.append(nome)


def ler_csv(caminho):
    with open(caminho, "r", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def test_coletor_e_antecipacao():
    test_dir = tempfile.mkdtemp(prefix="coletor_micro_")
    try:
        print("=== 1. Ingestão de 200 eventos e gravação do CSV ===")
        col = MicrostructureCollector(output_dir=test_dir)
        col.start()

        base_ts = 1795694400000  # 26/11/2026 ~09:00 BRT (epoch UTC real, já com offset)
        preco = 125000.0
        for i in range(200):
            if i % 10 == 0:
                preco += 10.0
            elif i % 10 == 5:
                preco -= 5.0
            sinal = {"signal": "BUY", "reason": "TESTE", "boxIndex": 7} if i == 50 else None
            col.registrar_evento(
                symbol="WINZ26", preco=preco, volume=(i % 5 + 1) * 2,
                aggressor="BUY" if i % 2 == 0 else ("SELL" if i % 3 else "CROSS"),
                ts_msc=base_ts + i * 50, bid=preco - 5.0, ask=preco,
                fonte="TESTE", sinal_info=sinal,
            )
        col.stop()

        stats = col.obter_estatisticas()
        print("  contadores:", stats)
        check("recebidos", 200, stats["recebidos"])
        check("gravados", 200, stats["gravados"])
        check("descartados", 0, stats["descartados_fila_cheia"])
        check("erros de escrita", 0, stats["erros_escrita"])

        arquivos = sorted(f for f in os.listdir(test_dir) if f.endswith(".csv"))
        check("um CSV gerado", 1, len(arquivos))
        caminho = os.path.join(test_dir, arquivos[0])
        check("nome no padrão LAB_MICROESTRUTURA_<ativo>_<dia>_<hora>",
              True, arquivos[0].startswith("LAB_MICROESTRUTURA_WINZ26_20261126_"))

        with open(caminho, "r", encoding="utf-8") as f:
            cabecalho = next(csv.reader(f))
        check("cabeçalho completo e na ordem", COLUNAS_MICROESTRUTURA, cabecalho)

        linhas = ler_csv(caminho)
        check("200 linhas", 200, len(linhas))
        ts = [int(r["timestamp_evento_msc"]) for r in linhas]
        seq = [int(r["sequencia_evento"]) for r in linhas]
        check("timestamps crescentes", True, all(a < b for a, b in zip(ts, ts[1:])))
        check("sem evento duplicado (ativo, sequencia)", 200, len({(r["ativo"], r["sequencia_evento"]) for r in linhas}))
        check("sequência 1..200", list(range(1, 201)), seq)
        check("hora formatada em BRT", "09:00:00.000", linhas[0]["hora_formatada"])
        delta = sum(int(r["delta_negocio"]) for r in linhas)
        check("delta acumulado = soma dos deltas", delta, int(linhas[-1]["delta_acumulado_sessao"]))
        check("CROSS não entra no delta", True,
              all(r["delta_negocio"] == "0" for r in linhas if r["lado_agressor"] == "CROSS"))
        check("sinal vinculado ao evento 51", ["51"], [r["sequencia_evento"] for r in linhas if r["sinal_ativo"] == "1"])
        check("sinal tipo BUY", "BUY", linhas[50]["sinal_tipo"])
        check("sinal motivo TESTE", "TESTE", linhas[50]["sinal_motivo"])
        check("sinal box index 7", "7", linhas[50]["sinal_box_index"])

        print("\n=== 2. Labels futuros (+100ms/+500ms/+1s/+5s) sem look-ahead ===")
        saida = calcular_antecipacao_arquivo(caminho)
        lab = ler_csv(saida)
        check("mesmo número de linhas", 200, len(lab))
        for c in ["delta_preco_100ms", "delta_preco_500ms", "delta_preco_1s", "delta_preco_5s",
                  "deslocou_favoravel_1s", "absorcao_detectada_1s"]:
            check(f"coluna {c}", True, c in lab[0])
        # features intactas: as colunas originais não mudam com o enriquecimento
        check("features não alteradas", True,
              all(lab[i][c] == linhas[i][c] for i in range(200) for c in COLUNAS_MICROESTRUTURA))
        # +100ms com eventos a cada 50ms: compara com o evento i+2
        precos = [float(r["preco_ultimo"]) for r in linhas]
        esperado = [round(precos[i + 2] - precos[i], 4) for i in range(198)]
        obtido = [float(lab[i]["delta_preco_100ms"]) for i in range(198)]
        check("delta_preco_100ms = preço(t+100ms) - preço(t)", esperado, obtido)
        # 5s = 100 eventos: os últimos 100 não têm futuro e ficam vazios
        check("sem futuro => label vazio (+5s)", 100, sum(1 for r in lab if r["delta_preco_5s"] == ""))
    finally:
        shutil.rmtree(test_dir, ignore_errors=True)

    print("\n" + "=" * 60)
    if FALHAS:
        print(f"FALHAS: {len(FALHAS)} -> {FALHAS}")
        raise SystemExit(1)
    print("OK COLETOR E ANALISADOR: todos os checks passaram.")


def test_sinal_info_metadados():
    test_dir = tempfile.mkdtemp(prefix="coletor_micro_meta_")
    try:
        col = MicrostructureCollector(output_dir=test_dir)
        col.start()
        base_ts = 1795694400000
        # Evento com index e score completos (formato vindo do motor mt5_stream_loop)
        sinal = {"signal": "SELL", "reason": "PULLBACK_RETEST", "index": 42, "score": 8}
        col.registrar_evento(
            symbol="WDOZ26", preco=5500.0, volume=5, aggressor="SELL",
            ts_msc=base_ts, bid=5499.5, ask=5500.0, fonte="VIVO_MT5", sinal_info=sinal
        )
        col.stop()
        arquivos = [f for f in os.listdir(test_dir) if f.endswith(".csv")]
        check("arquivo gerado com metadados", 1, len(arquivos))
        linhas = ler_csv(os.path.join(test_dir, arquivos[0]))
        check("1 linha gerada", 1, len(linhas))
        check("sinal_ativo = 1", "1", linhas[0]["sinal_ativo"])
        check("sinal_tipo = SELL", "SELL", linhas[0]["sinal_tipo"])
        check("sinal_box_index resolvido de index = 42", "42", linhas[0]["sinal_box_index"])
        check("sinal_motivo contém score", True, "[score=8]" in linhas[0]["sinal_motivo"])
    finally:
        shutil.rmtree(test_dir, ignore_errors=True)


if __name__ == "__main__":
    test_coletor_e_antecipacao()
    test_sinal_info_metadados()
