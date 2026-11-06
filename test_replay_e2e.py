"""Round-trip do pedido HISTORY: a ponte serve a FITA REAL comprimida pelo protocolo da tela.

Sem MT5 e sem servidor — o `handle_request_history` recebe um websocket de mentira que apenas
guarda o JSON que seria enviado. O que este teste protege é a PROCEDÊNCIA: se o HISTORY_DONE
disser `TICKS_REAIS` sem que a série tenha saído do arquivo do pregão, ou se um chunk vier com id
repetido (a tela dedupa por id: tick repetido desaparece), a tela mostra "validação" sobre dados
decorativos. É exatamente a classe de erro que ninguém vê até o resultado do estudo estar errado.

Roda com:  .\\venv\\Scripts\\python.exe test_replay_e2e.py
"""

import asyncio
import json
import os
import sys

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bot_mt5_ciclo15 as ponte
import replay_dados as rd

FALHAS = []


def checa(nome, ok, detalhe=""):
    print(f"  [{'OK ' if ok else 'XX '}] {nome}" + (f" — {detalhe}" if detalhe else ""))
    if not ok:
        FALHAS.append(nome)


class WsFake:
    """WebSocket mínimo: a ponte só usa `send(json)` e `remote_address` neste caminho."""

    remote_address = ("teste", 0)

    def __init__(self):
        self.mensagens = []

    async def send(self, texto):
        self.mensagens.append(json.loads(texto))


async def pedido(symbol, days, bucket_ms=None):
    ws = WsFake()
    await ponte.handle_request_history(ws, "req-e2e", symbol, days, bucket_ms=bucket_ms)
    chunks = [m["data"] for m in ws.mensagens if m["type"] == "HISTORY_CHUNK"]
    done = next((m["data"] for m in ws.mensagens if m["type"] == "HISTORY_DONE"), None)
    erro = next((m["data"] for m in ws.mensagens if m["type"] == "HISTORY_ERROR"), None)
    return ws, chunks, done, erro


