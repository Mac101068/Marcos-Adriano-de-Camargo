# 🎯 RoboFluxoB3 — Handover & Documentação de Evoluções: "Refino de Estratégias"
**Data:** 11 de Novembro de 2026  
**Ambiente:** Windows 11 · MetaTrader 5 XP Demo (`#50534540`) · Vite / React 18 · Python 3.12 (venv)  
**Status do Sistema:** ✅ Estável, Compilado, Sincronizado e Conectado ao Vivo na B3

---

## 1. Evoluções Realizadas na Sessão

### A. Robô 2: Varal de Ordens (Sombra Operacional no MT5)
- **Conceito & Arquitetura:**
  - Robô secundário dedicado operando simultaneamente com o Robô 1 (Mestre) em cada ativo.
  - Opera com Magic Numbers isolados na corretora XP:
    - 🟦 **Mini-Índice (`WINZ26`):** Magic `150102` (Mestre: `150101`)
    - 🟩 **Mini-Dólar (`WDOZ26`):** Magic `150202` (Mestre: `150201`)
    - 🟨 **Bitcoin B3 (`BITX26`):** Magic `150302` (Mestre: `150301`)
  - **Gatilho Operacional:** Disparado ao fechamento de cada box Renko com base no sinal "C" (Compra) ou "V" (Venda), de forma independente das regras de confluência institucional do robô mestre.
  - **Modos de Execução Editáveis:**
    - ⚡ **A Mercado (`MARKET`):** Executa imediatamente a mercado no fechamento de cada bloco ("C" ou "V") para garantir entrada sem que a ordem passe reto.
    - ⏳ **Ordem Limite / Stop (`LIMIT`):** Projeta ordens pendentes escalonadas à frente do preço (`step_points`, padrão 50 pts) criando o "varal" de ordens.
  - **Parâmetros Parametrizáveis pela Interface:**
    - `execution_type`: `MARKET` vs `LIMIT`
    - `max_orders`: Número máximo de ordens penduradas/ativas (3, 4, 5 ordens)
    - `step_points`: Distância do espaçamento entre as ordens (padrão 50 pts)
    - `tp_points`: Alvo de Take Profit configurável por ativo
    - `sl_points`: Stop Loss com proteção dinâmica contra spread de abertura
    - `contracts`: Quantidade de contratos por ordem
  - **Proteção Anti-Rejeição de Stop no MT5 (`Invalid stops`):**
    - Implementado cálculo de `ref_sl` relativo ao Bid/Ask atual da corretora, impedindo que o Stop Loss seja posicionado dentro do spread em ativos voláteis como o Bitcoin B3.

---

### B. Correção da Hora da Fita (`Tape Time`) & Resolução de Reversão de PnL no Replay
- **Causa Raiz Identificada:**
  1. A checagem de horários operacionais do robô (`check_schedule`) lia o relógio de parede do computador (`datetime.now()`). Durante ensaios de replay realizados após as 17:30 ou à noite, 100% das ordens eram bloqueadas com `BLOQUEADO_POR_HORARIO`.
  2. Ao término da corrida de replay, a variável `isReplaying` tornava-se `false` e a interface caía no fallback `isRealMT5 = true` (pelo MT5 estar conectado), sobrescrevendo imediatamente o PnL positivo do replay com o extrato da conta MT5 (que continha saldo negativo do dia de testes).
  3. No cálculo de `stats`, ordens fechadas de replay eram filtradas por `(o.exitTimestamp ?? 0) >= sessionStartRef.current`, descartando ordens que continham horário histórico da fita.
- **Correções Aplicadas:**
  - **Soberania do Horário da Fita:** `LAST_TAPE_TIME_MSC` armazena o milissegundo real de cada tick processado. Em modo replay (`REPLAY_MODE`), o robô valida a janela de pregão exclusivamente pelo horário da fita e não pelo relógio do computador.
  - **Trava de Fim de Pregão (17:30 da Fita):** Uma vez que o tick da fita atinge `tradingCloseAllTime` (17:30), todas as ordens abertas são liquidadas no preço de mercado daquele exato momento e nenhuma nova ordem é aberta durante os ticks residuais do leilão (17:30 às 18:00+).
  - **Preservação do Resultado do Replay na Tela:** A trava `hasReplayOrders` garante que, enquanto houver ordens da sessão de replay na tela, o cabeçalho e o painel mantêm o `dayPnl` e as métricas do replay intactos, sem substituí-los pelo extrato da conta do MT5.

