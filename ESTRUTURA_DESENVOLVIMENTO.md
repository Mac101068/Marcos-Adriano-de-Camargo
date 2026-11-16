# RoboFluxoB3 — Estrutura de Desenvolvimento e Arquitetura do Sistema

Documento de consolidação e referência para novas conversas e desenvolvimento contínuo do **RoboFluxoB3**.

---

## 1. Visão Geral e Estrutura dos Repositórios

O ecossistema é composto por dois repositórios Git no mesmo diretório de trabalho, com remotos e branches dedicados:

| Caminho | Remoto / Branch | Papel no Sistema |
|---|---|---|
| `C:\Users\Lucas\Documents\RoboFluxoB3` | `Mac101068/Marcos-Adriano-de-Camargo` · `backend-python` | Ponte WebSocket MT5, motor de decisão Renko/Fluxo, cálculo de CVD/convergência, gravação de extratos e backtests. |
| `C:\Users\Lucas\Documents\RoboFluxoB3\interface_github` | `Mac101068/Marcos-Adriano-de-Camargo` · `main` | Aplicação web React/Vite/TypeScript/Tailwind CSS: gráfico Renko/Range/Tempo, HUD de EAs, boleta rápida, controle de risco e auditoria intraday. |

> **Nota de Isolamento:** A pasta `interface_github/` consta no `.gitignore` da raiz. Portanto, alterações no frontend devem ser commitadas no repositório da interface (`interface_github`), e alterações no motor/backend devem ser commitadas no repositório da raiz.

---

## 2. Componentes e Arquivos Centrais

### Backend (`backend-python`):
- **`bot_mt5_ciclo15.py`**: Arquivo mestre que une o servidor WebSocket (porta `8765`), conexão IPC com o MetaTrader 5, cálculo dos tijolos Renko em tempo real, motor de convergência de fluxo (Delta/CVD), gestão de ordens/posições, e loops de auditoria de extratos (`deals_YYYYMMDD.csv`).
- **`test_paridade_regras.py`**: Suíte de testes de paridade entre as regras do motor Python e os cálculos do frontend.
- **`test_diario_eventos.py`**: Testes automatizados do diário de eventos, trilha de ordens e stubs MT5.
- **`_reiniciar_ponte.ps1`**: Script PowerShell oficial para inicialização e reinício da ponte MT5.
- **`data/pregoes/*.csv.gz`**: Fita histórica real de negócios da B3 comprimida para replay de mercado e calibração de estratégias.

### Frontend (`interface_github`):
- **`src/App.tsx`**: Orquestrador central de estado: conexão WebSocket, despacho de ordens, sincronização multi-abas via `BroadcastChannel`, alternância de ativos e lifecycle dos motores de barra.
- **`src/components/Header.tsx`**: Barra de navegação superior com seletor de ativo, estado de autenticação/armamento da ponte, toggle destacado do Robô (`⚡ Robô ON` / `Robô OFF`) e status do MT5.
- **`src/components/BoletaTicket.tsx`**: Boleta rápida de execução manual com sub-caixa de **Parâmetros Individualizados** por ativo (Lote, Stop Loss, Alvo, Parcial, Break Even e Trailing Stop).
- **`src/components/RenkoFlowChart.tsx`**: Renderizador do gráfico Renko/Range, volume de agressão por box e curvas de CVD/VWAP.
- **`src/components/FunnelMetricsPanel.tsx`**: Painel inferior do Funil de Convergência com calibração ao vivo de limiares de delta e filtros.
- **`src/assets/assetRegistry.ts`**: Fonte única da especificação dos contratos negociados (`WIN`, `WDO`, `BTCBR`), tick sizes, valores por ponto e limites de parâmetros.
- **`src/utils/convergenceEvaluator.ts`**: Avaliador matemático dos critérios de entrada (delta do bloco, inclinação de CVD, exaustão e consolidação).

---

## 3. Arquitetura da Ponte WebSocket e Segurança

