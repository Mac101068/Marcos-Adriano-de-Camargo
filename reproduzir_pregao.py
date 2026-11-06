"""Reprodução offline de um pregão: os MESMOS ticks históricos pelo MESMO motor da ponte.

Por que este script existe: `backtest_ticks_reais.py` reimplementa Renko, agressor e volume por
conta própria. Qualquer diferença de conversão (arredondamento de preço, volume padrão quando o
tick vem zerado, flag de agressor, warm-up do medidor de regime) faz o backtest medir uma
estratégia DISTINTA da que a ponte opera — e o resultado vira fantasia. Aqui nada é
reimplementado: importamos `RenkoFlowEngine` (via `get_or_create_engine`), `_tick_price`,
`_field`, `MT5_BRT_OFFSET_MSC` e as constantes de horário de `bot_mt5_ciclo15.py`, na mesma
ordem do loop vivo.

O que ele produz: `data/auditoria/eventos_<ATIVO>_<DIA>.csv` com `fonte="REPRO"`, no MESMO
schema do diário vivo — linha por box fechado, sinal e corte com o motivo. É a base da
comparação com o que a corretora fez de verdade (deals) e do estudo de 48 pregões.

Segurança: este caminho NUNCA toca em ordem. Só chamamos `eng.process_tick()`; o
`MT5OrderManager` da ponte não é instanciado nem alcançado.

Uso:
    .\\venv\\Scripts\\python.exe reproduzir_pregao.py --dia 20261104
    .\\venv\\Scripts\\python.exe reproduzir_pregao.py --dia 20261104 --ativo WINZ26 ^
        --config "{\\"symbol\\":\\"WINZ26\\",\\"minDeltaThreshold\\":50,\\"consolidationFilterEnabled\\":false}"
    .\\venv\\Scripts\\python.exe reproduzir_pregao.py --todos --max-dias 5

    # auditoria da INGESTÃO (o que a fita que chega ao motor do processo vivo):
    .\\venv\\Scripts\\python.exe reproduzir_pregao.py --dia 20261104 --simular-ingestao vivo
    .\\venv\\Scripts\\python.exe reproduzir_pregao.py --dia 20261104 --simular-ingestao corrigido

    # escada de FIDELIDADE da compressão (mede no motor real quanto da fita cheia sobrevive em
    # cada resolução; é ela que decide o BUCKET_PADRAO_MS do replay servido pela ponte):
    .\\venv\\Scripts\\python.exe reproduzir_pregao.py --dia 20261104 --medir-resolucao
    .\\venv\\Scripts\\python.exe reproduzir_pregao.py --dia 20261104 --medir-resolucao ^
        --resolucoes "500,1000,2000" --max-payload-mb 25
"""

import argparse
import csv
import gzip
import json
import os
import sys
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bot_mt5_ciclo15 as ponte
import backtest_ticks_reais as base_ticks
import replay_dados as rd
from auditoria_diario import PASTA_AUDITORIA, caminho_arquivo, carregar_eventos

RAIZ = os.path.dirname(os.path.abspath(__file__))
FONTE = "REPRO"
# Fonte do diário para a reprodução da fita MUTILADA (a que o loop vivo entregava ao motor
# antes da correção). Separada da REPRO de propósito: são fitas diferentes e o comparador
# precisa poder colocar as duas lado a lado sem estragar a referência boa.
FONTE_MUTILADA = "MUTILADO"

# Teto de JSON por resposta de replay que dá para montar num browser sem a tela travar. Medido na
# fita de 04/Nov/2026: 138 bytes por evento comprimido, então 1.000 ms num pregão = 167.368 eventos
# = ~23 MB (aprovado); 250 ms = 510.706 eventos = ~70 MB (reprovado por tamanho, não por fidelidade).
PAYLOAD_MAX_MB_PADRAO = 25.0


def _hora_brt(raw_msc):
    """Relógio que a ponte usa para um tick cru — o MESMO carimbo do diário e da tela."""
    return datetime.fromtimestamp((raw_msc + ponte.MT5_BRT_OFFSET_MSC) / 1000)


def _na_janela_do_robo(raw_msc):
    """Regra da janela do robô, idêntica à do `_repassar` (08:55 inclusive até 17:30 exclusive)."""
    return ponte.START_TIME <= _hora_brt(raw_msc).strftime("%H:%M") < ponte.CLOSE_ALL_TIME


def localizar_arquivo(ativo, dia):
    """Resolve o recorte do pregão em disco usando a MESMA varredura da ponte."""
    for item in base_ticks.list_local_pregoes(ativo):
        if item["date"].replace("-", "") == str(dia):
            caminho = os.path.join(RAIZ, item["path"])
            if os.path.exists(caminho):
                return caminho
            for raiz_base in (r"C:\Users\Lucas\Documents\robo_renko",):
                alt = os.path.join(raiz_base, item["path"])
                if os.path.exists(alt):
                    return alt
    return None


