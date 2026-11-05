# 🧬 Evoluções Detalhadas — Flow Quant MT5 (B3 WIN$)

> Registro cronológico e circunstanciado de todas as evoluções do terminal, com causa raiz,
> o que foi implementado, onde vive no código e como foi verificado.
> Este arquivo é o complemento "diário de obra" do `PROJECT_SUMMARY.md` (que é a visão de estado atual).

Legenda de status: ✅ entregue e verificada · ⚠️ entregue com limitação conhecida · 🧪 em observação

---

## 📆 Ciclo 16 — 05/11/2026 · O funil afrouxou por bench (A/B/D/Δ), o Renko parou de atrasar e a ponte passou a explicar a recusa

**Causa raiz (o gatilho do ciclo)**: o operador reportou que o robô **"não estava enviando ordens
automaticamente"**. A investigação headless (bench em `eaBaseReal`/`strategyLab`, 3 seeds) e o diagnóstico em
código mostraram que **não era um bug só** — três frentes apertavam o funil ao mesmo tempo (**filtro de
acumulação ER**, **corte adaptativo P60**, **piso Δ=150**), a **mãe ficava desprotegida** quando um TP de
pirâmide fechava, e — descoberto no caminho — **a ponte MT5 falhava em silêncio**: a ordem passava da trava de
risco, o `execute_market_order` retornava `(False, 0)` e **nada voltava para o app**, de modo que "não chega
nada no MT5" era impossível de diagnosticar pela tela.

### 16.1 ✅ Quatro alavancas nos defaults da Pirâmide + migração guardada + toast

- **A — mãe no breakeven** (`moveMainToBreakevenOnPyramidTp = true`): a cada TP de pirâmide executado, a
  posição-mãe sobe para o zero-a-zero. `mainBreakevenMigration.ts`.
- **B — filtro de acumulação OFF** (`consolidationFilterEnabled = false`): o ER herdado do Ciclo 15
  sobre-filtrava e silenciava scalps vencedores. `consolidationFilterMigration.ts`.
- **D — limiar adaptativo OFF** (`adaptiveThresholdEnabled = false`): o corte P60 sufocava sinais ao vivo
  (chip **"SINAL FRACO"**) e inflava o drawdown. `adaptiveThresholdMigration.ts`.
- **Δ — piso 150→100** (`minDeltaThreshold = 100`, no **default e** no **preset Pirâmide**). Mais ordens e
  maior fator no bench. `deltaThresholdMigration.ts`.
- **Por que migração, não só default**: `loadSavedConfig` faz `{...DEFAULT, ...salvo}` — o valor **gravado
  vence o default**, então trocar o default não alcança quem já salvou. Cada migração é **idempotente** (flag
  de feito no `localStorage`) e **conservadora** (só toca a preset **PYRAMID** ainda com o
  valor-intocado-de-default-antigo; quem mexeu manualmente não é tocado). O boot roda as 4 e cada uma que
  alterou algo dispara um **toast**.
- `convergenceEvaluator.ts` passou a ler `SESSION_PERCENTILE = config.adaptiveThresholdPercentile ?? 0.6`
  (campo novo **opcional** em `types/trading.ts`); sem adaptativo, o gate é `Math.max(50, minDeltaThreshold)`.
- **Onde**: `src/services/eaConfigService.ts`, `src/types/trading.ts`, `src/utils/convergenceEvaluator.ts`,
  `src/utils/{mainBreakeven,consolidationFilter,adaptiveThreshold,deltaThreshold}Migration.ts`, `src/App.tsx`.
- **Bench 3 seeds**: A+B expectativa **R$1,98 → 5,44/tr**, PF **1,17 → 1,68**, DD **680 → 544**; adaptativo
  OFF@Δ150 derruba o DD ~30% com mais ordens e PF igual/melhor; Δ100 domina (PF **1,71 → 1,90**).

### 16.2 ✅ Renko sem atraso e sem gaps: um tick fecha TODOS os boxes (`renkoCalculator.ts`)

- **Causa**: fechar **no máximo um box por tick** fazia a coluna **atrasar** o preço e **abrir gaps** quando um
  tick varria vários níveis (cascata real, ou agressão no sintético calibrado).
- **Implementado**: `processTick` ganhou um **laço de preenchimento** (cap 1000) que fecha todos os boxes que o
  preço cobriu, na ordem, e devolve **`closedBoxes[]`** (+ `closedBox` "de cara" para retrocompatibilidade).
  `App.tsx` e `scripts/strategyLab.ts` iteram `closedBoxes`, dando a **cada box o sinal do próprio box** —
  nunca o "último sinal" do tick.

### 16.3 ✅ A ponte deixa de ser muda: `ORDER_RESULT` com o motivo real (`pythonScriptGenerator.ts` + `App.tsx`)

- **Causa-raiz do "não chega nada no MT5"**: `execute_market_order` tinha caminhos de **falha silenciosa** —
  `check_schedule` (janela de horário **compilada no `.py`**), `symbol_info`/`symbol_info_tick` nulos, e
  `order_send` com RetCode de recusa — todos retornando `(False, 0)` **sem mensagem de volta**. O app só tratava
  `RISK_REJECT`, nunca o motivo da execução.
- **Implementado**: global `ORDER_EXEC_NOTE` grava o motivo em cada ramo; o **router devolve
  `ORDER_RESULT {ok, ticket, reason, comment}`** após cada ordem; `App.tsx` trata `ORDER_RESULT` e mostra
  **toast** (✅ executada / ⛔ recusada + motivo legível). Motivos: fora da janela de horários do `.py`,
  símbolo fora do Market Watch, sem cotação agora, **RetCode** (ex. 10027/10004 = sem Algo Trading).
- **Consequência prática**: ao mudar horário/Δ/adaptativo, é preciso **re-baixar e rodar o `.py`** — a janela de
  horários e os parâmetros vão gravados no script.

### 16.4 ✅ Veredito da base real (`scripts/eaBaseReal.ts` → `vereditoBase`)

- A base baixada pela ponte chega como **`M1_RATE`** (proxy de preço OHLC), **não Time & Trades genuíno** →
  **não-calibrável** para limiares de fluxo. Fica registrado: calibrar P60/Δ no real exige **T&T real**.

### Verificação do Ciclo 16

- ✅ `npx tsc --noEmit` limpo · ✅ `npx vite build` OK · ✅ asserts das migrações (idempotentes e
  conservadoras) · ✅ `.py` gerado passa em `python -m py_compile` (scripts temporários apagados depois).
- ⚠️ **Nada foi conferido em tela nem na demo XP.**
- 🎯 **Bloqueio atual (fora do código)**: a ponte **MT5↔corretora não está conectando**; o operador vai
  resolver no lado dele. Ao voltar: **re-baixar o `.py` novo** (Δ100 + adaptativo OFF + `ORDER_RESULT`) e
  clicar comprar/vender para **ler o toast do motivo**.

---

## 📆 Ciclo 15 — 04/11/2026 · O fluxo parou de atrasar e virou filtro de métricas; nasce o Livro de Rodadas

**Causa raiz / diagnóstico**. Dois incômodos do operador: (a) o indicador de fluxo — Heikin-Ashi desenhado a
partir do Time & Trades sobre o CVD — **parecia sempre atrasado**; (b) as perdas se concentravam em **regiões
de acumulação com range curto**, onde o serrote batia vários stops. A leitura: o atraso é **intrínseco à
transformada** (Heikin-Ashi é dupla média, e o CVD é acumulado — nada é bug), e o painel era **só visual** (o
robô entra por direção + limiar de delta, não pelo estado HA). Decisão: fazer o visual **liderar** e depois
promover essa leitura a **filtro nas métricas do EA** — nas palavras dele, "o visual nós adaptamos, mas as
métricas do EA não".

**O que foi implementado** (commit `d5d5a02`, 9 arquivos, 1048+/49−):

1. **Indicador de fluxo sem atraso** (`RenkoFlowChart.tsx`): a **cor** do candle Heikin-Ashi passou a ser
   governada pelo **delta real do box** contra `minDeltaThreshold * (b.regimeFactor ?? 1)` — **a mesma porta
   do histograma do robô** — e a **forma** HA virou apenas contexto. Como o painel é visual, mudar a cor não
   toca nas ordens. **Cinza = reversão E exaustão**: uma caixa no **mesmo lado** da anterior mas **perdendo
   força** (`|Δ| ≤ |Δ_prev| · EXHAUST_DECAY_RATIO`, padrão **0.7**) também vira `REVERSAL`; o botão único
   `EXHAUST_DECAY_RATIO` calibra a sensibilidade (baixo = só exaustão severa). O HUD (`activeBoxHaState`)
   espelha exatamente a mesma regra.
2. **Filtro de Acumulação (F2) no EA** (`convergenceEvaluator.ts` + `types/trading.ts` + `eaConfigService.ts`
   + `AutomationPanel.tsx` + `StrategyStudio.tsx`): entra como **porta de sinal no funil único**
   `evaluateBoxConvergence`, consumido igualmente por **robô real** (`RenkoFlowEngine.checkClosedBox`),
   **Sombra** (`shadowRobotService.processClosedBox`) e **Coletor** (`paperStrategyBot.onClosedBox`) — uma
   mudança só, três automações. `efficiencyRatio()` (Kaufman: |deslocamento líquido| / Σ|passo| sobre as
   últimas `consolidationLookbackBoxes`=10 closes; abaixo de `consolidationErMax`=0.30 = acumulação; **warm-up
   retorna 1 e nunca bloqueia**, mesma filosofia do limiar adaptativo) + `isExhaustedFlow()` (o gate de
   exaustão), combinados em `regimeBlock` e aplicados nos ramos PYRAMID UP/DOWN e no BUY/SELL clássico. É
   **adimensional**, coerente com a regra "threshold é calculado, não número físico". **5 chaves novas com
   default OFF** (opt-in — nenhuma ordem muda até o operador ligar); propagam-se sozinhas à `SavedStrategy`
   (`mergeConfig = {...DEFAULT, ...patch}` + `splitStrategyPatch`). UI: Ajustes → Gatilho de Disparo → bloco
   **"Filtro de Acumulação"** (2 checkboxes + sliders de janela/ER/razão), com resumo na linha colapsável e
   no retrato do Estúdio ("· anti-acumulação").
3. **Livro de Rodadas** (`roundAuditService.ts` **novo** + `App.tsx` + `SimulatorView.tsx`): auditoria
   **persistente por corrida** integrando as três automações (contagens, book, shadow, collector + linha do
   tempo de ações). Após **revisão de código** (subagente único), ganhou robustez: **dois relógios separados**
   (`RoundAction.clock = 'wall' | 'bar'`, ordenação **agrupada por relógio** — parede primeiro, barra depois,
   nunca uma serial misturando os dois, pois ordens reais usam `Date.now` e PaperTrades usam `box.timeEnd`);
   **`liveMix`** (MT5 CONNECTED durante replay não contamina o snapshot de sombra/coletor — a rodada é marcada
   e um **banner** avisa); **parse defensivo** do `localStorage` (filtra registros malformados); legenda
   honesta do **CSV** (primeiras 500 linhas quando o cap bate) e tooltip do **Livro real** (só posições
   ABERTAS nesta corrida).

**Textos defasados corrigidos**: a UI ainda dizia que o replay **"dispara sozinho na abertura"** — contradição
direta com a regra do Ciclo 12 ("terminal acorda parado e vazio"). Corrigido em `SimulatorView.tsx` e em duas
regiões de `App.tsx` (comentário JSX + tooltip `title`); o comentário **histórico** em `App.tsx:3040`, que
narra um boot-replay **já removido**, foi mantido de propósito (descreve o passado com precisão).

**Verificação**. `npx tsc --noEmit` limpo · `npx vite build` OK (2,79 s) · **asserts headless do Livro 5/5** e
**bench A/B do Filtro 6/6** (scripts temporários `scripts/_*.ts` rodados contra os módulos reais e apagados
depois). Bench do filtro em três pregões sintéticos: **SERRADO 60 entradas / 59 flips / PnL −590 → 9 / 8 /
−90** (cortou ~86% do serrote); **TENDÊNCIA** e **TENDÊNCIA+PULLBACK** ficaram **idênticos** ligado/desligado
(sem falso positivo, sem cortar movimento bom). ⚠️ **Limitação conhecida**: os defaults (ER 0.30, janela 10,
razão 0.7) vieram de **dado sintético** — calibrar com pregões reais; e **nada foi conferido em tela nem na
demo XP**.

---

## 📆 Ciclo 14 — 03/11/2026 · Fase A: estratégia como banco de dados único, um só editor, telas em lista e a régua X dentro do gráfico

Ciclo de **arquitetura + leitura**, aberto por uma reclamação do operador: "as alterações foram técnicas,
o visual não aconteceu — queria uma lógica mais coerente para programar e acessar as estratégias". O
problema real era haver **dois lugares para guardar a mesma coisa** (a biblioteca do Estúdio e o config
do EA) e **dois editores** (rascunho do Estúdio e Parâmetros). Nada aqui muda matemática de sinal, ponte
ou portões.

### 14.1 ✅ Config ativo virou **visão materializada** da estratégia (`strategyLibraryService.ts`, `types/trading.ts`, `eaConfigService.ts`)

`SavedStrategy` (`fluxo_strategy_library_v1`) é agora a fonte autoritativa de **todos os campos de
estratégia**; `fluxo_renko_ea_config_v3` é derivado. Mecanismo: conjunto `RUNTIME_KEYS` = `active`,
`dataSourceMode`, `mt5Host`, `mt5Port`, `shadowRobot`, `lastSavedTimestamp`, `strategyId` — esses vivem
só no config; todo o resto pertence à estratégia. `splitStrategyPatch(patch)` separa um patch nos dois
sacos, `pickRuntime`/`mergeConfig` remontam, `resolveOperational(strategy, baseConfig)` é o **único
funil que produz config ativo** (`{...strategy.config, ...runtime, strategyId}`), `ensureActiveStrategy`
garante que todo config tenha estratégia por trás (por `strategyId` → por `profileName` → semeia
"Estratégia ativa") e `updateStrategyConfig` escreve na biblioteca sem nunca deixar runtime vazar.
`strategyId: string | null` entrou no `AutomationConfig` e é preservado em load/merge/import (sem isso o
spread do DEFAULT apagava o vínculo). **Fase A verificada com 18 asserts headless** (script temporário
com polyfill de `localStorage`, apagado após rodar): separação runtime↔estratégia, semente idempotente,
migração de config antigo, F5 e ausência de leak.

### 14.2 ✅ Funil único de escrita e de pacote (`App.tsx`)

`patchActiveStrategy` é o **único** caminho de escrita: boleta, cada campo dos Parâmetros (via prop
`onPatchStrategy`) e a documentação passam por ele → `updateStrategyConfig` na biblioteca →
`resolveOperational` devolve o config. `handleApplyConfigBundle(cfg, name)` trata **pacote inteiro**:
aplicar perfil 1-clique, restaurar padrões e importar JSON fazem upsert por **nome** (atualiza a
homônima, senão cria) e ativam pelo funil de sempre, com `active: false` — a estratégia que estava em
uso **não é destruída**, continua no Estúdio.

### 14.3 ✅ Bug corrigido de brinde: **aplicar perfil / restaurar / importar ligavam o robô**

`DEFAULT_EA_CONFIG.active === true`, e os três caminhos espalhavam esse objeto no config ativo — bastava
tocar num perfil para o EA entrar em operação, contra a regra do terminal que acorda parado. Agora todos
forçam `active: false` e persistem assim (inclusive no caminho de compatibilidade sem a prop). O modal de
restauração também estava **mentindo**: prometia "Pullback na abertura, Parcial +50, SL 100, TP 150", mas
a fábrica entrega Pirâmide & Confluência sem SL/TP fixos; reescrito com os números reais e com a nova
semântica (cria/ativa "Padrão de Fábrica (Pirâmide 10R)").

### 14.4 ✅ Um único editor: Estúdio gerencia, Parâmetros edita (`StrategyStudio.tsx`, `Header.tsx`)

O editor de rascunho do Estúdio foi **removido** (852 → ~620 linhas), eliminando a duplicação com a tela
de Parâmetros. O Estúdio ficou como a casa da biblioteca: criar (modal de nome), renomear, duplicar,
ativar, excluir, importar, sincronizar e o **retrato somente-leitura** da estratégia escolhida. A ativação
passou a comparar por **id** (nome só como fallback) e o card ativo mostra `AO VIVO` + "Rodando no Robô
1" em vez do botão Ativar. No header, **selo da estratégia ativa** (Zona 1, visível no desktop e no
celular, sem breakpoint): palette + "EA" + nome + `#id` curto + ponto **verde AO VIVO / âmbar SOLTO**,
clique abre o Estúdio; a tira de status passou a dizer **"Trocar:"** e resolve a opção por `strategyId`.

### 14.5 ✅ Telas em **lista colapsável** (`CollapsibleSection.tsx`, novo)

Reclamação: "com os quadros fica muita informação na tela". Micropadrão compartilhado: linha com ícone +
título + **resumo de uma linha dos valores atuais** + chip + chevron; os campos só existem no DOM quando
aberto, um grupo abaixo do outro. **Parâmetros** perdeu a grade `lg:grid-cols-3` (três quadros sempre
abertos) por uma coluna única com blocos 1, 1.5 (Robô 2), 2, 3, 4, Pirâmide, 5, 6, simulador e os **5
perfis rápidos em `PresetRow`** (continua 1-clique; descrição virou tooltip; lixeira preservada).
**Estúdio** usa o mesmo formato no retrato (Núcleo, Fluxo, Entrada, Gestão, Janela, Execução). Limitação
do HTML descoberta e tratada: o gatilho é um `<button>`, então o checkbox da janela de horários e os
botões de velocidade do simulador **desceram para o corpo** do grupo.

### 14.6 ✅ Régua de tempo **dentro do painel de preço** (`RenkoFlowChart.tsx`)

