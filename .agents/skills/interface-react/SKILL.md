---
name: interface-react
description: >-
  Trabalhar na interface React/Vite (interface_github) mantendo o espelho das regras do motor:
  aba, painel, HUD, gráfico Renko, tipos e sincronização de config com a ponte.
---

# Interface React (interface_github)

Repo separado, branch `main`, remoto igual ao do backend. Mudança aqui **não** aparece no
commit do backend.

## Rodar e verificar

```bash
cd interface_github
bun install          # se node_modules estiver ausente
bun run dev          # vite --port=3000
npx tsc --noEmit     # obrigatório antes de dizer que terminou
```

## Mapa

- `src/App.tsx` — composição, `mainStrategyMagic`, seletor de estratégia ("Principal #102030"
  + chip EAs), faixa de escopo da aba `eas`.
- `src/components/ActiveEAsChartHud.tsx` — linha do principal sempre visível + rótulo dos EAs.
- `src/components/AutomationPanel.tsx` — controles do motor (inclui o filtro de tendência).
- `src/services/eaConfigService.ts` — defaults e o `SYNC_EA_CONFIG` enviado à ponte.
- `src/utils/convergenceEvaluator.ts` — espelho das regras de convergência.
- `src/types/trading.ts` — tipos dos campos novos.

## Regra de ouro: espelho

Toda regra do motor tem um par aqui. Mexeu em `flow_trend`, `flow_trend_lookback` ou em
qualquer default do `EVAL_CONFIG`? Atualize `convergenceEvaluator.ts`,
`eaConfigService.ts` e, se aparecer na tela, `types/trading.ts` — no mesmo commit, senão
a tela reenvia config antiga e desliga o filtro na ponte.

## Dois cuidados que já deram problema

- Aba carregada antes da mudança continua mandando o config velho no próximo sync
  (foi o que desligou o filtro). Depois de mexer em default, recarregue antes de testar.
- `isRealMT5` e a sincronização de SL/TP no gráfico valem para todos os modos (`Replay`,
  `Seed Auto`, `Paper`, `MT5 Live`) — não reintroduza guarda por modo sem motivo medido.

## Entrega

`npx tsc --noEmit` limpo + qual tela/aba mudou e o que o operador deve olhar. Se você não
abriu a tela, diga que não abriu — não afirme que "ficou certo".
