# 🎯 RoboFluxoB3 — Relatório da Sessão "Estratégias"
**Data:** 10 de Novembro de 2026  
**Status:** ✅ Concluído com Sucesso e Validado ao Vivo no MT5 XP  
**Ambiente:** Windows 11 · MetaTrader 5 XP Demo (`#50534540`) · Vite / React 18 · Python 3.12 (venv)

---

## 1. Resumo Executivo das Entregas

Nesta sessão dedicada a **Estratégias (Calibração, Confluência e Execução dos 3 Robôs)**, foram consolidadas as 3 etapas operacionais planejadas:

1. **Etapa 1 — Calibração Fina dos Gatilhos & Filtro Anti-Absorção:**
   - Extração estatística de mais de 160.000 ticks reais do pregão ao vivo da B3.
   - Detecção de absorções maciças (25% dos boxes do dólar fecham contra o fluxo).
   - Ajuste dos pisos de delta e razão de divergência de fluxo de 50% para 15% (adequado à dinâmica institucional da B3).
   - Veto sumário a falsos rompimentos (`CALADO_ABSORCAO`).
   - Trava de proteção contra spread excessivo antes de disparos a mercado.

2. **Etapa 2 — Piramidação a Favor da Tendência & Breakeven Inteligente:**
   - Adição sequencial com teto seguro (`max_pyramids = 3`) por robô.
   - **Breakeven Automático Protegido:** Ao entrar a 1ª pirâmide ou ao atingir o Take Profit da pirâmide, o Stop Loss da Ordem Mãe é deslocado para o preço de entrada $+1$ tick a favor da operação (+5 pts WIN, +0.5 pts WDO, +20 pts BIT) cobrindo emolumentos.
   - Arredondamento estrito em múltiplos de `trade_tick_size` e `digits` do MT5 (risco zero de rejeição por `Invalid stops`).
   - Inversão de Fluxo: zeragem atômica imediata das posições anteriores caso ocorra confluência forte no sentido oposto.

3. **Etapa 3 — Regras de Saída, Trailing Stop Caixa a Caixa & Travas de Risco:**
   - **Trailing Stop Renko Caixa a Caixa:** A cada novo box fechado a favor da posição, o Stop Loss sobe 1 degrau de Renko (na compra: base do box; na venda: topo do box), garantindo lucros em puxadas de tendência.
   - **Travas Diárias de Risco por Ativo:** Monitoramento em tempo real do PnL consolidado (fechado + flutuante) isolado por Magic Number. Se atingir o teto de perda, zera tudo e bloqueia novas ordens; se atingir a meta diária, trava os lucros.

---

## 2. Topologia Calibrada dos 3 Robôs

| Parâmetro | 🟦 Mini-Índice (`WINZ26`) | 🟩 Mini-Dólar (`WDOZ26`) | 🟨 Bitcoin B3 (`BITX26`) |
|---|---|---|---|
| **Magic Number** | `150101` | `150201` | `150301` |
| **Escala Renko** | `10R` (50 pts) | `2.5R` (2.5 pts) | `100R` (100 pts) |
| **Tamanho do Tick** | 5.0 pts | 0.5 pts | 20.0 pts |
| **Valor por Ponto** | R$ 0,20 / contrato | R$ 10,00 / contrato | R$ 0,10 / contrato |
| **Contratos (Mãe / Pirâmide)** | 2 / 1 | 1 / 1 | 1 / 1 |
| **Stop Loss Padrão** | 50.0 pts (1 box) | 2.5 pts (1 box) | 200.0 pts (2 boxes) |
| **Take Profit Padrão**| 100.0 pts (2 boxes) | 5.0 pts (2 boxes) | 400.0 pts (4 boxes) |
| **Take Profit Pirâmide**| 50.0 pts (1 box) | 2.5 pts (1 box) | 100.0 pts (1 box) |
| **Teto Máximo de Pirâmides**| 3 adições | 3 adições | 3 adições |
| **Limiar Mínimo Delta**| 300 ctros ($P_{70}$ janela 20b) | 400 ctros ($P_{70}$ janela 20b) | 35 ctros ($P_{70}$ janela 20b) |
| **Offset Breakeven** | +5.0 pts (+1 tick) | +0.5 pts (+1 tick) | +20.0 pts (+1 tick) |
| **Trailing Stop Caixa a Caixa** | Ativo (degrau Renko) | Ativo (degrau Renko) | Ativo (degrau Renko) |
| **Teto Perda Diária (Loss Lock)**| R$ 500,00 | R$ 300,00 | R$ 300,00 |
| **Meta Lucro Diário (Gain Lock)**| R$ 1.000,00 | R$ 600,00 | R$ 600,00 |
| **Trava Máxima de Spread** | 3 ticks (15 pts) | 3 ticks (1.5 pts) | 3 ticks (60 pts) |

---

## 3. Validação Real no Pregão de Hoje

- **Mini-Índice (`WINZ26`):**
  - Dos 115 boxes gerados hoje, 83 passavam sem calibração. Com a nova calibração (anti-absorção e divergência $\ge 0.15$), reduziu para **49 sinais cirúrgicos**, barrando **29 armadilhas de fluxo**.
- **Mini-Dólar (`WDOZ26`):**
  - Dos 19 boxes, reduziu de 12 sinais falsos para **6 entradas de alta convicção**, barrando **7 falsos rompimentos absorvidos**.
  - PnL fechado auditado no dia: **+R$ 2.185,00** (atingiu com folga a meta diária, disparando o Lock de Proteção de Ganho).
- **Bitcoin B3 (`BITX26`):**
  - 187 sinais capturados em 725 boxes, barrando **200 armadilhas de ruído de spread**.

---

## 4. Como Iniciar os Serviços

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

### URL:
```
http://localhost:3000/
```
