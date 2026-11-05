# SEED DO CICLO 16 — FLUXO & RENKO 10R · MT5 QUANT TERMINAL (B3 WIN$)

> **Como usar este arquivo em uma conversa nova**: cole o `CHAT_SEED.md` inteiro primeiro (ele é o contexto
> completo do projeto e já traz o ponto de retomada deste ciclo) e depois este arquivo — ou cole só este,
> que resume a evolução, as regras fixas e a lista de tarefas com critério de pronto. O "por que" de cada
> decisão está em `EVOLUCOES_DETALHADAS.md` (diário por ciclo) e o estado atual consolidado em
> `PROJECT_SUMMARY.md`. Leia os dois antes da primeira mudança.
>
> Commit deste ciclo: **`917cb76`** (pushado em `origin/main`, 05/11/2026).

---

## 1. Quem é o usuário e como trabalhar (resumo fixo)

- Brasileiro, **iniciante em programação**. Toda a UI, comentários e documentação **em português**.
- Edita no **Mac**; testa no **Windows** (MT5 + conta demo XP, onde roda a ponte Python) e no **celular
  Android via LAN**. Dev server: `npm run dev` na **porta 3000** com `--host=0.0.0.0` (se a 3000 estiver
  ocupada por servidor velho, o Vite sobe na 3001 — confira com `lsof -nP -iTCP:3000 -sTCP:LISTEN`).
- Regras que não se pode quebrar:
  1. `npx tsc --noEmit` limpo ao final de **toda** entrega; `npx vite build` quando mexer em config/App/canvas.
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
      (perfil, reset, import, sync, ativação) **força `active: false`**. O replay **nunca dispara sozinho**.
  11. Relógio do pregão só bloqueia **ordens reais e replay**; o simulador ao vivo roda 24h.
  12. **Limiar físico é o default** (`minDeltaThreshold = 100`); o **limiar adaptativo P60 do pregão** agora é
      **opt-in** (`adaptiveThresholdEnabled = false`) — ao vivo ele sufocava sinais ("SINAL FRACO").
  13. Todo bloqueio/espera vira frase honesta no balão ⚠, com anti-pisca. **E recusa de execução da ponte
      também** — a ponte não pode mais falhar em silêncio (ver `ORDER_RESULT` abaixo).
  14. No canvas, sinal é **▲ C / ▼ V** (papel é etiqueta: P1/P2/RET).
  15. **A `SavedStrategy` é o banco único; o config ativo é view.** `RUNTIME_KEYS` (`active`,
      `dataSourceMode`, `mt5Host`, `mt5Port`, `shadowRobot`, `lastSavedTimestamp`, `strategyId`) nunca
      entram na estratégia.
  16. **Informação vive em linha colapsável** (`CollapsibleSection`): **nenhum controle interativo dentro
      do cabeçalho** — ele é um `<button>`.
  17. **Threshold é calculado, não um número físico** — métricas de regime entram adimensionais (ER 0..1).
  18. **Dois relógios nunca viram uma linha só**: ordens reais usam **parede** (`Date.now`); sombra/coletor
      usam **tempo da barra** (`box.timeEnd`).
  19. **Default novo só chega a quem já gravou via migração guardada + toast** — `loadSavedConfig` faz
      `{...DEFAULT, ...salvo}` (gravado vence default); toda virada de chave em default exige uma migração
      idempotente (flag de feito) que só toca **PYRAMID com o valor-intocado-de-default-antigo**.

## 2. Evolução — para onde o projeto foi até aqui

| Ciclo | Data | Entrega central |
| --- | --- | --- |
| 1–5 | out/2026 | Terminal canvas (Renko 10R, Heikin-Ashi, Δ/CVD), ponte MT5, auditoria/equity/dossiê, estratégia Pirâmide, coletor multi-série |
| 6 | 29–30/10 | Ponte blindada (token/ARM/tetos), proteção da mãe em 2 estágios, divisores arrastáveis |
| 7 | 30/10 | Limiar adaptativo de regime, Avaliação Técnica, zoom multidia |
| 8 | 31/10 | Estúdio de Estratégias, níveis do pregão + VWAP, Registro de Ativo (WIN/WDO/BTC) |
| 8.9–8.13 | 31/10–01/11 | Boleta-base editável (6 steppers) e livro de hedge |
| 9 | 01/11 | Boleta em camadas, dois códigos do ativo rotulados, marca d'água |
| 10 | 02/11 | Robô 2 (Sombra) com escala própria + pente-fino da escala |
| 11 | 02/11 | Multi-robô: placa de magic por robô + R$/ponto por ativo |
| 12 | 02/11 | Terminal acorda parado, limiar P60 do pregão, relógio só para ordens reais, sync, varredura de órfãos |
| 13 | 02/11 | Refino de leitura: régua X no divisor, três ZERAR agrupados, Sombra acorda zerada, ▲C/▼V |
| 14 | 03/11 | FASE A: estratégia como banco de dados único + um só editor + telas em lista + régua X no gráfico |
| 15 | 04/11 | Livro de Rodadas + fluxo que adianta (cor pelo delta real, cinza = reversão E exaustão) + Filtro de Acumulação (ER) no funil do EA |
| **16** | **05/11** | **Funil afrouxado por bench (A/B/D/Δ) com migrações + Renko sem gaps (`closedBoxes`) + ponte que explica a recusa (`ORDER_RESULT`) + veredito da base real (`eaBaseReal`)** |

