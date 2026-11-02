# SEED DO CICLO 10 — FLUXO & RENKO 10R · MT5 QUANT TERMINAL (B3 WIN$)

> **Como usar este arquivo em uma conversa nova**: cole o `CHAT_SEED.md` inteiro primeiro (ele é o
> contexto completo do projeto) e depois este arquivo — ou cole só este, que já traz o resumo da
> evolução e a lista de tarefas com critérios de pronto. Os detalhes de "por que cada coisa é do
> jeito que é" estão em `EVOLUCOES_DETALHADAS.md` (diário por ciclo) e o estado atual consolidado
> em `PROJECT_SUMMARY.md`. O assistente deve ler os dois antes da primeira mudança.

---

## 1. Quem é o usuário e como trabalhar (resumo fixo)

- Brasileiro, **iniciante em programação**. Toda a UI, comentários e documentação **em português**.
- Edita no **Mac**; testa no **Windows** (MT5 + conta demo XP, onde rodará a ponte Python) e no
  **celular Android via LAN**. Dev server: `npm run dev` na **porta 3002** com `--host=0.0.0.0`.
- Regras que não se pode quebrar:
  1. `npx tsc --noEmit` limpo ao final de TODA entrega; `npx vite build` quando mexer no gráfico/canvas.
  2. **Simulação, Coletor, Replay e Robôs Sombra jamais tocam a corretora real.**
  3. **Commitar/push somente quando ele pedir explicitamente.**
  4. Pedido claro = agir no alvo óbvio; não fazer pergunta de múltipla escolha à toa.
  5. Ser honesto sobre o que foi verificado e o que ficou sem teste — ele valoriza isso.
  6. Chrome neutro, cor só no acento; nenhum quadro de informação no canto inferior direito
     (aviso flutuante abre **no centro**).
  7. Controle do operador não depende de breakpoint (a boleta é caixa única sobre o canvas).
  8. A tela nunca anuncia um símbolo e desenha outro (`assetSymbols` é fonte única).
  9. Chip/métrica na tela é atalho para o parâmetro de origem — nunca número solto.

## 2. Evolução — para onde o projeto foi até aqui

| Ciclo | Data | Entrega central |
| --- | --- | --- |
| 1 | out/2026 | Terminal canvas: tijolos Renko 10R, Heikin-Ashi de fluxo, delta/CVD, simulador B3 |
| 2 | out/2026 | Ponte MT5 real com a XP (WebSocket + script Python) |
| 3 | out/2026 | Auditoria intraday, Equity, perfis, dossiê PDF |
| 4 | out/2026 | Estratégia **Pirâmide & Confluência** (ordem mãe + pirâmides com TP) |
| 5 | out/2026 | Coletor multi-série, simulador, raio-X, navegação mobile 2.0 |
| 6 | 29–30/10 | **Ponte blindada** (AUTH/token/ARM/tetos), proteção da mãe em 2 estágios, dois divisores arrastáveis no gráfico |
| 7 | 30/10 | **Limiar adaptativo de regime** (`sessionRegime`), aba Avaliação Técnica, replay com dia anterior estático, zoom multidia |
| 8 | 31/10 | **Estúdio de Estratégias** (biblioteca versionada), níveis do pregão + VWAP, **Registro de Ativo** (Fases 1–2: WIN/WDO/BTC, histórico real pela ponte), toast central |
| 8.9–8.13 | 31/10–01/11 | **Boleta-base** editável (6 steppers), livro de hedge, Estúdio "Puxar da boleta" |
| 9 | 01/11 | Refino visual: boleta em camadas (⚙ na linha do título), **os dois códigos do ativo rotulados** (`WIN$N série` · `WINZ26 vigente`), **marca d'água** por ativo, faixas do topo apertadas |
| **10** | **02/11** | **ROBÔ 2 (SOMBRA)** + pente-fino da escala + contrato vigente no gráfico (detalhe abaixo) |

### O Ciclo 10 em uma página (a entrega mais recente)

**Robô 2 (sombra)** — segundo robô em **papel**, independente do principal:

- Estratégia escolhida da **biblioteca do Estúdio** + **escala Renko própria em R (15R/20R/25R)**.
  O que persiste é o **R**; o box em pontos deriva na hora por `boxPointsForR(scaleR, asset)`
  (WIN 20R = 100 pts; WDO 20R = 10 pts) — assim o relatório continua comparável após trocar de ativo.
- **Motor de barras, CVD e medidor de regime exclusivos** (`RenkoFlowEngine` próprio no App), mas o
  sinal vem do **mesmo** `evaluateBoxConvergence` do terminal e a contabilidade do **mesmo**
  `PaperStrategyBot` do coletor — uma matemática só, nenhum regra paralela.
