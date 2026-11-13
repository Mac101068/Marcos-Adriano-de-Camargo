# Evoluções do Sistema Flow Quant B3 & Robôs Hedge (Passos 1 a 5 Consolidados)

> **Contexto de Partida para Nova Conversa:** `padronização das telas dos EAs no modelo Hedge`  
> **Conta MT5:** `50534540 (XPMT5-DEMO)`  
> **Data de Consolidação:** 13/11/2026  
> **Status:** Integrado, auditado, persistente ao F5 e validado com Trailing Stop e parâmetros editáveis em tempo real

---

## 1. Resumo Executivo das Implementações

Nesta etapa, consolidamos a **Aba Dedicada `Hedge EAs` (`DirectionalEAsPanel.tsx`)**, o **isolamento operacional dos Robôs Direcionais (`100001` e `100002`)**, a **proteção de ordens vencedoras via Trailing Stop + Breakeven automático**, a **trava anti-acúmulo de ordens**, a **persistência total contra recarregamento (`F5`)** e os **parâmetros editáveis em tempo real na tela principal**.

### Arquitetura de Magic Numbers e Isolamento:
- **Robô Principal (Estratégia Pirâmide/Surfe):** Magic `102030` (ou customizável via config `DEFAULT_MAGIC_NUMBER = 101010`).
- **Boleta Manual / Ordens Rápidas:** Magic `999999` (isoladas do robô automático).
- **Robô Direcional de Compra (`RoboCompra`):** Magic `100001` (comentário `RCOMP_<SYM>_BOX<N>`).
- **Robô Direcional de Venda (`RoboVenda`):** Magic `100002` (comentário `RVEND_<SYM>_BOX<N>`).

---

## 2. Detalhamento Técnico das Evoluções Consolidadas

### A. Aba Exclusiva `Hedge EAs` (`DirectionalEAsPanel.tsx` & `Header.tsx`)
- Criada aba dedicada **`Hedge EAs`** na barra de navegação superior (`Header.tsx`) com suporte a abertura em janela destacada (`usePanelWindows.ts`).
- **Dashboard em Tempo Real:**
  - KPIs globais combinados: **PnL Realizado**, **PnL Flutuante (Aberto)**, **Posições Abertas Hedge (`XC / YV`)**, **Total de Saídas Fechadas** e **Status Operacional (`COMPRA: ON/OFF` | `VENDA: ON/OFF`)**.
  - Cards independentes lado a lado para **`RoboCompra (Magic 100001)`** e **`RoboVenda (Magic 100002)`**.
  - Comutador individual de modo **`Paper`** vs **`MT5 Live`** por robô.
  - Quadro ao vivo **"Ordens Abertas (SL / TP Ativos na Tela)"** dentro de cada card, exibindo preço de entrada, quantidade de contratos, badge **`SL` / `SL TRAIL`** e **`TP`** de cada posição ativa.
  - Sub-aba **`Ordens & Posições`** com filtro por Magic Number (`Todos`, `100001`, `100002`) e histórico completo de entradas, SL/TP, saídas e resultado em pontos e R$.

### B. Parâmetros Editáveis na Tela Principal & Presets de Teste (`DirectionalEAsPanel.tsx`)
- Todos os parâmetros operacionais foram transformados em **campos editáveis diretamente no card principal** de cada robô (sem necessidade de trocar de aba):
  - **Take Profit (pts):** Padrão `50 pts` (editável em tempo real).
  - **Stop Loss (pts):** Padrão `100 pts` (editável em tempo real).
  - **Contratos (Lote):** Padrão `1 ct` (editável).
  - **Máx. Ordens Abertas (`maxOpenPositions`):** Padrão `3 ordens` por robô (trava anti-acúmulo editável de 1 a 20).
  - **Chave Trailing Stop (`ATIVO (ON)` / `DESATIVADO`):** Botão de alternância direta.
  - **Gatilho Trail (`+pts`):** Padrão `20 pts` (pontos de lucro para armar a proteção).
  - **Distância Trail (`pts`):** Padrão `15 pts` (distância em que o Stop Loss segue atrás da máxima/mínima).
  - **Piso Breakeven (`+pts`):** Padrão `5 pts` (lucro mínimo travado acima/abaixo da entrada ao ativar o gatilho).
  - **Zerar no Sinal Oposto (`onCloseOpposite`):** Checkbox individual por robô.
- **Botões `Espelhar p/ Venda →` e `← Espelhar p/ Compra`:** Copiam com 1 clique todos os parâmetros de teste de um robô para o outro.
- **Barra de Presets Rápidos de 1-Clique (Aplica em Compra & Venda):**
  - `Padrão (TP 50 / SL 100 / Trail +20→15)`
  - `Scalper Curto (TP 35 / SL 70 / Trail +15→10)`
  - `Surfe Médio (TP 80 / SL 100 / Trail +25→15)`
  - `Alvo Longo (TP 120 / SL 100 / Trail +30→20)`
