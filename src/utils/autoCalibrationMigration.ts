import { DEFAULT_EA_CONFIG } from '../services/eaConfigService';

/**
 * Migração única — "Funil AUTO-CALIBRADO do pregão" na Pirâmide.
 *
 * Por que existe: o operador relatou que o limiar FÍSICO fixo não dura num mercado de renda
 * variável (volatilidade de eleição) e perdeu dinheiro ao vivo num dia lateralizado. Na base
 * real da ponte (proxy M1_RATE) os Δ nem siquiera estão na escala de contratos reais — um
 * número travado ali não mede agressão nenhuma. O funil novo não usa valor físico: o corte é
 * o MAIOR entre o P60 das agressões do PRÓPRIO dia e 1,3× a média do dia (piso: dia morto não
 * afrouxa o funil), e só vale box cuja divergência de fluxo (|Δ| ÷ volume do tijolo) é ≥ 40%
 * — uma FRAÇÃO, imune à escala. Banco headless na base real (WINZ26, 11 pregões): Auto P60×1,3
 * cortou trades 3545→1579, PF 2,43→3,94, DD R$ 759→318; Auto+diverg.40% foi o único braço com
 * TODOS os pregões positivos. No sintético o físico ainda vence em PnL (lá o volume tem escala
 * real) — aceitamos o trade-off porque a régua relativa é a única medição honesta sem T&T
 * genuíno, e é ela que roda na corretora.
 *
 * A "regra que já mordeu" obriga esta migração: `loadSavedConfig` faz `{...DEFAULT, ...salvo}`,
 * então o `adaptiveThresholdEnabled: false` gravado venceria o padrão novo. Roda DEPOIS da
 * migração do Δ50, então o "Δ nunca tocado" aqui é exatamente 50.
 *
 * Segurança (conservadorismo): só é tocada estratégia em MODO PIRÂMIDE que ainda está no
 * pacote padrão intocado (`adaptiveThresholdEnabled === false`, `minDeltaThreshold === 50` e
 * sem o campo `flowDivergenceMin` — quem calibrou por conta própria não é tocado). Roda uma
 * vez por versão de flag e cobre config ativa + biblioteca. Reversível em Ajustes → Gatilho:
 * desmarque "Limiar Auto-Calibrado do Pregão" e leve "Divergência de Fluxo" a 0%.
 */

const CONFIG_KEY = 'fluxo_renko_ea_config_v3';
const LIBRARY_KEY = 'fluxo_strategy_library_v1';
const DONE_FLAG = 'fluxo_renko_autocal_v1';

type LooseConfig = Record<string, unknown> & {
  strategyMode?: string;
  minDeltaThreshold?: number;
  adaptiveThresholdEnabled?: boolean;
  flowDivergenceMin?: number;
};

/** É Pirâmide com o funil ainda no pacote padrão antigo (adaptativo OFF, Δ50, sem divergência)? */
function isUntouchedPyramidFunnel(raw: unknown): raw is LooseConfig {
  if (!raw || typeof raw !== 'object') return false;
  const c = raw as LooseConfig;
  return (
    c.strategyMode === 'PYRAMID_FLOW_CONFLUENCE' &&
    c.adaptiveThresholdEnabled === false &&
    c.minDeltaThreshold === 50 &&
    c.flowDivergenceMin === undefined
  );
}

/** Aplica o pacote auto-calibrado do padrão novo (campos e valores vêm do DEFAULT atual). */
function withAutoCalibration(c: LooseConfig): LooseConfig {
  return {
    ...c,
    adaptiveThresholdEnabled: DEFAULT_EA_CONFIG.adaptiveThresholdEnabled,
    flowDivergenceMin: DEFAULT_EA_CONFIG.flowDivergenceMin,
  };
}

export function migrateAutoCalibratedFunnel(): { config: boolean; strategies: number } {
  const result = { config: false, strategies: 0 };
  try {
    if (localStorage.getItem(DONE_FLAG)) return result;

    const rawConfig = localStorage.getItem(CONFIG_KEY);
    if (rawConfig) {
      const parsed = JSON.parse(rawConfig);
      if (isUntouchedPyramidFunnel(parsed)) {
        localStorage.setItem(CONFIG_KEY, JSON.stringify(withAutoCalibration(parsed)));
        result.config = true;
      }
    }

    const rawLibrary = localStorage.getItem(LIBRARY_KEY);
    if (rawLibrary) {
      const list = JSON.parse(rawLibrary);
      if (Array.isArray(list)) {
        let touched = 0;
        const migrated = list.map((strategy: Record<string, unknown>) => {
          if (!strategy || !isUntouchedPyramidFunnel(strategy.config)) return strategy;
          touched += 1;
          return { ...strategy, config: withAutoCalibration(strategy.config as LooseConfig) };
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
