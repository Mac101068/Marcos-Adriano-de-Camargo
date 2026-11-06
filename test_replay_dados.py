"""Testes do replay_dados — a camada que serve ticks REAIS comprimidos ao replay da web.

Roda com:  .\\venv\\Scripts\\python.exe test_replay_dados.py   (Windows)
           ./venv/bin/python test_replay_dados.py             (macOS/Linux)

O que este arquivo protege é o invariante que faz o replay valer alguma coisa: depois de comprimir,
o motor precisa ver OS MESMOS contratos por lado e o MESMO caminho de preço que veria na fita
inteira. Se isso quebrar, delta/CVD voltam a ser decorativos e a validação de estratégia passa a
mentir — silenciosamente, que é o pior tipo de quebra.

As seções que dependem do MetaTrader5 são PULADAS fora do Windows, com o motivo impresso: a lib só
tem rodagem Windows e o motor de replay é portátil por construção (espelha as flags em vez de
importá-la). Vermelho continua significando problema de código, nunca de ambiente.
"""

import os
import sys

import numpy as np

# O console do Windows é cp850/cp1252 e morre em UnicodeEncodeError ao imprimir travessão
# com a saída redirecionada — que é exatamente o modo como log, launcher e agente rodam isto.
# Forçar UTF-8 no stdout é o que faz o mesmo script valer nas duas máquinas sem perder acento.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import replay_dados as rd

FALHAS = []
PULOS = []


def checa(nome, ok, detalhe=""):
    print(f"  [{'OK ' if ok else 'XX '}] {nome}" + (f" — {detalhe}" if detalhe else ""))
    if not ok:
        FALHAS.append(nome)


def pula(nome, motivo):
    """Registra o que o ambiente não permite conferir — sem poluir a contagem de falhas."""
    print(f"  [PULA] {nome} — {motivo}")
    PULOS.append(f"{nome} — {motivo}")


def linha_crua(raw, last, vol, flags):
    return {"time_msc": raw, "last": last, "volume": vol, "flags": flags}


# ---------------------------------------------------------------------------------------------
# A. invariante de fluxo: Σcompra e Σvenda da saída são IDÊNTICOS aos da entrada
# ---------------------------------------------------------------------------------------------
print("\nA. fluxo preservado (o invariante do delta)")
rng = np.random.default_rng(7)
for bucket_ms in (250, 500, 1000, 4000):
    brutos = []
    ts = 1_793_783_024_000
    for i in range(4000):
        ts += int(rng.integers(0, 90))
        brutos.append(linha_crua(ts, float(169000 + int(rng.integers(-400, 400))),
                                 int(rng.integers(1, 60)),
                                 int(rng.choice([rd.FLAG_BUY, rd.FLAG_SELL, rd.FLAG_BUY | rd.FLAG_SELL, 0]))))
    saida, nb = rd.comprimir(brutos, bucket_ms)
    real_buy = sum(t["volume"] for t in brutos if t["flags"] & rd.FLAG_BUY)
    real_sell = sum(t["volume"] for t in brutos
                    if not (t["flags"] & rd.FLAG_BUY) and (t["flags"] & rd.FLAG_SELL))
    out_buy = sum(t["volume"] for t in saida if t["aggressor"] == "BUY")
    out_sell = sum(t["volume"] for t in saida if t["aggressor"] == "SELL")
    checa(f"bucket {bucket_ms} ms: contratos por lado batem",
          out_buy == real_buy and out_sell == real_sell,
          f"compra {real_buy:,}->{out_buy:,} | venda {real_sell:,}->{out_sell:,} | {nb} buckets")

# ---------------------------------------------------------------------------------------------
# B. caminho de preço: primeiro, último e os dois extremos de cada bucket chegam ao motor
# ---------------------------------------------------------------------------------------------
print("\nB. caminho de preço preservado")
brutos = [linha_crua(1_793_783_024_000 + k * 100, p, 5, rd.FLAG_BUY)
          for k, p in enumerate([100.0, 130.0, 90.0, 110.0])]
saida, _ = rd.comprimir(brutos, 100)
precos_saida = [t["price"] for t in saida]
checa("extremos e pontas aparecem na saída",
      set(precos_saida) == {100.0, 130.0, 90.0, 110.0}, str(precos_saida))
checa("ordem do caminho: extremo que veio antes (130) antes do 90",
      precos_saida.index(130.0) < precos_saida.index(90.0))
checa("timestamps não decrescentes",
      all(a["timestamp"] <= b["timestamp"] for a, b in zip(saida, saida[1:])))