- Roda **ao vivo, no replay e com o robô principal desligado** (ignora `config.active` de propósito).
- **Blindagem por estrutura, não por condição**: o service não tem socket, não tem `setOrders`, não
  tem callback de dispatch — não existe caminho do código da sombra até a corretora, nem por refactor.
- Persistência dia-a-dia em `fluxo_shadow_robot_v1` (mesmas regras do coletor: rotação de dia,
  batch no replay, dia `real` protegido do replay, marcação a mercado, CSV BR com BOM).
- Config em `AutomationConfig.shadowRobot` (`{enabled, strategyId, scaleR}`), com
  `normalizeShadowRobot()` sanitizando **na leitura** (config velho/lixo cai no padrão desligado 20R).
- **Telas**: chip `+ Sombra` na 3ª linha da tira de status (PnL colorido; hover com escala/ativo/
  trades/win rate/DD) + janela flutuante com `ShadowRobotPanel` (ligar, estratégia, 15R/20R/25R,
  CSV, zerar) · seção **"Robô 2 (sombra)"** com curva de capital no **Comparativo** · bloco
  dedicado em **Parâmetros** · botão **"Robô 2"** no menu mobile.
- `paperStrategyBot.ts` ganhou `BotKey = SeriesKey | 'shadow'` (identidade ampliada sem quebrar os
  `Record<SeriesKey, …>` do coletor). `renkoCalculator.ts` ganhou `getBoxPoints()` (conferir escala).

**Pente-fino que entrou junto**:

- Nenhum rótulo "10R" soldado: `RenkoBoxCard`, `OrdersAndStats`, `IntradayOrderAudit`, dossiê PDF,
  `PythonScriptView` e o **script Python gerado** leem `renkoScaleLabel(config.boxPoints, asset)`.
- `MiniSelect.tsx`: velocidade do simulador (5 chips → 1 caixa) e dias do replay na tira.
- `chartContractMigration.ts` (flag `fluxo_chart_vigente_v1`): o gráfico abre o **contrato vigente**
  (`WINZ26`); só reescreve `symbol` exatamente igual à contínua — vencimento digitado à mão nunca é
  tocado; WDO/BTC sem vigente confirmado ficam intactos.
- Asserts permanentes: `scripts/renkoBoxScaleAssert.ts`, `scripts/chartContractAssert.ts`.

**Como foi verificado (Ciclo 10)**: espelho headless sombra 20R × coletor `renko20r` = **271 boxes /
269 trades idênticos, zero divergência**; teste de persistência com processo espelho do storage
(179 trades, R$ 3.970 e metadados sobrevivendo a F5); `normalizeShadowRobot` contra undefined/parcial/
impossível; WIN→WDO rederivando 20R de 100 para 10 pts; tsc + build limpos.

## 3. TAREFAS DA PRÓXIMA CONVERSA (em ordem de prioridade)

### T1 — Conferir no navegador as três pendências visuais do Ciclo 10 🧪
- **Fazer**: com `npm run dev` de pé, (a) rodar um replay e ver a sombra operar lado a lado com o
  coletor na tela (chip, janela flutuante, curva no Comparativo); (b) ligar a sombra com o **robô
  principal OFF**, dar F5 e conferir que corrida + contabilidade continuam; (c) abrir no celular
  (ou narrow) e ver se o chip `+ Sombra` não estoura a 3ª linha da tira.
- **Pronto quando**: as três vistas, com console limpo; qualquer divergência = bug novo, registrar
  no diário como limitação (⚠️) e corrigir antes da T2.

### T2 — Fase 2 do multi-robô: `magicNumber` por robô + filtro na ponte 🔴 (próximo passo de arquitetura)
- **Contexto**: a decisão do operador é que robôs sejam **totalmente independentes inclusive no
  gráfico do MT5** — cada robô com magic number próprio, para um nunca fechar posição do outro.
  Hoje existe **um** magic global no config e a ponte não filtra por magic.
- **Fazer** (em cima do que já existe):
  1. Magic por robô no config/tipos (ex.: `magicNumber` do principal + derivados por estratégia).
  2. `comment`/magic chegando no payload de ordem do script gerado (`pythonScriptGenerator.ts` —
     o `.py` **não existe no repo**, é gerado em runtime; mexer sempre no gerador).
  3. Filtro por magic ao listar/fechar posições na ponte; `CLOSE_POSITIONS`/ZERAR **por lado e por
     magic**, nunca "fechar tudo do símbolo".
  4. Conferir o `point value`: `POINT_VALUE_BRL` soldado em R$0,20 no script (só WIN) → ler do
     registro por ativo.
