/**
 * ============================================================================
 * EA SOBRE BASE REAL vs. SINTÉTICA — por que o resultado inverteu?
 * ----------------------------------------------------------------------------
 * Roda a MESMA máquina do terminal (RenkoFlowEngine + PaperStrategyBot, os
 * mesmos módulos importados pelo App) sobre:
 *   1. a base REAL baixada da ponte (dados/mt5_real_*.json)
 *   2. a base SINTÉTICA do simulador (generateHistoricalTicks, seed fixa)
 * com o MESMO config de estratégia, e imprime o retrato dos dois mercados.
 *
 * Nenhum caminho deste script toca a ponte MT5, ordens reais ou localStorage.
 * Executar:  npx tsx scripts/eaBaseReal.ts [caminho/do/envelope.json]
 * ============================================================================
 */
import { DEFAULT_EA_CONFIG } from '../src/services/eaConfigService';
import { ASSETS, resolveAsset, type AssetId } from '../src/assets/assetRegistry';
import { AutomationConfig, Tick } from '../src/types/trading';
import { RenkoFlowEngine } from '../src/utils/renkoCalculator';
import { PaperStrategyBot, PaperStats, PaperTrade } from '../src/utils/paperStrategyBot';
import { generateHistoricalTicks } from '../src/utils/marketSimulator';
import * as fs from 'fs';

// ---------------------------------------------------------------------------
// Utilidades de medição
// ---------------------------------------------------------------------------
const pct = (arr: number[], p: number) => {
  if (!arr.length) return NaN;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * p))];
};
const fix = (n: number, d = 1) => (Number.isFinite(n) ? n.toFixed(d) : String(n));
// Math.max(...arr) estoura a pilha com centenas de milhares de elementos.
const mx = (arr: number[]) => arr.reduce((a, b) => (b > a ? b : a), -Infinity);
const mn = (arr: number[]) => arr.reduce((a, b) => (b < a ? b : a), Infinity);
const diaLocal = (ts: number) => new Date(ts).toISOString().slice(0, 10);
const horaLocal = (ts: number) => new Date(ts).getHours();

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Config ativo do terminal (10R Pirâmide & Confluência, lido do cofre do usuário)
// ---------------------------------------------------------------------------
function buildConfig(assetId: AssetId): AutomationConfig {
  const base: AutomationConfig = { ...DEFAULT_EA_CONFIG, ...asRecord(ASSETS[assetId]?.tradeDefaults) };
  return {
    ...base,
    assetId,
    strategyMode: 'PYRAMID_FLOW_CONFLUENCE',
    // 10R na escala do ativo (WIN: 50 pts · WDO: 5 pts)
    boxPoints: base.boxPoints,
    contracts: 1,
    minDeltaThreshold: 100,
    adaptiveThresholdEnabled: true,
    regimeLookbackBoxes: 20,
    confirmationMode: 'BOX_CLOSE',
    stopLossPoints: 0,
    takeProfitPoints: 0,
    noFixedStopLoss: true,
    enablePartialExit: false,
    pyramidTpPoints: base.boxPoints,
    pyramidSlPoints: 0,
    pyramidContracts: 1,
    pyramidEntryType: 'MARKET_ON_CLOSE',
    entryTriggerType: 'MARKET_ON_CLOSE',
    holdMainUntilFlip: true,
    closeAllOnFlowFlip: true,
    tradingHoursEnabled: true,
    tradingStartTime: '08:55',
    tradingStopEntriesTime: '17:30',
    tradingCloseAllTime: '17:30',
    maxDailyLoss: 1000,
    maxDailyProfit: 2500,
    accountMode: 'HEDGE',
    maxSimultaneousPositions: 15,
  };
}
function asRecord(v: unknown): Partial<AutomationConfig> {
  return v && typeof v === 'object' ? (v as Partial<AutomationConfig>) : {};
}

