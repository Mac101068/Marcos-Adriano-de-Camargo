"""Prova do diário de auditoria — o que aconteceu DE VERDADE, linha por linha.

O diário só tem valor se garantir as três coisas que faltaram no pregão de 05/Nov/2026:

  A) todo box fechado vira UMA linha no CSV, inclusive os que não viraram sinal;
  B) a linha carrega o MOTIVO do corte — sem registrar os calados, nenhum filtro é auditável;
  C) tentativa de ordem que nunca chegou à corretora deixa rastro com o erro (foi o bug do
     filling: 15 prints de "[ABRINDO ORDEM MÃE]" e zero envios, e nada disso em lugar nenhum).

Rode com o Python do venv (o módulo MetaTrader5 é importado pela ponte). Nenhum envio de ordem
acontece aqui: o mt5 da ponte é trocado por um stub morto, então nenhum caminho chega a
order_send — o teste prova justamente a trilha de falha ANTES do envio.
"""

import csv
import os
import sys

# O console do Windows é cp850/cp1252 e morre em UnicodeEncodeError ao imprimir travessão
# com a saída redirecionada — que é exatamente o modo como log, launcher e agente rodam isto.
# Forçar UTF-8 no stdout é o que faz o mesmo script valer nas duas máquinas sem perder acento.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from datetime import datetime

import bot_mt5_ciclo15 as ponte
from auditoria_diario import (
    PASTA_AUDITORIA,
    EVENTOS_CAMPOS,
    ORDENS_CAMPOS,
    registrar_box,
    carregar_eventos,
)

FONTE = "TESTE"
SIMBOLO = "TESTE"
OK = "[OK] "
FALHA = "[FALHA] "

falhas = []


def checar(rotulo, obtido, esperado):
    if obtido == esperado:
        print(f"  {OK}{rotulo} | esperado={esperado} obtido={obtido}")
    else:
        print(f"  {FALHA}{rotulo} | esperado={esperado} obtido={obtido}")
        falhas.append(rotulo)


# Determinismo: este teste julga o DIÁRIO, não o avaliador (a paridade de regras é provada em
# test_paridade_regras.py). Desligamos adaptativo/consolidação/exaustão para que o veredito de
# cada box dependa só do Delta, e desligamos o horário para a ordem chegar ao envio.
_orig = dict(ponte.EVAL_CONFIG)
ponte.EVAL_CONFIG.update({
    "adaptive": False,
    "consolidation_enabled": False,
    "exhaustion_enabled": False,
    "strategy_mode": "PYRAMID_FLOW_CONFLUENCE",
})
ponte.TRADING_HOURS_ENABLED = False


class _Mt5SemSimbolo:
    """Terminal aberto, mas o símbolo do ensaio não existe nele.

    Antes este stub devolvia None para tudo e o código saía cedo no "símbolo não encontrado",
    sem gravar nada — o teste passava só porque o MT5 estava fechado. Agora `symbol_info`
    devolve um objeto verdadeiro e vazio: o AttributeError nasce dentro do caminho do pedido,
    que é o mesmo formato da falha real de 05/Nov, e o guard tem de virar LINHA no diário.
    """

    def symbol_select(self, *_args, **_kwargs):
        return False

    def symbol_info(self, *_args, **_kwargs):
        return object()  # truthy e sem atributos: estoura em sym_info.trade_tick_size

    def __getattr__(self, nome):
        def _nada(*_args, **_kwargs):
            return None
        return _nada


class _Pos:
    """Posição aberta no MT5 (o mínimo que os caminhos de fechamento leem)."""

    def __init__(self, ticket, tipo, volume, magic, preco=5000.0):
        self.ticket = ticket
        self.type = tipo
        self.volume = volume
        self.magic = magic
        self.price_open = preco
        self.sl = 0.0
        self.tp = 0.0
        self.profit = 0.0  # lido por get_daily_pnl (limites de risco)


class _Res:
    def __init__(self, order=777, retcode=10009, comment="ok"):
        self.order = order
        self.retcode = retcode
        self.comment = comment


class _Simbolo:
    trade_mode = 4  # SYMBOL_TRADE_MODE_FULL
    trade_tick_size = 5.0
    digits = 0
    point = 5.0
    volume_min = 1.0
    volume_step = 1.0
    trade_stops_level = 0


class _Tick:
    bid = 5000.0
    ask = 5000.0
    time = 0
    time_msc = 0


