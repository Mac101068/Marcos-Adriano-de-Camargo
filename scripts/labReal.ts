/**
 * ============================================================================
 * LABORATÓRIO EM TICK REAL — Flow Quant MT5
 * ----------------------------------------------------------------------------
 * Mesmo motor e mesma contabilidade do `strategyLab.ts`, mas em vez de mercado
 * sintético come a FITA REAL do WINZ26 salva em `dados/` (24.000 ticks, 11
 * pregões, volume vindo de barra de 1 min — M1_RATE).
 *
 * O objetivo é comparar a Pirâmide de 10R com estratégias novas de gestão
 * sobre o MESMO dado, e calibrar os parâmetros que decidem o resultado.
 *
 * Nenhum caminho aqui toca a ponte, ordem real ou localStorage.
 * Executar: npx tsx scripts/labReal.ts
 * ============================================================================
 */

import { DEFAULT_EA_CONFIG } from '../src/services/eaConfigService';
import { AutomationConfig, Tick } from '../src/types/trading';
import { RenkoFlowEngine } from '../src/utils/renkoCalculator';
import { PaperStrategyBot, SeriesKey, PaperStats, PaperTrade } from '../src/utils/paperStrategyBot';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.join(SCRIPT_DIR, '..', 'dados', 'mt5_real_WINZ26_2026-10-20_a_2026-11-04.json');

const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
// A própria exportação avisa: entre 30/10 18:24 (208.240) e 03/11 09:03 (177.215) o feed demo
// deu um degrau de 31.025 pts que NÃO é movimento de mercado. Rodar estratégia em cima disso
// produz PnL fantástico e falso, então a série é cortada ali — estudo só do trecho contínuo.
const CORTE_MS = Date.parse('2026-10-30T18:24:00Z');
const TICKS: Tick[] = (raw.ticks as Tick[])
  .filter((t: Tick) => t.timestamp <= CORTE_MS)
  .slice()
  .sort((a, b) => a.timestamp - b.timestamp);
console.log(`\n  fita REAL WINZ26: ${TICKS.length} ticks, ${new Set(TICKS.map((t) => new Date(t.timestamp).toLocaleDateString('pt-BR'))).size} pregões`);

const cfg = (o: Partial<AutomationConfig>): AutomationConfig => ({ ...DEFAULT_EA_CONFIG, ...o });

interface Variant {
  id: string;
  label: string;
  points: number;
  seriesKey: SeriesKey;
  config: AutomationConfig;
}

// ---------------------------------------------------------------------------
// A ESTRATÉGIA NOVA: "PIRÂMIDE 10R · TP + SURFE, SEM VIRADA CEGA"
//
// O que mata a pirâmide original (ver csv do laboratório): o FLIP_REVERSAL.
// Todo box contrário zera a perna inteira e abre a oposta. Numa manhã sem
// tendência isso vira pingue-pongue pagando taxa em cada virada.
//
// A nova gestão muda três coisas, e só essas:
//   1. TP CURTO POR BOX (o pavio paga a taxa) e a ORDEM MÃE sobrevive à virada:
//      ela só é encerrada se o fluxo contra CONFIRMAR em N boxes.
//   2. A perna nova só nasce depois dessa confirmação — sinal contrário isolado
//      não abre nada.
//   3. Stop por tempo: perna que não andou em X boxes é encerrada a mercado.
// ---------------------------------------------------------------------------
const base = { boxPoints: 50, strategyMode: 'PYRAMID_FLOW_CONFLUENCE' as const, contracts: 1 };

// A CONTA DE TAXA QUE DECIDE TUDO (B3, WIN, 1 contrato):
//   emolumento + liquidação + registro + ISS ≈ R$ 1,00 por contrato por lado
//   → ida e volta ≈ R$ 2,00 = 10 pontos. Cada trade deste robô paga 10 pts.
//
// SENSO CRÍTICO ANTES DE ACREDITAR NESTE NÚMERO: a fita real disponível tem ~2.000 ticks por
// pregão (o feed da demo é comprimido). O robô real enxerga dezenas de milhares e o resultado
// prático será pior que o daqui. Este laboratório serve para COMPARAR gestões, não para
// prometer retorno.
const TAXA_PONTOS = 10;
const POINT_VALUE_POR_CONTRATO = 0.2; // WIN: R$ 0,20 por ponto por contrato

