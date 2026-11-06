"""Diário de auditoria do RoboFluxoB3 — a prova do que aconteceu de verdade.

Existe um problema estrutural neste projeto: a ponte imprime no console o que ELA acha que
fez, e nada guarda isso de forma consultável. Resultado: quando o resultado na tela não bate
com o sinal, não há como dizer se o sinal era ruim, se a execução foi ruim ou se simplesmente
nenhuma ordem saiu (foi o que aconteceu no pregão de 05/Nov/2026: 15 tentativas de ordem, 0
envios, e nada disso estava registrado em lugar nenhum).

Este módulo grava três trilhas em CSV, uma linha por evento, e é usado por AMBOS os lados:

  eventos  → 1 linha por box fechado: o veredito completo do avaliador (Delta, limiar efetivo,
             Efficiency Ratio, exaustão) e o motivo por que o sinal saiu OU foi calado. É a
             única forma de medir o valor de um filtro: sem registrar os rejeitados, o filtro
             é inauditável.
  ordens   → 1 linha por tentativa de ordem na ponte, com o preço do box que gerou o sinal ao
             lado do preço efetivo do fill. A diferença entre as duas colunas é o custo real de
             entrar "a mercado no fechamento do bloco".
  deals    → o extrato REAL da corretora (mt5.history_deals_get): a única fonte de verdade de
             PnL. É o que confirma (ou desmente) tudo que as outras duas trilhas afirmam.

Os arquivos vivem em data/auditoria/ e são separados por pregão e por ativo, para que a
reprodução offline (reproduzir_pregao.py) consiga ser comparada linha a linha com o que o robô
fez ao vivo. Nunca deixe uma falha de disco derrubar o loop de trading: toda gravação passa por
try/except e pelo interruptor AUDITORIA_ENABLED.
"""
import sys

import csv
import os
from datetime import datetime

# O console do Windows é cp850/cp1252 e morre em UnicodeEncodeError ao imprimir travessão
# com a saída redirecionada — que é exatamente o modo como log, launcher e agente rodam isto.
# Forçar UTF-8 no stdout é o que faz o mesmo script valer nas duas máquinas sem perder acento.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

PASTA_AUDITORIA = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "auditoria")

# Colunas fixas: mudar aqui exige bater o schema em reproduzir_pregao.py e auditar_performance.py
EVENTOS_CAMPOS = [
    "data", "hora", "fonte", "simbolo", "box_index", "direcao", "abertura", "fechamento",
    "alta", "baixa", "delta", "volume_compra", "volume_venda", "ticks", "cvd",
    "fator_regime", "limiar_compra", "limiar_venda", "efficiency_ratio", "consolidacao",
    "exaustao", "sinal", "motivo", "ts_msc",
]

ORDENS_CAMPOS = [
    "data", "hora", "fonte", "simbolo", "box_index", "acao", "direcao", "volume",
    "preco_box", "preco_solicitado", "preco_fill", "slippage_pts", "ticket", "retcode",
    "executada", "sl_pontos", "tp_pontos", "motivo",
]

DEALS_CAMPOS = [
    "data", "hora", "simbolo", "deal", "order", "lado", "entrada", "volume", "preco",
    "comissao", "swap", "profit", "balance", "magic", "comment",
]

CONTA_CAMPOS = ["capturado_em", "login", "server", "balance", "equity", "profit_flutuante", "margem_livre"]


def caminho_arquivo(nome, dia=None, simbolo=None):
    """data/auditoria/<nome>[_<SIMBOLO>]_<AAAAMMDD>.csv — um arquivo por pregão (por ativo)."""
    os.makedirs(PASTA_AUDITORIA, exist_ok=True)
    dia = dia or datetime.now().strftime("%Y%m%d")
    sufixo = f"_{simbolo}" if simbolo else ""
    return os.path.join(PASTA_AUDITORIA, f"{nome}{sufixo}_{dia}.csv")


