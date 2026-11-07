import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { ASSETS } from '../src/assets/assetRegistry';
import { DEFAULT_EA_CONFIG } from '../src/services/eaConfigService';
import { StrategyLibraryService } from '../src/services/strategyLibraryService';

const storage = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  },
});

afterEach(() => storage.clear());

test('seeds separate editable WIN, WDO, and BIT strategies with asset-specific defaults', () => {
  const seeded = StrategyLibraryService.ensureAssetStrategies(
    { ...DEFAULT_EA_CONFIG, assetId: 'WIN', symbol: ASSETS.WIN.activeContract! },
    'WIN',
  );
  const ids = seeded.config.assetStrategyIds;
  assert.ok(ids?.WIN);
  assert.ok(ids?.WDO);
  assert.ok(ids?.BTCBR);
  assert.notEqual(ids?.WIN, ids?.WDO);
  assert.notEqual(ids?.WIN, ids?.BTCBR);
  assert.equal(ids?.BTC, ids?.BTCBR);

  const strategies = StrategyLibraryService.list();
  const win = strategies.find((strategy) => strategy.id === ids?.WIN)!;
  const wdo = strategies.find((strategy) => strategy.id === ids?.WDO)!;
  const bit = strategies.find((strategy) => strategy.id === ids?.BTCBR)!;

  assert.equal(wdo.config.assetId, 'WDO');
  assert.equal(wdo.config.boxPoints, ASSETS.WDO.tradeDefaults.boxPoints);
  assert.equal(wdo.config.pyramidTpPoints, ASSETS.WDO.tradeDefaults.boxPoints);
  assert.equal(wdo.config.tradingStartTime, ASSETS.WDO.session.open);
  assert.equal(wdo.config.active, false);
  assert.equal(bit.config.assetId, 'BTCBR');
  assert.equal(bit.config.boxPoints, ASSETS.BTCBR.tradeDefaults.boxPoints);
  assert.equal(bit.config.active, false);
  assert.equal(win.config.assetId, 'WIN');

  const selectedWdo = StrategyLibraryService.ensureAssetStrategies(seeded.config, 'WDO');
  assert.equal(selectedWdo.strategy.id, ids?.WDO);
  assert.equal(selectedWdo.config.strategyId, ids?.WDO);
  assert.equal(StrategyLibraryService.list().length, 3);
});

test('editing one asset strategy does not change the other asset strategies', () => {
  const seeded = StrategyLibraryService.ensureAssetStrategies(
    { ...DEFAULT_EA_CONFIG, assetId: 'WIN', symbol: ASSETS.WIN.activeContract! },
    'WIN',
  );
  const wdoId = seeded.config.assetStrategyIds?.WDO;
  const winId = seeded.config.assetStrategyIds?.WIN;
  assert.ok(wdoId);
  assert.ok(winId);

  StrategyLibraryService.updateStrategyConfig(wdoId, { minDeltaThreshold: 91 });
  const strategies = StrategyLibraryService.list();

  assert.equal(strategies.find((strategy) => strategy.id === wdoId)?.config.minDeltaThreshold, 91);
  assert.equal(
    strategies.find((strategy) => strategy.id === winId)?.config.minDeltaThreshold,
    DEFAULT_EA_CONFIG.minDeltaThreshold,
  );
});