def reproduzir(ativo, dia, config=None, janela_horaria=True, mostrar=False, a_partir=None, ate=None,
               ancocar=None, feed="cheio"):
    """Repassa os ticks gravados do pregão pelo motor da ponte (fonte REPRO no diário).

    `feed="mutilado"` repassa só os ticks que o loop vivo ENTREGARIA ao motor com o algoritmo
    antigo de ingestão — é como se mede o que a tela mostrava, e o que cada limiar fixo vale agora.
    """
    if feed == "mutilado":
        return _repassar(ativo, dia, feed_mutilado(ativo, dia), config, janela_horaria, mostrar,
                         origem=f"fita mutilada (ingestão antiga: cap 100 + dedup por ms)",
                         fonte=FONTE_MUTILADA, a_partir=a_partir, ate=ate, ancocar=ancocar)
    arquivo = localizar_arquivo(ativo, dia)
    if not arquivo:
        raise FileNotFoundError(f"sem recorte de ticks de {ativo} no dia {dia} em data/pregoes/")
    abrir = gzip.open if arquivo.endswith(".gz") else open
    with abrir(arquivo, "rt", encoding="utf-8", newline="") as f:
        return _repassar(ativo, dia, csv.DictReader(f), config, janela_horaria, mostrar,
                         origem=os.path.basename(arquivo), a_partir=a_partir, ate=ate, ancocar=ancocar)


def reproduzir_mt5(ativo, dia, config=None, janela_horaria=True, mostrar=False, a_partir=None, ate=None,
                   ancocar=None):
    """Reproduz o pregão DE HOJE direto do MT5, sem tocar em disco.

    É o que fecha o ciclo da auditoria: o diário VIVO da ponte e a reprodução entram pelos
    mesmos ticks, no mesmo motor, e o comparador confere se os dois veem o mesmo box. Nada é
    gravado em data/ (o extrator tradicional sobrescreve a base acumulada do ativo).
    """
    if not ponte.mt5.initialize(path=ponte.MT5_PATH):
        raise RuntimeError(f"MT5 indisponível: {ponte.mt5.last_error()}")
    try:
        ponte.mt5.symbol_select(ativo, True)
        inicio = datetime.strptime(dia, "%Y%m%d")
        bruto = ponte.mt5.copy_ticks_range(ativo, inicio, inicio.replace(hour=23, minute=59, second=59),
                                           ponte.mt5.COPY_TICKS_ALL)
        # copy_ticks_range devolve ndarray estruturado: `bruto or []` levanta ValueError
        lista = [] if bruto is None else list(bruto)
        if not lista:
            raise RuntimeError(f"MT5 não devolveu ticks de {ativo} em {dia}: {ponte.mt5.last_error()}")
    finally:
        ponte.mt5.shutdown()
    return _repassar(ativo, dia, lista, config, janela_horaria, mostrar,
                     origem=f"MT5 copy_ticks_range ({len(lista):,} ticks)", filtrar_dia=True,
                     a_partir=a_partir, ate=ate, ancocar=ancocar)


