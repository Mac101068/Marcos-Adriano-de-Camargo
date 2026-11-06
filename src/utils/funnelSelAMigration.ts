import { DEFAULT_EA_CONFIG } from '../services/eaConfigService';

/**
 * Migração única — funil da Pirâmide no pacote SEL-A (P70 · piso 1,6× · divergência 50%).
 *
 * Por que existe: o operador relatou que o EA estava no breakeven. Um A/B headless na base real
 * WINZ26 (11 pregões, mesma máquina do terminal) mediu as alavancas do funil auto-calibrado: o
 * percentil é inerte (P50→P80 quase não muda), e quem sobe a qualidade por trade são PISO e
 * DIVERGÊNCIA. O braço SEL-A (P70 · piso 1,6 · div 50) foi o ponto doce: mantém os 11 pregões
 * positivos e melhora o padrão do Ciclo 16/17 — PF 3,71→4,17, R$/trade 15,9→21,4, DD até menor.
 * Expectancy por trade maior é exatamente o que vira um EA do empate para o lucro.
 *
 * A "regra que já mordeu" obriga esta migração: `loadSavedConfig` faz `{...DEFAULT, ...salvo}`,
 * então o pacote do Ciclo 17 gravado (div 0,4, sem percentil/piso explícitos) venceria o padrão
 * novo. Roda DEPOIS da migração do funil auto-calibrado, então o "pacote Cycle 17 intocado" aqui
 * é exatamente adaptive ON + Δ50 + div 0,4 (com percentil/piso nos defaults 0,6/1,3).
 *
 * Segurança (conservadorismo): só é tocada estratégia em MODO PIRÂMIDE que ainda está no pacote
 * padrão do Ciclo 17 INTOCADO (`adaptiveThresholdEnabled === true`, `minDeltaThreshold === 50`,
 * `flowDivergenceMin === 0.4` e percentil/piso ainda nos valores defaults — quem calibrou as
 * alavancas por conta própria não é tocado). Roda uma vez por versão de flag e cobre config ativa
 * + biblioteca. Reversível em Ajustes → Gatilho: leve "Percentil" a 60, "Piso" a 1,3 e
 * "Divergência de Fluxo" a 40%.
 */

const CONFIG_KEY = 'fluxo_renko_ea_config_v3';
const LIBRARY_KEY = 'fluxo_strategy_library_v1';
const DONE_FLAG = 'fluxo_funnel_sela_v1';

type LooseConfig = Record<string, unknown> & {
  strategyMode?: string;
  minDeltaThreshold?: number;
  adaptiveThresholdEnabled?: boolean;
  adaptiveThresholdPercentile?: number;
  adaptiveFloorMultiple?: number;
  flowDivergenceMin?: number;
};

/** É Pirâmide com o funil ainda no pacote padrão do Ciclo 17 (ON, Δ50, div 0,4, percentil/piso nos defaults)? */
function isUntouchedCycle17Funnel(raw: unknown): raw is LooseConfig {
  if (!raw || typeof raw !== 'object') return false;
  const c = raw as LooseConfig;
  const percentileUntouched = c.adaptiveThresholdPercentile === undefined || c.adaptiveThresholdPercentile === 0.6;
  const floorUntouched = c.adaptiveFloorMultiple === undefined || c.adaptiveFloorMultiple === 1.3;
  return (
    c.strategyMode === 'PYRAMID_FLOW_CONFLUENCE' &&
    c.adaptiveThresholdEnabled === true &&
    c.minDeltaThreshold === 50 &&
    c.flowDivergenceMin === 0.4 &&
    percentileUntouched &&
    floorUntouched
  );
}

/** Aplica o pacote SEL-A do padrão novo (campos e valores vêm do DEFAULT atual). */
function withSelAFunnel(c: LooseConfig): LooseConfig {
  return {
    ...c,
    adaptiveThresholdPercentile: DEFAULT_EA_CONFIG.adaptiveThresholdPercentile,
    adaptiveFloorMultiple: DEFAULT_EA_CONFIG.adaptiveFloorMultiple,
    flowDivergenceMin: DEFAULT_EA_CONFIG.flowDivergenceMin,
  };
}

export function migrateFunnelSelA(): { config: boolean; strategies: number } {
  const result = { config: false, strategies: 0 };
  try {
    if (localStorage.getItem(DONE_FLAG)) return result;

    const rawConfig = localStorage.getItem(CONFIG_KEY);
    if (rawConfig) {
      const parsed = JSON.parse(rawConfig);
      if (isUntouchedCycle17Funnel(parsed)) {
        localStorage.setItem(CONFIG_KEY, JSON.stringify(withSelAFunnel(parsed)));
        result.config = true;
      }
    }

    const rawLibrary = localStorage.getItem(LIBRARY_KEY);
    if (rawLibrary) {
      const list = JSON.parse(rawLibrary);
      if (Array.isArray(list)) {
        let touched = 0;
        const migrated = list.map((strategy: Record<string, unknown>) => {
          if (!strategy || !isUntouchedCycle17Funnel(strategy.config)) return strategy;
          touched += 1;
          return { ...strategy, config: withSelAFunnel(strategy.config as LooseConfig) };
        });
        if (touched > 0) {
          localStorage.setItem(LIBRARY_KEY, JSON.stringify(migrated));
          result.strategies = touched;
        }
      }
    }

    // Só marca como feito depois das duas leituras: se estourar acima, tenta de novo na próxima.
    localStorage.setItem(DONE_FLAG, '1');
  } catch {
    // Sem storage (modo privado / JSON corrompido): o padrão novo vale para o que for criado daqui
    // para frente e nada é destruído.
  }
  return result;
}
