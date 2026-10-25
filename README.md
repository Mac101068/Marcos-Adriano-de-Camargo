# 📈 ROBÔ QUANTITATIVO DE FLUXO & RENKO 10R (B3 MINI-ÍNDICE)
### Plataforma Profissional de Trading Algorítmico, Gestão de Patrimônio e Rede de Assinantes

[![MetaTrader 5](https://img.shields.io/badge/MetaTrader_5-XP_Investimentos-emerald.svg)](https://www.xpi.com.br/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.109+-teal.svg)](https://fastapi.tiangolo.com/)
[![React](https://img.shields.io/badge/React-19.0-sky.svg)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-7.0-blue.svg)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-8.3-purple.svg)](https://vitejs.dev/)
[![Status](https://img.shields.io/badge/Status-Produção_Pronta-success.svg)]()

Plataforma de alta precisão desenvolvida para operar o contrato futuro de Mini-Índice da B3 (**WINZ26**), combinando leitura de fluxo atemporal (CVD institucional), gráficos de tijolos **Renko 10R** (50 pontos), estratégia de piramidação com ordem mãe de surfe e painel multiusuário com modo degustação para convidados.

---

## 🌟 Principais Recursos

### 1. Motor de Confluência & Estratégia de Pirâmide
* **Ordem Mãe de Surfe:** Aberta na primeira confluência de box verde/vermelho com fluxo positivo/negativo. Sem Take Profit fixo, projetada para surfar a tendência.
* **Pirâmide Acumulativa (+50 pts):** A cada novo box na mesma direção, adiciona ordens com Take Profit fixo de 50 pontos (R$ 10,00 por contrato).
* **Zeragem Compulsória por Inversão:** Se o fluxo institucional virar, todas as ordens abertas são imediatamente zeradas a mercado.

### 2. Conexão Nativa MetaTrader 5 (XP Investimentos)
* Comunicação bidirecional via WebSocket (`ws://0.0.0.0:8765`) e REST (`http://0.0.0.0:8003`).
* Leitura em tempo real do patrimônio da conta XP Demo `#50534540` (**R$ 1.050.082,00**).
* Execução direta de ordens a mercado e ordens limites de proteção.

### 3. Curva de Patrimônio & Métricas Profissionais
* Gráficos interativos com Recharts:
  * Evolução do Equity acumulado vs. Saldo inicial.
  * Distribuição de PnL por trade (Wins vs. Losses).
  * Gráfico Underwater de Drawdown temporal.
* KPIs em tempo real: Taxa de acerto (Win Rate), Fator de Lucro (Profit Factor), Payoff, Maior Drawdown e Saldo Líquido.

### 4. Sistema de Assinantes & Modo Degustação para Amigos
* **Compartilhamento em 1 Clique:** Acesse na rede local via `http://192.168.18.49:3000`.
* **Gerador de Convites VIP:** Crie links personalizados com nome do amigo e envie direto no WhatsApp com período de teste liberado (7, 15 ou 30 dias grátis).
* **Controle Administrativo:** Painel completo para o Administrador Master gerenciar licenças, renovações, faturamento mensal e permissões.

---

## 🚀 Como Executar

### 1. Iniciar o Backend e a Ponte MT5
```bash
# Instalar dependências Python
pip install -r backend/requirements.txt

# Executar o robô MT5 e a API FastAPI
python backend/bot_mt5_convergencia_10r.py
python backend/main.py
```

### 2. Iniciar o Frontend Web
```bash
# Instalar dependências do Node.js
npm install

# Rodar servidor de desenvolvimento (escuta em 0.0.0.0:3000)
npm run dev
```

Acesse:
* **Computador Host:** `http://localhost:3000`
* **Celular / Rede Local:** `http://192.168.18.49:3000`

---

## 📁 Estrutura do Projeto

* `backend/`: Scripts Python do robô, bridge WebSocket MT5 e API FastAPI.
* `src/components/`: Componentes React (Gráfico Renko, Fita de Fluxo, Curva de Patrimônio, Admin, Compartilhamento).
* `src/services/`: Camada de serviços (Autenticação, Auditoria de Ordens, Configurações do EA).
* `RELATORIO_CONQUISTAS_25_OUTUBRO.md`: Relatório executivo com todos os marcos alcançados hoje.
* `GUIA_CONEXAO_MT5_XP.md`: Manual operacional de inicialização para o pregão.
* `GUIA_DEGUSTACAO_AMIGOS.md`: Roteiro para convidar amigos e compartilhar acesso ao vivo.

---

**Autor:** Marcos Adriano de Camargo  
**Licença:** Proprietária • Direitos Reservados