const VARIANTS: Variant[] = [
  {
    id: 'REF-PIRAMIDE-10R',
    label: 'REFERÊNCIA · Pirâmide 10R original (baseline)',
    points: 50, seriesKey: 'renko',
    config: cfg({ ...base, adaptiveThresholdEnabled: true }),
  },
  {
    id: 'NOVA-FLIP2-TP50',
    label: 'NOVA · virada só com 2 boxes + TP 50',
    points: 50, seriesKey: 'renko',
    config: cfg({ ...base, adaptiveThresholdEnabled: true, flipConfirmBoxes: 2, pyramidTpPoints: 50 }),
  },
  {
    id: 'NOVA-FLIP2-TP75',
    label: 'NOVA · virada só com 2 boxes + TP 75',
    points: 50, seriesKey: 'renko',
    config: cfg({ ...base, adaptiveThresholdEnabled: true, flipConfirmBoxes: 2, pyramidTpPoints: 75 }),
  },
  {
    id: 'NOVA-FLIP3-TP50',
    label: 'NOVA · virada só com 3 boxes + TP 50',
    points: 50, seriesKey: 'renko',
    config: cfg({ ...base, adaptiveThresholdEnabled: true, flipConfirmBoxes: 3, pyramidTpPoints: 50 }),
  },
  {
    id: 'NOVA-FLIP2-TP50-FIXO',
    label: 'NOVA · virada 2 boxes + TP 50 + limiar fixo',
    points: 50, seriesKey: 'renko',
    config: cfg({ ...base, adaptiveThresholdEnabled: false, flipConfirmBoxes: 2, pyramidTpPoints: 50 }),
  },
  {
    id: 'NOVA-FLIP2-TP50-LIMIT',
    label: 'NOVA · virada 2 boxes + TP 50 + pirâmide a LIMIT 50%',
    points: 50, seriesKey: 'renko',
    config: cfg({ ...base, adaptiveThresholdEnabled: true, flipConfirmBoxes: 2, pyramidTpPoints: 50, pyramidEntryType: 'BOX_50_LIMIT' }),
  },
  {
    id: 'NOVA-FLIP2-TP50-15R',
    label: 'NOVA · escala 15R (75 pts) + virada 2 boxes + TP 50',
    points: 75, seriesKey: 'renko15r',
    config: cfg({ ...base, boxPoints: 75, adaptiveThresholdEnabled: true, flipConfirmBoxes: 2, pyramidTpPoints: 50 }),
  },
  // ── REFINO DA VENCEDORA: a "virada 2 boxes + TP 50 + limiar fixo" foi a que ganhou em TODOS
  // os pregões com o melhor pior-dia. Aqui só se mexe no que ainda pode melhorar: alvo curto
  // (35/40), confirmação da virada (1/2/3) e distância do stop da pirâmide.
  {
    id: 'NOVA-FIXO-TP35',
    label: 'REFINO · limiar fixo · virada 2 · TP 35',
    points: 50, seriesKey: 'renko',
    config: cfg({ ...base, adaptiveThresholdEnabled: false, flipConfirmBoxes: 2, pyramidTpPoints: 35 }),
  },
  {
    id: 'NOVA-FIXO-TP40',
    label: 'REFINO · limiar fixo · virada 2 · TP 40',
    points: 50, seriesKey: 'renko',
    config: cfg({ ...base, adaptiveThresholdEnabled: false, flipConfirmBoxes: 2, pyramidTpPoints: 40 }),
  },
  {
    id: 'NOVA-FIXO-TP60',
    label: 'REFINO · limiar fixo · virada 2 · TP 60',
    points: 50, seriesKey: 'renko',
    config: cfg({ ...base, adaptiveThresholdEnabled: false, flipConfirmBoxes: 2, pyramidTpPoints: 60 }),
  },
  {
    id: 'NOVA-FIXO-TP50-FLIP1',
    label: 'REFINO · limiar fixo · virada 1 (sem espera) · TP 50',
    points: 50, seriesKey: 'renko',
    config: cfg({ ...base, adaptiveThresholdEnabled: false, flipConfirmBoxes: 1, pyramidTpPoints: 50 }),
  },
  // ── A ESCALA 15R NA GESTÃO VENCEDORA: o que o operador viu na tela e pediu para validar aqui.
  {
    id: 'NOVA-FIXO-TP50-15R-FLIP2',
    label: 'REFINO · virada 2 · TP 50 · limiar fixo · escala 15R (75 pts)',
    points: 75, seriesKey: 'renko15r',
    config: cfg({ ...base, boxPoints: 75, adaptiveThresholdEnabled: false, flipConfirmBoxes: 2, pyramidTpPoints: 50 }),
  },
  {
    id: 'NOVA-FIXO-TP50-15R-FLIP1',
    label: 'REFINO · virada 1 · TP 50 · limiar fixo · escala 15R (75 pts)',
    points: 75, seriesKey: 'renko15r',
    config: cfg({ ...base, boxPoints: 75, adaptiveThresholdEnabled: false, flipConfirmBoxes: 1, pyramidTpPoints: 50 }),
  },
  {
    id: 'NOVA-FIXO-TP50-15R-FLIP3',
    label: 'REFINO · virada 3 · TP 50 · limiar fixo · escala 15R (75 pts)',
    points: 75, seriesKey: 'renko15r',
    config: cfg({ ...base, boxPoints: 75, adaptiveThresholdEnabled: false, flipConfirmBoxes: 3, pyramidTpPoints: 50 }),
  },
  {
    id: 'NOVA-FIXO-TP50-FLIP3',
    label: 'REFINO · limiar fixo · virada 3 · TP 50',
    points: 50, seriesKey: 'renko',
    config: cfg({ ...base, adaptiveThresholdEnabled: false, flipConfirmBoxes: 3, pyramidTpPoints: 50 }),
  },
  {
    id: 'NOVA-FIXO-TP50-SL30',
    label: 'REFINO · limiar fixo · virada 2 · TP 50 · SL 30 da pirâmide',
    points: 50, seriesKey: 'renko',
    config: cfg({ ...base, adaptiveThresholdEnabled: false, flipConfirmBoxes: 2, pyramidTpPoints: 50, pyramidSlPoints: 30 }),
  },
  {
    id: 'NOVA-FIXO-TP50-BE',
    label: 'REFINO · limiar fixo · virada 2 · TP 50 · mãe no breakeven a cada TP',
    points: 50, seriesKey: 'renko',
    config: cfg({ ...base, adaptiveThresholdEnabled: false, flipConfirmBoxes: 2, pyramidTpPoints: 50, moveMainToBreakevenOnPyramidTp: true }),
  },
  // ── ACUMULAÇÃO POR SINAL (C/V): a leitura literal da tela. Abre 1 contrato a cada sinal,
  // acumula na mesma direção e só fecha TUDO no sinal oposto.
  {
    id: 'STACK-10R',
    label: 'ACUMULAÇÃO C/V · escala 10R · teto 15',
    points: 50, seriesKey: 'renko',
    config: cfg({ ...base, strategyMode: 'SIGNAL_STACK', maxSimultaneousPositions: 15 }),
  },
  {
    id: 'STACK-10R-SEM-BE',
    label: 'ACUMULAÇÃO C/V · 10R · só virada (breakeven desligado)',
    points: 50, seriesKey: 'renko',
    config: cfg({ ...base, strategyMode: 'SIGNAL_STACK', maxSimultaneousPositions: 15, breakevenTriggerPoints: 0, breakevenLockPoints: 0 }),
  },
  {
    id: 'STACK-10R-BE-300-200',
    label: 'ACUMULAÇÃO C/V · 10R · breakeven 300/200',
    points: 50, seriesKey: 'renko',
    config: cfg({ ...base, strategyMode: 'SIGNAL_STACK', maxSimultaneousPositions: 15, breakevenTriggerPoints: 300, breakevenLockPoints: 200 }),
  },
  {
    id: 'STACK-15R',
    label: 'ACUMULAÇÃO C/V · escala 15R · teto 15',
    points: 75, seriesKey: 'renko15r',
    config: cfg({ ...base, boxPoints: 75, strategyMode: 'SIGNAL_STACK', maxSimultaneousPositions: 15 }),
  },
  {
    id: 'STACK-10R-TETO5',
    label: 'ACUMULAÇÃO C/V · escala 10R · teto 5',
    points: 50, seriesKey: 'renko',
    config: cfg({ ...base, strategyMode: 'SIGNAL_STACK', maxSimultaneousPositions: 5 }),
  },
  {
    id: 'NOVA-FLIP2-TP50-20R',
    label: 'NOVA · escala 20R (100 pts) + virada 2 boxes + TP 50',
    points: 100, seriesKey: 'renko20r',
    config: cfg({ ...base, boxPoints: 100, adaptiveThresholdEnabled: true, flipConfirmBoxes: 2, pyramidTpPoints: 50 }),
  },
];