def _garantir_cabecalho(caminho, campos):
    novo = not os.path.exists(caminho) or os.path.getsize(caminho) == 0
    with open(caminho, "a", newline="", encoding="utf-8") as f:
        if novo:
            csv.DictWriter(f, fieldnames=campos).writeheader()
    return caminho


def gravar_linha(caminho, campos, linha):
    """Anexa e dá flush: ao perder o pregão por queda de processo, o diário não pode perder linha."""
    _garantir_cabecalho(caminho, campos)
    with open(caminho, "a", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=campos, extrasaction="ignore")
        w.writerow(linha)
        f.flush()
        os.fsync(f.fileno())


def registrar_box(box, veredito, fonte="VIVO", simbolo=""):
    """Grava o julgamento de UM box fechado — incluindo os calados, que são a metade importante.

    `veredito` é o dicionário de auditoria que o avaliador anexa no box (chave "audit"):
    limiares efetivos, ER medido, flags de consolidação/exaustão e o motivo do corte.
    """
    v = veredito or {}
    ts_msc = int(box.get("timestamp") or 0)
    dt = datetime.fromtimestamp(ts_msc / 1000) if ts_msc else datetime.now()
    linha = {
        "data": dt.strftime("%Y-%m-%d"),
        "hora": dt.strftime("%H:%M:%S"),
        "fonte": fonte,
        "simbolo": simbolo or box.get("symbol", ""),
        "box_index": box.get("index"),
        "direcao": box.get("direction"),
        "abertura": box.get("open"),
        "fechamento": box.get("close"),
        "alta": box.get("high"),
        "baixa": box.get("low"),
        "delta": box.get("delta"),
        "volume_compra": box.get("buy_volume"),
        "volume_venda": box.get("sell_volume"),
        "ticks": box.get("ticks_count"),
        "cvd": box.get("cvd_at_close"),
        "fator_regime": v.get("fator_regime"),
        "limiar_compra": v.get("limiar_compra"),
        "limiar_venda": v.get("limiar_venda"),
        "efficiency_ratio": v.get("efficiency_ratio"),
        "consolidacao": 1 if v.get("consolidacao") else 0,
        "exaustao": 1 if v.get("exaustao") else 0,
        "sinal": v.get("sinal") or "",
        "motivo": v.get("motivo") or "",
        # ts_msc é a chave de alinhamento entre o que a ponte viu ao vivo e o que a reprodução
        # offline gerou: o mesmo tick fecha o mesmo box nos dois lados, com índice igual só
        # quando a sessão começou no mesmo instante.
        "ts_msc": ts_msc or "",
    }
    try:
        gravar_linha(caminho_arquivo("eventos", linha["data"].replace("-", ""), simbolo or None), EVENTOS_CAMPOS, linha)
    except OSError:
        return False
    return True


def registrar_ordem(simbolo, acao, direcao="", volume=0, preco_box=None, preco_solicitado=None,
                    preco_fill=None, ticket=None, retcode=None, executada=False, sl_pontos=None,
                    tp_pontos=None, motivo="", box_index="", fonte="VIVO"):
    slippage = None
    try:
        if preco_fill and preco_box:
            slippage = round((float(preco_fill) - float(preco_box)), 4)
    except (TypeError, ValueError):
        slippage = None
    agora = datetime.now()
    linha = {
        "data": agora.strftime("%Y-%m-%d"), "hora": agora.strftime("%H:%M:%S"), "fonte": fonte,
        "simbolo": simbolo, "box_index": box_index, "acao": acao, "direcao": direcao,
        "volume": volume, "preco_box": preco_box, "preco_solicitado": preco_solicitado,
        "preco_fill": preco_fill, "slippage_pts": slippage, "ticket": ticket, "retcode": retcode,
        "executada": 1 if executada else 0, "sl_pontos": sl_pontos, "tp_pontos": tp_pontos,
        "motivo": motivo,
    }
    try:
        gravar_linha(caminho_arquivo("ordens", linha["data"].replace("-", ""), simbolo), ORDENS_CAMPOS, linha)
    except OSError:
        return False
    return True


