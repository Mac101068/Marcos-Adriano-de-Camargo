import { DEFAULT_EA_CONFIG } from '../services/eaConfigService';

/**
 * Migração única — "Baixar o Δ físico do funil (100 → 50)" na Pirâmide.
 *
 * Por que existe: com o limiar ADAPTATIVO desligado, quem manda no disparo é o
 * `minDeltaThreshold` FÍSICO. No banco A/B headless (motor + contabilidade idênticos ao terminal),
 * em 10 réplicas × 10 dias sintéticos, Δ 50 dominou Δ 100 em TODOS os eixos e em 10/10 réplicas:
 * PnL +23% (R$ 159 mil → R$ 196 mil), fator 1,93 → 2,06, expectativa 5,90 → 6,12 e rebaixamento
 * −28% (R$ 649 → R$ 469). Abaixo de ~50 é platô (o floor deixa de pegar box novo). O padrão virou 50.
 *
 * A "regra que já mordeu" obriga esta migração: `loadSavedConfig` faz `{...DEFAULT, ...salvo}`, então
 * o Δ gravado (100) venceria o padrão novo — mudar só o DEFAULT não faria nada numa máquina que já
 * salvou. Roda DEPOIS da migração 150→100, então quem estava em 150 já chegou a 100 aqui.
 *
 * Segurança (conservadorismo): só é tocada estratégia em MODO PIRÂMIDE com o Δ AINDA no valor padrão
 * antigo (`minDeltaThreshold === 100`), isto é, que nunca calibrou o limiar por conta própria. Quem
 * ajustou o Δ não é tocado. Roda uma vez por versão de flag e cobre config ativa + biblioteca.
 * É reversível em Ajustes → Gatilho ("Delta mínimo").
 *
 * Nota de honestidade: calibrado em dado SINTÉTICO; a base real da ponte chega M1_RATE (proxy de
 * preço), então o valor ótimo no T&T genuíno pode mudar quando houver fita real de volume.
 */

const CONFIG_KEY = 'fluxo_renko_ea_config_v3';
const LIBRARY_KEY = 'fluxo_strategy_library_v1';
const DONE_FLAG = 'fluxo_renko_delta50_v1';
/** Δ padrão antigo intocado; só migramos quem nunca o alterou. */
const SEEDED_MIN_DELTA = 100;

type LooseConfig = Record<string, unknown> & {
  strategyMode?: string;
  minDeltaThreshold?: number;
};

/** É Pirâmide com o Δ ainda no default antigo (100)? */
function isUntouchedPyramidDelta(raw: unknown): raw is LooseConfig {
  if (!raw || typeof raw !== 'object') return false;
  const c = raw as LooseConfig;
  return (
    c.strategyMode === 'PYRAMID_FLOW_CONFLUENCE' &&
    c.minDeltaThreshold === SEEDED_MIN_DELTA
  );
}

/** Aplica o Δ físico do padrão novo (50). */
function withDeltaLowered(c: LooseConfig): LooseConfig {
  return { ...c, minDeltaThreshold: DEFAULT_EA_CONFIG.minDeltaThreshold };
}

export function migrateDeltaThresholdTo50(): { config: boolean; strategies: number } {
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
