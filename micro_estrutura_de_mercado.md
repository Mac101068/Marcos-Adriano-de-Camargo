# Microestrutura de Mercado — passagem de contexto (25/11/2026)

Documento para abrir uma **nova conversa** sem perder o que foi feito em 25/11/2026.
Leia junto com `AGENTS.md` (regras do projeto — segurança, git, verificação).

---

## 1. Missão

Montar a **coleta quantitativa de microestrutura** (WIN/WDO) para testar, sem viés e sem
look-ahead, se o fluxo de agressão antecede o deslocamento do preço.

- **Não** é para criar estratégia, mexer em sinais nem otimizar parâmetros.
- Separar rigorosamente **features** (conhecidas no instante do evento) de **labels**
  (resposta do preço em +100 ms, +500 ms, +1 s, +5 s).

---

## 2. O que foi implementado (nada commitado)

### 2.1 Arquivos novos — repo raiz (`backend-python`), status `??`

| Arquivo | Papel |
|---|---|
| `coletor_microestrutura.py` | Coletor assíncrono: `queue.Queue` + thread dedicada de I/O, flush periódico, rotação a cada hora ou 100 MB, contadores (recebidos / gravados / descartados / erros). Grava `LAB_MICROESTRUTURA_WIN_WDO_YYYYMMDD_HH.csv`. Expõe o singleton `collector`. |
| `analisador_antecipacao_quant.py` | Pós-processamento offline: lê o CSV e calcula os **labels** futuros (+100 ms, +500 ms, +1 s, +5 s) sem vazar informação para as features. |
| `test_coletor_microestrutura.py` | Teste sintético: 200 eventos, cabeçalho, timestamps, ausência de duplicação, ordem cronológica e enriquecimento de labels. |

### 2.2 Integração no motor — `bot_mt5_ciclo15.py` (status `MM`)

1. **Import seguro** (logo após `import websockets`, ~linha 101): `try/except` →
   `MICRO_COLETOR_ENABLED`. Se o módulo falhar, a ponte sobe igual.
2. **Ingestão do tick** em `mt5_stream_loop()` (~linha 5489): para cada tick vivo chama
   `micro_collector.registrar_evento(symbol, preco, volume, aggressor, ts_msc, bid, ask,
   fonte="VIVO_MT5", sinal_info=None)` dentro de `try/except: pass` — nunca derruba o loop.
3. A lógica operacional **não** foi alterada pela coleta.

### 2.3 Decisões de desenho

- **Agressor**: vem das flags reais do MT5 (`TICK_FLAG_BUY` / `TICK_FLAG_SELL`); sem flag →
  `CROSS`. Não é tick rule. Se algum dia usar estimativa, coluna separada `lado_agressor_estimado`.
- **Book (`mt5.book_add`)**: tratado como **indisponível/instável** → não se simula OFI nem
  book completo; foco 100 % em Time & Sales. Só `bid`/`ask`/`spread` do tick.
- **Timestamp**: `time_msc` do MT5 (ms) + `MT5_BRT_OFFSET_MSC`; também o horário de
  recebimento no Python, para medir latência.
- **Derivadas**: `delta`, `delta_acumulado`, `eficiencia_fluxo = delta / volume_total`,
  `velocidade_negocios`, `spread = ask − bid`. Absorção = **hipótese observável**, não fato.
- **Sinais**: campo `sinal_info` previsto para ligar evento ↔ sinal (id, horário, direção,
  estado do fluxo). Hoje é passado `None` — **ainda não conectado**.

---

## 3. Outras correções do dia (fora da coleta)

| Onde | O quê | Motivo |
|---|---|---|
| `bot_mt5_ciclo15.py` `execute_pyramid_confluence` (~2861) | Novo parâmetro `signal_time=None` com fallback `time.time()` | O log mostrava `NameError: name 'signal_time' is not defined` na piramidação |
| `interface_github/src/App.tsx` `hedgeBook` (~9333) | Ordens fechadas com `|financialResult| ≥ R$ 500.000` são ignoradas em Ganhos/Perdas | Boleta do WDO exibia **+R$ 1.585.720,00** |
| `interface_github/src/components/AutomationPanel.tsx` e `DirectionalEAsPanel.tsx` | Mínimo dos parâmetros no dólar passa de 5 para 0,5 | Pedido do usuário (status `M`, já em staging) |

> ⚠️ A trava de R$ 500 mil no `App.tsx` **esconde o sintoma**. A causa (ordem fechada com
> `entryPrice`/`exitPrice` fora de escala) ainda não foi localizada.

### Diff no motor que NÃO é desta sessão — conferir
No `git diff bot_mt5_ciclo15.py` aparece também (≈ linha 2699):
```diff
- is_manual_cmd = (... or acao == "APP_ORDER_SEND")
+ is_manual_cmd = (...)
```
Não foi feito nesta conversa (provavelmente pela outra instância). Muda quais ordens vindas
da tela passam pelo filtro `STRATEGY_ENABLED`. **Confirmar com quem fez antes de commitar.**

---

## 4. Incidentes do dia

1. **Ordens executadas com a trava desligada (conta DEMO).** Às 18:10 e 18:15 a ponte aceitou
   `ORDER_SEND` do RoboCompra (magic 100001) e o MT5 executou:
   tickets `#2603087760` e `#2603088635` (WDOZ26 BUY 1 @ 5832,5 e 5830,0).
   A tela já mostrava "Execução de Ordens (Ponte) **LIBERADA**" de manhã.
   Causa provável: `_reiniciar_ponte.ps1` só liga a trava se `ORDERS_BLOCKED` **não existir**
   no ambiente (`if (-not (Test-Path env:ORDERS_BLOCKED))`).
