# 🚀 PROMPT MESTRE DE CONTINUIDADE & CONSOLIDAÇÃO DO PROJETO
## Para migração / inicialização em um Novo Bate-Papo (Chat Seed)

> **Instruções ao Usuário**: para continuar este projeto em um bate-papo novo sem perder contexto, cole o bloco delimitado abaixo como primeira mensagem.
> O estado atual detalhado está em `PROJECT_SUMMARY.md` e o "porquê" de cada decisão está em `EVOLUCOES_DETALHADAS.md` — o assistente deve ler os dois.

---

\`\`\`markdown
# CONTEXTO DE CONTINUIDADE: FLUXO & RENKO 10R — MT5 QUANT TERMINAL (B3 WIN$)

Você está assumindo o projeto **Fluxo & Renko 10R - MT5 Quant Terminal**: aplicação web de trading
quantitativo para Mini-Índice B3 (`WIN$`), que envia ordens automatizadas ao MetaTrader 5 por uma
ponte WebSocket em Python.

## 0. QUEM É O USUÁRIO E COMO TRABALHAR
- Brasileiro, iniciante em programação. **Toda a UI, comentários e documentação em português.**
- Duas máquinas: **Mac** (aqui, onde o código é editado) e **Windows** (MT5 + conta demo XP, onde roda
  o script Python da ponte). Testa também no **celular Android via LAN**.
- Servidor: `npm run dev` na **porta 3002** com `--host=0.0.0.0` (para abrir de outros aparelhos).
- Regras fixas:
  1. Rodar `npx tsc --noEmit` ao final de cada entrega (e `npx vite build` quando mexer no gráfico/canvas).
  2. **Simulação, Coletor, Replay e Robôs Sombra jamais podem tocar a corretora real.**
  3. **Commitar e fazer push somente quando ele pedir explicitamente.**
  4. Preferir agir no alvo óbvio a fazer pergunta de múltipla escolha quando o pedido for claro.
  5. Ser honesto sobre o que foi verificado e o que não foi — ele valoriza saber o que ficou sem teste.

## 1. PILARES DA ESTRATÉGIA
1. **Renko 10R = 50 pontos** por box; reversão exige 2 boxes (100 pts); corpo 100% sólido
   (`#10b981` / `#ef4444`), pavios centralizados; aproximação temporal progressiva dos boxes.
2. **Fluxo tick-a-tick**: delta por box, CVD, filtro `minDeltaThreshold` (ex.: 250 contratos).
3. **Duas estratégias selecionáveis**:
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
8. **Simulador & Replay**: feed autônomo B3; replay **progressivo** (1x ≈ 2,0 s/tick, um dia ≈ 1min45;
   10x ≈ 5 s); modo **OPERA** roda a estratégia de verdade pelo mesmo `handleIncomingTick` do terminal.
9. **Gráfico** (canvas, `RenkoFlowChart.tsx`): só **Pontos (Renko)** e **Range** como séries desenháveis
   (Tempo saiu do gráfico, ficou no coletor). **Dois divisores arrastáveis idênticos** (linha + alça +
   3 pontos + destaque verde no hover/arraste): preço↔fluxo (`flowPaneRatio` 18–55%, padrão 33%) e, no
   modo Heikin-Ashi, **Heikin-Ashi↔histograma** (`haHistSplit` 30–85%, padrão 66%). Os dois arrastam com
   o **dedo** no mobile (tolerância 12 px). Hit-test único via `getFlowDividerLayout()` — desenho, cursor,
   mouse e toque compartilham a mesma matemática. **Escalas adaptativas com passo "limpo"**
   (1/2/2,5/5/10 × 10ⁿ) no preço, no Heikin-Ashi e no histograma (régua `+50Δ` / `1.2kΔ`); grades e badges
   presos à própria banda; etiquetas de faixa em desktop (`PREÇO · RENKO`, `FLUXO · HEIKIN-ASHI`,
   `HISTOGRAMA · DELTA`). Duplo clique reseta cada divisor; escalas persistidas.
10. **Heikin-Ashi de fluxo tricolor**: 🟢 subida contínua de agressão compradora, 🔴 descida contínua
    vendedora, ⚪ reversão/indecisão/absorção.
11. **Linhas de ordem no gráfico** com tags (`🟢 COMPRA MÃE (SURFE)`, `🔺 PIRÂMIDE #N (+50p TP)`,
    `⏳ RETESTE LIMITE`, `🎯 PARCIAL`, `🛡️ SL BREAKEVEN`, `🏁 TAKE PROFIT`), badges no eixo Y e setas de
    borda quando SL/TP saem do zoom. `openOrders` inclui `OPEN` **e** `PENDING_LIMIT`.
12. **Auditoria intraday** (`IntradayOrderAudit` + `orderAuditService`): trilha por ordem, filtros,
    timeline e CSV padrão BR (UTF-8 **com BOM**, `;`).
13. **SaaS & Admin Master** (`authService`, `AdminPanel`, `SubscriptionPaywall`): ⚠️ ainda **maquete em
    `localStorage`**, sem backend. Admin: `marcos.a.camargo@gmail.com`, vitalício.
