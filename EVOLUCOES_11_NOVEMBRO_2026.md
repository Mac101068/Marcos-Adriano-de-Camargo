# 🚀 Relatório Consolidado de Evoluções e Handover Técnico
**Data:** 11 de Novembro de 2026  
**Projeto:** Flow Quant MT5 / RoboFluxoB3 & robo_renko  
**Ambiente:** Windows · MetaTrader 5 XP Demo (`#50534540`) · React 18 / Vite · Python 3.12  
**Status:** ✅ Consolidado, Compilado, Sincronizado e Operacional

---

## 📋 1. Resumo Executivo das Entregas do Ciclo

Neste ciclo foram diagnosticados, corrigidos e consolidados todos os pontos críticos reportados em operação real e replay:
1. **Robô 2 (Varal de Ordens)** com opção de execução **A Mercado (`MARKET`) ou Limite (`LIMIT`)** no fechamento de cada bloco e **isolamento total por ativo (`WIN`, `WDO`, `BIT`)**.
2. **Soberania da Hora da Fita (`Tape Time`) no Replay** e eliminação da inversão de PnL ao encerrar o replay às 17:30.
3. **Eliminação do "Bufo" (rejeições em loop)** no MetaTrader 5 após o fechamento da B3.
4. **Regime Dinâmico por Horário da Fita (`Tape Time Regime`)** calibrando percentil ($P_{70}$ a $P_{80}$), piso e divergência conforme a janela do pregão.
5. **Eliminação Definitiva do Piscar (*Flickering*) de Ordens** na tela e no gráfico.
6. **Calibração Anti-Estouro (Clímax Institucional)** e proteção contra bloqueio prematuro por perda diária no Mini-Índice (`WINZ26`).
7. **Correção Definitiva do PnL Fictício (> R$ 33.000) no Mini-Índice** e migração automática de `localStorage` com pisos de segurança invioláveis na ponte Python.
8. **Curva de Patrimônio (`Equity Curve`) em Tempo Real** integrada aos brokers (`mt5_broker.py` e `paper_broker.py`) no `robo_renko`.

---

## 🛠️ 2. Detalhamento Técnico das Correções Recentes

### A. Eliminação do PnL Fictício (> R$ 33.000) no Mini-Índice (`WINZ26`)
- **Diagnóstico Real no MT5:**
  - Auditoria direta nos *deals* da conta `50534540` comprovou que o resultado real do `WINZ26` no dia era **R$ +24,00** (193 deals).
  - O valor de **R$ 33.823,00** exibido na interface ocorria pela subtração cruzada entre o preço do `WINZ26` (`174.700` pts) e o preço do `WDOZ26` (`5.585` pts): `(174.700 - 5.585) × R$ 0,20 = R$ 33.823,00`.
- **Causas Raízes Corrigidas:**
  1. **Closure Defasado no WebSocket (`App.tsx`):** `toggleMT5Connect` capturava `asset` e `currentPrice` do instante da conexão. Ao trocar do Dólar para o Índice, os pacotes `ACCOUNT_INFO` e `MT5_EQUITY_UPDATE` calculavam `pnlPts` e `exitPrice` usando o preço antigo do Dólar.
     - *Solução:* Criados `activeAssetRef` e `currentPriceRef` sincronizados em tempo real, além de priorizar `pos.priceCurrent`, `pos.profit` e os `deals` oficiais enviados pelo MT5.
  2. **Validação Física de Preço por Ativo (`assetRegistry.ts`):**
     - *Solução:* Criada a função `isPriceSaneForAsset(price, asset)` e endurecida `isOrderForAsset(order, asset)`, bloqueando matematicamente qualquer preço fora da faixa física do contrato (`WIN`: `50.000–300.000`; `WDO`: `1.000–20.000`; `BIT`: `50.000–3.000.000`).
  3. **Soberania do MT5 em `hedgeBook` e `stats` (`App.tsx`, `OrdersAndStats.tsx`, `IntradayOrderAudit.tsx`):**
     - *Solução:* Conectado ao MT5 fora de replay/simulação, o resultado realizado e a contagem de contratos vêm estritamente de `dayStatsBySymbol` do MT5.

---

### B. Blindagem Anti-Estouro no Índice e Migração de Cache (`localStorage`)
- **Diagnóstico ("não resolveu as alterações"):**
  - O navegador enviava `SYNC_EA_CONFIG` na reconexão com valores legados gravados no `localStorage`: `minDeltaThreshold = 50`, `adaptive = false`, `consolidation_enabled = false`, `exhaustion_enabled = false` e `flow_divergence_min = 0.05`.
  - Isso sobrescrevia a ponte Python em memória e permitia disparos em ruídos (`Score 2/10` e `3/10`) e em barras de clímax (`Δ 4225`).