2. **Erro do agente:** por volta das 19:01 uma tentativa de subir a ponte **fora do lançador**
   teve erro de sintaxe justamente na linha da trava e o bot pode ter subido sem ela.
   Processo derrubado às ~20:00 (PIDs 39696 / 37004). Mercado já fechado.
3. **MT5 não abria** à noite: instância presa de `terminal64.exe` (possivelmente iniciada
   pelo agente). Resolvido abrindo o MT5 manualmente — logou em `XPMT5-DEMO 50534540`.
   Caminho correto: `C:\Program Files\MetaTrader 5 Terminal\terminal64.exe`.
4. **Ponte travada sem log (causa real, achada em 26/11 08:59).** `coletor_microestrutura.py`
   tinha deadlock no import: `get_instance()` pegava `_lock` (`threading.Lock`) e chamava
   `start()`, que pegava o mesmo lock. O motor importa o coletor na linha ~101, então a ponte
   congelava antes do 1º print — sem porta 8765, log parado em 18:22 de 25/11.
   **Corrigido** trocando para `threading.RLock()`. Verificado: `import coletor_microestrutura`
   → `IMPORT_OK 0.63` s; `py_compile bot_mt5_ciclo15.py` → `EXIT=0`.
5. **Queda ao trocar de gráfico** (`SELECT_ASSET`): o backfill do dia vai inteiro de uma vez,
   estoura o timeout de 5 s do broadcast e a conexão fecha com código 1006. **Não corrigido.**

---

## 5. Estado dos testes — NADA validado ainda

O servidor reiniciou no meio da bateria; nenhum destes terminou:

```powershell
venv\Scripts\python.exe -m py_compile bot_mt5_ciclo15.py
venv\Scripts\python.exe test_coletor_microestrutura.py
venv\Scripts\python.exe test_paridade_regras.py      # esperado 47 ✅ / 0 ❌
venv\Scripts\python.exe test_diario_eventos.py       # esperado 46 [OK]
cd interface_github; npx tsc --noEmit                # esperado sem saída
```

Também **não há ainda** `LAB_MICROESTRUTURA_*.csv` gerado com mercado aberto — falta a
evidência real (5 linhas de exemplo + contadores).

---

## 6. `git status` no fim do dia

**Raiz (`backend-python`):**
```
A  auditar_hoje_completo.py           (outra instância)
A  auditoria_pos_pregao_20261120.py   (outra instância)
MM bot_mt5_ciclo15.py
A  forense_zeros_pnl.py               (outra instância)
A  medir_piramide_replay.py           (outra instância)
A  testa_pnl_fix.py                   (outra instância)
?? analisador_antecipacao_quant.py
?? coletor_microestrutura.py
?? test_coletor_microestrutura.py
A  _diff.txt                          (lixo — não commitar)
```
**Interface (`main`):**
```
MM src/App.tsx
M  src/components/AutomationPanel.tsx
M  src/components/DirectionalEAsPanel.tsx
```

> Duas instâncias escreveram na mesma pasta hoje — exatamente o que a Seção 8 do
> `AGENTS.md` proíbe. Antes de qualquer coisa: `git status` e `git diff` nos dois repos.

---

## 7. Próximos passos (ordem sugerida)

1. **Segurança primeiro:** fazer `_reiniciar_ponte.ps1` forçar sempre
   `$env:ORDERS_BLOCKED = '1'` (sem o `if`) e conferir na tela "BLOQUEADA".
2. Rodar a bateria da Seção 5 e corrigir o que falhar.
3. Resolver o diff `is_manual_cmd` com a outra instância.
4. Corrigir a queda na troca de gráfico (backfill em chunks / sem bloquear o broadcast).
5. Achar a causa real do PnL absurdo no `App.tsx` (ordem fechada com preço fora de escala).
6. Com mercado aberto: deixar a coleta rodar 1 h, conferir o CSV (cabeçalho, ms crescentes,
   sem `id_evento` duplicado, contadores) e rodar `analisador_antecipacao_quant.py`.
7. Conectar `sinal_info` aos sinais do motor (id, horário, direção, estado do fluxo).
8. Primeiro experimento: **resposta do preço condicionada ao delta** — para cada evento de
   agressão, distribuição de Δpreço em +100 ms / +500 ms / +1 s / +5 s por quantil de delta,
   comparada com eventos aleatórios (baseline); e taxa de "agressão sem avanço" (absorção
   candidata).

---

## 8. Lembretes fixos

- Conta **DEMO 50534540 (XPMT5-DEMO)**. Ponte **só** via `_reiniciar_ponte.ps1` / atalho
  "Robo Fluxo B3". Nunca `python bot_mt5_ciclo15.py` na mão.
- MT5 precisa estar **aberto e logado antes** da ponte; senão ela trava em `mt5.initialize()`
  sem escrever nada no log.
- `ponte_mt5_live.log` passa de 7 MB com codificação mista — **não** usar `Get-Content -Tail`
  (trava o terminal). Ler o fim assim:
  ```powershell
  venv\Scripts\python.exe -c "f=open('ponte_mt5_live.log','rb');f.seek(0,2);n=f.tell();f.seek(max(0,n-3000));print(f.read().decode('utf-8','replace'))"
  ```
- Commit só sob pedido explícito; nunca push/reset/force.
