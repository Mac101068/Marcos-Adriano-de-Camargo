# Handoff Mac → Windows — 06/11/2026

Leia inteiro antes de executar qualquer linha. Você está recebendo este arquivo sem ver a
conversa que o produziu, então tudo aqui vem com evidência verificável.

## Quem é quem

- **Mac (eu, a sessão que escreveu este arquivo):** dono do app (`src/**`), do navegador com o
  terminal rodando em `http://localhost:3000`, e de onde o `bot_mt5_convergencia_10r.py` é
  **gerado e baixado**.
- **Windows (você):** dono da máquina que tem o MetaTrader 5 logado e onde a ponte roda.
- **Você (Marcos):** o courier entre os dois. Não existe canal direto Mac ↔ Windows: os dois
  agentes enxergam só o próprio disco. O único meio de comunicação real entre eles é o
  repositório no GitHub.

## Estado já provado (não re-trabalhe isto)

| Fato | Como foi provado |
|---|---|
| Remote dos dois: `git@github.com:Mac101068/Marcos-Adriano-de-Camargo.git` | `git remote -v` nas duas máquinas |
| `origin/main` está em **`dc34e33`** (push feito do Mac) | `git push` → `b1bb4f8..dc34e33`; status sem ahead/behind |
| `185cb40` conserta o **boot frio conectando sozinho** (`userDisconnectedRef` nascia `false`) e o **botão que conectava em vez de desconectar** (`onClick={onToggleMT5Connect}` entregava o `MouseEvent` e caía no ramo de CONNECT, abrindo uma segunda ponte) | 5 testes na tela: boot frio = 0 conexões no log da ponte; queda → reconexão automática; clique → desconecta e para |
| Existe campo de **host/porta** da ponte no Guia, validado e persistido como chave de runtime (não entra no SavedStrategy) | renderizado e aplicado na tela pós-merge |
| O merge (`b1bb4f8`, Ciclos 16–18 + trava de execução) integra **sem conflito** com esses fixes | merge `dc34e33`, working tree limpa |
| No **Mac** há **0 arquivos `.py`** | `find` no repo: `total_python=0` |

## Limites deste trabalho (regras, não sugestões)

1. **Nenhuma ordem.** Não envie ordem, não altere posição, não mexa no terminal MT5. Seu escopo é
   processo da ponte, arquivos e rede.
2. **Robô desligado** no app do Mac durante todo o teste (está `OPERA: OFF` agora).
3. **Não gere o script da ponte aí.** O token mora no `localStorage` do navegador do **Mac**. Se o
   Windows rodar o gerador, ele embute um segredo diferente e o app do Mac passa a ser recusado. O
   `.py` viaja como **arquivo baixado do app do Mac**.
4. **Não cole o token em chat, e-mail ou mensagem.** Ele está dentro do `.py`; o arquivo é o
   veículo. Se o token precisar viajar sozinho, é pela tela "Segurança da Ponte", não pelo
   histórico de conversa.
5. **Firewall por último.** Só aplique regra de entrada na 8765 depois que o teste falhar por
   rede — nunca antes, como "prevenção".

## Tarefa 1 — puxar o que já foi feito

```
git fetch origin
git log --oneline -3 origin/main     # tem que mostrar dc34e33 no topo
git merge origin/main
```

**Pronto quando:** o `git log -1` do seu `main` for `dc34e33` ou um merge dele descendente, e
`git status -sb` não mostrar ahead inesperado. **Não re-implemente** o boot-frio nem o botão: já
estão resolvidos e testados na tela.

## Tarefa 2 — o seu teste de contrato fica verde sem validar nada

`scripts/bridgeScriptAssert.ts`, linha ~78:

```ts
const python = process.env.PYTHON || join('..', 'venv', 'Scripts', 'python.exe');
```

