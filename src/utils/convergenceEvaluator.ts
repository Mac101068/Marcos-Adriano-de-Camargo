import { RenkoBox, AutomationConfig } from '../types/trading';
import { SessionRegimeMeter } from './sessionRegime';

/**
 * Avaliador de convergência Preço x Fluxo compartilhado entre as três séries:
 * Pontos (Renko), Range e Tempo. Todas as barras chegam no formato RenkoBox,
 * então a mesma estratégia clássica mede a eficiência dos três gráficos.
 *
 * Inclui:
 * 1. Filtro mandatório de Delta Institucional (minDeltaThreshold)
 * 2. Filtro de Consolidação (Efficiency Ratio de Kaufman)
 * 3. Filtro de Exaustão de Fluxo
 */

export interface ConvergenceResult {
  isConvergence: boolean;
  type?: 'BUY_CONVERGENCE' | 'SELL_CONVERGENCE' | 'DIVERGENCE';
  signal?: 'BUY' | 'SELL';
  reason?: string;
}

export interface ConvergenceSeriesLabels {
  priceLabel?: string;
  gainLabelUp?: string;
  gainLabelDown?: string;
}

/**
 * Efficiency Ratio (Kaufman) das últimas `lookback` barras fechadas:
 * |deslocamento líquido| ÷ Σ|passo a passo|. Próximo de 1 = tendência limpa; perto de 0 =
 * o mercado gira em círculo (acumulação/range curto).
 */
function efficiencyRatio(previousBoxes: RenkoBox[], box: RenkoBox, lookback: number): number {
  const k = Math.max(2, Math.round(lookback) || 10);
  const series = [...previousBoxes.slice(-(k - 1)), box];
  if (series.length < k) return 1;
  let path = 0;
  for (let i = 1; i < series.length; i++) path += Math.abs(series[i].close - series[i - 1].close);
  if (path <= 0) return 1;
  const net = Math.abs(series[series.length - 1].close - series[0].close);
  return Math.min(1, net / path);
}

/**
 * Exaustão de fluxo: a agressão do box atual caiu a `ratio` (ou menos) da do último box
 * anterior DO MESMO LADO.
 */
function isExhaustedFlow(previousBoxes: RenkoBox[], box: RenkoBox, ratio: number): boolean {
  const d = box.delta ?? 0;
  if (d === 0) return false;
  for (let i = previousBoxes.length - 1; i >= 0; i--) {
    const pd = previousBoxes[i].delta ?? 0;
    if (pd !== 0 && Math.sign(pd) === Math.sign(d)) {
      return Math.abs(d) <= Math.abs(pd) * ratio;
    }
  }
  return false;
}

