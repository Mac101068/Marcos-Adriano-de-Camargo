# RoboFluxoB3 — Consolidação, Revisão e Manual de Funcionamento

**Data:** 19/11/2026  
**Status do Sistema:** Estabilizado e Homologado (Paridade 47/47 ✅, Risco 7/7 ✅, Diário 46/46 ✅, TypeScript 0 erros ✅)  
**Ambiente Alvo:** MetaTrader 5 DEMO `50534540 (XPMT5-DEMO)` · B3 (WIN, WDO, BIT)

---

## 1. Visão Geral da Arquitetura

O **RoboFluxoB3** é um sistema algorítmico profissional para day trade em mini-índice (`WIN`), mini-dólar (`WDO`) e mini-bitcoin (`BIT`) na B3, fundamentado em fluxo de ordens institucional (CVD / Book / Agressão) e barras de tempo/espaço Renko.

O sistema opera com uma arquitetura desacoplada em duas camadas:

```
┌────────────────────────────────────────┐
│       MetaTrader 5 (XPMT5-DEMO)        │
│   (Terminal Oficial XP Investimentos)  │
└──────────────────┬─────────────────────┘
                   │ Ticks IPC / Win32
┌──────────────────▼─────────────────────┐
│       Ponte WebSocket & Motor          │
│        (bot_mt5_ciclo15.py)            │
│   - Escuta em ws://127.0.0.1:8765      │
│   - Motor Renko Flow Engine em Python  │
│   - Avaliação e Trava de Risco         │
│   - Diário de Auditoria CSV            │
└──────────────────┬─────────────────────┘
                   │ WebSocket JSON bidirecional
┌──────────────────▼─────────────────────┐
│        Interface React / Vite          │
│          (interface_github/)           │
│   - Servidor HTTP http://localhost:3000│
│   - Gráficos Renko, CVD, Livro e HUD   │
│   - Boleta Manual e Varal de Ordens    │
│   - Monitor de Risco & Paridade        │
└────────────────────────────────────────┘
```

---

## 2. Topologia de Repositórios Git

O projeto reside em **duas árvores Git independentes** no mesmo disco, apontando para o mesmo repositório remoto GitHub:

| Camada | Caminho Local | Branch Remota | Conteúdo Principal |
|---|---|---|---|
| **Backend & Motor** | `C:\Users\Lucas\Documents\RoboFluxoB3` | `origin/backend-python` | `bot_mt5_ciclo15.py`, scripts de backtest, testes, dados |
| **Frontend UI** | `C:\Users\Lucas\Documents\RoboFluxoB3\interface_github` | `origin/main` | Interface React, Vite, TypeScript, componentes e HUD |

> [!IMPORTANT]
> A pasta `interface_github/` está no `.gitignore` da raiz do backend. Um commit na raiz nunca altera a interface, e vice-versa. Para atualizar ambos no GitHub, são necessários **dois commits separados**.

---

## 3. Segurança e Protocolos Inegociáveis

1. **Conta DEMO Exclusiva**: Conta `50534540 (XPMT5-DEMO)`. Nenhuma ordem real em conta de produção.
2. **Trava de Execução por Padrão (`ORDERS_BLOCKED=1`)**:
   - O lançador oficial `_reiniciar_ponte.ps1` define `$env:ORDERS_BLOCKED = '1'`.
   - **Nunca** inicie o bot diretamente via terminal sem o lançador.
   - Em modo replay/validação (`REPLAY_MODE=True`), ordens de entrada automáticas são bloqueadas.
3. **Isolamento de Rede Local**:
   - O WebSocket escuta exclusivamente em `WS_HOST = "127.0.0.1"` na porta `8765`.
4. **Isolamento de Magic Numbers**:
   - `102030`: Robô Principal / Motor Automático
   - `999999`: Boleta Manual do Operador (Tela Web)
   - `100001`: RoboCompra (Hedge Direcional)
   - `100002`: RoboVenda (Hedge Direcional)
   - `26092301`: Scalper / Estratégia Assimétrica

---

## 4. Diagnóstico e Estabilização WebSocket (Solução das 218 Quedas)

Na investigação de instabilidade onde a interface reportava centenas de quedas por pregão, foram identificadas e sanadas três causas raiz:

