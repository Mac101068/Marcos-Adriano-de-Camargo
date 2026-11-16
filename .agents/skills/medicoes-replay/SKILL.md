---
name: medicoes-replay
description: >-
  Medir hipótese de estratégia na fita real (data/pregoes/*.csv.gz) antes de mexer no motor:
  taxa de sinal, PnL em pontos, efeito de filtro, sem baixar tick novo e sem ordem real.
---

# Medições em replay

Nenhuma mudança de regra entra no motor por intuição. Primeiro mede, depois decide.

## Regras

- Fonte é a fita local: `data/pregoes/winz26_ticks_*.csv.gz` (WIN), `wdoz26_*`, `bitx26_*`.
  46 arquivos, ~22 dias úteis entre set e nov. **Não baixar tick novo.**
- Janela de pregão sempre explícita: `--inicio 08:55 --fim 18:00` (padrão dos scripts).
  A fita de 04/11 começa às 08:50 — janela mal escolhida dá 0 negócio e parece bug.
- Replay não envia ordem: `REPLAY_MODE` trava a execução.

## Duas réguas

```bash
# 1) taxa de sinal: quantos candidatos passam em cada variação de regra
python avaliar_filtro_fluxo.py

# 2) resultado: negócios, pontos e quantos foram evitados
python medir_filtro_replay.py --dias 22 --inicio 08:55 --fim 18:00
```

`medir_filtro_replay.py` opera com SL 50 / TP 100 / saída por FLIP e separa
**matados** de **mantidos** — é essa separação que mostra se o filtro tira prejuízo
ou só reduz volume.

## O que já foi medido (22 dias)

| Cenário | Negócios | Pontos |
|---|---|---|
| Sem filtro de tendência | 861 | −1.650 |
| Com filtro (CVD 20 boxes) | 622 | −350 |

Dos 861 originais: 246 matados = −1.650 pontos; 615 mantidos = 0,0 exato; 0 saídas por FLIP.
Leitura correta: o filtro **corta o prejuízo**, não cria vantagem — o conjunto mantido
fica no zero a zero com 33% de acerto para alvo 100 / stop 50.

## Entrega

Tabela com cenário × negócios × pontos, o comando exato e o período coberto. Se a medição
não terminou (log sem bloco TOTAL), diga que não terminou — não estime o total.
