# RoboFluxoB3 — instruções do projeto

Robô Renko de fluxo para B3 (WIN/WDO/BIT): ponte WebSocket + motor de decisão em Python
que conversa com uma interface React/Vite. Este arquivo é a fonte única para qualquer
agente que trabalhe neste repositório.

## 1. Onde fica cada coisa

Duas árvores git **no mesmo disco**, apontando para o mesmo GitHub:

| Caminho | Remoto / branch | Conteúdo |
|---|---|---|
| `C:\Users\Lucas\Documents\RoboFluxoB3` | `Mac101068/Marcos-Adriano-de-Camargo` · `backend-python` | robôs, scripts, fita, docs |
| `...\RoboFluxoB3\interface_github` | mesmo remoto · `main` | interface React/Vite |

`interface_github/` está no `.gitignore` da raiz (linha 44): **um commit no backend nunca
leva a interface junto, e vice-versa**. Mudou os dois lados? São dois commits, um em cada repo.

Arquivos centrais:

- `bot_mt5_ciclo15.py` — ponte WebSocket **e** motor. Fica tudo aqui.
- `auditar_pregao.py` — leitura da trilha (`ordens_*_<dia>.csv`) e PnL por magic.
- `test_paridade_regras.py` — paridade das regras (47 asserts; tem que fechar 0 falhas).
- `test_diario_eventos.py` — diário de eventos com stubs de MT5.
- `avaliar_filtro_fluxo.py`, `medir_filtro_replay.py` — medições em fita real.
- `_reiniciar_ponte.ps1` — lançador da ponte (é o único jeito seguro de subir).
- `data/pregoes/*.csv.gz` — fita de replay (46 arquivos, WIN/WDO/BIT, ~22 dias úteis).

## 2. Segurança — não negociável

- Conta alvo é **DEMO** `50534540 (XPMT5-DEMO)`. Nenhuma ordem real, jamais.
- `bot_mt5_ciclo15.py` linha 509: `ORDERS_BLOCKED` tem default **`"0"`** no código.
  Quem trava é o lançador `_reiniciar_ponte.ps1` (linha 12: `$env:ORDERS_BLOCKED = '1'`).
  **Nunca suba o bot na mão** (`python bot_mt5_ciclo15.py`) — sempre pelo lançador.
- `REPLAY_MODE` também trava a execução (linha 522): replay nunca manda ordem.
- Magics em uso, não reuse nem renumere:
  `102030` robô principal · `999999` boleta manual · `100001` RoboCompra · `100002` RoboVenda.
- Não baixe ticks novos sem pedido explícito (~170 MB/mês). A fita já basta.

## 3. Regras do motor (não mude sem medir)

- Janela de pregão: `START_TIME = "08:55"`, `STOP_ENTRIES_TIME = "17:30"`,
  `CLOSE_ALL_TIME = "17:30"` (linhas 431/433/435).
- `MAX_DELTA_CEILING = 3200` (teto anti-clímax, linha 349) e
  `PYRAMID_STATIC_FLOOR = 300` (piso WIN, linha 334).
- Filtro de tendência do fluxo: `EVAL_CONFIG["flow_trend_filter"] = True`,
  `flow_trend_lookback = 20` (linhas 373-374), função `flow_trend()` (1101),
  gate em `check_convergence` (1483). A tela espelha isso em
  `interface_github/src/utils/convergenceEvaluator.ts`.
- Constante do motor e reflexo na tela têm que andar juntos. Alterou uma, altere a outra
  e rode `test_paridade_regras.py`.

## 4. Verificação mínima por tipo de mudança

Use **sempre o venv do projeto**. O `python` do PATH é o 3.12 do sistema, sem `websockets`,
e morre em `bot_mt5_ciclo15.py:99` com `ModuleNotFoundError` — isso é ambiente, não código.

```bash
# motor / regras
venv/Scripts/python.exe test_paridade_regras.py
venv/Scripts/python.exe test_diario_eventos.py
venv/Scripts/python.exe -m py_compile bot_mt5_ciclo15.py

# interface
cd interface_github && npx tsc --noEmit
```

A máquina é lenta: comando Python/tsc pode levar minutos. Rode em background com log
(`... > _tmp.log 2>&1; echo EXIT=$? >> _tmp.log`) e vá conferindo, em vez de esperar no
foreground. Antes de medir, confira a janela (`--inicio 08:55 --fim 18:00`).

### Saída esperada (medida em 16/11/2026, sobre o HEAD)

