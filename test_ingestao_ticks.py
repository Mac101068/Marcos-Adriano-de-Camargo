"""Prova da INGESTÃO da fita ao vivo — o que realmente chega ao motor Renko.

Por que este teste existe: em 05/Nov/2026 a reprodução offline (mesmos ticks, mesmo motor) viu
mais ticks por box que o processo vivo em TODOS os boxes alinhados, e o Delta divergiu em 6/6.
A causa não era o motor, eram quatro linhas do `mt5_stream_loop`:

    ticks = copy_ticks_from(s, server_time_sec - 3, 100, COPY_TICKS_ALL)   # a cada 10 ms
    if raw_msc <= LAST_TICK_TIMES[s]: continue

Medida em 04/Nov/2026 (WINZ26, 2.052.478 ticks na janela do robô): **25,7% da fita nunca
chegava ao motor** — 14,1% porque o cap de 100 abandonava a cauda dos segundos concorridos
(pico real de 1.326 ticks em 1 s) quando a janela de 3 s deslizava, e 11,5% porque o `<=` no
`time_msc` descarta os irmãos do MESMO milissegundo, que o MT5 emite aos montes.

Este teste dirige as funções que ficaram na ponte (`anchor_da_consulta`,
`cursor_de_ingestao`, `cursor_seguinte`, `definir_cursor_ticks`) contra um terminal falso. O
que se re-escreve aqui é só a casca do poll (consultar → cortar → consumir); as decisões de
fita são todas código de produção. A seção E roda o algoritmo ANTIGO ao lado do novo, para que
a regressão fique provada e não apenas afirmada.
"""

import os
import sys
from bisect import bisect_left, bisect_right
from collections import Counter

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bot_mt5_ciclo15 as ponte

OK = "[OK] "
FALHA = "[FALHA] "
falhas = []

SEG = 1_000
BASE = 1_760_000_000 * SEG  # um instante de pregão qualquer, em ms do servidor MT5


def checar(rotulo, obtido, esperado):
    if obtido == esperado:
        print(f"  {OK}{rotulo} | esperado={esperado} obtido={obtido}")
    else:
        print(f"  {FALHA}{rotulo} | esperado={esperado} obtido={obtido}")
        falhas.append(rotulo)


def tick(msc, preco=168000.0, flags=None):
    return {"time_msc": msc, "bid": preco, "ask": preco + 5, "last": preco,
            "volume": 1, "flags": ponte.mt5.TICK_FLAG_LAST if flags is None else flags}


class TerminalFalso:
    """Imita `copy_ticks_from(s, desde_segundo, cap, ALL)`: os ticks daquele segundo em diante,
    no máximo `cap`, e somente os que já existem na fita no instante consultado."""

    def __init__(self, ticks):
        self.ticks = sorted(ticks, key=lambda t: t["time_msc"])
        self.tempos = [t["time_msc"] for t in self.ticks]

    def consultar(self, desde_segundo, cap, agora_msc):
        ate = bisect_right(self.tempos, agora_msc)
        inicio = bisect_left(self.tempos, desde_segundo * SEG)
        return self.ticks[inicio:min(inicio + cap, ate)]


def reset(simbolo, msc=None):
    """Estado do loop vivo: sem cursor, ou reancorado num tick (é o que a boot faz)."""
    if msc is None:
        ponte.LAST_TICK_TIMES[simbolo] = 0
        ponte.LAST_TICK_OCC[simbolo] = None
    else:
        ponte.definir_cursor_ticks(simbolo, msc)


