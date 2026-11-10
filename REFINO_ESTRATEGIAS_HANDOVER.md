# 🎯 RoboFluxoB3 — Handover & Documentação de Evoluções: "Refino de Estratégias"
**Data:** 10 de Novembro de 2026  
**Ambiente:** Windows 11 · MetaTrader 5 XP Demo (`#50534540`) · Vite / React 18 · Python 3.12 (venv)  
**Status do Sistema:** ✅ Estável, Compilado, Sincronizado e Conectado ao Vivo na B3

---

## 1. Evoluções Realizadas na Sessão Atual

### A. Correção Arquitetural do PnL (Lucro & Prejuízo Consolidado)
- **Diagnóstico:** Anteriormente, o painel dos robôs calculava apenas o lucro flutuante instantâneo das ordens abertas no momento (`posList.reduce(profit)`), enquanto a boleta calculava o realizado fechado da sessão. Isso gerava discrepâncias visuais para o operador.
- **Implementação Backend (`bot_mt5_ciclo15.py`):**
  - Implementada a função `fetch_mt5_day_stats(symbol)` com separação estrita por ativo:
    - 🟦 **Mini-Índice (`WIN`):** Realizado Fechado do dia
    - 🟩 **Mini-Dólar (`WDO`):** Realizado Fechado do dia
    - 🟨 **Bitcoin B3 (`BIT`):** Realizado Fechado do dia
    - 🌐 **Global:** Total líquido fechado da conta inteira
  - Cache inteligente de 4.0s para consulta de histórico do MT5 (evitando varredura repetitiva de 490+ negócios que travava o stream de ticks).
  - Broadcast assíncrono paralelo com `asyncio.gather` e timeout individual de 1.5s, eliminando o congelamento de conexões quando múltiplas janelas/telas estão abertas.
- **Implementação Frontend (`interface_github`):**
  - Em `MultiAssetRobotsBar.tsx` e `MultiAssetRobotsPanel.tsx`: O cálculo do PnL do robô agora unifica:
    $$\text{PnL do Robô} = \text{Net Realizado do Ativo (Fechado)} + \text{Flutuante em Aberto}$$
  - Em `BoletaTicket.tsx`: O chip recolhido da boleta agora exibe o PnL financeiro do dia em R$ em destaque com badge colorido (`+R$ / −R$`).
  - Sincronização em tempo real entre navegador principal e popouts externos via `BroadcastChannel('MT5_DAY_STATS_SYNC')`.

---

### B. Eliminação Definitiva do Bug `R$ NaN` e `TP +NaNp`
- **Causa Raiz Identificada:**
  - O backend Python enviava o preço de abertura da posição como `'priceOpen'` (camelCase), enquanto trechos do frontend aguardavam `'price_open'` (snake_case).
  - Com `pos.price_open` resultando em `undefined`, a diferença de pontos calculava `currentPrice - undefined = NaN`, contaminando o financeiro em R$ e a distância da régua de Take Profit (`TP +NaNp`).
- **Correções Aplicadas:**
  1. **Python (`bot_mt5_ciclo15.py`):** Agora envia simultaneamente `priceOpen` e `price_open`, além de `priceCurrent` e `price_current`.
  2. **React (`App.tsx`):** Unificação segura do parser:
     ```typescript
     const openPrice = Number(pos.priceOpen ?? pos.price_open ?? 0);
     ```
     Todas as posições agora recebem fallback numérico protegido e validação estrita com `Number.isFinite(...)`.
  3. **Boleta (`BoletaTicket.tsx`):** A função formatadora `brl(v)` valida se o número é finito antes de invocar `toLocaleString`, exibindo com elegância `R$ 0,00` em vez de `R$ NaN`.
  4. **Gráfico (`RenkoFlowChart.tsx`):** As etiquetas de Take Profit, Stop Loss e Reteste Limitado foram blindadas com cálculo de distância seguro contra preços não preenchidos.

---

### C. Calibração Operacional dos 3 Robôs (Confluência, Pirâmide & Travas)
- **Mini-Índice (`WINZ26` - Magic `150101`):** Renko `10R` (50 pts) · Limiar Delta $P_{70} = 300$ ctros · Divergência de fluxo $\ge 15\%$ · SL 50 pts / TP 100 pts.
- **Mini-Dólar (`WDOZ26` - Magic `150201`):** Renko `2.5R` (2.5 pts) · Limiar Delta $P_{70} = 400$ ctros · Filtro anti-absorção ativo · SL 2.5 pts / TP 5.0 pts.
- **Bitcoin B3 (`BITX26` - Magic `150301`):** Renko `100R` (100 pts) · Limiar Delta $P_{70} = 35$ ctros · SL 200 pts / TP 400 pts.
- **Regras de Piramidação:** Máximo de 3 adições a favor da tendência com novo delta comprovado; Breakeven automático da Ordem Mãe para $+1$ tick de lucro assim que a pirâmide 1 for acionada.
- **Travas Diárias:** Teto de perda financeira diária e lock de meta de lucro monitorados individualmente por robô e no consolidado da conta.

---

## 2. Pauta Prioritária para a Próxima Conversa: "Refino de Estratégias"

Na próxima sessão com o tema **"Refino de Estratégias"**, os tópicos imediatos de avanço são:

1. **Afinação Dinâmica dos Limiares de Agressão por Horário de Pregão:**
   - Calibrar o percentil de agressão ($P_{70}$ vs $P_{80}$) conforme a fase do pregão:
     - *Abertura (09:00 - 10:30):* Alta volatilidade e volume concentrado.
     - *Almoço (12:00 - 14:00):* Redução de liquidez, exigência de divergência mais rígida para evitar falso rompimento.
     - *Tarde / Fechamento (16:00 - 18:00):* Ajuste ao fluxo de derivativos e leilão.
2. **Backtesting Automatizado & Relatório de Curva de Capital (Headless):**
   - Rodar bateria de testes com base nos extratos reais gravados no disco (`deals_*.csv` e logs de ticks).
   - Simular diferentes combinações de Take Profit da Pirâmide (1 box vs 2 boxes) e impacto no drawdown máximo.
3. **Refinamento do Trailing Stop Multiescala:**
   - Avaliar a sensibilidade do Stop Móvel Renko Caixa a Caixa: manter a 1 box de distância ou permitir folga de 2 boxes em ativos mais voláteis como o Bitcoin B3 (`BITX26`).
4. **Alocação Dinâmica de Contratos e Gestão de Lotes:**
   - Parametrizar aumento de lote baseado na pontuação de convicção da agressão (Score de Fluxo de 1 a 10).

---

## 3. Comandos para Iniciar os Serviços

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
