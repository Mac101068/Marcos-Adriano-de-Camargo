/**
 * ============================================================================
 * LABORATÓRIO DE ESTRATÉGIAS (headless) — Flow Quant MT5
 * ----------------------------------------------------------------------------
 * Roda variações das duas estratégias reais do terminal (PULLBACK_RETEST e
 * PYRAMID_FLOW_CONFLUENCE) sobre o MESMO motor de contabilidade do coletor
 * (PaperStrategyBot) e o MESMO avaliador de convergência (shared evaluator),
 * usando o simulador B3 equilibrado (~40% alta / ~40% baixa / ~20% lateral).
 *
 * Desenho do experimento:
 *   - 5 réplicas independentes × 10 dias úteis cada (≈50 pregões por variação)
 *   - cada réplica gera ticks com RNG semeado e todas as variações comem os
 *     MESMOS ticks (comparação justa)
 *   - contratos: 1 (Pirâmide, sem parcial) ou 2 (variações com saída parcial)
 *   - veredito por expectativa (R$/trade), fator de lucro e consistência entre
 *     réplicas — negativo = DESCARTAR
 *
 * Nenhum caminho deste script toca a ponte MT5, ordens reais ou localStorage.
 * Executar:  node_modules/.bin/tsx scripts/strategyLab.ts
 * Saída:    tabela no terminal + scripts/strategy_lab_results.csv (padrão BR)
 * ============================================================================
 */

import { DEFAULT_EA_CONFIG } from '../src/services/eaConfigService';
import { AutomationConfig, Tick } from '../src/types/trading';
import { RenkoFlowEngine } from '../src/utils/renkoCalculator';
import { RangeBarEngine, TimeBarEngine } from '../src/utils/barEngines';
import { evaluateBoxConvergence } from '../src/utils/convergenceEvaluator';
import { PaperStrategyBot, SeriesKey, PaperStats, PaperTrade } from '../src/utils/paperStrategyBot';
import { generateHistoricalTicks } from '../src/utils/marketSimulator';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Configuração do lote
// ---------------------------------------------------------------------------
const REPLICAS = 5; // réplicas independentes (RNG semeado por réplica)
const DAYS_PER_REPLICA = 10; // gerador do simulador entrega no máximo 10 dias por chamada

// RNG determinística (mulberry32) — só durante a GERAÇÃO de ticks; os motores e
// o bot são 100% determinísticos, então a comparação entre variações é justa.
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function generateSeeded(seed: number): Tick[] {
  const realRandom = Math.random;
  Math.random = mulberry32(seed);
  try {
    return generateHistoricalTicks(DAYS_PER_REPLICA);
  } finally {
    Math.random = realRandom;
  }
}

// ---------------------------------------------------------------------------
// Definição das variações
// ---------------------------------------------------------------------------
type EngineKind = 'renko' | 'range' | 'tempo';

interface Variant {
  id: string;
  label: string;
  group: string;
  engine: EngineKind;
  seriesKey: SeriesKey;
  points?: number; // renko/range
  intervalMs?: number; // tempo
  config: AutomationConfig;
}

const cfg = (o: Partial<AutomationConfig>): AutomationConfig => ({ ...DEFAULT_EA_CONFIG, ...o });

// Bloco de gestão do Reteste clássico (parcial → breakeven → trailing)
const RETEST_MGMT: Partial<AutomationConfig> = {
  strategyMode: 'PULLBACK_RETEST',
  stopLossPoints: 100,
  takeProfitPoints: 150,
  enablePartialExit: true,
  partialPoints: 50,
  partialContracts: 1,
  moveStopToBreakevenOnPartial: true,
  trailingStop: true,
  contracts: 2, // 2 contratos quando há parcial (1 realizado + 1 corrido)
};

