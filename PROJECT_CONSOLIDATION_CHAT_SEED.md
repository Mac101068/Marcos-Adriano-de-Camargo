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
  (ponto de retomada mais recente: **Ciclo 14, commit `23cb03f`**).
- **`CHAT_SEED_CICLO_14.md`** — seed do ciclo mais recente: resumo da evolução até a **Fase A**
  (estratégia como banco de dados único, um só editor de parâmetros, telas em lista colapsável e régua de
  tempo dentro do gráfico) e a **lista de tarefas da próxima conversa** com critério de pronto. Pode ser
  colado depois do `CHAT_SEED.md` ou sozinho, quando o contexto já estiver quente.
- **`CHAT_SEED_CICLO_10.md`** — seed do Ciclo 10 (Robô 2 / sombra). Mantido como **histórico**; não é
  mais o ponto de retomada.

Este arquivo (`PROJECT_CONSOLIDATION_CHAT_SEED.md`) passa a ser apenas o ponteiro/índice; não mantenha
cópias do prompt nos dois lugares — edite só o `CHAT_SEED.md`.