// ---------------------------------------------------------------------------
// Retrato do mercado (não depende de estratégia nenhuma)
// ---------------------------------------------------------------------------
function retrato(nome: string, ticks: Tick[]) {
  const gaps: number[] = [];
  const vols: number[] = [];
  const horas = new Map<number, number>();
  let mesmoVolumeDoAnterior = 0, buy = 0, sell = 0, cross = 0;
  for (let i = 0; i < ticks.length; i++) {
    const t = ticks[i];
    vols.push(t.volume);
    if (i > 0) {
      gaps.push(t.timestamp - ticks[i - 1].timestamp);
      if (t.volume === ticks[i - 1].volume) mesmoVolumeDoAnterior++;
    }
    horas.set(horaLocal(t.timestamp), (horas.get(horaLocal(t.timestamp)) || 0) + 1);
    if (t.aggressor === 'BUY') buy++; else if (t.aggressor === 'SELL') sell++; else cross++;
  }
  const dias = new Map<string, number>();
  ticks.forEach((t) => dias.set(diaLocal(t.timestamp), (dias.get(diaLocal(t.timestamp)) || 0) + 1));
  const porDia = [...dias.values()];
  const spanH = (ticks[ticks.length - 1].timestamp - ticks[0].timestamp) / 3600000;
  const sessoes = [...dias.entries()].sort();

  console.log(`\n┌─ RETRATO · ${nome}`);
  console.log(`│ ticks ${ticks.length} · ${sessoes.length} pregões · span ${fix(spanH, 1)}h`);
  console.log(`│ ticks/pregão: min ${mn(porDia)} mediana ${fix(pct(porDia, 0.5), 0)} max ${mx(porDia)}`);
  console.log(`│ densidade: ${fix(ticks.length / Math.max(1, spanH), 2)} tick/h → ${fix(3600000 / (ticks.length / Math.max(1, spanH)) / 1000, 0)}s entre ticks`);
  console.log(`│ gap entre ticks (s): mediana ${fix(pct(gaps, 0.5) / 1000, 1)} · p95 ${fix(pct(gaps, 0.95) / 1000, 0)} · max ${fix(mx(gaps) / 60000, 0)}min`);
  console.log(`│ volume: min ${mn(vols)} mediana ${fix(pct(vols, 0.5), 0)} max ${mx(vols)} · ${fix((mesmoVolumeDoAnterior / ticks.length) * 100, 1)}% repetem o volume do tick anterior (assinatura M1_RATE)`);
  console.log(`│ agressor: BUY ${buy} / SELL ${sell} / CROSS ${cross}`);
  const janela = [...horas.entries()].sort((a, b) => a[0] - b[0]);
  console.log(`│ horas (local): ${janela.map(([h, n]) => `${h}h:${n}`).join(' ')}`);
  console.log(`│ sessão: ${sessoes[0][0]} → ${sessoes[sessoes.length - 1][0]}`);
  console.log('└─');
  return { dias: sessoes.length, ticksPorPregao: porDia.reduce((a, b) => a + b, 0) / sessoes.length };
}

// ---------------------------------------------------------------------------
// Censo dos tijolos: o que a base real entrega para o EA decidir
// ---------------------------------------------------------------------------
function censoRenko(nome: string, ticks: Tick[], cfg: AutomationConfig) {
  const eng = new RenkoFlowEngine(cfg.boxPoints);
  for (const t of ticks) eng.processTick(t, cfg);
  const boxes = eng.getBoxes().filter((b) => b.index >= 0);
  const fechados = boxes.filter((b) => b.timeEnd > 0);
  const deltas = fechados.map((b) => Math.abs(b.delta));
  const ticksPorBox = fechados.map((b) => b.ticksCount);
  const minPorBox = fechados.map((b) => (b.timeEnd - b.timeStart) / 60000);
  const limiar = cfg.minDeltaThreshold ?? 100;
  const passam = deltas.filter((d) => d >= limiar).length;
  const conv = fechados.filter((b) => b.isConvergence).length;
  const porDia = new Map<string, number>();
  fechados.forEach((b) => porDia.set(diaLocal(b.timeStart), (porDia.get(diaLocal(b.timeStart)) || 0) + 1));

  console.log(`\n┌─ CENSO RENKO · ${nome} · box ${cfg.boxPoints} pts (10R)`);
  console.log(`│ boxes fechados: ${fechados.length} · por pregão: ${fix(fechados.length / Math.max(1, porDia.size), 1)}`);
  console.log(`│ ticks por box: mediana ${fix(pct(ticksPorBox, 0.5), 0)} · p95 ${fix(pct(ticksPorBox, 0.95), 0)} · min ${mn(ticksPorBox)}`);
  console.log(`│ minutos por box: mediana ${fix(pct(minPorBox, 0.5), 1)} · max ${fix(mx(minPorBox), 0)}`);
  console.log(`│ |Δ| por box: mediana ${fix(pct(deltas, 0.5), 0)} · p95 ${fix(pct(deltas, 0.95), 0)} · max ${fix(mx(deltas), 0)}`);
  console.log(`│ boxes com |Δ| ≥ limiar ${limiar}: ${passam}/${fechados.length} (${fix((passam / Math.max(1, fechados.length)) * 100, 1)}%)`);
  console.log(`│ boxes marcados como convergência: ${conv} (${fix((conv / Math.max(1, fechados.length)) * 100, 1)}%)`);
  console.log(`│ volume por box: mediana ${fix(pct(fechados.map((b) => b.totalVolume), 0.5), 0)}`);
  console.log('└─');
  return { boxes: fechados.length, boxesPorPregao: fechados.length / Math.max(1, porDia.size) };
}