- **Recálculo Instantâneo:** Alterar `SL` ou `TP` na tela recalcula imediatamente o `stopLoss` e `takeProfit` das posições já abertas tanto no card quanto nas linhas do gráfico Renko (`App.tsx`).

### C. Proteção de Ordem Vencedora: Trailing Stop + Breakeven (`directionalRobotService.ts`)
- Nenhuma ordem vencedora que atinja o gatilho de ativação pode retornar e fechar no prejuízo:
  - Ao atingir `+trailingActivationPoints` (padrão `+20 pts`), o Stop Loss salta imediatamente da perda (`-100 pts`) para o piso mínimo protegido (`entryPrice ± breakevenOffsetPoints`, padrão `+5 pts`) e passa a acompanhar o preço a `trailingDistancePoints` (`15 pts`) de distância do topo/fundo (`highestPriceSinceEntry` / `lowestPriceSinceEntry`).
  - Caso o preço recue e toque o Stop Loss já protegido no lucro, a operação é encerrada com status **`CLOSED_PROFIT`** e evento auditado **`TRAILING_STOP_HIT`**.

### D. Persistência contra `F5` e Sincronização Multi-Abas (`directionalRobotService.ts` & `App.tsx`)
- Estado completo de cada robô (`paused`, `executionMode`, `customConfig`, `positions`, `intents`, `lastSignal`, `totalCloses`) salvo automaticamente em `localStorage` nas chaves `fluxo_quant_b3_directional_robot_v1_100001` e `100002`.
- Sincronização entre janelas/abas via `BroadcastChannel` (`DIRECTIONAL_ROBOT_SYNC`) e listener `storage`.
- Trava `beforeunload` que salva o estado antes de qualquer reload e alerta o operador caso haja robô ativo com posições abertas.
- Restauração automática no boot de `orders` em `App.tsx`, preservando no gráfico Renko todas as linhas de entrada, `SL`, `SL BE` e `TP` após `F5`.

### E. Sincronização de Stops/TPs no Gráfico e Contratos na Boleta (`App.tsx` & `BoletaTicket.tsx`)
- **Boleta (`BoletaTicket.tsx`):** Adicionado painel dedicado de **Contratos Abertos na Compra (`100001` + geral)** e **Contratos Abertos na Venda (`100002` + geral)** com contagem de ordens e lotes em destaque.
- **Gráfico Renko (`App.tsx` / `RenkoFlowChart.tsx`):**
  - Removida a restrição `if (isReplayMode)` que impedia a sincronização do `onTick` fora do replay.
  - Corrigido o flag `isRealMT5` para que ordens em modo `Paper` nunca sejam descartadas após 30s pelo sincronizador `MT5_EQUITY_UPDATE` quando a ponte MT5 estiver conectada.
  - Sincronização contínua em tempo real de `stopLoss`, `takeProfit` e `isBreakevenActive` (`SL BE`) em todos os modos (`Replay`, `Seed Auto`, `Paper` e `MT5 Live`).

---

## 3. Diretrizes para a Próxima Conversa: "Padronização das Telas dos EAs no Modelo Hedge"

Na próxima conversa, nosso objetivo será **padronizar todas as telas e painéis de EAs da plataforma adotando o modelo visual e operacional da aba `Hedge EAs` (`DirectionalEAsPanel.tsx`) como padrão único**.

### Metas Prioritárias para a Próxima Sessão:
1. **Unificação Visual no Padrão `Hedge EAs`:**
   - Adotar o layout de cards operacionais do `DirectionalEAsPanel.tsx` (cabeçalho com badge de Magic Number, selo `Persistente (F5)`, seletor `Paper | MT5 Live`, botão `Ativar/Pausar`, KPIs de `PnL Realizado`, `PnL Flutuante`, `Win Rate` e `Posições Abertas X/Máx`) para todos os robôs/estratégias da plataforma (incluindo o Robô Principal `102030` / Pirâmide / Reteste e o Robô Sombra).
2. **Parâmetros Editáveis Inline em Todos os EAs:**
   - Levar o bloco de **Parâmetros Editáveis ao Vivo** (TP, SL, Lote, Máx. Ordens, Trailing Stop ON/OFF, Gatilho Trail, Distância Trail, Piso Breakeven) e a barra de **Presets Rápidos de 1-Clique** para a tela dos demais EAs, eliminando configurações escondidas ou espalhadas em múltiplas abas.
3. **Quadro de Ordens Abertas (`SL / SL TRAIL / TP`) Padronizado:**
   - Exibir em todos os cards de EAs a lista compacta ao vivo de posições abertas com indicação clara de `Entrada`, `SL / SL TRAIL` e `TP`, garantindo transparência visual imediata em qualquer robô ativo.
4. **Limpeza de Duplicidades no Painel de Sistema/Ajustes (`AutomationPanel.tsx`):**
   - Consolidar os controles operacionais dos EAs na interface padronizada, deixando o menu `Sistema` enxuto e focado apenas em conexões de ponte, diagnóstico e infraestrutura.
