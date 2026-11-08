# ESTADO — canal entre instâncias

Regra: cada instância reescreve **só a sua seção** antes de começar e ao terminar.
Não edite a seção do outro. Regras completas em `canal/REGRAS.md`, `canal/2026-11-07-mac-05.md`
e `canal/2026-11-07-windows-05.md` (as quatro regras duras: dono decide, pergunta só se muda o
código, fato do operador se registra, 15 min e assume).

## AGORA

```
mac     · IDLE. Motor da C/V entregue e no main (1156eee). Aguardando o JSON do simulador
          do operador para ler o resultado do dólar.
windows · App.tsx + realTapeService.ts + roundAuditService.ts
          Inconsistência WIN/WDO blindada: isolamento de banco de fita por ativo,
          limpeza de robôs/coletor na troca de ativo e sanitizador de cotação no ledger.
```

## FEITO E NO MAIN (para não pedirmos de novo)

```
1156eee  motor C/V: stop + breakeven por distancia (4 portas)          [mac]
5d13cf4  breakeven desligado por padrao (0/0) — 150/100 custava 81%    [windows]
350fe0a  botao unico de exportar rodadas+ordens+fita em JSON           [windows]
9477e48  preset C/V calibrado para o Mini Dolar (WDO)                  [mac]
46a0e8f  campos breakevenTrigger/Lock + ESTADO.md                      [mac]
```

## ESPERANDO

```
mac → windows : nada
windows → mac : nada
operador      : anexar o JSON exportado do simulador (C/V no dólar)
```

## ULTIMA PROVA

```
mac     · tsc --noEmit exit 0 · vite build OK · 350fe0a
windows · tsc --noEmit exit 0 · 350fe0a
ponte   · 192.168.18.154:8765 AUTH OK, conta XP 50534540, armed:false
```

## REGISTRO DE FATO DO OPERADOR (regra 3 — não reabrir, só registrar)

- **07/11 · stop na C/V:** hoje a C/V sai só na virada. Stop é opcional e vem da boleta, para
  ligar se aparecer perda grande. Take não fecha na C/V.
- **07/11 · breakeven:** "deixe uma brecha para o breakeven que com 150 pontos já garante 100".
  Medido depois: custa 81% do resultado da C/V. **Padrão 0/0 (desligado)**, disponível na boleta.
  O operador ainda não viu esse número — está no simulador agora.
- **07/11 · padronização:** a boleta é a fonte única. Nada fixo no código: "nada é fixo no
  mercado".
- **07/11 · dólar:** quer a C/V nos mesmos moldes, calibrada para o WDO. Feito em `9477e48`,
  **não validado em dado real**.