1. **Endereço e Porta:** `ws://0.0.0.0:8765` (acessível localmente e via rede local, ex: `192.168.18.154`).
2. **Autenticação:** Token de segurança (`AUTH_TOKEN`) compartilhado via `bridge_token.txt` e sincronizado com o frontend em `public/bridge_token.txt`.
3. **Modos de Operação e Travas:**
   - **`ORDERS_BLOCKED`**: Trava de execução por ambiente. O padrão no código é `0` para permitir operação direta (Demo/Real). Se iniciado com `ORDERS_BLOCKED=1`, a ponte opera em modo somente-leitura/replay.
   - **Desarme de Trava via Interface:** O operador pode alternar ou destravar o modo replay a qualquer momento diretamente pela interface (botão `⚡ OPERA` ou `🔓 DESTRAVAR MT5`), enviando `{ action: 'SET_REPLAY_MODE', on: false, unlockEnv: true }` e `{ action: 'ARM' }`.
4. **Isolamento de Magic Numbers:**
   - **`102030`**: Robô Principal (Estratégia Renko Flow / Acumulação).
   - **`999999`**: Boleta Manual rápida da interface.
   - **`100001`**: RoboCompra (Hedge direcional de alta).
   - **`100002`**: RoboVenda (Hedge direcional de baixa).
   - **`1501xx / 1502xx / 1503xx`**: Varais de ordens específicas por ativo (WIN, WDO, BIT).

---

## 4. Individualização de Parâmetros por Ativo

Cada contrato possui dinâmica, volatilidade e régua financeira próprias. Por isso, os parâmetros de execução são gravados de forma isolada no `localStorage` sob a chave `fluxo_asset_trade_params_<ASSET_ID>`:

| Ativo | Símbolo Vigente | R$ / Ponto | Tick Mínimo | Box Padrão | Stop Padrão | Alvo Padrão | Limiar Δ |
|---|---|---|---|---|---|---|---|
| **WIN** | `WINZ26` | R$ 0,20 | 5 pts | 50 pts (10R) | 50 pts | 100 pts | 150–300 |
| **WDO** | `WDOZ26` | R$ 10,00 | 0,5 pt | 2.5 pts (5R) | 2.5 pts | 5.0 pts | 15–30 |
| **BIT** | `BITX26` | R$ 0,01 | 20 pts | 100 pts (5R) | 100 pts | 200 pts | 35–50 |

- Ao alternar de ativo no seletor, o frontend salva o estado do ativo anterior e restaura imediatamente os parâmetros do novo contrato.
- A boleta exibe a identificação visual ativa: `PARÂMETROS [ WIN ]`, `PARÂMETROS [ WDO ]` ou `PARÂMETROS [ BTCBR ]`.
- Ao sincronizar o ativo, a ponte MT5 recebe `SELECT_ASSET` e `SYNC_EA_CONFIG` para aplicar as regras correspondentes no motor.

---

## 5. Como Executar e Validar

### Iniciar o Backend (Ponte MT5):
```powershell
# Ativar venv e subir ponte
.\venv\Scripts\python.exe -u bot_mt5_ciclo15.py
```

### Iniciar o Frontend:
```bash
cd interface_github
npm run dev
```

### Checagens Mínimas Antes de Commits:
```bash
# Backend (na raiz):
.\venv\Scripts\python.exe -m py_compile bot_mt5_ciclo15.py
.\venv\Scripts\python.exe test_diario_eventos.py

# Frontend:
cd interface_github
npx tsc --noEmit
```

---

## 6. Convenções de Git e Entregas

- **Dois Commits Separados:** Sempre commitar alterações do motor na raiz (`backend-python`) e alterações da interface em `interface_github` (`main`).
- **Formato da Mensagem de Commit:**
  ```text
  tipo(escopo): resumo claro em ASCII

  Corpo descritivo explicando o porquê da alteração.

  🤖 Generated with Codebuff
  Co-Authored-By: Codebuff <noreply@codebuff.com>
  ```
- **Arquivos Protegidos:** Nunca commitar arquivos `.log`, `bridge_token.txt`, `__pycache__` ou `node_modules`.