"Inverta: deixe o indicador livre e a escala no gráfico." A faixa de 24 px que o Ciclo 13 tinha posto no
vão entre os painéis (roubando 28 px do indicador) passou a viver **no rodapé do painel de preço**, colada
acima do divisor: `TIME_AXIS_BAND_H` 24 → **22**, `TIME_AXIS_BASELINE` 17 → **8** (medido para cima),
`priceBottomMargin` 16 → 22. O painel de fluxo agora começa no divisor com folga `FLOW_TOP_PAD = 16` só
para a etiqueta — Heikin-Ashi/histograma ganharam altura e o divisor interno (`histDividerY`) foi
recalculado na mesma conta do hit-testing. **O gesto acompanhou o número**: arrastar na faixa da régua
(zoom/rolagem do eixo X), duplo clique (reset horizontal) e cursor `ew-resize` agora ficam acima do
divisor; a tolerância do divisor (±5) segue vencendo, então agarrar rente à linha ainda move o painel.

### Verificação do Ciclo 14

`npx tsc --noEmit` limpo · `npx vite build` OK (2,5–3,0 s) · **18/18 asserts headless da Fase A**
(seed idempotente, patch dividido sem leak de runtime, materialização preservando conexão, import/sync
por id). **Nada ainda conferido em tela**: selo após ativar, boleta escrevendo na biblioteca, F5
mantendo o vínculo, sync entre navegadores com `strategyId`, acordeão no Android e o novo arrasto do
eixo X. Pendência assumida e registrada: "Salvar como Perfil do Operador" ainda grava no depósito antigo
de presets (aplicar já vai para o banco).

---

## 📆 Ciclo 13 — 02/11/2026 · Refino de leitura: régua X no divisor, ZERAR agrupado, sombra acorda zerada e ▲C/▼V em todos os navegadores

Ciclo de **conferência visual e semântica** pedido de dentro da tela, não por bug novo — cada ponto
nasceu de um incômodo do operador ao usar o terminal no dia-a-dia. Nada mexe na matemática de sinal,
na ponte ou nos portões; só rearranja onde a informação aparece e o que a Sombra guarda entre sessões.

### 13.1 ✅ Régua de tempo do eixo X no divisor Renko ↔ Heikin-Ashi (`RenkoFlowChart.tsx`)

A escala de horários vivia no rodapé do canvas (em `height - 14`) e ficava longe dos dois painéis.
Agora mora numa **faixa de 24 px entre o fim do painel de preço e o começo do painel de fluxo** — o
operador lê o horário logo acima do candle Heikin-Ashi correspondente. Constantes novas:
`TIME_AXIS_BAND_H = 24`, `TIME_AXIS_BASELINE = 17` (y do texto, medido a partir do divisor). O layout
empurrou `flowTopMargin` de `pricePaneHeight + 12` para `pricePaneHeight + TIME_AXIS_BAND_H + 4`, e
o `getFlowDividerLayout` passou a descontar a faixa no cálculo do `usableFlowH`. Tolerância dos
divisores apertada de 8 → 5 px para a faixa nova continuar clicável (arrastar o X com o mouse ainda
funciona); `handleMouseDown`, `handleDoubleClick` e `getCursorClass` deixaram de tratar
`canvasH - 24` e agora usam a banda da própria régua. Rótulo `FLUXO` reancorado em
`pricePaneHeight + TIME_AXIS_BAND_H + 4`.

> ↩ **Atualizado no Ciclo 14 (14.6)**: a faixa saiu do vão entre os painéis e passou para **dentro do
> painel de preço**, colada acima do divisor — `TIME_AXIS_BAND_H = 22`, `TIME_AXIS_BASELINE = 8`
> (medido para cima) e `FLOW_TOP_PAD = 16` no topo do fluxo. O indicador voltou a ser dono da janela.

### 13.2 ✅ ZERAR TUDO agrupado com ZERAR C / ZERAR V (`BoletaTicket.tsx`)

O botão ZERAR TUDO estava no fim da boleta, depois do livro de hedge, fora do contexto dos dois
botões por lado. Reorganizado em **um só bloco de três botões** logo abaixo da linha COMPRA/VENDA:
ZERAR C e ZERAR V lado a lado (`grid-cols-2`), ZERAR TUDO ocupando as duas colunas embaixo
(`col-span-2`). Bordas condicionais ajustadas: quando não há hedge nem botões por lado visíveis, o
bloco inteiro ganha `pt-1.5 border-t` para não encostar no seletor de lado; quando o livro de hedge
vem depois, ele continua sendo a última camada — ações primeiro, referência depois.

### 13.3 ✅ Sombra (Robô 2) acorda zerada como a boleta (`App.tsx`)

Bug relatado: *"ele soma os vários replays feitos"*. Causa raiz em duas camadas: (a) `resetBook` só
era chamado **depois** do `await resolveReplayTicks` — no intervalo/aborto, o painel ainda mostrava
as somas do replay anterior; (b) no F5, `ensureLoaded` do service hidrata o **livro do dia** do
localStorage (`fluxo_shadow_robot_v1` persiste `data.book`), então a sombra acordava com todas as
trades acumuladas desde a meia-noite enquanto a boleta acordava vazia. Correções: (i) `resetBook()`
no **boot effect** do App — sombra acorda zerada, igual à boleta; (ii) `resetBook()` **junto com o
clique** do replay (ao lado do `setOrders([])` da boleta), não mais só dentro do bloco assíncrono;
(iii) dentro do `await` só ficam `beginBatch/endBatch` — o livro já foi zerado no clique. Escolhas
continuam persistindo entre sessões (ligada, estratégia, escala, ativo); só a **contabilidade**
acorda zerada. Se um dia o operador quiser manter dias com `hadRealData` (ticks reais da corretora)
no F5, a flag já mora no storage e dá para tratar como exceção. **Decisão registrada em memória de
projeto** (`ee56b070`): "terminal acordando parado e vazio" agora vale também para a Sombra.

### 13.4 ✅ Sinais ▲ C / ▼ V padronizados em todos os navegadores (`RenkoFlowChart.tsx`)

Dessincronismo visual relatado: no navegador que rodava só convergência, os sinais apareciam como
`▲ C` / `▼ V`; no navegador com Pirâmide & Confluência despachando ordem-mãe, aparecia `▲ MÃE` /
`▼ MÃE` sobre o tijolo e `MÃE C 1ct` na placa da linha de entrada. Não era bug entre navegadores —
era a MESMA codificação respondendo a estados diferentes (a etiqueta só mudava quando
`b.orderDispatched`). Como "mãe" é papel, não sinal, e poluía a tela, o gráfico padroniza: **a
palavra "MÃE" desaparece do canvas**. O `if (shouldDrawBuy)` e o `if (shouldDrawSell)` agora
escrevem sempre `▲ C` / `▼ V`, e a `side` da placa da linha passou de `'C'/'V'` para `'▲ C'/'▼ V'` —
ordem-mãe e ordem comum ficam idênticas na etiqueta, e o papel continua legível pelos prefixos
**P1/P2/RET** que só aparecem em pirâmide e reteste Limit. Log interno (App, auditoria, script
Python) mantém "ORDEM MÃE" — ali é semântica de gestão, não leitura visual.

### Verificação do Ciclo 13

`npx tsc --noEmit` limpo nas quatro entregas · `npx vite build` OK (2,36 s na última) · bancada
headless `_tmp_shadowZeroAssert.ts` (`npx tsx`) provou **REPLAY 1: 58 · REPLAY 2: 58 · pós-F5
(restauração do storage): 58 · pós-boot (resetBook no mount): 0 · escolha mantida = true**, com as
duas correções juntas (bot + clique). Conferência pendente no navegador: F5 da sombra após um replay
— o painel deve mostrar 0 trades e manter estratégia/escala escolhidas; a régua de tempo clicável
no divisor; os três ZERAR agrupados; ▲C/▼V nos dois navegadores.

---

## 📆 Ciclo 12 — 02/11/2026 · O terminal acorda parado, o limiar nasce do pregão e o relógio só vale para ordens reais

Ciclo da **confiança do operador na tela**: vários episódios de "robô ligado e nada acontece" sem
qualquer explicação. A auditoria revelou que o problema não era um só — eram três camadas
(boot que se auto-inaugurava, limiar físico que engolia o simulador e portão de horário que
bloqueava teste fora do pregão). O ciclo também entrega o pacote de sincronismo entre os dois
navegadores e a varredura de referências órfãs de estratégia.

### 12.1 ✅ Regra do operador: o terminal SEMPRE acorda parado e vazio (`App.tsx`)

Causa raiz: dois auto-runners de mount violavam a regra "só inicia com comando manual":
(a) o boot effect semeava **350 ticks sintéticos** (falsa "história", sorteada de novo a cada F5)
e `isSimulating` nascia `true`; (b) um segundo effect disparava **replay automático 400 ms após o
mount** — carimbava timestamps de sessão à frente do relógio de parede, zerava a boleta e deixava
o ▶ SIM aparentemente morto (`isReplaying` true) enquanto só a sombra operava. Nenhum dado de
gráfico persiste entre sessões (só ordens/auditoria/coletor/lastPrice/config/biblioteca) — o
"histórico do dia anterior" que a tela mostrava era invenção do boot, não memória.
Entregue: `isSimulating` nasce `false`; o boot effect só inicializa os motores no preço de
referência; os quatro caminhos de falha do MT5 que ligavam o SIM sozinhos foram limpos (só o bot
demo da Pirâmide ainda liga); o replay de abertura foi deletado com lápide no lugar. Brinde
necessário: **ligar o Robô (On) também liga o feed SIM** — "robô ON + mercado parado" era o novo
estado morto silencioso, agora impossível; e o balão `MERCADO PARADO` avisa se o robô estiver ON
sem feed (regra auditada em TODOS os effects de mount — memória de pitfall registrada).

### 12.2 ✅ Interruptor de regime dos portões de horário (`sessionRules.ts` + `tradingGates.ts` + `App.tsx`)

Regra do operador: *"esta janela só pode bloquear ordens reais; simulador tem que rodar"*. O
relógio do pregão (janela 08:55–17:30 + zeragem das 17:30) agora só fecha a porta em dois mundos:
**MT5 conectado** (ordens reais, igual ao script .py gerado) e **replay** (sessão simulada com hora
de barra — a janela e a zeragem fazem parte do pregão reproduzido). No **simulador ao vivo**
(relógio de parede) o portão fica aberto 24h — acabou o `FORA DA JANELA` às 18:22 no meio de um
teste. Implementação: `setEnforceTimeGates`/`areTimeGatesEnforced` em `sessionRules.ts`, consultados
por `isWithinTradingWindow` e `isSessionCloseLock`; o App vira a chave num effect sobre
`[isReplaying, mt5State.status]`; coletor e robôs sombra **herdam automaticamente** porque o
`paperStrategyBot` chama as mesmas funções puras. A migração de janela (08:55–17:30) e o
`PRIOR_WINDOWS` do `tradingWindowMigration.ts` continuam valendo para o mundo real/replay.

### 12.3 ✅ Limiar de sinal CALCULADO do pregão — P60 (`sessionRegime.ts` + `convergenceEvaluator.ts`)

Causa raiz do "robô ligado, feed andando, nenhuma ordem": o filtro "adaptativo" era
`minDeltaThreshold × fator` — uma **constante física** (100 ctros) maquiada; o simulador gera
1–250 ctros/tick, então boxes de Δ 20–120 quase nunca passavam. Agora, com
`adaptiveThresholdEnabled`, o limite efetivo é o **percentil P60 dos |Δ| do próprio lado (compra/
venda) nos últimos max(lookback,20) boxes fechados** (`getPercentileLimit`), com fallback honesto
para o regime multiplicativo no aquecimento (<10 boxes ou <5 Δs do lado). `minDeltaThreshold`
degrada a aquecimento/fallback (e vira o limiar físico quando o adaptativo está desligado). O
motivo do sinal impresso no trade ganhou `| limiar = P60 do pregão`. Bancada: sessão sintética com
Δs 10→200 deu P60=130 (não 100); box Δ5 barrado, box Δ180 sinalizou. Seletividade ajustável
(P50–P80) fica como próximo passo se o operador quiser.

### 12.4 ✅ Balão de alerta (`AlertChip.tsx`) e o laudo dos sinais (`gateReasons` no App)

O ⚠ do header agora abre um balão central com os motivos pelos quais nada abriu posição — e os
motivos novos do ciclo: `MERCADO PARADO`, `SÉRIE SEM ROBÔ` (gráfico em Tempo — as entradas só
disparam em Renko/Range), `RETESTE ESPERANDO CVD` e `SINAL FRACO HÁ N BOXES` com números reais
(Δ do último box vs limiar P60). Anti-pisca: o laudo de sinal só aparece em **jejum confirmado**
(≥5 dos últimos 6 boxes fechados sem convergência), porque julgar box a box fazia o triângulo
piscar a cada tijolo. Balão também herdado: avisos de ativação de estratégia e netting/teto hedge.

### 12.5 ✅ Sincronizar terminal — navegador interno ↔ externo (`StrategyStudio.tsx` + `mergeConfig`)

Cada navegador tem um cofre localStorage próprio (config, biblioteca, velocidade do SIM) — o
"dessincronismo" que o operador sentia. Entregue o pacote `fluxo_terminal_sync`: botões âmbar
**Exportar tudo / Importar tudo** gerem/leem um único JSON (versão, origem, `activeConfig` +
biblioteca inteira). Importação é **upsert por id** (nunca apaga nada local) e aplica o config com
`active: false` — o robô nunca acorda sozinho com um import; toast "Terminal sincronizado" avisa
das ordens abertas que não viajam junto.

### 12.6 ✅ Varredura de referências órfãs de estratégia (`App.tsx` + `ShadowRobotPanel.tsx` + modal do Estúdio)

Bug relatado: "apaguei a Reteste e ela continua fixada no Robô 2". O painel sombra guardava
`strategyId` morto (select ficava em branco silencioso; "Ligar" reinjetava o id órfão). Agora:
qualquer mudança na biblioteca dispara a varredura — sombra com estratégia removida perde o id e
**se desliga**; perfil ativo do Robô 1 órfão limpa `profileName`; toast explica. O painel mostra
`nome (removida)` em âmbar com option fantasma no select, e o modal de exclusão do Estúdio diz a
verdade sobre quem está rodando a estratégia (Robô 1 por nome, Robô 2 por id — prop
`shadowStrategyId`).

### 12.7 ✅ Brindes do mesmo ciclo (sessão anterior)

Ordens da **boleta manual** no modo Pirâmide passaram a respeitar Alvo/Stop digitados (em vez de
surfar cegamente a pirâmide), e o **Estúdio de Estratégias** ficou acessível: seletor de estratégia
sempre visível, avisos de bloqueio vindos da boleta e aviso ao ativar estratégia com posições
abertas.

### Verificação do Ciclo 12

`npx tsc --noEmit` limpo em todas as entregas · `npx vite build` OK (2,06 s na última UI) ·
asserts `robotMagicAssert` / `renkoBoxScaleAssert` / `chartContractAssert` passando ·
bancadas headless com `npx tsx -e`: portões de tempo nos 3 regimes (SIM 24h / REPLAY / REAL) e
P60=130 numa sessão sintética de Δs 10→200. Pendente de olhar humano: conferir em tela que a
boleta enche com o P60 dentro do pregão simulado e o balão sem piscar.

---

## 📆 Ciclo 11 — 02/11/2026 · Fase 2 do multi-robô: placa de magic por robô + R$/ponto por ativo

Ciclo das duas pendências de código deixadas pelo Ciclo 10: **(2) magic number por robô com filtro na
ponte** e **(3) `POINT_VALUE_BRL` soldado em R$0,20 (só WIN)**. O tema do ciclo é *identidade*: cada
ordem passa a carregar a placa de quem a mandou, e cada saída automática só toca posições da própria
placa — a boleta manual e o robô deixam de poder atropelar um ao outro no mesmo símbolo. A contabilidade
(em R$) passa a respeitar o tick-point do ativo, no script gerado e nos robôs de papel.

### 11.1 ✅ `types/trading.ts` — as placas vivem num lugar só

- `DEFAULT_MAGIC_NUMBER = 101010` (fallback do Robô 1 quando o config não tem magic),
  `MANUAL_ORDER_MAGIC = 999999` (placa da Boleta manual), `mainRobotMagic(config)` (lê
  `config.magicNumber` com fallback — substituiu as dispersas `config.magicNumber || 101010`), e
  `robotTagForMagic(magic)` para rótulos de auditoria/toasts ("Robô 1 · magic 102030",
  "Boleta manual", "sem magic").
- `MT5ConnectionState` ganhou `scriptRobotMagic?` e `scriptPointValue?` — o app agora sabe o que o
  script instalado na ponte realmente usa, e pode avisar quando divergir.

### 11.2 ✅ Script Python gerado — carimbo na entrada, filtro na saída, retrocompatibilidade

- **Entradas carimbam**: `execute_market_order`, `place_websocket_limit_order`,
  `close_partial_position` e `modify_stop_loss` aceitaram `magic=None`; o handler do WebSocket lê
  `data.get("magic")` e repassa. Sem o campo (app velho falando com script novo), cai na placa do
  robô — comportamento antigo preservado.
- **Saídas filtram**: `close_all_positions(side=None, magic="robot")` confere `pos.magic` antes de
  fechar; `execute_pyramid_confluence` e `watch_closed_pyramids` olham só as posições do robô. A
  semântica de `CLOSE_POSITIONS` ficou: payload **com** `robotMagic` (saídas do robô — inversão,
  trava financeira) fecha só aquela placa; payload **sem** (ZERAR C/V/TUDO da boleta) fecha tudo —
  botão de emergência do operador nunca pode ser filtrado. Documentado no docstring do script
  (item 4b).
- **R$/ponto por ativo**: `ASSET_POINT_VALUE` (gerado do registro: WIN 0,20 · WDO 0,10 · BTC 1,00)
  passou a ser usado de verdade no PnL impresso da zeragem, e `ACCOUNT_INFO` agora reporta
  `pointValue`, `robotMagic` e `manualMagic` ao app.
- **Bug histórico corrigido de brinde**: `MT5OrderManager(..., contracts=CONTRACTS)` referenciava uma
  constante que nunca existiu (NameError na importação — o motivo pelo qual a ponte nunca tinha
  rodado contra a corretora). Agora é `contracts=MAIN_CONTRACTS`.
- ⚠️ **Armadilha registrada**: o script inteiro é um template literal JS — backticks no texto gerado
  (ex.: `` `magic` `` num docstring Python) encerram o template e quebram o `tsc`. Citações dentro do
  texto gerado usam aspas simples.

