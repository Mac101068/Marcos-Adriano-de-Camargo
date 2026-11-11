import { ASSETS, isPriceSaneForAsset } from '../assets/assetRegistry';
import { TradeOrder } from '../types/trading';

const CONFIG_KEY = 'fluxo_renko_ea_config_v3';
const LIBRARY_KEY = 'fluxo_strategy_library_v1';
const DONE_FLAG = 'fluxo_anti_burst_cycle_v1';

export function migrateAntiBurstCycle(): { config: boolean; params: boolean; ordersCleaned: number } {
  const result = { config: false, params: false, ordersCleaned: 0 };
  try {
    if (localStorage.getItem(DONE_FLAG)) return result;

    // 1. Corrige config ativa do EA
    const rawConfig = localStorage.getItem(CONFIG_KEY);
    if (rawConfig) {
      try {
        const parsed = JSON.parse(rawConfig);
        const isWin = !parsed.assetId || parsed.assetId === 'WIN' || String(parsed.symbol || '').includes('WIN');
        if (isWin) {
          parsed.minDeltaThreshold = Math.max(300, Number(parsed.minDeltaThreshold) || 300);
          parsed.consolidationFilterEnabled = true;
          parsed.exhaustionFilterEnabled = true;
          parsed.adaptiveThresholdEnabled = true;
          parsed.flowDivergenceMin = Math.max(0.4, Number(parsed.flowDivergenceMin) || 0.5);
          localStorage.setItem(CONFIG_KEY, JSON.stringify(parsed));
          result.config = true;
        }
      } catch {}
    }

    // 2. Corrige parâmetros de trade persistidos para WIN
    const rawWinParams = localStorage.getItem('fluxo_asset_trade_params_WIN');
    if (rawWinParams) {
      try {
        const parsed = JSON.parse(rawWinParams);
        parsed.minDeltaThreshold = Math.max(300, Number(parsed.minDeltaThreshold) || 300);
        localStorage.setItem('fluxo_asset_trade_params_WIN', JSON.stringify(parsed));
        result.params = true;
      } catch {}
    } else {
      localStorage.setItem('fluxo_asset_trade_params_WIN', JSON.stringify({ minDeltaThreshold: 300, boxPoints: 50 }));
      result.params = true;
    }

    // 3. Corrige estratégias salvas na biblioteca
    const rawLib = localStorage.getItem(LIBRARY_KEY);
    if (rawLib) {
      try {
        const list = JSON.parse(rawLib);
        if (Array.isArray(list)) {
          const updated = list.map((item: any) => {
            if (item && item.config) {
              const isWin = !item.config.assetId || item.config.assetId === 'WIN' || String(item.config.symbol || '').includes('WIN');
              if (isWin) {
                item.config.minDeltaThreshold = Math.max(300, Number(item.config.minDeltaThreshold) || 300);
                item.config.consolidationFilterEnabled = true;
                item.config.exhaustionFilterEnabled = true;
                item.config.adaptiveThresholdEnabled = true;
                item.config.flowDivergenceMin = Math.max(0.4, Number(item.config.flowDivergenceMin) || 0.5);
              }
            }
            return item;
          });
          localStorage.setItem(LIBRARY_KEY, JSON.stringify(updated));
        }
      } catch {}
    }

    // 4. Higieniza livros de ordens salvos (elimina resíduos espúrios > R$ 5.000 ou preços fora de escala)
    const assetKeys = ['WIN', 'WDO', 'BTCBR', 'BIT'];
    for (const aKey of assetKeys) {
      const storageKey = `fluxo_intraday_orders_v1_${aKey}`;
      const rawOrders = localStorage.getItem(storageKey);
      if (rawOrders) {
        try {
          const orders: TradeOrder[] = JSON.parse(rawOrders);
          if (Array.isArray(orders)) {
            const spec = ASSETS[aKey === 'BIT' ? 'BTCBR' : (aKey as keyof typeof ASSETS)] || ASSETS.WIN;
            const valid = orders.filter((o) => {
              if (!o) return false;
              // Preço de entrada tem que ser são
              if (o.entryPrice && !isPriceSaneForAsset(o.entryPrice, spec)) return false;
              // PnL financeiro não pode ser astronômico em simulação local ou cross-asset
              if (Math.abs(o.financialResult || 0) > 10000) return false;
              if (Math.abs(o.pointsResult || 0) > 10000) return false;
              return true;
            });
            if (valid.length !== orders.length) {
              result.ordersCleaned += (orders.length - valid.length);
              localStorage.setItem(storageKey, JSON.stringify(valid));
            }
          }
        } catch {}
      }
    }

    localStorage.setItem(DONE_FLAG, '1');
  } catch (e) {
    console.warn('Falha na migração anti-burst:', e);
  }
  return result;
}

