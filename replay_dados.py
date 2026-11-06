"""Camada de dados do REPLAY DE VALIDAÇÃO: lê a fita real de um pregão e a entrega comprimida.

Por que este módulo existe
-------------------------
O `handle_request_history` da ponte atendia pedido de histórico com barras M1 e fabricava 4 ticks
por barra (o/h/l/c), `volume = tick_volume // 4` (que é CONTAGEM de ticks, não contratos) e
agressor = direção do candle. Medido contra a fita real de 04/Nov/2026 (WINZ26, 08:55-17:30), o
replay via 1.012x menos eventos com "volume" 10,5x menor que os 21.492.107 contratos negociados.
Nesse regime delta, CVD e convergência não significam mais nada: servia para ensaiar a tela, não
para validar estratégia.

Aqui o histórico sai dos MESMOS arquivos que `reproduzir_pregao.py` lê (via
`backtest_ticks_reais.list_local_pregoes`), então a tela e a auditoria offline consomem a mesma
matéria-prima.

A compressão (o único jeito de caber num browser) preserva as duas coisas que o motor consome:

  1. CAMINHO DE PREÇO — cada bucket devolve a sequência primeiro -> extremo que aconteceu antes ->
     outro extremo -> último. O Renko decide box comparando preço com `last_close +/- box_points`,
     então o que fecha box é o caminho, não o volume.
  2. FLUXO EXATO — cada tick real pertence a exatamente um segmento e cada segmento devolve
     Σcompra e Σvenda em ticks rotulados BUY e SELL. O `delta` do box sai com contratos reais.

O que se perde é declarado, não escondido: dentro de um segmento o preço pode ter cruzado uma
fronteira de box e voltado, e essa virada não existe na série comprimida. Por isso a resolução é
paramétrica e `reproduzir_pregao.py --medir-resolucao` põe a série comprimida lado a lado com a
fita cheia, no MESMO motor. Nada aqui é "parecido com" — é comparado.

Convenção de horário idêntica à da ponte: `timestamp = time_msc_cru + BRT_OFFSET_MSC`, que é o
relógio de parede BRT (validado contra tick ao vivo: 18:30 na máquina -> stamp decodifica 18:30).
"""
import sys

import os
from datetime import datetime

import numpy as np

# O console do Windows é cp850/cp1252 e morre em UnicodeEncodeError ao imprimir travessão
# com a saída redirecionada — que é exatamente o modo como log, launcher e agente rodam isto.
# Forçar UTF-8 no stdout é o que faz o mesmo script valer nas duas máquinas sem perder acento.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

# Espelha bot_mt5_ciclo15.MT5_BRT_OFFSET_MSC. Este módulo NÃO importa a ponte de propósito: é a
# ponte que importa este (import circular derrubaria o processo vivo). test_replay_dados.py
# confere que os dois valores continuam iguais.
BRT_OFFSET_MSC = 3 * 60 * 60 * 1000

# Espelha mt5.TICK_FLAG_BUY / mt5.TICK_FLAG_SELL (valores fixos da ABI do MetaTrader5).
FLAG_BUY = 32
FLAG_SELL = 64

RAIZ = os.path.dirname(os.path.abspath(__file__))
OUTRAS_RAIZES = (r"C:\Users\Lucas\Documents\robo_renko",)

# Escada de resolução, do mais fino para o mais grosso.
RESOLUCOES_MS = (100, 250, 500, 1000, 2000, 4000, 8000)
# 1.000 ms é o cotovelo medido da escada (tabela em FIDELIDADE_MEDIDA, logo abaixo): fecha os
# MESMOS boxes e o MESMO alinhamento por nível que 500 ms, com metade do payload, e recupera mais
# sinais (130 contra 122). Descer para 500/250 ms não acrescenta um nível de grade que seja — zero
# níveis perdidos nas duas — e custa 41-70 MB de JSON no browser, o que nenhuma tela monta.
BUCKET_PADRAO_MS = 1000
# Orçamento de resposta, em BYTES, porque é o que o browser sente. Medido na mesma fita: um evento
# comprimido serializado são 138 bytes de JSON (04/Nov/2026, 167.368 eventos = 23,1 MB em 1.000 ms).
# 25 MB é o teto com o qual a tela monta o replay sem travar; o teto em eventos é derivado dele para
# não poder desencontrar dos bytes.
BYTES_POR_EVENTO_MEDIDO = 138
MAX_BYTES_POR_PEDIDO = 25 * 1024 * 1024
MAX_TICKS_POR_PEDIDO = MAX_BYTES_POR_PEDIDO // BYTES_POR_EVENTO_MEDIDO
# Teto de dias SERVINDO do disco num só pedido: 2,05M de linhas por pregão, e a leitura é o custo.
MAX_DIAS_POR_PEDIDO = 5

