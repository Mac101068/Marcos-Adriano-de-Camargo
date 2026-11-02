/**
 * Asserts da identidade por robô (Fase 2 multi-robô) — rodar com: npx tsx scripts/robotMagicAssert.ts
 *
 * Cobre os dois lados do contrato: as placas que o APP carrega nos payloads (types/trading.ts)
 * e o script Python GERADO (pythonScriptGenerator.ts), que precisa filtrar saídas por magic e
 * nunca nascer com nome quebrado. Se qualquer um dos dois mudar de número silenciosamente, o
 * filtro da ponte passa a fechar a posição errada na conta real — é o que estes asserts protegem.
 */

// O stub precisa existir ANTES de qualquer leitura de storage: o Node não tem localStorage.
const store = new Map<string, string>();
(globalThis as Record<string, unknown>).localStorage = {
  getItem: (k: string) => (store.has(k) ? store.get(k) : null),
  setItem: (k: string, v: string) => void store.set(k, String(v)),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
};

const {
  MANUAL_ORDER_MAGIC,
  DEFAULT_MAGIC_NUMBER,
  mainRobotMagic,
  robotTagForMagic,
} = await import('../src/types/trading');
const { DEFAULT_EA_CONFIG } = await import('../src/services/eaConfigService');
const { generatePythonMT5Script } = await import('../src/utils/pythonScriptGenerator');

let failures = 0;
function ok(name: string, cond: boolean, seen?: unknown) {
  if (cond) {
    console.log(`  ✓ ${name}`);
    return;
  }
  failures += 1;
  console.error(`  ✗ ${name}${seen === undefined ? '' : ` — visto: ${JSON.stringify(seen)}`}`);
}
function eq(name: string, got: unknown, want: unknown) {
  ok(`${name} = ${JSON.stringify(want)}`, got === want, got);
}

console.log('\n== Placas do app (types/trading.ts) ==');
eq('magic da boleta manual', MANUAL_ORDER_MAGIC, 999999);
eq('magic do robô vem do config', mainRobotMagic({ magicNumber: 123456 }), 123456);
eq('config sem magic cai no fallback', mainRobotMagic({}), DEFAULT_MAGIC_NUMBER);
eq('config com magic 0 (lixo) cai no fallback', mainRobotMagic({ magicNumber: 0 }), DEFAULT_MAGIC_NUMBER);
eq('rótulo do manual', robotTagForMagic(MANUAL_ORDER_MAGIC), 'Boleta manual');
ok('rótulo do robô cita o magic', robotTagForMagic(102030).includes('102030'));
eq('rótulo sem magic', robotTagForMagic(undefined), 'sem magic');

console.log('\n== Script Python gerado (WIN) ==');
const cfgWin = { ...DEFAULT_EA_CONFIG, magicNumber: 102030 };
const py = generatePythonMT5Script(cfgWin);
ok('sem o NameError histórico (contracts=CONTRACTS solto)', !py.includes('contracts=CONTRACTS,'));
ok('manager nasce com MAIN_CONTRACTS', py.includes('contracts=MAIN_CONTRACTS, magic_number=MAGIC_NUMBER'));
ok('define MANUAL_ORDER_MAGIC = 999999 (mesma placa do app)', py.includes('MANUAL_ORDER_MAGIC = 999999'));
ok('embutiu o magic do config', py.includes('MAGIC_NUMBER = 102030'));
ok('close_all_positions filtra por magic', py.includes("def close_all_positions(self, side=None, magic=\"robot\")"));
ok('robô não toca magic alheio', py.includes('if magic_filter is not None and pos.magic != magic_filter:'));
ok('inversão olha só posições do robô', py.includes('if p.magic == self.magic_number]'));
ok('entrada web carrega magic do payload', py.includes('order_magic = data.get("magic") or None'));
ok('CLOSE_POSITIONS lê robotMagic do app', py.includes('magic=data.get("robotMagic") if data.get("robotMagic") else None'));
ok('ACCOUNT_INFO reporta robotMagic', py.includes('"robotMagic": MAGIC_NUMBER'));
ok('ACCOUNT_INFO reporta pointValue do ativo', py.includes('"pointValue": ASSET_POINT_VALUE'));

