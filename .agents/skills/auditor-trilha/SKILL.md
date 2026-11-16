---
name: auditor-trilha
description: >-
  Auditar o pregão a partir da trilha de ordens (ordens_*_<dia>.csv): tentativas, fills,
  PnL por magic e divergência entre trilha e variação de saldo do extrato MT5.
---

# Auditor da trilha

Responder, com número na mão: o que o pregão fez, quem fez e quanto custou.

## Entrada

`data/` (ou a pasta de logs do dia) com `ordens_<ATIVO>_<dia>.csv` — um arquivo por ativo.
A trilha tem colunas de evento (`ENTRY`, `CLOSE_PARCIAL`, `CLOSE_POSITION`,
`SIMBOLO_INEXISTENTE`), `magic` e `position`.

## Procedimento

```bash
python auditar_pregao.py            # lê todos os ordens_*_<dia>.csv do dia
```

1. Confira que o script achou **todos** os arquivos do dia (glob por ativo, não um fixo).
   Se reportar 0 tentativas, o glob quebrou — não é "pregão parado".
2. Separe **tentativas** de **fills**: tentativa sem fill não é prejuízo, é recusa.
3. PnL por dono via `magic` da trilha: `102030` principal, `100001`/`100002` direcionais,
   `999999` boleta, `0` = fechamento feito no terminal.
4. Feche com a prova de consistência: soma do PnL da trilha **tem** que bater com a
   variação de saldo do extrato do dia.

## O que já foi medido (13/11/2026)

1.992 deals, −422,00 de variação de saldo, 480 tentativas / 408 fills.
Magic `0` respondeu por 7 negócios e −285,80 — saídas feitas no terminal, fora da trilha.

## Limites conhecidos

- Magic `0` aparece no extrato mas não tem dono na trilha: é limite dos dados, não do relatório.
- `999999` pode aparecer com PnL 0 quando a saída foi manual no terminal.

## Entrega

Números + o comando que rodou + o trecho de saída que sustenta a conclusão.
Se trilha e extrato não fecharem, diga o valor da diferença — não arredonde para "bateu".
