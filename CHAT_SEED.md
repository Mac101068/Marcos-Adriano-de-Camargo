# CONTEXTO DE CONTINUIDADE: FLUXO & RENKO 10R — MT5 QUANT TERMINAL (B3 WIN$)

Você está assumindo o projeto **Fluxo & Renko 10R - MT5 Quant Terminal**: aplicação web de trading
quantitativo que hoje roda no Mini-Índice B3 (`WIN$`) e está preparada para multi-mercado (WDO e BTC
já têm linha no registro, mas seguem **`a_confirmar`**), enviando ordens automatizadas ao MetaTrader 5
por uma ponte WebSocket em Python. **Fase atual: Ciclo 13 consolidado — o terminal acorda
parado e vazio (regra do operador), o limiar de sinal é calculado do próprio pregão (P60), o relógio
do pregão só bloqueia ordens reais e replay (simulador ao vivo roda 24h), o balão ⚠ explica qualquer
inação sem piscar, os navegadores interno/externo se sincronizam por um JSON, estratégia removida
limpa as referências órfãs dos dois robôs, a Sombra (Robô 2) acorda ZERADA como a boleta, a régua X
mora no divisor Renko ↔ Heikin-Ashi, os três ZERAR estão agrupados e os sinais são sempre ▲ C / ▼ V**
(a ponte ainda nunca rodou contra a corretora de verdade
— validação na demo XP segue o próximo marco).

## 0. QUEM É O USUÁRIO E COMO TRABALHAR
- Brasileiro, iniciante em programação. **Toda a UI, comentários e documentação em português.**
- Duas máquinas: **Mac** (aqui, onde o código é editado) e **Windows** (MT5 + conta demo XP, onde roda
  o script Python da ponte). Testa também no **celular Android via LAN**.
- Servidor: `npm run dev` na **porta 3000** com `--host=0.0.0.0` (para abrir de outros aparelhos).
- Regras fixas:
  1. Rodar `npx tsc --noEmit` ao final de cada entrega (e `npx vite build` quando mexer no gráfico/canvas).
  2. **Simulação, Coletor, Replay e Robôs Sombra jamais podem tocar a corretora real.**
  3. **Commitar e fazer push somente quando ele pedir explicitamente.**
  4. Preferir agir no alvo óbvio a fazer pergunta de múltipla escolha quando o pedido for claro.
  5. Ser honesto sobre o que foi verificado e o que não foi — ele valoriza saber o que ficou sem teste.
  6. **Chrome neutro, cor só no acento** (ponto de status, ícone, badge); e **nenhum quadro de informação
     no canto inferior direito** — aviso flutuante abre **no centro da tela** (Ciclo 8).
  7. **Controle do operador não pode depender de breakpoint**: a ordem rápida vive em **uma** caixa sobre o
     canvas (`BoletaTicket.tsx`), visível no desktop e no mobile, com recolhimento automático. Nunca mais
     criar par "cópia `lg:hidden` + cópia `hidden lg:flex`" — foi isso que fez a boleta sumir conforme o zoom.
  8. **A tela nunca pode anunciar um símbolo e desenhar outro** (Ciclo 9): a linha de códigos do ativo vem
     de `assetSymbols(asset, config.symbol)` no registro, bebido por Header **e** tira de status; série
     contínua (`WIN$N`, teste longo) e vigente (`WINZ26`, pregão de hoje) aparecem **rotulados**, sem
     repetir símbolo, e vencimento não confirmado é dito "a confirmar" — nunca inventado.
  9. **Marca d'água é contexto, não dado** (Ciclo 9): desenhada depois do fundo e antes da grade/tijolos,
     dentro do `clip()` do painel de preço (não pode sangrar para a régua nem para o vão da boleta), e é
     anexo opcional do operador. Dados do gráfico continuam tendo legenda própria.
  10. **O terminal acorda PARADO e VAZIO** (Ciclo 12, estendido à Sombra no Ciclo 13): nada pode se
     auto-iniciar no mount — nem feed sintético, nem replay, nem "semeadura" de ticks no gráfico.
     Mercado só anda por comando manual (▶ SIM, seta do replay, conectar MT5, bot demo) — e **ligar o
     Robô (On) conta como comando e liga o feed SIM**. **A Sombra (Robô 2) obedece a mesma regra**:
     `shadowRobotService.resetBook()` roda no boot effect e junto com o clique do replay, então a
     contabilidade acorda zerada como a boleta (só as ESCOLHAS — ligada, estratégia, escala, ativo —
     persistem entre sessões). Ao mexer em effects de mount, auditar se algo dispara sozinho.
  11. **Relógio do pregão só bloqueia ordens REAIS e replay** (Ciclo 12): janela 08:55–17:30 e zeragem
     17:30 valem para MT5 conectado e para a sessão simulada do replay; o **simulador ao vivo roda 24h**
     sem portão de horário. A chave única é `setEnforceTimeGates` (`sessionRules.ts`), virada pelo App
     em `[isReplaying, mt5State.status]`; coletor/sombra herdam pelas mesmas funções puras — nunca criar
     um segundo caminho de checagem de horário.
  12. **Limiar de sinal é CALCULADO, não físico** (Ciclo 12): com adaptativo ligado, o corte é o
     percentil **P60 dos |Δ| do próprio lado** nos últimos boxes (`SessionRegimeMeter.getPercentileLimit`);
     `minDeltaThreshold` é só aquecimento/fallback. Qualquer regra nova de limiar deve nascer da
     estatística da sessão, e o motivo impresso no trade diz de onde o número veio.
  13. **A tela nunca pode mentir sobre por que não operou** (Ciclo 12): todo bloqueio/espera vira frase
     honesta no balão ⚠ (`gateReasons`), com números quando existirem e **anti-pisca** (laudo de sinal
     só em jejum ≥5 dos últimos 6 boxes). Estratégia removida limpa referências órfãs (Robô 1 por nome,
     Robô 2 por id) e o modal de exclusão diz quem está rodando aquilo. Sincronismo entre navegadores é
     o pacote `fluxo_terminal_sync` do Estúdio (upsert por id, config aplicado com `active: false`).
  14. **Sinal é direção, papel é etiqueta** (Ciclo 13): no canvas, compra/venda é sempre **▲ C / ▼ V** —
     "mãe" foi abolida do gráfico (poluía a tela quando a Pirâmide despachava ordem-mãe) e o papel
     continua legível pelos prefixos **P1/P2/RET** que só aparecem em pirâmide/reteste. Log interno
     (App, auditoria, script Python) mantém "ORDEM MÃE" porque ali é semântica de gestão. A régua de
     tempo mora na faixa `TIME_AXIS_BAND_H = 24` entre o painel de preço e o painel de fluxo
     (clique/arraste na própria faixa move o eixo X); os três ZERAR ficam agrupados abaixo dos botões
     COMPRA/VENDA — nunca depois do livro de hedge.

