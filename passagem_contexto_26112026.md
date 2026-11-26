# RoboFluxoB3 — Passagem de Contexto e Dados das Estratégias (26/11/2026)

Documento consolidado para abertura de **nova conversa**, registrando os avanços, arquitetura, correções aplicadas e estado das estratégias e do laboratório quantitativo em 26/11/2026.
Consulte sempre em conjunto com o `AGENTS.md` (regras fundamentais de segurança, git e verificação).

---

## 1. Resumo Executivo das Entregas de Hoje (26/11/2026)

1. **Segurança Inegociável da Ponte MT5 (`ORDERS_BLOCKED = '1'`):**
   - Corrigido o lançador `_reiniciar_ponte.ps1` para forçar incondicionalmente `$env:ORDERS_BLOCKED = '1'`.
   - Eliminada a vulnerabilidade do `if (-not (Test-Path ...))` que herdava variáveis do ambiente e permitiu envios acidentais na sessão anterior.
2. **Laboratório Quantitativo de Microestrutura (WIN/WDO):**
   - Coletor assíncrono não-bloqueante (`coletor_microestrutura.py`) com thread dedicada (`queue.Queue`) e gravação contínua em CSV (`LAB_MICROESTRUTURA_<ativo>_<dia>_<hora>.csv`).
   - Resolução do deadlock crítico de inicialização trocando `threading.Lock()` por `threading.RLock()`.
   - Rotação horária e particionamento em 100 MB (`_p1`, `_p2`...) baseado no tamanho real do arquivo (`f.tell()`).
   - Analisador estritamente causal (`analisador_antecipacao_quant.py`) que enriquece os dados com labels futuros (+100 ms, +500 ms, +1 s, +5 s, deslocamento e absorção) sem vazamento de informação (zero look-ahead bias).
   - Suíte de testes automatizados (`test_coletor_microestrutura.py`) com 36 asserções cobrindo integridade, monotonicidade e fidelidade dos labels.
3. **Estabilidade de Troca de Ativo e Prevenção de Queda WebSocket (Código 1006):**
   - Eliminado o disparo duplicado de `GET_BACKFILL` logo após `SELECT_ASSET` na interface React.
   - Timeout de broadcast no backend expandido de 5.0 s para 15.0 s para tolerar picos de renderização pesada na UI sem desconectar a sessão.
   - Protegido `send_json()` com timeout e tratamento de exceção seguro.
4. **Alinhamento do Bitcoin Futuro B3 (BITX26):**
   - Corrigido o multiplicador de pontos no frontend (`assetRegistry.ts` e `multiRobots.ts`): de `0.01` para **`0.1`** (paridade com o backend `bot_mt5_ciclo15.py`).
   - 1 contrato futuro de BIT = 0,1 BTC; 1 ponto = R$ 0,10; variação mínima de 20 pontos (1 tick) = **R$ 2,00** (o dobro de 1 tick do WIN).
5. **Correção do Bug do PnL de R$ 1,5M no WDO e Preservação de Ordens:**
   - **Causa Raiz:** O loop de ticks locais percorria ordens de outros ativos sem validar se o tick pertencia ao mesmo símbolo. Ticks de WIN (~171.000 pts) calculavam PnL sobre entradas de WDO (~5.500 pts), gerando uma discrepância fictícia de +R$ 1.654.500,00.
   - **Correção:** Adicionada guarda estrita com `isOrderForAsset(ord, asset)` e `isPriceSaneForAsset(ord.entryPrice, asset)`.
   - **Preservação de Ordens:** Removido o `setOrders([])` na troca de abas, permitindo navegar entre WIN, WDO e BIT sem perder os trades da sessão corrente.

---

## 2. Mapa dos Repositórios e Árvores Git

| Repositório | Caminho | Branch / Remoto | Conteúdo |
|---|---|---|---|
| **Backend** | `C:\Users\Lucas\Documents\RoboFluxoB3` | `backend-python` | Ponte WebSocket, motor de sinais, coleta quantitativa, testes e diário |
| **Frontend** | `...\RoboFluxoB3\interface_github` | `main` | Interface React, Vite, gráficos Renko, boleta, painéis |

