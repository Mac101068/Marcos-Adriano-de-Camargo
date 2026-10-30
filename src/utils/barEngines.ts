import { Tick, RenkoBox } from '../types/trading';
import { SessionRegimeMeter } from './sessionRegime';

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

/** Dia local (YYYY-MM-DD) de um timestamp — usada pela âncora de sessão do Range. */
function sessionKeyOf(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
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
  // Dia local (YYYY-MM-DD) da sessão em curso — impede o gap de virar barra-ponte.
  private lastSessionKey?: string;
  // Medidor de regime desta série (alimentado a cada barra fechada; leitura sempre ligada)
  private regimeMeter = new SessionRegimeMeter(20);

  constructor(rangePoints: number = 50) {
    this.rangePoints = Math.max(5, rangePoints);
  }

  public getRegimeMeter(): SessionRegimeMeter {
    return this.regimeMeter;
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
    this.lastSessionKey = sessionKeyOf(timestamp);
    this.regimeMeter.reset();
    this.currentBox = makeBlankBar(startPrice, timestamp);
    this.currentBox.cvdAtClose = 0;
  }

  public processTick(tick: Tick): BarEngineResult {
    if (!this.currentBox) {
      this.initialize(tick.price, tick.timestamp);
    }

    // VIRADA DE SESSÃO (mesma âncora do Renko): a barra parcial de ontem é descartada e a
    // barra de hoje nasce no preço real de abertura — o gap noturno nunca vira barra-ponte.
    const tickSession = sessionKeyOf(tick.timestamp);
    if (this.lastSessionKey !== undefined && tickSession !== this.lastSessionKey) {
      this.lastSessionKey = tickSession;
      this.currentBox = makeBlankBar(tick.price, tick.timestamp);
      this.currentBox.cvdAtClose = this.cvd;
    }

    const curr = this.currentBox!;
    this.cvd = accumulateTick(curr, tick, this.cvd);

    const reached = (curr.high || 0) - (curr.low || 0) >= this.rangePoints;
    if (reached) {
      const closed = finalizeBar(curr, this.boxes.length);
      // Regime: alimenta o medidor e grava o fator vigente antes de qualquer avaliação
      this.regimeMeter.feedClosedBox(closed);
      closed.regimeFactor = this.regimeMeter.getFactor();
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
  private regimeMeter = new SessionRegimeMeter(20);

  constructor(intervalMs: number = 30000) {
    this.intervalMs = Math.max(1000, intervalMs);
  }

  public getRegimeMeter(): SessionRegimeMeter {
    return this.regimeMeter;
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
    this.regimeMeter.reset();
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
      // Regime: mede a barra fechada e grava o fator vigente (leitura sempre ligada)
      this.regimeMeter.feedClosedBox(closed);
      closed.regimeFactor = this.regimeMeter.getFactor();
      this.boxes.push(closed);
      this.currentBox = makeBlankBar(closed.close, Math.min(tick.timestamp, tickBucket * this.intervalMs));
      this.currentBox.cvdAtClose = this.cvd;
    }

    this.cvd = accumulateTick(this.currentBox!, tick, this.cvd);

    return closed ? { newBarClosed: true, closedBox: closed } : { newBarClosed: false };
  }
}
