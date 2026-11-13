import { AutomationConfig, DirectionLock, OrderAuditEvent, RobotRole, TradeOrder } from '../types/trading';
import { SavedStrategy } from '../types/strategy';
import { AssetSpec, isPriceSaneForAsset, chartSymbolFor, pointsToBRL } from '../assets/assetRegistry';
import { OrderAuditService } from './orderAuditService';

export interface DirectionalRobotOptions {
  direction: 'BUY' | 'SELL';
  magic: 100001 | 100002;
  strategy?: SavedStrategy | null;
  baseConfig?: Partial<AutomationConfig>;
  asset: AssetSpec;
}

export interface DirectionalOrderValidationResult {
  valid: boolean;
  reason?: string;
  sanitizedOrder?: {
    symbol: string;
    type: 'BUY' | 'SELL';
    magic: number;
    comment: string;
    price: number;
    contracts: number;
  };
}

/** Posição simulada em memória de um robô direcional. */
export interface DirectionalPosition {
  id: string;
  type: 'BUY' | 'SELL';
  entryPrice: number;
  contracts: number;
  stopLoss: number;
  takeProfit: number;
  symbol: string;
  magic: number;
  comment: string;
  openedAt: number;
  status: 'OPEN' | 'CLOSED_PROFIT' | 'CLOSED_LOSS';
  exitPrice?: number;
  exitTimestamp?: number;
  pointsResult?: number;
  financialResult?: number;
  auditTrail?: OrderAuditEvent[];
}

/** Intenção de entrada registrada (não dispara ordem real na ponte). */
export interface DirectionalIntent {
  id: string;
  direction: 'BUY' | 'SELL';
  magic: 100001 | 100002;
  symbol: string;
  type: 'BUY' | 'SELL';
  contracts: number;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  comment: string;
  boxIndex?: number;
  boxDirection?: 'UP' | 'DOWN';
  createdAt: number;
}

/** Snapshot do estado de um robô direcional. */
export interface DirectionalRobotSnapshot {
  direction: 'BUY' | 'SELL';
  magic: 100001 | 100002;
  role: RobotRole;
  paused: boolean;
  lastSignal?: { direction: 'BUY' | 'SELL'; boxIndex: number; price: number; at: number };
  intents: DirectionalIntent[];
  positions: DirectionalPosition[];
  openPositions: DirectionalPosition[];
  pnlPoints: number;
  pnlFinancial: number;
  totalIntents: number;
  totalCloses: number;
}

export class DirectionalRobot {
  public readonly direction: 'BUY' | 'SELL';
  public readonly magic: 100001 | 100002;
  public readonly role: RobotRole;
  public readonly asset: AssetSpec;
  private _config: AutomationConfig;

  // Estado de execução
  private _paused = true; // nasce pausado
  private _positions: DirectionalPosition[] = [];
  private _intents: DirectionalIntent[] = [];
  private _lastSignal?: { direction: 'BUY' | 'SELL'; boxIndex: number; price: number; at: number };
  private _totalCloses = 0;

  constructor(options: DirectionalRobotOptions) {
    this.direction = options.direction;
    this.magic = options.magic;
    this.role = this.direction === 'BUY' ? 'BUY_ROBOT' : 'SELL_ROBOT';
    this.asset = options.asset;

    // Configuração base combinada com a estratégia
    const stratConfig = options.strategy?.config;
    const base = options.baseConfig ?? {};

    // Magic e Role são identidades de RUNTIME: nunca herdados da SavedStrategy
    this._config = {
      ...(stratConfig ?? {}),
      ...base,
      magicNumber: this.magic,
      robotRole: this.role,
      directionLock: (stratConfig?.directionLock || base.directionLock || (this.direction === 'BUY' ? 'BUY_ONLY' : 'SELL_ONLY')) as DirectionLock,
      onCloseOpposite: stratConfig?.onCloseOpposite ?? base.onCloseOpposite ?? false,
    } as AutomationConfig;
  }