- **Soluções Implementadas:**
  1. **Migração Automática `migrateAntiBurstCycle` (`src/utils/antiBurstMigration.ts`):**
     - Atualiza automaticamente `fluxo_renko_ea_config_v3`, `fluxo_asset_trade_params_WIN` e `fluxo_strategy_library_v1` para `minDeltaThreshold >= 300`, `consolidationFilterEnabled = true`, `exhaustionFilterEnabled = true`, `adaptiveThresholdEnabled = true` e `flowDivergenceMin >= 0.4`.
     - Expurga do cache do navegador quaisquer ordens históricas corrompidas com PnL absurdo (`> R$ 10.000`).
  2. **Pisos de Segurança Invioláveis no Backend (`bot_mt5_ciclo15.py`):**
     - `MAX_DELTA_CEILING` reduzido de `4500` para **`3200`** no `WINZ26` (bloqueando barras de exaustão/clímax como `CALADO_ESTOURO_CLIMAX`).
     - Exigência de **Score de Convicção mínimo `4/10`** para sinais de Pirâmide no `WINZ26` (`CALADO_SCORE_BAIXO`).
     - `apply_ea_config()` impõe *safety floors* para `WIN`: mesmo que um cliente externo envie parâmetros defasados, a ponte mantém `min_delta >= 300`, `flow_divergence_min >= 0.35`, `consolidation_enabled = True`, `exhaustion_enabled = True` e `adaptive = True`.

---

### C. Fim do Piscar (*Flickering*) de Ordens na Tela
- **Causa Raiz:** As rotinas locais `hitTP`/`hitSL` fechavam ordens no frontend ao encostar no preço, enquanto o broadcast de posições abertas do MT5 reabria a ordem 500ms depois.
- **Solução:** Instituída a guarda `isManagedByMT5`: ordens reais no MT5 são encerradas exclusivamente quando saem da lista `positions` oficial da corretora.

---

### D. Replay Fiel à Hora da Fita (`Tape Time`) e Fim do "Bufo" no Fechamento da B3
- **Hora da Fita Soberana:** O controle de janela operacional (`08:55` às `17:30`) durante replays usa exclusivamente o timestamp do tick da fita (`LAST_TAPE_TIME_MSC`), permitindo rodar replays a qualquer hora do dia ou da noite.
- **Proteção de Fechamento no MT5:** Adicionado latch `day_close_executed` e verificação `SYMBOL_TRADE_MODE_DISABLED` para evitar envio repetitivo de ordens após o fechamento da B3.

---

## 🎯 3. Pauta para a Próxima Conversa (Continuação da Calibração)

1. **Acompanhamento em Pregão Real dos Novos Filtros do `WINZ26`:**
   - Avaliar a taxa de corte de `CALADO_SCORE_BAIXO` (`Score < 4/10`) e `CALADO_ESTOURO_CLIMAX` (`|Δ| > 3200`) no arquivo `auditoria_diario/eventos_WINZ26_*.csv`.
   - Verificar se o teto de `3200` contratos no box 10R/8R está no ponto ótimo ou se deve ser ajustado proporcionalmente à escala do box (ex: 8R vs 10R).
2. **Calibração Fina do Robô 2 (Varal de Ordens) por Ativo:**
   - **WINZ26:** Comparar performance do modo `MARKET` no fechamento de cada box vs `LIMIT` escalonado com `step_points = 50`.
   - **WDOZ26:** Validar passo de `2.5` pts e alvo de `5.0` pts com `min_delta = 15` no mestre.
   - **BITX26:** Validar `pointValue = 0.01`, box de `100` a `200` pts e folga de spread no Stop Loss.
3. **Gestão de Risco e Trailing Stop na Ordem Mãe:**
   - Avaliar ativação do Breakeven da Ordem Mãe após o 1º TP da pirâmide (`moveMainToBreakevenOnPyramidTp`) nos diferentes regimes de horário (Abertura vs Meio-dia).

---

## 💻 4. Comandos Rápidos de Inicialização

### Iniciar Ponte Python MT5 (`porta 8765`):
```powershell
Set-Location "C:\Users\Lucas\Documents\RoboFluxoB3"
.\venv\Scripts\python.exe -u bot_mt5_ciclo15.py
```

### Iniciar Interface Web Vite (`porta 3000`):
```powershell
Set-Location "C:\Users\Lucas\Documents\RoboFluxoB3\interface_github"
npm run dev
```

### Acesso no Navegador:
- Painel Quantitativo Principal: `http://localhost:3000/`