async def principal():
    print("\nA. pedido de histórico da contínua atende pela fita real do contrato")
    # 'WIN$N' é o que a TELA pede (asset.primarySymbol); o recorte em disco é 'winz26_ticks_*'.
    # Sem o mapeamento de família este pedido cairia no M1 e pareceria que não há dados.
    ws, chunks, done, erro = await pedido("WIN$N", 1, 4000)
    checa("atendimento veio da fita real (sem HISTORY_ERROR)", erro is None and bool(chunks),
          erro and erro.get("reason") or f"{len(chunks)} chunk(s)")
    if not chunks or not done:
        print("\n" + (f"FALHAS: {FALHAS}" if FALHAS else "sem série para conferir"))
        return

    todos = [t for c in chunks for t in c["ticks"]]
    checa("todas as mensagens rotuladas TICKS_REAIS",
          all(c["volumeSource"] == ponte.VOLUME_SOURCE_TICKS_REAIS for c in chunks)
          and done["volumeSource"] == ponte.VOLUME_SOURCE_TICKS_REAIS,
          str({c["volumeSource"] for c in chunks} | {done["volumeSource"]}))
    checa("resolução pedida devolvida na resposta",
          all(c["resolucaoMs"] == 4000 for c in chunks) and done["resolucaoMs"] == 4000,
          str(done["resolucaoMs"]))
    checa("chunks na ordem e dentro do cap do protocolo",
          [c["index"] for c in chunks] == list(range(len(chunks)))
          and all(len(c["ticks"]) <= ponte.HISTORY_CHUNK_TICKS for c in chunks),
          f"{len(chunks)} chunk(s), maior {max(len(c['ticks']) for c in chunks)}")
    checa("HISTORY_DONE conta o que foi enviado",
          done["count"] == len(todos) and done["chunks"] == len(chunks),
          f"done {done['count']:,} vs enviado {len(todos):,}")
    checa("ids ÚNICOS (a tela dedupa por id: repetido some do replay)",
          len({t["id"] for t in todos}) == len(todos), f"{len(todos):,} eventos")
    # A faixa validada é a diferença entre "o replay julga limiar" e "o replay mostra o caminho".
    # Em 4.000 ms o Δ medido contra a fita cheia tem 80% de erro: a origem continua sendo a fita
    # REAL, e ainda assim vender validação aqui seria a tela mentir sobre o que ela mediu.
    checa("bucket fora da faixa mede caminho mas DECLARA que não valida estratégia",
          done.get("validaEstrategia") is False
          and "FORA DA FAIXA VALIDADA" in (done.get("nota") or ""),
          f"validaEstrategia={done.get('validaEstrategia')} Δalinhado="
          f"{done.get('alinhamentoMedido')} erros={done.get('sinaisRecuperados')}")
    checa("série não decrescente no tempo",
          all(a["timestamp"] <= b["timestamp"] for a, b in zip(todos, todos[1:])))
    checa("dias e arquivos servidos declarados",
          bool(done.get("diasServidos")) and bool(done.get("arquivosServidos")),
          f"{done.get('diasServidos')} <- {done.get('arquivosServidos')}")

    print("\nB. o fluxo servido é o fluxo do arquivo (contrato a contrato)")
    arquivo = rd.localizar_recorte("WIN$N", done["diasServidos"][0])
    # sem desde/até o recorte é a sessão inteira do arquivo — as somas têm de bater em cheio
    _ts, preco, vol, agg = rd._canonizar(pd.read_csv(
        arquivo, usecols=["time_msc", "last", "volume", "flags"]))
    esperado = {
        "BUY": int(vol[agg == "BUY"].sum()),
        "SELL": int(vol[agg == "SELL"].sum()),
    }
    servido = {
        "BUY": sum(t["volume"] for t in todos if t["aggressor"] == "BUY"),
        "SELL": sum(t["volume"] for t in todos if t["aggressor"] == "SELL"),
    }
    checa("Σcompra e Σvenda dos chunks == soma da fita inteira",
          servido == esperado, f"compra {servido['BUY']:,} vs {esperado['BUY']:,} | "
          f"venda {servido['SELL']:,} vs {esperado['SELL']:,}")
    checa("a declaração no HISTORY_DONE bate com os ticks enviados",
          done["contratosCompra"] == servido["BUY"] and done["contratosVenda"] == servido["SELL"],
          f"done compra {done['contratosCompra']:,} venda {done['contratosVenda']:,}")
    checa("menos eventos que ticks lidos (é isto que cabe no browser)",
          len(todos) < done["ticksReaisLidos"],
          f"{len(todos):,} eventos de {done['ticksReaisLidos']:,} ticks lidos")

    # A tela tem um gate de suficiência (assessSufficiency): se >=80% dos ticks vierem sem volume,
    # ela declara SEM_VOLUME e o replay deixa de validar fluxo. Os segmentos só-CROSS são raros na
    # fita, mas é isto que garante que a série comprimida não acende esse aviso à toa.
    sem_volume = sum(1 for t in todos if not t["volume"] > 0) / max(1, len(todos))
    checa("fração de eventos sem volume fica abaixo do gate da tela (<20%)",
          sem_volume < 0.2, f"{sem_volume:.1%} dos eventos com volume zero")

    print("\nC. preço servido é preço de negócio do arquivo, sem inventar")
    # conjunto de TODA a fita: o dia atravessa níveis que não aparecem nas primeiras linhas
    niveis_arquivo = set(float(p) for p in np.unique(preco))
    fora = [t["price"] for t in todos if float(t["price"]) not in niveis_arquivo]
    checa("todo preço emitido existe na fita do pregão", not fora,
          f"{len(fora)} preço(s) estranho(s): {fora[:3]}")
    checa("nenhum evento com volume negativo ou agressor inválido",
          all(t["volume"] >= 0 and t["aggressor"] in ("BUY", "SELL", "CROSS") for t in todos))

    print("\nD. símbolo sem recorte em disco NÃO se disfarça de tick real")
    _, chunks_x, done_x, erro_x = await pedido("NAOEXISTE26", 1, 4000)
    fonte = (done_x or (chunks_x[0] if chunks_x else {}) or {}).get("volumeSource")
    checa("cai no erro/M1 rotulado, nunca TICKS_REAIS",
          (erro_x is not None or fonte == ponte.VOLUME_SOURCE_M1)
          and fonte != ponte.VOLUME_SOURCE_TICKS_REAIS,
          f"volumeSource={fonte} erro={erro_x and erro_x.get('reason')}")

    print("\nE. pedido SEM resolução (o caminho real da tela) sai na resolução validada")
    # A tela não manda `resolucaoMs`: quem decide é a ponte, por contagem exata. Se este ponto
    # regredir, o replay passa a servir 2.000 ms achando que está em 1.000 -- e a fidelidade
    # publicada nos guias deixa de ser a fidelidade do que foi servido.
    _, chunks_auto, done_auto, _ = await pedido("WIN$N", 1)
    todos_auto = [t for c in chunks_auto for t in c["ticks"]]
    checa("resolução declarada == resolução validada por medida",
          done_auto and done_auto["resolucaoMs"] == rd.BUCKET_PADRAO_MS,
          str(done_auto and done_auto["resolucaoMs"]))
    checa("todos os chunks repetem a mesma resolução e a mesma fonte",
          all(c["resolucaoMs"] == rd.BUCKET_PADRAO_MS
              and c["volumeSource"] == ponte.VOLUME_SOURCE_TICKS_REAIS for c in chunks_auto),
          f"{len(chunks_auto)} chunk(s), {len(todos_auto):,} eventos")
    orcos_auto = {"BUY": sum(t["volume"] for t in todos_auto if t["aggressor"] == "BUY"),
                  "SELL": sum(t["volume"] for t in todos_auto if t["aggressor"] == "SELL")}
    checa("no automático o fluxo também é o da fita (nada perdido na decisão)",
          orcos_auto == esperado, f"compra {orcos_auto['BUY']:,} vs {esperado['BUY']:,} | "
          f"venda {orcos_auto['SELL']:,} vs {esperado['SELL']:,}")
    bytes_auto = len(todos_auto) * rd.BYTES_POR_EVENTO_MEDIDO
    checa("payload do automático cabe no orçamento do browser",
          bytes_auto <= rd.MAX_BYTES_POR_PEDIDO and len(todos_auto) <= rd.MAX_TICKS_POR_PEDIDO,
          f"{bytes_auto / 1048576:.1f} MB / {rd.MAX_BYTES_POR_PEDIDO / 1048576:.0f} MB "
          f"({len(todos_auto):,} eventos)")
    checa("ids do automático seguem únicos (série diferente, mesmo invariante)",
          len({t["id"] for t in todos_auto}) == len(todos_auto), f"{len(todos_auto):,} eventos")
    checa("na resolução validada a ponte AFIRMA que o replay julga estratégia",
          done_auto.get("validaEstrategia") is True
          and "FORA DA FAIXA" not in (done_auto.get("nota") or ""),
          f"alinhamento {done_auto.get('alinhamentoMedido')} | err Δ "
          f"{done_auto.get('erroDeltaMedido')} | sinais {done_auto.get('sinaisRecuperados')}")
    checa("os números publicados na nota vêm da tabela medida, não de chute",
          done_auto.get("alinhamentoMedido") == rd.FIDELIDADE_MEDIDA[1000]["alinhamento"]
          and done_auto.get("sinaisRecuperados") == rd.FIDELIDADE_MEDIDA[1000]["sinais"],
          str(done_auto.get("alinhamentoMedido")))

    print("\nF. resolução pedida que estoura o browser é PROMOVIDA e a troca vem declarada")
    # Pedir 100 ms num pregão inteiro são ~930k eventos = ~122 MB de JSON: a tela morreria antes de
    # montar o chart. O servidor não pode servir isso só porque foi pedido, nem servir outra coisa
    # em silêncio -- as duas pontas do honesto estão na promoção e na declaração.
    _, chunks_p, done_p, _ = await pedido("WIN$N", 1, 100)
    todos_p = [t for c in chunks_p for t in c["ticks"]]
    checa("100 ms promovido para o que cabe no orçamento",
          done_p["resolucaoMs"] > 100 and len(todos_p) <= rd.MAX_TICKS_POR_PEDIDO,
          f"servido {done_p['resolucaoMs']} ms, {len(todos_p):,} eventos")
    checa("a resolução PEDIDA sai no DONE e na nota",
          done_p.get("resolucaoPedidaMs") == 100
          and "Resolução PEDIDA 100 ms" in (done_p.get("nota") or ""),
          f"pedida={done_p.get('resolucaoPedidaMs')}")
    checa("mesmo promovida, a série continua sendo a fita do arquivo",
          sum(t["volume"] for t in todos_p if t["aggressor"] == "BUY") == esperado["BUY"]
          and sum(t["volume"] for t in todos_p if t["aggressor"] == "SELL") == esperado["SELL"],
          f"compra {sum(t['volume'] for t in todos_p if t['aggressor'] == 'BUY'):,} vs "
          f"{esperado['BUY']:,}")


    print("\nG. TRAVA de execução: o que ela segura e o que ela NUNCA pode segurar")
    # A trava existe para a sessão de validação não tocar na conta. Mas o invariante do projeto é
    # mais antigo que ela: saída encerra risco, então o operador precisa poder zerar até no meio de
    # um ensaio -- se alguém "simplificar" a trava para bloquear todo TRADE_ACTIONS, este teste grita.
    ambiente_antigo, modo_antigo = ponte.ORDERS_BLOCKED, ponte.REPLAY_MODE
    try:
        st = {"authenticated": True, "armed": True, "order_times": []}

        ponte.ORDERS_BLOCKED = False
        ponte.REPLAY_MODE = False
        lib, mot = ponte.check_trade_allowed(st, {"contracts": 1}, "ORDER_SEND")
        checa("sem trava alguma, entrada armada passa", lib, mot)

        ponte.REPLAY_MODE = True  # foi isto que o chip "Validação" da tela acendeu
        lib, mot = ponte.check_trade_allowed(st, {"contracts": 1}, "ORDER_SEND")
        checa("modo replay da tela segura a ENTRADA mesmo com o cliente armado", not lib, mot)
        checa("o motivo aponta o modo da tela, não a variável de ambiente",
              "MODO REPLAY" in mot and "ORDERS_BLOCKED=1" not in mot, mot)
        checa("a verdade única (usada pelo loop vivo e pelo status) vê o modo ligado",
              ponte.ordens_bloqueadas() is True)
        for saida in ("CLOSE_POSITIONS", "ORDER_PARTIAL_CLOSE", "ORDER_MODIFY_SL"):
            lib_s, mot_s = ponte.check_trade_allowed(st, {}, saida)
            checa(f"{saida} segue LIBERADA durante o ensaio (o botão de emergência)", lib_s, mot_s)

        ponte.REPLAY_MODE = False
        ponte.ORDERS_BLOCKED = True  # a variável definida no PC do terminal
        lib, mot = ponte.check_trade_allowed(st, {"contracts": 1}, "ORDER_SEND")
        checa("trava de ambiente segura a ENTRADA", not lib and "ORDERS_BLOCKED=1" in mot, mot)
        checa("desligar o modo pela tela não derruba a trava de ambiente",
              ponte.ordens_bloqueadas() is True)
        lib_s, mot_s = ponte.check_trade_allowed(st, {}, "CLOSE_POSITIONS")
        checa("nem a trava de ambiente prende a zeragem da conta", lib_s, mot_s)
    finally:
        ponte.ORDERS_BLOCKED, ponte.REPLAY_MODE = ambiente_antigo, modo_antigo
        checa("a conferação não deixa trava ligada para os próximos testes",
              ponte.ordens_bloqueadas() == bool(ambiente_antigo or modo_antigo))


if __name__ == "__main__":
    asyncio.run(principal())
    print("\n" + ("TUDO VERDE" if not FALHAS else f"FALHAS: {FALHAS}"))
    sys.exit(1 if FALHAS else 0)
