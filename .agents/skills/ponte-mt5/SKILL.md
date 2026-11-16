---
name: ponte-mt5
description: >-
  Subir, reiniciar e diagnosticar a ponte WebSocket do MT5 (bot_mt5_ciclo15.py, porta 8765),
  com a trava ORDERS_BLOCKED sempre ligada, e conferir a sincronização das regras com a tela.
---

# Ponte MT5

A ponte é o próprio `bot_mt5_ciclo15.py`: WebSocket em `ws://0.0.0.0:8765` (`WS_PORT`)
**e** motor de decisão no mesmo processo.

## Subir do jeito seguro

```powershell
powershell -File _reiniciar_ponte.ps1     # linha 12: $env:ORDERS_BLOCKED = '1'
```

Nunca `python bot_mt5_ciclo15.py` na mão. No código a variável tem default `"0"`
(linha 509) — quem trava é o lançador. Subir na mão é subir destravado.

## Conferir que subiu

1. Porta 8765 respondendo.
2. Log com a linha de sincronização:
   `REGRAS DO SINAL SINCRONIZADAS COM A TELA: flow_trend_filter=True`.
   Se vier `False`, a aba do navegador está com config antiga — um F5 na tela resolve.
3. Conta logada é a demo `50534540 (XPMT5-DEMO)`.

## Reiniciar sem se matar

- Descubra o PID que **detém a porta 8765** e mate só ele.
- **Nunca** `pkill -f` / `taskkill /T` por nome: a linha de comando do próprio agente contém
  as mesmas palavras e você derruba a sessão junto.
- `cmd /c start` e kill de árvore costumam travar nesta máquina.

## Diário de eventos

Motivos de recusa relevantes: `BLOQUEADO_POR_TRABALHO`, `BLOQUEADO_POR_HORARIO`,
`CALADO_TENDENCIA_FLUXO` (filtro de fluxo barrou o lado), `SIMBOLO_INEXISTENTE`.
Recusa com motivo é comportamento correto, não erro.

## Entrega

Estado final: PID, porta, trava (`ORDERS_BLOCKED`), conta, e a linha de sync copiada do log.
