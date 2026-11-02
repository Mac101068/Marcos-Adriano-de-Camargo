/**
 * Asserts da regra "gráfico = contrato vigente" (rodar com: npx tsx scripts/chartContractAssert.ts)
 *
 * Cobre as três peças que não podem discordar: o código que o gráfico abre (`chartSymbolFor`), o
 * padrão gravado no config (`DEFAULT_EA_CONFIG.symbol`) e a migração que move quem estava na série
 * contínua para o vigente — sem nunca tocar num vencimento digitado à mão.
 */

// O stub precisa existir ANTES de qualquer leitura de storage: o Node não tem localStorage.
const store = new Map<string, string>();
(globalThis as Record<string, unknown>).localStorage = {
  getItem: (k: string) => (store.has(k) ? store.get(k) : null),
  setItem: (k: string, v: string) => void store.set(k, String(v)),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
};

const CONFIG_KEY = 'fluxo_renko_ea_config_v3';
const LIBRARY_KEY = 'fluxo_strategy_library_v1';
const DONE_FLAG = 'fluxo_chart_vigente_v1';

const { ASSETS, chartSymbolFor, resolveAsset, assetSymbols, symbolRole } = await import('../src/assets/assetRegistry');
const { DEFAULT_EA_CONFIG } = await import('../src/services/eaConfigService');
const { migrateChartVigenteContract } = await import('../src/assets/chartContractMigration');

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

const WIN = ASSETS.WIN;
const WDO = ASSETS.WDO;

console.log('1) Código do gráfico sai do registro');
eq('WIN (tem WINZ26)', chartSymbolFor(WIN), 'WINZ26');
eq('WDO (sem vencimento confirmado → cai na contínua)', chartSymbolFor(WDO), 'WDO$N');
eq('papel do WIN derivado', symbolRole(WIN, chartSymbolFor(WIN)), 'vigente');
eq('papel do WDO derivado', symbolRole(WDO, chartSymbolFor(WDO)), 'serie');

console.log('2) Padrão do config e ativo resolvido batem');
eq('DEFAULT_EA_CONFIG.symbol', DEFAULT_EA_CONFIG.symbol, 'WINZ26');
eq('resolveAsset(WINZ26) é o WIN', resolveAsset(DEFAULT_EA_CONFIG.symbol, DEFAULT_EA_CONFIG.assetId).id, 'WIN');
ok('prefixo WIN casa WINZ26 (checagem da ponte mt5SymbolOk)', WIN.prefixes.some((p) => 'WINZ26'.startsWith(p)));

console.log('3) A tela não mente quando o config está fora do vigente');
const normal = assetSymbols(WIN, 'WINZ26');
ok('vigente: sem desvio', normal.offPattern === false);
eq('vigente: papel mostrado', normal.chartRole, 'vigente');
const onSeries = assetSymbols(WIN, 'WIN$N');
ok('teste na contínua: marca desvio', onSeries.offPattern === true);
eq('teste na contínua: papel do live', onSeries.liveRole, 'serie');
const handTyped = assetSymbols(WIN, 'WINJ27');
ok('vencimento digitado: marca desvio', handTyped.offPattern === true);
eq('vencimento digitado: papel "venc."', handTyped.liveRole, 'outro');

console.log('4) Migração: só toca quem estava EXATAMENTE na contínua');
function runMigration(config: unknown, library: unknown) {
  store.clear();
  if (config !== null) localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
  if (library !== null) localStorage.setItem(LIBRARY_KEY, JSON.stringify(library));
  const result = migrateChartVigenteContract();
  return {
    result,
    savedConfig: localStorage.getItem(CONFIG_KEY) ? JSON.parse(localStorage.getItem(CONFIG_KEY)!) : null,
    savedLibrary: localStorage.getItem(LIBRARY_KEY) ? JSON.parse(localStorage.getItem(LIBRARY_KEY)!) : null,
  };
}

const migrated = runMigration({ assetId: 'WIN', symbol: 'WIN$N', boxPoints: 50 }, null);
eq('config na contínua → vigente', migrated.savedConfig.symbol, 'WINZ26');
ok('config contado como tocado', migrated.result.config === true);
eq('boxPoints intacto', migrated.savedConfig.boxPoints, 50);

const kept = runMigration({ assetId: 'WIN', symbol: 'WINJ27' }, null);
eq('vencimento digitado não é reescrito', kept.savedConfig.symbol, 'WINJ27');
ok('nada contado', kept.result.config === false && kept.result.strategies === 0);

const wdoKept = runMigration({ assetId: 'WDO', symbol: 'WDO$N' }, null);
eq('ativo sem vigente fica na contínua', wdoKept.savedConfig.symbol, 'WDO$N');

const libraryRun = runMigration(
  { assetId: 'WIN', symbol: 'WINZ26' },
  [
    { id: 'a', config: { assetId: 'WIN', symbol: 'WIN$N' } },
    { id: 'b', config: { assetId: 'WIN', symbol: 'WINM27' } },
    { id: 'c', config: { assetId: 'WDO', symbol: 'WDO$N' } },
  ]
);
eq('biblioteca: só a estratégia na contínua foi tocada', libraryRun.savedLibrary[0].config.symbol, 'WINZ26');
eq('biblioteca: digitada à mão intacta', libraryRun.savedLibrary[1].config.symbol, 'WINM27');
eq('biblioteca: WDO intacto', libraryRun.savedLibrary[2].config.symbol, 'WDO$N');
eq('contagem de tocadas', libraryRun.result.strategies, 1);

console.log('5) Flag: roda uma única vez');
const first = runMigration({ assetId: 'WIN', symbol: 'WIN$N' }, null);
localStorage.setItem(DONE_FLAG, '1');
const second = (() => {
  const before = localStorage.getItem(CONFIG_KEY);
  const r = migrateChartVigenteContract();
  return { r, before, after: localStorage.getItem(CONFIG_KEY) };
})();
ok('primeira rodada converte', first.savedConfig.symbol === 'WINZ26');
ok('com a flag posta nada muda', second.before === second.after && second.r.config === false);

console.log(failures === 0 ? '\nTODOS OS ASSERTS PASSARAM' : `\n${failures} ASSERT(S) FALHARAM`);
process.exit(failures === 0 ? 0 : 1);