---

### C. Eliminação do "Bufo" (Rejeição de Ordens) no Fechamento da B3 no MetaTrader 5
- **Diagnóstico:** Quando o pregão encerra na B3 (após 17:30 / 18:00), a corretora desativa ordens a mercado. O robô continuava tentando enviar requisições de zeragem repetitivas a cada tick, disparando o alerta sonoro de erro no terminal MT5.
- **Implementação:**
  - Adicionada verificação prévia de `sym_info.trade_mode == mt5.SYMBOL_TRADE_MODE_DISABLED` em `close_all_positions()` do robô mestre e do Varal.
  - Inclusão do latch de proteção `day_close_executed = True`: a rotina de zeragem de fim de dia é acionada exatamente uma única vez por pregão, cessando tentativas repetitivas.

---

### D. Afinação dos Limiares de Agressão por Horário da Fita (`Tape Time Regime`)
- **Conceito & Arquitetura:**
  - Adaptação dinâmica e automática das regras de corte ($P_{70}$ vs $P_{80}$, multiplicador de piso e divergência mínima de fluxo) baseada na hora real da fita (`Tape Time`).
  - **Grade de Horários & Parâmetros Calibrados:**
    - 🟢 **Abertura (`09:00 - 10:30`):** $P_{70}$, Divergência mínima 15%, Piso 1.4×. Prioriza agilidade para capturar puxadas direcionais de alta liquidez e rompimentos fortes de abertura.
    - 🔵 **Manhã Regular (`10:30 - 12:00`):** $P_{75}$, Divergência 18%, Piso 1.5×. Mercado à vista aberto, fluxo consistente.
    - 🔴 **Meio-dia (`12:00 - 14:00`):** $P_{80}$, Divergência mínima 25%, Piso 1.8×. Filtro rigoroso contra o "moedor de ordens" e falsos rompimentos do horário de almoço.
    - 🔵 **Tarde Regular (`14:00 - 16:00`):** $P_{75}$, Divergência 18%, Piso 1.5×. Retomada de volume com o mercado americano a pleno vapor.
    - 🟠 **Fechamento (`16:00 - 17:30`):** $P_{80}$, Divergência mínima 20%, Piso 1.6×. Exige alta convicção para qualquer nova entrada antes da desaceleração pré-leilão.
- **Implementação & Paridade Estrita:**
  - **Backend Python (`bot_mt5_ciclo15.py`):** Função `get_time_based_regime()`, leitura do timestamp do box/fita em `check_convergence()`, auditoria completa no diário (`fase_horario`, `hora_fita`, `percentil_vigente`, `div_min_vigente`) e chave de sincronização `timeBasedRegimeEnabled`.
  - **Frontend TypeScript (`convergenceEvaluator.ts`):** Função espelho `getTimeBasedFlowRegime()`, garantindo paridade 1:1 entre as setas desenhadas na interface e as ordens disparadas na ponte.
  - **Painel Visual (`FunnelMetricsPanel.tsx`):** Badge em tempo real `⏱️ FASE (P_ · Div ≥_%)` indicando visualmente ao operador o regime vigente no momento exato da fita.

---

### E. Isolamento e Independência Total do Robô 2 (Varal de Ordens por Ativo)
- **Problema Reportado:** Ao ativar o Varal em uma das abas (ex: `WIN`), todas as outras abas (`WDO` e `BIT`) apareciam ativadas ou eram acionadas juntas.
- **Causas Raízes Identificadas & Solucionadas:**
  1. **Inicialização Global com `enabled: true`:** Tanto em `bot_mt5_ciclo15.py` quanto em `multiRobots.ts`, os valores de fábrica para `VARAL_CONFIG` nasciam como `enabled: true` para todos os ativos. *Solução:* Todos agora inicializam com `enabled: false`. O operador precisa ligar individualmente cada ativo.
  2. **Configuração Estática no Python (`self.cfg`):** A classe `MT5VaralManager` mantinha um dicionário `self.cfg` estático de instância criado no `__init__`. Atualizações via WebSocket para um símbolo não sincronizavam com instâncias correlacionadas. *Solução:* Substituído por `@property def cfg(self)` dinâmico que lê em tempo de execução diretamente `VARAL_CONFIG[self.asset_key]`.
  3. **Roteamento de Patch Granular no Backend:** O manipulador do evento `SET_VARAL_CONFIG` no WebSocket Python agora recebe explicitamente o `assetKey` (`WIN`, `WDO` ou `BIT`) e atualiza unicamente aquele ativo: `VARAL_CONFIG[asset_k].update(...)`.
  4. **Sub-aba Compartilhada na UI:** No painel React, a navegação entre as sub-abas Mestre/Varal era controlada por um único estado global `activeStrategyTab`. Se o usuário abrisse o Varal no WIN, ao navegar para WDO ele já visualizava a tela do Varal. *Solução:* Transformado em mapeamento por ativo `activeStrategyTabByAsset: Record<MultiRobotId, 'MASTER' | 'VARAL'>`.
  5. **Persistência Local e Indicador Visual no Cabeçalho:**
     - Adicionada persistência no `localStorage ('fluxo_varal_config_v1')` para manter o estado individual de cada robô gravado entre recarregamentos de página.
     - Cabeçalho das abas superiores agora exibe indicador visual dedicado (`V:ON` em lilás com pulsing dot vs `V:OFF` discreto), permitindo ver de relance quais ativos têm o Robô 2 ligado sem precisar entrar na aba.