def _repassar(ativo, dia, linhas, config=None, janela_horaria=True, mostrar=False,
              origem="", filtrar_dia=False, a_partir=None, ate=None, ancocar=None, fonte=FONTE,
              diario=True, coletar=False):
    """Núcleo da reprodução: a MESMA conversão de tick do loop vivo, box a box.

    `a_partir`/`ate` (HH:MM:SS) ancoram a reprodução no MESMA instante do processo vivo. Sem
    isso o teste de fidelidade é falso: o grid Renko é construído a partir do preço do primeiro
    tick, então uma ponte que subiu às 17:04 e uma reprodução que começa às 08:55 fecham boxes
    em níveis diferentes e nenhum box bate com o outro — mesmo com o motor idêntico.

    Retorna estatísticas — é o que o comparador (auditar_pregao.py) consome.
    """
    # Ordem importa: o engine precisa EXISTIR antes de apply_ea_config, que só calibra o
    # min_delta do ativo que já está registrado em ENGINES.
    eng = ponte.get_or_create_engine(ativo)
    spec = ponte.get_asset_spec(ativo)
    if config:
        ponte.apply_ea_config({**config, "symbol": ativo})

    # O recorte do dia traz cotações da virada da noite (bid/ask sem negócio). A ponte ao vivo
    # só existe dentro do pregão, então a reprodução usa a MESMA janela do robô para que os
    # índices de box e o warm-up do medidor de regime signifiquem a mesma coisa nos dois lados.
    inicio_janela, fim_janela = ponte.START_TIME, ponte.CLOSE_ALL_TIME

    ticks_ler = ticks_usados = ticks_fora = 0
    agressores = {"BUY": 0, "SELL": 0, "CROSS": 0}
    boxes = sinais = 0
    contratos_buy = contratos_sell = 0
    motivos = {}
    trajetoria = []
    primeiro_ts = ultimo_ts = 0
    preco_ancora = float(ancocar) if ancocar is not None else None

    for row in linhas:
        ticks_ler += 1
        raw_msc = int(ponte._field(row, "time_msc", 0) or 0)
        ts_msc = raw_msc + ponte.MT5_BRT_OFFSET_MSC
        dt_ts = datetime.fromtimestamp(ts_msc / 1000)
        if filtrar_dia and dt_ts.strftime("%Y%m%d") != str(dia):
            ticks_fora += 1
            continue
        hmss = dt_ts.strftime("%H:%M:%S")
        if a_partir and hmss < a_partir:
            ticks_fora += 1
            continue
        if ate and hmss > ate:
            ticks_fora += 1
            continue
        if janela_horaria and not _na_janela_do_robo(raw_msc):
            ticks_fora += 1
            continue

        price = ponte._tick_price(row)
        if price <= 0:
            continue
        volume = int(ponte._field(row, "volume", 0) or ponte._field(row, "volume_real", 0) or 1)
        flags = int(ponte._field(row, "flags", 0) or 0)
        if flags & ponte.mt5.TICK_FLAG_BUY:
            aggressor = "BUY"
        elif flags & ponte.mt5.TICK_FLAG_SELL:
            aggressor = "SELL"
        else:
            aggressor = "CROSS"

        agressores[aggressor] += 1
        ticks_usados += 1

        if preco_ancora is not None and eng.current_box is None:
            # Mesma grade do processo vivo: sem isto o grid Renko sai do preço do primeiro tick
            # da janela e nenhum box bate com o do diário VIVO, por mais idêntico que o motor seja.
            eng.init_engine(preco_ancora, ts_msc)
            preco_ancora = None

        new_box, signal, reason = eng.process_tick(price, volume, aggressor, ts_msc)
        if not new_box:
            continue

        boxes += 1
        contratos_buy += int(new_box["buy_volume"])
        contratos_sell += int(new_box["sell_volume"])
        primeiro_ts = primeiro_ts or new_box["timestamp"]
        ultimo_ts = new_box["timestamp"]
        if diario and fonte:
            ponte.audit_registrar_box(new_box, new_box.get("audit"), fonte, ativo)
        if coletar:
            # é o que o estudo de resolução alinha box a box contra a fita cheia
            trajetoria.append((int(new_box["timestamp"]), float(new_box["close"]),
                              float(new_box["delta"]), (new_box.get("audit") or {}).get("sinal") or ""))
        codigo = (new_box.get("audit") or {}).get("motivo", "").split("|")[0].strip() or "SEM_CODIGO"
        motivos[codigo] = motivos.get(codigo, 0) + 1
        if signal:
            sinais += 1
            if mostrar:
                print(f"   ⚡ #{new_box['index']} {new_box['direction']} @ {new_box['close']:.1f} "
                      f"Δ {new_box['delta']} — {reason}")

    return {
        "ativo": ativo,
        "dia": str(dia),
        "arquivo": origem,
        "fonte": fonte,
        "box_points": spec["box_points"],
        "min_delta_engine": eng.min_delta_threshold,
        "janela": None if not janela_horaria else f"{inicio_janela}-{fim_janela}",
        "ticks_lidos": ticks_ler,
        "ticks_usados": ticks_usados,
        "ticks_fora_janela": ticks_fora,
        "agressores": agressores,
        "boxes": boxes,
        "sinais": sinais,
        "calados": boxes - sinais,
        "motivos": motivos,
        "contratos_fechados": {"compra": contratos_buy, "venda": contratos_sell},
        "trajetoria": trajetoria,
        "primeiro_box": datetime.fromtimestamp(primeiro_ts / 1000).strftime("%H:%M:%S") if primeiro_ts else "",
        "ultimo_box": datetime.fromtimestamp(ultimo_ts / 1000).strftime("%H:%M:%S") if ultimo_ts else "",
    }


def dias_disponiveis(ativo):
    return sorted(i["date"].replace("-", "") for i in base_ticks.list_local_pregoes(ativo))


def _fita_do_pregao(ativo, dia):
    """Carimbos (`time_msc`) do pregão dentro da janela do robô, NA ORDEM do arquivo.

    A ordem importa porque o resultado é usado como índice para recortar a fita depois; o
    MT5 publica o `copy_ticks_range` ordenado, mas se um recorte qualquer vier fora disso a
    simulação deixaria de ser a do que o terminal veria — aí é melhor gritar do que medir torto.
    """
    arquivo = localizar_arquivo(ativo, dia)
    if not arquivo:
        raise FileNotFoundError(f"sem recorte de ticks de {ativo} no dia {dia}")
    abrir = gzip.open if arquivo.endswith(".gz") else open
    mscs = []
    with abrir(arquivo, "rt", encoding="utf-8", newline="") as f:
        for row in csv.DictReader(f):
            m = int(ponte._field(row, "time_msc", 0) or 0)
            if m > 0 and _na_janela_do_robo(m):
                mscs.append(m)
    if not mscs:
        raise RuntimeError(f"fita vazia de {ativo} em {dia}")
    if any(a > b for a, b in zip(mscs, mscs[1:])):
        raise RuntimeError(f"a fita de {ativo} {dia} não está ordenada por time_msc")
    return mscs, arquivo


