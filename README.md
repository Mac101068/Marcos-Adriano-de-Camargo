# 📈 RoboFluxoB3 — Plataforma Quantitativa Renko & Fluxo (B3)

Plataforma de alta precisão desenvolvida para operar contratos futuros da B3 (**WIN / WDO / BIT**), combinando motor de confluência atemporal de fluxo (Delta e CVD institucional), gráficos de tijolos **Renko (10R no WIN)** e execução com gestão de risco nativa no MetaTrader 5.

---

## 🏗️ Arquitetura do Repositório

O projeto é organizado em duas árvores Git independentes sincronizadas com o mesmo repositório remoto:

| Caminho | Branch Remoto | Finalidade |
|---|---|---|
| `/` (Raiz) | `backend-python` | Motor de trading, ponte WebSocket MT5, testes de paridade e dados históricos |
| `/interface_github` | `main` | Frontend interativo em React 19, TypeScript e Vite |

> **Nota de Isolamento:** A pasta `interface_github/` é ignorada pelo `.gitignore` da raiz para garantir ciclo de vida e versionamento desacoplados entre motor de execução e interface visual.

---

## 🔒 Camada de Segurança & Hardening (Pós-Auditoria)

Após auditoria de segurança e hardening estrutural, a aplicação implementa:

1. **Isolamento de Rede:** O WebSocket escuta exclusivamente em `127.0.0.1:8765`, bloqueando acessos não autorizados via rede local ou externa.
2. **Autenticação por Token Dinâmico:** Cada sessão exige handshake prévio (`action: 'AUTH'`) com token criptográfico de pelo menos 16 caracteres.
3. **Trava de Ambiente (Fail-Closed):**
   - O motor nasce por padrão com `ORDERS_BLOCKED=1` (Modo Replay/Estudo).
   - Para envio de ordens na conta de homologação, o operador deve declarar explicitamente `$env:ORDERS_BLOCKED = '0'`.
4. **Proteção de Segredos:** Tokens, credenciais e logs de execução são estritamente excluídos do Git.

---

## 🚀 Como Iniciar a Plataforma

### 1. Pré-Requisitos
- Windows 10/11 x64
- Python 3.11/3.12 (Virtualenv configurado em `venv/`)
- Node.js 18+ e npm
- MetaTrader 5 instalado e conectado à conta Demo XP (`50534540`)

### 2. Inicialização do Backend (Ponte MT5)

#### Modo Seguro / Validação (Padrão - Replay & Estudo):
```powershell
.\_reiniciar_ponte.ps1
```
*(As ordens de entrada ficam travadas por segurança).*

#### Modo Operacional (Execução em Conta Demo):
```powershell
$env:ORDERS_BLOCKED = '0'
.\venv\Scripts\python.exe -u bot_mt5_ciclo15.py
```

### 3. Inicialização do Frontend (Interface React)
```powershell
cd interface_github
npm install
npm run dev
```
Acesse no navegador: **`http://localhost:3000`**

---

## 🧪 Bateria de Testes & Paridade de Regras

Antes de qualquer alteração no motor ou na tela, execute as suítes de validação:

```powershell
# 1. Paridade entre regras do Python e da tela (47 asserts obrigatórios)
.\venv\Scripts\python.exe test_paridade_regras.py

# 2. Diário de eventos e stubs de execução do MT5 (46 cenários)
.\venv\Scripts\python.exe test_diario_eventos.py

# 3. Verificação de sintaxe do backend
.\venv\Scripts\python.exe -m py_compile bot_mt5_ciclo15.py

# 4. Verificação de tipagem TypeScript do frontend
cd interface_github && npx tsc --noEmit
```

---

## 🤖 Fluxo de Trabalho com IAs (Gemini / Antigravity, Kilo Code, Qwen)

Para evitar conflitos de versão e regressões no código-fonte, siga as regras do [AGENTS.md](file:///c:/Users/Lucas/Documents/RoboFluxoB3/AGENTS.md):

1. **Uma ferramenta por pasta por vez:** Nunca solicite alterações concorrentes na mesma árvore de arquivos.
2. **`git status` obrigatório:** Verifique o status antes de iniciar e logo após terminar cada tarefa.
3. **Paridade inquebrável:** Qualquer alteração em limiares ou regras deve ser espelhada simultaneamente no `bot_mt5_ciclo15.py` e em `convergenceEvaluator.ts`.
4. **Sem commits cegos:** Commits e pushes são realizados sob demanda explícita após testes aprovados.

---

## 📋 Checklist de Segurança Pré-Operacional

- [ ] MetaTrader 5 conectado estritamente na conta **DEMO** (`50534540`).
- [ ] WebSocket escutando em `127.0.0.1` (verificado via `netstat -ano | findstr 8765`).
- [ ] Token sincronizado entre `bridge_token.txt` e o header do frontend.
- [ ] Trava de horários habilitada na interface (08:55 às 17:30).
- [ ] Testes de paridade aprovados com 0 falhas.
