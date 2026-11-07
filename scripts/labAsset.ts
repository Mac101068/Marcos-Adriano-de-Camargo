import * as fs from 'fs';
import * as path from 'path';
import { PaperStrategyBot, PaperStats, PaperTrade } from '../src/utils/paperStrategyBot';
import { RenkoFlowEngine } from '../src/utils/renkoCalculator';
import { BUILT_IN_PRESETS } from '../src/services/eaConfigService';
import { AutomationConfig } from '../src/types/trading';

const ASSET = (process.argv[2] || 'WDO').toUpperCase();
const FILES: Record<string, string> = {
  WDO: 'mt5_real_WDOZ26_2026-10-16_a_2026-11-04.json',
  WIN: 'mt5_real_WINZ26_2026-10-20_a_2026-11-04.json',
};
const FILE = path.join(process.cwd(), 'dados', FILES[ASSET] ?? FILES.WDO);
const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
// Corte do degrau de feed demo do WIN (31.025 pts entre 30/10 18:24 e 03/11 09:03) — a própria
// base avisa que é descontinuidade, não mercado. Sem o corte, o Renko gera cauda de tijolos falsos.
let TICKS = raw.ticks as any[];
if (ASSET === 'WIN') {
  const antes = TICKS.length;
  TICKS = TICKS.filter((t) => !(t.timestamp >= Date.UTC(2026, 9, 30, 21, 24) && t.timestamp < Date.UTC(2026, 10, 3, 12, 3)));
  console.log(`corte do degrau: ${antes - TICKS.length} ticks descartados`);
}
const AVISOS: string[] = raw.avisos ?? [];
const PRESET_ID = ASSET === 'WIN' ? 'preset-pyramid-flow-10r' : 'preset-cv-wdo';
const PRESET = { ...BUILT_IN_PRESETS.find((p) => p.id === PRESET_ID)!.config, strategyMode: 'SIGNAL_STACK' as const };

console.log(`${raw.simbolo}: ${TICKS.length} ticks | ${raw.auditoria?.pregões ?? '?'} pregoes | faixa ${raw.auditoria?.precoMin}..${raw.auditoria?.precoMax}`);
console.log(`preset: box ${PRESET.boxPoints} | stop ${PRESET.stopLossPoints} | tp ${PRESET.takeProfitPoints} | ${PRESET.assetId}/${PRESET.symbol}`);

// corretagem WDO: R$ 2,00 ida+volta por contrato, R$ 10/pt -> 0,2 pt
const CUSTO_PT = ASSET === 'WIN' ? 0.2 : 0.2; // R$2 ida+volta; WIN R$0,20/pt -> 10pts, WDO R$10/pt -> 0,2pt

function run(label: string, override: Partial<AutomationConfig>) {
  const cfg: AutomationConfig = { ...PRESET, ...override };
  const bot = new PaperStrategyBot('renko', cfg.assetId);
  const eng = new RenkoFlowEngine(cfg.boxPoints);
  for (const t of TICKS) {
    const r = eng.processTick(t, cfg);
    for (const box of r.closedBoxes) bot.onClosedBox(box, box.orderDispatched, cfg);
  }
  const s: PaperStats = bot.getStats();
  const trades: PaperTrade[] = bot.getTrades();
  const cts = trades.reduce((a, t) => a + (t.contracts ?? 1), 0);
  const custo = cts * CUSTO_PT * 10; // R$
  const pnlLiq = s.totalFinancial - custo;
  const razoes: Record<string, number> = {};
  for (const t of trades) razoes[t.exitReason ?? '?'] = (razoes[t.exitReason ?? '?'] ?? 0) + 1;
  console.log(
    `${label.padEnd(26)} PnL R$ ${String(Math.round(pnlLiq)).padStart(8)} | PF ${(s.profitFactor ?? 0).toFixed(2)} | win ${(s.winRate ?? 0).toFixed(1)}% | trades ${String(s.trades).padStart(5)} | DD R$ ${Math.round(s.maxDrawdown).toString().padStart(5)} | ${Object.entries(razoes).map(([k, v]) => `${k}:${v}`).join(' ')}`
  );
}

console.log(`\n--- C/V em ${raw.simbolo} (base real, com corretagem) ---`);
run('padrao (sem BE)', {});
run('BE 5/3 (preset)', {});
run('BE 10/6', { breakevenTriggerPoints: 10, breakevenLockPoints: 6 });
run('BE 15/10', { breakevenTriggerPoints: 15, breakevenLockPoints: 10 });
run('stop 10 pts', { stopLossPoints: 10 });
run('stop 20 pts', { stopLossPoints: 20 });
run('stop 10 + BE 10/6', { stopLossPoints: 10, breakevenTriggerPoints: 10, breakevenLockPoints: 6 });
run('teto 5 posicoes', { maxSimultaneousPositions: 5 });
console.log('\navisos da base:', AVISOS.slice(0, 2).join(' / '));