class _Mt5Vivo:
    """Corretora viva: aceita tudo e devolve TRADE_RETCODE_DONE.

    Serve para os caminhos que só gravam depois do envio (entrada e fechamento) — é a única
    forma de cobrir magic/position nas linhas de CLOSE_PARCIAL e CLOSE_POSITION sem terminal.
    """

    ORDER_TYPE_BUY = 0
    ORDER_TYPE_SELL = 1
    TRADE_ACTION_DEAL = 1
    TRADE_ACTION_SLTP = 6
    TRADE_RETCODE_DONE = 10009
    ORDER_TIME_GTC = 0
    SYMBOL_TRADE_MODE_DISABLED = 0

    def __init__(self, posicoes):
        self._posicoes = list(posicoes)

    def symbol_select(self, *_args, **_kwargs):
        return True

    def symbol_info(self, *_args, **_kwargs):
        return _Simbolo()

    def symbol_info_tick(self, *_args, **_kwargs):
        return _Tick()

    def positions_get(self, **filtros):
        if "ticket" in filtros:
            achadas = [p for p in self._posicoes if p.ticket == filtros["ticket"]]
        else:
            achadas = list(self._posicoes)
        return achadas or None

    def order_send(self, request):
        return _Res(order=request.get("position") or 777)

    def __getattr__(self, nome):
        def _nada(*_args, **_kwargs):
            return None
        return _nada


ponte.mt5 = _Mt5SemSimbolo()

agora_msc = int(datetime.now().timestamp() * 1000) // 1000 * 1000
dia_hoje = datetime.now().strftime("%Y%m%d")
caminho_eventos = os.path.join(PASTA_AUDITORIA, f"eventos_{SIMBOLO}_{dia_hoje}.csv")
caminho_ordens = os.path.join(PASTA_AUDITORIA, f"ordens_{SIMBOLO}_{dia_hoje}.csv")

# Começa limpo: as contagens têm de dizer respeito a esta execução (o diário é append-only)
if os.path.isdir(PASTA_AUDITORIA):
    for _arq in os.listdir(PASTA_AUDITORIA):
        if f"_{SIMBOLO}_" in _arq:
            os.remove(os.path.join(PASTA_AUDITORIA, _arq))

print("\n=== A+B. Um box fechado = uma linha, com o motivo do veredito ===")

eng = ponte.RenkoFlowEngine(SIMBOLO, box_points=50.0, tick_size=5.0, min_delta_threshold=150)

# (volume, agressor): 12 blocos de alta e 2 de baixa. Com limiar estático 150 (piso 50),
# espera-se sinal exatamente nos Delta >= 150 (alta) e <= -150 (baixa).
ALTA = [
    (10, "BUY", None),
    (200, "BUY", "BUY"),
    (30, "BUY", None),
    (300, "BUY", "BUY"),
    (5, "BUY", None),
    (180, "BUY", "BUY"),
    (400, "BUY", "BUY"),
    (12, "BUY", None),
    (250, "BUY", "BUY"),
    (60, "BUY", None),
    (500, "BUY", "BUY"),
    (90, "BUY", None),
    (400, "SELL", "SELL"),   # inversão: bloco vermelho com agressão real
    (20, "SELL", None),      # bloco vermelho fraco: continua calado por Delta
]

# O gabarito é o veredito do PRÓPRIO motor: este teste julga o diário (o que foi para o CSV bate
# com o que o motor decidiu), não a regra de sinal — a paridade de regras é provada em
# test_paridade_regras.py. A lista ALTA continua definindo a fita; o terceiro campo dela não é
# mais um gabarito, porque no modo PYRAMID_FLOW_CONFLUENCE o sinal exige confluência além do Delta.
sinal_por_index = {}
fechados = 0
sinais = 0

for i, (vol, agg, esperado) in enumerate(ALTA):
    if i == 0:
        preco = 5000.0
        eng.init_engine(preco, agora_msc)
        ultimo = preco
        continue
    passo = 50.0 if agg == "BUY" else -50.0
    if esperado is None and agg == "SELL":
        # um bloco DOWN a partir de alta exige furo de 2 degraus; o resto anda 1 degrau
        ultimo = ultimo - 100.0 if fechados == 12 else ultimo + passo
    else:
        ultimo = ultimo + passo if agg == "BUY" else ultimo - 100.0
    new_box, signal, _reason = eng.process_tick(ultimo, vol, agg, agora_msc + i * 1000)
    if not new_box:
        continue
    fechados += 1
    sinal_por_index[new_box["index"]] = signal or ""
    if signal:
        sinais += 1
    # Réplica exata do que a ponte faz no loop vivo (bot_mt5_ciclo15, loop de ticks)
    registrar_box(new_box, new_box.get("audit"), FONTE, SIMBOLO)