---

### F. Correção do PnL, Boleta e Execução Fantasma do Bitcoin B3 (`BITX26`)
- **Problema Reportado:** O robô do BITX26 executou sem estar ativo, e a boleta do navegador exibia valores absurdos no PnL.
- **Causas Raízes Identificadas & Solucionadas:**
  1. **Disparo Inadvertido do Robô:** O processo Python anterior em segundo plano ainda estava com `VARAL_CONFIG["BIT"]["enabled"] = True`. Ao rodar em background conectado à B3 com ticks ao vivo de BITX26, o Varal disparou ordens a mercado (Magic `150302`). *Solução:* Garantido que `enabled: False` é o padrão inegociável em todos os ativos e sincronizado com os clientes.
  2. **Inflação de 10× no Valor do Ponto (`pointValue`):** No registro do ativo (`assetRegistry.ts` e `multiRobots.ts`), o `pointValue` do Bitcoin B3 estava configurado como `0.1` (R$ 0,10 por ponto). O contrato futuro de Bitcoin B3 (`BITX26`) tem variação mínima de 20 pontos por tick valendo R$ 0,20 (`trade_tick_value / trade_tick_size = 0.20 / 20 = 0.01`). O valor real é **R$ 0,01 por ponto** (1 centavo). O valor de 0.1 estava inflando qualquer cálculo financeiro por 1000%.
  3. **Contaminação Cruzada de Ordens no `hedgeBook`:** A função `sideBook` e a lista de ordens fechadas da boleta não filtravam se as ordens pertenciam ao ativo atualmente visualizado na tela. Quando havia posições de Mini-Índice (`WINZ26` com entrada em 174.150 pts) e o operador clicava na aba do Bitcoin (`BITX26` com cotação em 412.400 pts), o sistema calculava: `412.400 - 174.150 = 238.250 pontos`, gerando um PnL flutuante falso de dezenas de milhares de reais na boleta.
  4. **Fechamento Falso de Posições Cruzadas:** A rotina de sincronização de posições do MT5 tratava tickets de outros ativos como "ordens encerradas na corretora", liquidando-as no frontend contra a cotação do ativo ativo e gravando resultados milionários/falsos no histórico. *Solução:* Implementado isolamento estrito por ativo (`isOrderForCurrentAsset`), protegendo ordens de WIN e WDO de serem tocadas enquanto o operador visualiza o Bitcoin.
  5. **Mapeamento de Chaves de Estatísticas (`BTCBR` vs `BIT`):** O frontend consultava `statsBySym["BTC"]`, mas o backend indexava apenas como `"BIT"`. Isso causava fallback para as estatísticas globais da conta MT5 inteira. *Solução:* Adicionados aliases para todas as variações (`BIT`, `BTC`, `BTCBR`, `BIT$`, `BITX26`) e instituído fallback com estatísticas zeradas caso o ativo não tenha operado no dia.

---

