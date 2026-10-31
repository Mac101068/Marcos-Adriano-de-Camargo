# 🧬 Evoluções Detalhadas — Flow Quant MT5 (B3 WIN$)

> Registro cronológico e circunstanciado de todas as evoluções do terminal, com causa raiz,
> o que foi implementado, onde vive no código e como foi verificado.
> Este arquivo é o complemento "diário de obra" do `PROJECT_SUMMARY.md` (que é a visão de estado atual).

Legenda de status: ✅ entregue e verificada · ⚠️ entregue com limitação conhecida · 🧪 em observação

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
- **Selo `MT5` × `SIM`** no cabeçalho, para o clique nunca ser ambíguo sobre ir ou não à corretora.
- **Posição**: `absolute top-2` com `right` vindo do prop `rightOffset` — 96px no desktop, 62px abaixo de
  640px — porque a régua de preços do eixo Y tem 64px (desktop) / 46px (mobile) e a boleta nunca pode
  cobri-la. O gráfico quem calcula, usando a própria largura do canvas (`canvasSize.w`), e não um
  breakpoint cego do CSS.
- A seção "Ordem rápida" da barra lateral **ficou onde estava** (é o painel de controles, não a boleta do
  gráfico), então agora há atalho na lateral do desktop e a boleta sempre visível sobre o canvas.
- Novo prop `strategyMode` em `RenkoFlowChart`, ligado a `config.strategyMode` no `App.tsx`. Texto do Guia
  MT5 (`DocumentationView`), `PROJECT_SUMMARY.md §D` e a árvore de arquivos foram atualizados.

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

## 🧭 Pendências e próximos passos conhecidos

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
  direito, controle de operador sem breakpoint). Primeiro item já entregue: Boleta (`8.8`).
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
npm run dev          # http://localhost:3002 (--host=0.0.0.0, então dá para abrir pelo celular)
npx tsc --noEmit     # checagem de tipos usada a cada etapa
npx vite build       # bundle de produção
```

Documentação correlata: `PROJECT_SUMMARY.md` (estado atual consolidado) e
`PROJECT_CONSOLIDATION_CHAT_SEED.md` (prompt de continuidade para conversa nova).