## 3. O Ciclo 16 em uma página (a entrega mais recente)

**Ponto de partida**: o operador reportou que o robô **"não estava enviando ordens automaticamente"**.
A investigação headless (bench 3 seeds) + o diagnóstico em código mostraram que não era um bug só — o funil
estava **apertado por três frentes** (filtro ER, corte adaptativo P60, Δ150) e a mãe **sem proteção**; e, no
caminho, descobriu-se que **a ponte MT5 falhava em silêncio** (a ordem passava da trava de risco e morria sem
volta). Quatro alavancas + um preenchimento Renko + um feedback da ponte fecharam o ciclo.

1. **Quatro alavancas nos defaults da Pirâmide**, cada uma com **migração guardada + toast** (regra 19):
   - **A — mãe no breakeven**: `moveMainToBreakevenOnPyramidTp = true` (`mainBreakevenMigration.ts`) — a cada
     TP de pirâmide executado, a posição-mãe sobe para o zero-a-zero (proteção de capital).
   - **B — filtro de acumulação OFF**: `consolidationFilterEnabled = false` (`consolidationFilterMigration.ts`)
     — o ER (herança do Ciclo 15) sobre-filtrava e silenciava scalps vencedores.
   - **D — limiar adaptativo OFF**: `adaptiveThresholdEnabled = false` (`adaptiveThresholdMigration.ts`) — o
     corte P60 sufocava sinais ao vivo ("SINAL FRACO") e inflava o DD.
   - **Δ — piso 150→100**: `minDeltaThreshold = 100` no **default e** no **preset Pirâmide**
     (`deltaThresholdMigration.ts`) — mais ordens e maior fator no bench.
   - `convergenceEvaluator.ts` agora lê `SESSION_PERCENTILE = config.adaptiveThresholdPercentile ?? 0.6`
     (campo novo **opcional** em `types/trading.ts`); sem adaptativo, o gate é `Math.max(50, minDeltaThreshold)`.
2. **Renko sem atraso/gaps** (`renkoCalculator.processTick`): um tick pode varrer **vários** níveis de box
   (cascata real, ou agressão no sintético calibrado). O laço fecha **TODOS** os boxes cobertos, na ordem, e
   devolve `closedBoxes[]`; App e `strategyLab` iteram `closedBoxes` dando a cada box o **sinal do próprio
   box** (nunca o "último sinal" do tick). Fim da coluna atrasando o preço e abrindo gaps.
3. **Ponte deixa de ser muda** (`pythonScriptGenerator.ts` + `App.tsx`): `execute_market_order` grava o motivo
   real em `ORDER_EXEC_NOTE` e o router devolve **`ORDER_RESULT {ok, ticket, reason, comment}`** após cada
   ordem; o app trata `ORDER_RESULT` e mostra **toast** (✅ executada / ⛔ recusada + motivo). Motivos
   cobertos: **janela de horário compilada no `.py`**, **símbolo fora do Market Watch**, **sem cotação agora**,
   **RetCode do MT5** (ex. 10027/10004 = sem Algo Trading). Antes a ordem passava da trava de risco e
   **morria em silêncio** — essa era a causa-raiz do "não chega nada no MT5".
4. **Veredito da base real** (`scripts/eaBaseReal.ts` → `vereditoBase`): a base baixada pela ponte chega como
   **`M1_RATE`** (proxy de preço OHLC), **não Time & Trades genuíno** → **não-calibrável** para limiares de
   fluxo. Calibrar o P60/Δ no real exige T&T real.

**Bench headless 3 seeds** (`eaBaseReal`/`strategyLab`): **A+B** expectativa **R$1,98 → 5,44/tr**, PF
**1,17 → 1,68**, DD **680 → 544**; **adaptativo OFF @ Δ150** derruba o DD em **~30%** com mais ordens e PF
igual/melhor; **Δ100** domina (PF **1,71 → 1,90**). Migrações validadas por asserts temporários
(**idempotentes e conservadoras** — não tocam quem mexeu manualmente); `.py` gerado passa em `py_compile`.

