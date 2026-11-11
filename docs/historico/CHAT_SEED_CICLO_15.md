# SEED DO CICLO 15 — FLUXO & RENKO 10R · MT5 QUANT TERMINAL (B3 WIN$)

> **Como usar este arquivo em uma conversa nova**: cole o `CHAT_SEED.md` inteiro primeiro (ele é o contexto
> completo do projeto e já traz o ponto de retomada deste ciclo) e depois este arquivo — ou cole só este,
> que resume a evolução, as regras fixas e a lista de tarefas com critério de pronto. O "por que" de cada
> decisão está em `EVOLUCOES_DETALHADAS.md` (diário por ciclo) e o estado atual consolidado em
> `PROJECT_SUMMARY.md`. Leia os dois antes da primeira mudança.
>
> Commit deste ciclo: **`d5d5a02`** (pushado em `origin/main`, 04/11/2026).

---

## 1. Quem é o usuário e como trabalhar (resumo fixo)

- Brasileiro, **iniciante em programação**. Toda a UI, comentários e documentação **em português**.
- Edita no **Mac**; testa no **Windows** (MT5 + conta demo XP, onde roda a ponte Python) e no **celular
  Android via LAN**. Dev server: `npm run dev` na **porta 3000** com `--host=0.0.0.0` (se a 3000 estiver
  ocupada por servidor velho, o Vite sobe na 3001 — confira com `lsof -nP -iTCP:3000 -sTCP:LISTEN`).
- Regras que não se pode quebrar:
  1. `npx tsc --noEmit` limpo ao final de **toda** entrega; `npx vite build` quando mexer em canvas/estilos.
  2. **Simulação, Coletor, Replay e Robôs Sombra jamais tocam a corretora real.**
  3. **Commitar/push somente quando ele pedir explicitamente.**
  4. Pedido claro = agir no alvo óbvio; não fazer pergunta de múltipla escolha à toa.
  5. Ser honesto sobre o que foi verificado e o que ficou sem teste.
  6. Chrome neutro, cor só no acento; nenhum quadro de informação no canto inferior direito (aviso
     flutuante abre **no centro**).
  7. Controle do operador **não depende de breakpoint**: nada de par `lg:hidden` + `hidden lg:flex`.
  8. A tela nunca anuncia um símbolo e desenha outro; header e tira de status lêem do **mesmo memo**.
  9. Chip/métrica na tela é atalho para o parâmetro de origem — nunca número solto.
  10. **O terminal acorda PARADO e VAZIO** — nada se auto-inicia no mount; carregar config inteiro
      (perfil, reset, import, sync, ativação) **força `active: false`**. O replay **nunca dispara sozinho**
      na abertura (regra reforçada no Ciclo 15 ao corrigir textos defasados).
  11. Relógio do pregão só bloqueia **ordens reais e replay**; o simulador ao vivo roda 24h.
  12. Limiar de sinal é **calculado do pregão** (P60 dos |Δ|), `minDeltaThreshold` é só fallback.
  13. Todo bloqueio/espera vira frase honesta no balão ⚠, com anti-pisca.
  14. No canvas, sinal é **▲ C / ▼ V** (papel é etiqueta: P1/P2/RET).
  15. **A `SavedStrategy` é o banco único; o config ativo é view.** `RUNTIME_KEYS` (`active`,
      `dataSourceMode`, `mt5Host`, `mt5Port`, `shadowRobot`, `lastSavedTimestamp`, `strategyId`) nunca
      entram na estratégia.
  16. **Informação vive em linha colapsável** (`CollapsibleSection`): **nenhum controle interativo dentro
      do cabeçalho** — ele é um `<button>`.
  17. **Threshold é calculado, não um número físico** — métricas de regime entram adimensionais (ex.: o
      Efficiency Ratio do Ciclo 15 é razão |deslocamento líquido| / Σ|passo|, 0..1, não pontos/centavos).
  18. **Dois relógios nunca viram uma linha só**: ordens reais usam **relógio de parede** (`Date.now`);
      sombra/coletor (PaperTrade) usam **tempo da barra** (`box.timeEnd`). No Livro de Rodadas cada ação
      carrega `clock: 'wall' | 'bar'` e a ordenação é **agrupada por relógio**.