### 11.3 ✅ `App.tsx` — dispatch com placa e aviso de divergência APP × SCRIPT

- Todos os 5 dispatches `ORDER_SEND` ganharam `magic`: caminhos do robô com
  `mainRobotMagic(config)`, os 2 da Boleta manual com `MANUAL_ORDER_MAGIC` (ordens locais também
  nascem com a placa). As saídas do robô (`CLOSE_POSITIONS` da inversão e das duas travas
  financeiras, `ORDER_PARTIAL_CLOSE`, `ORDER_MODIFY_SL`) enviam `robotMagic`; o ZERAR da boleta
  permanece sem filtro (emergência).
- `ACCOUNT_INFO` guarda `scriptRobotMagic`/`scriptPointValue` no estado da ponte e, se a placa do
  script instalado divergir da placa configurada no app, dispara toast central
  "⚠️ MAGIC DIVERGENTE (APP × SCRIPT)" — a tela não pode anunciar uma placa e carimbar outra.
- `AutomationPanel` explica a placa do Robô 1 (e que a boleta manual usa 999999 e nunca é tocada);
  `ShadowRobotPanel` registra no cabeçalho que a sombra **não tem magic de propósito** — ela é
  papel por estrutura, e a Fase 2 está pronta para quando uma sombra virar robô real.

### 11.4 ✅ R$/ponto por ativo nos robôs de papel

- `PaperStrategyBot` trocou o módulo-constante `POINT_VALUE_BRL` (WIN) por instância
  `assetId`/`pointValueBrl` com `setAsset(assetId)` / `getAssetId()`; `getUnrealized` e o fechamento
  contam em `this.pointValueBrl`.
- `seriesCollectorService.ingest` chama `setAsset(resolveAsset(config.symbol, config.assetId).id)`
  antes de alimentar os bots de cada escala; `shadowRobotService` chama `setAsset` no `configure`
  e na restauração do F5 (o ativo escolhido volta do storage junto com a corrida).

### 11.5 ✅ Verificação do ciclo

- Assert permanente novo: `scripts/robotMagicAssert.ts` — placas do app (fallback, magic 0 lixo,
  rótulos), conteúdo do script gerado (filtro `pos.magic`, ausência do `contracts=CONTRACTS`,
  `MANUAL_ORDER_MAGIC`, `robotMagic`/`pointValue` no `ACCOUNT_INFO`), `ASSET_POINT_VALUE` por ativo
  (WIN 0.2 × WDO 0.1), `pointsToBRL` determinístico e `setAsset` do robô de papel — 28 asserts.
- `npx tsc --noEmit` limpo · `npx vite build` OK (2,80 s) · `npx tsx` nos três asserts
  (`robotMagicAssert`, `renkoBoxScaleAssert`, `chartContractAssert`) todos passando ·
  `python3 -m py_compile` nos scripts gerados para WIN e WDO OK.
- 🧪 **Ficou para o navegador**: as três conferências herdadas do Ciclo 10 (replay espelhado, F5 da
  sombra com principal OFF, overflow do chip) + o toast de divergência de magic (conferir trocando o
  `magicNumber` do config sem baixar o script de novo).

---

## 📆 Ciclo 10 — 02/11/2026 · Robô 2 na sombra (escala própria 15R/20R/25R) e o pente-fino da escala

Dois trabalhos convivem neste ciclo. O principal é o **ROBÔ 2 (SOMBRA)**: um segundo robô em
**papel**, com estratégia da biblioteca, **escala Renko própria (15R/20R/25R)**, motor de barras,
CVD, medidor de regime, livro e curva de capital **próprios** — rodando ao vivo, no replay e com o
robô principal desligado, sem jamais tocar a corretora. O segundo é o **pente-fino herdado do
fix de escala**: os rótulos "10R" soldados em cards/títulos/auditoria/dossiê/script passaram a ler a
escala real do box via `renkoScaleLabel()`, a tira de controles trocou cinco chips de velocidade
por uma `MiniSelect`, e o gráfico passou a **abrir o contrato vigente** por padrão (migração).

### 10.1 ✅ `shadowRobotService.ts` — o runner do segundo robô, por construção sem caminho para ordem real

**Pedido do operador.** "Quero um segundo robô operando uma segunda estratégia em outra escala, na
sombra do primeiro, para comparar resultado sem arriscar dinheiro."

**Causa raiz / decisão de arquitetura.** O `PaperStrategyBot` já existia para os robôs sombra do
coletor, mas não havia **um robô com identidade própria, persistência própria e controles na tela**.
E havia um risco de projeto: se o segundo robô recebesse `setOrders` ou o socket da ponte, um bug
poderia despachar ordem real sem magic number próprio. A blindagem foi feita **por estrutura**,
**não por condição**: o service **não recebe socket, não recebe `setOrders`, não tem callback de
dispatch** — não existe caminho possível do código da sombra até a corretora.

**O que foi implementado** (`src/services/shadowRobotService.ts`, ~467 linhas):
- Ele possui um `PaperStrategyBot('shadow')` — o `BotKey = SeriesKey | 'shadow'` ampliou a identidade do
  robô de papel **sem quebrar** os `Record<SeriesKey, …>` do coletor (o `'shadow'` não entra nas
  seis séries dele).
- `configure(shadowRobot, asset, baseConfig)` resolve `(strategyId, scaleR, ativo)` → **config
efetiva**: copia a estratégia da biblioteca por cima do config base e deriva o box por
  `boxPointsForR(scaleR, asset)` = `clampRenkoR(scaleR) × tickSize` — em WIN, 20R = 100 pts; em
  WDO, 20R = 10 pts. A escala é guardada **em R**, não em pontos, para o relatório continuar
  comparável depois de trocar de ativo.
- `processClosedBox(box, prevBoxes, eff, meter)` usa o **mesmo** `evaluateBoxConvergence` do
  terminal — sombra e robô principal decidem sinal com a mesma matemática, nenhuma regra paralela.
- Persistência dia-a-dia em `fluxo_shadow_robot_v1` (rotação de dia, flag `real`, replay nunca
  apaga dia com dado verdadeiro — espelha a regra do Coletor). `beginBatch/endBatch` com
  `batchDepth` inibem persistência/notify por barra durante o replay (senão 4 mil boxes = 4 mil
  `setItem`). `markToMarket` com `isReal` marca o dia quando um tick da ponte alimentou a sombra.
- `resetBook()` limpa a contabilidade **sem apagar a corrida** (usado no replay, que precisa
  reprocessar o dia mantendo estratégia/escala); `reset()` zera tudo inclusive a escolha.
- `exportCsv()` no padrão BR (UTF-8 com BOM, `;`), `subscribe`/`getVersion` para
  `useSyncExternalStore` com snapshot cacheado por versão.

### 10.2 ✅ Wiring no `App.tsx` — o segundo motor de barras vivendo ao lado do primeiro

- `shadowEngineRef` + `ensureShadowEngine()` criam um `RenkoFlowEngine` **exclusivo** da sombra no
  box efetivo (`getBoxPoints()` novo getter em `renkoCalculator.ts` para conferir a escala); se a
  estratégia registra medidor de regime, ele é do engine da sombra (`registerRegimeMeter`).
- `feedShadowEngine(tick)` alimenta o engine e, a cada box fechado, chama `processClosedBox` com o
  CVD/boxes anteriores do **próprio** engine. É chamado em **três** sítios: no
  `handleIncomingTick` (ao vivo, depois do loop das escalas alternativas), no `ingestSilent` do
  replay, e no boot/reinicialização de dados.
- Efeito de `configure()` roda quando mudam `shadowRobot.{enabled,strategyId,scaleR}`, ativo ou
  biblioteca; se a estratégia ainda não existe, o service fica inativo com **warning** (o chip
  avisa em vez de operar no escuro).
- Guarda anti-âncora-velha: ligar a sombra com ticks fluindo e o engine parado há >90 s recria o
  engine no preço vivo (senão o primeiro box nasceria de uma âncora de horas atrás).
- Replay: `resetBook()` + `beginBatch()` antes do loop, `markToMarket(…, false)` +
  `feedShadowEngine(t)` por tick, `endBatch()` ao terminar — a sombra **opera o replay junto**,
  mesmo com o robô principal OFF.

### 10.3 ✅ Chip `+ Sombra` na tira de status e janela flutuante do livro

- Terceira linha do status do gráfico ganhou o chip: desligado mostra `+ Sombra` (clique abre o
  painel para escolher estratégia); ligado mostra `Sombra 20R · "nome"` + PnL colorido, e o
  hover/title traz escala em pts, ativo, trades W/L, win rate e rebaixamento — **o chip é atalho
  para os parâmetros de origem**, nunca um número solto.
- Janela flutuante (mesma `DadosPanelWindow` dos outros painéis, 246 px, arrastável, posição
  limitada ao pai) com `ShadowRobotPanel` dentro; aberta/fechada persiste em
  `fluxo_shadow_window_open_v1`.
- `ShadowRobotPanel.tsx` (duas variantes: janela flutuante e página) — identidade da corrida,
  warning quando inativa, métricas (Agora, Realizado, Posições, Trades/Win/Loss, Win Rate, PF,
  DD, Expectativa) e controles: Ligar/Desligar, dropdown de estratégia da biblioteca, botões de
  escala **15R / 20R / 25R**, exportar CSV, zerar.

### 10.4 ✅ Comparativo, Parâmetros e menu mobile

- **Comparativo** (`SeriesComparisonView.tsx`): seção nova **"Robô 2 (sombra)"** no fim dos grupos,
  com o painel + `ShadowEquityChart` (curva de capital própria), lida via
  `useSyncExternalStore(shadowRobotService…)`. Escala alternativa deixa de ser só número do
  coletor e passa a ter histórico de trades navegável.
- **Parâmetros** (`AutomationPanel.tsx`): BLOCO entre o robô principal e o resto — `Cpu` +
  `ShadowRobotPanel variant="page"`, com patch `onPatchConfig` escrevendo `config.shadowRobot`
  pelo mesmo `eaConfigService` de sempre (nada de storage paralelo).
- **Tipos e config** (`trading.ts` + `eaConfigService.ts`): `ShadowScaleR = 15|20|25`,
  `ShadowRobotConfig { enabled, strategyId, scaleR }`, campo opcional `shadowRobot?` no
  `AutomationConfig`; `DEFAULT_SHADOW_ROBOT` desligado em 20R; **`normalizeShadowRobot()`**
  sanitiza campo a campo no `loadSavedConfig` — config velho ou JSON corrompido cai no padrão,
  escala impossível (ex.: `7`) é rejeitada. Segue a regra dos merge sites: normalizar **na leitura**,
  não depender de migração uma-vez.
- **Mobile**: botão **"Robô 2"** no menu "Mais" do rodapé, mesmo destino do chip.

### 10.5 ✅ Pente-fino da escala e da tira (trabalho de refino que estava na mesa)

- **Rótulo de escala nunca soldado**: `RenkoBoxCard`, `OrdersAndStats`, `IntradayOrderAudit`,
  `ProjectDossierPdfModal`, `PythonScriptView` e o script Python gerado passaram a receber a
  escala via `renkoScaleLabel(config.boxPoints, asset)` ("Blocos 10R" → "Blocos {label}", título
  do script "RENKO 10R" → "RENKO {label}"). Um box de 8R não pode ser anunciado como 10R.
- **`MiniSelect.tsx`** (novo): velocidade do simulador (5 chips → 1 caixa `2x`) e dias do replay
  (`3d`) numa lista compacta com `aria-label` e título explicativo; escolher durante uma corrida
  que roda guarda para a próxima em vez de travar a caixa.
- **`chartContractMigration.ts`** (novo, flag `fluxo_chart_vigente_v1`): o gráfico abre o
  **contrato vigente** (`WINZ26`) por padrão; a série contínua (`WIN$N`) fica como símbolo interno
  do teste longo/histórico. A migração só reescreve `symbol` **exatamente igual** à contínua —
  vencimento digitado à mão é escolha deliberada e nunca é tocado; ativo sem vigente confirmado
  (WDO/BTC) fica intacto (não se inventa código). Config **e** biblioteca de estratégias migram.