**Verificado**: `npx tsc --noEmit` limpo · `npx vite build` OK · asserts das migrações · `.py` em
`py_compile` (scripts temporários apagados). **NÃO verificado**: **nada foi conferido em tela nem na demo
XP**. **Bloqueio atual (FORA do código): a ponte MT5↔corretora não está conectando — o operador vai resolver
no lado dele e retorna.** Assim que conectar, o próximo passo natural é **re-baixar o `.py` novo** (Δ100 +
adaptativo OFF + `ORDER_RESULT`) e clicar comprar/vender para **ler o toast do motivo**.

## 4. Tarefas da próxima conversa (com critério de "pronto")

| # | Tarefa | Pronto quando… |
| --- | --- | --- |
| 1 | 🎯 **Restabelecer a conexão MT5↔corretora** (lado do operador) | a ponte fica **CONNECTED + ARMADA** (tooltip do ícone de rede) e uma ordem **manual** (botão comprar/vender) aparece no terminal |
| 2 | 👀 **Re-baixar e rodar o `.py` NOVO** e clicar comprar/vender | o toast **`ORDER_RESULT`** aparece com o motivo: *horário* → desligar "Horário de trading" em Ajustes e re-baixar; *RetCode 10027/10004* → ligar **Algo Trading** no MT5; *símbolo* → pôr no Market Watch |
| 3 | 👀 **Conferir em tela as 4 alavancas** | ao recarregar, os **toasts das migrações** disparam (A/B/D/Δ); chips refletindo adaptativo OFF e Δ100; a **mãe sobe ao breakeven** quando um TP de pirâmide fecha |
| 4 | 🧫 **Calibrar no real (só com T&T genuíno)** | existe base real de T&T; P60/Δ calibrados e registrados em `EVOLUCOES_DETALHADAS.md` — hoje a base é `M1_RATE` (não-calibrável, veredito em `eaBaseReal`) |
| 5 | 🌐 **Herdadas**: homologar WDO/BTC; fechar "Salvar como Perfil do Operador" (ainda no depósito antigo) | vencimento/código confirmados; perfil cria `SavedStrategy` direto no Estúdio |

## 5. Onde mora cada coisa (mapa rápido do Ciclo 16)

- `src/services/eaConfigService.ts` — **defaults das alavancas**: `moveMainToBreakevenOnPyramidTp=true`,
  `consolidationFilterEnabled=false`, `adaptiveThresholdEnabled=false`, `minDeltaThreshold=100`; **preset
  Pirâmide** com `minDeltaThreshold=100`.
- `src/types/trading.ts` — campo novo **opcional** `adaptiveThresholdPercentile?` (regime do limiar).
- `src/utils/convergenceEvaluator.ts` — `SESSION_PERCENTILE = config.adaptiveThresholdPercentile ?? 0.6`;
  gate PYRAMID/BUY-SELL usa `Math.max(50, minDeltaThreshold)` quando **sem** adaptativo.
- `src/utils/mainBreakevenMigration.ts` · `consolidationFilterMigration.ts` ·
  `adaptiveThresholdMigration.ts` · `deltaThresholdMigration.ts` — **4 migrações guardadas** (flag de feito
  idempotente; só PYRAMID intocada; cobrem `CONFIG_KEY` e `LIBRARY_KEY`).
- `src/App.tsx` — **boot**: importa/executa as 4 migrações (refs) + toasts escalonados; **handler
  `ORDER_RESULT`** no `ws.onmessage` (toast ✅/⛔ com motivo). **Não tocar** o comentário histórico do
  boot-replay antigo.
- `src/utils/renkoCalculator.ts` — `processTick` com **laço de preenchimento** fechando todos os boxes de um
  tick; retorna `closedBoxes[]` (+ `closedBox` "de cara" para retrocompatibilidade).
- `src/utils/pythonScriptGenerator.ts` — `ORDER_EXEC_NOTE` global; `execute_market_order` grava motivo por
  ramo (schedule/símbolo/cotação/RetCode); **router devolve `ORDER_RESULT`** após cada ordem.
- `scripts/eaBaseReal.ts` — `vereditoBase` (base `M1_RATE` = não-calibrável) + bench A/B/D/Δ.
- `scripts/strategyLab.ts` — consome `closedBoxes` (cada box com o sinal do próprio box).

## 6. Comandos

```bash
npx tsc --noEmit          # tem que sair limpo em toda entrega
npx vite build            # quando mexer em config/App/canvas/estilos
npm run dev               # porta 3000, --host=0.0.0.0 (3001 se a 3000 estiver ocupada)
npx tsx scripts/<nome>.ts # checagem headless de lógica pura (script temporário, apagado depois)
python -m py_compile <gerado.py>  # valida o script da ponte antes de rodar no Windows
```
