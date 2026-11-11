# 🎯 RoboFluxoB3 — Handover & Documentação de Evoluções: "Refino de Estratégias"
**Data:** 10 de Novembro de 2026  
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

## 2. Pauta Prioritária para Calibração das Estratégias

1. **Calibração do Robô 2 (Varal de Ordens):**
   - **Mini-Índice (`WINZ26`):** Testar modo `MARKET` no fechamento do box (TP 50 pts, SL 100 pts) versus modo `LIMIT` (3 ordens a cada 50 pts).
   - **Mini-Dólar (`WDOZ26`):** Testar varal com passo de 2.5 pts e TP de 2.5 a 5.0 pts.
   - **Bitcoin B3 (`BITX26`):** Ajustar folga do Stop Loss para comportar o spread médio de 100 a 200 pts.
2. **Convivência Robô 1 (Mestre - Fluxo Institucional) vs Robô 2 (Varal - Price Action Puro):**
   - Avaliar a rentabilidade combinada quando ambos operam o mesmo ativo em paralelo.
   - Analisar o drawdown consolidado com ordens de ambos os Magics abertas na mesma direção ou em hedge pontual.
3. **Afinação dos Limiares de Agressão por Horário da Fita:**
   - Calibrar o percentil de agressão ($P_{70}$ vs $P_{80}$) conforme a fase do pregão reproduzida na fita:
     - *Abertura (09:00 - 10:30):* Alta liquidez e volatilidade.
     - *Meio-dia (12:00 - 14:00):* Faixa de consolidação, exigindo maior divergência de fluxo.
     - *Fechamento (16:00 - 17:30):* Desaceleração pré-leilão.

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