## 1. PILARES DA ESTRATÉGIA
1. **Renko 10R = 50 pontos** por box; reversão exige 2 boxes (100 pts); corpo 100% sólido
   (`#10b981` / `#ef4444`), pavios centralizados; aproximação temporal progressiva dos boxes.
2. **Fluxo tick-a-tick**: delta por box, CVD, e filtro de Δ **calculado do pregão** — P60 dos |Δ| do
   próprio lado nos últimos boxes (Ciclo 12); `minDeltaThreshold` (ex.: 100–250 contratos) só aquecimento/fallback.
3. **Duas estratégias selecionáveis** — os valores-gestão (Contratos, Stop, Alvo, Parcial, Break even,
   Trailing) são editados **na boleta do gráfico**, que é a base; o Estúdio lê esses valores ("Puxar da
   boleta"):
   - **Reteste (Pullback)**: SL/TP fixos, realização parcial, breakeven e trailing clássicos.
   - **Pirâmide & Confluência**: **Ordem Mãe** (`role:'MAIN'`) nasce **sem TP e sem SL** (`takeProfit=0,
     stopLoss=0`) e surfa até a virada (`FLIP_REVERSAL`); cada box consecutivo abre **pirâmide**
     (`role:'PYRAMID'`) com **TP de 50 pts**; máximo 10 níveis.
4. **Gatilho de entrada em 3 modos** (vale para mãe e pirâmides): `MARKET_ON_CLOSE`,
   `BOX_50_LIMIT` (limitada a 50% do box) e `BOX_OPEN_LIMIT` (limitada na abertura = recuo de 100%),
   com validade `pullbackMaxBoxesWait` (1–10 boxes). Ordens limitadas nascem `status:'PENDING_LIMIT'`
   com `limitPrice` e `pendingBoxIndex`; TP/SL são ancorados no **preço real de execução**.
5. **Proteção da Ordem Mãe em dois estágios** (a regra que ele descreveu com palavras próprias):
   - **Gatilho** (`trailingActivationPoints`, padrão 60 pts): enquanto não corre X pts a favor, não existe stop.
   - **Piso** (`breakevenOffsetPoints`, padrão 5 pts): no gatilho o stop aparece em `entrada ± piso` (taxas da B3).
   - **Acompanhamento** (`trailingDistancePoints`, padrão 50 pts): o stop segue o **extremo da perna**
     (máxima na compra / mínima na venda) a essa distância, escolhendo a posição que **mais protege**
     (`Math.max` na compra, `Math.min` na venda). O stop só anda a favor.
   - ⚠️ Armadilhão histórico: a mãe nasce com `stopLoss: 0`, então a lógica precisa aceitar
     `currentSL <= 0` como "ainda sem stop" — caso contrário **o primeiro stop nunca é criado** e o ramo
     de venda fica morto. E na Pirâmide o trailing se aplica **só à mãe** (as pirâmides morrem no próprio TP).
   - `moveMainToBreakevenOnPyramidTp` é um atalho separado: a cada TP de pirâmide, a mãe vai ao breakeven.
   - As **mesmas regras** vivem em `src/utils/paperStrategyBot.ts` (`trailMainStop`), para os robôs sombra
     não operarem regra diferente da tela.
6. **Trava de fim de pregão**: `src/utils/sessionRules.ts` — janela **17:30 → 18:05**; liquida tudo a
   mercado (`DAY_CLOSE` / `DAY_CLOSE_FORCED`) e bloqueia novas entradas. Usada pelo terminal **e** pelo coletor.
7. **Coletor Multi-Série & Robôs Sombra** (`seriesCollectorService.ts`): seis motores em paralelo
   (Renko 10R, Renko 15R, Range, Tempo…) com contadores `PaperCounters`; aba **Comparativo** decide qual
   escala merece ordem real. Dia com dado verdadeiro é marcado `real` (`markRealData`/`hasRealData`) e
   **o replay nunca apaga**.
8. **Robô 2 (sombra)** (`shadowRobotService.ts`, Ciclo 10): segundo robô em **papel** com
   identidade própria — estratégia da biblioteca, **escala em R** (15R/20R/25R persistida como R; o
   box em pontos deriva por `boxPointsForR(scaleR, asset)`, ex.: WIN 20R = 100 pts, WDO 20R = 10 pts),
   motor de barras/CVD/regime **exclusivos**, livro, curva e CSV próprios (`fluxo_shadow_robot_v1`,
   dia-a-dia, batch no replay, dia `real` protegido). Roda ao vivo, no replay e com o principal OFF
   (ignora `config.active` de propósito). Usa o **mesmo** `evaluateBoxConvergence` do terminal —
   provado por espelho headless: sombra 20R × coletor renko20r = 271 boxes / 269 trades idênticos.
   **Blindagem por estrutura**: o service não tem socket, não tem `setOrders`, não tem callback de
   dispatch — nenhum caminho para ordem real. UI: chip `+ Sombra` na tira do gráfico + janela
   flutuante (`ShadowRobotPanel`), seção no Comparativo, bloco em Parâmetros, botão no menu mobile.
   ⚠️ **Fase 2 pendente**: robô real no mesmo símbolo exige `magicNumber` por robô + filtro na ponte.
9. **Simulador & Replay**: feed autônomo B3; replay **progressivo** (1x ≈ 2,0 s/tick, um dia ≈ 1min45;
   10x ≈ 5 s); modo **OPERA** roda a estratégia de verdade pelo mesmo `handleIncomingTick` do terminal.
10. **Gráfico** (canvas, `RenkoFlowChart.tsx`): só **Pontos (Renko)** e **Range** como séries desenháveis
   (Tempo saiu do gráfico, ficou no coletor). **Dois divisores arrastáveis idênticos** (linha + alça +
   3 pontos + destaque verde no hover/arraste): preço↔fluxo (`flowPaneRatio` 18–55%, padrão 33%) e, no
   modo Heikin-Ashi, **Heikin-Ashi↔histograma** (`haHistSplit` 30–85%, padrão 66%). Os dois arrastam com
   o **dedo** no mobile (tolerância 12 px). Hit-test único via `getFlowDividerLayout()` — desenho, cursor,
   mouse e toque compartilham a mesma matemática. **Escalas adaptativas com passo "limpo"**
   (1/2/2,5/5/10 × 10ⁿ) no preço, no Heikin-Ashi e no histograma (régua `+50Δ` / `1.2kΔ`); grades e badges
   presos à própria banda; etiquetas de faixa em desktop (`PREÇO · RENKO`, `FLUXO · HEIKIN-ASHI`,
   `HISTOGRAMA · DELTA`). Duplo clique reseta cada divisor; escalas persistidas. **Marca d'água do ativo**
   (sigla + produto + os dois códigos) é desenhada atrás dos tijolos, dentro do `clip()` do painel de preço,
   com alfa ~0.13 e corpo proporcional; liga/desliga na engrenagem (`fluxo_renko_asset_watermark_v1`).
11. **Heikin-Ashi de fluxo tricolor**: 🟢 subida contínua de agressão compradora, 🔴 descida contínua
    vendedora, ⚪ reversão/indecisão/absorção.
12. **Linhas de ordem no gráfico** com tags (`🟢 COMPRA MÃE (SURFE)`, `🔺 PIRÂMIDE #N (+50p TP)`,
    `⏳ RETESTE LIMITE`, `🎯 PARCIAL`, `🛡️ SL BREAKEVEN`, `🏁 TAKE PROFIT`), badges no eixo Y e setas de
    borda quando SL/TP saem do zoom. `openOrders` inclui `OPEN` **e** `PENDING_LIMIT`.
13. **Auditoria intraday** (`IntradayOrderAudit` + `orderAuditService`): trilha por ordem, filtros,
    timeline e CSV padrão BR (UTF-8 **com BOM**, `;`).
14. **SaaS & Admin Master** (`authService`, `AdminPanel`, `SubscriptionPaywall`): ⚠️ ainda **maquete em
    `localStorage`**, sem backend. Admin: `marcos.a.camargo@gmail.com`, vitalício.
15. **Dossiê executivo em PDF** (`ProjectDossierPdfModal`, `@media print`, A4).
16. **Registro de Ativo** (`src/assets/assetRegistry.ts`) — a **única** fonte dos números por contrato:
    `pointValue` (R$/ponto), `tickSize`, `decimals`, `basePrice`, `prefixes`, `primarySymbol` (a **série
    contínua**, `WIN$N` — emenda vencimentos e é a dos testes longos; padrão do config), `activeContract`
    (o **vigente**, `WINZ26`; vazio em WDO/BTC porque não se inventa vencimento), `watermarkCaption`,
    `session` (leilão/trava/ajuste/`weekdaysOnly`), `renkoDefaults`, `contractNote`, `status`. Estratégia/
    Renko/fluxo falam em **PONTOS**; conversão para R$ e formatação só na tela, via `pointsToBRL`,
    `formatPrice`, `snapToTick`, `renkoScaleLabel`, `resolveAsset`, `referencePrice`/`rememberLastPrice`
    (último preço real, válido 7 dias), `isStaleOrderPrice`, e a taxonomia de códigos
    (`SymbolRole`, `symbolRole`, `SYMBOL_ROLE_LABEL`, `assetSymbols`). **Homologar um ativo = trocar
    `status` nessa tabela**, nenhum outro código.
17. **Seletor de ativo no Header** (`AssetSelector`, Zona 1 — existe no mobile): uma linha com a sigla do
    ativo + **fichas de cada código rotulado pelo papel** (`SymbolChip`: `WIN$N série`, `WINZ26 vigente`),
    o vivo destacado e ponto de status; o dropdown traz a legenda "Série contínua ($N) = testes longos ·
    Vigente = papel do pregão de hoje". A tira de status do App diz **`Gráfico:`** + os mesmos códigos
    (mesmo memo — nunca dissonantes). Spec `a_confirmar` **não troca direto**: abre a **folha de ensaio**
    (os 3 números pendentes) e, confirmada, entra em ensaio com **Robô forçado em OFF**, ponte em SEGURO
    e chip permanente `SPEC NÃO HOMOLOGADO`. **Trocar de ativo com ordem aberta é BLOQUEADO** (nunca
    liquida em silêncio). `ALLOW_UNCONFIRMED_PREVIEW = false` tranca tudo em uma linha.
18. **Estúdio de Estratégias** (`StrategyStudio.tsx` + `strategyLibraryService.ts`): biblioteca versionada
    em `fluxo_strategy_library_v1`, separada dos perfis do Ajustes. Ativar = gesto explícito **+ Robô
    PAUSADO**. ⚠️ `mergeConfig` normaliza `assetId` pelo símbolo — como todo sítio de merge.
19. **Níveis do pregão + VWAP no gráfico** (`priceLevels.ts`, puro): AJUSTE, FECHAMENTO, ABERTURA,
    LEILÃO, MÁX, MÍN e curva de VWAP laranja; nada de nível com < 20 ticks do dia.
20. **Histórico real pela ponte (Fase 2)**: `marketHistoryService.ts` + rota `REQUEST_HISTORY` no script
    gerado; o replay se **rotula** `HISTÓRICO REAL (MT5)` ou `SINTÉTICO · #seed`, com origem do volume
    (`TICK`/`M1_RATE`/`NONE`). Sem MT5, o sintético continua funcionando normalmente.

## 2. PONTE MT5 — SEGURANÇA (não regredir isso nunca)
- O script Python **não existe no repositório**: ele é **gerado em runtime** por
  `src/utils/pythonScriptGenerator.ts` e baixado pelo navegador para o Windows. Portanto, qualquer mudança
  de protocolo precisa ser feita **no gerador**, não num `.py` do repo.
- Topologia: `websockets.serve(handler, "0.0.0.0", 8765)`; o navegador aponta **Ajustes → MT5 Host** para
  o IP do Windows (`mt5.initialize()` entra no terminal já logado).
- Protocolo: o **primeiro quadro** deve ser `{action:'AUTH', token, armed}` → `AUTH_RESULT{ok, requireToken,
  armed, maxContractsPerOrder, maxOrdersPerMinute}`; token errado ⇒ `close(code=4001, reason="token invalido")`;
  conferência com `secrets.compare_digest`. `ARM`/`DISARM` → `ARM_RESULT`. `check_trade_allowed()` exige,
  nesta ordem: autenticado → armado → `mt5MaxContractsPerOrder` (padrão **2**) → `mt5MaxOrdersPerMinute`
  (padrão **12**, janela deslizante de 60 s); recusa volta como `RISK_REJECT`. **Saídas sempre liberadas**
  (`ORDER_MODIFY_SL`, `CLOSE_POSITIONS`, `ORDER_PARTIAL_CLOSE`). `broadcast_to_web` ignora clientes não
  autenticados. Cada recusa é logada com o IP (`get_peer_ip`). `AUTH_TOKEN=""` = modo legado compatível.
- O app detecta ponte antiga quando `ACCOUNT_INFO` chega **antes** de `AUTH_RESULT` (flag `bridgeLegacy`);
  `ACCOUNT_INFO` também reporta `symbol`, então o seletor avisa quando o script no Windows transmite
  outro contrato.
- **Histórico (Fase 2)**: `{action:'REQUEST_HISTORY', reqId, symbol, days}` — exige **só o token** (dado de
  mercado não toca ordem, ponte em SEGURO atende) ⇒ `HISTORY_CHUNK{reqId,index,ticks[]}` (chunks ~1.500),
  `HISTORY_DONE{reqId,count,volumeSource,days}` ou `HISTORY_ERROR{reqId,reason}`. `copy_ticks_range` dentro
  de `asyncio.to_thread` com **teto de 10 dias**; se ≥80% dos ticks vierem com `volume = 0`, o script
  distribui o `tick_volume` da barra **M1** (sem volume, CVD/delta/convergência morrem em silêncio).
- **Identidade por robô (Fase 2, Ciclo 11)** — não regredir: toda `ORDER_SEND` carimba `magic`
  (Robô 1 = `config.magicNumber`, fallback 101010 · Boleta manual = `MANUAL_ORDER_MAGIC` 999999 — tudo
  em `src/types/trading.ts`); as saídas do robô enviam `robotMagic` e a ponte filtra por `pos.magic`;
  o **ZERAR C/V/TUDO da boleta NUNCA filtra** (botão de emergência fecha tudo); `ACCOUNT_INFO` reporta
  `robotMagic`/`manualMagic`/`pointValue` e o app avisa "MAGIC DIVERGENTE (APP × SCRIPT)". Retrocompatível
  nos dois sentidos (app velho × script novo e vice-versa). A sombra (Robô 2) **não tem magic de propósito**.
  Armadilha: o script gerado é um template literal JS — **backticks no texto gerado quebram o `tsc`**;
  use aspas simples.
- Token: `src/utils/bridgeSecurity.ts`, 28 caracteres via `crypto.getRandomValues`, chave
  **`fluxo_bridge_token_v1`** — **deliberadamente fora do `AutomationConfig`** para preset/import JSON
  nunca sobrescreverem nem exportarem o segredo. UI no card "Segurança da Ponte" (aba Guia) com mostrar,
  copiar, rotacionar, os dois tetos e o comando `New-NetFirewallRule`. Header mostra `· ARMADO` / `· SEGURO`.

## 3. STACK & ESTRUTURA REAL DE ARQUIVOS
React 19 + Vite + TypeScript (sem `strict`) + Tailwind CSS v4 + lucide-react + Recharts. `main.tsx` **sem
StrictMode** (senão os loops de tick duplicam).

```text
src/
├── App.tsx                       # ≈3.8k linhas: ticks, ordens, WebSocket MT5, abas, bottom nav, toast CENTRAL
├── assets/
│   ├── assetRegistry.ts          # números por contrato (WIN ativo; WDO/BTC a_confirmar) + helpers puros
│   ├── assetMigration.ts         # migração do preço-base (flag fluxo_asset_base_171500_v1)
│   ├── assetSelectionMigration.ts # migração da seleção (flag fluxo_asset_selection_v1)
│   └── chartContractMigration.ts  # migração do contrato do gráfico (flag fluxo_chart_vigente_v1): contínua gravada → vigente
├── types/{trading,strategy,auth,drawing}.ts
├── services/
│   ├── eaConfigService.ts        # config + presets + perfis + merge defensivo (normaliza assetId no load e no import)
│   ├── strategyLibraryService.ts # biblioteca do Estúdio (fluxo_strategy_library_v1)
│   ├── orderAuditService.ts      # auditoria **por ativo** (`auditKeyForAsset`) + CSV BR
│   ├── marketHistoryService.ts   # pedido de histórico real (reqId, chunks, dedupe, timeout, suficiência)
│   ├── seriesCollectorService.ts # coletor multi-série, marca real/replay
│   ├── shadowRobotService.ts     # **Robô 2 (sombra)**: runner em papel, escala própria 15R/20R/25R, livro/curva/CSV próprios, batch no replay — sem socket/setOrders/dispatch
│   └── authService.ts            # SaaS (localStorage)
├── utils/
│   ├── renkoCalculator.ts        # boxes Renko, delta/CVD por box, Heikin-Ashi (com setAsset)
│   ├── barEngines.ts             # motores de barra por série
│   ├── convergenceEvaluator.ts   # confluência preço × fluxo
│   ├── sessionRegime.ts          # medidor de regime (limiar adaptativo)
│   ├── priceLevels.ts            # níveis do pregão + VWAP acumulada (puro)
│   ├── tradingGates.ts           # portões de entrada compartilhados (puro)
│   ├── tradingWindowMigration.ts # migração da trava de horário
│   ├── marketSimulator.ts        # feed sintético do ativo escolhido
│   ├── paperStrategyBot.ts       # robô sombra (espelho das regras do terminal); `BotKey = SeriesKey | 'shadow'`
│   ├── sessionRules.ts           # trava 17:30 → 18:05 lendo tradingCloseAllTime
│   ├── bridgeSecurity.ts         # token da ponte
│   └── pythonScriptGenerator.ts  # gera o .py: AUTH/ARM/tetos + REQUEST_HISTORY (≈1.3k linhas de script)
└── components/
    ├── RenkoFlowChart.tsx (≈3.0k linhas), ChartControlSidebar, DadosPanelWindow, RenkoBoxCard,
    │   DrawingOverlay, DrawingToolbar
    ├── BoletaTicket.tsx           # BOLETA-BASE: título âmbar `Boleta` + ⚙ dos ajustes do gráfico na mesma linha
    │                             #   (o estado mora no RenkoFlowChart) + 📌 fixar + ⌄ recolher; sem selo SIM/MT5 e sem
    │                             #   linha `Preço`. Sub-caixa recolhível **Parâmetros** (`fluxo_boleta_params_open_v1`,
    │                             #   estado LOCAL) com os 6 steppers [− input +] (Contratos, Stop, Alvo, Parcial,
    │                             #   Break even, Trailing) persistidos no config; livro de hedge (C/V, ganhos/perdas/PnL
    │                             #   dia, giro do dia); ZERAR C/V lado a lado abaixo de COMPRA/VENDA + ZERAR TUDO ao final;
    │                             #   caixa recolhível (~9s → chip, e a engrenagem vai junto)
    ├── Header.tsx                # AssetSelector (WIN/WDO/BTC + folha de ensaio + fichas `série`/`vigente`), selo ARMADO/SEGURO
    ├── StrategyStudio.tsx        # aba Estúdio (biblioteca de estratégias; "Puxar da boleta" copia a base)
    ├── AutomationPanel.tsx       # Ajustes em BLOCOS por estratégia (Pirâmide tem bloco dedicado:
    │                             #   🏄 Ordem Mãe · 🔺 Pirâmides · 🔄 Regras de Saída com "🛡️ Proteção da Ordem Mãe")
    │                             #   e bloco do **Robô 2 (sombra)** com o ShadowRobotPanel
    ├── ShadowRobotPanel.tsx      # painel do Robô 2: identidade, warning, métricas e controles (liga/estratégia/15R-20R-25R/CSV/zerar); variantes `window` e `page`
    ├── MiniSelect.tsx            # caixa compacta de escolha (velocidade do simulador, dias do replay) — substituiu os 5 chips da tira
    ├── SimulatorView, SeriesComparisonView, TechnicalEvaluationView, TimesAndTrades,
    │   EquityCurveView, OrdersAndStats, IntradayOrderAudit
    ├── Header, PythonScriptView, DocumentationView, ProjectDossierPdfModal
    └── AdminPanel, SubscriptionPaywall, SubscriptionStatusBadge
scripts/strategyLab.ts           # laboratório headless das duas estratégias (+ CSV de veredito)
scripts/renkoBoxScaleAssert.ts   # assert: escala do box × rótulo anunciado (nunca "10R" soldado)
scripts/chartContractAssert.ts   # assert: migração contínua → vigente (inclusive os casos "não reescreve")
scripts/robotMagicAssert.ts      # assert: placas de magic (app + script gerado) e R$/ponto por ativo
```

Chaves de `localStorage`: `fluxo_renko_ea_config_v3` (com `assetId` e `shadowRobot`), `fluxo_renko_ea_profiles_v3`,
`fluxo_strategy_library_v1`, `fluxo_renko_chart_scales_v2` (inclui `haHistSplit`),
`fluxo_renko_flow_mode_v1`, `fluxo_renko_price_levels_v1`, `fluxo_boleta_open_v1` (boleta aberta/recolhida),
`fluxo_boleta_params_open_v1` (sub-caixa Parâmetros), `fluxo_renko_asset_watermark_v1` (marca d'água),
`fluxo_bridge_token_v1`,
`fluxo_renko_intraday_audit_v3` (legado) **+ `..._WIN` / `_WDO` / `_BTC`**, `fluxo_asset_last_price_v1`,
`fluxo_shadow_robot_v1` (**Robô 2**: corrida, livro, curva e marca `real` por dia),
`fluxo_shadow_window_open_v1` (janela flutuante do Robô 2),
flags de migração `fluxo_asset_base_171500_v1`, `fluxo_asset_selection_v1`, `fluxo_chart_vigente_v1`,
`fluxo_trading_window_08_55_17_30_v2`, `fluxo_series_collector_v1`, `fluxo_renko_spacing_mode_v2`,
`fluxo_renko_visible_count_v3`, `fluxo_renko_hud_pos_v1`, `fluxo_chart_series_v1`,
`fluxo_chart_range_pts_v1`, `fluxo_chart_time_sec_v1`, `fluxo_dados_window_v1`,
`fluxo_renko_box_window_v1`, `fluxo_replay_days_v1`, `fluxo_replay_operate_v1`, `fluxo_replay_seed_v1`,
`fluxo_sim_speed_v1`, `quant_terminal_{current_user,users,transactions}_v2`.

> ⚠️ **Regra que já mordeu**: como toda leitura faz `{...DEFAULT, ...salvo}`, o gravado sempre vence o
> padrão. Ao adicionar um campo persistido cujo valor depende de outro campo persistido, é preciso
> normalizar em **todos** os sítios de merge (`loadSavedConfig`, `importConfigFromJson`,
> `strategyLibraryService.mergeConfig`) — migração uma-vez não protege import futuro.

## 4. DOCUMENTAÇÃO
- `PROJECT_SUMMARY.md` — estado atual consolidado (regras, arquitetura, árvore de arquivos).
- `EVOLUCOES_DETALHADAS.md` — diário de obra por ciclo, com causa raiz, implementação e verificação
  (último ciclo: **11 — §11.1–11.5**, Fase 2 do multi-robô: placa de magic por robô + filtro na ponte +
  R$/ponto por ativo; antes dele **10 — §10.1–10.6**, Robô 2 na sombra com escala própria + pente-fino
  da escala + contrato vigente no gráfico, e **9 — §9.1–9.5**, boleta em camadas e marca d'água).
- `PROJECT_CONSOLIDATION_CHAT_SEED.md` — ponteiro/índice; **este arquivo (`CHAT_SEED.md`) é o prompt**.
- `CHAT_SEED_CICLO_10.md` — seed do Ciclo 10: résumé da evolução e **tarefas da próxima conversa**
  (colar sozinho ou depois deste).

## 5. COMO VERIFICAR
```bash
npx tsc --noEmit          # tem que sair limpo em toda entrega
npx vite build            # quando mexer em canvas/estilos
npm run dev               # porta 3000, --host=0.0.0.0
npx tsx scripts/<nome>.ts # checagem headless de lógica pura (registro, migrações, motores): o script
                          # temporário roda contra os módulos reais e é apagado depois da entrega
```

## 6. PENDÊNCIAS ABERTAS
- 📍 **PONTO DE RETOMADA (fim do Ciclo 13, 02/11/2026)**: **refino de leitura** — quatro ajustes
  pedidos de dentro da tela, sem tocar matemática de sinal nem portões. (1) régua de tempo do
  eixo X mora **no divisor Renko ↔ Heikin-Ashi** (faixa de 24 px clicável/arrastável —
  `TIME_AXIS_BAND_H = 24`, `TIME_AXIS_BASELINE = 17`); (2) os **três ZERAR** da boleta estão
  **agrupados** abaixo de COMPRA/VENDA (ZERAR C | ZERAR V lado a lado + ZERAR TUDO em
  `col-span-2`); (3) a **Sombra acorda zerada** como a boleta — `shadowRobotService.resetBook()`
  no boot effect e junto com o clique do replay (antes só corria dentro do `await` do
  `resolveReplayTicks`, deixando as somas do replay anterior à mostra; e o F5 restaurava o
  livro do dia inteiro via `ensureLoaded`); escolhas continuam persistindo; (4) **▲ C / ▼ V
  padronizados** — a palavra "MÃE" desapareceu do canvas (some do rótulo sobre o tijolo e da
  placa da linha de entrada); papel legível pelos prefixos P1/P2/RET. Verificado com tsc limpo,
  `npx vite build` OK 2,36 s e bancada headless `_tmp_shadowZeroAssert.ts` (**58·58·58·0·escolha
  mantida**). **Voltar por**: (1) 🧪 conferir no navegador — F5 da sombra após um replay deve
  mostrar 0 trades com estratégia/escala preservadas; régua X clicável; três ZERAR agrupados;
  ▲C/▼V nos dois navegadores com a mesma estratégia ativa; (2) opcional: exceção para manter
  `hadRealData` no F5 se um dia o operador pedir; (3) opcional: padronizar "mãe" também na
  boleta, auditoria intraday e script Python; (4) todas as pendências herdadas do Ciclo 12.
- 📍 **PONTO DE RETOMADA anterior (fim do Ciclo 12, 02/11/2026 — superado pelo ponto acima, mantido como histórico)**: **terminal confiável por construção** —
  acorda parado e vazio (boot de 350 ticks e replay automático deletados; On do Robô liga o feed SIM),
  limiar **P60 calculado do pregão** (`getPercentileLimit` em `sessionRegime.ts`, ligado no
  `convergenceEvaluator.ts` com `SESSION_PERCENTILE=0.6`), **interruptor de regime** `setEnforceTimeGates`
  (`sessionRules.ts`): simulador ao vivo roda 24h, janela/zeragem só para MT5 conectado e replay
  (coletor/sombra herdam), balão ⚠ com laudo honesto anti-pisca (`MERCADO PARADO`, `SINAL FRACO HÁ N
  BOXES`, `SÉRIE SEM ROBÔ`, `RETESTE ESPERANDO CVD`, netting/teto hedge), **sincronismo entre
  navegadores** (`fluxo_terminal_sync` no Estúdio: Exportar/Importar tudo, upsert por id, config
  aplicado com `active: false`) e **varredura de órfãos** (sombra desliga com estratégia removida,
  `profileName` limpo, modal de exclusão verdadeiro, `(removida)` em âmbar no painel). Verificado:
  tsc + build + 3 asserts + bancadas headless (regimes de horário; P60=130 em sessão Δs 10→200).
  **Voltar por**: (1) 🧪 conferir em tela — boleta enchendo com P60, balão estático, sincronismo
  interno↔externo com um arquivo, modal honesto; (2) se o operador pedir: percentil ajustável nos
  Ajustes (P50–P80, campo `adaptiveDeltaPercentile`); (3) conferências herdadas dos Ciclos 10/11
  (replay espelhado, F5 da sombra com principal OFF, overflow do chip, toast de divergência de magic);
  (4) validação na demo XP; (5) repiquete contínua × vigente no config; (6) homologar WDO/BTC.
- 📍 **PONTO DE RETOMADA (fim do Ciclo 11, 02/11/2026 — superado pelo ponto acima, mantido como histórico)**: **Fase 2 do multi-robô entregue** — cada ordem
  carrega placa de magic (Robô 1 = `config.magicNumber` · Boleta manual = 999999, placas em
  `src/types/trading.ts`), as saídas automáticas da ponte filtram por `pos.magic`, o ZERAR da boleta
  segue fechando tudo (emergência), `ACCOUNT_INFO` reporta placa e R$/ponto com toast de divergência
  APP × SCRIPT, e a contabilidade em R$/ponto respeita o ativo (ponte `ASSET_POINT_VALUE`,
  `PaperStrategyBot.setAsset()`, coletor e sombra). Corrigido de brinde o `contracts=CONTRACTS`
  (NameError histórico do script gerado → `MAIN_CONTRACTS`). Verificado: tsc limpo, build OK (2,80 s),
  `npx tsx` nos três asserts (`robotMagicAssert` novo, `renkoBoxScaleAssert`, `chartContractAssert`),
  `python3 -m py_compile` nos .py gerados WIN e WDO (diário §11.1–11.5). **Voltar por**:
  (1) 🧪 quatro conferências no navegador — as três herdadas do Ciclo 10 (replay espelhado, F5 da sombra
  com principal OFF, overflow do chip) + o toast de divergência de magic; (2) commit do ciclo, quando
  o operador pedir; (3) validação na demo XP — a ponte agora isola robô × manual por magic; (4) conferir
  a migração do vigente no navegador; (5) repiquete: contínua × vigente no config ao trocar de ativo.
- 📍 **PONTO DE RETOMADA (fim do Ciclo 10, 02/11/2026 — superado pelo ponto acima, mantido como histórico)**: existe o **Robô 2 (sombra)** — segundo robô
  em papel com estratégia da biblioteca, escala própria (15R/20R/25R), motor/CVD/regime exclusivos,
  livro/curva/CSV próprios (`shadowRobotService` + chip `+ Sombra` na tira + janela flutuante + seção
  no Comparativo + bloco em Parâmetros + botão no menu mobile). Roda ao vivo, no replay e com o
  principal OFF; persiste em `fluxo_shadow_robot_v1` por dia; **nunca toca a corretora** (sem
  socket/setOrders/dispatch). Junto entraram o pente-fino da escala (rótulos via `renkoScaleLabel`),
  a `MiniSelect` na tira e a migração do **contrato vigente** (`fluxo_chart_vigente_v1`). Verificado:
  espelho sombra×coletor idêntico (271 boxes / 269 trades), persistência F5, normalize sanitizando
  lixo, WIN→WDO rederivando o box, tsc + build limpos (diário §10.1–10.6). **Voltar por**:
  (1) 🧪 as três conferências no navegador que ficaram pendentes (espelhamento visual do replay, F5
  com o principal OFF, overflow do chip no celular — seguem pendentes, somou-se o toast de magic);
  (2) ✅ **entregue no Ciclo 11** — Fase 2 do multi-robô, `magicNumber` por robô + filtro na
  ponte/auditoria; (3) ✅ **entregue no Ciclo 11** — `POINT_VALUE_BRL` por ativo no script gerado e nos
  robôs de papel; (4) conferir a
  migração do vigente no navegador (ainda não vista em tela); (5) validação na demo XP (abaixo).
- 📍 **PONTO DE RETOMADA (fim do Ciclo 9, 01/11/2026 — superado pelo ponto acima, mantido como histórico)**: boleta em camadas (título âmbar + ⚙ dos ajustes
  do gráfico na linha do título + 📌 + ⌄, sem selo SIM/MT5 e sem linha `Preço`; sub-caixa recolhível
  **Parâmetros** com os seis steppers da base, persistida em `fluxo_boleta_params_open_v1`), cabeçalho e
  tira de status mostrando **os dois códigos rotulados** (`WIN$N série` · `WINZ26 vigente`, vivo destacado;
  `Gráfico:` no lugar de `Ativo:`), **marca d'água** por ativo atrás dos tijolos e as três faixas do topo
  apertadas. Verificado por tsc + build + browser (boleta 8/8) + 12 asserts headless dos símbolos
  (diário §9.1–9.5; tudo no commit `29bfab7`, 10 arquivos / 780 inserções). **Voltar por**:
  (1) 🧪 medir ao vivo as alturas das faixas e a leitura da marca d'água
  (a ponte do browser caiu antes dessa medição); (2) decidir se o config deve gravar a série contínua ou o
  vigente ao trocar de ativo (padrão atual: `WIN$N`); (3) alinhamentos da boleta-base — Pirâmide usa
  `pyramidTpPoints` e não obedece ao Alvo da boleta, gatilho do trailing (`trailingActivationPoints`) ainda
  não é linha editável, texto da pirâmide no AutomationPanel ainda diz "inversão zera o resto" (só vale
  para o robô); (4) validação na conta demo (item 🧪 abaixo).
- 🎨 **FASE REFINO VISUAL (desde 31/10)** — pente-fino no aspecto de todas as telas, um pedido por vez, sem
  mudar comportamento. Entregues: **Boleta** (`BoletaTicket.tsx`, Ciclo 8.8–8.13) — caixa única sobre o
  canvas, sempre visível, base editável + livro de hedge, offset pela largura real do canvas (nunca
  breakpoint cego); **Ciclo 9** — boleta em camadas com ⚙ na linha do título, os dois códigos do ativo
  rotulados, marca d'água por ativo e as três faixas do topo apertadas (header `py-1` com botões
  `py-1`/`py-0.5 text-[11px]`, tira `py-0.5`, barra do gráfico `h-7`, `main p-0.5 sm:p-1`); **Ciclo 10** —
  pente-fino da escala (nenhum "10R" soldado em card/título/auditoria/dossiê/script), `MiniSelect` na
  tira (velocidade e dias) e contrato vigente como padrão do gráfico.
- 🧪 **Validação na CONTA DEMO XP iminente** (primeiro contato real com a ponte). Antes dela, resolver o
  item 🔎 abaixo — os cinco pontos têm correção pequena e mudam o comportamento do feed.
- 🔎 **Simulador "sempre rodando": diagnóstico PRONTO, nenhuma linha mexida** (detalhe completo com
  números de linha em `EVOLUCOES_DETALHADAS.md` → Pendências, 31/10). Em resumo: a guarda do loop está
  certa (CONNECTED não vaza tick), mas (1) `isSimulating` nasce `true` sem persistência, (2) o mount
  effect semeia 350 ticks sintéticos sempre, (3) o **boot-replay dispara na abertura sem olhar a ponte**,
  (4) `generateNextTick()` não tem portão de pregão (roda 24/7), (5) disconnect/onerror/AUTH-recusado
  forçam `setIsSimulating(true)` — e o **buraco real**: `socket.onclose` nunca religa o feed, então queda
  da ponte = tela congelada sem aviso. Decidir cada correção COM o operador (ele é iniciante; explicar o
  efeito de cada uma em português simples). Extra: agressões da aba Simulador sem `disabled={mt5Live}`.
- 🧪 **Homologar WDO e BTC**: ele precisa trazer `pointValue`, `tickSize`, `decimals`, `primarySymbol` no
  MT5 da XP, horário de pregão e a profundidade de histórico da conta demo. Trocar `status` para
  `'ativo'` no `assetRegistry.ts` destrava o seletor sozinho (Fases 3–5: travas de horário por ativo,
  fix das 13:00 do WDO, gap de fim de semana do BTC, dossiê PDF sem texto fixo, VTC/PTAX no WDO).
- 🧪 **Histórico real nunca conferido com o MT5 da XP**: rodar o script novo no Windows, fazer 1 dia de
  replay conectado e ver se o chip sai `HISTÓRICO REAL (MT5)` com volume `TICK` ou `M1_RATE`.
- 🧪 Verificação de UI feita só por código/tsc/build — para conferir no navegador use o caminho sem
  corretora: apague as flags de migração em DevTools → Local Storage para retestar as migrações.
- SaaS/paywall sem backend; infra para "100 clientes" em aberto (cada cliente precisa do próprio Windows).
- Rotacionar o token da ponte e aplicar o firewall antes de qualquer conta real.
- Reconferir visualmente o card "Segurança da Ponte" após F5 (a verificação por navegador caiu no reload).

Leia `PROJECT_SUMMARY.md` e `EVOLUCOES_DETALHADAS.md`, alinhe o contexto e me avise quando estiver pronto.