checa("ids únicos", len({t["id"] for t in saida}) == len(saida), f"{len(saida)} emitidos")

# o caso degenerado: bucket de um tick só reproduz o tick original
unit, _ = rd.comprimir([linha_crua(1_793_783_024_500, 123.0, 9, rd.FLAG_SELL)], 100)
checa("bucket de 1 tick sai idêntico (preço, volume, agressor)",
      len(unit) == 1 and unit[0]["price"] == 123.0 and unit[0]["volume"] == 9
      and unit[0]["aggressor"] == "SELL", str(unit))

# ---------------------------------------------------------------------------------------------
# C. BUY vence SELL quando os dois flags vêm juntos — a MESMA regra da ponte
# ---------------------------------------------------------------------------------------------
print("\nC. regra de agressor idêntica à da ponte")
checa("BUY|SELL vira BUY (como em mt5_stream_loop)",
      rd.agressor_da_ponte(rd.FLAG_BUY | rd.FLAG_SELL) == "BUY")
checa("só SELL vira SELL", rd.agressor_da_ponte(rd.FLAG_SELL) == "SELL")
checa("sem flag de agressão vira CROSS", rd.agressor_da_ponte(0) == "CROSS")
dual, _ = rd.comprimir([linha_crua(1_793_783_024_000, 100.0, 7, rd.FLAG_BUY | rd.FLAG_SELL)], 100)
checa("tick BUY|SELL sai como 7 contratos BUY (e não 7 de cada lado)",
      len(dual) == 1 and dual[0]["aggressor"] == "BUY" and dual[0]["volume"] == 7, str(dual))

# ---------------------------------------------------------------------------------------------
# D. não-negócio (last <= 0) é descartado, como a ponte faz com `price <= 0`
# ---------------------------------------------------------------------------------------------
print("\nD. descarte de cotação sem negócio")
mistura = [linha_crua(1_793_783_024_000, 0.0, 0, 1026),
           linha_crua(1_793_783_024_100, 150.0, 4, rd.FLAG_BUY),
           linha_crua(1_793_783_024_200, 0.0, 0, 1028)]
so_negocio, _ = rd.comprimir(mistura, 1000)
checa("linhas de só bid/ask não viram tick", len(so_negocio) == 1
      and so_negocio[0]["price"] == 150.0, str(so_negocio))

# ---------------------------------------------------------------------------------------------
# E. constantes espelhadas da ponte/MT5 (o módulo não importa a ponte, por isso conferimos aqui)
#
# Dois blocos separados e independentes: a ponte (que importa MetaTrader5 no topo) e o pacote. Em
# macOS os dois caem por ImportError — e isso NÃO é falha do replay, é limite de plataforma.
# Qualquer outra exceção, porém, é alarme verdadeiro: a ponte existe e não monteou.
# ---------------------------------------------------------------------------------------------
print("\nE. constantes batem com a ponte e com o pacote MetaTrader5")
try:
    import bot_mt5_ciclo15 as ponte
except ImportError as exc:
    ponte = None
    pula("conferências contra a ponte", f"fora do Windows não há MetaTrader5 ({exc})")
except Exception as exc:
    ponte = None
    checa("ponte importável para conferir constantes", False, f"{type(exc).__name__}: {exc}")
try:
    import MetaTrader5 as mt5
except ImportError as exc:
    mt5 = None
    pula("conferências contra o pacote MetaTrader5", f"o pip não entrega esta lib fora do Windows ({exc})")
except Exception as exc:
    mt5 = None
    checa("pacote MetaTrader5 importável", False, f"{type(exc).__name__}: {exc}")

if ponte is not None:
    checa("BRT_OFFSET_MSC igual ao da ponte", rd.BRT_OFFSET_MSC == ponte.MT5_BRT_OFFSET_MSC,
          f"{rd.BRT_OFFSET_MSC} vs {ponte.MT5_BRT_OFFSET_MSC}")
    # Estas três são as costuras do protocolo: se divergirem, a tela recebe chunk do tamanho
    # errado ou um rótulo de fonte que ela não sabe ler.
    checa("TAMANHO_LOTE == HISTORY_CHUNK_TICKS da ponte", rd.TAMANHO_LOTE == ponte.HISTORY_CHUNK_TICKS,
          f"{rd.TAMANHO_LOTE} vs {ponte.HISTORY_CHUNK_TICKS}")
    checa("nomes de fonte idênticos aos rotulados pela ponte",
          ponte.VOLUME_SOURCE_TICKS_REAIS == "TICKS_REAIS"
          and ponte.VOLUME_SOURCE_M1 == "M1_RATE", ponte.VOLUME_SOURCE_TICKS_REAIS)
    checa("dias servidos cabem no teto que a ponte aceita",
          rd.MAX_DIAS_POR_PEDIDO <= ponte.HISTORY_MAX_DAYS,
          f"{rd.MAX_DIAS_POR_PEDIDO} vs {ponte.HISTORY_MAX_DAYS}")

