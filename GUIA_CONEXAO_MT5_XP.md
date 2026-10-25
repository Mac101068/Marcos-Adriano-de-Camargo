# 📖 GUIA DE OPERAÇÃO AO VIVO: METATRADER 5 & ROBÔ DE FLUXO B3

Este documento apresenta o roteiro operacional para inicializar e rodar o robô na abertura do pregão da B3 (Mini-Índice WINZ26).

---

## 1. Pré-Requisitos
* **MetaTrader 5 instalado** com conta ativa da XP Investimentos (Conta Demo `#50534540` no servidor `XPMT5-DEMO`).
* **Python 3.10+** com as bibliotecas instaladas (`pip install -r backend/requirements.txt`).
* **Node.js 18+** para o frontend React/Vite.

---

## 2. Passo a Passo para Iniciar na Abertura (09:00)

### Passo 1: Abrir o MetaTrader 5
1. Dê um duplo clique no ícone do **MetaTrader 5** na sua Área de Trabalho.
2. Certifique-se de que a conta `50534540` na XP está conectada (ícone de rede verde no canto inferior direito do MT5).
3. Verifique se o botão **AlgoTrading** está verde/ativado no topo do MT5.

### Passo 2: Iniciar os Servidores do Robô
Abra um terminal (PowerShell ou CMD) na pasta do projeto e execute:
```cmd
iniciar_robo_mt5.bat
```
Ou inicie os três serviços individualmente:
1. **Robô MT5 (WebSocket):**
   ```cmd
   .\venv\Scripts\python.exe backend/bot_mt5_convergencia_10r.py
   ```
2. **API Backend FastAPI:**
   ```cmd
   .\venv\Scripts\python.exe backend/main.py
   ```
3. **Interface Web (React/Vite):**
   ```cmd
   npm run dev
   ```

### Passo 3: Conectar a Interface
1. Abra `http://localhost:3000` no seu navegador.
2. Clique no botão **"Conectar MT5"** no topo da tela. O badge mudará para **"MT5: Conectado"**.
3. O card "Patrimônio Atual" na aba **Curva** exibirá seu saldo real da XP: **R$ 1.050.082,00**.
4. Clique no botão **"Robô: LIGADO"** para autorizar o envio automático de ordens conforme a confluência do fluxo 10R.

---

## 3. Regras de Disparo do Robô
* **Ativo:** WINZ26 (Mini-Índice B3).
* **Box 10R:** 50 pontos por tijolo.
* **Ordem Mãe:** Disparada no primeiro box com fluxo a favor. Sem alvo fixo, surfa a tendência até reversão.
* **Pirâmide (+50 pts):** A cada box novo na mesma direção, abre 1 contrato adicional com Take Profit de +50 pontos.
* **Saída por Inversão:** Se o fluxo virar de alta para baixa (ou vice-versa), todas as posições são zeradas a mercado instantaneamente.
* **Horários:** Novas entradas até as **17:40**. Zeragem diária automática às **17:50**.