// ---------------------------------------------------------------------------
// Execução do EA (mesma lógica do terminal)
// ---------------------------------------------------------------------------
interface Resultado {
  stats: PaperStats;
  trades: PaperTrade[];
  boxes: number;
}
function rodaEA(nome: string, ticks: Tick[], cfg: AutomationConfig): Resultado {
  const bot = new PaperStrategyBot('renko');
  const eng = new RenkoFlowEngine(cfg.boxPoints);
  let i = 0;
  for (const t of ticks) {
    const r = eng.processTick(t, cfg);
    i++;
    if (r.newBoxClosed && r.closedBox) bot.onClosedBox(r.closedBox, r.signal, cfg);
  }
  const stats = bot.getStats();
  const trades = bot.getTrades();
  const reasons = new Map<string, { n: number; pts: number; rs: number }>();
  trades.forEach((tr) => {
    const k = tr.exitReason ?? 'ABERTO';
    const a = reasons.get(k) ?? { n: 0, pts: 0, rs: 0 };
    a.n++; a.pts += tr.points ?? 0; a.rs += tr.financial ?? 0;
    reasons.set(k, a);
  });
  const porDia = new Map<string, { n: number; rs: number }>();
  trades.forEach((tr) => {
    const d = diaLocal(tr.exitTime ?? tr.entryTime);
    const a = porDia.get(d) ?? { n: 0, rs: 0 };
    a.n++; a.rs += tr.financial ?? 0;
    porDia.set(d, a);
  });

  console.log(`\n┌─ EA · ${nome}`);
  console.log(`│ trades ${stats.trades} · liquidados ${stats.settled} · win rate ${fix(stats.winRate, 1)}%`);
  console.log(`│ PnL R$ ${fix(stats.totalFinancial, 2)} · pontos ${fix(stats.totalPoints, 0)} · expectativa R$/trade ${fix(stats.expectancy, 2)}`);
  console.log(`│ fator de lucro ${fix(stats.profitFactor, 2)} · DD máx R$ ${fix(stats.maxDrawdown, 2)}`);
  console.log(`│ maior ganho R$ ${fix(stats.largestWin, 2)} · maior perda R$ ${fix(stats.largestLoss, 2)}`);
  console.log(`│ abertas ${stats.openCount} · não realizado R$ ${fix(stats.unrealized, 2)}`);
  console.log('│ saídas: ' + [...reasons.entries()].map(([k, v]) => `${k} ${v.n}t R$${fix(v.rs, 0)}`).join(' | '));
  console.log('│ por pregão: ' + [...porDia.entries()].sort().map(([d, v]) => `${d.slice(5)}:${fix(v.rs, 0)}`).join(' '));
  console.log('└─');
  return { stats, trades, boxes: 0 };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
const arquivo = process.argv[2] || 'dados/mt5_real_WINZ26_2026-10-20_a_2026-11-04.json';
if (!fs.existsSync(arquivo)) {
  console.error(`arquivo não encontrado: ${arquivo}`);
  process.exit(1);
}
const envelope = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
const reais: Tick[] = (envelope.ticks as Tick[]).slice().sort((a, b) => a.timestamp - b.timestamp);
const simbolo: string = envelope.simbolo || 'WINZ26';
const assetId = resolveAsset(simbolo).id;
const cfg = buildConfig(assetId);

console.log('========================================================================');
console.log(` EA · base real × base sintética   ativo=${assetId} símbolo=${simbolo}`);
console.log(` fonte real: ${arquivo}`);
console.log(` fuso: ${Intl.DateTimeFormat().resolvedOptions().timeZone} · volumeSource=${envelope.auditoria?.volumeSource}`);
console.log('========================================================================');

const dias = new Set(reais.map((t) => diaLocal(t.timestamp))).size;
retrato('REAL (ponte MT5)', reais);
censoRenko('REAL', reais, cfg);
rodaEA('REAL sobre a ponte MT5', reais, cfg);

// Control: o mesmo config sobre o gerador sintético, mesmo nº de pregões
const seed = 684899584;
const realRandom = Math.random;
Math.random = mulberry32(seed);
let sinteticos: Tick[];
try { sinteticos = generateHistoricalTicks(Math.max(2, Math.min(10, dias))); } finally { Math.random = realRandom; }
sinteticos.sort((a, b) => a.timestamp - b.timestamp);
retrato(`SINTÉTICO (seed ${seed})`, sinteticos);
censoRenko('SINTÉTICO', sinteticos, cfg);
rodaEA('SINTÉTICO com o mesmo config', sinteticos, cfg);

// Terceira perna: REAL sem a borda contaminada (corta a descontinuidade do WIN)
const corte = new Date('2026-10-31T00:00:00-03:00').getTime();
const realPosCorte = reais.filter((t) => t.timestamp >= corte);
if (realPosCorte.length > 500) {
  retrato('REAL (só depois da borda de 30/10→03/11)', realPosCorte);
  censoRenko('REAL pós-borda', realPosCorte, cfg);
  rodaEA('REAL só depois da borda', realPosCorte, cfg);
}

// ---------------------------------------------------------------------------
// Quarta perna: VARREDURA de calibração — é mercado ruim ou limiar errado?
// ---------------------------------------------------------------------------
function mede(ticks: Tick[], c: AutomationConfig) {
  const bot = new PaperStrategyBot('renko');
  const eng = new RenkoFlowEngine(c.boxPoints);
  for (const t of ticks) {
    const r = eng.processTick(t, c);
    if (r.newBoxClosed && r.closedBox) bot.onClosedBox(r.closedBox, r.signal, c);
  }
  const s = bot.getStats();
  const fechados = eng.getBoxes().filter((b) => b.timeEnd > 0);
  return {
    trades: s.trades, wr: s.winRate, pnl: s.totalFinancial, pf: s.profitFactor,
    exp: s.expectancy, dd: s.maxDrawdown, boxes: fechados.length,
    ticksBox: pct(fechados.map((b) => b.ticksCount), 0.5),
  };
}

const LIMIARES = [100, 500, 1000, 3000, 10000, 30000, 100000];
const ESCALAS: Array<[string, number]> = [['10R', cfg.boxPoints], ['20R', cfg.boxPoints * 2]];
const alvos: Array<[string, Tick[]]> = [['REAL (11 pregões)', reais]];
if (realPosCorte.length > 500) alvos.push(['REAL pós-borda (2 pregões)', realPosCorte]);
alvos.push([`SINTÉTICO (10 pregões)`, sinteticos]);

for (const [nome, ticks] of alvos) {
  console.log(`\n── VARREDURA · ${nome} · adaptativo OFF (limiar literal)`);
  console.log('   escala  limiar    trades  win%   PnL R$   FatorL  R$/trade  DD R$   boxes  ticks/box');
  for (const [rotuloBox, pts] of ESCALAS) {
    for (const lim of LIMIARES) {
      const m = mede(ticks, { ...cfg, boxPoints: pts, minDeltaThreshold: lim, adaptiveThresholdEnabled: false });
      console.log(
        `   ${rotuloBox.padEnd(6)} ${String(lim).padStart(7)}  ${String(m.trades).padStart(6)}  ${fix(m.wr, 1).padStart(5)}  ${fix(m.pnl, 0).padStart(7)}  ${fix(m.pf, 2).padStart(6)}  ${fix(m.exp, 2).padStart(8)}  ${fix(m.dd, 0).padStart(6)}  ${String(m.boxes).padStart(6)}  ${fix(m.ticksBox, 0).padStart(6)}`
      );
    }
  }
}

console.log('\n── BASE REAL · adaptativo LIGADO (o que o terminal faz hoje)');
for (const [rotuloBox, pts] of ESCALAS) {
  const m = mede(reais, { ...cfg, boxPoints: pts, adaptiveThresholdEnabled: true });
  console.log(`   ${rotuloBox}: trades ${m.trades} · win ${fix(m.wr, 1)}% · PnL R$ ${fix(m.pnl, 0)} · FatorL ${fix(m.pf, 2)} · DD R$ ${fix(m.dd, 0)}`);
}