const VARIANTS: Variant[] = [
  // ===== PIRÂMIDE & CONFLUÊNCIA (1 contrato, sem parcial) =====
  {
    id: 'PIR-10R-ADAPT', label: 'Pirâmide 10R · limiar ADAPTATIVO (baseline)', group: 'Pirâmide',
    engine: 'renko', seriesKey: 'renko', points: 50,
    config: cfg({ boxPoints: 50, strategyMode: 'PYRAMID_FLOW_CONFLUENCE', adaptiveThresholdEnabled: true, contracts: 1 }),
  },
  {
    id: 'PIR-10R-FIXO', label: 'Pirâmide 10R · limiar FIXO (adaptativo OFF)', group: 'Pirâmide',
    engine: 'renko', seriesKey: 'renko', points: 50,
    config: cfg({ boxPoints: 50, strategyMode: 'PYRAMID_FLOW_CONFLUENCE', adaptiveThresholdEnabled: false, contracts: 1 }),
  },
  {
    id: 'PIR-10R-LIMIT50', label: 'Pirâmide 10R · pirâmides a LIMIT 50% do box', group: 'Pirâmide',
    engine: 'renko', seriesKey: 'renko', points: 50,
    config: cfg({ boxPoints: 50, strategyMode: 'PYRAMID_FLOW_CONFLUENCE', pyramidEntryType: 'BOX_50_LIMIT', contracts: 1 }),
  },
  {
    id: 'PIR-15R-ADAPT', label: 'Pirâmide 15R (75 pts) · adaptativo', group: 'Pirâmide · escala',
    engine: 'renko', seriesKey: 'renko15r', points: 75,
    config: cfg({ boxPoints: 75, strategyMode: 'PYRAMID_FLOW_CONFLUENCE', contracts: 1 }),
  },
  {
    id: 'PIR-20R-ADAPT', label: 'Pirâmide 20R (100 pts) · adaptativo', group: 'Pirâmide · escala',
    engine: 'renko', seriesKey: 'renko20r', points: 100,
    config: cfg({ boxPoints: 100, strategyMode: 'PYRAMID_FLOW_CONFLUENCE', contracts: 1 }),
  },
  {
    id: 'PIR-RANGE50', label: 'Pirâmide RANGE 50 pts · adaptativo', group: 'Pirâmide · escala',
    engine: 'range', seriesKey: 'range', points: 50,
    config: cfg({ boxPoints: 50, strategyMode: 'PYRAMID_FLOW_CONFLUENCE', contracts: 1 }),
  },
  {
    id: 'PIR-TEMPO3M', label: 'Pirâmide TEMPO 3 min · adaptativo', group: 'Pirâmide · escala',
    engine: 'tempo', seriesKey: 'tempo', intervalMs: 180000,
    config: cfg({ boxPoints: 50, strategyMode: 'PYRAMID_FLOW_CONFLUENCE', contracts: 1 }),
  },

  // ===== RETESTE / PULLBACK (2 contratos quando há parcial) =====
  {
    id: 'RET-FECH-MERC', label: 'Reteste a MERCADO no fechamento (controle p/ as limitadas)', group: 'Reteste',
    engine: 'renko', seriesKey: 'renko', points: 50,
    config: cfg({ boxPoints: 50, ...RETEST_MGMT, entryTriggerType: 'MARKET_ON_CLOSE', adaptiveThresholdEnabled: true }),
  },
  {
    id: 'RET-ABERT-ADAPT', label: 'Reteste institucional · LIMIT na abertura · adaptativo', group: 'Reteste',
    engine: 'renko', seriesKey: 'renko', points: 50,
    config: cfg({ boxPoints: 50, ...RETEST_MGMT, entryTriggerType: 'PULLBACK_ENTRY', pullbackTarget: 'BOX_OPEN', adaptiveThresholdEnabled: true }),
  },
  {
    id: 'RET-ABERT-FIXO', label: 'Reteste institucional · LIMIT na abertura · limiar FIXO', group: 'Reteste',
    engine: 'renko', seriesKey: 'renko', points: 50,
    config: cfg({ boxPoints: 50, ...RETEST_MGMT, entryTriggerType: 'PULLBACK_ENTRY', pullbackTarget: 'BOX_OPEN', adaptiveThresholdEnabled: false }),
  },
  {
    id: 'RET-ABERT-CVD', label: 'Reteste institucional · abertura + CVD novo extremo', group: 'Reteste',
    engine: 'renko', seriesKey: 'renko', points: 50,
    config: cfg({ boxPoints: 50, ...RETEST_MGMT, entryTriggerType: 'PULLBACK_ENTRY', pullbackTarget: 'BOX_OPEN', requireCvdNewExtreme: true }),
  },
  {
    id: 'RET-50PCT', label: 'Reteste a 50% do box (25 pts) · adaptativo', group: 'Reteste',
    engine: 'renko', seriesKey: 'renko', points: 50,
    config: cfg({ boxPoints: 50, ...RETEST_MGMT, entryTriggerType: 'PULLBACK_ENTRY', pullbackTarget: 'BOX_50_PCT', pullbackCustomPoints: 25 }),
  },
  {
    id: 'SCALP-Δ150', label: 'Scalper a mercado · Δ150 · alvo/stop 75 pts', group: 'Reteste',
    engine: 'renko', seriesKey: 'renko', points: 50,
    config: cfg({
      boxPoints: 50, ...RETEST_MGMT, entryTriggerType: 'MARKET_ON_CLOSE',
      stopLossPoints: 75, takeProfitPoints: 75, partialPoints: 35, minDeltaThreshold: 150,
    }),
  },
  {
    id: 'TRND-20R', label: 'Trend Follower 20R · LIMIT 50% (50 pts) · SL 300 / TP 500', group: 'Reteste · escala',
    engine: 'renko', seriesKey: 'renko20r', points: 100,
    config: cfg({
      boxPoints: 100, ...RETEST_MGMT, entryTriggerType: 'PULLBACK_ENTRY', pullbackTarget: 'BOX_50_PCT', pullbackCustomPoints: 50,
      stopLossPoints: 300, takeProfitPoints: 500, partialPoints: 250, trailingActivationPoints: 300, trailingDistancePoints: 200,
      pullbackMaxBoxesWait: 4,
    }),
  },
];

