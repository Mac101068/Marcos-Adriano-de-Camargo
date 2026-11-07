# PONTE MT5 — PASSO A PASSO (07/11/2026)

Tudo no PC do Windows. Nada aqui precisa de programação — é copiar, colar e clicar.

---

## PASSO 1 — Baixar o arquivo novo da ponte

No PC do Windows, abra o navegador e vá em:

    https://github.com/Mac101068/Marcos-Adriano-de-Camargo

1. Clique no botão verde **Code** → **Download ZIP**
2. Extraia o ZIP (botão direito → Extrair tudo)
3. Dentro da pasta extraída, procure o arquivo **`ponte_mt5.py`**

> Se já existir um `ponte_mt5.py` antigo no seu PC: **renomeie o antigo** para
> `ponte_mt5_ANTIGO.py`. Não apague — só tire do caminho.

---

## PASSO 2 — Conferir se a chave está certa

1. Clique com o botão direito no `ponte_mt5.py` → **Abrir com** → **Bloco de Notas**
2. Aperte **Ctrl + F** e procure por: `AUTH_TOKEN`
3. A linha deve estar exatamente assim:

    AUTH_TOKEN = "fluxo-renko-ponte-2026-chave-fixa-marcos"

Se estiver igual, **feche sem salvar**. Se estiver diferente ou vazia, pare e me avise.

---

## PASSO 3 — Instalar o que o script precisa (uma vez só)

1. Abra o **Prompt de Comando** (tecla Windows → digite `cmd` → Enter)
2. Cole esta linha e aperte Enter:

    pip install MetaTrader5 websockets

3. Espere terminar. Se aparecer "Requirement already satisfied", também está certo.

---

## PASSO 4 — Liberar a porta no firewall (uma vez só)

**Esta é a parte que faz a conexão falhar mesmo com a chave certa.**

1. Tecla Windows → digite `PowerShell`
2. Clique com o botão direito em **Windows PowerShell** → **Executar como administrador**
3. Cole esta linha inteira e aperte Enter:

    New-NetFirewallRule -DisplayName "Ponte MT5 8765" -Direction Inbound -LocalPort 8765 -Protocol TCP -Action Allow

4. Deve aparecer uma tabela com o nome "Ponte MT5 8765". Se aparecer erro em vermelho, me mande o texto.

---

## PASSO 5 — Descobrir o endereço do PC

Ainda no Prompt de Comando, digite:

    ipconfig

Procure a linha **"Endereço IPv4"** (ou "IPv4 Address"). Vai ser algo tipo `192.168.0.15`.
**Anote esse número** — é o que você digita no app do Mac.

---

## PASSO 6 — Ligar a ponte

1. **Confirme que o MT5 está aberto e logado** na conta demo XP
2. No Prompt de Comando, vá até a pasta onde está o arquivo:

    cd C:\caminho\ate\a\pasta

   (dica: digite `cd ` com espaço, depois arraste a pasta para dentro da janela do cmd — ele preenche sozinho)
3. Rode:

    python ponte_mt5.py

4. Vai aparecer uma mensagem dizendo que está escutando na porta 8765.
   **Deixe essa janela aberta** — se fechar, a ponte cai.

> Se o Windows perguntar sobre acesso de rede, clique em **Permitir**.

---

## PASSO 7 — Conectar do Mac

No app, aba **Documentação**:

- **MT5 Host**: o IP anotado no Passo 5 (ex.: `192.168.0.15`)
- **Porta**: `8765`
- Clique em **Conectar ao MT5**

Se conectar, aparece **CONNECTED**. Se der **AUTH RECUSADO**, o arquivo em uso ainda é o
antigo — volte ao Passo 1. Se ficar em "Conectando…" para sempre, o firewall não foi
liberado — volte ao Passo 4.

---

## Para me dizer se funcionou

Me manda só isto:

1. A linha do Passo 2 (a chave) — **sem o valor**, só "está igual" ou "está diferente"
2. O IP do Passo 5
3. O que apareceu na tela do app: CONNECTED, AUTH RECUSADO ou travado