# Fidelidade MEDIDA no pregão 04/Nov/2026 (WINZ26, box 50 pts) contra a fita CHEIA, no MESMO motor,
# por `reproduzir_pregao.py --medir-resolucao`. `alinhamento` é a fração dos boxes da fita que a
# série comprimida refecha no MESMO nível de grade; `erro_delta` é o erro absoluto somado do Δ por
# box; `sinais` são os sinais de convergência recuperados de 136.
FIDELIDADE_MEDIDA = {
    250:  {"alinhamento": 0.979, "erro_delta": 0.281, "sinais": "124/136", "payload_mb": 70.5},
    500:  {"alinhamento": 0.977, "erro_delta": 0.304, "sinais": "122/136", "payload_mb": 41.4},
    1000: {"alinhamento": 0.977, "erro_delta": 0.319, "sinais": "130/136", "payload_mb": 23.1},
    2000: {"alinhamento": 0.964, "erro_delta": 0.447, "sinais": "133/136", "payload_mb": 12.5},
    4000: {"alinhamento": 0.947, "erro_delta": 0.802, "sinais": "118/136", "payload_mb": 6.6},
    8000: {"alinhamento": 0.928, "erro_delta": 0.971, "sinais": "104/136", "payload_mb": 3.4},
}
# A linha de corte não é gosto: é onde o Δ do box deixa de ser confiável. Em 4.000 ms o erro do Δ já
# é 80% e em 8.000 ms 97% -- o CAMINHO sobrevive (92-95% dos boxes), o limiar da estratégia não. Um
# replay fora desta faixa serve para ensaiar a tela e comparar caminhos, NÃO para calibrar threshold.
MIN_ALINHAMENTO_PARA_VALIDAR = 0.95


def faixa_validada(resolucao_ms):
    """(True | False | None, fidelidade_medida | None) para a resolução que vai ser servida.

    Existe para a procedência não precisar mentir por omissão: a tela mostra 'fita real comprimida',
    e sem este par ela diria isso igualmente para um bucket de 8.000 ms onde o Δ é decorativo.
    None (e não False) para resolução fora da tabela medida: aí o que não existe é o DADO, não a
    reprovação — afirmar 'fora da faixa' sem ter medido seria inventar para o outro lado.
    """
    fid = FIDELIDADE_MEDIDA.get(int(resolucao_ms))
    if fid is None:
        return None, None
    return fid["alinhamento"] >= MIN_ALINHAMENTO_PARA_VALIDAR, fid


# Teto REAL de eventos por bucket: âncoras <= 4 (primeiro, último, máximo, mínimo) e cada âncora
# pode devolver DOIS ticks (o Σcompra e o Σvenda do segmento), então 8 é o teto por construção.
# Medido na fita de 04/Nov/2026 (2.052.461 ticks, 30.375 s de sessão): 3,19 eventos/bucket em
# 100 ms, 4,94 em 500, 5,51 em 1.000, 5,93 em 2.000, 6,49 em 8.000 — cresce com o bucket porque o
# bucket grande é que reúne as quatro âncoras. O valor anterior (4) era cota POR BAIXO e faria
# `escolher_resolucao` estourar o teto de payload do browser.
TICKS_POR_BUCKET_ESTIMADO = 8
TAMANHO_CHUNK_LEITURA = 200_000
# Espelha bot_mt5_ciclo15.HISTORY_CHUNK_TICKS: o tamanho do HISTORY_CHUNK que a tela recebe.
TAMANHO_LOTE = 1500


def _listar_pregoes_local(symbol):
    """Varredura de disco do backtest de ticks reais (a mesma fonte do catálogo da tela)."""
    import backtest_ticks_reais
    return backtest_ticks_reais.list_local_pregoes(symbol)


# RAÍZES B3 que apontam para o mesmo ativo em códigos diferentes. Sem isto, 'WBRA$' pedir WIN e
# não achar nada em disco — a tela cairia no M1 achando que não há fita real.
_ALIASES = {"WBR": "WIN", "BTC": "BIT", "DOL": "WDO"}


