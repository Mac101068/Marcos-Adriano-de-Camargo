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


class _Mt5Morto:
    """Interrupção simulada da corretora: todo retorno é None, nenhum order_send existe.

    É o mesmo formato da falha real de 05/Nov (AttributeError no meio do caminho do pedido),
    só que controlada: aqui `symbol_info(...).point` estoura e tem de virar LINHA no diário.
    """

    def __getattr__(self, nome):
        def _morto(*_args, **_kwargs):
            return None
        return _morto


ponte.mt5 = _Mt5Morto()

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

esperado_por_index = {}
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
    esperado_por_index[new_box["index"]] = esperado
    if signal:
        sinais += 1
    # Réplica exata do que a ponte faz no loop vivo (bot_mt5_ciclo15, loop de ticks)
    registrar_box(new_box, new_box.get("audit"), FONTE, SIMBOLO)

checar("boxes fechados pelo motor", fechados, len(ALTA) - 1)
checar("sinais gerados (Delta acima do limiar)", sinais, sum(1 for x in ALTA[1:] if x[2]))

linhas = carregar_eventos(simbolo=SIMBOLO, fonte=FONTE)
checar("uma linha de diário por box fechado", len(linhas), fechados)
checar("nenhuma linha de outra fonte misturada", len([r for r in linhas if r["fonte"] != FONTE]), 0)

indices = [int(r["box_index"]) for r in linhas]
checar("box_index sem duplicidade", len(set(indices)), len(indices))

errados = [
    (r["box_index"], r["sinal"], esperado_por_index.get(int(r["box_index"])))
    for r in linhas
    if r["sinal"] != (esperado_por_index.get(int(r["box_index"])) or "")
]
checar("coluna `sinal` bate com o veredito do motor", errados, [])

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

print("\n=== D. Fiação: os ganchos estão nos caminhos que importam ===")

fonte_bot = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "bot_mt5_ciclo15.py"),
                 encoding="utf-8").read()
checar("loop vivo journaliza cada box", fonte_bot.count("audit_registrar_box(new_box"), 1)
checar("todas as trilhas de ordem usam _audit_ordem", fonte_bot.count("self._audit_ordem(") >= 6, True)
checar("guards de exceção antes do send (mãe/pirâmide/tela)",
       fonte_bot.count("EXCECAO_ANTES_DO_SEND"), 3)
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
