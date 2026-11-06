# Robô Fluxo B3 — Handover & Estado Consolidado do Projeto
**Data:** 05 de Novembro de 2026  
**Status do Projeto:** 100% Funcional e Sincronizado | Base de Ticks Reais Versionada | Replay Calibrado  

---

## 1. Visão Geral da Arquitetura

O sistema é uma plataforma completa e profissional de automação e análise de Tape Reading e Gráficos Atemporais (Renko, Range Bar e Tempo) operando no MetaTrader 5 e na B3:

```
┌──────────────────────────────────────────────┐
│  FRONTEND WEB (React 18 + Vite + TypeScript) │
│  Porta: 3000 (http://localhost:3000)         │
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

## 2. Principais Avanços Concluídos Nesta Sessão

### A. Resolução Definitiva do Replay (Isolamento do Pregão 04/11)
- **Eliminação do dia anterior estático:** Removido o carregamento de `targetDays + 1` que injetava o pregão de ontem na tela.
- **Agrupamento por pregão em `App.tsx`:** Ao selecionar `Hoje (04/11)`, o simulador foca 100% nos ticks de 04/11, iniciando limpo a partir da abertura (08:55/09:00), com relógio e gráfico sincronizados.
- **Seletor de Velocidades Direto:** Botões `[1x]`, `[2x]`, `[3x]`, `[5x]`, `[10x]` em destaque na barra superior com cadência humana suave em 1x (tempo real de mercado).

### B. Remoção do Breakeven Forçado ("Nada de Break Even")
- Revertido `moveMainToBreakevenOnPyramidTp` para `false` por padrão em `eaConfigService.ts` e presets.
- A Ordem Mãe surfa livremente a tendência sem puxar stop para o zero a zero, encerrando apenas na inversão confirmada de fluxo.

### C. Calibração Estratégica do Motor de Confluência & Pirâmide
- **Take Profit Proporcional da Pirâmide:** O TP da pirâmide agora acompanha dinamicamente a escala do box (`config.boxPoints`). Em 20R, o TP é de 100 pontos; em 10R, é de 50 pontos.
- **Filtro de Tendência por Média Móvel (EMA 20):** Implementada a função `calculateBoxEMA` em `convergenceEvaluator.ts`. Compras autorizadas apenas com preço $\ge \text{EMA 20}$ e vendas apenas com preço $\le \text{EMA 20}$, eliminando compras contra tendência de queda.
- **Filtro de Consolidação (Efficiency Ratio de Kaufman):** Ativado com $ER < 0.35$ para silenciar entradas durante congestões laterais/serrilhadas.
- **Delta Institucional Mínimo:** Exigência de $\ge 150$ contratos de delta líquido institucional para validar a confluência.

### D. Base de Dados de Ticks Reais Exportada e Versionada no Git
- **Extração completa dos ticks de 04/11/2026** via MT5:
  - `data/winz26_ticks_20261104.csv.gz` (1.117.272 negócios reais | 7.2 MB)
  - `data/wdoz26_ticks_20261104.csv.gz` (102.079 negócios reais | 0.7 MB)
  - `data/bitx26_ticks_20261104.csv.gz` (105.281 negócios reais | 0.8 MB)
  - `data/winz26_ticks.csv.gz`, `data/wdoz26_ticks.csv.gz`, `data/bitx26_ticks.csv.gz` atualizados.
- **Script Descompactador:** Criado `unpack_ticks.py` para descompactar os CSVs em qualquer outra estação em 1 clique.
- **Suporte Nativo no Backtest:** `backtest_ticks_reais.py` atualizado para ler arquivos `.csv.gz` diretamente.
- **Ajuste do `.gitignore`:** Liberada a pasta `data/` com os arquivos `.gz` e `.csv`.

### E. Configuração do Git no PATH do Sistema
- `C:\Program Files\Git\cmd` adicionado permanentemente à variável `Path` de Usuário do Windows, permitindo o uso nativo do comando `git` no PowerShell.

---

## 3. Estado dos Repositórios Git

- **Repositório Raiz (`RoboFluxoB3`):**
  - Commit **`a2db373`**: *"feat(data): adicionar base de ticks reais de 04/11/2026 para WIN, WDO e BIT, script unpack_ticks e suporte .gz"*
- **Repositório Frontend (`interface_github`):**
  - Commit **`4298015`**: *"feat(strategy): calibrar TP proporcional da piramide, filtro de tendencia EMA20 e filtro de consolidacao"*

---

## 4. Comandos de Inicialização e Sincronização

### Para Atualizar o GitHub (Push) a partir desta máquina:
```powershell
# 1. Enviar o repositório do frontend:
Set-Location "C:\Users\Lucas\Documents\RoboFluxoB3\interface_github"
git push origin main

# 2. Enviar o repositório principal com a base de dados:
Set-Location "C:\Users\Lucas\Documents\RoboFluxoB3"
git push origin main
```
*(Nota: se abrir a janela do Git Credential Manager, confirme o login do GitHub).*

### Para Clonar / Atualizar em Outra Estação de Trabalho:
```powershell
Set-Location "C:\Users\Lucas\Documents\RoboFluxoB3"
git pull origin main
git submodule update --init --recursive
python unpack_ticks.py
```

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

---

## 5. Próximos Passos Sugeridos

1. **Ajuste de Alvo / Trailing na Ordem Mãe:**
   - Testar realização de lucro na Mãe (ex.: TP de 2 boxes = 200 pts) para evitar devolver 200 pontos no box de reversão em dias de consolidação.
2. **Comparativo 10R vs 20R:**
   - Rodar o replay de 04/11 em 10R para comparar a relação risco/retorno nativa do Mini Índice.

---

## 6. Prompt para Iniciar a Nova Conversa

Copie e cole o texto abaixo ao iniciar uma nova conversa com o assistente:

> *"Olá! Estou continuando o desenvolvimento do Robô Fluxo B3. Por favor, leia o arquivo `CONTEXTO_NOVA_CONVERSA_05_NOV_2026.md` na raiz de `C:\Users\Lucas\Documents\RoboFluxoB3` para se situar no estado atual do projeto. Hoje finalizamos a calibração do Replay iniciando em 04/11, a remoção do breakeven forçado, a calibração do TP proporcional da pirâmide e dos filtros de tendência (EMA20) e consolidação, além de salvar a base de dados de ticks reais de hoje no Git para sincronização entre estações. Gostaria de prosseguir a partir desse ponto."*