def _familia(symbol):
    """As letras do ativo, sem código de vencimento nem sufixo de série ('WIN$N' e 'WINZ26' -> WIN).

    Isso é o que faz o replay da contínua achar dados: a tela pede `WIN$N`/`BIT$`, mas os recortes
    em disco são por contrato (`winz26_ticks_*.csv.gz`). Sem este mapeamento todo pedido de replay
    cairia no fallback M1 — ou seja, a melhora seria invisível justamente no caminho usado.
    """
    letras = "".join(ch for ch in str(symbol).upper() if ch.isalpha())
    raiz = letras[:3]
    return _ALIASES.get(raiz, raiz)


def _simbolos_em_disco():
    """Todo símbolo com recorte em `data/pregoes`, decodificado do nome do arquivo.

    A inversão é a regra que `list_local_pregoes` usa para escrever o prefixo: `$` vira `_cont`.
    Então `win_cont_ticks_*` é a contínua `WIN$` e `win_contn_ticks_*` é `WIN$N`.
    """
    import glob
    import re

    nomes = set()
    for base in (RAIZ,) + OUTRAS_RAIZES:
        for arquivo in glob.glob(os.path.join(base, "data", "pregoes", "*_ticks_*.csv*")):
            match = re.match(r"(.+)_ticks_\d{8}\.csv", os.path.basename(arquivo))
            if match:
                nomes.add(match.group(1).replace("_cont", "$").upper())
    return sorted(nomes)


def _pregoes_da_familia(symbol):
    """Recortes de QUALQUER contrato da família do ativo, indexados por data, mais recente primeiro.

    Data repetida (o mesmo pregão gravado sob o código do mês e sob a contínua) fica com a
    varredura do símbolo pedido, que é a mais específica.
    """
    por_dia = {}
    familia = _familia(symbol)
    for candidato in [symbol] + [s for s in _simbolos_em_disco() if _familia(s) == familia]:
        try:
            itens = _listar_pregoes_local(candidato)
        except Exception:
            continue
        for item in itens:
            dia = item["date"].replace("-", "")
            if dia not in por_dia:
                por_dia[dia] = item
    return por_dia


def dias_disponiveis(symbol):
    """Datas AAAAMMDD com recorte real em disco, mais recente primeiro."""
    try:
        return sorted(_pregoes_da_familia(symbol), reverse=True)
    except Exception:
        return []


def localizar_recorte(symbol, dia):
    """Caminho absoluto do recorte do pregão, ou None quando o dia não está em disco."""
    try:
        item = _pregoes_da_familia(symbol).get(str(dia))
    except Exception:
        return None
    if not item:
        return None
    for base in (RAIZ,) + OUTRAS_RAIZES:
        caminho = os.path.join(base, item["path"])
        if os.path.exists(caminho):
            return caminho
    return None


def agressor_da_ponte(flags):
    """A MESMA regra da ponte e da reprodução: com BUY e SELL juntos, BUY vence."""
    if flags & FLAG_BUY:
        return "BUY"
    if flags & FLAG_SELL:
        return "SELL"
    return "CROSS"


def _time_str(ts_msc):
    return datetime.fromtimestamp(ts_msc / 1000).strftime("%H:%M:%S.%f")[:-3]