def _simular(mscs, modo="vivo", cap=0, janela=3, passo_ms=10):
    """Núcleo da simulação: índices de `mscs` que chegariam ao motor, e as perdas por motivo."""
    total = len(mscs)
    cap_simulado = cap or (100 if modo == "vivo" else 2000)
    j = q = 0
    ultimo_msc = -1
    ultimo_oc = 0
    processados = perdas_cap = perdas_dedup = 0
    sobreviventes = []
    t_poll = mscs[0]
    publicados = 0

    while t_poll <= mscs[-1]:
        while publicados < total and mscs[publicados] <= t_poll:
            publicados += 1
        if publicados == 0:
            t_poll += passo_ms
            continue
        if modo == "vivo":
            inicio_janela = mscs[publicados - 1] // 1000 - janela
        else:
            inicio_janela = max(ultimo_msc, 0) // 1000
        while j < total and mscs[j] // 1000 < inicio_janela:
            if j >= q and mscs[j] > ultimo_msc:
                perdas_cap += 1
            j += 1
        q = max(q, j)

        oc = 0
        anterior = -1
        limite = min(j + cap_simulado, total)
        while q < limite:
            m = mscs[q]
            if m != anterior:
                oc, anterior = 0, m
            else:
                oc += 1
            if modo == "vivo":
                if m <= ultimo_msc:
                    perdas_dedup += 1
                    q += 1
                    continue
            else:
                if m < ultimo_msc or (m == ultimo_msc and oc <= ultimo_oc):
                    perdas_dedup += 1
                    q += 1
                    continue
            ultimo_msc, ultimo_oc, processados = m, oc, processados + 1
            sobreviventes.append(q)
            q += 1

        t_poll = max(t_poll + passo_ms, min(mscs[publicados] if publicados < total else mscs[-1] + 1,
                                            (inicio_janela + 1) * 1000))

    por_seg = {}
    for m in mscs:
        por_seg[m // 1000] = por_seg.get(m // 1000, 0) + 1
    stats = {"total": total, "processados": processados, "perda_pct": (total - processados) / total * 100,
             "perdas_cap": perdas_cap, "perdas_dedup": perdas_dedup, "cap": cap_simulado,
             "pico": max(por_seg.values()), "seg": len(por_seg),
             "media_por_seg": total / len(por_seg),
             "seg_acima_do_cap": sum(1 for n in por_seg.values() if n > cap_simulado)}
    return sobreviventes, stats


def simular_ingestao(ativo, dia, modo="vivo", cap=0, janela=3, passo_ms=10):
    """Simula a INGESTÃO do loop vivo sobre a fita real e conta o que chega ao motor.

    Não é reprodução de box — é a medição da fita que alimenta o motor. O loop vivo fazia, a cada
    10 ms:

        ticks = copy_ticks_from(s, server_time_sec - 3, 100, COPY_TICKS_ALL)
        if raw_msc <= LAST_TICK_TIMES[s]: continue

    Duas perdas aí dentro. (1) A ancora é o SEGUNDO do último tick e a fita do WIN tem pico de
    mais de 1.000 ticks por segundo, então o cap de 100 corta a cauda da janela e aquela cauda
    some quando a janela desliza. (2) O dedup é por `<=` no `time_msc`, então vários ticks do
    MESMO milissegundo (bid/ask/last mudando dentro da mesma ms) só entram uma vez — e o MT5
    emite muitos assim. O resultado é que o Delta do box é calculado sobre uma FRAÇÃO da fita,
    e a tela desenha o box dessa fita incompleta.

    `modo="vivo"` reproduz exatamente isso (e é o que o estudo de limiares chama de fita
    mutilada). `modo="corrigido"` é o código que está no ar agora: ancora no segundo do último
    tick PROCESSADO e dedupa por (time_msc, ocorrência dentro do ms), que é estável enquanto a
    consulta começa no início de um segundo — todos os irmãos daquele ms vêm no mesmo lote.
    """
    mscs, _ = _fita_do_pregao(ativo, dia)
    sobreviventes, st = _simular(mscs, modo=modo, cap=cap, janela=janela, passo_ms=passo_ms)
    ancora = (f"janela de {janela}s atrás do último tick" if modo == "vivo"
              else "último tick processado")
    print(f"\n⏱  ingestão simulada ({modo.upper()}) — {ativo} {dia}: cap {st['cap']}/consulta, "
          f"consulta ancorada em {ancora}")
    print(f"   ticks da fita na janela do robô: {st['total']:,}")
    print(f"   chegariam ao motor: {st['processados']:,}  |  PERDA: "
          f"{st['total'] - st['processados']:,} ({st['perda_pct']:.1f}%)")
    print(f"     • nunca devolvidos pela consulta: {st['perdas_cap']:,} "
          f"({st['perdas_cap'] / st['total'] * 100:.1f}%)")
    print(f"     • descartados pelo dedup: {st['perdas_dedup']:,} "
          f"({st['perdas_dedup'] / st['total'] * 100:.1f}%)")
    print(f"   densidade: {st['media_por_seg']:.0f} ticks/s em média | pico de "
          f"{st['pico']:,} em 1 s | segundos acima do cap: {st['seg_acima_do_cap']:,} de {st['seg']:,}")
    return st


def feed_mutilado(ativo, dia, cap=100, janela=3, passo_ms=10):
    """Gera SÓ os ticks que o loop vivo entregaria ao motor com a ingestão ANTIGA.

    É a alavanca do estudo de limiares: a reprodução sempre repassou a fita inteira, então sem
    isto não existia como saber o que a tela mostrava nem quanto cada limiar fixo valeu por
    engano. Duas passadas no arquivo: a primeira resolve a fita (só carimbos), a segunda devolve
    as linhas vivas — 2 milhões de dicts de uma vez não caberiam na memória com o motor junto.
    """
    mscs, arquivo = _fita_do_pregao(ativo, dia)
    sobreviventes, st = _simular(mscs, modo="vivo", cap=cap, janela=janela, passo_ms=passo_ms)
    quero = set(sobreviventes)
    abrir = gzip.open if arquivo.endswith(".gz") else open
    print(f"🩸 fita mutilada de {ativo} {dia}: {len(sobreviventes):,} de {st['total']:,} ticks "
          f"entram no motor ({st['perda_pct']:.1f}% da fita perdida pela ingestão antiga)")
    i = -1
    with abrir(arquivo, "rt", encoding="utf-8", newline="") as f:
        for row in csv.DictReader(f):
            m = int(ponte._field(row, "time_msc", 0) or 0)
            if m <= 0 or not _na_janela_do_robo(m):
                continue
            i += 1
            if i in quero:
                yield row


def _df_bruto(ativo, dia):
    """Lê UMA vez o recorte oficial nas colunas que o motor consome.

    A medição faz N passadas pelo motor (uma por resolução). Reler o .gz a cada passada custaria
    o mesmo tanto de I/O de CPU de leitura, e `df.to_dict("records")` de 2,1M linhas não cabe na
    memória com a ponte importada — por isso o DataFrame fica e as linhas saem sob demanda.
    """
    import pandas as pd

    arquivo = localizar_arquivo(ativo, dia)
    if not arquivo:
        raise FileNotFoundError(f"sem recorte de ticks de {ativo} no dia {dia} em data/pregoes/")
    return pd.read_csv(arquivo, usecols=["time_msc", "last", "volume", "flags"]), arquivo


def _linhas_cruas(df):
    """DataFrame -> um dict por linha no formato do CSV, sem materializar os 2M de dicts."""
    for linha in df.itertuples(index=False, name=None):
        yield {"time_msc": linha[0], "last": linha[1], "volume": linha[2], "flags": linha[3]}


def _linhas_de_serie(ticks):
    """Série comprimida do `replay_dados` -> linhas no formato cru.

    É o que torna a medição uma medição: em vez de chamar `process_tick` por conta própria (que
    é exatamente o erro que `backtest_ticks_reais.py` comete), devolvemos a série comprimida no
    shape do arquivo e ela atravessa o MESMO `_repassar`, com a MESMA conversão de preço, de
    volume e de agressor da ponte.
    """
    for t in ticks:
        flags = rd.FLAG_BUY if t["aggressor"] == "BUY" else (rd.FLAG_SELL if t["aggressor"] == "SELL" else 0)
        yield {"time_msc": int(t["timestamp"]) - ponte.MT5_BRT_OFFSET_MSC, "last": t["price"],
               "volume": t["volume"], "flags": flags}


def _motor_limpo(ativo):
    """Descarta o engine cacheado: cada passada tem de partir do tick zero.

    Sem isto a segunda resolução herdaria boxes, CVD e medidor de regime da primeira, e a
    comparação não seria entre resoluções — seria entre 'fita cheia' e 'fita cheia de novo'.
    """
    ponte.ENGINES.pop(ativo, None)


def _por_nivel(traj, box_points, ancora):
    """Trajetória -> agregado por NÍVEL de grade Renko (k tal que close = ancora + k*box_points).

    Alinhar por índice de box é ingênuo: se um bucket engolir uma virada, a série comprimida passa
    a ter um box a menos e TODOS os índices seguintes desencontram, ainda que a caminhada seja a
    mesma. Como cada box fecha exatamente um degrau a partir do preço de abertura do grid, o nível
    é o endereço absoluto do box nas duas séries.
    """
    niveis = {}
    for _ts, close, delta, sinal in traj:
        k = int(round((close - ancora) / box_points))
        reg = niveis.setdefault(k, [0, 0, 0, 0])
        reg[0] += 1
        reg[1] += int(delta)
        if sinal == "BUY":
            reg[2] += 1
        elif sinal == "SELL":
            reg[3] += 1
    return niveis


def _comparar(ref, comp, box_points, ancora):
    """Quanto da história da fita cheia sobrevive à compressão. Nenhuma dessas números é opinião."""
    import numpy as np

    n_ref = _por_nivel(ref, box_points, ancora)
    n_comp = _por_nivel(comp, box_points, ancora)
    total_ref = sum(v[0] for v in n_ref.values())
    total_comp = sum(v[0] for v in n_comp.values())
    comuns = sorted(set(n_ref) & set(n_comp))
    # Nível que só existe numa das séries é PERDA, não exceção: um spike de um box que caiu
    # inteiro dentro de um bucket é engolido pela compressão e nunca fecha aquele nível. Contar
    # como zero é a única leitura honesta (e indexar direto dava KeyError no primeiro bucket fino).
    alinhado = sum(min(n_ref[k][0], n_comp.get(k, (0, 0))[0]) for k in n_ref) / max(1, total_ref)
    sig_ref = sum(v[2] + v[3] for v in n_ref.values())
    sig_comp = sum(v[2] + v[3] for v in n_comp.values())
    # Δ líquido por nível: se a compressão embaralha agressores, é aqui que aparece
    a = np.array([n_ref[k][1] for k in comuns], dtype=np.float64)
    b = np.array([n_comp[k][1] for k in comuns], dtype=np.float64)
    erro_delta = float(np.abs(a - b).sum() / np.abs(a).sum()) if np.abs(a).sum() else 0.0
    corr = float(np.corrcoef(a, b)[0, 1]) if len(a) > 2 and a.std() and b.std() else 1.0
    mesma_mao = float((np.sign(a) == np.sign(b)).mean()) if len(a) else 0.0

    def passos(traj):
        ks = [int(round((c - ancora) / box_points)) for _t, c, _d, _s in traj]
        return int(sum(abs(y - x) for x, y in zip(ks, ks[1:])))

    return {
        "boxes_ref": total_ref,
        "boxes_comp": total_comp,
        "alinhamento": alinhado,
        # níveis pisados por uma série e nunca pela outra: é aqui que um spike engolido aparece
        "so_ref": len(set(n_ref) - set(n_comp)),
        "so_comp": len(set(n_comp) - set(n_ref)),
        "passos_ref": passos(ref),
        "passos_comp": passos(comp),
        "erro_delta": erro_delta,
        "corr_delta": corr,
        "mesma_mao": mesma_mao,
        "sinais_ref": sig_ref,
        "sinais_comp": sig_comp,
    }


def medir_resolucao(ativo, dia, resolucoes=None, config=None, min_alinhamento=0.95,
                   max_payload_mb=PAYLOAD_MAX_MB_PADRAO):
    """Põe a série comprimida lado a lado com a fita cheia, no MESMO motor, e mede a perda.

    A pergunta que este estudo responde não é 'a tela ficou bonita': é 'depois de comprimir para
    caber no browser, o motor ainda fecha os mesmos boxes, com o mesmo Δ e os mesmos sinais?'.
    É o que decide o `BUCKET_PADRAO_MS` do replay por medida em vez de suposição — e o replay só
    serve para validar estratégia se essa resposta for simulável com honestidade.

    A referência é a fita INTEIRA do pregão (o que a ponte viva vê hoje, com a ingestão corrigida).
    Nada aqui é gravado no diário: é medição, não auditoria.

    O veredicto não olha só fidelidade: resolução aprovada é a que também cabe no browser. Escolher
    a mais fina sem olhar payload levaria a um replay de 70 MB que a tela não consegue montar.
    """
    import json

    resolucoes = tuple(resolucoes or rd.RESOLUCOES_MS)
    df, arquivo = _df_bruto(ativo, dia)
    spec = ponte.get_asset_spec(ativo)
    box_points = float(spec["box_points"])

    # mesma janela do robô dos dois lados, aplicada ANTES de comprimir (é o que `servir_histico`
    # fará ao receber desde/até): senão o bucket da borda conteria fluxo de fora da sessão.
    ts, preco, vol, agg = rd._canonizar(df)
    dentro = rd._filtrar_por_hora(ts, ponte.START_TIME, ponte.CLOSE_ALL_TIME)
    ts, preco, vol, agg = (x[dentro] for x in (ts, preco, vol, agg))
    ancora = float(preco[0])
    contratos_real = {"compra": int(vol[agg == "BUY"].sum()), "venda": int(vol[agg == "SELL"].sum())}

    print(f"\n📏 fidelidade da compressão — {ativo} {dia} ({os.path.basename(arquivo)})")
    print(f"   fita na janela do robô: {ts.size:,} ticks | contratos reais: "
          f"compra {contratos_real['compra']:,} | venda {contratos_real['venda']:,}")
    print(f"   grade: box {box_points:.0f} pts, âncora {ancora:.1f} pts "
          f"(o grid é o mesmo nas duas séries porque o primeiro tick é o mesmo)")

    _motor_limpo(ativo)
    ref = _repassar(ativo, dia, _linhas_cruas(df), config, origem="fita cheia (referência)",
                   diario=False, coletar=True)
    linhas = [_linha_tabela("fita cheia", ref, ts.size, None,
                           _comparar(ref["trajetoria"], ref["trajetoria"], box_points, ancora))]

    for bucket_ms in resolucoes:
        emit, nb = rd.comprimir_canonico(ts, preco, vol, agg, bucket_ms)
        # o tamanho do payload é medido numa amostra serializada: JSON de 2M de ticks de uma vez
        # custaria mais que a medição inteira
        amostra = json.dumps(emit[:20_000], ensure_ascii=False)
        mb = len(amostra) / max(1, len(emit[:20_000])) * len(emit) / (1024 * 1024)
        _motor_limpo(ativo)
        comp = _repassar(ativo, dia, _linhas_de_serie(emit), config,
                         origem=f"comprimida {bucket_ms} ms", diario=False, coletar=True)
        metricas = _comparar(ref["trajetoria"], comp["trajetoria"], box_points, ancora)
        metricas["buckets"] = nb
        linhas.append(_linha_tabela(f"{bucket_ms} ms", comp, len(emit), mb, metricas))

    cabecalho = (f"   {'fonte':<12} {'ticks':>10} {'boxes':>7} {'alinhado':>9} {'Σpassos':>9} "
                 f"{'err Δ':>7} {'corr Δ':>7} {'mão':>6} {'sinais':>11} {'payload':>9}")
    print("\n" + cabecalho)
    print("   " + "-" * (len(cabecalho) - 3))
    for c in linhas:
        print("   " + " | ".join(c["colunas"]))
        print(f"   {'':<12}   contratos fechados no motor: compra {c['compra']:,} "
              f"venda {c['venda']:,}  (fita: compra {contratos_real['compra']:,} "
              f"venda {contratos_real['venda']:,}) — o resto é o box aberto na última linha")
        if c.get("buckets"):
            razao = c["ticks"] / max(1, c["buckets"])
            print(f"   {'':<12}   {c['buckets']:,} buckets -> {razao:.2f} eventos/bucket "
                  f"(teto declarado: {rd.TICKS_POR_BUCKET_ESTIMADO})")
        if c["resolucao_ms"] is not None:
            print(f"   {'':<12}   níveis de grade só na fita: {c['so_ref']} | só na comprimida: "
                  f"{c['so_comp']}  (virada que o bucket engoliu = box que o replay nunca veria)")

    estouro = [c for c in linhas[1:] if c.get("buckets")
               and c["ticks"] / c["buckets"] > rd.TICKS_POR_BUCKET_ESTIMADO]
    for c in estouro:
        print(f"   ⚠ {c['resolucao_ms']} ms emitiu mais eventos por bucket do que o teto declarado: "
              f"`escolher_resolucao` está estimando por baixo e o payload do pedido pode estourar")

    aprovadas = [c for c in linhas[1:] if c["alinhamento"] >= min_alinhamento
                 and (c["payload_mb"] or 0) <= max_payload_mb]
    se_fora = [c for c in linhas[1:] if c["alinhamento"] >= min_alinhamento
               and (c["payload_mb"] or 0) > max_payload_mb]
    if se_fora:
        print(f"\n   (descartadas por payload > {max_payload_mb:.0f} MB, ainda que fiéis: "
              + ", ".join(f"{c['resolucao_ms']} ms = {c['payload_mb']:.1f} MB" for c in se_fora)
              + ")")
    if aprovadas:
        c = aprovadas[0]
        print(f"\n   → menor resolução com alinhamento ≥ {min_alinhamento:.0%} e payload ≤ "
              f"{max_payload_mb:.0f} MB: "
              f"{c['resolucao_ms']} ms, payload {c['payload_mb']:.1f} MB "
              f"({c['colunas'][3]}, err Δ {c['colunas'][5]}, sinais {c['colunas'][8]})")
        if c["alinhamento"] >= 1.0 and c["erro_delta"] > 0:
            print("     (mesmos boxes, Δ diferente por box: o caminho veio inteiro, só a "
                  "distribuição dentro do box mudou — o limiar julga o Δ do box fechado)")
    else:
        print(f"\n   → NENHUMA resolução chegou a {min_alinhamento:.0%} de alinhamento cabendo em "
              f"{max_payload_mb:.0f} MB: replay comprimido não valida estratégia neste ativo com "
              f"este box_points")
    return linhas


def _linha_tabela(nome, res, ticks, payload_mb, m):
    """Uma passada -> a linha da tabela, mais os campos brutos que os testes consomem."""
    colunas = [
        f"{nome:<12}",
        f"{ticks:>10,}",
        f"{res['boxes']:>7,}",
        f"{m['alinhamento']:>8.1%} ",
        f"{m['passos_comp']:>9,}",
        f"{m['erro_delta']:>6.1%} ",
        f"{m['corr_delta']:>7.3f}",
        f"{m['mesma_mao']:>5.0%} ",
        f"{m['sinais_comp']:>5,}/{m['sinais_ref']:<5,}",
        (f"{payload_mb:>7.1f} MB" if payload_mb is not None else f"{'-':>9}"),
    ]
    return {"nome": nome, "resolucao_ms": None if "fita" in nome else int(nome.split()[0]),
            "ticks": ticks, "boxes": res["boxes"], "payload_mb": payload_mb,
            "compra": res["contratos_fechados"]["compra"],
            "venda": res["contratos_fechados"]["venda"], "colunas": colunas, **m}


def main():
    ap = argparse.ArgumentParser(description="Reproduz um pregão com o motor real da ponte")
    ap.add_argument("--ativo", default="WINZ26", help="WINZ26 | WDOZ26 | BITX26 (padrão WINZ26)")
    ap.add_argument("--dia", help="AAAAMMDD do pregão (obrigatório salvo --todos)")
    ap.add_argument("--todos", action="store_true", help="reproduz todos os pregões que há em disco")
    ap.add_argument("--max-dias", type=int, default=0, help="limita a carga com --todos")
    ap.add_argument("--config", default=None, help="JSON com as chaves do SYNC_EA_CONFIG (a tela manda)")
    ap.add_argument("--sem-horario", action="store_true", help="não filtra pela janela do robô")
    ap.add_argument("--mt5", action="store_true",
                    help="tira os ticks do terminal agora (pregão de hoje) em vez do disco")
    ap.add_argument("--mostrar-sinais", action="store_true", help="imprime cada sinal gerado")
    ap.add_argument("--a-partir-de", default=None, metavar="HH:MM:SS",
                    help="ancora a reprodução neste instante (para bater com um processo vivo)")
    ap.add_argument("--ate", default=None, metavar="HH:MM:SS", help="encerra a reprodução neste instante")
    ap.add_argument("--ancorar", type=float, default=None, metavar="PRECO",
                    help="abre o grid Renko neste preço (o do init_engine do processo vivo)")
    ap.add_argument("--simular-ingestao", choices=["vivo", "corrigido"], default=None,
                    help="não reproduz: simula a consulta do loop vivo na fita e conta a perda "
                         "(vivo = atual, corrigido = ancora no último processado + dedup por ms)")
    ap.add_argument("--cap", type=int, default=0, help="cap de ticks por consulta na simulação")
    ap.add_argument("--janela", type=int, default=3, help="janela (s) da consulta na simulação")
    ap.add_argument("--feed", choices=["cheio", "mutilado"], default="cheio",
                    help="`cheio` = a fita toda (a referência). `mutilado` = só os ticks que a "
                         "ingestão ANTIGA do loop vivo entregava ao motor; grava na fonte "
                         "MUTILADO para o estudo de limiares")
    ap.add_argument("--sem-filtros", action="store_true",
                    help="julgamento NU: limiar 0, adaptativo/consolidação/exaustão desligados. "
                         "É o que grava o Delta de TODO box, para o estudo de limiares do "
                         "auditar_pregao.py (o PowerShell não repassa esse JSON direito)")
    ap.add_argument("--medir-resolucao", action="store_true",
                    help="não reproduz: mede, no MESMO motor, quanto da fita cheia sobrevive à "
                         "compressão de cada resolução do replay (decide o BUCKET_PADRAO_MS)")
    ap.add_argument("--resolucoes", default=None, metavar="MS,MS,...",
                    help="resoluções da medição (padrão: a escada inteira de replay_dados)")
    ap.add_argument("--min-alinhamento", type=float, default=0.95,
                    help="título de alinhamento por nível de grade para a resolução ser aprovada "
                         "na medição (padrão 0,95)")
    ap.add_argument("--max-payload-mb", type=float, default=PAYLOAD_MAX_MB_PADRAO,
                    help="teto de JSON por resposta na medição: resolução fiel que passa deste "
                         f"tamanho é descartada do veredicto (padrão {PAYLOAD_MAX_MB_PADRAO:.0f} MB)")
    args = ap.parse_args()

    config = json.loads(args.config) if args.config else None
    if args.sem_filtros:
        config = {**(config or {}), "minDeltaThreshold": 0, "adaptiveThresholdEnabled": False,
                  "consolidationFilterEnabled": False, "exhaustionFilterEnabled": False}

    if not args.todos and not args.dia:
        ap.error("informe --dia AAAAMMDD ou --todos")

    dias = dias_disponiveis(args.ativo) if args.todos else [args.dia]
    if args.todos and args.max_dias > 0:
        dias = dias[-args.max_dias:]

    os.makedirs(PASTA_AUDITORIA, exist_ok=True)
    if args.medir_resolucao:
        resolucoes = None if not args.resolucoes else tuple(
            int(x) for x in args.resolucoes.replace(" ", "").split(",") if x)
        for dia in dias:
            medir_resolucao(args.ativo, dia, resolucoes, config=config,
                            min_alinhamento=args.min_alinhamento,
                            max_payload_mb=args.max_payload_mb)
        return
    if args.simular_ingestao:
        for dia in dias:
            simular_ingestao(args.ativo, dia, modo=args.simular_ingestao, cap=args.cap, janela=args.janela)
        return
    for dia in dias:
        if args.mt5:
            res = reproduzir_mt5(args.ativo, dia, config=config, janela_horaria=not args.sem_horario,
                                 mostrar=args.mostrar_sinais, a_partir=args.a_partir_de, ate=args.ate,
                                 ancocar=args.ancorar)
        else:
            res = reproduzir(args.ativo, dia, config=config, janela_horaria=not args.sem_horario,
                             mostrar=args.mostrar_sinais, a_partir=args.a_partir_de, ate=args.ate,
                             ancocar=args.ancorar, feed=args.feed)
        vereditos = ", ".join(f"{k}={v}" for k, v in sorted(res["motivos"].items(), key=lambda kv: -kv[1]))
        print(f"\n🔁 {res['ativo']} {res['dia']} ({res['arquivo']}) — box {res['box_points']:.0f} pts, "
              f"Δmín {res['min_delta_engine']}, janela {res['janela']}")
        print(f"   ticks: {res['ticks_lidos']:,} lidos | {res['ticks_usados']:,} no motor | "
              f"{res['ticks_fora_janela']:,} fora da janela")
        print(f"   agressão: BUY {res['agressores']['BUY']:,} | SELL {res['agressores']['SELL']:,} | "
              f"CROSS {res['agressores']['CROSS']:,}")
        print(f"   boxes fechados: {res['boxes']:,}  →  SINAIS {res['sinais']}  |  CALADOS {res['calados']} "
              f"({res['primeiro_box']}..{res['ultimo_box']})")
        print(f"   veredito: {vereditos}")

    caminho = caminho_arquivo("eventos", dias[-1], args.ativo)
    fonte_usada = FONTE_MUTILADA if args.feed == "mutilado" else FONTE
    linhas = carregar_eventos(simbolo=args.ativo, fonte=fonte_usada)
    print(f"\n📓 diário gravado: {os.path.relpath(caminho, RAIZ)} "
          f"({len(linhas):,} linhas de box acumuladas, fonte={fonte_usada})")


if __name__ == "__main__":
    main()