// ---------------------------------------------------------------------------
// Execução
// ---------------------------------------------------------------------------
interface Agg {
  pnl: number;
  points: number;
  trades: number;
  wins: number;
  settled: number;
  grossProfit: number;
  grossLoss: number;
  maxDD: number;
  openCount: number;
  unrealized: number;
  repPnl: number[];
  reasons: Record<string, { n: number; pnl: number }>;
}

const mkAgg = (): Agg => ({
  pnl: 0, points: 0, trades: 0, wins: 0, settled: 0, grossProfit: 0, grossLoss: 0,
  maxDD: 0, openCount: 0, unrealized: 0, repPnl: [], reasons: {},
});

const aggs: Record<string, Agg> = {};
VARIANTS.forEach((v) => (aggs[v.id] = mkAgg()));

function runVariant(v: Variant, ticks: Tick[], statsOut: (s: PaperStats, trades: PaperTrade[]) => void) {
  const bot = new PaperStrategyBot(v.seriesKey);
  if (v.engine === 'renko') {
    const eng = new RenkoFlowEngine(v.points ?? 50);
    for (const t of ticks) {
      const r = eng.processTick(t, v.config);
      if (r.newBoxClosed && r.closedBox) bot.onClosedBox(r.closedBox, r.signal, v.config);
    }
  } else {
    const eng = v.engine === 'range' ? new RangeBarEngine(v.points ?? 50) : new TimeBarEngine(v.intervalMs ?? 180000);
    eng.getRegimeMeter().setLookbackBoxes(v.config.regimeLookbackBoxes ?? 20);
    for (const t of ticks) {
      const r = eng.processTick(t);
      if (r.newBarClosed && r.closedBox) {
        const boxes = eng.getBoxes();
        const conv = evaluateBoxConvergence(r.closedBox, v.config, boxes.slice(0, -1), {}, eng.getRegimeMeter());
        bot.onClosedBox(r.closedBox, conv.signal, v.config);
      }
    }
  }
  statsOut(bot.getStats(), bot.getTrades());
}

const t0 = Date.now();
for (let rep = 0; rep < REPLICAS; rep++) {
  const ticks = generateSeeded(1000 + rep * 7919); // mesmos ticks para TODAS as variações
  for (const v of VARIANTS) {
    runVariant(v, ticks, (s, trades) => {
      const a = aggs[v.id];
      a.pnl += s.totalFinancial;
      a.points += s.totalPoints;
      a.trades += s.trades;
      a.wins += s.wins;
      a.settled += s.settled;
      a.grossProfit += s.grossProfit;
      a.grossLoss += s.grossLossVal;
      a.maxDD = Math.max(a.maxDD, s.maxDrawdown); // DD por réplica (pior réplica)
      a.openCount = s.openCount;
      a.unrealized = s.unrealized;
      a.repPnl.push(s.totalFinancial);
      for (const tr of trades) {
        const key = tr.exitReason ?? 'OPEN';
        const rr = (a.reasons[key] = a.reasons[key] ?? { n: 0, pnl: 0 });
        rr.n += 1;
        rr.pnl += tr.financial ?? 0;
      }
    });
  }
  process.stdout.write(`\r  réplica ${rep + 1}/${REPLICAS} concluída   `);
}
const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
console.log(`\n  ✔ ${VARIANTS.length} variações × ${REPLICAS} réplicas × ${DAYS_PER_REPLICA} dias em ${elapsed}s\n`);

// ---------------------------------------------------------------------------
// Veredito
// ---------------------------------------------------------------------------
function verdict(a: Agg): { tag: string; why: string } {
  const pf = a.grossLoss > 0 ? a.grossProfit / a.grossLoss : a.grossProfit > 0 ? Infinity : 0;
  const exp = a.settled > 0 ? a.pnl / a.settled : 0;
  const posReps = a.repPnl.filter((p) => p > 0).length;
  if (a.pnl <= 0 || exp <= 0 || pf < 1.0) return { tag: 'DESCARTAR', why: 'PnL/expectativa negativos ou PF < 1,00' };
  if (pf >= 1.3 && posReps >= 4) return { tag: 'LUCRATIVA ✓', why: 'PF ≥ 1,3 e ≥ 4/5 réplicas positivas' };
  return { tag: 'MARGINAL', why: 'positiva mas PF < 1,3 ou inconsistente entre réplicas' };
}

