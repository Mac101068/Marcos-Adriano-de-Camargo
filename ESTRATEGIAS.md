# 🎯 RoboFluxoB3 — Handover para a Sessão "Estratégias"
**Data:** 10 de Novembro de 2026  
**Tópico da Nova Conversa:** Estratégias (Calibração, Confluência e Execução dos 3 Robôs)  
**Ambiente:** Windows 11 · MetaTrader 5 XP Demo (`#50534540`) · Vite / React 18 · Python 3.12 (venv)

---

## 1. O que Foi Entregue na Sessão Anterior ("Configuração do Robô")

1. **Arquitetura Multi-Robôs Especializada (Índice, Dólar e Bitcoin):**
   - O EA/Ponte Python (`bot_mt5_ciclo15.py`) monitora os 3 feeds em tempo real.
   - Separação rigorosa por **Magic Number** e especificações nativas de pontuação B3:
     - 🟦 **Mini-Índice (`WINZ26`):** Magic `150101` · Renko `10R` (50 pts) · Tick `5.0`
     - 🟩 **Mini-Dólar (`WDOZ26`):** Magic `150201` · Renko `2.5R` (2.5 pts) · Tick `0.5` · Digits `3`
     - 🟨 **Bitcoin B3 (`BITX26`):** Magic `150301` · Renko `100R` (100 pts) · Tick `20.0` · Digits `2`
2. **Modo Copiloto Operacional (Operador Administra as Entradas):**
   - O EA analisa o fluxo, calcula a confluência de agressão e delta institucional, e gera os sinais em tempo real.
   - No modo `COPILOT`, o robô **não dispara ordens a mercado sozinho às cegas**. Ele sinaliza visualmente na tela e o operador admite a entrada com **apenas 1 clique**.
   - Se o operador desejar, pode alternar para o modo `AUTO` (automático total) ou `SHADOW` (papel/simulação).
3. **Consolidação Visual no Frontend (`interface_github`):**
   - **Tira de Mini-Cards no Gráfico (`MultiAssetRobotsBar.tsx`):** Exibe `WIN`, `WDO` e `BIT` com LED de status, PnL ao vivo em R$ e botão pulsante de disparo rápido (`[⚡ BUY]` ou `[⚡ SELL]`).
   - **Janela Flutuante com Abas (`MultiAssetRobotsPanel.tsx`):** Abas dedicadas `[WIN]`, `[WDO]`, `[BIT]` com controles de risco (contratos, stop loss, take profit), detalhe do último sinal gerado com justificativa de fluxo e botões de compra/venda/zeragem individual.
4. **Resolução de Bugs Críticos de Execução no MT5:**
   - **Bug do `point` no Dólar/Bitcoin:** Corrigido o cálculo de Stop Loss e Take Profit que antes multiplicava por `0.001` no dólar gerando rejeição `Invalid stops (RetCode=10016)`. Agora o cálculo respeita a escala de pontos reais e arredonda estritamente para o múltiplo de `tick_size`.
   - **Trava de Armamento:** Ordens manuais e do Copiloto são executadas imediatamente sem exigir o robô automático armado.
   - **Comentário de Ordem:** Ajustado o tamanho da string de comentário para cumprir os limites rígidos do terminal MT5 da corretora XP.
   - **Validação:** Ordem real no Mini-Dólar testada e executada com sucesso comprovado (`Ticket #2589675173`).

---

## 2. Topologia Atual dos 3 Robôs

| Parâmetro | 🟦 Mini-Índice (WIN) | 🟩 Mini-Dólar (WDO) | 🟨 Bitcoin B3 (BIT) |
|---|---|---|---|
| **Símbolo Vigente** | `WINZ26` (contínuo: `WIN$`) | `WDOZ26` (contínuo: `WDO$`) | `BITX26` (contínuo: `BIT$`) |
| **Magic Number** | `150101` | `150201` | `150301` |
| **Escala Renko** | `10R` (50 pontos) | `2.5R` (2.5 pontos) | `100R` (100 pontos) |
| **Tamanho do Tick** | 5.0 pts | 0.5 pts | 20.0 pts |
| **Valor por Ponto** | R$ 0,20 / contrato | R$ 10,00 / contrato | R$ 0,10 / contrato |
| **Contratos Padrão** | 1 (ou 2) | 1 | 1 |
| **Stop Loss Padrão** | 50.0 pts (1 box) | 2.5 pts (1 box) | 200.0 pts (2 boxes) |
| **Take Profit Padrão**| 100.0 pts (2 boxes) | 5.0 pts (2 boxes) | 400.0 pts (4 boxes) |
| **Limiar Mínimo Delta**| 150 contratos | 20 contratos | 50 contratos |

---

## 3. Pauta Prioritária para a Nova Conversa ("Estratégias")

Ao iniciar a nova conversa com o tema **"Estratégias"**, as metas imediatas são:

### 1. Calibração Fina dos Gatilhos de Entrada por Ativo:
- **Índice (10R):** Validação da confluência de rompimento com saldo de agressão (Delta P70 da janela de 20 boxes).
- **Dólar (2.5R):** Calibração de absorção institucional vs agressão direta no mini-dólar. Como o dólar tem liquidez concentrada em poucos níveis de preço, verificar se o limiar de delta de 20 contratos é ideal para o pregão atual.
- **Bitcoin (100R):** Ajuste dos níveis de volatilidade rápida e gap de spread no contrato futuro de Bitcoin B3.

### 2. Regras de Piramidação e Posições Múltiplas:
- **Ordem Mãe:** Entrada inicial a favor da confluência.
- **Piramidações:** Adição de lotes a cada fechamento de bloco a favor da tendência com novo delta positivo/negativo.
- **Proteção do Breakeven:** Mover automaticamente o stop da ordem mãe para o zero a zero assim que a 1ª pirâmide atingir o alvo parcial.

### 3. Regras de Saída e Encerramento:
- **Trailing Stop:** Seguir o fechamento do bloco anterior no Renko (Stop Móvel Caixa a Caixa).
- **Inversão de Fluxo:** Zeragem instantânea da posição comprada caso ocorra confluência forte no sentido oposto (virar a mão).
- **Travas Diárias de Risco:** Teto de perda financeira diária por ativo e meta de ganho diária (Lock de Lucro).

---

## 4. Como Iniciar os Serviços na Nova Sessão

### Terminal 1: Ponte MT5 Backend
```powershell
Set-Location "C:\Users\Lucas\Documents\RoboFluxoB3"
.\venv\Scripts\python.exe -u bot_mt5_ciclo15.py
```

### Terminal 2: Servidor Vite Frontend
```powershell
Set-Location "C:\Users\Lucas\Documents\RoboFluxoB3\interface_github"
npm run dev
```

### URL da Interface Web:
```
http://localhost:3000/
```
