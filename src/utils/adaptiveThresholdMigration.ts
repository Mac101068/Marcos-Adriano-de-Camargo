import { DEFAULT_EA_CONFIG } from '../services/eaConfigService';

/**
 * Migração única — "Desligar o Limiar Adaptativo (P60)" da Pirâmide.
 *
 * Por que existe: com o adaptativo LIGADO, o corte de agressão é o P60 das agressões do próprio
 * pregão (`getPercentileLimit`). Em testes ao vivo isso virava "SINAL FRACO": o limiar subia acima
 * do Δ dos boxes e o robô parava de abrir. O banco A/B headless (motor + contabilidade idênticos ao
 * terminal), em 3 seeds sintéticas, mostrou que desligar o adaptativo e usar o Δ FÍSICO da config é
 * estritamente melhor: mais ordens, rebaixamento ~30% menor (ex.: 555 → 370) e expectativa/fator
 * iguais ou melhores. O padrão novo virou `adaptiveThresholdEnabled: false`.
 *
 * A "regra que já mordeu" obriga esta migração: `loadSavedConfig` faz `{...DEFAULT, ...salvo}`,
 * então o valor gravado SEMPRE vence o padrão novo — mudar só o DEFAULT não faria nada numa máquina
 * que já salvou a estratégia com o adaptativo ligado.
 *
 * Segurança (conservadorismo): só é tocada estratégia em MODO PIRÂMIDE com o adaptativo LIGADO e o
 * Δ AINDA no valor padrão (`minDeltaThreshold === 150`), isto é, que nunca calibrou o limiar por
 * conta própria. Quem baixou/subiu o Δ não é tocado. Roda uma vez por versão de flag e cobre config
 * ativa + biblioteca do Estúdio. É reversível na mesma caixinha em Ajustes → Gatilho.
 */

const CONFIG_KEY = 'fluxo_renko_ea_config_v3';
const LIBRARY_KEY = 'fluxo_strategy_library_v1';
const DONE_FLAG = 'fluxo_renko_adaptive_off_v1';
/** Δ mínimo padrão que acompanhou o adaptativo ligado; só migramos quem nunca o alterou. */
const SEEDED_MIN_DELTA = 150;

type LooseConfig = Record<string, unknown> & {
  strategyMode?: string;
  adaptiveThresholdEnabled?: boolean;
  minDeltaThreshold?: number;
};

/** É Pirâmide com adaptativo ligado e Δ ainda no default intocado (150)? */
function isUntouchedPyramidAdaptive(raw: unknown): raw is LooseConfig {
  if (!raw || typeof raw !== 'object') return false;
  const c = raw as LooseConfig;
  return (
    c.strategyMode === 'PYRAMID_FLOW_CONFLUENCE' &&
    c.adaptiveThresholdEnabled === true &&
    c.minDeltaThreshold === SEEDED_MIN_DELTA
  );
}

/** Desliga o limiar adaptativo (mesmo valor do padrão novo). */
function withAdaptiveOff(c: LooseConfig): LooseConfig {
  return { ...c, adaptiveThresholdEnabled: DEFAULT_EA_CONFIG.adaptiveThresholdEnabled };
}

export function migrateAdaptiveThresholdOff(): { config: boolean; strategies: number } {
  const result = { config: false, strategies: 0 };
  try {
    if (localStorage.getItem(DONE_FLAG)) return result;

    const rawConfig = localStorage.getItem(CONFIG_KEY);
    if (rawConfig) {
      const parsed = JSON.parse(rawConfig);
      if (isUntouchedPyramidAdaptive(parsed)) {
        localStorage.setItem(CONFIG_KEY, JSON.stringify(withAdaptiveOff(parsed)));
        result.config = true;
      }
    }

    const rawLibrary = localStorage.getItem(LIBRARY_KEY);
    if (rawLibrary) {
      const list = JSON.parse(rawLibrary);
      if (Array.isArray(list)) {
        let touched = 0;
        const migrated = list.map((strategy: Record<string, unknown>) => {
          if (!strategy || !isUntouchedPyramidAdaptive(strategy.config)) return strategy;
          touched += 1;
          return { ...strategy, config: withAdaptiveOff(strategy.config as LooseConfig) };
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
