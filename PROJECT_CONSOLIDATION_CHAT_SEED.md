# 🚀 PROMPT MESTRE DE CONTINUIDADE & CONSOLIDAÇÃO DO PROJETO
## Para migração / inicialização em um Novo Bate-Papo (Chat Seed)

> **Instruções ao Usuário**: para continuar este projeto em um bate-papo novo sem perder contexto, cole o
> conteúdo do arquivo **`CHAT_SEED.md`** (na raiz do repositório) como primeira mensagem.
> O estado atual detalhado está em `PROJECT_SUMMARY.md` e o "porquê" de cada decisão está em `EVOLUCOES_DETALHADAS.md` — o assistente deve ler os dois.

---

## Onde está o prompt

O bloco de contexto de continuidade (antes duplicado aqui entre cercas `\`\`\`` escapadas, que quebravam
a renderização do Markdown por causa das cercas aninhadas `text`/`bash`) agora vive **em Markdown limpo e
renderizável** em:

- **`CHAT_SEED.md`** — arquivo único, pronto para copiar e colar inteiro em um bate-papo novo
  (ponto de retomada mais recente: **Ciclo 16, commit `917cb76`**).
- **`CHAT_SEED_CICLO_16.md`** — seed do ciclo mais recente: **funil afrouxado por bench (A/B/D/Δ com
  migrações guardadas + toast)**, **Renko sem gaps (`closedBoxes`)**, **ponte que explica a recusa
  (`ORDER_RESULT`)** e **veredito da base real (`eaBaseReal` — M1_RATE = não-calibrável)**. Traz a lista de
  tarefas da próxima conversa (começa por **restabelecer a conexão MT5** e **ler o toast `ORDER_RESULT`**
  com o `.py` novo) e o critério de pronto. Pode ser colado depois do `CHAT_SEED.md` ou sozinho.
- **`CHAT_SEED_CICLO_15.md`** — seed do Ciclo 15 (Livro de Rodadas + fluxo que adianta + Filtro de
  Acumulação (ER) no funil do EA). Mantido como **histórico**; não é mais o ponto de retomada.
- **`CHAT_SEED_CICLO_14.md`** — seed da FASE A (estratégia como banco de dados único, um só editor, telas em
  lista colapsável e régua X no gráfico). Mantido como **histórico**; não é mais o ponto de retomada.
- **`CHAT_SEED_CICLO_10.md`** — seed do Ciclo 10 (Robô 2 / sombra). Mantido como **histórico**; não é
  mais o ponto de retomada.

Este arquivo (`PROJECT_CONSOLIDATION_CHAT_SEED.md`) passa a ser apenas o ponteiro/índice; não mantenha
cópias do prompt nos dois lugares — edite só o `CHAT_SEED.md`.
