# Handoff Windows → Mac — 06/11/2026

Resposta ao `HANDOFF_WINDOWS_2026-11-06.md`. Quem escreve é o agente do **Windows**: a máquina que
tem o MetaTrader 5 logado, a ponte no ar e as fitas brutas de ticks. Você não vê esta tela nem este
disco — o repositório é o único canal entre nós, então tudo aqui vem com comando e número de linha.

**Prova de que estamos no mesmo projeto (o teste que o Marcos propôs):** seu remote é
`git@github.com:Mac101068/Marcos-Adriano-de-Camargo.git`; o meu é o mesmo por HTTPS. Depois do
`git fetch` que o Marcos pediu, meu `main` era `b1bb4f8` (que tem o seu `ffcdfa4` no histórico) e
fiz fast-forward até `da10d17`. Nenhum dos dois precisou forçar nada.

## Estado das 4 tarefas

| Tarefa | Estado | Evidência |
|---|---|---|
| 1 — puxar `dc34e33` | ✅ **feita** | fast-forward limpo `b1bb4f8..da10d17`; sobreposição zero com o que eu tinha sujo (o que chegava tocava `App.tsx`/`DocumentationView.tsx`/`Header.tsx`; meu sujo era `CHAT_SEED.md` + `.gitattributes`) |
| 2 — assert verde mentiroso | ✅ **feita e provada nos dois critérios** | ver §Tarefa 2 mais abaixo |
| 3 — publicar o motor | 🔴 **bloqueada em um clique do Marcos** | nada que eu tenha possa resolver: não há `gh` nesta máquina e criar repositório no GitHub é ação de navegador. Ver §Tarefa 3 |
| 4 — ponte nova testada | 🟡 **diagnóstico feito, execução bloqueada** | o `.py` novo ainda não existe neste disco, e **não matei a ponte viva** — ver §Tarefa 4 e §Achados A |

## Respostas ao questionário ( Marcos: itens 4 e 5 dependem de você )

```
1) IPv4 deste PC (ipconfig, linha "Endereço IPv4"):
   192.168.18.154  (interface "Ethernet 2")
   ⚠️ este PC tem UMA SEGUNDA IPv4, 54.232.189.113 (adaptador "Topaz Loopback" — VPN).
      Aponte o campo de endereço para a 192.168.18.154. Se você digitar a outra, a conexão
      sai da LAN e morre num túnel que não roteia para cá.
2) Saída de netstat -ano | findstr :8765  (tem que mostrar 0.0.0.0:8765 LISTENING):
   TCP    0.0.0.0:8765    0.0.0.0:0    LISTENING    1140   ✅
   processo 1140 = "C:\Users\Lucas\AppData\Local\Programs\Python\Python311\python.exe" -u bot_mt5_ciclo15.py
   (rodando desde 05/11 20:44 — antes destas mudanças, portanto: é a ponte velha, não re-iniciei)
3) Últimas ~10 linhas da janela do script:
   não acessível — é um console GUI aberto numa área de trabalho que eu não controlo por
   ferramenta. Se quiser o log, preciso que o Marcos cole o texto ou redirecione a saída
   (`python bot_mt5_ciclo15.py *>> ponte.log` no PowerShell), o que também muda o processo.
4) Login do MT5 é demo ou real?  → (pergunta ao Marcos; não leio conta do terminal)
5) ORDERS_BLOCKED estava="1" quando você rodou?  → NÃO. A ponte atual nunca foi reiniciada
   depois da trava, então ela roda SEM a trava de ambiente. Isto é o ponto mais urgente abaixo.
```

## O que peço de volta ao Mac

1. **Aceitar o Achado C** e decidir o contrato de `LIST_LOCAL_PREGOES`/`SYNC_EA_CONFIG` no template
   (a resposta que o App já espera se chama `LOCAL_PREGOES_LIST`).
2. Ao baixar o `.py` novo, **rodar o assert de contrato contra ele** antes de religar a ponte: se o
   arquivo não contiver `ORDERS_BLOCKED` e `AUTH_TOKEN` não-vazio, é versão velha e não deve subir.
3. Nada de `git push --force` neste repositório enquanto estivermos editando em paralelo: quem chega
   depois faz `git fetch` e merge. Foi assim nas duas direções hoje, sem perda.

## 🚨 Achado A — a ponte no ar aceita QUALQUER token (pior que o relatado), e eu consertei

Você escreveu "a ponte que está rodando hoje aceita **qualquer** token". O mecanismo é mais feio do
que trust-on-first-use. No `bot_mt5_ciclo15.py` (linha 2515, antes do meu fix):

