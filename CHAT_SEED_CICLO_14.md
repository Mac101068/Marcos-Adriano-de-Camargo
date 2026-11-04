# SEED DO CICLO 14 — FLUXO & RENKO 10R · MT5 QUANT TERMINAL (B3 WIN$)

> **Como usar este arquivo em uma conversa nova**: cole o `CHAT_SEED.md` inteiro primeiro (ele é o contexto
> completo do projeto e já traz o ponto de retomada deste ciclo) e depois este arquivo — ou cole só este,
> que resume a evolução, as regras fixas e a lista de tarefas com critério de pronto. O "por que" de cada
> decisão está em `EVOLUCOES_DETALHADAS.md` (diário por ciclo) e o estado atual consolidado em
> `PROJECT_SUMMARY.md`. Leia os dois antes da primeira mudança.
>
> Commit deste ciclo: **`23cb03f`** (pushado em `origin/main`, 03/11/2026).

---

## 1. Quem é o usuário e como trabalhar (resumo fixo)

- Brasileiro, **iniciante em programação**. Toda a UI, comentários e documentação **em português**.
- Edita no **Mac**; testa no **Windows** (MT5 + conta demo XP, onde roda a ponte Python) e no **celular
  Android via LAN**. Dev server: `npm run dev` na **porta 3000** com `--host=0.0.0.0` (se a porta estiver
  ocupada por servidor velho, o Vite sobe na 3001 — confira com `lsof -nP -iTCP:3000 -sTCP:LISTEN`).
- Regras que não se pode quebrar:
  1. `npx tsc --noEmit` limpo ao final de **toda** entrega; `npx vite build` quando mexer em canvas/estilos.
  2. **Simulação, Coletor, Replay e Robôs Sombra jamais tocam a corretora real.**
  3. **Commitar/push somente quando ele pedir explicitamente.**
  4. Pedido claro = agir no alvo óbvio; não fazer pergunta de múltipla escolha à toa (ele costuma cancelar
     o questionário e responder "1A e 2A" em uma linha).
  5. Ser honesto sobre o que foi verificado e o que ficou sem teste — ele valoriza isso.
  6. Chrome neutro, cor só no acento; nenhum quadro de informação no canto inferior direito (aviso
     flutuante abre **no centro**).
  7. Controle do operador **não depende de breakpoint**: nada de par `lg:hidden` + `hidden lg:flex`.
  8. A tela nunca anuncia um símbolo e desenha outro; header e tira de status lêem do **mesmo memo**.
  9. Chip/métrica na tela é atalho para o parâmetro de origem — nunca número solto.
  10. **O terminal acorda PARADO e VAZIO** — nada se auto-inicia no mount; carregar config inteiro
      (perfil, reset, import, sync, ativação) **força `active: false`**.
  11. Relógio do pregão só bloqueia **ordens reais e replay**; o simulador ao vivo roda 24h.
  12. Limiar de sinal é **calculado do pregão** (P60 dos |Δ|), `minDeltaThreshold` é só fallback.
  13. Todo bloqueio/espera vira frase honesta no balão ⚠, com anti-pisca.
  14. No canvas, sinal é **▲ C / ▼ V** (papel é etiqueta: P1/P2/RET).
  15. **A `SavedStrategy` é o banco único; o config ativo é view.** Escrita de campo →
      `patchActiveStrategy` → `updateStrategyConfig`; pacote inteiro → `handleApplyConfigBundle` (upsert
      por **nome** + ativação). `RUNTIME_KEYS` (`active`, `dataSourceMode`, `mt5Host`, `mt5Port`,
      `shadowRobot`, `lastSavedTimestamp`, `strategyId`) nunca entram na estratégia.
  16. **Informação vive em linha colapsável** (`CollapsibleSection`): título + resumo dos valores numa
      linha, campos abrem abaixo, coluna única. **Nenhum controle interativo dentro do cabeçalho** — ele
      é um `<button>`.

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
| 12 | 02/11 | Terminal acorda parado, limiar P60 do pregão, relógio só para ordens reais, sync entre navegadores, varredura de órfãos |
| 13 | 02/11 | Refino de leitura: régua X no divisor, três ZERAR agrupados, Sombra acorda zerada, ▲C/▼V |
| **14** | **03/11** | **FASE A: estratégia como banco de dados único + um só editor + telas em lista + régua X dentro do gráfico** |