console.log('\n== R$/ponto por ativo no script gerado ==');
ok('WIN = 0.2', py.includes('ASSET_POINT_VALUE = 0.2'));
const pyWdo = generatePythonMT5Script({ ...DEFAULT_EA_CONFIG, assetId: 'WDO', symbol: 'WDO$N' });
ok('WDO = 0.1 (não soldado no WIN)', pyWdo.includes('ASSET_POINT_VALUE = 0.1'));
ok('PnL zerado usa ASSET_POINT_VALUE', pyWdo.includes('ASSET_POINT_VALUE * pos.volume'));

console.log('\n== Robôs de papel (R$/ponto por ativo) ==');
const { PaperStrategyBot } = await import('../src/utils/paperStrategyBot');
const { pointsToBRL } = await import('../src/assets/assetRegistry');
const { ASSETS } = await import('../src/assets/assetRegistry');
const bot = new PaperStrategyBot('renko');
eq('default WIN', bot.getAssetId(), 'WIN');
bot.setAsset('WDO');
eq('setAsset troca o ativo', bot.getAssetId(), 'WDO');
// Conversão determinística, sem depender do gatilho do coletor: 50 pts × R$0,10 (WDO) = R$5,
// contra os R$10 que sairia se a contabilidade continuasse soldada no WIN (R$0,20).
eq('pointsToBRL(WDO, 50 pts, 1 ctro)', pointsToBRL(50, 1, ASSETS.WDO), 5);
eq('pointsToBRL(WIN, 50 pts, 1 ctro)', pointsToBRL(50, 1, ASSETS.WIN), 10);
const mkBox = (i: number, dir: 'UP' | 'DOWN', open: number, close: number, t: number) => ({
  index: i, direction: dir, open, close, high: Math.max(open, close), low: Math.min(open, close),
  timeStart: t - 60000, timeEnd: t, ticksCount: 10, totalVolume: 100,
  buyVolume: dir === 'UP' ? 80 : 20, sellVolume: dir === 'UP' ? 20 : 80, delta: dir === 'UP' ? 500 : -500,
  cvdAtClose: dir === 'UP' ? 500 : 0, isConvergence: true,
  convergenceType: (dir === 'UP' ? 'BUY_CONVERGENCE' : 'SELL_CONVERGENCE') as 'BUY_CONVERGENCE' | 'SELL_CONVERGENCE' | 'DIVERGENCE',
});
// Janela do config padrão desligada: o bot opera na hora em que as barras chegam.
const cfgNoHours = { ...DEFAULT_EA_CONFIG, tradingHoursEnabled: false } as typeof DEFAULT_EA_CONFIG;
const t0 = Date.now();
bot.onClosedBox(mkBox(0, 'UP', 10000, 10100, t0), 'BUY', cfgNoHours);
bot.markToMarket(10150);
const open = bot.getTrades().length; // 0 liquidados ainda — MAIN/Pyramid abertas
ok('sem liquidação antes da virada', open === 0, open);
bot.onClosedBox(mkBox(1, 'DOWN', 10100, 10000, t0 + 60000), 'SELL', cfgNoHours);
const settled = bot.getTrades();
ok('virada liquidou as posições', settled.length > 0, settled.length);
for (const tr of settled) {
  const want = (tr.points ?? 0) * 0.1 * tr.contracts; // régua WDO, não a do WIN
  ok(`trade ${tr.role} · R$ = pontos × 0,10 × ctros`, Math.abs((tr.financial ?? 0) - want) < 0.001, { fin: tr.financial, want });
}

const { shadowRobotService } = await import('../src/services/shadowRobotService');
const effOff = shadowRobotService.configure({ enabled: false, strategyId: null, scaleR: 20 }, ASSETS.WDO, cfgNoHours);
ok('sombra desligada devolve config null (sem motor) mesmo em WDO', effOff === null);

console.log(failures === 0 ? '\n✅ todos os asserts da identidade por robô passaram\n' : `\n❌ ${failures} assert(s) falharam\n`);
process.exit(failures === 0 ? 0 : 1);