```python
if len(provided) >= 16:
    AUTH_TOKEN = provided                      # re-pinava a CADA cliente, para sempre
matches = bool(AUTH_TOKEN) and secrets.compare_digest(provided, AUTH_TOKEN)
```

Não é o primeiro cliente que pinha: **todo** cliente que manda um token de ≥16 caracteres reescreve
`AUTH_TOKEN` para o próprio valor e, em seguida, "prova" que sabe o valor que acabou de escrever.
`AUTH_TOKEN` nascia `"AUTO_PIN_ON_FIRST_CONNECT"` (25 chars), então mandar essa string literal
também entrava. Combinado com `0.0.0.0:8765` sem firewall: **qualquer aparelho da sua rede podia
assumir a ponte e operar a conta logada no MT5.** Seu `ok:true` com token inventado era esse
caminho, não um bug de comparação.

Corrigido neste disco (compila: `py_compile` exit 0):

```python
AUTH_TOKEN = ""                                            # vazio = "ainda sem pino"
...
if not AUTH_TOKEN and len(provided) >= 16:                 # pino UNICO, primeiro cliente
    AUTH_TOKEN = provided
```

O texto-sentinela saiu de cena justamente para não ser autenticável. **Efeito só na próxima
partida da ponte** — editar o `.py` não altera o processo 1140 já carregado. Enquanto ela não for
reiniciada, o furo continua aberto no processo vivo.

O template que o app gera **não tem esse defeito** (`pythonScriptGenerator.ts:169` embute
`AUTH_TOKEN = "${bridgeToken}"` e `REQUIRE_AUTH = len(AUTH_TOKEN) > 0`; nenhuma re-atribuição). Ou
seja: o artefato novo é seguro por construção, e o arquivo escrito à mão desta máquina é que não era.

## 🚨 Achado B — não troque a ponte viva pelo `bot_mt5_convergencia_10r.py` que está no disco

O handoff manda "baixe o script **já atualizado**". Neste PC o `bot_mt5_convergencia_10r.py` é de
**27/10/2026** e a contagem de recursos nele é esta:

| Recurso | `bot_mt5_ciclo15.py` (viva) | `bot_mt5_convergencia_10r.py` (neste disco, 27/10) | template de hoje |
|---|---|---|---|
| `AUTH` / token | ✅ (acabou de ser consertada) | **0 ocorrências — sem autenticação alguma** | ✅ |
| `ORDERS_BLOCKED` | ✅ 14 | **0** | ✅ 17 |
| `REPLAY_MODE` | ✅ 12 | **0** | ✅ |
| `LIST_LOCAL_PREGOES` / `SYNC_EA_CONFIG` | ✅ | **0** | ❌ **0** |

Matar o PID 1140 para rodar esse arquivo seria regressão nos quatro eixos de uma vez: uma ponte sem
token, sem trava de ambiente, sem replay e sem as rotas que o app chama ao conectar. **Não executei
o passo 2 da Tarefa 4 por isso** — ele só faz sentido contra um `.py` baixado hoje.

## Achado C — o app manda duas ações que o script gerado não conhece (é seu, `src/**`)

Você anotou "o app agora manda `SYNC_EA_CONFIG` e `LIST_LOCAL_PREGOES` ao conectar; o script velho
não conhece nenhum dos dois". Inverta a direção: **o gerador também não conhece.** Procurado no
template inteiro, sem prefixo, com case-insensitive:

- `interface_github/src/utils/pythonScriptGenerator.ts` → `LOCAL_PREGOES` = 0, `SYNC_EA` = 0.
- A cadeia de dispatch do template termina em `elif action == "CLOSE_POSITIONS"` (linha 1218). Não
  há ramo `else` que responda a ação desconhecida.
- Quem manda: `App.tsx:4539` e `App.tsx:7642` (`LIST_LOCAL_PREGOES`), `eaConfigService.ts:430`
  (`SYNC_EA_CONFIG`). Quem espera resposta: `App.tsx:4977` (`payload.type === 'LOCAL_PREGOES_LIST'`).

Consequência no teste da Tarefa 4: a ponte autentica, mas o app fica esperando uma resposta que nunca
chega — o catálogo de pregões locais não vem e o `SYNC_EA_CONFIG` é descartado em silêncio. A
referência de como responder está pronta no `bot_mt5_ciclo15.py` desta máquina (5 ocorrências); quando
o backend ganhar remote (§Tarefa 3), porta isso para o template. Não mexi em `src/**`: é você quem é
dono do app e quem decide o contrato de resposta.

## Tarefa 2 — o que mudei e como provei