## 3. O Ciclo 14 em uma página (a entrega mais recente)

**Diagnóstico que originou tudo**: a biblioteca do Estúdio e o config do EA eram **dois lugares para a
mesma coisa**, e existiam **dois editores** (rascunho do Estúdio e aba Parâmetros). Por isso as mudanças
anteriores pareciam "só técnicas, sem efeito visual".

1. **Banco único** (`strategyLibraryService.ts`): `RUNTIME_KEYS`, `pickRuntime`, `splitStrategyPatch`,
   `resolveOperational(strategy, baseConfig)` (único funil que produz config ativo),
   `ensureActiveStrategy` (por `strategyId` → por `profileName` → semeia "Estratégia ativa") e
   `updateStrategyConfig` (escreve na biblioteca sem deixar runtime vazar). `strategyId: string | null`
   entrou no `AutomationConfig` e é preservado em load/merge/import.
2. **App** (`App.tsx`): `patchActiveStrategy` = funil único de escrita (boleta, Parâmetros, docs);
   `handleApplyConfigBundle(cfg, name)` = perfil 1-clique / restaurar padrões / importar JSON viram upsert
   por nome + ativação, sempre pausados. A tira de status diz **"Trocar:"** e resolve por `strategyId`.
3. **Um só editor**: o rascunho do Estúdio foi removido (852 → ~620 linhas). Estúdio **gerencia** (criar,
   renomear, duplicar, ativar, excluir, importar, sincronizar) e mostra retrato **somente-leitura**;
   Parâmetros **edita**. Ativação compara por **id**; card ativo mostra `AO VIVO / Rodando no Robô 1`.
4. **Selo da estratégia ativa** no header (Zona 1, sem breakpoint): palette + "EA" + nome + `#id` curto +
   ponto **verde AO VIVO / âmbar SOLTO**; clique abre o Estúdio.
5. **`CollapsibleSection`** (novo): Estúdio (Núcleo, Fluxo, Entrada, Gestão, Janela, Execução) e
   Parâmetros (blocos 1, 1.5 Robô 2, 2, 3, 4, Pirâmide, 5, 6, simulador e os **5 perfis rápidos** em
   `PresetRow`) viraram **listas colapsáveis de uma coluna**, cada linha com o resumo dos valores atuais.
6. **Régua de tempo dentro do painel de preço** (`RenkoFlowChart.tsx`): `TIME_AXIS_BAND_H` 24→22,
   `TIME_AXIS_BASELINE` 17→8 (medido para cima), `priceBottomMargin` 16→22, `FLOW_TOP_PAD = 16` no topo do
   fluxo. O indicador voltou a ser dono da janela e **o gesto do eixo X acompanhou a régua** (arrastar =
   zoom/rolagem, duplo clique = reset horizontal, cursor `ew-resize`).

**Bugs corrigidos no caminho** (vale saber antes de "quebrar de novo"):
- `DEFAULT_EA_CONFIG.active === true` → aplicar perfil, restaurar padrões e importar JSON **ligavam o
  robô**. Agora forçam `active: false` e persistem assim, inclusive no caminho de compatibilidade.
- O modal de "Restaurar Padrões" prometia Reteste/SL 100/TP 150, mas a fábrica entrega **Pirâmide &
  Confluência sem SL/TP fixos**. Reescrito; o reset agora cria/ativa a estratégia **"Padrão de Fábrica
  (Pirâmide 10R)"** em vez de sobrescrever a que está em uso.
- Checkbox da janela de horários e botões de velocidade do simulador estavam **dentro de cabeçalho de
  quadro**; como o gatilho do acordeão é `<button>`, desceram para o corpo do grupo.

**Verificado**: `npx tsc --noEmit` limpo · `npx vite build` OK · **18/18 asserts headless da Fase A**
(script temporário com polyfill de `localStorage`, apagado após rodar).
**NÃO verificado**: nada foi conferido em tela nem na conta demo XP.