if mt5 is not None:
    checa("FLAG_BUY/FLAG_SELL iguais aos do MetaTrader5",
          rd.FLAG_BUY == mt5.TICK_FLAG_BUY and rd.FLAG_SELL == mt5.TICK_FLAG_SELL,
          f"{rd.FLAG_BUY}/{rd.FLAG_SELL} vs {mt5.TICK_FLAG_BUY}/{mt5.TICK_FLAG_SELL}")

# ---------------------------------------------------------------------------------------------
# F. a janela horária vetorizada tem de dar a MESMA contagem da regra usada pela reprodução
# ---------------------------------------------------------------------------------------------
print("\nF. filtro de janela == fuso real, sobre a fita inteira (amostrada)")
arquivo = rd.localizar_recorte("WINZ26", "20261104")
if not arquivo:
    checa("recorte de 04/Nov encontrado em disco", False, arquivo or "")
else:
    import pandas as pd
    from zoneinfo import ZoneInfo
    try:
        import bot_mt5_ciclo15 as ponte
        janelas = (("09:00", "16:00"), (ponte.START_TIME, ponte.CLOSE_ALL_TIME))
    except ImportError as exc:
        # A fita em disco e o oráculo IANA são portáveis; o que não existe fora do Windows são as
        # constantes de sessão da ponte. Estas sim viram PULO com motivo -- nunca passe livre.
        pula("janela da sessão conferida contra as constantes da ponte",
             f"fora do Windows não há MetaTrader5 ({exc})")
        janelas = (("09:00", "16:00"),)
    # AMOSTRA ESTRATIFICADA da fita inteira (uma linha a cada 240), não o começo do arquivo: as
    # primeiras 400k linhas caem todas dentro da manhã, então uma janela 09:00-16:00 não cortava
    # nada e a checagem virava empate por acaso. Espalhando pelo pregão inteiro a borda da sessão
    # entra na amostra de verdade, com custo de parsing baixo (o .gz é lido uma vez só).
    df = pd.read_csv(arquivo, skiprows=lambda i: i and i % 240)
    ts, *_ = rd._canonizar(df)

    # oráculo INDEPENDENTE do vetorizado: a base IANA de fusos via pandas — outro mecanismo, não a
    # fórmula `(ts - offset) % 86400000` usada pelo módulo. Conferir a fórmula com ela mesma não
    # seria teste nenhum. ATENÇÃO com o fuso: `ts` JÁ vem com `+BRT_OFFSET_MSC` da `_canonizar`,
    # então ler `ts` como epoch UTC e converter para São Paulo devolve o relógio de parede do
    # pregão; subtrair o offset antes de converter aplicaria -3h duas vezes (e foi exatamente isso
    # que estourou a primeira versão desta checagem).
    parede = (pd.to_datetime(pd.Series(ts), unit="ms", utc=True)
              .dt.tz_convert(ZoneInfo("America/Sao_Paulo")))
    minutos = parede.dt.strftime("%H:%M")

    for desde, ate in janelas:
        masc = rd._filtrar_por_hora(ts, desde, ate)
        referencia = int(((minutos >= desde) & (minutos < ate)).sum())
        checa(f"vetorizado == fuso IANA ({desde}-{ate})",
              referencia == int(masc.sum()),
              f"{int(masc.sum()):,} vs {referencia:,} de {ts.size:,}")
        # sem esta, a igualdade acima pode ser trivial (janela que engole a amostra inteira).
        checa(f"a janela {desde}-{ate} realmente recorta algo da fita",
              0 < int(masc.sum()) < ts.size,
              f"{int(masc.sum()):,} de {ts.size:,} dentro da janela")
    checa("recorte de dias existe e é lido por localizar_recorte", bool(arquivo),
          os.path.basename(arquivo))