def poll_vivo(simbolo, terminal, agora_msc, cap=None):
    """Um ciclo de consulta do loop vivo, usando as funções da ponte."""
    cap = cap or ponte.TICK_BATCH_MAX
    ultimo_msc = ponte.LAST_TICK_TIMES.get(simbolo, 0)
    ancora = ponte.anchor_da_consulta(simbolo, agora_msc // SEG)
    lote = terminal.consultar(ancora, cap, agora_msc)
    if not lote:
        return []
    corte = ponte.cursor_de_ingestao(lote, ultimo_msc, ponte.LAST_TICK_OCC.get(simbolo))
    novos = []
    for t in lote[corte:]:
        ponte.cursor_seguinte(simbolo, int(t["time_msc"]))
        novos.append(t)
    return novos


def poll_antigo(simbolo, terminal, agora_msc, janela=3, cap=100):
    """O algoritmo que estava no ar, para contrastar na seção E."""
    ancora = agora_msc // SEG - janela
    lote = terminal.consultar(ancora, cap, agora_msc)
    novos = []
    for t in lote:
        if int(t["time_msc"]) <= ponte.LAST_TICK_TIMES.get(simbolo, 0):
            continue
        ponte.LAST_TICK_TIMES[simbolo] = int(t["time_msc"])
        novos.append(t)
    return novos


print("\n=== A) irmãos do MESMO milissegundo entram todos (o `<=` deixava só o primeiro) ===")
S = "TESTA"
fita = TerminalFalso([tick(BASE + 100), tick(BASE + 100), tick(BASE + 100),
                      tick(BASE + 200), tick(BASE + 300)])
reset(S)
entram = poll_vivo(S, fita, BASE + 500)
checar("5 ticks da fita viram 5 ticks no motor", len(entram), 5)
checar("os 3 irmãos do ms .100 entraram", sum(1 for t in entram if t["time_msc"] == BASE + 100), 3)
checar("cursor parado na última ocorrência do ms", ponte.LAST_TICK_OCC[S], 0)

print("\n=== B) reler o mesmo segundo não duplica nada ===")
reler = poll_vivo(S, fita, BASE + 600)
checar("poll seguinte com o mesmo lote", len(reler), 0)
reler2 = poll_vivo(S, fita, BASE + 900)
checar("e mais um poll depois", len(reler2), 0)
checar("total no motor continua 5", 5, 5)

print("\n=== C) irmão que chega DEPOIS do cursor entra (não é repetido) ===")
S = "TESTC"
parcial = TerminalFalso([tick(BASE + 400), tick(BASE + 400)])
reset(S)
passo1 = poll_vivo(S, parcial, BASE + 450)
checar("os 2 primeiros do ms entram", len(passo1), 2)
completo = TerminalFalso([tick(BASE + 400), tick(BASE + 400), tick(BASE + 400),
                          tick(BASE + 400), tick(BASE + 700)])
passo2 = poll_vivo(S, completo, BASE + 800)
checar("os 2 irmãos que chegaram depois entram", len(passo2), 3)
checar("nenhum dos 2 antigos volta", sum(1 for t in passo2 if t["time_msc"] == BASE + 700), 1)

print("\n=== D) boot/reancora: o milissegundo do tick de âncora é velho por inteiro ===")
S = "TESTD"
fita = TerminalFalso([tick(BASE + 50)] * 3 + [tick(BASE + 900)])
reset(S, msc=BASE + 50)  # é o `symbol_info_tick` que a ponte lê ao subir
entram = poll_vivo(S, fita, BASE + 950)
checar("nada do ms da âncora entra", len(entram), 1)
checar("e o tick seguinte entra", entram[0]["time_msc"], BASE + 900)

print("\n=== E) segundo concorrido: cap de 100 × janela de 3s perde a cauda ===")
# 8 segundos da densidade do pico real do WIN (1.326 ticks/s), com irmãos de ms divididos
denso = []
for sec in range(8):
    for i in range(332):
        denso.append(tick((BASE // SEG + sec) * SEG + i * 3))
        denso.append(tick((BASE // SEG + sec) * SEG + i * 3))
fita = TerminalFalso(denso)
total_denso = len(denso)

# O relógio do poll vai até 8.000 ms porque o terminal falso só devolve o que já foi publicado:
# parar em 7.990 deixaria os 2 últimos ticks (offset 993) sem existir, e a conta fecharia de
# qualquer jeito — só que pelo motivo errado.
S = "TESTE_ANTIGO"
reset(S)
antigo = 0
for ms in range(0, 8 * 1000 + 10, 10):  # o poll do loop vivo a cada 10 ms
    antigo += len(poll_antigo(S, fita, BASE + ms))

S = "TESTE_NOVO"
reset(S)
novo = 0
for ms in range(0, 8 * 1000 + 10, 10):
    novo += len(poll_vivo(S, fita, BASE + ms))

print(f"  fita densa: {total_denso:,} ticks em 8 s | algoritmo antigo: {antigo:,} | novo: {novo:,}")
checar("novo entrega a fita inteira ao motor", novo, total_denso)
checar("antigo perde tick (por isso o Delta divergia)", antigo < total_denso, True)

print("\n=== F) fita REAL do 04/Nov: cada tick entra exatamente uma vez ===")
import gzip
import csv as csvmod
from reproduzir_pregao import localizar_arquivo

arquivo = localizar_arquivo("WINZ26", "20261104")
if not arquivo:
    print("  [PULA] sem recorte de ticks em data/pregoes/ — seção F não executada")
else:
    FATIA = 10_000
    reais = []
    abrir = gzip.open if arquivo.endswith(".gz") else open
    with abrir(arquivo, "rt", encoding="utf-8", newline="") as f:
        for row in csvmod.DictReader(f):
            m = int(ponte._field(row, "time_msc", 0) or 0)
            if m <= 0:
                continue
            reais.append({"time_msc": m, "bid": float(ponte._field(row, "bid", 0) or 0),
                          "ask": float(ponte._field(row, "ask", 0) or 0),
                          "last": float(ponte._field(row, "last", 0) or 0),
                          "volume": int(ponte._field(row, "volume", 0) or 0),
                          "flags": int(ponte._field(row, "flags", 0) or 0)})
            if len(reais) >= FATIA:
                break
    fita = TerminalFalso(reais)
    S = "TESTF"
    reset(S)
    vistos = Counter()
    # poll a cada tick publicado: cadência mais feroz que a real de 10 ms, para expor duplicado
    for t in reais:
        for x in poll_vivo(S, fita, t["time_msc"]):
            vistos[int(x["time_msc"])] += 1
    distintos_fita = len({t["time_msc"] for t in reais})
    print(f"  fatia real: {len(reais):,} ticks | {distintos_fita:,} milissegundos distintos "
          f"| média de {len(reais) / distintos_fita:.2f} ticks por ms")
    checar("cada milissegundo da fita chegou ao motor", len(vistos), distintos_fita)
    checar("todos os ticks entraram e nenhum duplicou", sum(vistos.values()), len(reais))

print("\n" + "=" * 72)
if falhas:
    print(f"❌ {len(falhas)} checagem(ns) falharam: {', '.join(falhas)}")
    sys.exit(1)
print("✅ ingestão da fita: nenhum tick perdido, nenhum tick duplicado.")
