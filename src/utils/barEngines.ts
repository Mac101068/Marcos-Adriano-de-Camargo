import { Tick, RenkoBox } from '../types/trading';

/**
 * Motores de séries experimentais para o gráfico principal:
 * 1. RangeBarEngine -> Gráfico de Range (barra fecha quando o range High-Low atinge N pontos)
 * 2. TimeBarEngine  -> Gráfico de Tempo (barra fecha ao virar o intervalo de relógio)
 *
 * Ambos produzem objetos no formato RenkoBox para que o painel de fluxo
 * (Heikin-Ashi / Delta / CVD) funcione igual em qualquer série.
 */

export type ChartSeries = 'renko' | 'range' | 'tempo';

export interface BarEngineResult {
  newBarClosed: boolean;
  closedBox?: RenkoBox;
}

function makeBlankBar(price: number, timestamp: number): Partial<RenkoBox> {
  return {
    index: 0,
    direction: 'UP',
    open: price,
    close: price,
    high: price,
    low: price,
    timeStart: timestamp,
    timeEnd: timestamp,
    ticksCount: 0,
    totalVolume: 0,
    buyVolume: 0,
    sellVolume: 0,
    delta: 0,
    cvdAtClose: 0,
    isConvergence: false,
  };
}

/** Acumula o tick dentro da barra em formação (volume, delta, CVD ao vivo, high/low). */
function accumulateTick(curr: Partial<RenkoBox>, tick: Tick, cvd: number): number {
  const tickDelta = tick.aggressor === 'BUY' ? tick.volume : tick.aggressor === 'SELL' ? -tick.volume : 0;
  const newCvd = cvd + tickDelta;

  curr.ticksCount = (curr.ticksCount || 0) + 1;
  curr.totalVolume = (curr.totalVolume || 0) + tick.volume;
  if (tick.aggressor === 'BUY') {
    curr.buyVolume = (curr.buyVolume || 0) + tick.volume;
  } else if (tick.aggressor === 'SELL') {
    curr.sellVolume = (curr.sellVolume || 0) + tick.volume;
  }
  curr.delta = (curr.buyVolume || 0) - (curr.sellVolume || 0);
  curr.high = Math.max(curr.high || tick.price, tick.price);
  curr.low = Math.min(curr.low || tick.price, tick.price);
  curr.close = tick.price;
  curr.timeEnd = tick.timestamp;
  // CVD ao vivo da barra em formação (mesma lição da Opção B no Renko: não defasar do preço)
  curr.cvdAtClose = newCvd;

  return newCvd;
}

function finalizeBar(curr: Partial<RenkoBox>, index: number): RenkoBox {
  const open = curr.open ?? curr.close ?? 0;
  const close = curr.close ?? open;
  return {
    ...(curr as RenkoBox),
    index,
    direction: close >= open ? 'UP' : 'DOWN',
  };
}

/**
 * GRÁFICO DE RANGE: a barra fecha quando (High - Low) acumula N pontos,
 * independente de tempo. A próxima barra abre no preço do fechamento.
 */
export class RangeBarEngine {
  private rangePoints: number;
  private boxes: RenkoBox[] = [];
  private currentBox: Partial<RenkoBox> | null = null;
  private cvd: number = 0;

  constructor(rangePoints: number = 50) {
    this.rangePoints = Math.max(5, rangePoints);
  }

  public setRangePoints(points: number) {
    this.rangePoints = Math.max(5, points);
  }

  public getBoxes(): RenkoBox[] {
    return this.boxes;
  }

  public getCurrentBox(): Partial<RenkoBox> | null {
    return this.currentBox;
  }

  public getCvd(): number {
    return this.cvd;
  }

  public initialize(startPrice: number, timestamp: number = Date.now()) {
    this.boxes = [];
    this.cvd = 0;
    this.currentBox = makeBlankBar(startPrice, timestamp);
    this.currentBox.cvdAtClose = 0;
  }

  public processTick(tick: Tick): BarEngineResult {
    if (!this.currentBox) {
      this.initialize(tick.price, tick.timestamp);
    }

    const curr = this.currentBox!;
    this.cvd = accumulateTick(curr, tick, this.cvd);

    const reached = (curr.high || 0) - (curr.low || 0) >= this.rangePoints;
    if (reached) {
      const closed = finalizeBar(curr, this.boxes.length);
      this.boxes.push(closed);
      this.currentBox = makeBlankBar(tick.price, tick.timestamp);
      this.currentBox.cvdAtClose = this.cvd;
      return { newBarClosed: true, closedBox: closed };
    }

    return { newBarClosed: false };
  }
}

/**
 * GRÁFICO DE TEMPO: a barra fecha ao virar o intervalo (ex.: a cada 30s, 1min),
 * mesmo sem movimento. Útil para comparar a leitura temporal contra o Renko atemporal.
 */
export class TimeBarEngine {
  private intervalMs: number;
  private boxes: RenkoBox[] = [];
  private currentBox: Partial<RenkoBox> | null = null;
  private cvd: number = 0;

  constructor(intervalMs: number = 30000) {
    this.intervalMs = Math.max(1000, intervalMs);
  }

  public setIntervalMs(ms: number) {
    this.intervalMs = Math.max(1000, ms);
  }

  public getBoxes(): RenkoBox[] {
    return this.boxes;
  }

  public getCurrentBox(): Partial<RenkoBox> | null {
    return this.currentBox;
  }

  public getCvd(): number {
    return this.cvd;
  }

  public initialize(startPrice: number, timestamp: number = Date.now()) {
    this.boxes = [];
    this.cvd = 0;
    this.currentBox = makeBlankBar(startPrice, timestamp);
    this.currentBox.cvdAtClose = 0;
  }

  public processTick(tick: Tick): BarEngineResult {
    if (!this.currentBox) {
      this.initialize(tick.price, tick.timestamp);
    }

    let closed: RenkoBox | undefined;

    const currBucket = Math.floor((this.currentBox!.timeStart || tick.timestamp) / this.intervalMs);
    const tickBucket = Math.floor(tick.timestamp / this.intervalMs);

    // Virada de intervalo: fecha a barra atual e abre a próxima no fechamento anterior
    if (tickBucket > currBucket) {
      closed = finalizeBar(this.currentBox!, this.boxes.length);
      this.boxes.push(closed);
      this.currentBox = makeBlankBar(closed.close, Math.min(tick.timestamp, tickBucket * this.intervalMs));
      this.currentBox.cvdAtClose = this.cvd;
    }

    this.cvd = accumulateTick(this.currentBox!, tick, this.cvd);

    return closed ? { newBarClosed: true, closedBox: closed } : { newBarClosed: false };
  }
}
