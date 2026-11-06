# Robô Fluxo B3 — Handover & Estado Consolidado do Projeto
**Data da Última Atualização:** 06 de Novembro de 2026  
**Status do Projeto:** Sincronizado com GitHub | Ciclos 16 a 19 Concluídos | SEL-A & Trava de Execução Ativos | Multi-Máquina (Mac ↔ Windows)  

---

## 1. Visão Geral da Arquitetura & Topologia Multi-Máquina

O sistema opera como uma plataforma quantitativa profissional de Tape Reading e Gráficos Atemporais (Renko e Range Bar) integrada ao MetaTrader 5 (B3), dividida entre duas estações de trabalho colaborativas sincronizadas via Git:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       ESTAÇÃO MAC (Desenvolvimento / UI)                    │
│  - Frontend Web (React 18 + Vite + TypeScript) em http://localhost:3000      │
│  - Repositório: git@github.com:Mac101068/Marcos-Adriano-de-Camargo.git       │
│  - Geração do script da ponte com token embutido seguro                     │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │ WebSocket (ws://192.168.18.154:8765)
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                     ESTAÇÃO WINDOWS (Execução MT5 / Fitas)                  │
│  - MetaTrader 5 conectado (XP Investimentos — Conta Demo 50534540)          │
│  - Ponte MT5 Python (porta 8765, escutando em 0.0.0.0, IP LAN 192.168.18.154)│
│  - Trava de Execução por Ambiente ativa (ORDERS_BLOCKED="1")                 │
│  - Banco local de ticks reais comprimidos (data/*.csv.gz)                   │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Linha do Tempo e Principais Evoluções (Ciclos 16 a 19)

### A. Ciclo 16 — Desengasgo do Renko, Afrouxamento do Funil & Ponte Verbosa
- **Renko sem atrasos (`closedBoxes[]`):** A função `processTick` passou a fechar todos os boxes percorridos pelo tick, eliminando o atraso de múltiplos boxes rápidos.
- **Ponte Transparente (`ORDER_RESULT`):** Script Python passou a retornar `{ok, ticket, reason}` detalhado, expondo recusas por horário, símbolo ou código de erro da corretora.
- **Ajustes nos Padrões da Pirâmide:** Redução do piso físico de Delta de 150 para 100 contratos; breakeven da mãe acionado em TP de pirâmide.

### B. Ciclo 17 — Replay Fita-Real & Funil Auto-Calibrado
- **Replay com Cadência Humana Real:** Implementado timing não-uniforme (micro-chunks de 2–20 ticks com hiato exponencial) e agressor classificado por bid/ask com fuso horário ajustado.
- **Funil Auto-Calibrado (`getSelfCalibratedLimit`):**
  - O limiar de agressão passou a ser dinâmico: o maior valor entre o **P60 das agressões do próprio pregão** e o **piso de 1,3× a média do dia**.
  - **Filtro de Divergência de Fluxo (`flowDivergenceMin`):** Exigência de $|Delta| / Volume \ge 0,40$ (métrica adimensional imune à troca de escala ou ativo).
  - Resultados na base real WIN (11 pregões): Profit Factor subiu para 3,94 com Max Drawdown reduzido para R$ 318.

### C. Ciclo 18 — Faixa do Funil no Rodapé & Padrão SEL-A
- **Painel do Funil no Rodapé (`FunnelMetricsPanel.tsx`):**
  - Exibição em tempo real dos cortes calculados de compra e venda com a origem do cálculo (percentil, piso ou físico) e leitura instantânea do box atual.
  - Gaveta expansível com chave Auto e 4 sliders interativos (Delta Físico, Percentil, Piso e Divergência) conectados à estratégia ativa via `patchActiveStrategy`.
- **Calibração Oficial SEL-A:**
  - Definidos como novos defaults e presets da Pirâmide: **P70 · piso 1,6× · divergência 50%**.
  - Evidência estatística WINZ26: PF 4,17, lucro médio de R$ 21,40/trade e 100% dos pregões do banco positivos. Corroborado no WDOZ26 (PF 1,63).

### D. Ciclo 19 — Convivência Mac ↔ Windows, Segurança da Ponte & Trava de Execução
- **Trava de Execução em Camadas (`ORDERS_BLOCKED`):**
  - Ativada via variável de ambiente no Windows (`$env:ORDERS_BLOCKED="1"`).
  - A ponte calcula e transmite sinais e métricas normalmente, mas barra o envio de ordens de entrada para a corretora (ideal para validação em tempo real e replay sem risco financeiro). O fechamento emergencial (`CLOSE_POSITIONS`) permanece liberado.
  - Provado e homologado no log do MT5 Demo XP: sinal de compra gerado e bloqueado pela trava com mensagem explícita.
- **Blindagem de Autenticação da Ponte:**
  - Corrigida vulnerabilidade crítica no script manual onde qualquer cliente da rede podia reescrever o token. Implementado pino estrito de uso único (`trust-on-first-use`) na ponte e token fixo e persistente gerado pelo frontend (`AUTH_TOKEN = "${bridgeToken}"`).
- **Correção da Régua de Dinheiro B3 (`assetRegistry.ts`):**
  - Asserts corrigidos para a especificação oficial da B3: **WDO = R$ 10,00 por ponto** (R$ 5,00 por tick de 0,5 pt); **WIN = R$ 0,20 por ponto** (R$ 1,00 por tick de 5 pts).
- **Conserto de Boot Frio e Desconexão (`185cb40`):**
  - O terminal agora acorda parado sem abrir conexões espúrias no carregamento.
  - Botão de desconectar corrigido (não engatilha reconexão acidental).
  - Endereço da ponte (Host e Porta) editável diretamente na interface.
- **Assert de Contrato Robusto (`bridgeScriptAssert.ts`):**
  - Eliminação de alertas falsos-positivos; o teste valida o interpretador Python real e falha expressamente se a compilação do script quebrar.
- **Portabilidade do Repositório Python:**
  - Criação do `.gitattributes` para padronização de quebras de linha (LF para código, CRLF para scripts Windows).
  - Des-rastreamento das fitas brutas no Git (`git rm --cached data/*.gz`), poupando 29 MB no versionamento sem deletar os arquivos locais.
  - Criação de `requirements-analise.txt` sem dependências Windows-only (MetaTrader5) para permitir análises e testes no macOS/Linux.

---

## 3. Estado Atual dos Repositórios Git

| Componente | Diretório Local | Remote no GitHub | Commit Atual / Topo | Descrição / Estado |
|---|---|---|---|---|
| **Frontend Web** | `RoboFluxoB3\interface_github` | `https://github.com/Mac101068/Marcos-Adriano-de-Camargo.git` | **`44be287`** | Ciclo 19 consolidado, adendos de handoff, asserts e travas |
| **Backend MT5 / Base** | `RoboFluxoB3` | Local (Pendente criação de repo vazio `robofluxo-b3-backend`) | **`25564c8`** | Higiene git, fitas fora do índice, trava de ambiente e bridge ciclo 15 |

---

## 4. Instruções de Operação e Comandos Práticos

### Rede e Acesso Local:
- **IP do Windows na LAN:** `192.168.18.154` (Interface Ethernet 2).
  *(Atenção: não utilizar o IP da VPN Topaz Loopback `54.232.189.113`).*
- **Porta WebSocket da Ponte:** `8765`.

### Para Iniciar o Frontend Web (Porta 3000):
```powershell
Set-Location "C:\Users\Lucas\Documents\RoboFluxoB3\interface_github"
npm run dev -- --host 0.0.0.0
```

### Para Iniciar a Ponte MT5 no Windows com Trava de Segurança Ativa:
```powershell
Set-Location "C:\Users\Lucas\Documents\RoboFluxoB3"
$env:ORDERS_BLOCKED = "1"
.\venv\Scripts\python.exe -u bot_mt5_ciclo15.py
```

### Para Validar a Compilação do Script da Ponte:
```powershell
Set-Location "C:\Users\Lucas\Documents\RoboFluxoB3\interface_github"
npx tsx scripts/bridgeScriptAssert.ts
```

### Para Atualizar o Repositório do Frontend:
```powershell
Set-Location "C:\Users\Lucas\Documents\RoboFluxoB3\interface_github"
git fetch origin
git merge origin/main
```

---

## 5. Próximos Passos e Pendências Técnicas

1. **Criação do Repositório Remoto do Backend:**
   - Criar repositório privado vazio no GitHub: `robofluxo-b3-backend` (sem README, sem licença, sem `.gitignore`).
   - Fazer `git remote add origin` na raiz de `RoboFluxoB3` e subir o código Python completo para permitir que a estação Mac clone e rode a suíte analítica.
2. **Compatibilização de Ações na Ponte (`Achado C`):**
   - Implementar no gerador/ponte o tratamento formal para as requisições `SYNC_EA_CONFIG` e `LIST_LOCAL_PREGOES` (respondendo com `LOCAL_PREGOES_LIST`).
3. **Teste de Ensaio Operacional em Conta Demo:**
   - Realizar teste assistido na conta demo XP com ordens liberadas (`ORDERS_BLOCKED="0"` apenas sob comando explícito do operador) após checagem total da telemetria de fluxo.

---

## 6. Prompt para Iniciar Nova Conversa

> *"Olá! Estou dando continuidade ao desenvolvimento do Robô Fluxo B3. Por favor, leia o arquivo `CONTEXTO_NOVA_CONVERSA_05_NOV_2026.md` na raiz de `C:\Users\Lucas\Documents\RoboFluxoB3` para se situar no estado atual. O projeto está no Ciclo 19 sincronizado com o GitHub, com padrão SEL-A (P70 · piso 1,6× · div 50%), trava de execução em duas camadas (`ORDERS_BLOCKED`), asserts de dinheiro corrigidos (WDO R$10 e WIN R$0,20) e comunicação multi-máquina (Mac e Windows) alinhada. Gostaria de prosseguir a partir desse ponto."*
