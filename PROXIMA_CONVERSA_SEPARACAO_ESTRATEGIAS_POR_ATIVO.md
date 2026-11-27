# RoboFluxoB3 — Consolidação e Separação de Estratégias por Ativo

**Data:** 26/11/2026  
**Contexto:** Documento mestre para abertura da **próxima conversa**, consolidando os avanços concluídos hoje, a arquitetura de replays e o plano técnico prioritário para a **separação estrita dos parâmetros de estratégias por ativo (WIN, WDO e BIT)**.

---

## 1. Problema Crítico Identificado: Contaminação de Configurações entre Ativos

### Diagnóstico do Problema
Atualmente, as configurações da estratégia (`AutomationConfig`) e os parâmetros operacionais (Box Renko, Stop Loss, Take Profit, Pullback, Limiares de Delta, Trailing Stop e Filtros) residem em um estado primordialmente único na interface (`config` em `App.tsx`) e em um dicionário global na ponte (`EVAL_CONFIG` em `bot_mt5_ciclo15.py`).

**Impacto Prático:**
- Ao calibrar os parâmetros finos para o **Mini-Dólar (WDO)** — ex: Renko 10R com Box de 2,5 pts, SL de 2,5 pts, TP de 5,0 pts, Pullback de reteste na abertura do box (2,5 pts) e Delta de 30 ct — esses mesmos valores contaminam o **Mini-Índice (WIN)** ao alternar de aba se não houver um reload total ou se o operador salvar.
- No **Mini-Índice (WIN)**, os parâmetros corretos são ordens de grandeza completamente diferentes: Box de 50 pts, SL de 100 pts, TP de 50 pts, Pullback de 25 pts e Delta de 300 ct.
- No **Bitcoin Futuro (BIT)**, o tick mínimo é 20 pts (R$ 2,00 por tick, 1 contrato = 0,1 BTC) e a escala Renko exige 100R a 500R.
- **Risco:** Misturar essas réguas gera ordens com stops fora da grade B3, rejeição de ordens pela corretora ou cálculos incorretos de risco/retorno na boleta.

---

## 2. Solução Arquitetural para a Próxima Conversa

### 2.1 No Frontend React (`interface_github`)
1. **Configuração Particionada por Ativo (`configsByAsset`):**
   - Substituir o estado único `config` por um mapa de configurações indexado pelo identificador do ativo:
     ```ts
     type AssetKey = 'WIN' | 'WDO' | 'BIT';
     configsByAsset: Record<AssetKey, AutomationConfig>
     ```
   - Ao trocar de aba no topo (`WIN`, `WDO`, `BIT`), a interface salva o estado do ativo atual em seu slot do `localStorage` (`fluxo_ea_config_v1_WIN`, `fluxo_ea_config_v1_WDO`, `fluxo_ea_config_v1_BIT`) e restaura imediatamente os parâmetros isolados do ativo selecionado.
2. **Biblioteca de Presets com Vínculo de Ativo:**
   - Cada preset de estratégia (`preset-pullback-wdo`, `preset-scalp-win`, etc.) terá um campo obrigatório `targetAsset: 'WIN' | 'WDO' | 'BIT'`.
   - O seletor de estratégias filtrará e apresentará prioritariamente os presets homologados para o ativo que estiver em tela.
3. **Persistência de Escalas e Visualização Isoladas:**
   - O tipo de gráfico (Renko, Range ou Tempo), a escala do box, o tamanho do range e o tempo gráfico já possuem suporte estrutural e serão 100% blindados na troca de ativo sem interferência cruzada.

### 2.2 No Backend Python (`bot_mt5_ciclo15.py`)
1. **EVAL_CONFIG Múltiplo por Família/Ativo:**
   - Transformar o dicionário global `EVAL_CONFIG` em instâncias independentes por família:
     ```python
     EVAL_CONFIGS = {
         "WIN": { ... },
         "WDO": { ... },
         "BIT": { ... },
     }
     ```
2. **Sincronização Granular via `SYNC_EA_CONFIG`:**
   - O WebSocket receberá `assetKey` no payload:
     `{ action: "SYNC_EA_CONFIG", assetKey: "WDO", config: { ... } }`
   - O julgamento de confluência (`check_convergence`), limiares adaptativos (`calc_percentile_threshold`) e filtros de microestrutura avaliarão cada ativo com o seu respectivo dicionário.

---

## 3. Consolidação das Entregas do Dia (26/11/2026)

