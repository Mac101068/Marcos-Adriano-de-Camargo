import type { RenkoBox } from '../types/trading';

export interface FlowCyclePoint {
  boxIndex: number;
  price: number;
  timestamp: number;
  deltaNorm: number;       // Delta relativo instantâneo: (Buy - Sell) / Total [-100, 100]
  deltaEma: number;        // Suavização exponencial do delta
  cvdMomentum: number;     // Momentum do CVD normalizado [-100, 100]
  speedMultiplier: number; // Multiplicador de agressividade por velocidade/volume
  oscillator: number;      // Valor composto do oscilador [-100, 100]
  signal: number;          // Linha de sinal suavizada (EMA do oscilador)
  histogram: number;       // Aceleração da onda: oscillator - signal
  phase: 'EXPANSION_BUY' | 'EXHAUSTION_BUY' | 'EXPANSION_SELL' | 'EXHAUSTION_SELL' | 'NEUTRAL';
  divergence: 'BULLISH_ABSORPTION' | 'BEARISH_ABSORPTION' | null;
}

export interface FlowCycleSummary {
  currentValue: number;
  currentSignal: number;
  currentHistogram: number;
  currentPhase: FlowCyclePoint['phase'];
  currentDivergence: FlowCyclePoint['divergence'];
  cycleStrengthPct: number;
  phaseLabel: string;
}

export interface FlowCycleConfig {
  deltaPeriod?: number;     // Período para suavização do Delta (padrão: 7 boxes)
  cvdPeriod?: number;       // Período da linha base do CVD (padrão: 18 boxes)
  signalPeriod?: number;    // Período da linha de sinal (padrão: 5 boxes)
  overboughtLevel?: number; // Nível de sobrecompra/topo de ciclo (padrão: 50)
  oversoldLevel?: number;   // Nível de sobrevenda/fundo de ciclo (padrão: -50)
}

/**
 * Calcula a curva do Oscilador de Ciclos de Fluxo baseando-se em microestrutura
 * de agressão, taxa de variação do CVD e intensidade de ticks/volume por box.
 */