- **Pronto quando**: headless assert provando que dois mágicos diferentes não se enxergam;
  `python3 -m py_compile` no script gerado; tsc + build limpos. **Só depois disso a sombra pode
  cogitar ordem real — e mesmo assim, primeiro na demo.**

### T3 — Validação na CONTA DEMO XP (primeiro contato real com a ponte) 🧪
- Antes: girar o token da ponte ("Gerar token novo" no Guia), aplicar a regra de firewall da porta
  8765, e resolver o diagnóstico pendente do simulador "sempre rodando" (5 pontos listados no
  `CHAT_SEED.md` §6, item 🔎 — decidir cada correção **com** o operador, em português simples).
- Rodar o script no Windows, replay de 1 dia conectado, e conferir se o chip sai
  `HISTÓRICO REAL (MT5)` com volume `TICK`/`M1_RATE`.

### T4 — Homologar WDO (e depois BTC) 🧪
- Trazer do MT5 da XP: `pointValue`, `tickSize`, `decimals`, `primarySymbol`/vigente, horários de
  pregão e profundidade de histórico. Trocar `status` para `'ativo'` no `assetRegistry.ts` destrava
  o seletor sozinho. Restos da Fases 3–5: travas de horário por ativo, fix das 13:00 do WDO, gap de
  fim de semana do BTC, dossiê PDF sem texto fixo, VTC/PTAX no WDO.

### T5 — Alinhamentos conhecidos da boleta-base (carregados do Ciclo 9)
- Pirâmide usa `pyramidTpPoints` e **não obedece ao Alvo da boleta**; gatilho do trailing
  (`trailingActivationPoints`) ainda não é linha editável; texto da pirâmide no AutomationPanel
  ainda diz "inversão zera o resto" (só vale para o robô); decidir se o config grava contínua ou
  vigente ao trocar de ativo; medir ao vivo as alturas das faixas e a leitura da marca d'água.

### T6 — Infra/pendentes de fundo (sem data)
- SaaS/paywall continuam **maquete em localStorage** — precisam de backend antes de cobrar de
  alguém; cada cliente precisará do próprio Windows para a ponte.
- A linha de decisão do **terceiro traço do gráfico** está reservada para multi-ativo (roadmap),
  não para um terceiro robô no mesmo símbolo.

## 4. Onde mora cada coisa (mapa rápido do Ciclo 10)

```text
src/services/shadowRobotService.ts   # runner da sombra: configure / processClosedBox / markToMarket /
                                     # batch / CSV / snapshot (useSyncExternalStore) — 0 referências à ponte
src/components/ShadowRobotPanel.tsx  # painel (variantes `window` e `page`)
src/components/RenkoFlowChart.tsx    # chip `+ Sombra` + DadosPanelWindow da sombra
src/components/SeriesComparisonView.tsx # seção "Robô 2 (sombra)" + ShadowEquityChart
src/components/AutomationPanel.tsx   # bloco do Robô 2 dentro de Parâmetros
src/components/MiniSelect.tsx        # caixa compacta (velocidade/dias)
src/types/trading.ts                 # ShadowScaleR, ShadowRobotConfig, AutomationConfig.shadowRobot
src/services/eaConfigService.ts      # DEFAULT_SHADOW_ROBOT, SHADOW_SCALE_CHOICES, normalizeShadowRobot
src/utils/paperStrategyBot.ts        # BotKey = SeriesKey | 'shadow'
src/utils/renkoCalculator.ts         # getBoxPoints() (conferir escala do engine)
src/assets/chartContractMigration.ts # contínua gravada → vigente (flag fluxo_chart_vigente_v1)
src/App.tsx                          # shadowEngineRef / ensureShadowEngine / feedShadowEngine /
                                     # configure effect / feeds ao vivo + replay + menu "Robô 2"
scripts/renkoBoxScaleAssert.ts       # assert permanente de escala
scripts/chartContractAssert.ts       # assert permanente da migração de contrato
```

## 5. Checklist de toda entrega (padrão do projeto)

```bash
npx tsc --noEmit          # limpo, sempre
npx vite build            # quando mexer em canvas/estilos
npx tsx scripts/<x>.ts    # asserts headless; scripts temporários são APAGADOS depois da entrega
git status                # commit/push SOMENTE quando ele pedir
```

Ao fim de cada ciclo: atualizar o diário (`EVOLUCOES_DETALHADAS.md`, novo §Ciclo N), o
`PROJECT_SUMMARY.md` (estado atual + árvore + chaves de localStorage) e o `CHAT_SEED.md`
(pilares/estrutura/pendências), com evidência honesta do que foi e não foi verificado.
