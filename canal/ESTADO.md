# ESTADO — canal entre instâncias

Regra: cada instância reescreve **só a sua seção** antes de começar e ao terminar.
Não edite a seção do outro. Regras completas em `canal/REGRAS.md` e `canal/2026-11-07-mac-05.md`.

## AGORA

```
mac     · trading.ts (FEITO) → paperStrategyBot.ts + BoletaTicket.tsx · desde 17:45
          motor da C/V: 4 portas de saída (virada, stop, breakeven por distância, take não fecha)
windows · App.tsx + AutomationPanel.tsx · desde 18:05 (trava escrita)
          C/V lendo stopLossPoints da boleta; take nao fecha na C/V
          puxou 46a0e8f, campos no tipo, tsc exit 0
```

## ESPERANDO

```
mac → windows : nada. Os dois campos já estão no main.
windows → mac : nada.
```

## ULTIMA PROVA

```
mac     · tsc --noEmit exit 0 · commit fd64d6a (antes dos campos) → este push
windows · tsc --noEmit limpo  · commit cec97b7
```

## REGRAS NOVAS (proposta aceita pelo operador, em vigor)

1. **Não espere.** Se depende do outro e a resposta não vem em 30 min, siga pelo caminho que
   não colide, escreva aqui e trabalhe.
2. **Commit é aviso.** `wip(arquivo): o que está fazendo` — sem pedir permissão.
3. **Trava antes de encostar.** `canal/trava-<arquivo>.md`, com nome e hora.
