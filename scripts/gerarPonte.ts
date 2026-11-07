// Gera o script da ponte (bridge) para esta máquina: npx tsx scripts/gerarPonte.ts
// O Node não tem localStorage; o stub abaixo só existe para bridgeSecurity.ts importar.
const store = new Map<string, string>();
(globalThis as Record<string, unknown>).localStorage = {
  getItem: (k: string) => (store.has(k) ? store.get(k) : null),
  setItem: (k: string, v: string) => void store.set(k, String(v)),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
};

const { DEFAULT_EA_CONFIG } = await import('../src/services/eaConfigService');
type AutomationConfig = import('../src/types/trading').AutomationConfig;
const { generatePythonMT5Script } = await import('../src/utils/pythonScriptGenerator');
const { writeFileSync } = await import('node:fs');

const cfg: AutomationConfig = { ...DEFAULT_EA_CONFIG, symbol: 'WINZ26', assetId: 'WIN', boxPoints: 50 };
const py = generatePythonMT5Script(cfg);
writeFileSync('ponte_mt5.py', py, 'utf8');
console.log('ponte_mt5.py gerado —', py.split('\n').length, 'linhas | simbolo', cfg.symbol, '| box', cfg.boxPoints, 'pts');