export function evaluateBoxConvergence(
  box: RenkoBox,
  config: AutomationConfig,
  previousBoxes: RenkoBox[],
  labels: ConvergenceSeriesLabels = {},
  meter?: SessionRegimeMeter
): ConvergenceResult {
  const priceLabel = labels.priceLabel ?? `Preço ${config.boxPoints} pts`;
  const gainUp = labels.gainLabelUp ?? `+${config.boxPoints} pts`;
  const gainDown = labels.gainLabelDown ?? `-${config.boxPoints} pts`;

  // Corte do momento: adaptativo (P60 das agressões) ou limiar estático da config
  const adaptive = config.adaptiveThresholdEnabled === true && meter !== undefined;
  const SESSION_PERCENTILE = 0.6;
  const limitBuy = adaptive ? meter!.getPercentileLimit('BUY', SESSION_PERCENTILE, config.minDeltaThreshold) : config.minDeltaThreshold;
  const limitSell = adaptive ? meter!.getPercentileLimit('SELL', SESSION_PERCENTILE, config.minDeltaThreshold) : config.minDeltaThreshold;
  const factorLabel = adaptive ? ' | limiar = P60 do pregão' : '';

  // Filtros de regime: CONSOLIDAÇÃO (range curto) e EXAUSTÃO
  const consolidating =
    config.consolidationFilterEnabled === true &&
    efficiencyRatio(previousBoxes, box, config.consolidationLookbackBoxes ?? 10) <
      (config.consolidationErMax ?? 0.35);
  const exhausting =
    config.exhaustionFilterEnabled === true &&
    isExhaustedFlow(previousBoxes, box, config.exhaustionDeltaRatio ?? 0.7);
  const regimeBlock = consolidating || exhausting;

  // SE A ESTRATÉGIA ATIVA FOR: PIRÂMIDE DE CONFLUÊNCIA FLUXO & RENKO
  if (config.strategyMode === 'PYRAMID_FLOW_CONFLUENCE') {
    // Exige delta institucional representativo (mínimo de 150 a 250 contratos no WIN)
    const reqBuyDelta = adaptive ? limitBuy : Math.max(50, config.minDeltaThreshold ?? 150);
    const reqSellDelta = adaptive ? limitSell : Math.max(50, config.minDeltaThreshold ?? 150);

    if (box.direction === 'UP') {
      // 1. Delta deve ser positivo e superior ao limiar institucional
      if (box.delta < reqBuyDelta) {
        return { isConvergence: false };
      }
      // 2. Filtro de regime (consolidação / exaustão)
      if (regimeBlock) {
        return { isConvergence: false };
      }
      return {
        isConvergence: true,
        type: 'BUY_CONVERGENCE',
        signal: 'BUY',
        reason: `Pirâmide Confluência Alta: Bloco Verde #${box.index} (${gainUp}) | Δ: +${box.delta} (≥${reqBuyDelta})`,
      };
    } else if (box.direction === 'DOWN') {
      // 1. Delta deve ser negativo e superior ao limiar institucional
      if (box.delta > -reqSellDelta) {
        return { isConvergence: false };
      }
      // 2. Filtro de regime (consolidação / exaustão)
      if (regimeBlock) {
        return { isConvergence: false };
      }
      return {
        isConvergence: true,
        type: 'SELL_CONVERGENCE',
        signal: 'SELL',
        reason: `Pirâmide Confluência Baixa: Bloco Vermelho #${box.index} (${gainDown}) | Δ: ${box.delta} (≤-${reqSellDelta})`,
      };
    }
    return { isConvergence: false };
  }

  // CONVERGÊNCIA COMPRADORA (MODO CLÁSSICO RETESTE / BREAKOUT):
  if (box.direction === 'UP') {
    if (box.delta >= limitBuy) {
      let cvdOk = true;
      if (config.requireCvdNewExtreme && previousBoxes.length >= 3) {
        const recentBoxes = previousBoxes.slice(-3);
        const maxPrevCvd = Math.max(...recentBoxes.map((b) => b.cvdAtClose));
        cvdOk = box.cvdAtClose >= maxPrevCvd;
      }

      if (cvdOk && !regimeBlock) {
        return {
          isConvergence: true,
          type: 'BUY_CONVERGENCE',
          signal: 'BUY',
          reason: `Convergência Compradora: ${priceLabel} Alta (${gainUp}) + Delta Agressão +${box.delta} ctros${adaptive ? ` (limiar ${limitBuy}${factorLabel})` : ''}`,
        };
      }
    } else if (box.delta < 0) {
      return {
        isConvergence: false,
        type: 'DIVERGENCE',
      };
    }
  }

  // CONVERGÊNCIA VENDEDORA:
  if (box.direction === 'DOWN') {
    if (box.delta <= -limitSell) {
      let cvdOk = true;
      if (config.requireCvdNewExtreme && previousBoxes.length >= 3) {
        const recentBoxes = previousBoxes.slice(-3);
        const minPrevCvd = Math.min(...recentBoxes.map((b) => b.cvdAtClose));
        cvdOk = box.cvdAtClose <= minPrevCvd;
      }

      if (cvdOk && !regimeBlock) {
        return {
          isConvergence: true,
          type: 'SELL_CONVERGENCE',
          signal: 'SELL',
          reason: `Convergência Vendedora: ${priceLabel} Baixa (${gainDown}) + Delta Agressão ${box.delta} ctros${adaptive ? ` (limiar -${limitSell}${factorLabel})` : ''}`,
        };
      }
    } else if (box.delta > 0) {
      return {
        isConvergence: false,
        type: 'DIVERGENCE',
      };
    }
  }

  return { isConvergence: false };
}
