# Robô Fluxo B3 — Handover & Estado Consolidado do Projeto
**Data:** 04 de Novembro de 2026  
**Status do Projeto:** 100% Funcional e Sincronizado | Multi-Ativo Ativo | Ponte MT5 Integrada  

---

## 1. Visão Geral da Arquitetura

O sistema é uma plataforma completa e profissional de automação e análise de Tape Reading e Gráficos Atemporais (Renko, Range Bar e Tempo) operando no MetaTrader 5 e na B3:

```
┌──────────────────────────────────────────────┐
│  FRONTEND WEB (React 18 + Vite + TypeScript) │
│  Porta: 3000 (localhost:3000)                │
│  Diretório: RoboFluxoB3\interface_github     │
└──────────────────────┬───────────────────────┘
                       │ WebSocket (ws://127.0.0.1:8765)
                       ▼
┌──────────────────────────────────────────────┐
│  PONTE MT5 PYTHON (Asyncio + MetaTrader5)    │
│  Script: RoboFluxoB3\bot_mt5_ciclo15.py      │
│  Porta: 8765                                 │
└──────────────────────┬───────────────────────┘
                       │ C-API Python MT5
                       ▼
┌──────────────────────────────────────────────┐
│  METATRADER 5 (Corretora XP Investimentos)   │
│  Ativos: WINZ26, WDOZ26, BITX26              │
└──────────────────────────────────────────────┘
```

---

## 2. Principais Avanços Concluídos Nesta Sessão (04/11/2026)

### A. Correção da Curva de Patrimônio com Dados Reais do MT5
- Criados os handlers `GET_MT5_EQUITY` e o broadcaster em loop contínuo `mt5_equity_broadcaster_loop()` no `bot_mt5_ciclo15.py`.
- Transmissão de saldo, patrimônio, margem, posições abertas e histórico de deals fechados da corretora.
- Na aba **Curva de Patrimônio** do frontend, a visualização agora consome os dados reais auditados do MT5 ao vivo.

### B. Módulo de Backtest com Ticks Reais da B3 (`backtest_ticks_reais.py`)
- Substituída a geração sintética por ticks reais históricos capturados do MT5 via `copy_ticks_from` (`mt5.COPY_TICKS_ALL`).
- Algoritmo de formação estrita de Renko com resolução de agressão B3 (BUY / SELL / CROSS).
- Estratégia de Pirâmide & Confluência com simulação de parciais, proteção de breakeven e cálculo de PnL por contrato/ponto de cada ativo.
- Relatório consolidado com Taxa de Acerto, Fator de Lucro, Drawdown Máximo e Payoff.

### C. Suporte Multi-Ativo Completo (Mini Índice, Mini Dólar e Bitcoin B3)
- **Mini Índice (`WINZ26` / `WIN$`)**: Tick 5.0 pts | R$ 0,20/pt | 0 casas decimais | Padrão 50 pts (10R).
- **Mini Dólar (`WDOZ26` / `WDO$`)**: Tick 0.5 pt | R$ 10,00/pt | 1 casa decimal | Padrão 5.0 pts (10R) | Range Bar 10 pts.
- **Bitcoin B3 (`BITX26` / `BIT$`)**: Tick 20.0 pts | R$ 0,10/pt | 0 casas decimais | Padrão 100/200 pts | Range Bar 400 pts.

### D. Resolução Definitiva dos Gráficos de Dólar e Bitcoin
- **Causa eliminada**: Ao mudar de ativo, o motor Renko Python mantinha o preço anterior (169.500) e tentava fechar boxes até o preço do novo ativo (5.485 ou 441.000), disparando dezenas de milhares de boxes fantasma.
- **Solução implementada**: O comando `SELECT_ASSET` recria e reancora o `RENKO_ENGINE` no preço exato e renova o cache de backfill M1 (`send_today_session_backfill`).
- **Auto-escala e Eixo Y**: Ajustadas no canvas do `RenkoFlowChart.tsx` para respeitar as ordens de grandeza de cada ativo (grade com casas decimais no dólar via `formatPrice`).