14. **Dossiê executivo em PDF** (`ProjectDossierPdfModal`, `@media print`, A4).

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
- O app detecta ponte antiga quando `ACCOUNT_INFO` chega **antes** de `AUTH_RESULT` (flag `bridgeLegacy`).
- Token: `src/utils/bridgeSecurity.ts`, 28 caracteres via `crypto.getRandomValues`, chave
  **`fluxo_bridge_token_v1`** — **deliberadamente fora do `AutomationConfig`** para preset/import JSON
  nunca sobrescreverem nem exportarem o segredo. UI no card "Segurança da Ponte" (aba Guia) com mostrar,
  copiar, rotacionar, os dois tetos e o comando `New-NetFirewallRule`. Header mostra `· ARMADO` / `· SEGURO`.

## 3. STACK & ESTRUTURA REAL DE ARQUIVOS
React 19 + Vite + TypeScript (sem `strict`) + Tailwind CSS v4 + lucide-react + Recharts. `main.tsx` **sem
StrictMode** (senão os loops de tick duplicam).

\`\`\`text
src/
├── App.tsx                       # ≈3.0k linhas: ticks, ordens, WebSocket MT5, abas, bottom nav, toast discreto
├── types/{trading,auth,drawing}.ts
├── services/
│   ├── eaConfigService.ts        # config + presets + perfis + merge defensivo de defaults
│   ├── orderAuditService.ts      # auditoria + CSV BR
│   ├── seriesCollectorService.ts # coletor multi-série, marca real/replay
│   └── authService.ts            # SaaS (localStorage)
├── utils/
│   ├── renkoCalculator.ts        # boxes Renko, delta/CVD por box, Heikin-Ashi
│   ├── barEngines.ts             # motores de barra por série
│   ├── convergenceEvaluator.ts   # confluência preço × fluxo
│   ├── marketSimulator.ts        # feed simulado WIN$
│   ├── paperStrategyBot.ts       # robô sombra (espelho das regras do terminal)
│   ├── sessionRules.ts           # trava 17:30 → 18:05
│   ├── bridgeSecurity.ts         # token da ponte
│   └── pythonScriptGenerator.ts  # gera o .py da ponte com AUTH/ARM/tetos
└── components/
    ├── RenkoFlowChart.tsx (≈2.4k linhas), ChartControlSidebar, DadosPanelWindow, RenkoBoxCard,
    │   DrawingOverlay, DrawingToolbar
    ├── AutomationPanel.tsx       # Ajustes em BLOCOS por estratégia (Pirâmide tem bloco dedicado:
    │                             #   🏄 Ordem Mãe · 🔺 Pirâmides · 🔄 Regras de Saída com "🛡️ Proteção da Ordem Mãe")
    ├── SimulatorView, SeriesComparisonView, TimesAndTrades, EquityCurveView, OrdersAndStats,
    │   IntradayOrderAudit
    ├── Header, PythonScriptView, DocumentationView, ProjectDossierPdfModal
    └── AdminPanel, SubscriptionPaywall, SubscriptionStatusBadge
\`\`\`

Chaves de `localStorage`: `fluxo_renko_ea_config_v3`, `fluxo_renko_ea_profiles_v3`,
`fluxo_renko_chart_scales_v2` (inclui `haHistSplit`), `fluxo_renko_flow_mode_v1`, `fluxo_bridge_token_v1`,
`fluxo_renko_intraday_audit_v3`, `fluxo_series_collector_v1`, `fluxo_renko_spacing_mode_v1`,
`fluxo_renko_hud_pos_v1`, `fluxo_chart_series_v1`, `fluxo_chart_range_pts_v1`, `fluxo_chart_time_sec_v1`,
`fluxo_dados_window_v1`, `fluxo_renko_box_window_v1`, `fluxo_replay_days_v1`, `fluxo_replay_operate_v1`,
`fluxo_sim_speed_v1`, `quant_terminal_{current_user,users,transactions}_v2`.

## 4. DOCUMENTAÇÃO
- `PROJECT_SUMMARY.md` — estado atual consolidado (regras, arquitetura, árvore de arquivos).
- `EVOLUCOES_DETALHADAS.md` — diário de obra por ciclo, com causa raiz, implementação e verificação.
- `PROJECT_CONSOLIDATION_CHAT_SEED.md` — este prompt.

## 5. COMO VERIFICAR
\`\`\`bash
npx tsc --noEmit          # tem que sair limpo em toda entrega
npx vite build            # quando mexer em canvas/estilos
npm run dev               # porta 3002, --host=0.0.0.0
\`\`\`

## 6. PENDÊNCIAS ABERTAS
- SaaS/paywall sem backend; infra para "100 clientes" em aberto (cada cliente precisa do próprio Windows).
- Rotacionar o token da ponte e aplicar o firewall antes de qualquer conta real.
- Reconferir visualmente o card "Segurança da Ponte" após F5 (a verificação por navegador caiu no reload).

Leia `PROJECT_SUMMARY.md` e `EVOLUCOES_DETALHADAS.md`, alinhe o contexto e me avise quando estiver pronto.
\`\`\`