  public get config(): AutomationConfig {
    return this._config;
  }

  public get paused(): boolean {
    return this._paused;
  }

  public get positions(): DirectionalPosition[] {
    return this._positions;
  }

  public get intents(): DirectionalIntent[] {
    return this._intents;
  }

  public get lastSignal() {
    return this._lastSignal;
  }

  /** Liga o robô (pausado -> ativo). */
  public activate(): void {
    this._paused = false;
  }

  /** Pausa o robô (ativo -> pausado). */
  public pause(): void {
    this._paused = true;
  }

  /** Zera o livro de ordens, intenções e histórico para uma nova sessão/replay. */
  public resetBook(): void {
    this._positions = [];
    this._intents = [];
    this._lastSignal = undefined;
    this._totalCloses = 0;
  }

  public updateStrategy(strategy: SavedStrategy): void {
    // Preserva o magic e role de runtime invioláveis ao trocar/atualizar estratégia
    this._config = {
      ...strategy.config,
      magicNumber: this.magic,
      robotRole: this.role,
      directionLock: strategy.config.directionLock || (this.direction === 'BUY' ? 'BUY_ONLY' : 'SELL_ONLY'),
      onCloseOpposite: strategy.config.onCloseOpposite ?? this._config.onCloseOpposite ?? false,
    };
  }

  /**
   * Prefixo oficial do comentário de ordem:
   * RCOMP_ para RoboCompra (100001) e RVEND_ para RoboVenda (100002).
   */
  public get commentPrefix(): 'RCOMP_' | 'RVEND_' {
    return this.direction === 'BUY' ? 'RCOMP_' : 'RVEND_';
  }

  /**
   * Valida e prepara uma solicitação de ordem para envio.
   * - Rejeita se directionLock conflitar com a direção pretendida
   * - Rejeita se preço for NaN, não-positivo ou insano para o ativo
   * - Garante símbolo padronizado do ativo corrente
   * - Garante magic de runtime e comment RCOMP_ / RVEND_
   */
  public validateOrder(params: {
    type: 'BUY' | 'SELL';
    price: number;
    contracts?: number;
    tagSuffix?: string;
  }): DirectionalOrderValidationResult {
    // 1. Validação de Direção e Trava (directionLock)
    if (params.type !== this.direction) {
      return {
        valid: false,
        reason: `Robô direcional ${this.role} opera apenas ${this.direction}, mas recebeu sinal ${params.type}.`,
      };
    }

    const lock = this._config.directionLock;
    if (lock === 'BUY_ONLY' && params.type !== 'BUY') {
      return {
        valid: false,
        reason: `Trava de direção configurada como BUY_ONLY, ordem de ${params.type} rejeitada.`,
      };
    }
    if (lock === 'SELL_ONLY' && params.type !== 'SELL') {
      return {
        valid: false,
        reason: `Trava de direção configurada como SELL_ONLY, ordem de ${params.type} rejeitada.`,
      };
    }

    // 2. Validação de Preço (não-NaN e sanidade estrita do ativo)
    const price = Number(params.price);
    if (!Number.isFinite(price) || price <= 0 || isNaN(price)) {
      return {
        valid: false,
        reason: `Preço inválido ou NaN recebido: ${params.price}`,
      };
    }

    if (!isPriceSaneForAsset(price, this.asset)) {
      return {
        valid: false,
        reason: `Preço ${price} fora da faixa de sanidade para o ativo ${this.asset.id}.`,
      };
    }

    // 3. Montagem do payload higienizado
    const symbol = chartSymbolFor(this.asset);
    const contracts = Math.max(1, Number(params.contracts || this._config.contracts || 1));
    const tagSuffix = params.tagSuffix ? `_${params.tagSuffix}` : '';
    const comment = `${this.commentPrefix}${symbol}${tagSuffix}`.substring(0, 31);

    return {
      valid: true,
      sanitizedOrder: {
        symbol,
        type: this.direction,
        magic: this.magic,
        comment,
        price,
        contracts,
      },
    };
  }