## 2. Evolução — para onde o projeto foi até aqui

| Ciclo | Data | Entrega central |
| --- | --- | --- |
| 1–5 | out/2026 | Terminal canvas (Renko 10R, Heikin-Ashi, Δ/CVD), ponte MT5, auditoria/equity/dossiê, estratégia Pirâmide, coletor multi-série |
| 6 | 29–30/10 | Ponte blindada (token/ARM/tetos), proteção da mãe em 2 estágios, divisores arrastáveis |
| 7 | 30/10 | Limiar adaptativo de regime, Avaliação Técnica, zoom multidia |
| 8 | 31/10 | **Estúdio de Estratégias**, níveis do pregão + VWAP, Registro de Ativo (WIN/WDO/BTC) |
| 8.9–8.13 | 31/10–01/11 | Boleta-base editável (6 steppers) e livro de hedge |
| 9 | 01/11 | Boleta em camadas, dois códigos do ativo rotulados, marca d'água |
| 10 | 02/11 | **Robô 2 (Sombra)** com escala própria + pente-fino da escala |
| 11 | 02/11 | Multi-robô: placa de magic por robô + R$/ponto por ativo |
| 12 | 02/11 | Terminal acorda parado, limiar P60 do pregão, relógio só para ordens reais, sync, varredura de órfãos |
| 13 | 02/11 | Refino de leitura: régua X no divisor, três ZERAR agrupados, Sombra acorda zerada, ▲C/▼V |
| 14 | 03/11 | FASE A: estratégia como banco de dados único + um só editor + telas em lista + régua X no gráfico |
| **15** | **04/11** | **Livro de Rodadas (auditoria por corrida das 3 automações) + fluxo que adianta (cor pelo delta real, cinza = reversão E exaustão) + Filtro de Acumulação (ER) no funil do EA** |

## 3. O Ciclo 15 em uma página (a entrega mais recente)

**Ponto de partida**: o indicador de fluxo (Heikin-Ashi desenhado a partir de Time & Trades / CVD) parecia
**sempre atrasado**, e as perdas se concentravam em **regiões de acumulação com range curto** (vários stops
no serrote). Duas frentes: deixar o visual **liderar** e transformar esse leitura em **filtro de métricas do
EA** — "o visual nós adaptamos, mas as métricas do EA não".

1. **Livro de Rodadas** (`roundAuditService.ts` **novo** + `App.tsx` + `SimulatorView.tsx`): auditoria
   **persistente por corrida** que integra as três automações (robô real, Sombra e Coletor) num só livro —
   contagens, book, shadow, collector e a linha do tempo de ações. A **revisão de código** (subagente único)
   trouxe as correções de robustez:
   - **Dois relógios separados**: cada `RoundAction` carrega `clock: 'wall' | 'bar'`; a ordenação é
     **agrupada por relógio** (parede primeiro, depois barra) — nunca uma linha serial misturando os dois.
   - **`liveMix`**: quando o MT5 está CONNECTED durante um replay, ticks vivos contaminariam o snapshot de
     sombra/coletor — a rodada é marcada e um **banner** avisa na tela.
   - **Parse defensivo** do `localStorage`: aceita só arrays bem-formados (filtra registros sem `id`,
     `actions`, `counts`, `book`, `shadow`, `collector`).
   - Legenda honesta do **CSV** (traz as primeiras 500 linhas quando o cap bate) e tooltip do **Livro real**
     (só entram posições **ABERTAS** nesta corrida).
