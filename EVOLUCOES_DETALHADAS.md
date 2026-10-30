# 🧬 Evoluções Detalhadas — Flow Quant MT5 (B3 WIN$)

> Registro cronológico e circunstanciado de todas as evoluções do terminal, com causa raiz,
> o que foi implementado, onde vive no código e como foi verificado.
> Este arquivo é o complemento "diário de obra" do `PROJECT_SUMMARY.md` (que é a visão de estado atual).

Legenda de status: ✅ entregue e verificada · ⚠️ entregue com limitação conhecida · 🧪 em observação

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

## 🧭 Pendências e próximos passos conhecidos

- 🧪 **Infraestrutura para 100 clientes** (pergunta sua, ainda sem resposta): o app é estático, então
  o servidor em si é barato; o que custa é autenticação/licença **no servidor**, webhook PIX, a
  estratégia sair do bundle (hoje ela viaja no JS e no .py) e LGPD/CVM. Precisa de uma conversa
  dedicada com plano em fases.
- ⚠️ Autenticação/paywall continuam maquete em localStorage (bypassável com um `setItem`). Precisam
  de backend antes de cobrar de qualquer pessoa.
- 🧪 Firewall do Windows restringindo a porta 8765 à sua rede (o trecho do comando já está no Guia).
- 🧪 Token de exemplo gerado durante os testes ainda é o mesmo do seu navegador: gire um novo antes
  de rodar o script no Windows ("Gerar token novo" no Guia).
- ✅ **Commit `3037273`** — "feat: hardened MT5 bridge, two-stage mother protection, pyramid limit
  entries, session lock and chart dividers": 20 arquivos, **3.005 inserções / 563 remoções** — cerca de
  2,6 mil linhas de código (17 arquivos em `src/`, incluindo os novos `bridgeSecurity.ts` e
  `sessionRules.ts`) e cerca de 1 mil linhas de documentação (este arquivo, `PROJECT_SUMMARY.md` e
  `PROJECT_CONSOLIDATION_CHAT_SEED.md`).
  Enviado para `origin/main` em 30/10/2026 depois de `npx tsc --noEmit` limpo e `npx vite build` OK (3,60 s).

## 🔁 Como retomar / verificar

```bash
npm run dev          # http://localhost:3002 (--host=0.0.0.0, então dá para abrir pelo celular)
npx tsc --noEmit     # checagem de tipos usada a cada etapa
npx vite build       # bundle de produção
```

Documentação correlata: `PROJECT_SUMMARY.md` (estado atual consolidado) e
`PROJECT_CONSOLIDATION_CHAT_SEED.md` (prompt de continuidade para conversa nova).