checar("boxes fechados pelo motor", fechados, len(ALTA) - 1)
checar("o motor gera sinal e também cala (nem todos, nem nenhum)", 0 < sinais < fechados, True)

linhas = carregar_eventos(simbolo=SIMBOLO, fonte=FONTE)
checar("uma linha de diário por box fechado", len(linhas), fechados)
checar("nenhuma linha de outra fonte misturada", len([r for r in linhas if r["fonte"] != FONTE]), 0)

indices = [int(r["box_index"]) for r in linhas]
checar("box_index sem duplicidade", len(set(indices)), len(indices))

errados = [
    (r["box_index"], r["sinal"], sinal_por_index.get(int(r["box_index"])))
    for r in linhas
    if r["sinal"] != (sinal_por_index.get(int(r["box_index"])) or "")
]
checar("coluna `sinal` reproduz o veredito do motor", errados, [])

sem_motivo = [r["box_index"] for r in linhas if not (r["motivo"] or "").strip()]
checar("toda linha tem motivo preenchido", sem_motivo, [])

calados = [r for r in linhas if not r["sinal"]]
codigos = {r["motivo"].split("|")[0].strip() for r in calados}
checar("calados registrados com código de motivo", sorted(codigos), ["CALADO_DELTA"])
checar("metade dos boxes foi calada e ficou no papel", len(calados), fechados - sinais)

sinalizados = [r for r in linhas if r["sinal"]]
codigos_s = {r["motivo"].split("|")[0].strip() for r in sinalizados}
checar("sinal também deixa rastro (SINAL_*)", sorted(codigos_s), ["SINAL_BUY", "SINAL_SELL"])

colunas_criticas = ["delta", "limiar_compra", "limiar_venda", "efficiency_ratio", "fechamento", "cvd"]
vazias = [(r["box_index"], c) for r in linhas for c in colunas_criticas if not (r[c] or "").strip()]
checar("números do julgamento presentes em toda linha", vazias, [])

er_fora = [r["box_index"] for r in linhas if not (0.0 <= float(r["efficiency_ratio"]) <= 1.0)]
checar("Efficiency Ratio medido sempre (0..1)", er_fora, [])

direcoes = sorted({r["direcao"] for r in linhas})
checar("UP e DOWN journalizados", direcoes, ["DOWN", "UP"])

print("\n=== A2. Reinício da ponte no meio do pregão não duplica a leitura ===")

# Se a ponte cair e subir replayando os ticks do dia, o mesmo box é gravado de novo. O
# arquivo continua append-only (nenhuma linha se perde), mas a LEITURA colapsa por box.
for _box in eng.boxes:
    registrar_box(_box, _box.get("audit"), FONTE, SIMBOLO)

brutas = len(list(csv.DictReader(open(caminho_eventos, encoding="utf-8"))))
checar("arquivo é append-only (nada sobrescrito na repetição)", brutas, fechados * 2)
checar("leitura colapsa box repetido", len(carregar_eventos(simbolo=SIMBOLO, fonte=FONTE)), fechados)
checar("sem dedup é possível ver o replay", len(carregar_eventos(simbolo=SIMBOLO, fonte=FONTE, dedup=False)), fechados * 2)

print("\n=== C. Ordem que não chega na corretora deixa rastro com o erro ===")

mgr = ponte.MT5OrderManager(SIMBOLO, 1, 999999)
box_sinal = eng.boxes[-2] if eng.boxes[-1]["direction"] == "UP" else eng.boxes[-3]
ok_envio, ticket, quem = mgr.execute_pyramid_confluence("BUY", box_sinal)

linhas_ordem = (
    [r for r in csv.DictReader(open(caminho_ordens, encoding="utf-8")) if r["simbolo"] == SIMBOLO]
    if os.path.exists(caminho_ordens) else []
)

checar("o diário de ordens foi criado no disco", os.path.exists(caminho_ordens), True)

checar("nenhuma ordem foi executada (corretora morta)", ok_envio, False)
checar("a tentativa virou exatamente 1 linha no diário", len(linhas_ordem), 1)
r_ordem = linhas_ordem[0] if linhas_ordem else {}
checar("executada=0 registrado", r_ordem.get("executada"), "0")
checar("sem ticket/retcode inventados", (r_ordem.get("ticket"), r_ordem.get("retcode")), ("", ""))
checar("motivo aponta EXCECAO_ANTES_DO_SEND",
       r_ordem.get("motivo", "").startswith("EXCECAO_ANTES_DO_SEND | AttributeError"), True)
