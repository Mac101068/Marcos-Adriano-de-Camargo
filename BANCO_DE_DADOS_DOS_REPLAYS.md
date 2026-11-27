# Banco de dados dos replays — RoboFluxoB3 (26/11/2026)

Documento consolidado para abertura de **nova conversa**, registrando a arquitetura, todas as entregas do dia 26/11/2026, resultados empíricos das estratégias e o banco de dados permanente de replays na plataforma.
Consulte sempre em conjunto com o `AGENTS.md` (regras fundamentais de segurança, git e verificação).

---

## 1. Resumo Executivo das Entregas de Hoje (26/11/2026)

### 1.1 Segurança e Estabilidade da Infraestrutura
1. **Segurança Inegociável da Ponte MT5 (`ORDERS_BLOCKED = '1'`):**
   - Forçada incondicionalmente no lançador `_reiniciar_ponte.ps1` (`$env:ORDERS_BLOCKED = '1'`), eliminando qualquer risco de herança de ambiente.
   - Conta alvo estritamente **DEMO 50534540 (XPMT5-DEMO)**. Zero ordens reais.
2. **Laboratório Quantitativo de Microestrutura (`coletor_microestrutura.py` & `analisador_antecipacao_quant.py`):**
   - Coletor assíncrono com thread dedicada e lock recursivo (`RLock`) para eliminar deadlocks.
   - **Metadados dos Sinais Conectados:** Em `bot_mt5_ciclo15.py`, o motor agora injeta no coletor o `sinal_info` completo (`signal`, `reason`, `score`, `boxIndex`, `index`) correlacionando a agressão de microestrutura com a decisão da estratégia.
3. **Resolução de Anomalia de PnL no WDO & Preservação de Ordens:**
   - Correção do bug do cálculo cruzado de PnL (ticks de WIN aplicando em preços de WDO) via guardas `isOrderForAsset` e `isPriceSaneForAsset`.
   - Remoção do `setOrders([])` na troca de abas para manter o histórico da sessão.
4. **Alinhamento do Bitcoin Futuro (BITX26):**
   - Multiplicador de pontos (`pointValue`) corrigido no frontend de `0.01` para **`0.1`** (paridade exata com a B3: 1 contrato = 0,1 BTC; 1 tick de 20 pts = R$ 2,00).

---

### 1.2 Melhoria e Calibração Quantitativa das Estratégias (WIN e WDO)

Comprovado através de replay empírico tick-a-tick em **22 pregões de WIN** e **23 pregões de WDO (987.214 ticks)**:

#### A. Mini-Índice (WINZ26 — Renko 10R / 50 pts)
- **Descoberta do Clímax Institucional:** Sinais com Score 7+ compram o topo do box em exaustão de agressão (perderam −2.700 pts na base). Sinais com Score 4..6 são sustentáveis.
- **Sinergia Pullback + Anti-Clímax:**
  - **Base (Close a mercado):** −2.250 pts | PF: 0,91 | Max DD: 7.000 pts
  - **Pullback 25 pts + Anti-Clímax (Score 4..6):** **+2.550 pts líquidos** (**+4.800 pts de virada**) | PF: **1,12** | Max DD: **1.550 pts** (−77,8%).
- **Implementação:** Incorporado ao motor Python e sincronizado bidirecionalmente via `SYNC_EA_CONFIG`.

#### B. Mini-Dólar (WDOZ26 — Renko 10R / 2,5 pts / SL 2,5 / TP 5,0)
- **Descoberta de Microestrutura:** O WDO tem tick largo (0,5 pt = 20% do box). Entrar a mercado ou em pullbacks parciais (1,0 ou 1,5 pt) é estatisticamente perdedor. A única vantagem real ocorre na **retestagem completa da abertura do box (`BOX_OPEN` / 2,5 pts)**.
- **Comparativo de 23 Pregões:**
  - **Base (Close a mercado):** −33,5 pt | PF: 0,86 | Max DD: 68,5 pt
  - **Reteste Abertura (2,5 pts) + Score 4..6:** **+9,0 pt líquidos** (**+42,5 pt de virada**) | PF: **1,12** | Max DD: **20,0 pt** (−70,8%).
- **Preset Homologado na UI:** Criado o preset `preset-pullback-wdo` (**Reteste na Abertura do Box — Mini Dólar**) pronto no seletor de perfis.

---