# ---------------------------------------------------------------------------------------------
# G. escada de resolução nunca estima por baixo
# ---------------------------------------------------------------------------------------------
print("\nG. resolução escolhida cabe no teto de payload")
um_dia = 8 * 3600 + 30
for dias in (1, 3, 5):
    res = rd.escolher_resolucao(um_dia * dias)
    estimado = (um_dia * dias * 1000 // res) * rd.TICKS_POR_BUCKET_ESTIMADO
    checa(f"{dias} dia(s) -> {res} ms cabe no teto", estimado <= rd.MAX_TICKS_POR_PEDIDO,
          f"estimado {estimado:,} / teto {rd.MAX_TICKS_POR_PEDIDO:,}")

# ---------------------------------------------------------------------------------------------
# H. o teto por bucket é TETO mesmo: nenhum bucket emite mais que a estimativa admite
# ---------------------------------------------------------------------------------------------
print("\nH. pior caso de emissão por bucket")
pior = []
for k in range(0, 4000, 400):
    brutos = [linha_crua(1_793_783_024_000 + k * 4 + j,
                         [100.0, 130.0, 90.0, 110.0, 105.0, 125.0, 95.0, 115.0][j % 8],
                         3 + j, [rd.FLAG_BUY, rd.FLAG_SELL][j % 2]) for j in range(8)]
    saida, _ = rd.comprimir(brutos, 400)
    pior.append(len(saida))
checa("bucket de 4 âncoras com compra E venda não passa do teto estimado",
      max(pior) <= rd.TICKS_POR_BUCKET_ESTIMADO,
      f"pior {max(pior)} emitidos / teto {rd.TICKS_POR_BUCKET_ESTIMADO} por bucket")
saida_unit, nb_unit = rd.comprimir([linha_crua(1_793_783_024_000, 100.0, 1, rd.FLAG_BUY)], 400)
checa("bucket de um tick emite um único evento",
      nb_unit == 1 and len(saida_unit) == 1, f"{len(saida_unit)} emitido(s) em {nb_unit} bucket")

# ---------------------------------------------------------------------------------------------
# I. a contínua que a TELA pede encontra o recorte do contrato em disco
# ---------------------------------------------------------------------------------------------
print("\nI. símbolo da tela -> recorte do contrato")
checa("família decifrada nos códigos usados pela tela",
      rd._familia("WIN$N") == "WIN" and rd._familia("WINZ26") == "WIN"
      and rd._familia("WDO$") == "WDO" and rd._familia("BITX26") == "BIT"
      and rd._familia("WBRA$") == "WIN", str([rd._familia(s) for s in
                                            ("WIN$N", "WINZ26", "WDO$", "BITX26", "WBRA$")]))
dias_continua = rd.dias_disponiveis("WIN$N")
checa("contínua vê os pregões gravados sob o código do mês",
      bool(dias_continua) and "20261104" in dias_continua, f"{len(dias_continua)} dia(s)")
checa("o recorte resolvido para a contínua é o mesmo do WINZ26",
      os.path.basename(rd.localizar_recorte("WIN$N", "20261104") or "")
      == os.path.basename(rd.localizar_recorte("WINZ26", "20261104") or ""),
      os.path.basename(rd.localizar_recorte("WIN$N", "20261104") or "-"))
checa("símbolo inexistente devolve lista vazia (e a ponte cai no M1 rotulado)",
      rd.dias_disponiveis("NAOEXISTE26") == [] and rd.localizar_recorte("NAOEXISTE26",
                                                                       "20261104") is None)

# ---------------------------------------------------------------------------------------------
# J. o loop compartilhado: `comprimir()` e o payload servido são o MESMO código
# ---------------------------------------------------------------------------------------------
print("\nJ. comprimir() e comprimir_canonico() são uma implementação só")
brutos = [linha_crua(1_793_783_024_000 + j * 37, 169000 + (j % 91) * 5, 1 + j % 7,
                     [rd.FLAG_BUY, rd.FLAG_SELL, rd.FLAG_BUY | rd.FLAG_SELL][j % 3])
          for j in range(20_000)]
canon = rd._canonizar(brutos)
de_um, _ = rd.comprimir(brutos, 500)
de_dois, _ = rd.comprimir_canonico(*canon, 500)
checa("mesma série pelos dois caminhos",
      [t["id"] for t in de_um] == [t["id"] for t in de_dois]
      and all(a["volume"] == b["volume"] and a["price"] == b["price"]
              for a, b in zip(de_um, de_dois)),
      f"{len(de_um):,} vs {len(de_dois):,} emitidos")

# ---------------------------------------------------------------------------------------------
# K. a resolução que chega à tela é a que foi VALIDADA por medida, não a que a estimativa permite
# ---------------------------------------------------------------------------------------------
print("\nK. decisão por contagem exata na fita real")
# `escolher_resolucao` é teto por construção (8 eventos/bucket contra 5,51 medidos em 1.000 ms),
# então decidir por ela empurraria um pregão que CABE em 1.000 ms para 2.000 ms — o replay ficaria
# mais leve e menos fiel por aritmética. `resolucao_que_cabe` conta a saída real do mesmo loop.
if not arquivo:
    checa("decisão exata sobre a fita real", False, "sem recorte em disco")
else:
    df_dia = pd.read_csv(arquivo, usecols=["time_msc", "last", "volume", "flags"])
    ts_dia, preco_dia, vol_dia, agg_dia = rd._canonizar(df_dia)
    del df_dia
    um_dia = rd.resolucao_que_cabe(ts_dia, preco_dia, vol_dia, agg_dia, dias_no_pedido=1)
    eventos_um = len(rd.comprimir_canonico(ts_dia, preco_dia, vol_dia, agg_dia, um_dia)[0])
    checa("1 pregão sai na resolução validada (1.000 ms)", um_dia == rd.BUCKET_PADRAO_MS,
          f"{um_dia} ms, {eventos_um:,} eventos, "
          f"{eventos_um * rd.BYTES_POR_EVENTO_MEDIDO / 1048576:.1f} MB de "
          f"{rd.MAX_BYTES_POR_PEDIDO / 1048576:.0f} MB de orçamento")
    checa("o evento servido cabe no orçamento de bytes", eventos_um <= rd.MAX_TICKS_POR_PEDIDO,
          f"{eventos_um:,} / {rd.MAX_TICKS_POR_PEDIDO:,}")
    tres_dias = rd.resolucao_que_cabe(ts_dia, preco_dia, vol_dia, agg_dia, dias_no_pedido=3)
    eventos_tres = len(rd.comprimir_canonico(ts_dia, preco_dia, vol_dia, agg_dia, tres_dias)[0])
    checa("3 pregões continuam dentro do orçamento com resolução ÚNICA",
          eventos_tres * 3 <= rd.MAX_TICKS_POR_PEDIDO and tres_dias > um_dia,
          f"{tres_dias} ms -> {eventos_tres * 3:,} eventos (1.000 ms estouraria: "
          f"{eventos_um * 3:,})")
    checa("a estimativa conservadora nunca é menos fiel que a decisão exata",
          rd.escolher_resolucao(int((ts_dia[-1] - ts_dia[0]) / 1000)) >= um_dia,
          f"chute {rd.escolher_resolucao(int((ts_dia[-1] - ts_dia[0]) / 1000))} ms vs "
          f"medida {um_dia} ms")

# ---------------------------------------------------------------------------------------------
# L. a faixa de validação é tri-estado e o padrão da casa está DENTRO dela
# ---------------------------------------------------------------------------------------------
print("\nL. faixa validada declarada pela tabela medida")
dentro, fid = rd.faixa_validada(rd.BUCKET_PADRAO_MS)
checa("BUCKET_PADRAO_MS está na faixa onde o replay valida estratégia", dentro is True, str(fid))
checa("4.000 ms (Δ com 80% de erro medido) é REPROVADO, não silenciado",
      rd.faixa_validada(4000)[0] is False, str(rd.faixa_validada(4000)))
checa("resolução sem medição devolve None (não afirma nem nega validação)",
      rd.faixa_validada(100)[0] is None and rd.faixa_validada(100)[1] is None)
escada = [r for r in rd.RESOLUCOES_MS if r in rd.FIDELIDADE_MEDIDA]
checa("a tabela medida é monotônica: bucket maior => menos alinhamento e menos payload",
      all(rd.FIDELIDADE_MEDIDA[a]["alinhamento"] >= rd.FIDELIDADE_MEDIDA[b]["alinhamento"]
          and rd.FIDELIDADE_MEDIDA[a]["payload_mb"] >= rd.FIDELIDADE_MEDIDA[b]["payload_mb"]
          for a, b in zip(escada, escada[1:])),
      f"escada medida: {escada}")
checa("o orçamento de bytes é maior que o payload do padrão (senão ele nunca seria servível)",
      rd.FIDELIDADE_MEDIDA[rd.BUCKET_PADRAO_MS]["payload_mb"] * 1024 * 1024
      <= rd.MAX_BYTES_POR_PEDIDO,
      f"{rd.FIDELIDADE_MEDIDA[rd.BUCKET_PADRAO_MS]['payload_mb']} MB de "
      f"{rd.MAX_BYTES_POR_PEDIDO / 1048576:.0f} MB")

if PULOS:
    print(f"\nPULOS ({len(PULOS)}) — limite de ambiente, não falha de código:")
    for p in PULOS:
        print(f"  [PULA] {p}")

print("\n" + ("TUDO VERDE" if not FALHAS else f"FALHAS: {FALHAS}"))
sys.exit(1 if FALHAS else 0)