| Comando | Saída | Situação |
|---|---|---|
| `test_paridade_regras.py` | 47 ✅ / 0 ❌ — `EXIT=0` | verde |
| `test_diario_eventos.py` | 46 `[OK]`, 0 falhas — `EXIT=0` | verde |
| `py_compile bot_mt5_ciclo15.py` | sem saída — `EXIT=0` | verde |
| `npx tsc --noEmit` | sem saída — `EXIT=0` | verde |

Qualquer coisa diferente disso é regressão. A suspeita nº 1 não é a regra: é o **arquivo em
disco estar mais velho que o HEAD**. Em 16/11/2026 o `bot_mt5_ciclo15.py` local estava assim
(63+/97− contra o commitado) e a paridade acusou exatamente estas 5 falhas, nas seções A, C e G:

1. `WIN UP Δ 299` passando como BUY (piso do ativo não barra 1 ponto abaixo de 300);
2. `WIN UP Δ 3300` passando como BUY (teto anti-clímax de 3200 não barra);
3. `WDO UP Δ 90` (base 30) passando como BUY (piso estático da pirâmide não sobe para 300);
4. SYNC com `adaptive=False` mantendo o adaptativo ligado;
5. SYNC mandando `min_delta[WINZ26]=250` e o motor ficando em 250, abaixo do piso de 300.

Esse conjunto = arquivo velho, não bug novo: a versão antiga não tem `asset_floor`,
`pyramid_floor`/`req_buy`, o anti-clímax e o piso no SYNC. Antes de mexer no motor, rode
`git diff bot_mt5_ciclo15.py` e compare com `git show HEAD:bot_mt5_ciclo15.py`.

## 5. Convenções de git

- **Commit só sob pedido explícito.** Nunca `push`, `reset`, `squash` ou `force` por conta própria.
- Mensagem no estilo do repo: `tipo(escopo): resumo em ASCII` + corpo em português dizendo
  *por que*, e o rodapé `🤖 Generated with Codebuff` / `Co-Authored-By: Codebuff <noreply@codebuff.com>`.
- Não commitar segredos, `bridge_token.txt`, `__pycache__`, `node_modules`.

## 6. Escopo

Fazer exatamente o que foi pedido, completo, e nada além: sem refactor de brinde, sem
feature extra, sem renomear arquivo por estética. Encontrou algo ruim fora do escopo?
Descreva no fim da resposta em vez de mudar.

## 7. Agentes disponíveis neste projeto

Cada papel é uma skill em `.agents/skills/` — carregue só a que o problema pede:

| Skill | Usar quando |
|---|---|
| `auditor-trilha` | conferir o que o pregão fez: deals, fills, PnL por magic, divergência saldo×trilha |
| `medicoes-replay` | medir hipótese em fita real antes de mexer no motor |
| `ponte-mt5` | subir/reiniciar ponte, sincronizar regras com a tela, ler o diário de eventos |
| `interface-react` | aba, painel, HUD, gráfico Renko, tipos e sync de config |
| `teste-robos-hedge-reais` | ensaiar os robôs direcionais 100001/100002 em replay, com isolamento de magic |

Regra de ouro entre agentes: cada um entrega o resultado com o comando que rodou e a
saída. "Acho que funciona" não vale como entrega.

## 8. Mais de uma ferramenta na mesma pasta

Isto já custou trabalho: em 16/11/2026, às 13:06, `bot_mt5_ciclo15.py` amanheceu com uma
versão antiga (63+/97−), sem piso de ativo, sem anti-clímax e com `ORDERS_BLOCKED`
fail-open. Nenhuma regra foi "quebrada" — um editor salvou por cima. Antes de acusar o
motor, conferir:

```bash
git status --short
git diff bot_mt5_ciclo15.py | head -40
```

Regras para não repetir:

1. **Uma ferramenta escrevendo por pasta por vez.** Com o Antigravity aberto no projeto, não
   peça edição a outro agente na mesma pasta — use cópia ou branch separado.
2. **`git status` no começo e no fim.** No começo para saber o que já estava alterado; no fim
   para provar que só o pedido mudou.
3. **Não usar "restaurar/desfazer" do editor em arquivo com mudança não commitada.**
4. **Uma sessão, uma tarefa**, e ao trocar de ferramenta dizer onde parou (arquivo + tarefa).
5. **Commit é o único salvamento que sobrevive.** Sem commit, o disco pode ser sobrescrito.