2. **Indicador de fluxo sem atraso** (`RenkoFlowChart.tsx`): a **cor** do candle Heikin-Ashi passou a ser
   governada pelo **delta real do box** contra `minDeltaThreshold * (b.regimeFactor ?? 1)` — **a mesma porta
   do histograma do robô** — mantendo a **forma** do Heikin-Ashi só como contexto. O painel é **visual** (o
   robô entra por direção + limiar de delta, não por estado HA), então mexer na cor não toca as ordens.
   - **Cinza = reversão E exaustão**: uma caixa no **mesmo lado** da anterior mas **perdendo força**
     (`|Δ| ≤ |Δ_prev| * EXHAUST_DECAY_RATIO`, padrão **0.7**) vira `REVERSAL` (cinza), não só quando inverte.
     `EXHAUST_DECAY_RATIO` é **um único botão**: mais baixo = só exaustão severa; mais alto = mais sensível.
   - O **HUD** (`activeBoxHaState`) espelha exatamente a mesma regra (mesmo limiar, mesma razão).
3. **Filtro de Acumulação (F2) no EA** (`convergenceEvaluator.ts` + `types/trading.ts` + `eaConfigService.ts`
   + `AutomationPanel.tsx` + `StrategyStudio.tsx`): as duas leituras viram **porta de entrada de sinal** no
   funil **único** `evaluateBoxConvergence` — que é consumido igualmente pelo **robô real** (via
   `RenkoFlowEngine.checkClosedBox`), pela **Sombra** (re-executa em `shadowRobotService.processClosedBox`) e
   pelo **Coletor** (`paperStrategyBot.onClosedBox` recebe o sinal já avaliado). Uma mudança só, três
   automações.
   - **Efficiency Ratio** de Kaufman sobre as últimas `consolidationLookbackBoxes` (padrão **10**) closes:
     `|deslocamento líquido| / Σ|passo|`. Abaixo de `consolidationErMax` (padrão **0.30**) = **acumulação** →
     bloqueia a entrada. **Warm-up**: retorna 1 (nunca bloqueia) até a janela ter todas as caixas.
   - **Gate de exaustão**: `isExhaustedFlow` (mesma lógica do cinza) bloqueia quando `exhaustionFilterEnabled`.
   - **5 chaves novas** no `AutomationConfig`/`DEFAULT_EA_CONFIG` **com default OFF** (opt-in): não mudam
     nenhuma ordem até o operador ligar. Propagam-se sozinhas para a `SavedStrategy` (não há whitelist a
     enumerar; `mergeConfig = {...DEFAULT, ...patch}` e `splitStrategyPatch` roteiam o que não é runtime).
   - **UI**: Ajustes → Gatilho de Disparo → bloco **"Filtro de Acumulação"** (2 checkboxes + sliders de
     janela/ER/razão); o **ER é a alavanca principal**. Resumo aparece na linha colapsável e no retrato do
     Estúdio (label "· anti-acumulação").

**Bugs/textos corrigidos no caminho**: o UI ainda dizia que o replay "**dispara sozinho na abertura**" —
contradição direta com o Ciclo 12 ("terminal acorda parado e vazio"). Corrigido em `SimulatorView.tsx` e em
duas regiões de `App.tsx` (comentário JSX + tooltip `title`); o comentário **histórico** em `App.tsx` que
descreve um boot-replay **removido** foi mantido de propósito (narra o passado com precisão).

**Verificado**: `npx tsc --noEmit` limpo · `npx vite build` OK · **asserts headless do Livro 5/5** e
**bench A/B do Filtro 6/6** (ambos em `scripts/_*.ts` temporários, apagados depois). Bench: pregão **SERRADO**
**60 entradas / 59 flips / PnL −590 → 9 / 8 / −90** (cortou ~86% do serrote); **TENDÊNCIA** e
**TENDÊNCIA+PULLBACK** ficaram **idênticos** ligado/desligado (sem falso positivo, sem perder movimento bom).
**NÃO verificado**: nada foi conferido em tela nem na conta demo XP.

## 4. Tarefas da próxima conversa (com critério de "pronto")