  /** Recebe um sinal do funil. Registra intenção (sem enviar à ponte) ou fecha por sinal contrário. */
  public onSignal(direction: 'BUY' | 'SELL', boxIndex: number, price: number): { intent?: DirectionalIntent; closed: DirectionalPosition[] } {
    this._lastSignal = { direction, boxIndex, price, at: Date.now() };
    const closed: DirectionalPosition[] = [];

    if (direction !== this.direction && this._config.onCloseOpposite) {
      const openPositions = this._positions.filter((p) => p.status === 'OPEN');
      for (const pos of openPositions) {
        const pts = pos.type === 'BUY' ? price - pos.entryPrice : pos.entryPrice - price;
        const fin = pointsToBRL(pts, pos.contracts, this.asset);
        const evt = OrderAuditService.createEvent(
          'OPPOSITE_ROBOT_SIGNAL',
          `Sinal contrário fechou posição ${this.role} (${pos.type})`,
          `Sinal de ${direction} recebido pelo robô ${this.role} (magic ${this.magic}). Posição ${pos.id} fechada a ${price}. ${pts >= 0 ? '+' : ''}${pts} pts (R$ ${fin.toFixed(2)}).`,
          price,
          pos.contracts,
          pts
        );
        this._positions = this._positions.map((p) =>
          p.id === pos.id
            ? { ...p, status: fin >= 0 ? 'CLOSED_PROFIT' : 'CLOSED_LOSS', exitPrice: price, exitTimestamp: Date.now(), pointsResult: pts, financialResult: fin, auditTrail: p.auditTrail ? [...p.auditTrail, evt] : [evt] }
            : p
        );
        closed.push(this._positions.find((p) => p.id === pos.id)!);
        this._totalCloses += 1;
      }
      return { closed };
    }

    if (direction !== this.direction || this._paused) return { closed };

    const validation = this.validateOrder({ type: direction, price, contracts: this._config.contracts, tagSuffix: `BOX${boxIndex}` });
    if (!validation.valid || !validation.sanitizedOrder) return { closed };
    const so = validation.sanitizedOrder;

    const slPoints = this._config.stopLossPoints || 0;
    const tpPoints = this._config.takeProfitPoints || 0;
    const stopLoss = slPoints > 0 ? (direction === 'BUY' ? price - slPoints : price + slPoints) : 0;
    const takeProfit = tpPoints > 0 ? (direction === 'BUY' ? price + tpPoints : price - tpPoints) : 0;

    const intent: DirectionalIntent = {
      id: `intent-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      direction, magic: this.magic, symbol: so.symbol, type: so.type,
      contracts: so.contracts, entryPrice: so.price, stopLoss, takeProfit,
      comment: so.comment, boxIndex, boxDirection: undefined, createdAt: Date.now(),
    };
    this._intents.push(intent);

    const evt = OrderAuditService.createEvent(
      'ORDER_DISPATCHED',
      `Intenção de entrada ${this.role} (${direction})`,
      `Robô ${this.role} (magic ${this.magic}) sinal ${direction} box #${boxIndex} a ${price}. Intenção registrada (sem ponte). Comentário: ${so.comment}. SL: ${stopLoss || 0} | TP: ${takeProfit || 0}.`,
      price, so.contracts, undefined
    );

    const position: DirectionalPosition = {
      id: intent.id, type: direction, entryPrice: price, contracts: so.contracts, stopLoss, takeProfit,
      symbol: so.symbol, magic: this.magic, comment: so.comment, openedAt: Date.now(), status: 'OPEN', auditTrail: [evt],
    };
    this._positions.push(position);

    return { intent, closed };
  }

