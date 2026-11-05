import { DEFAULT_EA_CONFIG } from '../services/eaConfigService';

/**
 * Migração única da Alavanca B — "Desligar o Filtro de Acumulação (Efficiency Ratio)".
 *
 * Por que existe: a sugestão era tornar o funil MAIS SELETIVO. O banco A/B headless (motor +
 * contabilidade idênticos ao terminal), rodado em 3 seeds sintéticas distintas e na base real,
 * mostrou o CONTRÁRIO: em 10R o filtro ER ligado está SOBRE-filtrando — ele silencia scalps de
 * pirâmide que fecham TP. Com o filtro OFF a expectativa sai de ~+2,0 para ~+5,4 R$/trade, o
 * fator sobe de ~1,10 para ~1,68 e o rebaixamento CAI, nas três seeds. Desligar também restaura o
 * "Padrão DESLIGADO" que o próprio tipo `consolidationFilterEnabled` documenta.
 *
 * A "regra que já mordeu" obriga esta migração: `loadSavedConfig` faz `{...DEFAULT, ...salvo}`,
 * então o valor gravado SEMPRE vence o padrão novo — mudar só o DEFAULT não faria nada numa
 * máquina que já salvou a estratégia.
 *
 * Segurança (conservadorismo): só é tocada estratégia em MODO PIRÂMIDE cujo filtro está no valor
 * SEMEAR default (ligado com `consolidationErMax === 0.35`). Quem mexeu no limiar de ER por conta
 * própria NÃO é tocado. Roda uma vez por versão de flag e cobre config ativa + biblioteca do
 * Estúdio. É reversível pela mesma caixinha em Ajustes → Filtros de Regime.
 */

const CONFIG_KEY = 'fluxo_renko_ea_config_v3';
const LIBRARY_KEY = 'fluxo_strategy_library_v1';
const DONE_FLAG = 'fluxo_renko_consolidation_off_v1';
/** Valor de `consolidationErMax` que existia quando ligamos o filtro por engano. */
const SEEDED_ER_MAX = 0.35;

type LooseConfig = Record<string, unknown> & {
  strategyMode?: string;
  consolidationFilterEnabled?: boolean;
  consolidationErMax?: number;
};

/** É Pirâmide com o filtro ER ainda no default intocado (ligado e limiar 0.35)? */
function isUntouchedPyramidConsolidation(raw: unknown): raw is LooseConfig {
  if (!raw || typeof raw !== 'object') return false;
  const c = raw as LooseConfig;
  return (
    c.strategyMode === 'PYRAMID_FLOW_CONFLUENCE' &&
    c.consolidationFilterEnabled === true &&
    c.consolidationErMax === SEEDED_ER_MAX
  );
}

/** Desliga o filtro ER (mesmo valor do padrão novo), preservando o limiar configurado. */
function withConsolidationOff(c: LooseConfig): LooseConfig {
  return { ...c, consolidationFilterEnabled: DEFAULT_EA_CONFIG.consolidationFilterEnabled };
}

export function migrateConsolidationFilterOff(): { config: boolean; strategies: number } {
  const result = { config: false, strategies: 0 };
  try {
    if (localStorage.getItem(DONE_FLAG)) return result;

    const rawConfig = localStorage.getItem(CONFIG_KEY);
    if (rawConfig) {
      const parsed = JSON.parse(rawConfig);
      if (isUntouchedPyramidConsolidation(parsed)) {
        localStorage.setItem(CONFIG_KEY, JSON.stringify(withConsolidationOff(parsed)));
        result.config = true;
      }
    }

    const rawLibrary = localStorage.getItem(LIBRARY_KEY);
    if (rawLibrary) {
      const list = JSON.parse(rawLibrary);
      if (Array.isArray(list)) {
        let touched = 0;
        const migrated = list.map((strategy: Record<string, unknown>) => {
          if (!strategy || !isUntouchedPyramidConsolidation(strategy.config)) return strategy;
          touched += 1;
          return { ...strategy, config: withConsolidationOff(strategy.config as LooseConfig) };
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