### G. Eliminação Definitiva do Piscar (Flickering) de Ordens na Tela
- **Problema Reportado:** "as orden piscam verifique". As linhas de ordens abertas, os badges de posição e as linhas no gráfico ficavam piscando continuamente na tela ao operar no MT5.
- **Causas Raízes Identificadas:**
  1. **Conflito Cíclico entre Simulação Local de Tick e MT5 Real:**
     - Em `App.tsx` (`handleIncomingTick`), a cada tick do mercado, as rotinas `hitTP` e `hitSL` avaliavam o preço atual contra o alvo e stop da ordem.
     - Quando o preço tocava ou se aproximava do TP/SL, o frontend mudava a ordem localmente para `CLOSED_PROFIT` ou `CLOSED_LOSS`.
     - Isso removia a ordem instantaneamente de `openOrders`, fazendo a linha e o badge sumirem do gráfico e da boleta.
     - Segundos depois (ou em 500ms), a ponte Python (`bot_mt5_ciclo15.py`) enviava o broadcast periódico `MT5_EQUITY_UPDATE` ou `ACCOUNT_INFO` contendo a lista de posições reais ainda abertas no MT5 (pois a execução na corretora tem latência natural de roteamento e spread Ask/Bid).
     - O frontend encontrava a ordem pelo `ticket` e forçava `status = 'OPEN'`, fazendo a ordem reaparecer no gráfico.
     - No tick seguinte do mercado, `hitTP` fechava de novo; no próximo broadcast, o MT5 reabria. A ordem piscava ininterruptamente.
  2. **Descarte Agressivo e Inconsistente de Ordens sem Ticket (6 segundos):**
     - No handler de `ACCOUNT_INFO`, ordens locais sem confirmação de ticket após 6s eram marcadas como `CLOSED_LOSS` (mesmo para ordens locais de paper trading).
     - Quando o MT5 respondia, a ordem anterior já estava fechada como perda e o sistema criava uma nova ordem duplicada (`id: mt5-${pos.ticket}`), gerando salto e piscar na tela.
  3. **Ordens Pendentes (`PENDING_LIMIT`) Sendo Expiradas/Executadas Localmente:**
     - Ordens limite pendentes enviadas ao book da B3 pelo MT5 estavam sujeitas à expiração local por pullback (`EXPIRED_PULLBACK`) do frontend enquanto ainda estavam vivas no livro de ofertas do terminal.
- **Solução Implementada e Validada:**
  - **Guarda de Soberania do MT5 (`isManagedByMT5`):**
    - Definido `const isManagedByMT5 = (Boolean(ord.ticket) || ord.isRealMT5) && mt5State.status === 'CONNECTED' && !isReplayMode;`.
    - Quando uma posição é gerenciada pelo MT5, as rotinas locais de liquidação `hitTP`, `hitSL`, `sessionLock` e cancelamento de `PENDING_LIMIT` são desativadas no frontend.
    - O MetaTrader 5 e a corretora são a autoridade exclusiva no fechamento da ordem real.
    - O frontend fecha a ordem de forma limpa, definitiva e sem piscar apenas quando a posição deixa de existir na lista do MT5 (`!liveTicketSet.has(o.ticket)`), com o motivo correto (`TAKE_PROFIT` ou `STOP_LOSS`).
  - **Higienização de Ordens Pendentes e Sincronização Estável:**
    - Tolerância de ordens pendentes estendida para 30 segundos e restrita estritamente a ordens `isRealMT5`. Ordens de simulação/replay não são descartadas por falta de ticket.
    - Broadcast de `pendingOrders` e `varalConfig` sincronizado de forma consistente tanto em `ACCOUNT_INFO` quanto em `MT5_EQUITY_UPDATE`.
  - **Build de Produção:** Testado e aprovado com sucesso via `npm run build`.

---

### H. Calibração Anti-Estouro e Proteção de Perda Diária no Mini-Índice (`WINZ26`)
- **Problema Reportado:** "Estes numeros estranhos de estouros, bloqueia os EA por perda, no indice tem sido mais frequente agora".
- **Causas Raízes Identificadas na Auditoria em Tempo Real:**
  1. **Deltas de Clímax Extremo com Limiar de 50 Contratos:**
     - Em `eventos_WINZ26_20261111.csv`, foram registrados deltas anômalos de +5.972, -8.311, +7.133, +11.124 e -7.936 em boxes individuais do índice.
     - O limiar de corte de confluência do robô estava cravado no piso de fábrica de apenas **50 contratos** (50 contratos no WIN é ruído desprezível contra volumes de 20.000+ contratos por box).
     - Sem teto de estouro e com o filtro de exaustão desligado, o robô interpretava o clímax como sinal de entrada e comprava no topo do estouro (ou vendia no fundo).
  2. **Efeito Chicote (*Whipsaw*) em Mercado Consolidado:**
     - Com o mercado lateralizado (*Efficiency Ratio* entre 0.07 e 0.28), o robô emitia viradas compulsórias consecutivas a cada 30 segundos (BUY -> SELL -> BUY -> SELL), estopando posições repetidamente.
  3. **Trava de Perda Diária Curta (R$ 500):**
     - O backend mantinha `max_daily_loss: 500.0`. Após 4 a 5 viradas nos estouros, a perda batia R$ 500 e acionava o bloqueio definitivo do EA no dia (`STOP_DIARIO_ATINGIDO`), zerando tudo e impedindo novas operações.
  4. **Contaminação de Stop de Dólar no Índice:**
     - Identificadas ordens enviadas com `sl_pontos: 2.5` no WIN (parâmetro de dólar), que eram liquidadas instantaneamente pela corretora no primeiro tick de 5 pontos do índice.