def salvar_deals_mt5(deals, simbolo_filtro=None, dia=None):
    """Extrato REAL da corretora: substitui (não anexa) o arquivo do dia, porque é um snapshot
    da história — regravar é idempotente e pega os negócios que chegaram depois.

    `dia` (AAAAMMDD) permite gravar o extrato de um pregão anterior: a conta tem a história
    toda no MT5, e a auditoria de performance precisa dela, não só do dia de hoje.
    """
    dia = dia or datetime.now().strftime("%Y%m%d")
    caminho = caminho_arquivo("deals", dia, simbolo_filtro)
    campos = DEALS_CAMPOS
    os.makedirs(PASTA_AUDITORIA, exist_ok=True)
    with open(caminho, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=campos)
        w.writeheader()
        for d in deals or []:
            dt = datetime.fromtimestamp(int(getattr(d, "time", 0) or 0))
            w.writerow({
                "data": dt.strftime("%Y-%m-%d"), "hora": dt.strftime("%H:%M:%S"),
                "simbolo": getattr(d, "symbol", simbolo_filtro or ""),
                "deal": getattr(d, "ticket", ""), "order": getattr(d, "order", ""),
                "lado": "BUY" if getattr(d, "type", 0) == 0 else "SELL",
                "entrada": {0: "IN", 1: "OUT", 2: "OUT"}.get(getattr(d, "entry", 0), str(getattr(d, "entry", ""))),
                "volume": getattr(d, "volume", ""), "preco": getattr(d, "price", ""),
                "comissao": getattr(d, "commission", ""), "swap": getattr(d, "swap", ""),
                "profit": getattr(d, "profit", ""), "balance": getattr(d, "balance", ""),
                "magic": getattr(d, "magic", ""), "comment": getattr(d, "comment", ""),
            })
        f.flush()
    return caminho


def salvar_snapshot_conta(conta):
    agora = datetime.now()
    linha = {
        "capturado_em": agora.strftime("%Y-%m-%d %H:%M:%S"),
        "login": getattr(conta, "login", ""), "server": getattr(conta, "server", ""),
        "balance": getattr(conta, "balance", ""), "equity": getattr(conta, "equity", ""),
        "profit_flutuante": getattr(conta, "profit", ""), "margem_livre": getattr(conta, "margin_free", ""),
    }
    try:
        gravar_linha(caminho_arquivo("conta", agora.strftime("%Y%m%d")), CONTA_CAMPOS, linha)
    except OSError:
        return False
    return True


def carregar_eventos(dia=None, simbolo=None, fonte=None, dedup=True):
    """Lê o diário de boxes para comparação/relatório. Aceita filtro por pregão e por ativo.

    `dedup`: o arquivo é append-only de propósito (nunca se perde uma linha por causa de
    queda de processo), mas a ponte pode reiniciar no meio do pregão e replayear os ticks —
    o mesmo box voltaria a ser journalizado. Na leitura colapsamos por (símbolo, fonte,
    box_index), mantendo a última ocorrência, que é a que tem o julgamento mais completo.
    """
    import glob
    prefixo = f"eventos_{simbolo}_" if simbolo else "eventos_"
    linhas = []
    for caminho in sorted(glob.glob(os.path.join(PASTA_AUDITORIA, f"{prefixo}*.csv"))):
        if dia and dia.replace("-", "") not in caminho:
            continue
        try:
            with open(caminho, encoding="utf-8") as f:
                for r in csv.DictReader(f):
                    if fonte and r.get("fonte") != fonte:
                        continue
                    linhas.append(r)
        except OSError:
            continue
    if not dedup:
        return linhas
    unicos = {}
    for r in linhas:
        unicos[(r.get("simbolo"), r.get("fonte"), r.get("box_index"))] = r
    return list(unicos.values())