- Asserts permanentes criados: `scripts/renkoBoxScaleAssert.ts` (escala do box × rótulo) e
  `scripts/chartContractAssert.ts` (regras da migração de contrato, inclusive os casos "não
  reescreve").

### 10.6 ✅ Verificação do ciclo (o que foi provado e o que ficou para o navegador)

- **Espelho sombra × coletor**: script temporário rodou o MESMO feed pela sombra (20R) e pelo
  coletor `renko20r` — **271 boxes / 269 trades idênticos, zero divergência**. Apagado depois da
  entrega (regra do projeto para asserts temporários).
- **Persistência**: teste com processo espelho do storage provou que 179 trades, R$ 3.970,
  metadados da corrida e `boxPoints` derivado sobrevivem a F5; e que `shadowRobot` ausente,
  parcial ou impossível normaliza para o padrão.
- **Troca de ativo**: WIN 20R = 100 pts → WDO 20R = 10 pts, escala rederivada pelo tick do ativo.
- `npx tsc --noEmit` limpo e `npx vite build` OK (2,22 s) na entrega; asserts permanentes
  (`renkoBoxScaleAssert`, `chartContractAssert`) passando.
- 🧪 **Não conferido no navegador** (ficou para o operador, com o dev server em pé): (1) ver o
  replay espelhado na tela com os dois robôs comparando lado a lado; (2) persistência da sombra
  com o robô principal OFF atravessando um F5; (3) overflow do chip na tira em celular.

---

## 📆 Ciclo 9 — 01/11/2026 · Refino visual: boleta em camadas, os dois códigos do ativo e marca d'água

Ciclo inteiramente da fase **REFINO VISUAL**: nenhuma regra de estratégia mudou. A boleta ganhou
hierarquia (título dourado, engrenagem dos ajustes colada na própria linha e sub-caixa **Parâmetros**
recolhível), o cabeçalho parou de ler como "nome duplicado" — série contínua e contrato vigente agora
aparecem como **dois códigos rotulados pelo papel de cada um** —, o gráfico passou a poder **assinar o
ativo** com uma marca d'água atrás dos tijolos (anexo opcional do operador) e as três faixas empilhadas
no topo (cabeçalho, tira de métricas, barra do gráfico) foram apertadas em duas rodadas para devolver
altura ao pregão.

### 9.1 ✅ Boleta dourada, engrenagem na linha da boleta e título do painel menor

**Pedido do operador.** "altere o titulo da boleta para dourado e ao lado do icone notificacoes cole a
engrenagem localizada no canto inferior direito, diminua a fonte do nome do painel, Flow Quant MT5" e,
na sequência, "na mesma linha da boleta, tem um sim que pode ser retirado".

**Causa raiz.** O ⚙ vivia solto no canto inferior direito do canvas, dentro da área do gráfico — além de
competir com os tijolos, contrariava a regra fixa do projeto ("nenhum quadro de informação no canto
inferior direito").

**O que foi implementado.**
- `BoletaTicket.tsx`: o título `Boleta` saiu de `text-zinc-500` e passou a **`text-amber-400`**, tanto na
  caixa expandida quanto no chip recolhido (âmbar = única cor do acento, chrome continua neutro).
- Novo par de props `chartToolsOpen` / `onToggleChartTools`. **O estado mora no `RenkoFlowChart`** (é ele
  quem abre o painel de exibição); a boleta só aperta o interruptor. Um dono só — não há como os dois
  lados da tela dessincronizarem.
- O botão ⚙ migrou do canto do gráfico para a **linha da boleta**, entre o título e o sininho de fixar.
  A leitura da linha passou a ser `Boleta · ⚙ · 📌 · ⌄`. O `Settings` foi removido do `RenkoFlowChart`
  (só o painel continua abrindo no canto inferior direito).
- **Recolhida, a engrenagem acompanha o chip** (`gearBtn`, 26×26, mesmo chrome translúcido do chip):
  controle primário do operador não pode ficar preso atrás do recolhimento automático de ~9s.
- **Selo `SIM`/`MT5` retirado da linha da boleta** por pedido explícito (a faixa ficou apertada com a
  engrenagem). O estado da ponte continua visível no botão de conexão do cabeçalho e nos `title` dos
  botões COMPRA/VENDA — o clique nunca fica ambíguo sobre ir ou não à corretora.
- Título do painel `Flow Quant MT5` reduzido de `text-sm sm:text-base` para **`text-xs sm:text-sm`**.
- Rodapé de ajuda do gráfico reescrito: "Ajustes no ⚙ da linha da Boleta (o painel abre no canto
  inferior direito) · arraste o gráfico para mover · réguas dão zoom Y/Fluxo · duplo clique auto-escala".

### 9.2 ✅ Sub-caixa "Parâmetros" dentro da boleta

**Pedido do operador.** "todos os dados iniciais viram uma caixa que podera ser expandida e recolhida,
igual a boleta; na linha do preco, que ja esta bem visivel na escala, vira o titulo desta caixa, que sera
`parametros` na cor branca, dentro desta caixa todos os dados antes dos botoes".

**O que foi implementado.**
- Envoltório `border-b border-zinc-800/80` com botão de cabeçalho em largura total: **`Parâmetros`** em
  `text-[9px] font-sans font-bold uppercase tracking-wider text-white` + chevron rotativo e
  `aria-expanded` (leitor de tela também enxerga o estado).
- Corpo `px-2 pb-1.5 space-y-0.5 font-mono` com os **seis steppers** da base (Contratos, Stop, Alvo,
  Parcial, Break even, Trailing) + a linha condicional de Risco em R$. Os botões de ação (COMPRA/VENDA,
  ZERAR C/V, livro de hedge, ZERAR TUDO) ficam **fora** da sub-caixa e continuam visíveis com ela fechada.
- **A linha `Preço` foi removida** da boleta: o preço já vive na escala do eixo Y e no chip recolhido —
  duplicá-lo dentro da caixa foi o que virou o próprio título da sub-caixa no pedido.
- Preferência persistida em **`fluxo_boleta_params_open_v1`**, lida com padrão "aberta" na primeira vez
  (`raw === null ? true : raw === 'true'`) e escrita dentro de `try/catch`.
- **Estado local, deliberadamente não controlado**: recolher Parâmetros muda só a **altura** da caixa; a
  **largura** — e portanto o recuo que o canvas reserva para ela (`BOLETA_GAP`) — não muda, então nada no
  gráfico precisa saber. É o oposto de `open` (boleta expandida/recolhida), que segue controlado pelo
  `RenkoFlowChart` justamente porque altera o desenho.

### 9.3 ✅ Série contínua × contrato vigente: os dois códigos desmembrados

**Causa raiz.** O chip do seletor empilhava `asset.id` (`WIN`) sobre `asset.primarySymbol` (`WIN$N`) e a
aba de baixo mostrava mais `WIN$N` de novo; na tira de status, um `Ativo: WIN$N` solto. A leitura do
operador foi literalmente "ficou estranho a duplo nome". Não era nome duplicado: são **dois papéis
diferentes que o WIN tem** — a **série contínua** (`WIN$N`, que emenda vencimentos e é a que presta para
**teste longo**: replay de dias, coletor de eficiência) e o **contrato vigente** (`WINZ26`, o papel do
pregão de hoje, que é o que a corretora mostra na conta e o que o gráfico abre quando se opera o real).

**O que foi implementado** — a taxonomia nasceu no **registro**, para que cabeçalho e tira de status
bebam da mesma fonte (se discordassem, a tela mostraria um símbolo e desenharia outro):
- `AssetSpec` ganhou `activeContract?: string` e `watermarkCaption: string`, e `primarySymbol` passou a
  estar **documentado como a série contínua** (padrão do config). WIN = `WINZ26` (vencimento informado pelo
  operador, o mesmo do `basePrice` 171.500). **WDO e BTC ficaram sem `activeContract` de propósito**:
  o spec é `a_confirmar` e inventar código de vencimento levaria o operador a assinar um papel que não
  existe na corretora — a tela diz "venc. a confirmar".
- `SymbolRole = 'serie' | 'vigente' | 'outro'` + `symbolRole(asset, symbol)` + `SYMBOL_ROLE_LABEL`
  (`série` / `vigente` / `venc.`). Qualquer código com `$` é lido como série; o resto é vencimento digitado.
- `assetSymbols(asset, configSymbol)` devolve `{ live, liveRole, series, active, tokens, others }`:
  `live` é o que a ponte subscreve de verdade (**o config manda**, com fallback na contínua); `tokens`
  monta a linha completa **sem nunca repetir um símbolo**; se o config estiver num código que não é nem
  a série nem o vigente, ele entra na frente, marcado como vivo.
- `Header.tsx`: novo `SymbolChip` (código em mono 9px + o papel em 7px maiúsculo ao lado, palavra
  escondida abaixo de `sm`) e a ficha do ativo virou **uma linha só**: ícone, `WIN` em 10px, separador,
  as fichas rotuladas, o aviso âmbar quando falta vencimento e o ponto de status. O `title` multilinha
  explica os dois papéis e diz qual está aberto. O dropdown ganhou a legenda "Série contínua (`$N`) =
  testes longos · Vigente = papel do pregão de hoje" e a linha por ativo `WIN$N série · WINZ26 vigente`.
- `App.tsx`: memo `assetSyms` (única fonte compartilhada com o Header via `liveSymbol`) e o rótulo
  `Ativo:` virou **`Gráfico:`** com o código vivo + papel + o outro caminho do mesmo ativo
  (`· WINZ26 vigente`).

### 9.4 ✅ Marca d'água do ativo no painel de preço (anexo opcional)

**Pedido.** "criar uma marca d'agua de cada ativo que possa ser anexada ou nao, vai da preferencia do
operador" e, na rodada seguinte, "a marca d'agua poderia ser mais visivel".

- Bloco desenhado dentro de `draw()` **logo após o fundo `#09090b` e antes de grade e tijolos**, dentro
  de `ctx.save(); beginPath(); rect(0, 0, plotRight, pricePaneHeight); clip(); … ctx.restore()`. Duas
  consequências: a marca fica **atrás de tudo** e **nunca sangra** para a régua de preços nem para o vão
  que a boleta ocupa.
- Três linhas: a **sigla do ativo** (`asset.id`, peso 700, corpo proporcional ao painel com piso e teto
  `max(38, min(140, pricePaneHeight * 0.34, plotRight * 0.2))` — em monitor grande não vira anúncio, em
  janela miúda não some), o **produto** (`watermarkCaption` em maiúsculas) e os **dois códigos** que
  definem o gráfico (`WIN$N série · WINZ26 vigente`).
- **Alfa 0.13 / 0.11 / 0.10** de branco sobre `#09090b` (≈ +31 por canal na sigla; era 0.05/0.045/0.045
  na primeira rodada): lê de primeira e ainda assim fica atrás dos tijolos. Decisão de projeto registrada
  abaixo — a marca é **contexto, nunca legenda**.
- Interruptor no painel da engrenagem (`Marca d'água: WIN anexada` / `desanexada`, chrome neutro),
  persistido em **`fluxo_renko_asset_watermark_v1`** com padrão ligado (`getItem(KEY) !== '0'`);
  `assetWatermark` entrou no array de dependências do redesenho, então ligar/desligar repinta na hora.
- Spec sem vencimento declarado **não assina "vigente"**: a linha diz `vencimento a confirmar` (correção
  nascida de um assert headless que falhou — ver Verificações).

### 9.5 ✅ As três faixas do topo apertadas (em duas rodadas)

**Descoberta que mudou o alvo.** Na primeira rodada só baixei o padding dos containers e a altura quase
não mexeu: **quem define a altura do cabeçalho são os botões** dos grupos de menu e das ações, não a
linha do título. A segunda rodada, então, encolheu os próprios controles.

- `Header`: `py-2 sm:py-3` → **`py-1`**, `gap-2 sm:gap-4` → **`gap-2`**, Zona 1 `gap-1.5 sm:gap-2`;
  botões MenuGroup + Dados + Box `px-3 py-1.5 text-xs` → **`px-2.5 py-1 text-[11px] leading-4`**;
  Zona 3 (MT5, Robô, Rodar, PDF) e o badge de assinatura `py-1 text-xs` → **`py-0.5 text-[11px] leading-4`**.
- Tira de métricas: `gap-3 py-1.5` → **`gap-2.5 py-0.5`**.
- Barra do próprio gráfico: `h-9` → `h-8` → **`h-7`**, com os selects de série e de Range `h-6` → **`h-[22px]`**.
- `<main>`: `p-1.5 sm:p-3 lg:pb-3` → **`p-0.5 sm:p-1 lg:pb-1`** (moldura de 2px/4px), mantendo o `pb-16`
  do mobile, que compensa a bottom nav e não é vão decorativo.

### Verificações deste ciclo

- `npx tsc --noEmit` limpo e `npx vite build` OK em todas as rodadas (✓ 2.17s na da boleta, ✓ 2.36s na
  rodada final da marca d'água + faixas).
- **Boleta em camadas (9.1/9.2) conferida no navegador** (aba oculta → DOM/JS, cliques sintéticos,
  `getBoundingClientRect`, sem screenshot por causa do viewport): **8/8 PASS** — título `Parâmetros` com
  `rgb(255,255,255)` a 9px/700 e chevron; nenhuma palavra "Preço" dentro da caixa; altura **456px →
  332px** ao recolher e restaurada depois; os steppers saem do DOM quando fechada (não ficam invisíveis,
  somem); `fluxo_boleta_params_open_v1 = 'false'` sobreviveu a `location.reload()`; ordem na linha com
  ⚙ em x=535 → 📌 em 557 → ⌄ em 579, `Boleta` em âmbar e **sem** selo SIM/MT5; os cinco botões de ação
  fora da sub-caixa e visíveis com ela fechada; chip recolhido mostrando Boleta + 166.410 + V1; console
  com zero erros. Dois achados de contexto: a linha Risco não apareceu porque o modo ativo era Pirâmide
  (comportamento de projeto) e a boleta auto-recolheu em ~9s (o alfinete precisou ser fixado para medir).
- **Símbolos desmembrados (9.3) conferidos headless** com `npx tsx` sobre um script temporário
  (`scripts/symbolCheck.ts`, 12 asserts, apagado depois): `live`/`series`/`active` do WIN, papéis
  `série`/`vigente`/`outro` corretos, nenhum símbolo repetido em `tokens`, WDO devolvendo `active = null`
  e `others` só com a série, e um vencimento digitado à mão entrando na frente marcado como vivo.
  **Um assert falhou de verdade e virou correção**: a legenda desenhava
  `WDO$N série · venc. a confirmar vigente`, rotulando de "vigente" um contrato que não existe; a linha
  do canvas passou a ser condicional (`asset.activeContract ? … : '… vencimento a confirmar'`).
- ⚠️ **Não conferido ao vivo neste ciclo**: as alturas finais das três faixas do topo e a leitura real da
  marca d'água no canvas (amostragem de pixels ligada × desligada). A ponte `browser-use` chegou a
  conectar nesta sessão (`list_pages` e `navigate_page` OK), mas `evaluate_script` e `wait_for` morreram
  em timeout (`code = 40504`) e, na sequência, todas as chamadas passaram a falhar com erro de parse de
  argumentos da própria ponte. Fica como primeiro item da conversa nova (o dev server responde HTTP 200
  na 3002, então dá para conferir na tela a olho).

---

## 📆 Ciclo 8 — 31/10/2026 · Estúdio de Estratégias, níveis do pregão e o Registro de Ativo (Fases 1 e 2)

O ciclo em que o terminal parou de ser "o WIN". Nasceu o **Estúdio de Estratégias** (biblioteca
separada do config ativo), o gráfico ganhou os **níveis relevantes do pregão** com curva de VWAP,
os portões de entrada saíram do `App.tsx` para um módulo puro, e o **Registro de Ativo** tirou do
código os números que mudam de um contrato para o outro — terminando com seletor WIN/WDO/BTC na
tela e histórico REAL pela ponte MT5 no lugar do gerador sintético. No fim, os avisos flutuantes
migraram do canto inferior direito para o centro da tela.

### 8.1 ✅ Estúdio de Estratégias (biblioteca que não encosta no config ativo)

**Causa raiz.** Os "perfis" do painel Ajustes sempre escreveram **no config ativo**: trocar de
perfil no meio de um pregão muda o robô que está operando, e não havia lugar para guardar, comparar
e versionar variações sem tocar no que está no ar.

**O que foi implementado.**
- `src/types/strategy.ts` (16): `SavedStrategy` é snapshot completo do `AutomationConfig` com `createdAt`/`updatedAt`.
- `src/services/strategyLibraryService.ts` (133): CRUD defensivo em `fluxo_strategy_library_v1`; toda
  leitura volta a receber os campos novos via merge com `DEFAULT_EA_CONFIG` — estratégia salva antes
  de um parâmetro existir não quebra o terminal. `mergeConfig` normaliza `assetId` pelo símbolo (item 8.6).
- `src/components/StrategyStudio.tsx` (660): aba **Estúdio** (Header + bottom nav mobile), editor com
  nome/descrição, blocos de Fluxo & Regime, Pirâmide, Reteste, Gestão de Risco, Janela de horário e
  limites da ponte; duplicar, excluir (sem `window.confirm`), exportar/importar JSON.
- **Ativação é gesto explícito e defensivo**: `App.tsx` aplica o snapshot, grava e mantém o **Robô
  PAUSADO** com o aviso "Robô mantido PAUSADO por segurança — ligue no On quando quiser operar".
  Salvar/editar no Estúdio nunca altera o que está operando.

### 8.2 ✅ Níveis relevantes do pregão e curva de VWAP no gráfico

- `src/utils/priceLevels.ts` (285, **função pura sem React**, conferível headless): devolve `AJUSTE`,
  `FECHAMENTO` (pregão anterior), `ABERTURA`, `LEILÃO` (VWAP dos primeiros minutos), `MÁX` e `MÍN`
  do dia mais recente, calculados sobre o buffer de ticks — abaixo de 20 ticks do dia nenhum nível
  sai, para não desenhar chute.
- `computeRunningVwap` produz a curva acumulada do dia (laranja `#fb923c`) — única curva de nível no gráfico.
- As janelas de leilão e de ajuste agora vêm do **registro de ativos** (`ASSETS[...].session`), não de
  constante solta.
- `RenkoFlowChart.tsx`: traços traceados discretos + legenda com contagem e detalhe de cada nível;
  liga/desliga persistido em `fluxo_renko_price_levels_v1`.

### 8.3 ✅ Portões de entrada compartilhados e migração da trava de horário

- `src/utils/tradingGates.ts` (95): `isWithinTradingWindow` (medida na **hora do tick**, falha aberta
  quando o horário vem vazio/fora do formato `HH:MM`) e `sessionFinancialLock`. Usados pelo `App.tsx`
  **e** pelo `paperStrategyBot.ts` — a mesma função nos dois lados, para o coletor não medir estratégia
  diferente da que aparece na tela. Nenhum helper daqui envia ordem.
- `src/utils/sessionRules.ts` passou a ler `tradingCloseAllTime` da estratégia (antes a hora de zerar
  era hardcoded no front e só a ponte Python respeitava o campo).
- `src/utils/tradingWindowMigration.ts` (112, flag `fluxo_trading_window_08_55_17_30_v2`): mudou o
  padrão de horário **não basta mudar o DEFAULT**, porque `loadSavedConfig`/`mergeConfig` fazem
  `{...DEFAULT, ...salvo}` e o valor gravado sempre vence. A migração só toca quem está exatamente no
  quarteto antigo, roda uma vez por navegador, escreve a flag por último e retorna resumo para o aviso.

### 8.4 ✅ Laboratório de estratégias (headless)

- `scripts/strategyLab.ts`: roda as duas estratégias reais (PULLBACK_RETEST e PYRAMID_FLOW_CONFLUENCE)
  em variações de escala/nível de reteste sobre o **mesmo** motor de contabilidade do coletor
  (`PaperStrategyBot`) e o **mesmo** avaliador de convergência. 5 réplicas × 10 dias úteis, todas as
  variações comem os mesmos ticks (RNG semeado), simulador equilibrado (~40% alta / ~40% baixa / ~20%
  lateral). Veredito por expectativa, fator de lucro e consistência entre réplicas.
- Saída: tabela no terminal + `scripts/strategy_lab_results.csv` (padrão BR). **Nenhum caminho do
  script toca a ponte MT5, ordens reais ou localStorage.**

### 8.5 ✅ Registro de Ativo — Fase 1 (os números saíram do código)

**Causa raiz.** O Mini-Índice estava **soldado** no código: `* 0.2` (R$/ponto) em 15 pontos de 7
arquivos, o preço-base `128500` em 22 pontos e o "tick de 5 pts / 1R = 5 pts" em 10. Trocar de ativo
era caçar número por número — e errava: o sanitizador de ordens comparava com 128.500 e descartaria
QUALQUER ordem de um WDO (~5.300 pts).

**O que foi implementado.**
- `src/assets/assetRegistry.ts` (276) — única fonte dos números por ativo. `AssetSpec` traz
  `pointValue`, `tickSize`, `decimals`, `basePrice`, `prefixes`, `primarySymbol`, `session`
  (leilão/trava/ajuste/`weekdaysOnly`), `renkoDefaults`, `contractNote` e `status`.
  WIN está `ativo`; **WDO e BTC seguem `a_confirmar`** até você homologar os números.
- Helpers puros: `resolveAsset`, `pointsToBRL`, `snapToTick`, `formatPrice`, `renkoScaleLabel`,
  `sessionClock`, `isStaleOrderPrice`. Estratégia, Renko, fluxo e portões continuam falando em
  **pontos**; dinheiro e formatação só aparecem na tela.
- `basePrice` do WIN corrigido de 128.500 para **171.500** (ajuste real do WINZ26), com tolerância
  percentual (`staleTolerancePct`) no sanitizador em vez de "400 pontos".
- `src/assets/assetMigration.ts` (flag `fluxo_asset_base_171500_v1`): quita como `CLOSED_MANUAL` (0
  pts, 0 R$) toda ordem `OPEN` presa no preço antigo e expira (`EXPIRED_PULLBACK`) as `PENDING_LIMIT`
  fora da tolerância — uma limitada a 128.450 num mercado de 171.500 travaria o estado para sempre.
  **Não toca** ordem já fechada, config, biblioteca nem escolha do operador.

### 8.6 ✅ Registro de Ativo — Fase 2 (seletor, spec persistido e histórico real)

**Seletor no Header** (`Header.tsx`, 516 linhas): `AssetSelector` na Zona 1 (aparece no celular, onde a
Zona 2 some abaixo de `lg`), chrome neutro com cor só no ponto de status. WDO e BTC aparecem com chip
`A CONFIRMAR`; clicar neles **não troca o ativo** — abre a **folha de ensaio** listando os três números
pendentes (R$/ponto, variação mínima, casas decimais) e, se você confirmar, entra em ensaio com o
**Robô forçado em OFF** e a ponte em SEGURO. Um chip âmbar permanente `SPEC NÃO HOMOLOGADO` fica na
tira de status enquanto o ativo não for homologado. Trava de pânico: `ALLOW_UNCONFIRMED_PREVIEW = false`
no registro deixa as linhas não homologadas mortas em uma linha só.

**Spec persistido:** `assetId?: AssetId` entrou no `AutomationConfig` (`assetId` vence o prefixo do
símbolo; sem id, cai no prefixo — comportamento antigo preservado). `assetSelectionMigration.ts` (flag
`fluxo_asset_selection_v1`) grava o id no config ativo, nas estratégias do Estúdio e copia o livro de
auditoria legado para a prateleira do WIN (cópia, nunca destruição).

> ⚠️ **Armadilha descoberta na verificação**: a migração só conserta o que já está no storage — ela não
> protege JSON importado depois. Por isso os TRÊS sítios de merge normalizam o campo:
> `EaConfigService.loadSavedConfig`, `EaConfigService.importConfigFromJson` e
> `strategyLibraryService.mergeConfig` fazem `assetId: ASSETS[x] ? x : resolveAsset(symbol).id`.
> Regra geral: ao adicionar campo persistido cujo valor depende de outro persistido, grep em todo
> `{...DEFAULT, ...salvo}` — migração sozinha não basta.

**Auditoria por ativo:** `auditKeyForAsset(assetId)` → `fluxo_renko_intraday_audit_v3_WIN|WDO|BTC`.
Um livro único misturando R$0,20/pt com R$0,10/pt daria PnL e curva de patrimônio sem sentido.

**Trocar de ativo com posição aberta é BLOQUEADO** (toast avisando quantas ordens vivem), nunca
liquidado silenciosamente — é dinheiro real em outro mercado. A escala de Renko só muda se o
`boxPoints` atual não for múltiplo válido do tick novo ou cair fora da faixa `renkoDefaults` do ativo;
não se reescala risco em silêncio.

**Histórico real pela ponte:**
- `src/services/marketHistoryService.ts` (219): dono do pedido. `requestHistory()` correlaciona por
  `reqId`, acumula `HISTORY_CHUNK` (chunks de ~1.500 ticks) deduplicando por `id`, resolve no
  `HISTORY_DONE`, rejeita no `HISTORY_ERROR`/timeout (25s, `dispose()` no `onclose` para nada ficar
  prometendo para sempre), normaliza tick (`snapToTick` só quando o desvio é ≤ metade do tick,
  agressor sempre `BUY|SELL|CROSS`, `timeStr` local) e mede suficiência (`assessSufficiency`).
- Rota nova no **script Python gerado**: `REQUEST_HISTORY` atrás do mesmo guarda de autenticação do
  broadcast, `mt5.copy_ticks_range` dentro de `asyncio.to_thread` (o feed ao vivo nunca para), teto de
  **10 dias** por pedido, e **fallback de volume pelas barras de M1** quando ≥80% dos ticks chegam com
  `volume = 0` — sem volume, CVD, delta e convergência morrem em silêncio e a estratégia fica muda.
  `ACCOUNT_INFO` passou a reportar `symbol`, então o seletor avisa quando o script rodando no Windows
  transmite outro contrato.
- **Replay rotulado**: conectado → histórico real; desconectado/erro/vazio → sintético. O resumo e o
  chip dizem `HISTÓRICO REAL (MT5) · N ticks` (sem seed, que é conceito do sintético) ou
  `SINTÉTICO · #seed`, e mostram a origem do volume.

**A régua do ativo envelhece, então o preço real visto manda:** `referencePrice(asset)` devolve o
último preço real persistido (`fluxo_asset_last_price_v1`, com escrita amortecida a cada ~30s) se ele
tiver menos de 7 dias, senão o `basePrice` do registro. Entram por ela o preço inicial do terminal, as
âncoras das ordens de demonstração, o ponto de partida do sintético, o eixo Y do gráfico e a tolerância
do sanitizador.

### 8.7 ✅ Aviso flutuante agora no centro da tela

**Pedido direto do operador**: nada de quadro de informação no canto inferior direito.
- `App.tsx`: o toast global saiu de `fixed bottom-… right-…` para um palco `fixed inset-0 flex items-center
  justify-center` com `pointer-events-none` (o gráfico continua inspecionável atrás do aviso) e o cartão
  `max-w-sm` recebendo os eventos. auto-dismiss de 4,5s intacto + **✕ para fechar na hora**, porque no
  centro ele cobre o pregão.
- A animação de entrada agora é real (`.flow-toast` no `index.css`, 180ms, com
  `prefers-reduced-motion` respeitado): as classes `animate-in slide-in-from-bottom-2` que estavam lá
  eram **no-ops** — este projeto usa Tailwind v4 sem plugin de animação.
- Ficaram onde estavam, por não serem do canto inferior direito: confirmação de gravação do Ajustes
  (superior direito) e aviso discreto do Estúdio (centro de baixo).

### 8.8 ✅ Boleta: uma caixa recolhível no lugar dos botões que somiam com o zoom

**Causa raiz do problema relatado** ("os botões só aparecem quando amplio a tela"): a ordem rápida
existia em **duas cópias com condições opostas** — a barra grande sobre o gráfico era `lg:hidden` e a
seção "Ordem rápida" da barra lateral era `hidden lg:flex`. Abaixo do breakpoint `lg` (janela estreita,
zoom do navegador maior, celular) a lateral some; e a barra sobre o gráfico, quando aparece, ocupa a
faixa inteira do topo (`left-2 right-2`) com botões de 30px de altura — grande demais e cobrindo o pregão.

**O que foi implementado** — novo `src/components/BoletaTicket.tsx`, montado sobre o canvas dentro de
`RenkoFlowChart` (no lugar da barra antiga):
- Uma caixa só, **sem breakpoint de visibilidade**: existe no desktop e no mobile sempre.
- **Recolhimento automático** (`AUTO_COLLAPSE_MS = 9000`): depois de ~9s vira um chip discreto no topo
  direito com `BOLETA · preço · nº de abertas`. O timer é rearmado a cada mudança de estado e **não roda
  enquanto o mouse está em cima** (`onMouseEnter/Leave`) nem com a boleta **fixada** pelo alfinete — assim
  quem está lendo os dados não perde a caixa do nada.
- **Dados básicos**: preço (pelas casas decimais do `AssetSpec`), contratos, Stop e Alvo em pontos **e** em
  preço, risco em R$ (`pointsToBRL(stopLossPoints, contracts, asset)`) e abertas + PnL flutuante em pontos
  (reaproveitando o `openPnL` que o gráfico já calculava para a barra de status).
- **Modo Pirâmide não inventa número**: com `strategyMode === 'PYRAMID_FLOW_CONFLUENCE'` a linha vira
  `Surfe (sem fixo)` e o risco em R$ some, porque a Ordem Mãe real tem `stopLoss = 0` / `takeProfit = 0`.
  (Estado em 31/10; a partir de 8.10/8.12 as linhas do Stop e do Alvo viraram steppers editáveis também na
  Pirâmide — vale para pirâmides, ordens manuais e para o script.)
- **Selo `MT5` × `SIM`** no cabeçalho, para o clique nunca ser ambíguo sobre ir ou não à corretora.
- **Posição**: `absolute top-2` com `right` vindo do prop `rightOffset` — 96px no desktop, 62px abaixo de
  640px — porque a régua de preços do eixo Y tem 64px (desktop) / 46px (mobile) e a boleta nunca pode
  cobri-la. O gráfico quem calcula, usando a própria largura do canvas (`canvasSize.w`), e não um
  breakpoint cego do CSS.
- A seção "Ordem rápida" da barra lateral **ficou onde estava** (é o painel de controles, não a boleta do
  gráfico), então agora há atalho na lateral do desktop e a boleta sempre visível sobre o canvas.
- Novo prop `strategyMode` em `RenkoFlowChart`, ligado a `config.strategyMode` no `App.tsx`. Texto do Guia
  MT5 (`DocumentationView`), `PROJECT_SUMMARY.md §D` e a árvore de arquivos foram atualizados.

### 8.9 ✅ Livro de hedge dentro da boleta (31/10) — os dados migraram das linhas de menu

**Pedido do operador**: trazer para a boleta todos os dados pertinentes — contratos na compra e na venda, os
ganhos, as perdas e o PnL do dia — com ZERAR COMPRAS e ZERAR VENDAS separados (estratégia de hedge), e retirar
das linhas de menu tudo que migrasse para essa nova área abaixo de COMPRA/VENDA.

**O que foi implementado**:
- `hedgeBook` nasce no `App.tsx` (único dono das ordens) como `useMemo` e viaja App → `RenkoFlowChart` →
  `BoletaTicket`. Tipos `HedgeSideBook`/`HedgeBook` exportados do próprio `BoletaTicket.tsx`.
- Por lado (COMPRAS/VENDAS): contratos vivos respeitando saída parcial, preço médio ponderado por contrato,
  R$ flutuante (`pointsToBRL`) e parcial já realizada. Na linha do lado o tom segue o **resultado** (verde no
  lucro, vermelho no prejuízo), não o lado — em hedge os dois lados apontam para cores opostas.
- Ganhos / Perdas / PnL do dia: realizado calculado sobre ordens fechadas da sessão (`exitTimestamp >=
  sessionStartRef`); PnL dia = realizado + flutuante dos dois lados + parciais.
- Rodapé de giro do dia: "Compra hoje N ct / Venda hoje N ct / Total dia N ct" — conta contratos que
  **viraram posição** na sessão (exclui `PENDING_LIMIT`), persiste depois de zerar.
- **Limpeza das linhas de menu** (pedido explícito "o que tiver de informação nas linhas de menu serão
  retirados"): removidos o chip de abertas e o bloco `PnL: R$` da tira do topo (App), o memo `openPnL`, o
  chip de PnL e o chip `N Pos Ativa(s)` da barra do gráfico, e a prop `pnl` + chips da `ChartControlSidebar`.
  "Aguardando Sinal" só aparece com zero ordens abertas.
- Boleta recolhida resume o hedge no chip com badges `Cn`/`Vn`.

### 8.10 ✅ A boleta virou a BASE editável das estratégias; hedge manual convive (31/10–01/11)

- **Tudo sempre visível** (pedido do operador): o painel hedge perdeu os portões `hedgeVisible`/`hedgeHasData`
  — as linhas C/V, ganhos/perdas/PnL e os botões ZERAR existem sempre, desabilitados quando vazios. Um PnL
  de exatamente R$ 0,00 não pode sumir da tela (achado da verificação: antes, o painel some em sessão plana).
- **Linhas editáveis na boleta**: Alvo (TP) e Break even escritos direto no config por
  `handleBoletaConfigPatch(patch)` no App — grava + `EaConfigService.saveConfig` + `lastSavedTimestamp`
  (`fluxo_renko_ea_config_v3`). Editores concorrentes **eliminados** do AutomationPanel: slider do TP, piso de
  proteção da pirâmide e offset de breakeven do reteste viraram somente-leitura com o ponteiro "edite na
  Boleta do gráfico".
- **Hedge manual real**: removida a inversão automática da entrada manual na Pirâmide (`if (activeOppDir.length
  > 0) handleClosePositions()` em `handleManualOrder`) — COMPRA e VENDA agora coexistem clicadas pelo operador.
  O caminho do ROBÔ continua obedecendo `hedgeOppositeAction` (ALLOW_SIMULTANEOUS / CLOSE_OPPOSITE / IGNORE_NEW).
- **Teste dirigido BE=50** (pedido do operador): aceito no máximo, persistido, hedge bilateral funcionando;
  semântica confirmada — piso = entrada + 50 pts (≈ R$ 10/ct travados); com trailing de mesma distância, o stop
  cola no extremo − 50 e nunca fica abaixo do piso.

### 8.11 ✅ Steppers no padrão de mercado + Contratos e Trailing editáveis (01/11)

- Pesquisa de padrão (CQG / Trading Technologies / NN/g): caixa `[− input +]` com unidade ao lado — implementada
  como `StepperRow` (substituiu o `EditableRow`), matando as setinhas nativas do número com
  `[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none`.
- Linhas editáveis da base: **Contratos** (1–99, passo 1, "ct"), Alvo (0–2000, passo 5), **Break even** (0–50,
  passo 1) e **Trailing** (0–300, passo 5, abaixo do break even com unidade em cinza).

### 8.12 ✅ Parcial + Stop editáveis, ZERAR agrupado e o Estúdio lendo a boleta (01/11)

- A boleta fecha os **seis valores-base**: Contratos, **Stop** (0–1000, passo 5 — era linha somente-leitura),
  Alvo, **Parcial** (5–1000, passo 5 — nova), Break even e Trailing. Ordem das linhas: Contratos, Stop, Alvo,
  Parcial, Break even, Trailing. Wiring fim a fim: `BoletaTicket` → `RenkoFlowChart` (ponte) → App
  (`onStopLossPointsChange` / `onPartialPointsChange` via `handleBoletaConfigPatch`).
- **ZERAR C / ZERAR V lado a lado** (`grid grid-cols-2`) logo abaixo de COMPRA/VENDA; **ZERAR TUDO** (âmbar,
  largura total) ao final da boleta, abaixo de todo o livro — chama `handleClosePositions()` sem lado e fecha
  os dois lados de uma vez.
- **Estúdio de Estratégias lê a boleta** (`StrategyStudio.tsx`): "Nova do config atual" já snapshotava o config
  vivo; o novo botão **"Puxar da boleta"** (`pullFromBoleta`) copia os seis campos + `enablePartialExit` do
  `currentConfig` para o rascunho — o fluxo de caça aos melhores parâmetros do EA é: ajustar na boleta →
  puxar no Estúdio → varrer o resto → salvar/ativar. Textos da tela vazia e do editor atualizados.
- **Ponte Python**: `close_all_positions(side=None)` no script gerado passa a aceitar `side='BUY'/'SELL'`
  (zera só o lado; `None`/`'ALL'` zera tudo como antes) e o handler `CLOSE_POSITIONS` lê `data.get("type")` —
  o `type: 'BUY'|'SELL'|'ALL'` que o front já enviava desde o Ciclo anterior.

### 8.13 🧪 Verificações da boleta-base e do hedge (31/10–01/11, via browser)

- `npx tsc --noEmit` limpo e `npx vite build` OK em todas as rodadas; aba do navegador oculta → verificação por
  DOM/JS (cliques sintéticos, `nativeInputValueSetter`, leitura de `localStorage`), sem screenshots.
- Persistência: Stop 100→110 e Parcial 50→55 sobreviveram a `location.reload()` e bateram com
  `fluxo_renko_ea_config_v3` (`stopLossPoints=110`, `partialPoints=55`).
- Hedge bilateral com o simulador OPERA: C 2ct + V 1ct vivos juntos → ZERAR TUDO fechou os dois lados, ZERAR C/V
  voltaram a ficar desabilitados, rodapé do dia manteve a contagem (3/1/4). Console limpo (0 mensagens).
- Estúdio: rascunho com Stop=999/Parcial=777 → clique em "Puxar da boleta" → reverte para 110/55 da boleta.
- **Achados honestos**: (1) dois cliques do stepper no MESMO tick do JS aplicam um só passo (em ritmo humano
  não ocorre; poderíamos converter para updater funcional se incomodar); (2) o alfinete (Pin) não sobrevive a
  reload — é estado local; (3) em modo Pirâmide o rascunho não renderiza Stop/Alvo/Parcial (comportamento do
  modo, não defeito) e a linha "Parcial" do rascunho só aparece com "Saída parcial" ligada — por isso o
  "Puxar da boleta" também copia o flag.

### Verificações deste ciclo

- `npx tsc --noEmit` limpo e `npx vite build` OK (só o aviso pré-existente de chunk > 500 kB) — também
  depois da Boleta do 8.8.
- **Boleta (8.8)**: conferido por medição de DOM no
  navegador (sem screenshot — a prévia estava com viewport oculto): caixa de 196×175px dentro do
  container do gráfico, com `BOLETA` + selo `SIM` + Preço/Contratos/Alvo-Stop/Abertas + COMPRA/VENDA +
  `ZERAR (1)`; recolheu sozinha a ~9s para o chip de 149×26px e reabriu ao toque; **console limpo, sem erro
  do `BoletaTicket`**. O que **não** foi conferido de fato: a tela larga de desktop (1440) e a largura real de
  celular (390) — o recuo da régua em mobile foi corrigido por código depois dessa medição e precisa do seu
  olho no aparelho.
- **Headless da Fase 1**: 66 asserts de paridade do WIN (nada do comportamento atual mudou).
- **Headless da Fase 2** (`tmp/verify-asset-selection.ts`, apagado depois): migração escreve `assetId`
  no config e na biblioteca e não roda duas vezes; sobrevive a JSON corrompido e a storage ausente;
  `resolveAsset` com id explícito vence o prefixo e o WIN antigo resolve igual; chaves de auditoria por
  ativo não se misturam (grava WIN, lê WDO → vazio); `referencePrice` usa o real com < 7 dias e cai no
  `basePrice` com 8; import JSON e estratégias do Estúdio resolvem o ativo certo; WDO com 1 casa,
  `snapToTick(5299,7, WDO) = 5300`, `renkoScaleLabel(5, WDO) = '10R'`, `pointsToBRL(5, 1, WDO) = 0,5`;
  `marketHistoryService` monta chunks fora de ordem, deduplica por `id`, rejeita no timeout sem dizer
  "em 0s" e não estoura com `HISTORY_ERROR`.
- **Script da ponte**: o `.py` gerado (1.325 linhas) contém `REQUEST_HISTORY`, `copy_ticks_range`,
  `HISTORY_CHUNK/DONE/ERROR`, o teto de 10 dias, o fallback `TIMEFRAME_M1` e o `symbol` no
  `ACCOUNT_INFO`; o cabeçalho fixo "Mini-Índice B3" deu lugar ao `label` do ativo. `python3 -m
  py_compile` aprovado.
- ⚠️ **Ainda não conferido com MT5 real**: profundidade de histórico que a conta demo da XP entrega e a
  qualidade do volume dos ticks só se provam rodando o script no Windows (é o teste manual que fica
  para você).

---

## 📆 Ciclo 7 — 30/10/2026 · Limiar adaptativo de regime, Avaliação Técnica e gráfico de estudo

Metade estratégia, metade usabilidade: o Delta Mínimo deixou de ser um número único para o dia
inteiro (passa a acompanhar a assimetria real do pregão), nasceu a aba **Avaliação Técnica** para
provar essa assimetria com dados, o replay ganhou dia de contexto estático sem marcas, o gráfico
virou ferramenta de estudo (vários dias na tela + engrenagem de ajustes) e o Header recebeu o
passe "clean" definitivo.

### 7.1 ✅ Limiar Adaptativo de Regime (assimetria intradiária)

**Causa raiz do problema.** O mercado é assimétrico dentro do dia: o volume por box na abertura
roda várias vezes acima do almoço (curva em U) e a agressão compradora × vendedora tem
distribuições diferentes. Um limiar de delta FIXO para o dia inteiro ou é frouxo de manhã ou
trava à tarde.

**O que foi implementado.**

*Novo módulo `src/utils/sessionRegime.ts` (`SessionRegimeMeter`, ~230 linhas):*
- `fator = volume médio dos últimos N boxes ÷ média do dia até agora` (clamp 0,5×–3,0×), mais dois
  fatores direcionais (magnitude de delta positivo × negativo, mesma ideia) — `getAdaptiveLimit(base, lado, delta)`.
- Medição **sempre ativa** (o medidor é alimentado mesmo com o gate desligado) — é a base da seção
  "Regime do Mercado" da Avaliação Técnica. Reset automático na virada de dia (chave YYYY‑MM‑DD local,
  mesma âncora dos motores de barra). Nada aqui envia ordem ou toca o MT5.

*Integração (`convergenceEvaluator.ts`, `renkoCalculator.ts`, `barEngines.ts`, `types/trading.ts`):*
- `evaluateBoxConvergence(..., meter?)` recebe o medidor da série; com `adaptiveThresholdEnabled`, o
  limiar efetivo vira `±minDeltaThreshold × fator do momento` nos DOIS modos (Pirâmide: blocos com
  agressão abaixo do limiar do momento não sinalizam; Clássico: gate idêntico por lado).
- Cada motor alimenta seu medidor a cada barra fechada **antes** da avaliação de convergência — o
  box é julgado com o fator com que ele fechou. O fator vigente fica gravado no box (`regimeFactor`).
- Motivos de sinal exportados no log/trade ganham ` vs ≥N | fator X.XXx` para auditoria.
- Config nova: `adaptiveThresholdEnabled` (padrão **ligado**) e `regimeLookbackBoxes` (padrão 20, 10–50
  em slider no painel), com merge defensivo no `eaConfigService`.
- UI em Ajustes: card "Regime do Mercado — Limiar Adaptativo" (vale para as DUAS estratégias, é gate
  de fluxo) com toggle, slider da janela do medidor e explicação da fórmula.
- **Script MT5**: `pythonScriptGenerator.ts` embute um `RegimeMeter` equivalente em Python na ponte
  gerada (mesma fórmula, mesmo clamp), com nota explicativa na aba Código Python condicionada ao toggle.

**Como foi verificado.** `npx tsc --noEmit` e build limpos; parity do gate (terminal × robôs sombra ×
script gerado) conferida na planilha do plano; desligado o toggle, comportamento antigo restaurado
sem reiniciar o dia.

### 7.2 ✅ Aba "Avaliação Técnica" (diagnóstico da base do coletor)

**O que foi implementado.**
- Novo `src/components/TechnicalEvaluationView.tsx` (~600 linhas): 100% leitura do MESMO snapshot em
  memória do coletor — win rate, fator de lucro e expectativa decompostos por **motivo de saída**
  (incluindo quanto do resultado é liquidação forçada de fim de pregão), **papel** (MAIN × Pirâmide),
  **direção** e **faixa de horário de entrada** — mais a seção **Regime do Mercado** (estatísticas
  por hora, série do fator, aquecimento do medidor).
- `seriesCollectorService.ts` expõe os medidores vivos: `registerRegimeMeter(series, meter)` (o App
  registra os 6 motores na inicialização) e `getRegimeReading(series, baseThreshold)` — leitura pura.
- CSV do coletor ganhou a coluna **FATOR REGIME** por trade (`PaperTrade.regimeFactor`), permitindo
  provar no Excel que as entradas em hora quente × limiar alto têm qualidade diferente.
- Menu do Header: novo item "Avaliação Técnica" (grupo Análise, ícone `ClipboardCheck`).

**Como foi verificado.** typecheck/build limpos; aba renderiza com dados do replay do dia no navegador.

### 7.3 ✅ Replay com dia anterior ESTÁTICO e sem marcas de ordem

**Causa raiz.** O objetivo de visualização pedia sempre +1 dia de contexto na tela (a abertura do
dia‑alvo precisa do fechamento de ontem como referência), mas o ingest silencioso chamava
`engine.processTick` e marcava ▲/▼ de convergência nos boxes de ontem — sugerindo sinais que
nunca foram (e nunca podem ser) operados.

**O que foi implementado.**
- `App.tsx`: contexto processado de uma vez, sem animação e **sem nunca operar**; depois do loop os
  boxes recebem `isStaticContext = true` (em todos os motores: principal, range, tempo e escalas
  alternativas).
- `types/trading.ts`: flag `isStaticContext?: boolean` em `RenkoBox`.
- `RenkoFlowChart.tsx`: `hideSignals = b.isStaticContext === true` suprime setas de ordem e marcas de
  convergência — só os tijolos crus aparecem; linha tracejada âmbar `ABERTURA` separa os dias e o
  divisor de dia (`dayBoundaries`) continua desenhado.
- Paridade de janela de entradas: o coletor (`paperStrategyBot.entryWindowBlocked`) compara a hora da
  **barra**, exatamente como o App compara a hora do **tick** — fora da janela não abrem entradas novas.

**Como foi verificado.** Inspeção da fiber React no navegador: boxes de ontem com `isStaticContext=true`
(e os com `convergenceType` interno) sem nenhum ▲/▼ desenhado; tipo 205/215.

### 7.4 ✅ Simulador com dias EQUILIBRADOS (para testar o adaptativo)

**Causa raiz.** O gerador antigo tinha viés comprador embutido (`trend` partia positivo), então dias
baixistas eram raros e o limiar adaptativo não podia ser testado de verdade na simulação.

**O que foi implementado.** `marketSimulator.ts` sorteia o tipo de dia EQUILIBRADO (~40% alta /
~40% baixa / ~20% lateral), o viés vale a sessão inteira (não só a tarde) e perde força no almoço
(lateral por natureza); `trend` neutro centrado em 0 com mudanças de regime estocásticas.

### 7.5 ✅ Zoom multidia para estudo (máximo de dias na tela)

**Causa raiz.** No zoom mínimo a tela inteira mostrava exatamente 1 dia. Três travas competiam:
o `baseVisible` do modo Preencher era dividido por `√scaleX` (o zoom nunca alargava a janela),
o piso de zoom era 0,5 e o teto de tijolos 1200.

**O que foi implementado.** (`RenkoFlowChart.tsx` + `ChartControlSidebar.tsx`)
- Modo Preencher agora honra o "Tijolos X" diretamente (`baseVisible = visibleCount`); o auto‑ajuste
de passo distribui TODOS na largura da tela (piso do passo 1px, tijolo mínimo 1px — a silhueta
continua legível com milhares de boxes).
- Piso de zoom X 0,5 → **0,15** em todos os caminhos (roda, ctrl+roda, arrasto, pinça, parse do
  localStorage, escalas iniciais); teto de "Tijolos X" 1200 → **3000** (~15 dias).
- Ciclo multidia do preset: 40 → 300 → 600 → 1200 → 2500 → 40. Chave de persistência versionada
  para `fluxo_renko_visible_count_v3` (o valor antigo travado em 1200/v1 seria lido como teto velho).

**Como foi verificado.** 500 eventos de roda disparados via script: `visibleCount` chegou a 1250,
`scaleX` encostou no piso 0,15, a linha ABERTURA de ontem permaneceu na tela e o dia de contexto
ficou visível — conferido via pixel sampling e inspeção da fiber.

### 7.6 ✅ Engrenagem de ajustes no canto da escala + escala de preços mais estreita

**Causa raiz.** A tira flutuante de controles no rodapé tinha muita informação que nem o operador
sabia o que era, o rodapé inteiro era uma legenda, e a régua de preços de 80px roubava largura do gráfico.

**O que foi implementado.** (`RenkoFlowChart.tsx`)
- Botão **engrenagem** (só o ícone, 28×28) sobreposto e **centralizado na régua de preços**, que abre
  um painel retrátil de 252px com tudo rotulado: tijolos −/+ , zoom −/+, FILL/STD, HOJE, escala do
  fluxo (reset) e legenda. Estado `chartToolsOpen`.
- Régua de preços 80→**64px** desktop e 54→**46px** mobile; rótulos **centralizados** na régua
  (`textAlign center`, x = `chartWidth + rightAxisWidth/2`) — as 3 cópias de `rightAxisWidth`
  (draw, hit‑test do divisor e wheel) atualizadas juntas.
- Rodapé da legenda removido (56 linhas → 1 linha de dica: "⚙ Ajustes no canto inferior direito ·
  arraste as réguas · duplo clique auto‑escala").

**Como foi verificado.** Centro da engrenagem × centro da régua medidos no DOM: offBy 0; painel abre,
fechamento pela engrenagem, botão + funcional (1250→1270); console limpo.

### 7.7 ✅ Passe "clean" no Header (chrome neutro, cor só no acento)

**O que foi implementado.** (`Header.tsx`)
- **Robô**: fundo/borda tintados em esmeralda‑rosa → chrome neutro (`bg-slate-900 border-slate-700`),
  texto reduzido ao mínimo de caracteres: só o ponto colorido + **On/Off** (antes "Robô: LIGADO/PAUSADO").
- **Pausar/Rodar**: antes botão verde cheio "Retomar feed" → chrome neutro igual, acento apenas no
  ícone (Play esmeralda / Pause cinza) e a palavra *feed* saiu dos rótulos.
- **Ícones do menu todos cinzas**: grupos ativos (Gráficos/Análise/Sistema) `text-slate-300`; atalhos
  **Dados** e **Box Renko** perderam o fundo/borda esmeralda quando abertos (viraram `bg-slate-800/70`,
  iguais aos grupos) — o único acento continua sendo o micro‑dot de status.

**Como foi verificado.** `npx tsc --noEmit` + `npx vite build` limpos após cada corte.

### Verificações deste ciclo

- `npx tsc --noEmit` e `npx vite build` limpos após cada entrega do ciclo.
- Nada tocou a ponte MT5 real: regime, avaliação, simulador e gráfico são 100% locais.
- **Evidência**: commit `ee07ee7` em `origin/main` (19 arquivos, 2.037 inserções / 276 remoções),
  incluindo os módulos novos `src/utils/sessionRegime.ts` (228 linhas) e
  `src/components/TechnicalEvaluationView.tsx` (606 linhas).

---

## 📆 Ciclo 6 — 29 e 30/10/2026 · Ponte blindada, mãe protegida e gráfico sob medida

Este foi o ciclo mais denso até agora: fechou o único buraco de segurança que podia custar
dinheiro real, deu à ordem mãe uma proteção de dois estágios (gatilho → acompanhamento),
permitiu entrada limitada na Pirâmide e refizou o gráfico (dois divisores arrastáveis + escalas
adaptativas). Segue item a item.

### 6.1 ✅ Segurança da ponte WebSocket (token + armed/disarmed + tetos de risco)

**Causa raiz do problema.** A ponte gerada chamava `websockets.serve(ws_handler, "0.0.0.0", 8765)`
sem nenhuma autenticação e sem checagem de origem, e `mt5.initialize()` entrava no terminal que
já estava logado na máquina. Ou seja: **qualquer aparelho da rede Wi‑Fi — e também qualquer site
aberto no navegador dele, porque WebSocket não é protegido por CORS — podia enviar `ORDER_SEND`
e operar a conta da XP.** Era a única superfície com consequência financeira real.

**O que foi implementado.**

*Novo módulo `src/utils/bridgeSecurity.ts` (fonte única do segredo):*
- `generateBridgeToken()`: 28 caracteres via `crypto.getRandomValues`, alfabeto sem caracteres
  ambíguos (sem `0/O/1/l/I`).
- `getBridgeToken()` lê do localStorage e, se não existir, gera e persiste automaticamente.
- `setBridgeToken()`, `rotateBridgeToken()` e `maskBridgeToken()` (mostrar/esconder sem vazar).
- Chave exclusiva **`fluxo_bridge_token_v1`**. O token **deliberadamente não fica em
  `AutomationConfig`**, para que trocar de preset ou importar um JSON jamais sobrescreva
  (nem exporte junto) o segredo da ponte.

*Protocolo novo no script Python gerado (`src/utils/pythonScriptGenerator.ts`):*
- Constantes `AUTH_TOKEN`, `REQUIRE_AUTH`, `MAX_CONTRACTS_PER_ORDER`, `MAX_ORDERS_PER_MINUTE`,
  `ENTRY_ACTIONS`, `TRADE_ACTIONS` e o dicionário `CLIENT_STATES` por conexão.
- `ws_handler` reescrito: a **primeira quadro precisa ser `AUTH`**; conferência com
  `secrets.compare_digest`; responde `AUTH_RESULT{ok, requireToken, armed, maxContractsPerOrder,
  maxOrdersPerMinute}`; token errado encerra com `close(code=4001, reason="token invalido")`.
- `ARM` / `DISARM` → `ARM_RESULT`. Sem o robô armado, **entrada nova é recusada**; saídas
  (`ORDER_MODIFY_SL`, `CLOSE_POSITIONS`, `ORDER_PARTIAL_CLOSE`) continuam liberadas para que você
  sempre consiga se proteger.
- `check_trade_allowed()` impone, nesta ordem: autenticado → armado → teto de contratos por ordem →
  janela deslizante de 60 s para ordens por minuto. Recusa volta como `RISK_REJECT` com motivo.
- `broadcast_to_web()` passou a ignorar clientes não autenticados (fechou o vazamento de ticks).
- Cada recusa é registrada no console do Windows com o IP de origem (`get_peer_ip`).
- `AUTH_TOKEN = ""` ⇒ modo legado (auto‑autenticado e armado), mantendo compatibilidade com o
  script que já estava baixado e rodando.

*Lado do navegador (`src/App.tsx`):*
- `onopen` envia `{action:'AUTH', token: getBridgeToken(), armed: config.active}`.
- Novos ramos de mensagem: `AUTH_RESULT`, `ARM_RESULT`, `RISK_REJECT`, com toasts específicos
  ("🔒 PONTE RECUSOU O TOKEN", "🔓 PONTE AUTENTICADA E ARMADA", "⛔ ORDEM RECUSADA PELA PONTE").
- Detecção de ponte antiga: se chegar `ACCOUNT_INFO` **antes** de `AUTH_RESULT`, o app avisa
  "⚠️ PONTE SEM AUTENTICAÇÃO (SCRIPT ANTIGO)" e marca `bridgeLegacy`.
- Efeito dedicado que envia `ARM`/`DISARM` sempre que o liga/desliga do robô (`config.active`) ou o
  estado da conexão mudam — o armamento da ponte espelha o interruptor do terminal.
- `onclose` limpa as flags da ponte.

*Tipos e padrões:*
- `src/types/trading.ts`: `AutomationConfig` ganhou `mt5MaxContractsPerOrder` e
  `mt5MaxOrdersPerMinute`; `MT5ConnectionState` ganhou `bridgeAuthOk`, `bridgeArmed`, `bridgeLegacy`.
- `src/services/eaConfigService.ts`: padrões **2 contratos por ordem** e **12 ordens por minuto**,
  com merge defensivo (`?? DEFAULT`) no `getConfig`, inclusive na importação de JSON; os presets
  herdam dos padrões por espalhamento.

*UI de operação:*
- `src/components/DocumentationView.tsx`: card **"Segurança da Ponte (token + travas de risco)"**
  com estado atual (chips), campo do token editável, mostrar/esconder, copiar, "Gerar token novo",
  os dois tetos numéricos e o trecho pronto de `New-NetFirewallRule` para restringir a 8765, além
  dos avisos "nunca exponha a porta na internet" e "não compartilhe o arquivo .py".
- `src/components/Header.tsx`: selo de conexão agora mostra `· ARMADO` ou `· SEGURO`, com
  descrição contextual no `title`.
- `src/components/ProjectDossierPdfModal.tsx`: protocolo atualizado para descrever o handshake.

**Como foi verificado.** `npx tsc --noEmit` limpo; `npx vite build` OK; o script gerado foi extraído
para `.py` (1056 linhas) em validação headless com `esbuild --bundle --platform=node --format=cjs`,
depois `python3 -m py_compile`. Em seguida um `FakeWS` assíncrono pilotou o **`ws_handler` real**
(módulo carregado com `MetaTrader5` e `websockets` interceptados) em duas configurações (com token
e legado), percorrendo **22 asserções, todas aprovadas**: token embutido, estado inicial bloqueado,
token errado sem `ACCOUNT_INFO` + `ok:false` + `close(4001)`, token certo autenticado e "EM SEGURO",
entrada recusada desarmada, saídas ainda permitidas, `ARM` liberando a ordem, teto de volume,
`DISARM`, janela de 12/min, contratos inválidos, tick não vazando para cliente não autenticado,
tick entregue quando autenticado e o caminho legado de auto‑armamento. Arquivos temporários de
teste foram removidos depois.

✅ **Reconferido no navegador (30/10/2026):** o teste comportamental acima cobriu o script Python; a
validação visual tinha ficado marcada como pendente de pós‑recarga. Ela foi refeita agora: carregando o
terminal do zero, o card “Segurança da Ponte” na aba Guia **Sistema → Guia MT5** renderiza com token,
“Gerar token novo”, os dois tetos (contratos por ordem / ordens por minuto) e o trecho de
`New‑NetFirewallRule`. O selo do Header foi exercitado nos **dois estados** com um stub WebSocket local
(127.0.0.1:8765, só ecoando `AUTH_RESULT`/`ARM_RESULT`, sem tocar nenhum corretor): com o robô ligado,
“Ponte autenticada e **ARMADA**”; ao desligá‑lo, “Ponte autenticada e **EM SEGURO**”. O stub foi removido
depois e nunca esteve no repositório.

### 6.2 ✅ Tipo de entrada na Pirâmide (Limit na metade ou na abertura do box)

**O que faltava.** A estratégia Reteste já tinha entrada por reteste, mas a Pirâmide só entrava a
mercado no fechamento do box — sem a opção de conseguir preço melhor.

**Implementado.**
- `pyramidEntryType`: `'MARKET_ON_CLOSE' | 'BOX_50_LIMIT' | 'BOX_OPEN_LIMIT'`, valendo para a mãe
  e para as pirâmides; reaproveita `pullbackMaxBoxesWait` como validade da limitada em boxes.
- `src/App.tsx`: ordens nascem com `status: 'PENDING_LIMIT'`, `limitPrice` e `pendingBoxIndex`; o
  monitor de ticks executa quando o preço toca o nível (compra: recuou até o nível; venda: subiu até
  ele) e cancela se expirar a validade. TP/SL das pirâmides passaram a ser **ancorados no preço real
  de entrada** (o nível do Limit), não no fechamento do box.
- `src/utils/paperStrategyBot.ts`: estrutura `PendingEntry` com expiração por `box.index` e
  gatilho `filled` por `box.low/high`, espelhando o terminal.
- `src/components/AutomationPanel.tsx`: seletor "Tipo de Entrada (Mãe e Pirâmide)" com explicação do
  efeito de cada opção e o campo de validade quando é Limit.
- Ponte Python: envio de `BUY_LIMIT`/`SELL_LIMIT` com `limitPrice` quando `isLimit` vai no comando.

### 6.3 ✅ Proteção da Ordem Mãe em dois estágios (gatilho → piso → acompanhamento)

**Causa raiz (bug real, não só UI).** Após a reorganização por estratégia, a Pirâmide mostrava
"um parâmetro só" de break even e o acompanhamento **não disparava nunca**:
1. O trailing do terminal estava protegido por `if (!isPyramidMode && config.trailingStop)`, ou
   seja, **morto no modo Pirâmide**.
2. No ramo de VENDA a condição exigia `trailTarget < currentSL`, mas a mãe nasce com
   `stopLoss: 0` — nenhuma meta seria menor que zero, então **o primeiro stop nunca era colocado**.
3. `noFixedStopLoss` era lido em lugar nenhum do `App.tsx`.

**Regra agora exatamente como você descreveu** ("100 de gatilho → vai para 30 pontos → depois
segue o preço a 50"):
- **Gatilho** (`trailingActivationPoints`, padrão 60 pts): enquanto a mãe não corre X pontos a
  favor, não existe stop — ela surfa livre.
- **Piso** (`breakevenOffsetPoints`, padrão 5 pts): no gatilho, o stop aparece na
  `entrada + piso` (compra) / `entrada − piso` (venda), cobrindo emolumentos da B3.
- **Acompanhamento** (`trailingDistancePoints`, padrão 50 pts): dali em diante o stop segue o
  extremo da perna (máxima na compra, mínima na venda) sempre a essa distância, escolhendo a
  posição que **mais protege** (compra: `Math.max`; venda: `Math.min`). O stop só anda a favor.
- Aceita `currentSL <= 0` como "ainda sem stop", então o trailing pode **criar** o primeiro stop nos
  dois lados — esse era o defeito central.
- Na Pirâmide o acompanhamento se aplica **só à ordem mãe** (`role === 'MAIN'`), porque as pirâmides
  morrem no próprio TP.
- `moveMainToBreakevenOnPyramidTp` segue vivo como atalho separado: a cada TP de pirâmide batido, a
  mãe vai ao breakeven no mesmo piso de taxas.

**Onde vive.** `src/App.tsx` (monitor de ticks, `trailApplies`), `src/utils/paperStrategyBot.ts`
(`trailMainStop` novo, com `extremeHigh`/`extremeLow` em `OpenPosition`, espelhando o terminal para
que os robôs sombra não tenham regra diferente da tela) e `src/components/AutomationPanel.tsx`
grupo **"🛡️ Proteção da Ordem Mãe"** dentro de "Regras de Saída" do bloco da Pirâmide, com os três
campos (Gatilho 25–500 passo 25, Distância 25–300 passo 25, Piso 0–50 passo 5) e um resumo dinâmico
em texto corrido: "A mãe corre +N pts → o stop vai para a entrada +Y pts → depois acompanha o preço
sempre a Z pts do extremo." A etiqueta do bloco ganhou `· MÃE NO TRAILING` quando ativo.

### 6.4 ✅ Pop‑up de execução de ordens ficou discreto

Você pediu para "diminuir/deixar mais delicada" a etiqueta que mostra o preço de entrada quando a
ordem é executada (inclusive a Ordem Principal de Venda). O toast flutuante era um card com ícone
grande dentro de caixa colorida, borda pesada e sombra forte. Ficou uma **linha fina**: ícone de 3 px
apenas tingido por direção (esmeralda ↑ compra / carmim ↓ venda / âmbar info), título em mono 10 px,
descrição em cinza‑claro embaixo, canto `MT5`/`SIM` mínimo, fundo translúcido com desfoque e borda
suave. **Conteúdo e preço de entrada intactos** — só o peso visual saiu.
(`src/App.tsx`, bloco do toast.)

### 6.5 ✅ Gráfico: dois divisores arrastáveis idênticos + escalas adaptativas

- **Divisor interno Heikin‑Ashi ↔ histograma** criado e depois tornado **arrastável**:
  `haHistSplit` (0.30–0.85, padrão 0.66) decide quanto do painel de fluxo fica com as velas;
  persistido em `fluxo_renko_chart_scales_v2`; duplo clique na linha volta a 0.66; o botão de
  restaurar escalas também zera.
- **Acabamento igual ao do divisor de cima** (a pedido): linha + alça central (48 px desktop /
  34 px mobile) + 3 pontos, **acendendo em verde** quando o cursor está em cima ou durante o arraste,
  com cursor `row-resize`.
- **Arraste com o dedo no Android** para os dois divisores: `touchDividerRef` com modo
  `MAIN | HIST` intercepta o toque a até 12 px da linha (senão o gesto viraria rolagem do gráfico).
- **Hit‑test único** `getFlowDividerLayout(w, h)`: desenho, cursor, mouse e toque agora usam a mesma
  matemática de layout — nada de área clicável descolada da linha visível.
- **Etiquetas das faixas** (só em desktop): `PREÇO · RENKO` / `PREÇO · RANGE` / `PREÇO · TEMPO`,
  `FLUXO · HEIKIN-ASHI` / `FLUXO · DELTA` / `FLUXO · HÍBRIDO`, `HISTOGRAMA · DELTA`. O rótulo de
  fluxo embaixo do divisor principal é omitido no modo Heikin‑Ashi para não duplicar o da subfaixa.
- **Escala do histograma**: antes só existia "0Δ"; agora tem régua numérica adaptativa (passo limpo
  1/2/5×10ⁿ, colisão de rótulos evitada, formato `+50Δ` e `1.2kΔ`), com a linha de zero e as guias de
  limiar ±`minDeltaThreshold` mantidas.
- **Escala do fluxo**: o passo das velas Heikin‑Ashi estava travado no mínimo 50 pts, o que gerava
  poucas linhas em faixas pequenas; agora é adaptativo a partir de 1, com passo limpo.
- **Grades presas na sua banda**: as linhas do Heikin‑Ashi vazavam para dentro do histograma quando a
  janela ficava pequena; agora cada grade e cada badge respeitam `[haBandTop, haBandBottom]`.

### 6.6 ✅ Série TEMPO saiu do gráfico (e virou coisa de coletor)

O seletador de gráfico ficou só com **Pontos (Renko)** e **Range**. A série de tempo continua
existindo nos motores e no Coletor — é histórico para comparação — mas não é mais opção de desenho.
No Simulador, o card do motor "tempo" passou a declarar isso explicitamente ("saiu do gráfico, roda
escondido e só mostra o que já foi registrado no Coletor") e nunca mais aparece como série ativa.

### 6.7 ✅ Trava de fim de pregão (17:30) compartilhada

Novo `src/utils/sessionRules.ts`: `isSessionCloseLock()` com janela **17:30 → 18:05**
(o WIN$ encerra às 17:45; a janela maior só cobre a liquidação). É usada pelo terminal **e** pelos
robôs sombra do coletor, para a simulação, a coleta e o replay obedecerem a mesma regra que a tela.
Dentro da janela: tudo aberto é liquidado a mercado (`DAY_CLOSE` / `DAY_CLOSE_FORCED`) e nenhuma
operação nova é aberta até o pregão seguinte. Fora da janela (madrugada/noite, quando o simulador
continua gerando ticks) o robô opera normal — senão ficaria parado o dia inteiro. O aviso é **um só
por tick**, não um por ordem liquidada.

### 6.8 ✅ Ajustes mostram só os parâmetros da estratégia ativa

Em `src/components/AutomationPanel.tsx`, a Pirâmide ganhou bloco dedicado com tudo junto
(🏄 Ordem Mãe · 🔺 Ordens da Pirâmide · 🔄 Regras de Saída, incluindo a Proteção da Mãe), enquanto
Parcial/Breakeven/Trailing "clássicos" ficam no **BLOCO 4 exclusivo do Reteste**. Reduz a tela, mas
⚠️ foi o que deixou o trailing invisível na Pirâmide até a correção 6.3 — o texto do bloco agora
explica que, na Pirâmide, a mãe é protegida pelo gatilho + acompanhamento.

### 6.9 ✅ Coletor: honestidade sobre dado real × replay

`src/services/seriesCollectorService.ts` ganhou a marca `real` por dia e os métodos
`markRealData()` / `hasRealData()`, chamados a cada tick vindo do MT5. Isso alimenta o portão do
replay de abertura: **dia com dado verdadeiro não é apagado** pela reprodução sintética, e o replay
passa a zerar ordens abertas, livro de auditoria e PnL da sessão (pregão limpo), além de rodar
progressivamente no compasso da velocidade escolhida (1x ≈ 1min45 para um dia; 10x ≈ 5 s) e de, no
modo **OPERA**, operar a estratégia de verdade passando pelo mesmo `handleIncomingTick` do terminal.

### 6.10 ✅ Janelas flutuantes e detalhes de suporte

- `DadosPanelWindow` aceitou `initialPos` (duplo clique devolve à origem, não a um canto fixo).
- `RenkoBoxCard` ganhou a variante `'window'` para viver dentro da janela flutuante "Box Renko".
- `PythonScriptView` e a documentação deixaram de prometer `ws://localhost`: agora explicam que o
  script roda no **Windows** (a biblioteca Python do MT5 não existe para Mac) e que o navegador
  aponta `Ajustes → MT5 Host` para o IP do Windows, com o servidor escutando em `0.0.0.0` da rede local.

### Verificações deste ciclo

`npx tsc --noEmit` limpo em todas as etapas; `npx vite build` entre 2,0 s e 4,5 s; servidor de
desenvolvimento em `http://localhost:3002` respondendo 200 e servindo o código novo (conferido por
`curl` + `grep` nos módulos transformados). Testes de comportamento: 22/22 no script Python da ponte.
Nada foi enviado ao corretor real; simulação, coleta e replay nunca tocam a conta de verdade.

---

## 📆 Ciclo 5 — 26–28/10/2026 · Coletor multi‑série, simulador, raio‑X e navegação mobile 2.0

Commit `379939a` — "feat: multi-series collector, PnL audit, simulator replay & X-ray tab, Dados
floating window, mobile nav 2.0".

- **Coletor de séries (`seriesCollectorService.ts`)**: seis motores em paralelo (Renko 10R, Renko
  15R, Range, Tempo e variações) alimentados pelos mesmos ticks, com contadores contínuos
  persistidos para que um F5 não encolha win rate, fator de lucro ou expectativa enquanto a lista de
  trades é truncada por série.
- **Robôs sombra (`paperStrategyBot.ts`)**: contabilidade independente por série, marcação a mercado
  das posições abertas, curva de patrimônio, PnL não realizado, expectativa, maior ganho/perda e
  drawdown em R$.
- **Aba Comparativo**: mesmas métricas lado a lado por série, para decidir qual escala merece ordens
  reais.
- **Aba Simulador**: visão geral do feed, preço, ritmo, robô, motores e replay de dias.
- **Janela flutuante "Dados"** (`DadosPanelWindow`) arrastável, reutilizada depois pelo Box Renko.
- **Navegação mobile 2.0**: barra inferior com 4 destinos fixos + "Mais" em folha modal, em vez de
  barra com scroll horizontal.
- **Auditoria de PnL**: conferência da contabilidade dos bots (motivos de saída, parciais, offset de
  taxas) antes de confiar nas métricas.
- Ajustes de paleta (menos "tingida", preservando os sentidos semântico das cores) e aba ativa do
  menu em cinza discreto, não branca.

## 📆 Ciclo 4 — 25/10/2026 · Estratégia Pirâmide & Confluência de Fluxo

Commit `db7b251` — "feat: update strategy to pyramid flow confluence".

- Dois modos de estratégia: **Reteste (Pullback)** clássico e **Pirâmide & Confluência**.
- **Ordem Mãe (`role: 'MAIN'`)** sem TP/SL fixos, surfando até a virada do fluxo; cada box seguinte
  na mesma direção abre uma **Pirâmide** com TP cirúrgico de 50 pts e stop opcional (0 = só inversão).
- `hedgeOppositeAction: 'CLOSE_OPPOSITE'`: na virada, zera tudo o lado oposto (`FLIP_REVERSAL`) e
  abre a mãe na direção nova; limite de 10 pirâmides simultâneas por lado.
- Visual dedicado no gráfico (tag da mãe, linhas pontilhadas de TP por pirâmide, banner de estado).
- Ponte Python com gerenciamento de mães e pirâmides por comentário de ordem e zeragem em massa.
- Padrões viraram Pirâmide: `contracts: 1`, `pyramidTpPoints: 50`, `pyramidContracts: 1`,
  `stopLossPoints: 0`, `takeProfitPoints: 0`, `maxDailyTrades: 0`.

## 📆 Ciclo 3 — 22–24/10/2026 · Auditoria intraday, Equity, perfis e PDF

- Livro de auditoria intraday com trilha de eventos por ordem, filtros, timeline e CSV padrão
  brasileiro (UTF‑8 com BOM, `;`).
- Curva de patrimônio com High‑Water Mark, underwater drawdown, histograma de resultados, matriz de
  KPIs e exportação CSV.
- Presets institucionais + perfis customizados do operador com lixeira in‑app (o `window.confirm`
  era bloqueado em iframe de prévia e sumia silenciosamente).
- Dossiê executivo em PDF (`@media print`) e o arquivo de seed de continuidade.
- Boleta rápida COMPRA/VENDA/ZERAR fixa dentro do canvas.

## 📆 Ciclo 2 — 20–22/10/2026 · Ponte MT5 real e dados da XP

- Descoberta central: **MT5 no Mac só roda via Wine**, e o pacote Python `MetaTrader5` é
  exclusivo de Windows ⇒ a ponte precisa rodar no Windows e o navegador conecta pela LAN.
- Bridge WebSocket com `websockets.serve(..., "0.0.0.0", 8765)`, preenchimento automático
  (`RETURN`/`IOC`/`FOK`), suporte a contas Hedge e retorno de tickets.
- `mt5Host` configurável, guia "Segurança"/"Guia MT5" com teste de ping e download do script.

## 📆 Ciclo 1 — Inicialização · Terminal Renko 10R + Fluxo

Commit `19164be`. Canvas de alta performance com tijolos 10R (50 pts), Heikin‑Ashi tricolor de
fluxo, Delta/CVD, fita de agressão, escalas independentes de X/Y/fluxo, persistência em
localStorage, paywall/admin maquette em localStorage e simulador B3 autônomo.

---

## 🧾 Decisões de engenharia que valem registro

1. **Terminal manda, script apenas obedece (e desobedece com motivo).** Toda regra de risco vive no
   TypeScript; a ponte só impone tetos e exige token/armed. Assim o replay e a simulação nunca
   alcançam o corretor.
2. **Regras espelhadas, não duplicadas.** Trailing/parcial/breakeven/trava de pregão foram extraídas
   para caminhos usados por `App.tsx` **e** `paperStrategyBot.ts`, para o coletor não medir uma
   estratégia diferente da que aparece na tela.
3. **Segredo fora da configuração compartilhada.** Token em chave própria do localStorage para não
   vazar por export JSON de preset nem ser destruído por import.
4. **Backward compatibility da ponte.** `AUTH_TOKEN` vazio mantém o script antigo funcionando, com
   aviso visível de que ele é inseguro.
5. **Matemática de layout em um lugar só.** `getFlowDividerLayout` elimina divergência entre onde a
   linha é desenhada e onde ela é clicável.
6. **Nenhum número de contrato no código (Ciclo 8).** O que muda de ativo para ativo (R$/ponto, tick,
   casas decimais, preço-base, janelas de sessão, escalas de Renko) mora em `src/assets/assetRegistry.ts`;
   estratégia, Renko e fluxo continuam falando em PONTOS e só se convertem em dinheiro/formatação na
   tela. Homologar um ativo é trocar `status` naquela tabela — nenhum outro código.
7. **Spec escolhido manda, símbolo é fallback (Ciclo 8).** `assetId` no config vence; sem ele, cai no
   prefixo do símbolo. E todo sítio de merge (`loadSavedConfig`, `importConfigFromJson`,
   `mergeConfig` do Estúdio) normaliza o campo derivado: migração uma-vez não protege import futuro.
8. **Um livro de auditoria por mercado (Ciclo 8).** Misturar WIN (R$0,20/pt) e WDO (R$0,10/pt) na mesma
   chave geraria PnL e curva de patrimônio sem sentido; a migração **copia** o legado para `..._WIN`
   sem apagar nada.
9. **Trocar de ativo nunca liquida posição (Ciclo 8).** Com ordem viva o seletor recusa e avisa; e
   spec `a_confirmar` só entra em **ensaio** (Robô OFF + ponte em SEGURO + chip permanente), porque um
   R$/ponto errado contamina PnL e a trava financeira em dinheiro real.
10. **Dado sintético é honesto no rótulo (Ciclo 8).** Sem MT5, o replay roda no gerador e o chip diz
    `SINTÉTICO · #seed`; com histórico real, diz `HISTÓRICO REAL (MT5)` e some o seed (determinismo do
    real é o mercado ter acontecido). Volume vindo de barra de M1 também aparece na tela.
11. **Um único lugar sabe qual símbolo está vivo (Ciclo 9).** `assetSymbols(asset, configSymbol)` no
    `assetRegistry.ts` é a fonte do cabeçalho **e** da tira de status, e `live` é sempre o que a ponte
    subscreve (o config manda, com fallback na contínua). Se cada componente montasse sua própria linha,
    a tela poderia anunciar um código e desenhar outro — o pior tipo de engano num terminal que envia
    ordem. Símbolo nunca aparece duas vezes na mesma linha, e vencimento não confirmado é dito como
    "a confirmar" em vez de inventado.
12. **Marca d'água é contexto, nunca legenda (Ciclo 9).** Ela nasce depois do fundo e antes de grade e
    tijolos, dentro de um `clip()` do painel de preço, com alfa de ~0.13: fica **atrás** do dado e não
    sangra para a régua nem para a boleta. Dado gráfico (níveis, ordens, VWAP) continua tendo legenda
    própria; a assinatura apenas diz de qual ativo é a janela — por isso é anexo opcional do operador.
13. **A altura de uma faixa vem dos botões, não do container (Ciclo 9).** Enxugar `py-*` do
    `<header>` quase não devolveu pixels: quem governa a altura são os controles internos (`py-1.5
    text-xs` nos grupos de menu e nas ações). Apertar três faixas empilhadas exige medir o conteúdo,
    não o invólucro.
14. **Blindagem por estrutura, não por condição (Ciclo 10).** O Robô 2 não é um robô real com um
    `if` na frente: ele é um serviço que **não tem referência** ao socket, a `setOrders` nem a
    callback de dispatch. Condição erra-se com um refactor; ausência de caminho, não. E a sombra
    ignora de propósito `config.active` e as travas do robô principal — a contabilidade dela roda
    mesmo com o primeiro desligado, porque é a estratégia da sombra que está sendo testada.
15. **Escala da sombra mora em R, não em pontos (Ciclo 10).** `scaleR` (15/20/25) é o que se
    persiste; `boxPoints = scaleR × tickSize` deriva no momento de operar. Guardar pontos tornaria
    o relatório incomparável depois de trocar de ativo (WIN 20R = 100 pts vs. WDO 20R = 10 pts).
16. **Um sinal, dois robôs, uma matemática (Ciclo 10).** A sombra chama o **mesmo**
    `evaluateBoxConvergence` do terminal e opera o **mesmo** `PaperStrategyBot` do coletor; se um
    dia divergir, é bug — não regra alternativa. O espelho sombra×coletor (271 boxes / 269 trades
    idênticos) existe para provar isso em CI de bolso.
17. **Contrato vigente é escolha do produto, não do operador (Ciclo 10).** A migração
    `fluxo_chart_vigente_v1` só reescreve `symbol` **exatamente igual** à série contínua; um
    vencimento digitado à mão é deliberação e nunca é tocado. Ativo sem vigente confirmado fica
    intacto — inventar código de vencimento seria assinar um gráfico que não existe na corretora.

## 🧭 Pendências e próximos passos conhecidos

- 📍 **PONTO DE RETOMADA — 02/11/2026 (fim do Ciclo 13, refino de leitura)**: quatro ajustes pedidos
  de dentro da tela, sem tocar matemática de sinal nem portões. (1) régua de tempo do eixo X agora
  mora **no divisor Renko ↔ Heikin-Ashi** (`TIME_AXIS_BAND_H = 24`, clicável, arrastável); (2) os
  três ZERAR da boleta estão **agrupados** abaixo de COMPRA/VENDA (ZERAR C | ZERAR V lado a lado +
  ZERAR TUDO em `col-span-2`); (3) a **Sombra acorda zerada** como a boleta — `shadowRobotService.resetBook()`
  no boot effect e no clique do replay (antes só rodava dentro do `await`, deixando as somas dos
  replays anteriores à mostra; e o F5 hidrata o livro do dia inteiro), escolhas continuam
  persistindo; (4) **▲ C / ▼ V padronizados** — a palavra "MÃE" saiu do canvas (some do rótulo sobre
  o tijolo e da placa da linha de entrada), o papel continua legível pelos prefixos P1/P2/RET.
  Verificado com tsc + build (2,36 s) + bancada headless (`_tmp_shadowZeroAssert.ts`: 58·58·58·0·
  escolha mantida). **Voltar por**: (1) 🧪 conferir no navegador — F5 da sombra após um replay deve
  mostrar 0 trades com estratégia/escala preservadas; régua X clicável; três ZERAR agrupados; ▲C/▼V
  nos dois navegadores (interno ↔ externo) com a mesma estratégia ativa; (2) opcional: exceção para
  manter `hadRealData` no F5 se um dia o operador pedir; (3) opcional: padronizar "mãe" na boleta,
  auditoria intraday e script Python se a decisão se estender para fora do gráfico.
- 📍 **PONTO DE RETOMADA anterior — 02/11/2026 (fim do Ciclo 12, terminal confiável)**: o app **acorda parado
  e vazio** (boot de 350 ticks e replay automático deletados; On do Robô liga o feed SIM), o limiar
  de sinal é o **P60 calculado do próprio pregão** (`getPercentileLimit`), o relógio do pregão só
  bloqueia **ordens reais e replay** (interruptor `setEnforceTimeGates`; simulador ao vivo roda 24h),
  o balão ⚠ explica qualquer inação sem piscar, existe **sincronismo entre navegadores** (Exportar
  tudo/Importar tudo no Estúdio) e estratégia removida **limpa as referências órfãs** (Robôs 1 e 2).
  Verificado com tsc + build + 3 asserts + bancadas headless (regimes de horário; P60=130).
  **Voltar por**: (1) 🧪 conferir em tela: boleta enchendo com P60, balão estático, sincronismo
  interno↔externo com um arquivo, modal de exclusão falando verdade; (2) opcional pedido pelo
  operador: percentil ajustável na tela de Ajustes (P50–P80, `adaptiveDeltaPercentile`); (3) as
  conferências herdadas dos Ciclos 10/11 (replay espelhado, F5 da sombra, overflow do chip, toast
  de divergência de magic); (4) validação na conta demo XP; (5) repiquete contínua × vigente no
  config; (6) homologar WDO/BTC.
- 📍 **PONTO DE RETOMADA — 02/11/2026 (fim do Ciclo 11, Fase 2 multi-robô + R$/ponto por ativo)**:
  cada ordem agora carrega placa de magic (Robô 1 = `config.magicNumber` · Boleta manual = 999999),
  as saídas automáticas da ponte filtram por `pos.magic`, o ZERAR da boleta continua fechando tudo
  (emergência), o app avisa quando a placa do script instalado divergir da configurada, e a
  contabilidade em R$/ponto respeita o ativo (ponte, coletor e sombra). Corrigido de brinde o
  `contracts=CONTRACTS` (NameError) do script gerado. Verificado com tsc + build + asserts
  (`robotMagicAssert`, `renkoBoxScaleAssert`, `chartContractAssert`) + `py_compile` WIN/WDO.
  **Voltar por**: (1) 🧪 as quatro conferências no navegador — as três herdadas do Ciclo 10 (replay
  espelhado, F5 da sombra com principal OFF, overflow do chip) mais o toast de divergência de
  magic; (2) commit do ciclo, quando o operador pedir; (3) validação na conta demo XP — agora a
  ponte já isola robô × manual por magic; (4) repiquete: decidir se o config deve gravar a contínua
  ou o vigente ao trocar de ativo; (5) homologar WDO/BTC (uma linha no registro cada).
- ✅ **Commit do Ciclo 10** — "feat: Robô 2 (sombra) com escala própria 15R/20R/25R + pente-fino da
  escala e contrato vigente no gráfico": código novo (`shadowRobotService.ts`,
  `ShadowRobotPanel.tsx`, `MiniSelect.tsx`, `chartContractMigration.ts`, asserts
  `renkoBoxScaleAssert`/`chartContractAssert`) mais wiring em `App.tsx` e os docs desta
  consolidação. Enviado a `origin/main` em 02/11/2026 depois de `npx tsc --noEmit` limpo, `npx
  vite build` OK (2,22 s), espelho sombra×coletor idêntico e teste de persistência F5 passando.
- 📍 **PONTO DE RETOMADA — 02/11/2026 (fim do Ciclo 10, Robô 2 na sombra)**: existe um segundo
  robô em papel com identidade própria (`shadowRobotService` + chip `+ Sombra` na tira do gráfico
  + janela flutuante + seção no Comparativo + bloco em Parâmetros + botão no menu mobile). Roda ao
  vivo, no replay e com o principal OFF; persiste em `fluxo_shadow_robot_v1` por dia; nunca toca a
  corretora (sem socket, sem setOrders, sem dispatch). **Voltar por**: (1) 🧪 as três conferências
  no navegador que ficaram pendentes (espelhamento visual do replay, F5 com principal OFF,
  overflow do chip no celular); (2) ✅ **entregue no Ciclo 11** — Fase 2, magic number por robô +
  filtro na ponte e na auditoria; (3) ✅ **entregue no Ciclo 11** — `POINT_VALUE_BRL` por ativo na
  ponte e nos robôs de papel; (4) repiquete: decidir se o config deve gravar
  a contínua ou o vigente ao trocar de ativo (a migração do vigente ainda não conferida no
  navegador); (5) validação na conta demo XP (item 🧪 abaixo).
- ✅ **Commit `89a5bb1`** — "feat: boleta-base editavel + livro de hedge + Estudio lendo a boleta (Ciclo
  8.9–8.13)": 11 arquivos, **1.657 inserções / 798 remoções** — código (App, BoletaTicket, RenkoFlowChart,
  ChartControlSidebar, AutomationPanel, StrategyStudio, pythonScriptGenerator) mais a documentação desta
  consolidação, e `CHAT_SEED.md` (o prompt real de continuidade) entrou no versionamento — até então só
  existia na máquina. Enviado a `origin/main` em 01/11/2026 depois de `npx tsc --noEmit` limpo, `npx vite
  build` OK, `python3 -m py_compile` no script gerado (1.332 linhas, com `close_all_positions(side)`) e
  verificação por browser (persistência Stop/Parcial, ZERAR TUDO bilateral, "Puxar da boleta", console limpo).
- ✅ **Commit `29bfab7`** — "feat: refino visual do Ciclo 9 — boleta em camadas, os dois códigos do ativo
  e marca d'água": 10 arquivos, **780 inserções / 185 remoções** — código (`index.html`, `App.tsx`,
  `assetRegistry.ts`, `BoletaTicket.tsx`, `Header.tsx`, `RenkoFlowChart.tsx`, `SubscriptionStatusBadge.tsx`)
  mais a consolidação dos três docs (`EVOLUCOES_DETALHADAS.md`, `PROJECT_SUMMARY.md`, `CHAT_SEED.md`).
  Enviado a `origin/main` em 01/11/2026 depois de `npx tsc --noEmit` limpo e `npx vite build` ✓ 3.13s, com a
  boleta conferida no navegador (8/8) e os símbolos conferidos headless (12 asserts, `npx tsx`). Ficou
  pendente a medição ao vivo das faixas e dos pixels da marca d'água (ponte do browser caída na sessão).
- 📍 **PONTO DE RETOMADA — 01/11/2026 (fim do Ciclo 9, refino visual)**: a boleta está em camadas —
  título âmbar com ⚙ dos ajustes do gráfico e 📌 de fixar na própria linha (sem selo SIM/MT5), e os seis
  steppers da base vivem dentro da sub-caixa recolhível **Parâmetros** (`fluxo_boleta_params_open_v1`);
  a linha `Preço` saiu da boleta. Cabeçalho e tira de status mostram **os dois códigos rotulados**
  (`WIN$N série` · `WINZ26 vigente`, com o vivo destacado); `Gráfico:` substituiu `Ativo:`. O gráfico
  assina o ativo com **marca d'água** atrás dos tijolos (liga/desliga na engrenagem,
  `fluxo_renko_asset_watermark_v1`) e as três faixas do topo foram apertadas (header `py-1` com botões
  `py-1/py-0.5 text-[11px]`, tira `py-0.5`, barra do gráfico `h-7`, `main p-0.5 sm:p-1`). Verificado por
  tsc + build + browser (boleta 8/8) + asserts headless dos símbolos (seções 9.1–9.5). **Voltar por**:
  (1) 🧪 medir ao vivo as alturas das faixas e a leitura da marca d'água (a ponte do browser caiu antes
  da medição); (2) decidir se a série contínua ou o vigente deve ser o símbolo gravado no config ao
  trocar de ativo (hoje o padrão continua `WIN$N`); (3) validação na conta demo XP, resolvendo antes o
  item 🔎 do simulador; (4) alinhamentos da boleta-base listados abaixo.