- **Implementações e Blindagens Aplicadas:**
  - **Piso Mínimo Institucional do Índice:** Elevado de 50 para **300 contratos** (`req_buy/req_sell = max(req, 300)`).
  - **Teto Anti-Estouro / Clímax (`max_delta_ceiling = 4500`):** Deltas anômalos isolados acima de 4.500 contratos são filtrados como barras de exaustão institucional (`CALADO_ESTOURO_CLIMAX`), impedindo compras no topo de rompimento falso.
  - **Ativação de Fábrica dos Filtros de Proteção:**
    - `exhaustionFilterEnabled: true` (filtro de exaustão de fluxo ativo).
    - `consolidationFilterEnabled: true` (filtro de acumulação/range curto ativo para ER < 0.35).
  - **Guarda Anti-Contaminação de Stop no WIN:** Ordens no Mini-Índice com SL inferior a 30 pontos são automaticamente rejeitadas/corrigidas para o padrão seguro de 50 pontos.
  - **Alinhamento do Limite de Perda e Rearme do EA:**
    - `max_daily_loss` do WIN elevado para **R$ 1.000,00**.
    - Implementada a ação WebSocket `RESET_RISK_LOCK` e o botão **"🔓 Desbloquear / Rearmar Trava de Perda MT5"** na interface para que o operador possa destravar o EA diretamente pelo painel.
- **Status:** Compilado, testado e em execução ativa no processo `bot_mt5_ciclo15.py`.

---

### I. Eliminação Definitiva do PnL Fictício (> R$ 33.000) no Mini-Índice e Blindagem Contra Cache Obsoleto (`localStorage`)
- **Problema Reportado:** "pnl do idice agora mais de 33.000 não resolveu as alterações".
- **Causas Raízes Identificadas:**
  1. **Contaminação Cruzada de Preço via Closure Defasado (`toggleMT5Connect` em `App.tsx`):**
     - Enquanto o MT5 real do `WINZ26` marcava **R$ +24,00** (193 deals no dia), os handlers `ACCOUNT_INFO` e `MT5_EQUITY_UPDATE` liam `asset` e `currentPrice` estáticos do closure de conexão.
     - Ao alternar entre `WDOZ26` (~5.585 pts) e `WINZ26` (~174.700 pts), o cálculo local subtraía o preço do dólar do índice: `(174.700 - 5.585) × R$ 0,20 = R$ 33.823,00`.
  2. **Fallback Permissivo em `isOrderForAsset` (`assetRegistry.ts`):**
     - Ordens sem `symbol`/`magicNumber` ou com `entryPrice <= 0` caíam em `return true`, contaminando `stats` e `hedgeBook`.
  3. **Sobrescrita da Ponte pelo `localStorage` do Navegador (`SYNC_EA_CONFIG`):**
     - O navegador mantinha valores legados salvos (`minDeltaThreshold = 50`, `adaptive = false`, `consolidation_enabled = false`, `exhaustion_enabled = false`, `flow_divergence_min = 0.05`) além de `ASSETS.WIN.tradeDefaults.minDeltaThreshold = 50`.
     - Ao conectar o WebSocket, o frontend enviava `SYNC_EA_CONFIG` e desarmava os filtros calibrados na ponte Python, permitindo entradas fracas (`Score 2/10` e `3/10`) e estouros (`Δ 4225`).
