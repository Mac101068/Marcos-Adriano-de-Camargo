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

export interface FlowScoreBreakdown {
  deltaScore: number;
  divergenceScore: number;
  cvdScore: number;
  erScore: number;
  speedScore: number;
  totalScore: number;
}

export interface ConvergenceResult {
  isConvergence: boolean;
  type?: 'BUY_CONVERGENCE' | 'SELL_CONVERGENCE' | 'DIVERGENCE';
  signal?: 'BUY' | 'SELL';
  reason?: string;
  flowScore?: number;
  flowScoreBreakdown?: FlowScoreBreakdown;
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

/**
 * Divergência de fluxo do box: fração do volume total que é agressão LÍQUIDA (|Δ| ÷ volume).
 * 1 = tudo para um lado (convicção); ~0 = volume empatado/sem informação (leilão, box fantasma
 * de interpolação). Escala-free: sobrevive a mudanças de grandeza de volume (proxy M1_RATE,
 * volatilidade de eleição) porque só olha a PROPORÇÃO, nunca o número de contratos.
 */
function flowDivergence(box: RenkoBox): number {
  const vol = box.totalVolume ?? 0;
  if (vol <= 0) return 0;
  return Math.min(1, Math.abs(box.delta ?? 0) / vol);
}

/**
 * Calcula o Score de Convicção Institucional de Fluxo (0 a 10 pontos)
 */
export function computeFlowConvictionScore(
  box: RenkoBox,
  previousBoxes: RenkoBox[],
  config: AutomationConfig,
  direction: 'UP' | 'DOWN',
  meter?: SessionRegimeMeter
): { totalScore: number; breakdown: FlowScoreBreakdown } {
  const delta = Math.abs(box.delta ?? 0);
  const side = direction === 'UP' ? 'BUY' : 'SELL';
  const baseThresh = config.minDeltaThreshold ?? 150;

  // 1. Delta vs percentis do regime
  let ptsDelta = 0;
  if (meter) {
    const p90 = meter.getSelfCalibratedLimit(side, 0.90, 1.6, baseThresh);
    const p80 = meter.getSelfCalibratedLimit(side, 0.80, 1.4, baseThresh);
    const p70 = meter.getSelfCalibratedLimit(side, 0.70, 1.2, baseThresh);
    if (delta >= p90) ptsDelta = 3;
    else if (delta >= p80) ptsDelta = 2;
    else if (delta >= p70) ptsDelta = 1;
  } else {
    if (delta >= baseThresh * 2.0) ptsDelta = 3;
    else if (delta >= baseThresh * 1.5) ptsDelta = 2;
    else if (delta >= baseThresh) ptsDelta = 1;
  }

  // 2. Divergência
  const div = flowDivergence(box);
  let ptsDiv = 0;
  if (div >= 0.35) ptsDiv = 2;
  else if (div >= 0.20) ptsDiv = 1;

  // 3. CVD
  let ptsCvd = 0;
  const cvd = box.cvdAtClose ?? 0;
  if (previousBoxes.length > 0) {
    const allPrevCvd = previousBoxes.map((b) => b.cvdAtClose);
    if (direction === 'UP' && cvd >= Math.max(...allPrevCvd)) ptsCvd = 2;
    else if (direction === 'DOWN' && cvd <= Math.min(...allPrevCvd)) ptsCvd = 2;
    else if (allPrevCvd.length >= 2) {
      const lastFew = allPrevCvd.slice(-3);
      if (direction === 'UP' && lastFew.every((v, i, a) => i === 0 || v >= a[i - 1])) ptsCvd = 1;
      else if (direction === 'DOWN' && lastFew.every((v, i, a) => i === 0 || v <= a[i - 1])) ptsCvd = 1;
    }
  } else {
    ptsCvd = 1;
  }

  // 4. Efficiency Ratio
  const er = efficiencyRatio(previousBoxes, box, 10);
  let ptsEr = 0;
  if (er >= 0.70) ptsEr = 2;
  else if (er >= 0.45) ptsEr = 1;

  // 5. Velocidade
  let ptsSpeed = 0;
  const tStart = box.timeStart ?? 0;
  const tEnd = box.timestamp ?? 0;
  if (tStart > 0 && tEnd > tStart) {
    const curDur = (tEnd - tStart) / 1000;
    const recentDurs = previousBoxes
      .slice(-10)
      .filter((b) => (b.timestamp ?? 0) > (b.timeStart ?? 0))
      .map((b) => ((b.timestamp ?? 0) - (b.timeStart ?? 0)) / 1000);
    if (recentDurs.length > 0) {
      const avgDur = recentDurs.reduce((a, b) => a + b, 0) / recentDurs.length;
      if (curDur <= avgDur * 0.4 && curDur >= 0.1) ptsSpeed = 1;
    } else if (curDur < 10) {
      ptsSpeed = 1;
    }
  }

  const totalScore = Math.min(10, Math.max(0, ptsDelta + ptsDiv + ptsCvd + ptsEr + ptsSpeed));
  const breakdown: FlowScoreBreakdown = {
    deltaScore: ptsDelta,
    divergenceScore: ptsDiv,
    cvdScore: ptsCvd,
    erScore: ptsEr,
    speedScore: ptsSpeed,
    totalScore,
  };
  return { totalScore, breakdown };
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

  // Corte do momento: auto-calibrado (percentil da sessão + piso relativo à média do dia) ou limiar estático
  const adaptive = config.adaptiveThresholdEnabled === true && meter !== undefined;
  // Percentil efetivo configurável (funil seletivo). Sem o campo, mantém o P60 histórico.
  const SESSION_PERCENTILE = config.adaptiveThresholdPercentile ?? 0.6;
  // Piso relativo (multiplicador da média do próprio dia, sem valor físico). Sem campo, 1,3×.
  const FLOOR_MULTIPLE = config.adaptiveFloorMultiple ?? 1.3;
  const limitBuy = adaptive ? meter!.getSelfCalibratedLimit('BUY', SESSION_PERCENTILE, FLOOR_MULTIPLE, config.minDeltaThreshold) : config.minDeltaThreshold;
  const limitSell = adaptive ? meter!.getSelfCalibratedLimit('SELL', SESSION_PERCENTILE, FLOOR_MULTIPLE, config.minDeltaThreshold) : config.minDeltaThreshold;
  const factorLabel = adaptive ? ' | limiar = auto-calibrado do pregão' : '';

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
    // Corte opcional e escala-free (undefined = não aplica): só vale box com divergência de
    // fluxo acima do mínimo — volume empatado ou box fantasma de interpolação não sinaliza.
    if (config.flowDivergenceMin !== undefined && flowDivergence(box) < config.flowDivergenceMin) {
      return { isConvergence: false };
    }
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
      // 3. Confluência de CVD (opcional, default OFF): mesma regra do Reteste — o box só vale
      // se o CVD fechar em nova máxima em relação aos 3 boxes anteriores.
      if (config.requireCvdNewExtreme && previousBoxes.length >= 3) {
        const maxPrevCvd = Math.max(...previousBoxes.slice(-3).map((b) => b.cvdAtClose));
        if (box.cvdAtClose < maxPrevCvd) {
          return { isConvergence: false };
        }
      }
      const { totalScore, breakdown } = computeFlowConvictionScore(box, previousBoxes, config, 'UP', meter);
      return {
        isConvergence: true,
        type: 'BUY_CONVERGENCE',
        signal: 'BUY',
        flowScore: totalScore,
        flowScoreBreakdown: breakdown,
        reason: `Pirâmide Confluência Alta: Bloco Verde #${box.index} [Score ${totalScore}/10] (${gainUp}) | Δ: +${box.delta} (≥${reqBuyDelta})`,
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
      // 3. Confluência de CVD (opcional, default OFF): espelho da regra de alta — exige nova
      // mínima de CVD nos 3 boxes anteriores.
      if (config.requireCvdNewExtreme && previousBoxes.length >= 3) {
        const minPrevCvd = Math.min(...previousBoxes.slice(-3).map((b) => b.cvdAtClose));
        if (box.cvdAtClose > minPrevCvd) {
          return { isConvergence: false };
        }
      }
      const { totalScore, breakdown } = computeFlowConvictionScore(box, previousBoxes, config, 'DOWN', meter);
      return {
        isConvergence: true,
        type: 'SELL_CONVERGENCE',
        signal: 'SELL',
        flowScore: totalScore,
        flowScoreBreakdown: breakdown,
        reason: `Pirâmide Confluência Baixa: Bloco Vermelho #${box.index} [Score ${totalScore}/10] (${gainDown}) | Δ: ${box.delta} (≤-${reqSellDelta})`,
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