const fmtR = (v: number) => `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const rows = VARIANTS.map((v) => {
  const a = aggs[v.id];
  const pf = a.grossLoss > 0 ? a.grossProfit / a.grossLoss : a.grossProfit > 0 ? Infinity : 0;
  const wr = a.settled > 0 ? (100 * a.wins) / a.settled : 0;
  const exp = a.settled > 0 ? a.pnl / a.settled : 0;
  const vd = verdict(a);
  return { v, a, pf, wr, exp, ...vd };
}).sort((x, y) => y.exp - x.exp);

// Tabela no terminal
const W = { id: 15, label: 56, pnl: 14, pf: 7, exp: 11, wr: 7, tr: 6, dd: 12, rep: 7, tag: 12 };
const line = (c: string) => '─'.repeat(W.id + W.label + W.pnl + W.pf + W.exp + W.wr + W.tr + W.dd + W.rep + W.tag + 9);
console.log(line('─'));
console.log(
  'VARIAÇÃO'.padEnd(W.id) + 'DESCRIÇÃO'.padEnd(W.label) + 'PnL 50d'.padStart(W.pnl) +
  'PF'.padStart(W.pf) + 'EXPECT.'.padStart(W.exp) + 'WR%'.padStart(W.wr) + 'TRDS'.padStart(W.tr) +
  'MAX DD'.padStart(W.dd) + 'REP+'.padStart(W.rep) + 'VEREDITO'.padStart(W.tag + 1)
);
console.log(line('─'));
for (const r of rows) {
  console.log(
    r.v.id.padEnd(W.id) + r.v.label.slice(0, W.label - 1).padEnd(W.label) +
    fmtR(r.a.pnl).padStart(W.pnl) + (Number.isFinite(r.pf) ? r.pf.toFixed(2) : '∞').padStart(W.pf) +
    fmtR(r.exp).padStart(W.exp) + r.wr.toFixed(1).padStart(W.wr) + String(r.a.trades).padStart(W.tr) +
    fmtR(r.a.maxDD).padStart(W.dd) + `${r.a.repPnl.filter((p) => p > 0).length}/5`.padStart(W.rep) +
    r.tag.padStart(W.tag + 1)
  );
}
console.log(line('─'));

// Detalhe por motivo de saída das 4 melhores e das marcadas para descartar
console.log('\n  Decomposição por motivo de saída (últimas ~1200 liquidações/réplica):');
for (const r of rows) {
  const parts = Object.entries(r.a.reasons)
    .sort((x, y) => y[1].n - x[1].n)
    .map(([k, val]) => `${k}: ${val.n}t / ${fmtR(val.pnl)}`);
  console.log(`   ${r.v.id.padEnd(15)} → ${parts.join(' · ') || 'sem trades'}`);
}

// ---------------------------------------------------------------------------
// CSV (padrão BR: BOM UTF-8, separador ;)
// ---------------------------------------------------------------------------
const csv: string[] = [];
csv.push('VARIAÇÃO;GRUPO;DESCRIÇÃO;PNL_50_DIAS_R$;FATOR_LUCRO;EXPECTATIVA_R$_POR_TRADE;WIN_RATE_PCT;TRADES;PIOR_DD_R$;REPLICAS_POSITIVAS;VEREDITO;MOTIVOS_SAIDA');
for (const r of rows) {
  const reasons = Object.entries(r.a.reasons).map(([k, val]) => `${k}:${val.n}t(${fmtR(val.pnl).replace('R$ ', '')})`).join(' | ');
  csv.push(
    [
      r.v.id, r.v.group, r.v.label,
      r.a.pnl.toFixed(2).replace('.', ','),
      Number.isFinite(r.pf) ? r.pf.toFixed(2).replace('.', ',') : 'INF',
      r.exp.toFixed(2).replace('.', ','),
      r.wr.toFixed(1).replace('.', ','),
      String(r.a.trades),
      r.a.maxDD.toFixed(2).replace('.', ','),
      `${r.a.repPnl.filter((p) => p > 0).length}/5`,
      r.tag, reasons,
    ].join(';')
  );
}
const outPath = path.join(SCRIPT_DIR, 'strategy_lab_results.csv');
fs.writeFileSync(outPath, '\uFEFF' + csv.join('\r\n') + '\r\n', 'utf8');
console.log(`\n  CSV gravado em ${outPath}\n`);