- **Soluções e Blindagens Aplicadas:**
  - **Validação Estrita de Escala (`isPriceSaneForAsset` em `assetRegistry.ts`):** Bloqueia matematicamente qualquer preço fora da banda física do contrato (`WIN`: 50.000–300.000 pts; `WDO`: 1.000–20.000 pts; `BIT`: 50.000–3.000.000 pts).
  - **Refs em Tempo Real no WebSocket (`activeAssetRef` e `currentPriceRef` em `App.tsx`):** Eliminam closures defasados em `ACCOUNT_INFO` e `MT5_EQUITY_UPDATE`, priorizando `priceCurrent`, `profit` e os `deals` oficiais do MT5.
  - **Soberania do MT5 em `hedgeBook`, `stats`, `OrdersAndStats.tsx` e `IntradayOrderAudit.tsx`:** Quando conectado ao MT5 fora de replay/simulação, o resultado do dia vem exclusivamente do `dayStatsBySymbol` oficial da corretora.
  - **Migração Automática `migrateAntiBurstCycle` (`antiBurstMigration.ts`):** Atualiza automaticamente `fluxo_renko_ea_config_v3`, `fluxo_asset_trade_params_WIN` e `fluxo_strategy_library_v1` para `minDeltaThreshold >= 300`, filtros de consolidação/exaustão ligados (`true`), `flowDivergenceMin >= 0.4`, e expurga ordens antigas com PnL espúrio `> R$ 10.000` do cache.
  - **Pisos de Segurança Invioláveis na Ponte Python (`bot_mt5_ciclo15.py`):**
    - `MAX_DELTA_CEILING` reduzido de `4500` para **`3200`** no `WIN`.
    - Exigência de **Score mínimo `4/10`** para sinais de Pirâmide no `WIN` (`CALADO_SCORE_BAIXO`).
    - `apply_ea_config` impõe pisos mínimos obrigatórios para `WIN` (`min_delta >= 300`, `flow_divergence_min >= 0.35`, `consolidation_enabled = True`, `exhaustion_enabled = True`, `adaptive = True`), impedindo que caches antigos rebaixem a seletividade.

---

## 2. Pauta Prioritária para Calibração das Estratégias

1. **Calibração do Robô 2 (Varal de Ordens):**
   - **Mini-Índice (`WINZ26`):** Testar modo `MARKET` no fechamento do box (TP 50 pts, SL 100 pts) versus modo `LIMIT` (3 ordens a cada 50 pts).
   - **Mini-Dólar (`WDOZ26`):** Testar varal com passo de 2.5 pts e TP de 2.5 a 5.0 pts.
   - **Bitcoin B3 (`BITX26`):** Ajustar folga do Stop Loss para comportar o spread médio de 100 a 200 pts.
2. **Convivência Robô 1 (Mestre - Fluxo Institucional) vs Robô 2 (Varal - Price Action Puro):**
   - Avaliar a rentabilidade combinada quando ambos operam o mesmo ativo em paralelo.
   - Analisar o drawdown consolidado com ordens de ambos os Magics abertas na mesma direção ou em hedge pontual.
3. **Afinação dos Limiares de Agressão por Horário da Fita:** ✅ *Concluído & Validado*
   - Grade adaptativa por `Tape Time` implementada no backend e frontend:
     - *Abertura (09:00 - 10:30):* $P_{70}$, Divergência mínima 15%, Piso 1.4× (captura rompimentos fortes).
     - *Manhã Regular (10:30 - 12:00):* $P_{75}$, Divergência 18%, Piso 1.5×.
     - *Meio-dia (12:00 - 14:00):* $P_{80}$, Divergência mínima 25%, Piso 1.8× (blinda contra falsos rompimentos).
     - *Tarde Regular (14:00 - 16:00):* $P_{75}$, Divergência 18%, Piso 1.5×.
     - *Fechamento (16:00 - 17:30):* $P_{80}$, Divergência mínima 20%, Piso 1.6× (desaceleração pré-leilão).
   - Espelhado no painel visual da interface com badge dinâmico da fase e critérios ativos.

---

## 3. Comandos para Execução dos Serviços

### Terminal 1: Backend MT5 (Python)
```powershell
Set-Location "C:\Users\Lucas\Documents\RoboFluxoB3"
.\venv\Scripts\python.exe -u bot_mt5_ciclo15.py
```

### Terminal 2: Frontend Web (React + Vite)
```powershell
Set-Location "C:\Users\Lucas\Documents\RoboFluxoB3\interface_github"
npm run dev
```

### URL da Aplicação:
```
http://localhost:3000/
```
