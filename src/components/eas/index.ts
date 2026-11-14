import { HEDGE_DIRECIONAL_PRESETS } from './hedge-direcional';
import { PIRAMIDE_10R_PRESETS } from './piramide-10r';
import { JANELA_FLUXO_PRESETS } from './janela-fluxo';
import { ACUMULACAO_CV_PRESETS } from './acumulacao-cv';
import { RETESTE_10R_PRESETS } from './reteste-10r';
import { SCALPER_10R_PRESETS } from './scalper-10r';
import { TREND_10R_PRESETS } from './trend-10r';
import { StrategyFamily } from '../../services/directionalRobotService';

export const PRESETS_BY_STRATEGY: Record<
  string,
  Array<{ label: string; patch: Record<string, any> }>
> = {
  HEDGE_DIRECIONAL: HEDGE_DIRECIONAL_PRESETS,
  PIRAMIDE_10R: PIRAMIDE_10R_PRESETS,
  JANELA_FLUXO: JANELA_FLUXO_PRESETS,
  ACUMULACAO_CV: ACUMULACAO_CV_PRESETS,
  RETESTE_10R: RETESTE_10R_PRESETS,
  SCALPER_10R: SCALPER_10R_PRESETS,
  TREND_10R: TREND_10R_PRESETS,
};

export function getPresetsForStrategy(family: StrategyFamily) {
  return PRESETS_BY_STRATEGY[family] || HEDGE_DIRECIONAL_PRESETS;
}