## 4. Tarefas da próxima conversa (com critério de "pronto")

| # | Tarefa | Pronto quando… |
| --- | --- | --- |
| 1 | 👀 **Conferir em tela o Ciclo 14 inteiro** (Mac + Android) | boleta escreve na biblioteca e o retrato do Estúdio mostra o novo número; selo troca de nome/id ao ativar; **F5** mantém o vínculo (`config.strategyId` aponta para a mesma estratégia); perfil 1-clique e import **não ligam** o robô; acordeão funciona no celular sem esconder controle |
| 2 | 👀 **Conferir a régua de tempo nova** | horários aparecem acima do divisor, dentro do gráfico; arrastar nessa faixa rola/zooma o eixo X; duplo clique reseta o horizontal; o divisor continua arrastável e o indicador ganhou altura visível |
| 3 | 🔧 **Fechar o último resquício de duplicidade**: "Salvar Configuração Atual como Perfil do Operador" ainda grava no depósito antigo de presets (`EaConfigService.saveCustomProfile`) | ou o botão cria direto uma `SavedStrategy` no Estúdio, ou o operador decidir manter assim por escrito — sem isso, ainda há dois depósitos |
| 4 | 🧫 **Primeira coleta real na demo XP** (5 dias pela ponte) | `hadRealData` marcado, livro de auditoria preenchido e nenhum dado sintético rotulado como real |
| 5 | 🧪 **Testar as 5 estratégias "Pirâmide 3/4/5/6/7 ctros"** na sombra com replay de 5 dias (OPERA) | comparação lado a lado com números, e a conclusão registrada em `EVOLUCOES_DETALHADAS.md` |
| 6 | 📊 Comparar Boleta (Range 50 pts) × Sombra (Renko 15R/75 pts) no mesmo seed | tabela com Δ de resultado e recomendação de escala |
| 7 | 🏷️ Padronizar a palavra "mãe" na boleta/auditoria/script Python | só no log interno (semântica de gestão), nunca no canvas |
| 8 | 🌐 Homologar WDO e BTC | vencimento/código confirmado; hoje aparecem `A CONFIRMAR` e só entram em ensaio |

## 5. Onde mora cada coisa (mapa rápido do Ciclo 14)

- `src/services/strategyLibraryService.ts` — **o banco**: `RUNTIME_KEYS`, `splitStrategyPatch`,
  `resolveOperational`, `ensureActiveStrategy`, `updateStrategyConfig`, CRUD da `SavedStrategy`.
- `src/services/eaConfigService.ts` — config ativo (view), `mergeConfig`, `DEFAULT_EA_CONFIG`
  (`active: true` — cuidado!), `resetToDefault`, `BUILT_IN_PRESETS` (os 5 perfis).
- `src/App.tsx` — `patchActiveStrategy`, `handleApplyConfigBundle`, `handleActivateStrategy`,
  `handleApplySyncedConfig`, `refreshStrategyLibrary` (varredura de órfãos), memo `activeStrategy`.
- `src/components/CollapsibleSection.tsx` — a linha colapsável compartilhada (ícone + título + resumo +
  chip + chevron).
- `src/components/StrategyStudio.tsx` — gestora da biblioteca + retrato somente-leitura.
- `src/components/AutomationPanel.tsx` — **o único editor** (blocos em acordeão + `PresetRow`).
- `src/components/Header.tsx` — `StrategySeal` (selo da estratégia ativa).
- `src/components/RenkoFlowChart.tsx` — canvas: `TIME_AXIS_BAND_H`, `TIME_AXIS_BASELINE`, `FLOW_TOP_PAD`
  e os três sítios de hit-testing do eixo X (`handleMouseDown`, `handleDoubleClick`, `getCursorClass`).

## 6. Comandos

```bash
npx tsc --noEmit          # tem que sair limpo em toda entrega
npx vite build            # quando mexer em canvas/estilos
npm run dev               # porta 3000, --host=0.0.0.0 (3001 se a 3000 estiver ocupada)
npx tsx scripts/<nome>.ts # checagem headless de lógica pura (script temporário, apagado depois)
```