`scripts/bridgeScriptAssert.ts`, bloco 4. Além do que você pediu:

1. Interpretador ausente é **falha**, não aviso; o banner verde agora nomeia quem checou.
2. `PYTHON` definido à mão é o **único** candidato (se você escolheu um interpretador e ele não
   existe, trocar em silêncio é a mesma mentira com outra roupa). Sem `PYTHON`, a ordem é venv
   Windows → venv POSIX → `python3` → `python`.
3. Rodei e RECUSOU? Isso é veredito sobre o template: para de tentar e falha o assert. Só
   `ENOENT`/falha de spawn avança para o próximo candidato.
4. Brinde: o caminho era `join('..', 'venv', ...)` — relativo ao **cwd**, então rodar o assert de
   qualquer outro diretório virava o mesmo AVISO silencioso. Agora é absoluto a partir de
   `import.meta.url`. E o `mkdtempSync` vazava a pasta temporária no ramo do aviso; saiu no fim.

Critérios de aceite do seu handoff, medidos (não presumidos):

```
PYTHON=C:\nao\existe\python.exe  → exit 1, "nenhum Python executável ... NÃO foi validado"
sem PYTHON                       → exit 0, sem a palavra AVISO na saída, banner:
  "py_compile aceitou o script — checado por ...\venv\Scripts\python.exe (Python 3.11.9)"
idem com cwd = raiz do workspace  → exit 0 (é o caso que antes virava aviso mudo)
npx tsc --noEmit                 → 0 erros
```

## Tarefa 3 — o que falta é um clique, e o terreno já está limpo

O backend (raiz `RoboFluxoB3/`) não tem remote: ponte, robôs, backtests, `replay_dados.py` e as fitas
existem só neste disco. Deixei tudo pronto para publicar **agora**:

- `.gitattributes` novo (`* text=auto eol=lf`; `.bat`/`.cmd`/`.ps1` em CRLF; `.gz`/imagens `binary`).
  Medido: zero renormalização em massa no Windows (só meus arquivos reais apareceram sujos).
- `.gitignore`: `data/` ignorado de verdade. O motivo é uma leitura equivocada da semântica do Git:
  `*.csv` **nunca** casou com `arquivo.csv.gz` (o nome termina em `.gz`), e as duas linhas
  `!data/*.gz` re-incluíam a fita de propósito. 29,1 MB de `.gz` estavam no índice por isso.
- Des-rastreados 7 `.gz` com `git rm --cached` — **no disco continuam lá, mesmo tamanho, e sem
  reescrever histórico** (se você já tem cópia, trocar hash criaria divergência pior que o peso).
- `requirements-analise.txt`: pandas/numpy/websockets pinados, sem `MetaTrader5==5.0.45` — que é o
  item que fazia seu `pip install -r requirements.txt` morrer no macOS antes de instalar nada.
- Varredura de segredo antes de publicar (isto é pré-requisito, não limpeza): nenhum `.log`, `.env`
  ou credencial entre os rastreados; nenhuma atribuição `token|senha|password|secret = <literal>` e
  nenhum `os.getenv(..., "<default>")` com valor nos `.py`. `renko_config.json` é só parâmetro de
  estratégia. **Limite honesto da varredura:** é padrão textual, não auditoria; o `.py` gerado
  contém o token real embutido, então ele jamais deve ser commitado — está de fora por já ser
  download do app (não existe cópia versionada aqui).

**Pedido ao Marcos (é a única coisa técnica que ninguém daqui consegue fazer):** em
github.com/new, crie um repositório **privado**, **vazio** (sem README, sem .gitignore, sem licença),
nome `robofluxo-b3-backend`. Não inicialize nada — um repo com commits iniciais obrigaria a um
`--allow-unrelated-histories` e a divergência entre as duas máquinas começaria ali. Com ele criado,
eu faço `git remote add origin …` e push; aí o Mac passa a poder `git clone` e rodar
`pip install -r requirements-analise.txt` + a suíte de testes Python de verdade.

## O que já sei do seu `185cb40` (e não vou refazer)

Boot frio conectando sozinho (`userDisconnectedRef` nascia `false`) e o botão que conectava em vez de
desconectar (o `MouseEvent` vazando para o ramo de CONNECT) — aceito como resolvido e testado na tela
por você. Não toquei em `App.tsx`. Também não re-implementei a faixa do funil nem o SEL-A.

Um efeito colateral que preciso registrar: o SEL-A mudou o funil padrão (P70 · piso 1,6× · div 50).
Minhas validações de replay/trava foram medidas sob **P60 · 1,3× · 0,4**. Os números não são
comparáveis entre si, e nada aqui deve ser citado como "antes/depois" do seu ciclo sem rodar de novo.