def _comprimir_arrays(ts, preco, vol, agg, seq):
    """UM bucket em arrays numpy -> série comprimida (o núcleo do módulo, uma implementação só).

    `ts`/`preco`/`vol`/`agg` estão em ordem de tempo. Emite, para cada âncora de preço, o fluxo do
    segmento correspondente rotulado BUY e/ou SELL; a soma dos fluxos emitidos é IDÊNTICA à de
    entrada por construção (os segmentos formam uma partição dos índices).
    """
    n = len(preco)
    if n == 0:
        return [], seq
    i_hi = int(np.argmax(preco))
    i_lo = int(np.argmin(preco))
    anchors = sorted({0, n - 1, i_hi, i_lo})
    pos = np.arange(n)
    # segmento de cada tick = a âncora mais próxima que vem nele ou depois
    seg = np.searchsorted(np.asarray(anchors), pos, side="left")

    emitidos = []
    for s, ancora in enumerate(anchors):
        idx = np.flatnonzero(seg == s)
        if idx.size == 0:
            continue
        soma_buy = int(vol[idx][agg[idx] == "BUY"].sum())
        soma_sell = int(vol[idx][agg[idx] == "SELL"].sum())
        preco_ancora = float(preco[ancora])
        ts_fim = int(ts[idx[-1]])
        if soma_buy > 0:
            seq += 1
            emitidos.append({"id": f"mt5-r-{ts_fim}-{seq}", "timestamp": ts_fim,
                             "timeStr": _time_str(ts_fim), "price": preco_ancora,
                             "volume": soma_buy, "aggressor": "BUY"})
        if soma_sell > 0:
            seq += 1
            emitidos.append({"id": f"mt5-r-{ts_fim}-{seq}", "timestamp": ts_fim,
                             "timeStr": _time_str(ts_fim), "price": preco_ancora,
                             "volume": soma_sell, "aggressor": "SELL"})
        if soma_buy == 0 and soma_sell == 0:
            # só CROSS: sem fluxo, mas o preço continua sendo parte do caminho do Renko
            seq += 1
            emitidos.append({"id": f"mt5-r-{ts_fim}-{seq}", "timestamp": ts_fim,
                             "timeStr": _time_str(ts_fim), "price": preco_ancora,
                             "volume": 0, "aggressor": "CROSS"})
    return emitidos, seq


def comprimir_bucket(linhas, seq=0):
    """Bucket (lista de dicts já no formato canônico) -> série comprimida. Wrapper de leitura
    fácil do núcleo; usado nos testes e nas ferramentas offline."""
    if not linhas:
        return [], seq
    ts = np.array([t["timestamp"] for t in linhas], dtype=np.int64)
    preco = np.array([t["price"] for t in linhas], dtype=np.float64)
    vol = np.array([t["volume"] for t in linhas], dtype=np.int64)
    agg = np.array([t["aggressor"] for t in linhas], dtype="<U5")
    return _comprimir_arrays(ts, preco, vol, agg, seq)


def comprimir_canonico(ts, preco, vol, agg, bucket_ms=BUCKET_PADRAO_MS, seq=0):
    """Arrays canônicos (na ordem do tempo) + resolução -> (série comprimida, nº de buckets).

    É o loop que `comprimir()` e `servir_histico()` compartilham: se a medição de fidelidade e o
    payload servido à tela passassem por loops diferentes, a medição não diria nada do payload.
    `seq` atravessa o parâmetro para que ids continuem únicos quando vários pregões são servidos
    no mesmo pedido.
    """
    if ts.size == 0:
        return [], 0
    buckets = ts // bucket_ms
    inicio = np.concatenate(([0], np.flatnonzero(np.diff(buckets)) + 1))
    fim = np.concatenate((inicio[1:], [ts.size]))
    saida = []
    for ini, f in zip(inicio, fim):
        emit, seq = _comprimir_arrays(ts[ini:f], preco[ini:f], vol[ini:f], agg[ini:f], seq)
        saida.extend(emit)
    return saida, int(inicio.size)


def comprimir(bruto, bucket_ms=BUCKET_PADRAO_MS):
    """Série comprimida a partir das linhas cruas do arquivo (colunas time_msc/last/volume/flags).

    Devolve (ticks_emitidos, nº de buckets). É o que `reproduzir_pregao.py --medir-resolucao` usa.
    """
    return comprimir_canonico(*_canonizar(bruto), bucket_ms=bucket_ms)


def _canonizar(bruto):
    """Linhas cruas -> arrays canônicos, descartando não-negócio (last <= 0) como a ponte faz.

    Aceita list[dict] (pandas to_dict) ou um DataFrame; sempre na ordem do arquivo, que é a ordem
    em que o MT5 publicou.
    """
    import pandas as pd

    df = bruto if isinstance(bruto, pd.DataFrame) else pd.DataFrame(bruto)
    if df.empty:
        empty = np.array([], dtype=np.int64)
        return empty, np.array([], dtype=np.float64), empty, np.array([], dtype="<U5")
    last = df["last"].to_numpy(dtype=np.float64)
    valido = last > 0
    ts = (df["time_msc"].to_numpy(dtype=np.int64)[valido] + BRT_OFFSET_MSC)
    preco = last[valido]
    vol = df["volume"].to_numpy(dtype=np.float64)[valido].astype(np.int64)
    flags = df["flags"].to_numpy(dtype=np.int64)[valido]
    agg = np.where(flags & FLAG_BUY, "BUY", np.where(flags & FLAG_SELL, "SELL", "CROSS")).astype("<U5")
    return ts, preco, vol, agg


