import { DEFAULT_EA_CONFIG } from '../services/eaConfigService';

/**
 * Migração única — "Baixar o Δ físico do funil (150 → 100)" na Pirâmide.
 *
 * Por que existe: com o limiar ADAPTATIVO desligado (ver adaptiveThresholdMigration), quem manda no
 * disparo é o `minDeltaThreshold` FÍSICO. No banco A/B headless (motor + contabilidade idênticos ao
 * terminal), em 3 seeds sintéticas, Δ 100 dominou Δ 150: mais ordens, fator de lucro maior
 * (ex.: 1,71 → 1,90) e rebaixamento menor. O padrão novo do Δ virou 100.
 *
 * A "regra que já mordeu" obriga esta migração: `loadSavedConfig` faz `{...DEFAULT, ...salvo}`,
 * então o Δ gravado (150) venceria o padrão novo — mudar só o DEFAULT não faria nada numa máquina
 * que já salvou a estratégia. Roda DEPOIS da migração do adaptativo (a do adaptativo não mexe no Δ,
 * então o Δ ainda está em 150 quando esta é chamada).
 *
 * Segurança (conservadorismo): só é tocada estratégia em MODO PIRÂMIDE com o Δ AINDA no valor padrão
 * antigo (`minDeltaThreshold === 150`), isto é, que nunca calibrou o limiar por conta própria. Quem
 * baixou/subiu o Δ não é tocado. Roda uma vez por versão de flag e cobre config ativa + biblioteca.
 * É reversível no mesmo campo em Ajustes → Gatilho ("Delta mínimo").
 */

const CONFIG_KEY = 'fluxo_renko_ea_config_v3';
const LIBRARY_KEY = 'fluxo_strategy_library_v1';
const DONE_FLAG = 'fluxo_renko_delta100_v1';
/** Δ padrão antigo intocado; só migramos quem nunca o alterou. */
const SEEDED_MIN_DELTA = 150;

type LooseConfig = Record<string, unknown> & {
  strategyMode?: string;
  minDeltaThreshold?: number;
};

/** É Pirâmide com o Δ ainda no default antigo (150)? */
function isUntouchedPyramidDelta(raw: unknown): raw is LooseConfig {
  if (!raw || typeof raw !== 'object') return false;
  const c = raw as LooseConfig;
  return (
    c.strategyMode === 'PYRAMID_FLOW_CONFLUENCE' &&
    c.minDeltaThreshold === SEEDED_MIN_DELTA
  );
}

/** Aplica o Δ físico do padrão novo (100). */
function withDeltaLowered(c: LooseConfig): LooseConfig {
  return { ...c, minDeltaThreshold: DEFAULT_EA_CONFIG.minDeltaThreshold };
}

export function migrateDeltaThresholdTo100(): { config: boolean; strategies: number } {
  const result = { config: false, strategies: 0 };
  try {
    if (localStorage.getItem(DONE_FLAG)) return result;

    const rawConfig = localStorage.getItem(CONFIG_KEY);
    if (rawConfig) {
      const parsed = JSON.parse(rawConfig);
      if (isUntouchedPyramidDelta(parsed)) {
        localStorage.setItem(CONFIG_KEY, JSON.stringify(withDeltaLowered(parsed)));
        result.config = true;
      }
    }

    const rawLibrary = localStorage.getItem(LIBRARY_KEY);
    if (rawLibrary) {
      const list = JSON.parse(rawLibrary);
      if (Array.isArray(list)) {
        let touched = 0;
        const migrated = list.map((strategy: Record<string, unknown>) => {
          if (!strategy || !isUntouchedPyramidDelta(strategy.config)) return strategy;
          touched += 1;
          return { ...strategy, config: withDeltaLowered(strategy.config as LooseConfig) };
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