### 1.3 Banco de Dados dos Replays na Plataforma (Novo Recurso)

Atendendo à necessidade de persistir os resultados após o encerramento das corridas de replay (quando a boleta era zerada para nova execução):

1. **Serviço de Armazenamento (`ReplayHistoryService.ts`):**
   - Gravação contínua no `localStorage` sob a chave `fluxo_replay_sessions_history_v1`.
   - Armazena metadados da sessão: ativo, símbolo, estratégia, parâmetros de pullback, anti-clímax, ticks reproduzidos, total de trades, vitórias, derrotas, Win Rate, Profit Factor, PnL total (pts e R$), Max Drawdown e a lista integral de ordens com preço de entrada, saída, motivo e resultado.
   - Limite de retenção configurado para as últimas 50 sessões, com proteção contra gravações duplicadas.
2. **Tela Visual de Histórico (`ReplayHistoryView.tsx`):**
   - Integrada diretamente no menu **Sistema ➔ Histórico de Replays** (no cabeçalho superior direito) e no menu mobile **Mais ➔ Hist. Replays**.
   - Painel lateral com lista de sessões, filtros por ativo (`Todos`, `WIN`, `WDO`), cards executivos de performance e tabela auditável trade-a-trade.
   - Ferramenta para exclusão de sessões individuais ou limpeza total do banco.

---

## 2. Mapa dos Repositórios e Commits Realizados

Dois repositórios independentes no mesmo disco:

| Repositório | Caminho | Branch | Último Commit | Descrição |
|---|---|---|---|---|
| **Backend** | `C:\Users\Lucas\Documents\RoboFluxoB3` | `backend-python` | `721f112` | `feat(estrategia): calibrar pullback e anti-climax com suporte a metadados no coletor` |
| **Frontend** | `...\RoboFluxoB3\interface_github` | `main` | `b633d54` | `feat(ui): adicionar historico continuo de replays no menu Sistema` |

*Lembrete: `interface_github/` é um repositório git isolado e está no `.gitignore` da raiz. Commits e pushes são sempre 100% desacoplados.*

---

## 3. Estado da Bateria de Testes (Tudo 100% Verde)

| Teste | Comando | Resultado | Status |
|---|---|---|---|
| **Tipagem Frontend** | `cd interface_github && npx tsc --noEmit` | `EXIT=0` (0 erros) | ✅ Verde |
| **Paridade de Regras** | `venv/Scripts/python.exe test_paridade_regras.py` | 48 ✅ / 0 ❌ (`EXIT=0`) | ✅ Verde |
| **Diário de Eventos** | `venv/Scripts/python.exe test_diario_eventos.py` | 46 `[OK]`, 0 falhas (`EXIT=0`) | ✅ Verde |
| **Laboratório Microestrutura** | `venv/Scripts/python.exe test_coletor_microestrutura.py` | 36 `[OK]`, 0 falhas (`EXIT=0`) | ✅ Verde |

---

## 4. Próximos Passos Sugeridos para a Próxima Conversa

1. **Estudo e Calibração do Bitcoin Futuro (BITX26):**
   - Executar ensaio empírico sobre a base de ticks do BIT em `data/pregoes/` avaliando a relação de tick (20 pts = R$ 2,00) com a escala Renko (100R, 200R ou 500R).
   - Avaliar se a dinâmica de Pullback (meio do box vs abertura) melhora a curva de capital como observado no WIN e no WDO.
2. **Exportação CSV do Banco de Dados de Replays:**
   - Adicionar botão na tela `ReplayHistoryView` para exportar a tabela consolidada de todos os replays em formato CSV para análise externa em Python/Excel.
3. **Validação em Replay ao Vivo:**
   - Realizar uma sessão de replay com o operador na interface React, acompanhando o preenchimento automático do histórico na aba **Sistema ➔ Histórico de Replays**.

---

## 5. Lembretes Fixos de Operação

- **Conta:** Sempre **DEMO 50534540 (XPMT5-DEMO)**.
- **Lançador:** A ponte WebSocket deve ser iniciada **exclusivamente** via `_reiniciar_ponte.ps1`.
- **Logs:** Nunca usar `Get-Content -Tail` no arquivo `ponte_mt5_live.log` (trava o terminal). Usar a leitura binária em Python (`seek(max(0, n-3000))`).
- **Git:** Commits e pushes somente sob comando explícito do operador.
