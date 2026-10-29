import { Tick, RenkoBox, AutomationConfig } from '../types/trading';
import { evaluateBoxConvergence } from './convergenceEvaluator';

/**
 * Calculador de Gráficos Atemporais:
 * 1. Renko 10R (50 pontos no Mini-Índice B3)
 * 2. Fluxo Atemporal (Delta de Agressão e CVD tick-a-tick)
 * 3. Detector de Convergência Preço vs Fluxo
 */
export class RenkoFlowEngine {
  private boxPoints: number;
  private boxes: RenkoBox[] = [];
  private currentBox: Partial<RenkoBox> | null = null;
  private currentCvd: number = 0;
  private lastPrice: number = 0;

  constructor(boxPoints: number = 50) {
    this.boxPoints = boxPoints;
  }

  public setBoxPoints(points: number) {
    this.boxPoints = points;
  }

  public getBoxes(): RenkoBox[] {
    return this.boxes;
  }

  public getCurrentBox(): Partial<RenkoBox> | null {
    return this.currentBox;
  }

  public getCvd(): number {
    return this.currentCvd;
  }

  /**
   * Inicializa com um preço base
   */
  public initialize(startPrice: number, timestamp: number = Date.now()) {
    this.boxes = [];
    this.currentCvd = 0;
    this.lastPrice = startPrice;

    // Normaliza para múltiplos de 5 (tick do WIN)
    const basePrice = Math.round(startPrice / 5) * 5;

    this.currentBox = {
      index: 0,
      direction: 'UP',
      open: basePrice,
      close: basePrice,
      high: basePrice,
      low: basePrice,
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

  /**
   * Processa um tick do Times & Trades
   * Retorna se um novo box fechou e se gerou sinal de convergência
   */
  public processTick(tick: Tick, config: AutomationConfig): {
    newBoxClosed: boolean;
    closedBox?: RenkoBox;
    signal?: 'BUY' | 'SELL';
    signalReason?: string;
  } {
    this.lastPrice = tick.price;

    // Acumula no CVD global
    const tickDelta = tick.aggressor === 'BUY' ? tick.volume : tick.aggressor === 'SELL' ? -tick.volume : 0;
    this.currentCvd += tickDelta;

    if (!this.currentBox) {
      this.initialize(tick.price, tick.timestamp);
    }

    const curr = this.currentBox!;
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
    curr.timeEnd = tick.timestamp;
    // Opção B: mantém o CVD do box em formação ao vivo (atualiza a cada tick,
    // sem esperar o box fechar), para o candle Heikin-Ashi intrabox não defasar do preço.
    curr.cvdAtClose = this.currentCvd;

    let newBoxClosed = false;
    let closedBox: RenkoBox | undefined;
    let signal: 'BUY' | 'SELL' | undefined;
    let signalReason: string | undefined;

    // Checagem de formação de Renko
    const lastDirection = this.boxes.length > 0 ? this.boxes[this.boxes.length - 1].direction : 'UP';
    const lastClose = this.boxes.length > 0 ? this.boxes[this.boxes.length - 1].close : curr.open!;

    if (lastDirection === 'UP') {
      // Continuação de alta: subiu 50 pontos acima do fechamento anterior
      if (tick.price >= lastClose + this.boxPoints) {
        const newBoxOpen = lastClose;
        const newBoxClose = lastClose + this.boxPoints;

        closedBox = {
          index: this.boxes.length,
          direction: 'UP',
          open: newBoxOpen,
          close: newBoxClose,
          high: Math.max(curr.high || newBoxClose, newBoxClose),
          low: Math.min(curr.low || newBoxOpen, newBoxOpen),
          timeStart: curr.timeStart || tick.timestamp,
          timeEnd: tick.timestamp,
          ticksCount: curr.ticksCount || 1,
          totalVolume: curr.totalVolume || tick.volume,
          buyVolume: curr.buyVolume || 0,
          sellVolume: curr.sellVolume || 0,
          delta: curr.delta || 0,
          cvdAtClose: this.currentCvd,
          isConvergence: false,
        };

        // Validação de convergência
        const convergenceCheck = this.evaluateConvergence(closedBox, config);
        closedBox.isConvergence = convergenceCheck.isConvergence;
        closedBox.convergenceType = convergenceCheck.type;
        if (convergenceCheck.signal) {
          signal = convergenceCheck.signal;
          signalReason = convergenceCheck.reason;
          closedBox.orderDispatched = signal;
        }

        this.boxes.push(closedBox);
        newBoxClosed = true;

        // Inicia novo box
        this.currentBox = {
          index: this.boxes.length,
          direction: 'UP',
          open: newBoxClose,
          close: tick.price,
          high: tick.price,
          low: tick.price,
          timeStart: tick.timestamp,
          timeEnd: tick.timestamp,
          ticksCount: 0,
          totalVolume: 0,
          buyVolume: 0,
          sellVolume: 0,
          delta: 0,
          cvdAtClose: this.currentCvd,
          isConvergence: false,
        };
      }
      // Reversão para baixa: caiu 2x o tamanho (100 pontos) a partir do fechamento
      else if (tick.price <= lastClose - (this.boxPoints * 2)) {
        const prevOpen = this.boxes.length > 0 ? this.boxes[this.boxes.length - 1].open : lastClose - this.boxPoints;
        const newBoxOpen = prevOpen;
        const newBoxClose = prevOpen - this.boxPoints;

        closedBox = {
          index: this.boxes.length,
          direction: 'DOWN',
          open: newBoxOpen,
          close: newBoxClose,
          high: Math.max(curr.high || newBoxOpen, newBoxOpen),
          low: Math.min(curr.low || newBoxClose, newBoxClose),
          timeStart: curr.timeStart || tick.timestamp,
          timeEnd: tick.timestamp,
          ticksCount: curr.ticksCount || 1,
          totalVolume: curr.totalVolume || tick.volume,
          buyVolume: curr.buyVolume || 0,
          sellVolume: curr.sellVolume || 0,
          delta: curr.delta || 0,
          cvdAtClose: this.currentCvd,
          isConvergence: false,
        };

        const convergenceCheck = this.evaluateConvergence(closedBox, config);
        closedBox.isConvergence = convergenceCheck.isConvergence;
        closedBox.convergenceType = convergenceCheck.type;
        if (convergenceCheck.signal) {
          signal = convergenceCheck.signal;
          signalReason = convergenceCheck.reason;
          closedBox.orderDispatched = signal;
        }

        this.boxes.push(closedBox);
        newBoxClosed = true;

        this.currentBox = {
          index: this.boxes.length,
          direction: 'DOWN',
          open: newBoxClose,
          close: tick.price,
          high: tick.price,
          low: tick.price,
          timeStart: tick.timestamp,
          timeEnd: tick.timestamp,
          ticksCount: 0,
          totalVolume: 0,
          buyVolume: 0,
          sellVolume: 0,
          delta: 0,
          cvdAtClose: this.currentCvd,
          isConvergence: false,
        };
      }
    } else {
      // Direção anterior era DOWN
      // Continuação de baixa: caiu 50 pontos
      if (tick.price <= lastClose - this.boxPoints) {
        const newBoxOpen = lastClose;
        const newBoxClose = lastClose - this.boxPoints;

        closedBox = {
          index: this.boxes.length,
          direction: 'DOWN',
          open: newBoxOpen,
          close: newBoxClose,
          high: Math.max(curr.high || newBoxOpen, newBoxOpen),
          low: Math.min(curr.low || newBoxClose, newBoxClose),
          timeStart: curr.timeStart || tick.timestamp,
          timeEnd: tick.timestamp,
          ticksCount: curr.ticksCount || 1,
          totalVolume: curr.totalVolume || tick.volume,
          buyVolume: curr.buyVolume || 0,
          sellVolume: curr.sellVolume || 0,
          delta: curr.delta || 0,
          cvdAtClose: this.currentCvd,
          isConvergence: false,
        };

        const convergenceCheck = this.evaluateConvergence(closedBox, config);
        closedBox.isConvergence = convergenceCheck.isConvergence;
        closedBox.convergenceType = convergenceCheck.type;
        if (convergenceCheck.signal) {
          signal = convergenceCheck.signal;
          signalReason = convergenceCheck.reason;
          closedBox.orderDispatched = signal;
        }

        this.boxes.push(closedBox);
        newBoxClosed = true;

        this.currentBox = {
          index: this.boxes.length,
          direction: 'DOWN',
          open: newBoxClose,
          close: tick.price,
          high: tick.price,
          low: tick.price,
          timeStart: tick.timestamp,
          timeEnd: tick.timestamp,
          ticksCount: 0,
          totalVolume: 0,
          buyVolume: 0,
          sellVolume: 0,
          delta: 0,
          cvdAtClose: this.currentCvd,
          isConvergence: false,
        };
      }
      // Reversão para alta: subiu 2x o tamanho (100 pontos) a partir do fechamento
      else if (tick.price >= lastClose + (this.boxPoints * 2)) {
        const prevOpen = this.boxes.length > 0 ? this.boxes[this.boxes.length - 1].open : lastClose + this.boxPoints;
        const newBoxOpen = prevOpen;
        const newBoxClose = prevOpen + this.boxPoints;

        closedBox = {
          index: this.boxes.length,
          direction: 'UP',
          open: newBoxOpen,
          close: newBoxClose,
          high: Math.max(curr.high || newBoxClose, newBoxClose),
          low: Math.min(curr.low || newBoxOpen, newBoxOpen),
          timeStart: curr.timeStart || tick.timestamp,
          timeEnd: tick.timestamp,
          ticksCount: curr.ticksCount || 1,
          totalVolume: curr.totalVolume || tick.volume,
          buyVolume: curr.buyVolume || 0,
          sellVolume: curr.sellVolume || 0,
          delta: curr.delta || 0,
          cvdAtClose: this.currentCvd,
          isConvergence: false,
        };

        const convergenceCheck = this.evaluateConvergence(closedBox, config);
        closedBox.isConvergence = convergenceCheck.isConvergence;
        closedBox.convergenceType = convergenceCheck.type;
        if (convergenceCheck.signal) {
          signal = convergenceCheck.signal;
          signalReason = convergenceCheck.reason;
          closedBox.orderDispatched = signal;
        }

        this.boxes.push(closedBox);
        newBoxClosed = true;

        this.currentBox = {
          index: this.boxes.length,
          direction: 'UP',
          open: newBoxClose,
          close: tick.price,
          high: tick.price,
          low: tick.price,
          timeStart: tick.timestamp,
          timeEnd: tick.timestamp,
          ticksCount: 0,
          totalVolume: 0,
          buyVolume: 0,
          sellVolume: 0,
          delta: 0,
          cvdAtClose: this.currentCvd,
          isConvergence: false,
        };
      }
    }

    return {
      newBoxClosed,
      closedBox,
      signal,
      signalReason,
    };
  }

  /**
   * Avalia a convergência entre Preço 10R e Fluxo de Agressão.
   * Lógica extraída para convergenceEvaluator.ts (compartilhada com Range e Tempo),
   * mantendo comportamento idêntico: this.boxes ainda não contém o box recém-fechado.
   */
  private evaluateConvergence(
    box: RenkoBox,
    config: AutomationConfig
  ): {
    isConvergence: boolean;
    type?: 'BUY_CONVERGENCE' | 'SELL_CONVERGENCE' | 'DIVERGENCE';
    signal?: 'BUY' | 'SELL';
    reason?: string;
  } {
    return evaluateBoxConvergence(box, config, this.boxes);
  }
}