- 🧪 **Alinhamentos abertos da boleta-base (conversa prioritária com o operador)**: a Pirâmide usa
  `pyramidTpPoints` (50) e NÃO obedece ao Alvo da boleta; o gatilho do trailing
  (`trailingActivationPoints`, 60 pts) ainda não é linha editável na boleta; o texto da pirâmide no
  AutomationPanel ainda diz "inversão zera o resto" (correto só para o robô — a entrada manual agora
  convive em hedge); `hedgeOppositeAction` do robô continua fechando o lado oposto por sinal.
- ✅ **Commit `d2f16c2`** — "feat: Boleta — caixa de ordem rápida recolhível, sempre visível (desktop e
   mobile)": 7 arquivos, **364 inserções / 41 remoções**, incluindo o novo `src/components/BoletaTicket.tsx`
   e o registro desta conversa nos três docs (Ciclo 8.8, pendência do simulador e fase REFINO VISUAL).
   Enviado a `origin/main` depois de `npx tsc --noEmit` limpo, `npx vite build` OK e medição de DOM no
   navegador (auto-recolha, chip, persistência F5 e recuo da régua conferidos; viewport 1440 e celular
   real ficaram sem conferência visual).
- 🔎 **Diagnóstico feito, SEM código mexido — "o simulador parece sempre rodando" (31/10, às vésperas da
  conta demo)**: a guarda do loop (`!isSimulating || isReplaying || CONNECTED`, `App.tsx` ~L2209) funciona —
  com a ponte CONNECTED não vaza tick sintético. O que causa a sensação (verificado no código, linha a
  linha): (1) `isSimulating` nasce `true` e não é persistido (L144); (2) o mount effect sempre semeia 350
  ticks sintéticos (L652-687); (3) o **boot-replay dispara sozinho na abertura sem olhar se a ponte está
  conectando/conectada** (L2607-2624; com CONNECTED ele vira silencioso e segue rodando no coletor);
  (4) `generateNextTick()` não tem portão de pregão — roda de madrugada e fim de semana (só o gerador de
  histórico do replay usa `sessionClock`); (5) disconnect manual / `onerror` / AUTH recusado forçam
  `setIsSimulating(true)`. **Buraco real**: `socket.onclose` (L1886-1890) NUNCA religa o simulador — se a
  ponte cair sozinha no pregão, a tela congela sem tick nenhum e parece bug do robô. Extras: botões de
  agressão da aba Simulador não têm `disabled={mt5Live}` (injetam tick falso com MT5 ao vivo). Correções
  (decidir com o operador, na conversa do refino/validação demo): religar feed no onclose OU congelar
  + aviso; pular boot-replay e os 350 ticks quando CONNECTING/CONNECTED; persistir `isSimulating`;
  desabilitar agressão com mt5Live; portão de pregão no `generateNextTick` (maior mudança).
