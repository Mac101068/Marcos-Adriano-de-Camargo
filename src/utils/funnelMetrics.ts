import { AutomationConfig, RenkoBox } from '../types/trading';
import { SessionRegimeMeter } from './sessionRegime';

/**
 * MÉTRICAS DO FUNIL — a radiografia viva do corte de sinal (Ciclo 17).
 *
 * Hoje o limiar é CALCULADO do pregão (auto-calibrado: percentil da janela + piso relativo à
 * média do dia), mas o número só aparecia como frase solta no laudo de sinal. Este módulo reúne,
 * em um único retrato, de onde cada corte veio e como o último box fechado se comportou contra
 * ele — para o operador AVALIAR o funil em tela, sem adivinhar.
 *
 * É 100% puro: recebe config + medidor + boxes fechados e devolve números. Não envia ordem,
 * não toca o MT5, não tem React. O `limit` de cada lado vem do MESMO
 * `getSelfCalibratedBreakdown` que governa o `getSelfCalibratedLimit` do avaliador de
 * convergência — então a tela nunca anuncia um corte diferente do que o robô aplica (regra 12
 * e regra 13 do projeto).
 */

/** Retrato de um lado (compra ou venda). */
export interface SideFunnelMetric {
  limit: number; // o corte vigente para o lado
  source: 'percentil' | 'piso' | 'fisico'; // qual regra mandou no corte
  percentileValue: number | null; // P da janela rolante
  floorValue: number | null; // piso relativo (média do dia × multiplicador)
  dayMean: number | null; // média de agressão do lado no dia
  dayCount: number; // amostras do lado no dia
  samples: number; // amostras do lado na janela
}

/** Leitura do último box FECHADO contra o corte do seu lado. */
export interface CurrentBoxRead {
  index: number;
  direction: 'UP' | 'DOWN';
  delta: number;
  totalVolume: number;
  divergence: number; // |Δ| ÷ volume (0..1); 0 se volume <= 0
  limit: number; // corte do lado deste box
  passesDelta: boolean; // passou no limiar de agressão?
  divergenceMin?: number; // corte de divergência ativo (só Pirâmide)
  passesDivergence: boolean; // passou na divergência? (true se o filtro não se aplica)
  timeEnd: number;
}

export interface FunnelMetricsSnapshot {
  mode: 'auto' | 'fixo';
  strategy: 'PYRAMID' | 'RETESTE';
  percentile: number; // P configurado (0..0.95)
  floorMultiple: number; // piso relativo configurado
  lookbackBoxes: number; // tamanho da janela rolante de boxes recentes
  baseThreshold: number; // minDeltaThreshold (físico / aquecimento)
  divergenceMin?: number; // flowDivergenceMin (só faz sentido na Pirâmide)
  buy: SideFunnelMetric;
  sell: SideFunnelMetric;
  boxesToday: number; // boxes fechados no medidor (régua da sessão corrente)
  warmed: boolean; // já há estatística para calibrar?
  current: CurrentBoxRead | null; // último box fechado julgado (null = nenhum box ainda)
}

const flowDivergence = (box: RenkoBox): number => {
  const vol = box.totalVolume ?? 0;
  if (vol <= 0) return 0;
  return Math.min(1, Math.abs(box.delta ?? 0) / vol);
};

/**
 * Requisito efetivo de agressão para o lado, igual ao `convergenceEvaluator`: no modo auto é o
 * limiar calibrado; no físico a Pirâmide usa `max(50, minDeltaThreshold)` e o Reteste usa o
 * próprio `minDeltaThreshold`. Manter essa cópia fiel é o que impede a tela de mentir.
 */
function effectiveLimit(
  side: 'BUY' | 'SELL',
  config: AutomationConfig,
  adaptive: boolean,
  auto: SideFunnelMetric
): number {
  if (adaptive) return auto.limit;
  const base = config.minDeltaThreshold ?? 150;
  if (config.strategyMode === 'PYRAMID_FLOW_CONFLUENCE') return Math.max(50, base);
  return side === 'BUY' ? base : base;
}

/**
 * Monta o retrato do funil. `boxes` são os boxes FECHADOS da série ativa (o box em formação
 * não entra: ainda não tem delta/volume definitivos). `meter` é o medidor da mesma série.
 */
export function computeFunnelMetrics(
  config: AutomationConfig,
  meter: SessionRegimeMeter,
  boxes: RenkoBox[]
): FunnelMetricsSnapshot {
  const adaptive = config.adaptiveThresholdEnabled === true;
  const percentile = config.adaptiveThresholdPercentile ?? 0.6;
  const floorMultiple = config.adaptiveFloorMultiple ?? 1.3;
  const base = config.minDeltaThreshold ?? 150;
  const isPyramid = config.strategyMode === 'PYRAMID_FLOW_CONFLUENCE';
  // O corte de divergência só governa a Pirâmide (mesma regra do avaliador).
  const divergenceMin = isPyramid ? config.flowDivergenceMin : undefined;

  const sideMetric = (side: 'BUY' | 'SELL'): SideFunnelMetric => {
    if (adaptive) {
      const b = meter.getSelfCalibratedBreakdown(side, percentile, floorMultiple, base);
      return {
        limit: b.limit,
        source: b.source,
        percentileValue: b.percentileValue,
        floorValue: b.floorValue,
        dayMean: b.dayMean,
        dayCount: b.dayCount,
        samples: b.samples,
      };
    }
    // Modo fixo: o corte é o físico; sem percentil/piso em jogo.
    return {
      limit: effectiveLimit(side, config, false, {
        limit: base,
        source: 'fisico',
        percentileValue: null,
        floorValue: null,
        dayMean: null,
        dayCount: 0,
        samples: 0,
      }),
      source: 'fisico',
      percentileValue: null,
      floorValue: null,
      dayMean: null,
      dayCount: 0,
      samples: 0,
    };
  };

  const buy = sideMetric('BUY');
  const sell = sideMetric('SELL');

  const last = boxes.length > 0 ? boxes[boxes.length - 1] : null;
  let current: CurrentBoxRead | null = null;
  if (last && last.direction) {
    const side: 'BUY' | 'SELL' = last.direction === 'UP' ? 'BUY' : 'SELL';
    const limit = side === 'BUY' ? buy.limit : sell.limit;
    const div = flowDivergence(last);
    const passesDelta =
      last.direction === 'UP' ? (last.delta ?? 0) >= limit : (last.delta ?? 0) <= -limit;
    const passesDivergence = divergenceMin === undefined ? true : div >= divergenceMin;
    current = {
      index: last.index,
      direction: last.direction,
      delta: last.delta ?? 0,
      totalVolume: last.totalVolume ?? 0,
      divergence: div,
      limit,
      passesDelta,
      divergenceMin,
      passesDivergence,
      timeEnd: last.timeEnd,
    };
  }

  return {
    mode: adaptive ? 'auto' : 'fixo',
    strategy: isPyramid ? 'PYRAMID' : 'RETESTE',
    percentile,
    floorMultiple,
    lookbackBoxes: config.regimeLookbackBoxes ?? 20,
    baseThreshold: base,
    divergenceMin,
    buy,
    sell,
    boxesToday: meter.getBoxCount(),
    warmed: meter.getBoxCount() >= 10,
    current,
  };
}
