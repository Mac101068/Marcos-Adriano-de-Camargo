# Base de dados reais (MT5 / conta demo XP)

Baixada **nesta máquina** pela ponte WebSocket em `04/11/2026`, às 23:02–23:05 (horário de
Brasília), direto do MetaTrader 5 que roda no PC da Windows (`192.168.18.154:8765`).

## Arquivos

| arquivo | símbolo | ticks | pregões | período | faixa de preço | mediana |
|---|---|---|---|---|---|---|
| `mt5_real_WINZ26_2026-10-20_a_2026-11-04.json` | WINZ26 (mini índice) | 24.000 | 11 | 20/10 → 04/11 | 166.470 – 213.385 | 177.020 |
| `mt5_real_WDOZ26_2026-10-16_a_2026-11-04.json` | WDOZ26 (mini dólar) | 24.000 | 13 | 16/10 → 04/11 | 4.999 – 5.640 | 5.392 |

Formato: um envelope JSON com `exportadoEm`, `fonte`, `auditoria` (percentis, ticks por dia,
avisos) e o array `ticks`. Cada tick tem `id`, `timestamp` (ms UTC), `timeStr`, `price`,
`volume`, `aggressor`.

BTC **não** está aqui: o terminal logado devolveu `Zero barras de 'BTCZ26' nos últimos 10
dia(s)`, e a ponte não tem ação para listar símbolos — não dá para tentar outro nome às cegas.

## O que esta base NÃO é (leia antes de medir qualquer coisa)

1. **Volume não é volume de negociação.** `volumeSource` é `M1_RATE` nos dois ativos: ≥80% dos
   ticks chegaram com `volume = 0`, então a ponte preencheu cada tick com a taxa da série de
   1 minuto. CVD, delta e convergência derivados daqui são **aproximação**, não fluxo real.
2. **`aggressor` é inferido** de bid/ask, não do tape. WIN deu 12.200 BUY / 11.800 SELL — quase
   meia-metade, o que é o comportamento esperado de uma inferência, não de um agressor confirmado.
3. **Densidade de ~1 tick por minuto.** 2.260 ticks por pregão de WIN. O gerador sintético do app
   produz cerca de dez vezes isso. Renko de box pequeno (ex.: 5 pts no WDO) fica estrelado nesta
   base; box grande em R absorve bem.
4. **Descontinuidade no WIN:** salto de 31.025 pts entre 30/10 18:24 (208.240) e 03/11 09:03
   (177.215). Isso é falha do feed demo, não movimento de mercado — 18% em três dias. Qualquer
   métrica que cruze essa borda vem contaminada; para estudo contínuo, corte a série em 30/10.
5. **Buraco de feriado:** 5.195 minutos sem ticks entre 30/10 21:24 e 03/11 09:03 (02/11 = Finados,
   B3 fechado). Aqui o buraco é correto e deve ser tratado como fim de pregão, não como gap de
   liquidez.
6. **WDO só entrega pontos inteiros** (5.122, 5.392…), mas o tick do WDO é 0,5. O feed da demo
   está truncando a meia-variação: movimento de meio ponto não aparece. Movimentos finos de
   dólar estão subestimados nesta base.

## Como reproduzir o download (sem enviar ordem nenhuma)

A ponte exige autenticação antes de entregar dado. O segredo está em `fluxo_bridge_token_v1`
no `localStorage` do navegador que baixou o script `.py` — se o token tiver girado lá na
Windows, é preciso o mesmo valor aqui.

```js
const ws = new WebSocket('ws://192.168.18.154:8765');
ws.onopen = () => ws.send(JSON.stringify({ action: 'AUTH', token }));
// depois de AUTH_RESULT.ok === true:
ws.send(JSON.stringify({ action: 'REQUEST_HISTORY', reqId: 'x', symbol: 'WINZ26', days: 10 }));
// chega em HISTORY_CHUNK (1.500 ticks por frame) até HISTORY_DONE
```

Teto da ponte: `HISTORY_MAX_DAYS = 10` por pedido. `REQUEST_HISTORY` só lê dado de mercado e
nunca toca em ordem — e a ponte estava `armed: false` (EM SEGURO) durante todo o processo.

## Converter para CSV (Excel abre com `;`)

```
node -e "const d=require('./dados/mt5_real_WINZ26_2026-10-20_a_2026-11-04.json');const l=['timestamp;iso;timeStr;price;volume;aggressor'];d.ticks.forEach(t=>l.push([t.timestamp,new Date(t.timestamp).toISOString(),t.timeStr,t.price,t.volume,t.aggressor].join(';')));require('fs').writeFileSync('dados/Winz26.csv',l.join('\n'))"
```

## Estado do app

Nada do código foi alterado para gerar estes arquivos: a ponte respondeu pelo protocolo que o
app já usa (`marketHistoryService.ts`). O app em si **ainda não grava** histórico real em
disco — os ticks baixados por ele vivem só em memória e somem no F5. Este diretório é a base
versionada, obtida por fora, para estudo e replay.