### E. Correção do Bug de Reversão de Ativo ao Trocar o "R" do Renko
- **Causa eliminada**: Na biblioteca de estratégias (`StrategyLibraryService`), `assetId` e `symbol` não faziam parte de `RUNTIME_KEYS`. Quando o operador ajustava o R no gráfico de Dólar, o método `resolveOperational` lia a estratégia ativa salva no Mini Índice e forçava a volta do gráfico para o índice.
- **Solução implementada**:
  - `assetId` e `symbol` foram incluídos em `RUNTIME_KEYS` e ganharam precedência mandatória em `resolveOperational`.
  - Ao selecionar o ativo no Header, a estratégia ativa tem seu ativo atualizado.
  - Implementada a mensagem `{ action: "SET_BOX_POINTS", boxPoints: ... }` para sincronizar o tamanho do box com o robô Python em tempo real sem reiniciar a ponte.

---

## 3. Arquivos Críticos do Projeto

| Arquivo | Descrição |
|---|---|
| `RoboFluxoB3\bot_mt5_ciclo15.py` | Ponte MT5 WebSocket com streaming de ticks, gestão de ordens, backfill M1 e multi-ativo. |
| `RoboFluxoB3\backtest_ticks_reais.py` | Motor de backtest analítico com ticks reais da B3 e listagem de pregões. |
| `RoboFluxoB3\interface_github\src\App.tsx` | Aplicação web principal, conexão WebSocket, boleta, tape reading e gestão de estado. |
| `RoboFluxoB3\interface_github\src\assets\assetRegistry.ts` | Tabela única de especificações de ativos B3 (`WIN`, `WDO`, `BTCBR`, `BTC`). |
| `RoboFluxoB3\interface_github\src\services\strategyLibraryService.ts` | Armazenamento e isolamento de parâmetros operacionais vs runtime. |
| `RoboFluxoB3\interface_github\src\components\RenkoFlowChart.tsx` | Renderizador do gráfico Renko em HTML5 Canvas com auto-escala dinâmica e fluxo. |
| `RoboFluxoB3\interface_github\src\components\EquityCurveView.tsx` | Visualização da curva de patrimônio e auditoria de deals MT5. |

---

## 4. Comandos de Inicialização e Verificação

### Para Iniciar o Frontend (Porta 3000):
```powershell
Set-Location "C:\Users\Lucas\Documents\RoboFluxoB3\interface_github"
npm run dev
```

### Para Iniciar a Ponte MT5 (Porta 8765):
```powershell
Set-Location "C:\Users\Lucas\Documents\RoboFluxoB3"
.\venv\Scripts\python.exe -u bot_mt5_ciclo15.py
```

### Para Verificar a Integridade do Código:
```powershell
# Frontend TypeScript:
Set-Location "C:\Users\Lucas\Documents\RoboFluxoB3\interface_github"
npx tsc --noEmit

# Backend Python:
Set-Location "C:\Users\Lucas\Documents\RoboFluxoB3"
.\venv\Scripts\python.exe -m py_compile bot_mt5_ciclo15.py backtest_ticks_reais.py
```

---

## 5. Próximos Passos Sugeridos para a Nova Conversa

1. **Ajuste Fino das Regras de Trading por Ativo**:
   - Calibrar o Stop Loss e Take Profit padrão de cada ativo na boleta rápida (atualmente em pontos do Mini Índice por padrão, embora customizáveis).
2. **Execução de Backtest Histórico Multiativo em Lote**:
   - Rodar comparações estatísticas de 30 pregões em WDO e BITX26 para identificar o "R" ótimo de cada ativo.
3. **Refinamento do Livro de Ordens e Profundidade (DOM)**:
   - Expandir a captura de book seletivo se necessário para confluência de absorção pré-rompimento de box.

---

## 6. Prompt para Iniciar a Nova Conversa

Copie e cole o texto abaixo ao iniciar uma nova conversa com o assistente:

> *"Olá! Estou continuando o desenvolvimento do Robô Fluxo B3. Por favor, leia o arquivo `CONTEXTO_NOVA_CONVERSA_04_NOV_2026.md` na raiz de `C:\Users\Lucas\Documents\RoboFluxoB3` para se situar no estado atual do projeto. Hoje finalizamos a integração da Curva de Patrimônio com dados reais do MT5, o backtest de ticks reais da B3 e o suporte completo a Mini Índice, Mini Dólar e Bitcoin B3 (incluindo correções de auto-escala e o ajuste de R do Renko). Gostaria de prosseguir a partir desse ponto."*