- 🎨 **Fase nova anunciada: REFINO VISUAL** (a partir de 31/10) — passar pente-fino no aspecto de todas as
  telas mantendo as regras fixas (chrome neutro, cor só no acento, nada de quadro no canto inferior
  direito, controle de operador sem breakpoint). Entregues: Boleta com livro de hedge e base editável
  (`8.8`–`8.13`) e o Ciclo 9 inteiro (boleta em camadas, os dois códigos do ativo, marca d'água e as três
  faixas apertadas).
- 🧪 **Homologar WDO e BTC** (Ciclo 8): uma linha cada no `assetRegistry.ts` com `pointValue`,
  `tickSize`, `decimals`, `primarySymbol` no MT5 da XP e o horário de pregão — o seletor destrava sozinho.
  Enquanto `status: 'a_confirmar'`, o ativo só entra em **ensaio**.
- 🧪 **Fase 3 do registro**: travas de horário por ativo (leilão, ajuste, fix das 13:00 do WDO, gap de
  fim de semana no replay do BTC). **Fase 4**: dossiê PDF sem o texto fixo "Mini-Índice B3".
  **Fase 5**: VTC (PTAX + FRP0) morando no WDO.
- 🧪 **Histórico real ainda não provado no Windows**: profundidade de ticks que a conta demo da XP
  entrega e fração de ticks que chegam sem volume (o fallback de M1 existe exatamente para isso).