| # | Tarefa | Pronto quando… |
| --- | --- | --- |
| 1 | 👀 **Conferir em tela o Ciclo 15 inteiro** | o fluxo **não** parece mais atrasado (cor acompanha o delta real); cinza aparece na **exaustão** (mesmo lado, força caindo) e não só na inversão; o **Livro de Rodadas** grava/retorna entre reloads com banner de `liveMix` quando o MT5 está ligado; o bloco **"Filtro de Acumulação"** abre/age na UI |
| 2 | 🎚️ **Calibrar `consolidationErMax` e a janela com pregões reais** (o 0.30 veio de dado sintético) | ER/olhando 5 dias reais: cortam o serrote sem suprimir tendência — número definitivo registrado em `EVOLUCOES_DETALHADAS.md` |
| 3 | 🧪 **Testar o Filtro de Exaustão ligado junto** na sombra com replay 5d | comparação OFF/ON com números e a conclusão escrita no diário |
| 4 | 🧫 **Primeira coleta real na demo XP** (5 dias pela ponte) | `hadRealData` marcado, livro de auditoria preenchido, nenhum sintético rotulado como real |
| 5 | 🔧 **Fechar o resquício de duplicidade do Ciclo 14**: "Salvar Configuração Atual como Perfil do Operador" ainda grava no depósito antigo de presets | ou cria direto uma `SavedStrategy` no Estúdio, ou fica decidido por escrito |
| 6 | 🌐 Homologar WDO e BTC | vencimento/código confirmado (hoje `A CONFIRMAR`, só ensaio) |

## 5. Onde mora cada coisa (mapa rápido do Ciclo 15)

- `src/services/roundAuditService.ts` — **o Livro de Rodadas** (novo): `RoundRecord`, `RoundAction`
  (com `clock: 'wall' | 'bar'`), `BuildRoundInput` (com `liveMix`), ordenação agrupada por relógio, parse
  defensivo, cap de 500 no CSV.
- `src/App.tsx` — monta a rodada (`buildRound`, agora com `liveMix: mt5State.status === 'CONNECTED'`);
  textos do replay corrigidos. **Não tocar** o comentário histórico do boot-replay antigo.
- `src/components/SimulatorView.tsx` — tela do livro: rótulo de relógio por ação (`tela`/`barra`), banner de
  `liveMix`, legenda dos dois relógios, tooltip "Livro real", texto "acorda parada e vazia".
- `src/components/RenkoFlowChart.tsx` — **cor do HA = delta real vs limiar adaptativo**; `EXHAUST_DECAY_RATIO`
  (const de módulo) → cinza = reversão **e** exaustão; `activeBoxHaState` do HUD espelhado.
- `src/utils/convergenceEvaluator.ts` — **funil único de sinal**; ganhou `efficiencyRatio()` +
  `isExhaustedFlow()` + `regimeBlock` (`consolidating || exhausting`) aplicado nos ramos PYRAMID UP/DOWN e no
  BUY/SELL clássico. Vale para robô real + Sombra + Coletor.
- `src/types/trading.ts` — `consolidationFilterEnabled`, `consolidationLookbackBoxes` (10),
  `consolidationErMax` (0.30), `exhaustionFilterEnabled`, `exhaustionDeltaRatio` (0.7).
- `src/services/eaConfigService.ts` — as 5 chaves em `DEFAULT_EA_CONFIG` (OFF) + merge em `loadSavedConfig`.
- `src/components/AutomationPanel.tsx` — bloco **"Filtro de Acumulação"** (checkboxes + sliders) + resumo na
  linha colapsável.
- `src/components/StrategyStudio.tsx` — `thresholdLabel` com "· anti-acumulação" + Rows no DetailSection
  "Fluxo & Regime".

## 6. Comandos

```bash
npx tsc --noEmit          # tem que sair limpo em toda entrega
npx vite build            # quando mexer em canvas/estilos
npm run dev               # porta 3000, --host=0.0.0.0 (3001 se a 3000 estiver ocupada)
npx tsx scripts/<nome>.ts # checagem headless de lógica pura (script temporário, apagado depois)
```