def _segundos_do_dia(hora):
    """"HH:MM" ou "HH:MM:SS" -> segundos daquele dia, no relógio que a ponte usa."""
    partes = [int(p) for p in str(hora).split(":")]
    while len(partes) < 3:
        partes.append(0)
    return partes[0] * 3600 + partes[1] * 60 + partes[2]


def _filtrar_por_hora(ts, desde, ate):
    """Máscara da janela horária, vetorizada.

    O relógio de parede BRT é `raw lido como UTC-naive` (validado ao vivo: 18:30 na máquina ->
    stamp decodifica 18:30), e aqui `ts = raw + BRT_OFFSET_MSC`. Então o segundo-dentro-do-dia do
    relógio de parede é `(ts - BRT_OFFSET_MSC) % 86400000`, que por ser módulo ignora a data e não
    chama datetime um a um sobre 2 milhões de ticks.
    """
    if ts.size == 0 or (not desde and not ate):
        return np.ones(ts.size, dtype=bool)
    sec_dia = ((ts - BRT_OFFSET_MSC) % 86_400_000) // 1000
    mascara = np.ones(ts.size, dtype=bool)
    if desde:
        mascara &= sec_dia >= _segundos_do_dia(desde)
    if ate:
        mascara &= sec_dia < _segundos_do_dia(ate)
    return mascara