checar("ação identificada como ORDEM_MAE", r_ordem.get("acao"), "ORDEM_MAE")
checar("preço do box que gerou o sinal foi guardado", bool(r_ordem.get("preco_box")), True)
checar("box_index da tentativa registrado", int(r_ordem.get("box_index") or -1), box_sinal["index"])
checar("tentativa sem magic explícito herda o dono do manager", r_ordem.get("magic"), "999999")

print("\n=== E. Cada ordem carrega o dono (magic) e a posição que toca ===")


def ler_ordens():
    if not os.path.exists(caminho_ordens):
        return []
    with open(caminho_ordens, encoding="utf-8") as f:
        return [r for r in csv.DictReader(f) if r["simbolo"] == SIMBOLO]


with open(caminho_ordens, encoding="utf-8") as _f:
    _cabecalho = next(csv.reader(_f), [])
checar("cabeçalho da trilha tem magic e position",
       ("magic" in _cabecalho, "position" in _cabecalho), (True, True))

ponte.mt5 = _Mt5Vivo([
    _Pos(ticket=555, tipo=0, volume=1.0, magic=999999),
    _Pos(ticket=601, tipo=0, volume=1.0, magic=100001),
])
mgr2 = ponte.MT5OrderManager(SIMBOLO, 1, 100001)

enviou, _ticket = mgr2.execute_market_order("BUY", comment="TESTE_ENTRADA", magic=100001)
checar("entrada com corretora viva é executada", enviou, True)
linha_entrada = [r for r in ler_ordens() if r["motivo"] == "ORDEM_ACCEPTED"]
checar("entrada executada virou 1 linha", len(linha_entrada), 1)
if linha_entrada:
    checar("entrada carrega o magic de quem mandou", linha_entrada[0]["magic"], "100001")
    checar("entrada não inventa position", linha_entrada[0]["position"], "")

checar("fechamento parcial aceito pela corretora", mgr2.close_partial_position(555, 1.0, magic=999999), True)
linha_parcial = [r for r in ler_ordens() if r["acao"] == "CLOSE_PARCIAL"]
checar("CLOSE_PARCIAL virou linha na trilha", len(linha_parcial), 1)
if linha_parcial:
    checar("CLOSE_PARCIAL guarda a posição tocada", linha_parcial[0]["position"], "555")
    checar("CLOSE_PARCIAL guarda o magic da boleta", linha_parcial[0]["magic"], "999999")
    checar("CLOSE_PARCIAL registrada como executada", linha_parcial[0]["executada"], "1")

mgr2.close_all_positions(magic=100001)
linha_zero = [r for r in ler_ordens() if r["acao"] == "CLOSE_POSITION"]
checar("CLOSE_POSITION virou linha na trilha", len(linha_zero), 1)
if linha_zero:
    checar("CLOSE_POSITION guarda a posição tocada", linha_zero[0]["position"], "601")
    checar("CLOSE_POSITION guarda o magic do dono", linha_zero[0]["magic"], "100001")

print("\n=== D. Fiação: os ganchos estão nos caminhos que importam ===")

fonte_bot = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "bot_mt5_ciclo15.py"),
                 encoding="utf-8").read()
checar("loop vivo journaliza cada box", fonte_bot.count("audit_registrar_box(new_box"), 1)
checar("todas as trilhas de ordem usam _audit_ordem", fonte_bot.count("self._audit_ordem(") >= 6, True)
checar("guards de exceção antes do send (mãe/tela)",
       fonte_bot.count("EXCECAO_ANTES_DO_SEND"), 2)
checar("interrupor AUDITORIA_OFF existe (kill-switch)", "AUDITORIA_OFF" in fonte_bot, True)

print("\n" + "=" * 62)
if falhas:
    print(f"X DIÁRIO COM PROBLEMAS ({len(falhas)}): {falhas}")
else:
    print("OK DIÁRIO CONFIÁVEL: cada box, cada corte e cada ordem morta viram linha consultável.")

# Não suja o diretório de auditoria dos pregões reais
for arq in os.listdir(PASTA_AUDITORIA):
    if f"_{SIMBOLO}_" in arq:
        os.remove(os.path.join(PASTA_AUDITORIA, arq))

ponte.EVAL_CONFIG.clear()
ponte.EVAL_CONFIG.update(_orig)
sys.exit(1 if falhas else 0)