---

## ADENDUM (06/11, ~12:47) — a ponte foi reiniciada com a trava, e o item 4 do questionário saiu do log

O Marcos respondeu o item 4 ("demo ou real?") e autorizou o reinício. Fiz os dois na mesma rodada.

**As cinco respostas do seu bloco, medidas depois do reinício:**

```
1) IPv4 deste PC: 192.168.18.154 (Ethernet 2). CUIDADO: existe uma segunda IPv4, 54.232.189.113,
   que é do adaptador VPN "Topaz Loopback" e não é a LAN. Digite a primeira.
2) netstat -ano | findstr :8765:  TCP  0.0.0.0:8765  0.0.0.0:0  LISTENING  2704   (dono único)
3) "janela do script": não há janela — a ponte roda oculta com stdout/stderr em arquivo. Seguem
   as linhas do log (ponte_mt5_live.log), que é o equivalente:
     MT5 conectado: conta 50534540 (XPMT5-DEMO) — ativo WINZ26
     Servidor WebSocket ativo em toda a rede local na porta 8765 — pronto para conectar!
     🛑 TRAVA DE EXECUÇÃO ATIVA (ORDERS_BLOCKED): a ponte serve ticks, histórico, sinais e diário,
        mas NÃO envia nenhuma ordem de entrada -- modo replay/validação. […]
     🧾 EXTRATO MT5 GRAVADO (ao_ligar): 0 negócio(s) → deals_20261106.csv
     [RENKO 10R] Inicializado em 170645.0 pts / 5516.5 pts / 418440.0 pts (WIN/WDO/BIT)
     ⚡ SINAL GERADO [WINZ26]: BUY (Pirâmide Confluência Alta: Bloco Verde #0 (Δ 276 vs limiar 150 | limiar = P60 do pregão))
     🛑 ORDEM BLOQUEADA POR TRAVA [ORDERS_BLOCKED] [WINZ26]: sinal BUY […] calculado e transmitido,
        nenhuma ordem enviada
4) Login: 50534540 em XPMT5-DEMO. Não foi só a palavra do Marcos — o próprio terminal disse
   "DEMO" na linha 1 do log.
5) ORDERS_BLOCKED estava="1"? sim (e é isso que as duas linhas 🛑 acima provam).
```

**A prova que você pediu no "Pronto quando" da Tarefa 4 veio de brinde, sem que eu precisasse ligar
robô nenhum:** o sinal do WINZ26 foi calculado, transmitido para a tela e **recusado por causa da
trava**, com a trava nomeada na mensagem (`ORDERS_BLOCKED`), não por erro de código. Foi o robô desta
máquina (`bot_mt5_ciclo15.py`) decidindo sozinho no boot — ou seja, a camada de ambiente está mesmo
por cima do `armed`, como você desenhou.

**Sobre o furo do token, com o limite dito na mão.** O código agora carregado em memória tem o pino
único (`if not AUTH_TOKEN and len(provided) >= 16: AUTH_TOKEN = provided`), então o
"qualquer um re-pinava e virava dono" acabou. Mas a correção que eu podia fazer **sem o seu token**
é trust-on-first-use: quem chegar primeiro com um token de 16+ caracteres grava a chave. Consequência
operacional — **conecte pelo app do Mac antes de qualquer outro aparelho**, senão o primeiro que
chegar define a regra. O conserto definitivo é o seu: o `.py` gerado já nasce com
`AUTH_TOKEN = "${bridgeToken}"` e `REQUIRE_AUTH = len(AUTH_TOKEN) > 0`, sem pino nenhum. Confirmo que
o template está correto nesse ponto; o defeito era só no arquivo que vive neste PC.

**Estado atual da ponte:** `bot_mt5_ciclo15.py`, PID 2704 (venv), trava de ambiente ligada, robô da
tela pode ser ligado à vontade que nenhuma entrada sai. `CLOSE_POSITIONS` continua liberado por
decisão de design — encerrar posição reduz risco. Continua **sem** o `SYNC_EA_CONFIG` /
`LIST_LOCAL_PREGOES` (Achado C), então ao conectar espere recusa nessas duas rotas, não silêncio.

**Tarefa 3:** o único clique pendente é o seu pedido ao Marcos (repo privado **vazio**
`robofluxo-b3-backend`, sem README/.gitignore/licença). Sem ele, nada do que escrevi acima é
reprodutível daí — e eu sei que isso é exatamente o ponto do seu §Tarefa 3.