export function calculateFlowCycles(
  boxes: RenkoBox[],
  config: FlowCycleConfig = {}
): FlowCyclePoint[] {
  if (!boxes || boxes.length === 0) return [];

  const deltaPeriod = Math.max(3, config.deltaPeriod ?? 7);
  const cvdPeriod = Math.max(5, config.cvdPeriod ?? 18);
  const signalPeriod = Math.max(2, config.signalPeriod ?? 5);
  const ob = config.overboughtLevel ?? 50;
  const os = config.oversoldLevel ?? -50;

  const alphaDelta = 2 / (deltaPeriod + 1);
  const alphaCvd = 2 / (cvdPeriod + 1);
  const alphaSignal = 2 / (signalPeriod + 1);

  // 1. Calcula volume médio e duração média para aferir velocidade
  let sumVol = 0;
  let sumDurMs = 0;
  let validCount = 0;
  for (const b of boxes) {
    if (b.totalVolume > 0) {
      sumVol += b.totalVolume;
      const dur = Math.max(50, (b.timeEnd || b.timeStart) - b.timeStart);
      sumDurMs += dur;
      validCount += 1;
    }
  }
  const avgVol = validCount > 0 ? sumVol / validCount : 1000;
  const avgDurMs = validCount > 0 ? sumDurMs / validCount : 5000;

  let prevDeltaEma = 0;
  let prevCvdEma = boxes[0].cvdAtClose || 0;
  let prevSignal = 0;

  // Buffer para cálculo de desvio padrão do CVD para normalização robusta
  const cvdDiffs: number[] = [];

  const points: FlowCyclePoint[] = [];

  for (let i = 0; i < boxes.length; i += 1) {
    const box = boxes[i];
    const totalV = Math.max(1, box.totalVolume || (box.buyVolume + box.sellVolume) || 1);
    const delta = box.delta ?? ((box.buyVolume || 0) - (box.sellVolume || 0));
    
    // Delta normalizado em percentual (-100 a +100)
    const rawDeltaPct = Math.max(-100, Math.min(100, (delta / totalV) * 100));

    // Suavização do delta
    const deltaEma = i === 0 ? rawDeltaPct : prevDeltaEma + alphaDelta * (rawDeltaPct - prevDeltaEma);
    prevDeltaEma = deltaEma;

    // Linha de base do CVD para extrair o momentum
    const cvd = box.cvdAtClose ?? 0;
    const cvdEma = i === 0 ? cvd : prevCvdEma + alphaCvd * (cvd - prevCvdEma);
    prevCvdEma = cvdEma;

    const cvdDiff = cvd - cvdEma;
    cvdDiffs.push(Math.abs(cvdDiff));
    if (cvdDiffs.length > 50) cvdDiffs.shift();

    // Desvio médio recente para normalização estável do momentum
    const meanDiff = cvdDiffs.reduce((acc, v) => acc + v, 0) / Math.max(1, cvdDiffs.length);
    const cvdMomentum = meanDiff > 0
      ? Math.max(-100, Math.min(100, (cvdDiff / (meanDiff * 1.6)) * 100))
      : 0;

    // Multiplicador de velocidade e agressão:
    // Box rápido com volume acima da média = institucional agredindo com urgência
    const durMs = Math.max(50, (box.timeEnd || box.timeStart) - box.timeStart);
    const speedRatio = Math.max(0.4, Math.min(2.5, avgDurMs / durMs));
    const volRatio = Math.max(0.5, Math.min(2.5, totalV / avgVol));
    const speedMultiplier = Math.sqrt(speedRatio * volRatio);

    // Composição harmônica do Oscilador de Ciclo:
    // 55% Agressão relativa móvel + 45% Momentum do CVD
    // Ajustado suavemente pelo multiplicador de intensidade
    const rawOscillator = 0.55 * deltaEma + 0.45 * cvdMomentum;
    // O oscilador expande quando há intensidade e amortece quando não há volume
    const modulated = rawOscillator * Math.min(1.3, Math.max(0.7, 0.7 + 0.3 * speedMultiplier));
    const oscillator = Math.round(Math.max(-100, Math.min(100, modulated)) * 10) / 10;

    // Linha de sinal suavizada (EMA)
    const signal = i === 0 ? oscillator : Math.round((prevSignal + alphaSignal * (oscillator - prevSignal)) * 10) / 10;
    prevSignal = signal;

    const histogram = Math.round((oscillator - signal) * 10) / 10;

    // Identificação da Fase do Ciclo
    let phase: FlowCyclePoint['phase'] = 'NEUTRAL';
    if (oscillator >= ob) {
      // Zona sobrecomprada: se histograma estiver caindo, é exaustão
      phase = histogram < 0 ? 'EXHAUSTION_BUY' : 'EXPANSION_BUY';
    } else if (oscillator <= os) {
      // Zona sobrevendida: se histograma estiver subindo, é absorção/exaustão de venda
      phase = histogram > 0 ? 'EXHAUSTION_SELL' : 'EXPANSION_SELL';
    } else if (oscillator > 10) {
      phase = 'EXPANSION_BUY';
    } else if (oscillator < -10) {
      phase = 'EXPANSION_SELL';
    }

    // Detecção de Divergência de Ciclo (Absorção Institucional)
    // Compara com os últimos 4 a 10 boxes
    let divergence: FlowCyclePoint['divergence'] = null;
    if (i >= 5) {
      const prevSlice = points.slice(Math.max(0, i - 8), i);
      const highestPricePrev = Math.max(...prevSlice.map((p) => p.price));
      const lowestPricePrev = Math.min(...prevSlice.map((p) => p.price));

      // Divergência de Topo (Absorção Vendedora / Clímax): Preço faz nova máxima mas oscilador perde força
      if (box.close >= highestPricePrev && oscillator < 35 && deltaEma < prevSlice[prevSlice.length - 1].deltaEma) {
        divergence = 'BEARISH_ABSORPTION';
      }
      // Divergência de Fundo (Absorção Compradora / Clímax): Preço faz nova mínima mas oscilador sobe
      else if (box.close <= lowestPricePrev && oscillator > -35 && deltaEma > prevSlice[prevSlice.length - 1].deltaEma) {
        divergence = 'BULLISH_ABSORPTION';
      }
    }

    points.push({
      boxIndex: box.index,
      price: box.close,
      timestamp: box.timeEnd || box.timeStart,
      deltaNorm: Math.round(rawDeltaPct * 10) / 10,
      deltaEma: Math.round(deltaEma * 10) / 10,
      cvdMomentum: Math.round(cvdMomentum * 10) / 10,
      speedMultiplier: Math.round(speedMultiplier * 100) / 100,
      oscillator,
      signal,
      histogram,
      phase,
      divergence,
    });
  }

  return points;
}

/**
 * Retorna o resumo diagnóstico do ciclo atual em tempo real
 */
export function getFlowCycleSummary(points: FlowCyclePoint[]): FlowCycleSummary {
  if (!points || points.length === 0) {
    return {
      currentValue: 0,
      currentSignal: 0,
      currentHistogram: 0,
      currentPhase: 'NEUTRAL',
      currentDivergence: null,
      cycleStrengthPct: 0,
      phaseLabel: 'Neutro (Sem dados)',
    };
  }

  const last = points[points.length - 1];
  let phaseLabel = 'Neutro / Equilíbrio';

  if (last.divergence === 'BEARISH_ABSORPTION') {
    phaseLabel = '⚠️ Absorção no Topo (Exaustão Compradora)';
  } else if (last.divergence === 'BULLISH_ABSORPTION') {
    phaseLabel = '🟢 Absorção no Fundo (Exaustão Vendedora)';
  } else if (last.phase === 'EXPANSION_BUY') {
    phaseLabel = last.oscillator >= 50 ? '🚀 Ciclo Comprador Forte (Sobrecomprado)' : '🟢 Ciclo de Compra em Expansão';
  } else if (last.phase === 'EXHAUSTION_BUY') {
    phaseLabel = '🟡 Exaustão de Compra (Desaceleração)';
  } else if (last.phase === 'EXPANSION_SELL') {
    phaseLabel = last.oscillator <= -50 ? '🔻 Ciclo Vendedor Forte (Sobrevendido)' : '🔴 Ciclo de Venda em Expansão';
  } else if (last.phase === 'EXHAUSTION_SELL') {
    phaseLabel = '🔵 Exaustão de Venda (Desaceleração)';
  }

  return {
    currentValue: last.oscillator,
    currentSignal: last.signal,
    currentHistogram: last.histogram,
    currentPhase: last.phase,
    currentDivergence: last.divergence,
    cycleStrengthPct: Math.round(Math.abs(last.oscillator)),
    phaseLabel,
  };
}