Caminho Windows-only. Quando o arquivo não existe, a linha ~81 imprime `AVISO: py_compile não
rodou (...)` e **segue**, e a linha ~94 imprime `TUDO VERDE: … py_compile aceitou` sem nunca ter
olhado se aceitou. Rodado no Mac, deu exatamente isso: `sair=0` + banner verde + aviso de que o
compilador não rodou. Com `PYTHON=python3` o mesmo teste passou **de verdade** (1537 linhas,
`py_compile` aceitou) — ou seja, o template está são; o defeito é do teste.

Corrija para: Python ausente é **falha**, não aviso; o banner verde só lista o que foi checado de
fato; tente `process.env.PYTHON`, depois `python3`/`sys.executable`/`python`, nessa ordem. Você já
tem o instinto no arquivo ("prova de que este assert sabe falhar") — aplique o mesmo princípio na
escolha do interpretador.

**Pronto quando:** rodar o assert com um `PYTHON` inexistente retorna **não-zero**, e rodar com
Python real retorna zero sem a palavra "AVISO" na saída.

## Tarefa 3 — publicar o motor (precisa de um clique do Marcos)

O bot, o replay, a trava de execução e os testes `.py` existem em **um único disco** (este PC), sem
remote. Enquanto isso for verdade, nada do que você afirma sobre eles pode ser conferido do Mac —
foi assim que você descobriu o import sem guarda da seção F e o `list_local_pregoes()` injogável
fora do Windows, e o Mac não tem como repetir nenhuma das duas provas.

**Pronto quando:** existir repositório com os `.py` publicados e o Mac conseguir clonar e rodar a
suíte de testes daqui.

## Tarefa 4 — ponte nova, testada pela primeira vez

1. Baixe do app do Mac (aba **Guia** → Segurança da Ponte) o script **já atualizado** e traga para
   este PC. O app agora manda `SYNC_EA_CONFIG` e `LIST_LOCAL_PREGOES` ao conectar; o script velho
   não conhece nenhum dos dois.
2. Encerre **só** o processo que segura a porta: `netstat -ano | findstr :8765` → mata o PID.
3. Confira dependências: `python --version`, `pip show websockets MetaTrader5`.
4. Rode com a trava de ambiente ligada — ela fica **por cima** do Robô e não é reversível pela rede:
   `$env:ORDERS_BLOCKED="1"` antes de `python bot_mt5_convergencia_10r.py`, e deixe rodando.
5. Colete as respostas do bloco final deste arquivo.

**Pronto quando:** a ponte autentica, `requireToken` é `true`, e uma ordem é recusada **por causa
da trava**, não por erro de código.

## Por que o `ORDERS_BLOCKED=1` no primeiro teste

Você ganha as três provas na mesma rodada: handshake com token real, recusa de token errado, e
**impossibilidade material** de operar a conta — mesmo que alguém ligue o Robô no app. A ponte que
está rodando hoje aceita **qualquer** token (confirmado do Mac: `ok:true` para um token inventado),
então qualquer aparelho da rede operaria a conta logada. Esse é o buraco que a tarefa 4 fecha.

## O que o Marcos traz de volta para o Mac

```
1) IPv4 deste PC (ipconfig, linha "Endereço IPv4"):
2) Saída de netstat -ano | findstr :8765  (tem que mostrar 0.0.0.0:8765 LISTENING):
3) Últimas ~10 linhas da janela do script:
4) Login do MT5 é demo ou real? só o número, sem senha:
5) ORDERS_BLOCKED estava="1" quando você rodou? sim/não:
```

Com isso, do Mac eu: aponto o campo de endereço para o seu IP, confirmo `OPERA: OFF`, clico em
Conectar e valido `AUTH_RESULT ok:true` + `requireToken:true`, testo um token errado (deve morrer
em close 4001), e confirmo que a trava de ambiente aparece escrita em português na tela em vez de
um silêncio. Aí o `.py` é religado sem a trava, só quando todos esses quatro pontos estiverem
verdes.