*Lembrete: `interface_github/` é um submodule/repo independente no `.gitignore` da raiz. Commits são sempre separados.*

---

## 3. Estado das Estratégias e Configurações Ativas

### 3.1 Identificação e Magic Numbers em Uso
- `102030`: Robô Principal Renko (Pirâmide & Confluência / Reteste Pullback)
- `999999`: Boleta Manual / Operações em Tela
- `100001`: RoboCompra (EA Direcional de Compra)
- `100002`: RoboVenda (EA Direcional de Venda)
- `150101` / `150102`: Magics Direcionais WIN
- `150201` / `150202`: Magics Direcionais WDO
- `150301` / `150302`: Magics Direcionais BIT

### 3.2 Regras do Motor (Validadas pelo `test_paridade_regras.py`)
- Janela de pregão: Abertura `08:55`, Término de entradas `17:30`, Zeragem compulsória `17:30`.
- Piso estático WIN: `300` pts. Teto anti-clímax: `3200` pts.
- Filtro de tendência do fluxo ativado (`flow_trend_filter = True`, janela 20 boxes).
- Sincronização tela ➔ ponte: O frontend envia `SYNC_EA_CONFIG` e a ponte aplica parâmetros dinamicamente sem reiniciar processo.

---

## 4. Status da Bateria de Testes (Tudo 100% Verde)

| Teste | Comando | Resultado | Status |
|---|---|---|---|
| **Compilação Backend** | `venv/Scripts/python.exe -m py_compile bot_mt5_ciclo15.py coletor_microestrutura.py analisador_antecipacao_quant.py` | `EXIT=0` | ✅ Verde |
| **Paridade de Regras** | `venv/Scripts/python.exe test_paridade_regras.py` | 47 ✅ / 0 ❌ (`EXIT=0`) | ✅ Verde |
| **Diário de Eventos** | `venv/Scripts/python.exe test_diario_eventos.py` | 46 `[OK]`, 0 falhas (`EXIT=0`) | ✅ Verde |
| **Laboratório Microestrutura** | `venv/Scripts/python.exe test_coletor_microestrutura.py` | 36 `[OK]`, 0 falhas (`EXIT=0`) | ✅ Verde |
| **Tipagem Frontend** | `cd interface_github && npx tsc --noEmit` | `EXIT=0` (sem erros) | ✅ Verde |

---

## 5. Próximos Passos Sugeridos para a Nova Conversa

1. **Conexão do `sinal_info` na Coleta:**
   - Atualmente, em `bot_mt5_ciclo15.py:5495`, o coletor recebe `sinal_info=None`.
   - Vincular os metadados dos sinais gerados pelo motor (`index`, `signal`, `reason`, `score`) a cada evento para correlacionar o fluxo exato no momento do disparo.
2. **Estudo Empírico do Fluxo de Agressão vs Reação Futura:**
   - Coletar uma sessão completa de mercado aberto com `LAB_MICROESTRUTURA_*.csv`.
   - Rodar `analisador_antecipacao_quant.py` e gerar gráficos de distribuição do $\Delta \text{preço}$ condicionado a quantis de agressão em +100 ms, +500 ms, +1 s e +5 s.
   - Avaliar a taxa de "agressão sem avanço" (absorção observada).
3. **Decisão sobre `is_manual_cmd` no Motor:**
   - Confirmar com a equipe/outra instância se `acao == "APP_ORDER_SEND"` deve continuar fora do filtro de manualidade na linha ~2699 de `bot_mt5_ciclo15.py`.

---

## 6. Lembretes Fixos de Operação

- **Conta:** Sempre **DEMO 50534540 (XPMT5-DEMO)**.
- **Lançador:** A ponte WebSocket deve ser iniciada **exclusivamente** via `_reiniciar_ponte.ps1` (ou atalho da área de trabalho).
- **MT5:** Deve estar aberto e conectado **antes** de subir a ponte.
- **Log:** Nunca usar `Get-Content -Tail` no arquivo `ponte_mt5_live.log` (trava o terminal). Usar a leitura binária em Python (`seek(max(0, n-3000))`).