def escolher_resolucao(segundos_de_pregao, teto=MAX_TICKS_POR_PEDIDO, minimo=BUCKET_PADRAO_MS):
    """Menor resolução cuja saída MAIS GROSSA estimada cabe no teto, começando de `minimo`.

    A estimativa é o teto por bucket (`TICKS_POR_BUCKET_ESTIMADO`, no pior caso da construção: 4
    âncoras × 2 fluxos) vezes o número de buckets do período, então nunca subestima: se couber na
    estimativa, cabe na realidade.

    Ela é conservadora POR DESENHO — medida na fita de 04/Nov: 5,51 eventos/bucket reais em 1.000 ms
    contra os 8 do teto — e usá-la como DECISÃO final jogaria um pregão que cabe em 1.000 ms para
    2.000 ms, perdendo fidelidade por aritmética de estimativa. Serve para chutar quando os ticks
    ainda não foram lidos; `resolucao_que_cabe` decide por contagem exata quando eles estão na mão.
    """
    for resolucao in RESOLUCOES_MS:
        if resolucao < minimo:
            continue
        if (segundos_de_pregao * 1000 // resolucao) * TICKS_POR_BUCKET_ESTIMADO <= teto:
            return resolucao
    return RESOLUCOES_MS[-1]


def resolucao_que_cabe(ts, preco, vol, agg, dias_no_pedido=1, teto=MAX_TICKS_POR_PEDIDO,
                       minimo=BUCKET_PADRAO_MS):
    """Menor resolução cujo número EXATO de eventos cabe no orçamento, medida neste pregão.

    Comprime o dia candidato, conta, só então decide — e vale para TODOS os dias do pedido, porque
    um estudo multi-pregão com resoluções diferentes por dia não é comparável: a fidelidade teria de
    ser a mesma linha de base nos dois dias. A contagem é a mesma função que monta o payload, então
    não há estimativa entre o que se decide e o que se serve.

    O custo é uma compressão por candidato (numpy sobre a fita JÁ lida; o CSV é lido uma vez só), e
    por isso a função devolve apenas a resolução: quem serve reaproveitaria o emit do último
    candidato, mas o ganho (~2 s num pregão) não paga o código de reentrância que aquilo exige.
    """
    ultima = RESOLUCOES_MS[-1]
    for resolucao in RESOLUCOES_MS:
        if resolucao < minimo:
            continue
        emit, _nb = comprimir_canonico(ts, preco, vol, agg, resolucao)
        ultima = resolucao
        if len(emit) * max(1, dias_no_pedido) <= teto:
            return resolucao
    return ultima


def servir_histico(symbol, days, bucket_ms=None, desde=None, ate=None,
                   teto=MAX_TICKS_POR_PEDIDO):
    """Monta o payload do REQUEST_HISTORY a partir dos recortes REAIS em disco.

    Devolve dict com `lotes` (listas de ticks no formato do HISTORY_CHUNK), `resolucaoMs`, os dias
    servidos e as somas de conferência — ou None quando nada está em disco, caso em que a ponte cai
    no caminho M1 e rotula M1_RATE, sem fingir tick real.

    A `bucket_ms` PEDIDO é piso, não ordem: a resolução é conferida contra o orçamento de bytes e a
    escada sobe se ela não couber — um `bucket_ms=100` num pregão inteiro são 930.486 eventos e
    ~122 MB de JSON, que nenhum browser monta. A troca sai declarada (`resolucaoPedidaMs`) para a
    tela poder dizer que recebeu outra coisa, em vez de servir 1.000 ms fingindo 100.

    Chamar dentro de `asyncio.to_thread`: custa segundos e não pode encostar no laço de ticks.
    """
    import pandas as pd

    disponiveis = dias_disponiveis(symbol)
    if not disponiveis:
        return None
    alvo = disponiveis[:max(1, min(int(days or 1), MAX_DIAS_POR_PEDIDO))]

    piso = int(bucket_ms) if bucket_ms else BUCKET_PADRAO_MS
    pedida = int(bucket_ms) if bucket_ms else None
    resolucao = None
    planos, servidos, arquivos = [], [], []
    stats = {"ticks_reais": 0, "ticks_emitidos": 0, "buckets": 0, "sem_negocio": 0,
             "contratos_buy": 0, "contratos_sell": 0}
    seq = 0

    for dia in alvo:
        caminho = localizar_recorte(symbol, dia)
        if not caminho:
            continue
        leitura = pd.read_csv(caminho, usecols=["time_msc", "last", "volume", "flags"])
        ts, preco, vol, agg = _canonizar(leitura)
        stats["sem_negocio"] += int(len(leitura)) - int(ts.size)
        if ts.size:
            ts, preco, vol, agg = (a[_filtrar_por_hora(ts, desde, ate)] for a in (ts, preco, vol, agg))
        if ts.size == 0:
            servidos.append(dia)
            continue
        stats["ticks_reais"] += int(ts.size)
        stats["contratos_buy"] += int(vol[agg == "BUY"].sum())
        stats["contratos_sell"] += int(vol[agg == "SELL"].sum())

        if resolucao is None:
            # Primeiro dia servido DECIDE por contagem exata e a resolução fica pinada para o resto
            # do pedido: um estudo com resolução diferente por dia não é comparável.
            resolucao_escolhida = resolucao_que_cabe(ts, preco, vol, agg,
                                                    dias_no_pedido=len(alvo), teto=teto,
                                                    minimo=piso)
        else:
            resolucao_escolhida = resolucao

        emit, nb = comprimir_canonico(ts, preco, vol, agg, resolucao_escolhida, seq)
        seq += nb * TICKS_POR_BUCKET_ESTIMADO
        stats["buckets"] += nb
        stats["ticks_emitidos"] += len(emit)
        planos.extend(emit)
        servidos.append(dia)
        arquivos.append(os.path.basename(caminho))
        resolucao = resolucao_escolhida
        if stats["ticks_emitidos"] > teto:
            break

    if not servidos or not planos:
        return None
    dentro, fid = faixa_validada(resolucao)
    return {
        "symbol": symbol.upper(),
        "lotes": [planos[i:i + TAMANHO_LOTE] for i in range(0, len(planos), TAMANHO_LOTE)],
        "dias": servidos,
        # que arquivo serviu cada dia: o operador precisa ver que a contínua da tela foi atendida
        # pelo recorte do contrato vigente daquele dia, e não por uma série descosturada
        "arquivos": arquivos,
        "resolucaoMs": resolucao,
        # só existe quando o cliente pediu uma resolução e o orçamento não deixou: a tela precisa
        # poder dizer "você pediu 100 ms, o pregão inteiro coube em 1.000 ms" em vez de calar
        "resolucaoPedidaMs": pedida if pedida != resolucao else None,
        # a resolução sozinha não diz se o replay julga limiar: quem diz é a fidelidade medida, e a
        # tela precisa poder distinguir "fita real que valida estratégia" de "fita real que só
        # mostra o caminho" sem ter de decorar a tabela.
        "validaEstrategia": dentro,
        "fidelidade": fid,
        **stats,
    }