interface Agg {
  pnl: number; trades: number; wins: number; settled: number;
  grossProfit: number; grossLoss: number; maxDD: number; points: number;
  reasons: Record<string, { n: number; pnl: number }>;
  porDia: Map<string, number>;
}

function runVariant(v: Variant): Agg {
  const a: Agg = { pnl: 0, trades: 0, wins: 0, settled: 0, grossProfit: 0, grossLoss: 0, maxDD: 0, points: 0, reasons: {}, porDia: new Map() };
  const bot = new PaperStrategyBot(v.seriesKey);
  const eng = new RenkoFlowEngine(v.points);
  for (const t of TICKS) {
    const r = eng.processTick(t, v.config);
    for (const box of r.closedBoxes) bot.onClosedBox(box, box.orderDispatched, v.config);
  }
  const s: PaperStats = bot.getStats();
  const trades: PaperTrade[] = bot.getTrades();
  a.pnl = s.totalFinancial;
  a.points = s.totalPoints;
  a.trades = s.trades;
  a.wins = s.wins;
  a.settled = s.settled;
  a.grossProfit = s.grossProfit;
  a.grossLoss = s.grossLossVal;
  a.maxDD = s.maxDrawdown;
  // O PaperStrategyBot não cobra corretagem. Sem descontar, qualquer robô de giro alto parece
  // lucrativo — e é exatamente o número que engana na prática.
  const contratos = trades.reduce((acc, t) => acc + (t.contracts ?? 1), 0);
  a.pnl -= contratos * TAXA_PONTOS * POINT_VALUE_POR_CONTRATO;
  for (const tr of trades) {
    const key = tr.exitReason ?? 'OPEN';
    const rr = (a.reasons[key] = a.reasons[key] ?? { n: 0, pnl: 0 });
    rr.n += 1;
    rr.pnl += tr.financial ?? 0;
    const dia = new Date(tr.exitTime ?? tr.entryTime).toLocaleDateString('pt-BR');
    a.porDia.set(dia, (a.porDia.get(dia) ?? 0) + (tr.financial ?? 0));
  }
  return a;
}