### 3.1 Infraestrutura e Automação de Replays
1. **Organizador e Sincronizador de 10 Dias (`organizar_replays_10dias.py`):**
   - Rotação rolante oficial baseada no calendário do Mini-Índice (WIN).
   - Gerencia 30 recortes compactados (.csv.gz) em `data/pregoes/` (10 para WIN, 10 para WDO e 10 para BIT).
   - Expurgo automático de datas excedentes mantendo estritamente a janela de 10 dias.
   - Atualização contínua do catálogo `interface_github/public/pregoes.json`.
   - Lançador PowerShell criado: `_sincronizar_replays_10dias.ps1`.
2. **Serviço de Fita Real por Data Específica:**
   - `replay_dados.servir_histico` e `handle_request_history` atualizados para aceitar `target_date`.
   - Quando o operador seleciona `Flow1 (04/11)`, a ponte agora entrega com precisão absoluta os **102.079 ticks reais** de 04/11/2026 em vez de cair na data mais recente.
3. **Restauração Automática ao Pregão ao Vivo (`REPLAY_END`):**
   - Handler implementado na ponte WebSocket: ao término do replay (ou clique em Pausar), desativa `REPLAY_MODE` e despacha `send_today_session_backfill(websocket, SYMBOL)`, devolvendo a tela aos dados em tempo real da B3.

### 3.2 Correção de Ordens Fantasmas e Isolamento da Boleta
1. **Eliminação de Ordens Fantasmas no Replay:**
   - Travas `!isReplaying && !isReplayingRef.current` inseridas em todos os pontos de envio do frontend (`App.tsx`).
   - Trava anti-replay no backend Python rejeitando incondicionalmente ordens com tag `_BOX` ou sob `REPLAY_MODE`.
2. **Blindagem contra Contaminação do MT5:**
   - Bloqueio da injeção de posições reais da conta MT5 (`ACCOUNT_INFO`) dentro do array `orders` durante o replay.
   - Correção da flag `isRealMT5`: ordens simuladas não são mais rotuladas erroneamente como reais.
   - Zeração estrita da boleta ao iniciar uma corrida e cálculo fiel do PnL flutuante/realizado baseado exclusivamente nas operações da simulação.

### 3.3 Calibração Quantitativa de Microestrutura
1. **Mini-Índice (WINZ26):**
   - Pullback 25 pts + Filtro Anti-Clímax (Score 4..6): **+2.550 pts líquidos** (virada de +4.800 pts contra a base a mercado) com Max DD de 1.550 pts (−77,8%).
2. **Mini-Dólar (WDOZ26):**
   - Reteste na abertura do box (`BOX_OPEN` / 2,5 pts) + Score 4..6: **+9,0 pts líquidos** (+42,5 pts de virada sobre o fechamento a mercado) com Max DD de 20,0 pts (−70,8%).
3. **Banco de Dados Permanente de Replays:**
   - Persistência contínua via `ReplayHistoryService.ts` e visualizador interativo em **Sistema ➔ Histórico de Replays**.

---

## 4. Estado Atual dos Repositórios e Testes

Ambos os repositórios estão **100% verdes** e em perfeita paridade:

| Repositório | Caminho | Branch | Verificação | Status |
|---|---|---|---|---|
| **Backend** | `C:\Users\Lucas\Documents\RoboFluxoB3` | `backend-python` | `test_paridade_regras.py` (48/48 ✅)<br>`test_diario_eventos.py` (46/46 ✅)<br>`py_compile` (0 erros) | ✅ Verde |
| **Frontend** | `...\RoboFluxoB3\interface_github` | `main` | `npx tsc --noEmit` (0 erros) | ✅ Verde |

---

## 5. Roteiro Imediato para a Próxima Conversa

1. **Implementar `configsByAsset` no Frontend:**
   - Migrar `config` para um mapa indexado por `AssetKey` (`WIN`, `WDO`, `BIT`).
   - Carregar e persistir slots individuais no `localStorage`.
2. **Modularizar `EVAL_CONFIG` no Backend:**
   - Criar `EVAL_CONFIGS` por ativo e atualizar `apply_ea_config` para suportar `assetKey`.
3. **Validar com os Presets Oficiais:**
   - Alternar entre WIN (Renko 10R / 50 pts) e WDO (Renko 10R / 2,5 pts) confirmando que cada tela retém suas configurações e réguas intactas.