- 🧪 **Infraestrutura para 100 clientes** (pergunta sua, ainda sem resposta): o app é estático, então
  o servidor em si é barato; o que custa é autenticação/licença **no servidor**, webhook PIX, a
  estratégia sair do bundle (hoje ela viaja no JS e no .py) e LGPD/CVM. Precisa de uma conversa
  dedicada com plano em fases.
- ⚠️ Autenticação/paywall continuam maquete em localStorage (bypassável com um `setItem`). Precisam
  de backend antes de cobrar de qualquer pessoa.
- 🧪 Firewall do Windows restringindo a porta 8765 à sua rede (o trecho do comando já está no Guia).
- 🧪 Token de exemplo gerado durante os testes ainda é o mesmo do seu navegador: gire um novo antes
  de rodar o script no Windows ("Gerar token novo" no Guia).
- ✅ **Commit `d2ba9d2`** — "feat: registro de ativo (Fases 1-2), Estúdio de Estratégias, níveis do
   pregão e aviso central": 34 arquivos, **4.610 inserções / 357 remoções**, incluindo os novos
   `src/assets/` (registro + 2 migrações), `marketHistoryService.ts`, `StrategyStudio.tsx`,
   `strategyLibraryService.ts`, `types/strategy.ts`, `priceLevels.ts`, `tradingGates.ts`,
   `tradingWindowMigration.ts` e `scripts/strategyLab.ts`, mais a documentação do Ciclo 8. Enviado para
   `origin/main` depois de `npx tsc --noEmit` limpo, `npx vite build` OK, asserts headless das Fases 1 e 2
   e `python3 -m py_compile` no script gerado.
- ✅ **Commit `3037273`** — "feat: hardened MT5 bridge, two-stage mother protection, pyramid limit
  entries, session lock and chart dividers": 20 arquivos, **3.005 inserções / 563 remoções** — cerca de
  2,6 mil linhas de código (17 arquivos em `src/`, incluindo os novos `bridgeSecurity.ts` e
  `sessionRules.ts`) e cerca de 1 mil linhas de documentação (este arquivo, `PROJECT_SUMMARY.md` e
  `PROJECT_CONSOLIDATION_CHAT_SEED.md`).
  Enviado para `origin/main` em 30/10/2026 depois de `npx tsc --noEmit` limpo e `npx vite build` OK (3,60 s).

## 🔁 Como retomar / verificar

```bash
npm run dev          # http://localhost:3000 (--host=0.0.0.0, então dá para abrir pelo celular)
npx tsc --noEmit     # checagem de tipos usada a cada etapa
npx vite build       # bundle de produção
```

Documentação correlata: `PROJECT_SUMMARY.md` (estado atual consolidado) e
`PROJECT_CONSOLIDATION_CHAT_SEED.md` (prompt de continuidade para conversa nova).