  /** Marca‑a‑mercado todas as posições abertas (SL/TP e PnL flutuante). */
  public onTick(price: number): void {
    if (!isPriceSaneForAsset(price, this.asset)) return;
    for (const p of this._positions) {
      if (p.status !== 'OPEN') continue;
      const pts = p.type === 'BUY' ? price - p.entryPrice : p.entryPrice - price;
      const fin = pointsToBRL(pts, p.contracts, this.asset);
      let closed = false;
      let exitReason: 'TAKE_PROFIT_HIT' | 'STOP_LOSS_HIT' | undefined;
      let finalPts = pts;
      let finalFin = fin;
      if (this._config.stopLossPoints && this._config.stopLossPoints > 0) {
        const hitSL = p.type === 'BUY' ? price <= p.stopLoss! : price >= p.stopLoss!;
        if (hitSL) { closed = true; exitReason = 'STOP_LOSS_HIT'; finalPts = p.type === 'BUY' ? p.stopLoss! - p.entryPrice : p.entryPrice - p.stopLoss!; finalFin = pointsToBRL(finalPts, p.contracts, this.asset); }
      }
      if (!closed && this._config.takeProfitPoints && this._config.takeProfitPoints > 0) {
        const hitTP = p.type === 'BUY' ? price >= p.takeProfit! : price <= p.takeProfit!;
        if (hitTP) { closed = true; exitReason = 'TAKE_PROFIT_HIT'; finalPts = p.type === 'BUY' ? p.takeProfit! - p.entryPrice : p.entryPrice - p.takeProfit!; finalFin = pointsToBRL(finalPts, p.contracts, this.asset); }
      }
      if (closed) {
        const evt = OrderAuditService.createEvent(
          exitReason === 'TAKE_PROFIT_HIT' ? 'TAKE_PROFIT_HIT' : 'STOP_LOSS_HIT',
          `SL/TP atingido na posição ${this.role}`,
          `Posição ${p.id} (${p.type}) fechada por ${exitReason} a ${price}. ${finalPts >= 0 ? '+' : ''}${finalPts} pts (R$ ${finalFin.toFixed(2)}).`,
          price, p.contracts, finalPts
        );
        this._positions = this._positions.map((x) =>
          x.id === p.id ? { ...x, status: finalFin >= 0 ? 'CLOSED_PROFIT' : 'CLOSED_LOSS', exitPrice: price, exitTimestamp: Date.now(), pointsResult: finalPts, financialResult: finalFin, auditTrail: x.auditTrail ? [...x.auditTrail, evt] : [evt] } : x
        );
        this._totalCloses += 1;
      }
    }
  }

  /** Retorna snapshot completo do estado do robô. */
  public getSnapshot(): DirectionalRobotSnapshot {
    const open = this._positions.filter((p) => p.status === 'OPEN');
    const pnlFinancial = this._positions.filter((p) => p.financialResult !== undefined).reduce((acc, p) => acc + (p.financialResult || 0), 0);
    return {
      direction: this.direction, magic: this.magic, role: this.role, paused: this._paused,
      lastSignal: this._lastSignal, intents: [...this._intents], positions: [...this._positions],
      openPositions: [...open], pnlPoints: 0, pnlFinancial,
      totalIntents: this._intents.length, totalCloses: this._totalCloses,
    };
  }
}

/**
 * Factory para criar instâncias de robôs direcionais com validação estrita.
 */
export function createDirectionalRobot(options: DirectionalRobotOptions): DirectionalRobot {
  if (options.direction === 'BUY' && options.magic !== 100001) {
    throw new Error(`RoboCompra deve ter magic 100001, recebido: ${options.magic}`);
  }
  if (options.direction === 'SELL' && options.magic !== 100002) {
    throw new Error(`RoboVenda deve ter magic 100002, recebido: ${options.magic}`);
  }
  return new DirectionalRobot(options);
}