### A. Loop de Autenticação 4001 e Auto-Alinhamento Loopback
- **Causa**: Quando o navegador possuía um token antigo no `localStorage` divergente do arquivo [bridge_token.txt](file:///c:/Users/Lucas/Documents/RoboFluxoB3/bridge_token.txt), o backend rejeitava a conexão com `close(code=4001)`. O frontend reconectava a cada 2.5s com o mesmo token errado, gerando dezenas de conexões e quedas em loop contínuo.
- **Solução**: No `bot_mt5_ciclo15.py`, implementou-se o auto-alinhamento para conexões loopback locais (`127.0.0.1` / `localhost`). Se a requisição vem da mesma máquina e existe `bridge_token.txt`, o backend alinha a sessão e retorna o token no payload de `AUTH_RESULT`. No frontend, [bridgeSecurity.ts](file:///c:/Users/Lucas/Documents/RoboFluxoB3/interface_github/src/utils/bridgeSecurity.ts) passou a ter como fallback prioritário o token oficial configurado (`fluxo-renko-ponte-2026-chave-fixa-marcos`), eliminando a geração aleatória desnecessária.

### B. Heartbeat e Buffers Resilientes (Ping 30s / Timeout 60s)
- **Causa**: A configuração anterior (`ping_interval=20, ping_timeout=20`) do `websockets.serve` fechava conexões com `ConnectionClosedError` sempre que o navegador demorava para responder frames de controle durante picos de renderização de Renko e fita de ticks.
- **Solução**: Aumentou-se o intervalo de ping para `30s` e o timeout para `60s` com buffer de 50 MB, dando margem ampla para a interface sob carga pesada sem falsas desconexões.

### C. Logging Granular no Backend
- **Causa**: O bloco `ws_handler` silenciava erros com `except websockets.exceptions.ConnectionClosed: pass`.
- **Solução**: Foram adicionados manipuladores granulares para:
  - `ConnectionClosedOK` (código e motivo normal)
  - `ConnectionClosedError` (queda abrupta, código de encerramento)
  - `asyncio.TimeoutError` (timeout de buffer)
  - `Exception` geral com nome da classe e mensagem

### D. Exponential Backoff com Jitter na Interface
- **Causa**: O frontend reconectava agressivamente em 2.5s fixos.
- **Solução**: Em [App.tsx](file:///c:/Users/Lucas/Documents/RoboFluxoB3/interface_github/src/App.tsx), implementou-se backoff exponencial:
  $$\text{Delay} = \min(15000, 2000 \times 1.6^{\text{tentativas}}) \pm \text{jitter}(400\text{ms})$$
  As tentativas são zeradas imediatamente após o `AUTH_RESULT` bem-sucedido.

### E. Keep-Alive do Terminal MT5
- No `mt5_equity_broadcaster_loop`, o bot verifica periodicamente a cada 3s se `mt5.terminal_info().connected` é verdadeiro, emitindo alerta e reiniciando a sessão se o terminal perder a conexão com a corretora XP.

---

## 5. Módulos de Risco e Paridade Operacional

### A. Perfil de Stop Loss Dinâmico (`ASSET_MIN_STOPS`)
Implementado em `bot_mt5_ciclo15.py` para impedir envio de stops perigosamente curtos ou rejeições indevidas da corretora:
- **BITX26**: Stop mínimo seguro de **250 pontos**.
- **WINZ26**: Stop mínimo seguro de **50 pontos**.
- **WDOZ26**: Stop mínimo seguro de **2.5 pontos**.
- **Tratamento da Boleta Manual**: Na boleta manual (`999999` ou comentário `WEB_`/`Manual`), se o operador informar um stop menor que o mínimo, o sistema faz o clamp automático para a distância mínima segura, permitindo a execução imediata sem anular a ordem.

### B. Hard Cap Multi-Ativo Assimétrico (`MAGIC_HARD_CAPS`)
Configurado para o magic `26092301` para proteger caudas assimétricas sem corte prematuro por ruído:
- `BIT`: perda máxima de **100.0 pts** (~R$ 100,00)
- `WIN`: perda máxima de **150.0 pts** (R$ 30,00, tolerância a ruído calibrada)
- `WDO`: perda máxima de **5.0 pts** (R$ 5,00)
- Fallback padrão: **100.0 pts**

### C. Integração do PnL da Boleta Manual no Resultado Diário
- O `hedgeBook` e o HUD consolidam o PnL fechado do MT5 (`dayStats`) somado ao PnL flutuante a mercado (`liveBRL`), garantindo que posições manuais reflitam no resultado do dia sem discrepâncias.

---

## 6. Como Rodar e Testar o Sistema

### Pré-requisitos
- MetaTrader 5 XP Demo aberto e logado na conta `50534540`.
- Python 3.11/3.12 com virtualenv em `venv/`.
- Node.js e npm instalados.

### Passo 1: Iniciar a Ponte MT5 (Backend)
No PowerShell, execute sempre pelo script seguro:
```powershell
cd C:\Users\Lucas\Documents\RoboFluxoB3
.\_reiniciar_ponte.ps1
```

### Passo 2: Iniciar a Interface Web (Frontend)
Em outro terminal:
```powershell
cd C:\Users\Lucas\Documents\RoboFluxoB3\interface_github
npm run dev
```
Acesse `http://localhost:3000`.

### Passo 3: Conferência Visual
- No topo da interface, o status MT5 deve estar verde: **CONECTADO**.
- O badge de segurança indicará: **Ponte Armada** ou **Ponte: Replay (Destravar)**.
- O gráfico Renko e os dados do pregão carregarão automaticamente via backfill.

---

## 7. Bateria de Testes Automatizados (Sanidade)

Execute no terminal do backend para garantir que nenhuma regressão ocorra:

```powershell
# 1. Validação das regras de risco e hard cap
venv\Scripts\python.exe test_risk_rules.py

# 2. Validação da paridade de regras com a tela (47 asserts)
venv\Scripts\python.exe test_paridade_regras.py

# 3. Validação do diário de eventos e stubs de auditoria (46 asserts)
venv\Scripts\python.exe test_diario_eventos.py

# 4. Compilação de sintaxe do motor
venv\Scripts\python.exe -m py_compile bot_mt5_ciclo15.py

# 5. Verificação de tipos TypeScript no frontend
cd interface_github
npm run lint
```

**Resultado esperado de todos os testes:** `EXIT=0` (0 erros).

---

## 8. Guia para a Próxima Sessão / Próxima Conversa

Ao iniciar uma nova conversa com agentes:
1. Apresente este documento `CONSOLIDACAO_REVISAO_SISTEMA.md`.
2. Verifique o status com `git status --short` no backend e no frontend.
3. Se for operar no pregão, confirme se o lançador `_reiniciar_ponte.ps1` foi utilizado.
4. Lembre-se: **qualquer alteração no motor exige commit em `backend-python` e na interface exige commit em `main`**.