const t0 = Date.now();
const results = VARIANTS.map((v) => ({ v, a: runVariant(v) }));
const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

const fmtR = (n: number) => `R$ ${n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pad = (s: string, n: number) => (s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length));

console.log(`\n  ${VARIANTS.length} estratégias × ${TICKS.length} ticks reais em ${elapsed}s\n`);
console.log(
  pad('ESTRATÉGIA', 46) + pad('PNL', 14) + pad('PF', 7) + pad('WIN%', 7) + pad('TRADES', 8) + pad('DD', 12) + 'SAÍDAS'
);
console.log('-'.repeat(130));
for (const { v, a } of results) {
  const pf = a.grossLoss > 0 ? a.grossProfit / a.grossLoss : a.grossProfit > 0 ? Infinity : 0;
  const wr = a.settled > 0 ? (100 * a.wins) / a.settled : 0;
  const top = Object.entries(a.reasons)
    .sort((x, y) => y[1].pnl - x[1].pnl)
    .slice(0, 3)
    .map(([k, r]) => `${k}:${r.n}`)
    .join(' ');
  console.log(
    pad(v.label, 46) +
      pad(fmtR(a.pnl), 14) +
      pad(pf === Infinity ? '∞' : pf.toFixed(2), 7) +
      pad(wr.toFixed(1), 7) +
      pad(String(a.trades), 8) +
      pad(fmtR(a.maxDD), 12) +
      top
  );
}

// detalhe das saídas de cada estratégia
console.log('\n  SAÍDAS POR ESTRATÉGIA (quantidade · resultado):');
for (const { v, a } of results) {
  const det = Object.entries(a.reasons)
    .sort((x, y) => y[1].pnl - x[1].pnl)
    .map(([k, r]) => `${k}: ${r.n}t (${fmtR(r.pnl)})`)
    .join(' | ');
  console.log(`  · ${v.id}: ${det || '(sem trades)'}`);
}

// DIA A DIA: a média esconde o que quebra na prática. Um robô que só ganha em 2 dos 9 dias
// não é melhor que um que ganha pouco em 7 — é uma aposta.
console.log('\n  RESULTADO POR PREGÃO (R$) — verde/vermelho por dia:');
const dias = [...new Set(results.flatMap(({ a }) => [...a.porDia.keys()]))].sort((x, y) =>
  x.split('/').reverse().join('').localeCompare(y.split('/').reverse().join(''))
);
const top3 = results.slice().sort((x, y) => y.a.pnl - x.a.pnl).slice(0, 3);
console.log(pad('ESTRATÉGIA', 30) + dias.map((d) => pad(d, 10)).join(''));
for (const { v, a } of top3) {
  console.log(
    pad(v.id, 30) + dias.map((d) => pad(fmtR(a.porDia.get(d) ?? 0).replace('R$ ', ''), 10)).join('')
  );
}
console.log('\n  DIAS POSITIVOS (de ' + dias.length + '):');
for (const { v, a } of results) {
  const pos = dias.filter((d) => (a.porDia.get(d) ?? 0) > 0).length;
  console.log(`  · ${pad(v.id, 26)} ${pos}/${dias.length} dias positivos · pior dia ${fmtR(Math.min(...dias.map((d) => a.porDia.get(d) ?? 0)))}`);
}

const winner = results.reduce((best, cur) => (cur.a.pnl > best.a.pnl ? cur : best), results[0]);
console.log(`\n  MELHOR NO DADO REAL: ${winner.v.label} → ${fmtR(winner.a.pnl)} em ${winner.a.trades} trades\n`);
