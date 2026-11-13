import { AutomationConfig, DirectionLock, OrderAuditEvent, RobotRole, TradeOrder } from '../types/trading';
import { SavedStrategy } from '../types/strategy';
import { AssetSpec, isPriceSaneForAsset, chartSymbolFor, pointsToBRL } from '../assets/assetRegistry';
import { OrderAuditService } from './orderAuditService';

const DIRECTIONAL_STORAGE_KEY_PREFIX = 'fluxo_quant_b3_directional_robot_v1_';

export interface PersistedDirectionalState {
  magic: 100001 | 100002;
  paused: boolean;
  executionMode: 'PAPER' | 'LIVE';
  customConfig: {
    contracts: number;
    stopLossPoints: number;
    takeProfitPoints: number;
    onCloseOpposite: boolean;
    trailingStop: boolean;
    trailingActivationPoints: number;
    trailingDistancePoints: number;
    breakevenOffsetPoints: number;
    maxOpenPositions: number;
  };
  positions: DirectionalPosition[];
  intents: DirectionalIntent[];
  lastSignal?: { direction: 'BUY' | 'SELL'; boxIndex: number; price: number; at: number };
  totalCloses: number;
  updatedAt: number;
}

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
  isBreakevenActive?: boolean;
  highestPriceSinceEntry?: number;
  lowestPriceSinceEntry?: number;
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
  executionMode: 'PAPER' | 'LIVE';
  customConfig: {
    contracts: number;
    stopLossPoints: number;
    takeProfitPoints: number;
    onCloseOpposite: boolean;
    trailingStop: boolean;
    trailingActivationPoints: number;
    trailingDistancePoints: number;
    breakevenOffsetPoints: number;
    maxOpenPositions: number;
  };
  lastSignal?: { direction: 'BUY' | 'SELL'; boxIndex: number; price: number; at: number };
  intents: DirectionalIntent[];
  positions: DirectionalPosition[];
  openPositions: DirectionalPosition[];
  pnlPoints: number;
  pnlFinancial: number;
  floatingPnlFinancial: number;
  floatingPnlPoints: number;
  totalIntents: number;
  totalCloses: number;
}

export class DirectionalRobot {
  public readonly direction: 'BUY' | 'SELL';
  public readonly magic: 100001 | 100002;
  public readonly role: RobotRole;
  public readonly asset: AssetSpec;
  private _config: AutomationConfig;

  // Estado de execução (com persistência em localStorage para resistir ao F5)
  private _paused = true; // nasce pausado na primeira vez
  private _executionMode: 'PAPER' | 'LIVE' = 'PAPER';
  private _maxOpenPositions = 3;
  private _positions: DirectionalPosition[] = [];
  private _intents: DirectionalIntent[] = [];
  private _lastSignal?: { direction: 'BUY' | 'SELL'; boxIndex: number; price: number; at: number };
  private _totalCloses = 0;
  private _lastPrice = 0;

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
      stopLossPoints: base.stopLossPoints || stratConfig?.stopLossPoints || 100,
      takeProfitPoints: base.takeProfitPoints || stratConfig?.takeProfitPoints || 50,
      trailingStop: base.trailingStop ?? stratConfig?.trailingStop ?? true,
      trailingActivationPoints: base.trailingActivationPoints || stratConfig?.trailingActivationPoints || 20,
      trailingDistancePoints: base.trailingDistancePoints || stratConfig?.trailingDistancePoints || 15,
      breakevenOffsetPoints: base.breakevenOffsetPoints ?? stratConfig?.breakevenOffsetPoints ?? 5,
    } as AutomationConfig;

    // Restaura estado persistido em localStorage (resiste ao F5 / recarregamento da página)
    this.loadState();
  }

  private get storageKey(): string {
    return `${DIRECTIONAL_STORAGE_KEY_PREFIX}${this.magic}`;
  }

  /** Salva o estado operacional e livro de ordens no localStorage para resistir ao F5. */
  public saveState(): void {
    if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') return;
    try {
      const payload: PersistedDirectionalState = {
        magic: this.magic,
        paused: this._paused,
        executionMode: this._executionMode,
        customConfig: {
          contracts: this._config.contracts || 1,
          stopLossPoints: this._config.stopLossPoints || 100,
          takeProfitPoints: this._config.takeProfitPoints || 50,
          onCloseOpposite: Boolean(this._config.onCloseOpposite),
          trailingStop: this._config.trailingStop !== false,
          trailingActivationPoints: this._config.trailingActivationPoints || 20,
          trailingDistancePoints: this._config.trailingDistancePoints || 15,
          breakevenOffsetPoints: this._config.breakevenOffsetPoints ?? 5,
          maxOpenPositions: this._maxOpenPositions || 3,
        },
        positions: this._positions.slice(-200),
        intents: this._intents.slice(-200),
        lastSignal: this._lastSignal,
        totalCloses: this._totalCloses,
        updatedAt: Date.now(),
      };
      window.localStorage.setItem(this.storageKey, JSON.stringify(payload));
    } catch {
      // Ignora falha de quota do storage
    }
  }

  /** Carrega o estado operacional e livro de ordens do localStorage no boot. */
  public loadState(): void {
    if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') return;
    try {
      const raw = window.localStorage.getItem(this.storageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<PersistedDirectionalState>;
      if (parsed.magic !== this.magic) return;

      if (typeof parsed.paused === 'boolean') {
        this._paused = parsed.paused;
      }
      if (parsed.executionMode === 'PAPER' || parsed.executionMode === 'LIVE') {
        this._executionMode = parsed.executionMode;
      }
      if (parsed.customConfig) {
        this._config = {
          ...this._config,
          contracts: parsed.customConfig.contracts || this._config.contracts || 1,
          stopLossPoints: parsed.customConfig.stopLossPoints || 100,
          takeProfitPoints: parsed.customConfig.takeProfitPoints || 50,
          onCloseOpposite: Boolean(parsed.customConfig.onCloseOpposite),
          trailingStop: parsed.customConfig.trailingStop !== undefined ? Boolean(parsed.customConfig.trailingStop) : true,
          trailingActivationPoints: parsed.customConfig.trailingActivationPoints || 20,
          trailingDistancePoints: parsed.customConfig.trailingDistancePoints || 15,
          breakevenOffsetPoints: parsed.customConfig.breakevenOffsetPoints ?? 5,
        };
        if (parsed.customConfig.maxOpenPositions && parsed.customConfig.maxOpenPositions > 0) {
          this._maxOpenPositions = parsed.customConfig.maxOpenPositions;
        }
      }
      if (Array.isArray(parsed.positions)) {
        const slPts = this._config.stopLossPoints || 100;
        const tpPts = this._config.takeProfitPoints || 50;
        // Higieniza posições carregadas para garantir que todas possuam SL e TP válidos na tela
        this._positions = parsed.positions.map((p) => {
          const saneSl = p.stopLoss && p.stopLoss > 0
            ? p.stopLoss
            : (p.type === 'BUY' ? p.entryPrice - slPts : p.entryPrice + slPts);
          const saneTp = p.takeProfit && p.takeProfit > 0
            ? p.takeProfit
            : (p.type === 'BUY' ? p.entryPrice + tpPts : p.entryPrice - tpPts);
          return {
            ...p,
            stopLoss: saneSl,
            takeProfit: saneTp,
            highestPriceSinceEntry: p.highestPriceSinceEntry || p.entryPrice,
            lowestPriceSinceEntry: p.lowestPriceSinceEntry || p.entryPrice,
          };
        });
      }
      if (Array.isArray(parsed.intents)) {
        this._intents = parsed.intents;
      }
      if (parsed.lastSignal) {
        this._lastSignal = parsed.lastSignal;
      }
      if (typeof parsed.totalCloses === 'number') {
        this._totalCloses = parsed.totalCloses;
      }
    } catch {
      // Ignora JSON inválido
    }
  }

  public get config(): AutomationConfig {
    return this._config;
  }

  public get paused(): boolean {
    return this._paused;
  }

  public get executionMode(): 'PAPER' | 'LIVE' {
    return this._executionMode;
  }

  public setExecutionMode(mode: 'PAPER' | 'LIVE'): void {
    this._executionMode = mode;
    this.saveState();
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

  /** Liga o robô (pausado -> ativo) e persiste no storage. */
  public activate(): void {
    this._paused = false;
    this.saveState();
  }

  /** Pausa o robô (ativo -> pausado) e persiste no storage. */
  public pause(): void {
    this._paused = true;
    this.saveState();
  }

  /** Zera o livro de ordens, intenções e histórico para uma nova sessão/replay (preservando ativação). */
  public resetBook(): void {
    this._positions = [];
    this._intents = [];
    this._lastSignal = undefined;
    this._totalCloses = 0;
    this.saveState();
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
    this.saveState();
  }

  public updateConfig(patch: Partial<AutomationConfig> & { maxOpenPositions?: number }): void {
    if (typeof patch.maxOpenPositions === 'number' && patch.maxOpenPositions >= 1) {
      this._maxOpenPositions = Math.max(1, Math.min(20, Math.round(patch.maxOpenPositions)));
    }
    this._config = {
      ...this._config,
      ...patch,
      magicNumber: this.magic,
      robotRole: this.role,
      directionLock: (patch.directionLock || this._config.directionLock || (this.direction === 'BUY' ? 'BUY_ONLY' : 'SELL_ONLY')) as DirectionLock,
      onCloseOpposite: patch.onCloseOpposite !== undefined ? patch.onCloseOpposite : (this._config.onCloseOpposite ?? false),
    };

    // Recalcula SL e TP nas posições abertas em tempo real quando o operador edita SL ou TP na tela
    const newSlPts = this._config.stopLossPoints && this._config.stopLossPoints > 0 ? this._config.stopLossPoints : 100;
    const newTpPts = this._config.takeProfitPoints && this._config.takeProfitPoints > 0 ? this._config.takeProfitPoints : 50;
    this._positions = this._positions.map((p) => {
      if (p.status !== 'OPEN') return p;
      const updatedTP = patch.takeProfitPoints !== undefined
        ? (p.type === 'BUY' ? p.entryPrice + newTpPts : p.entryPrice - newTpPts)
        : p.takeProfit;
      const updatedSL = (patch.stopLossPoints !== undefined && !p.isBreakevenActive)
        ? (p.type === 'BUY' ? p.entryPrice - newSlPts : p.entryPrice + newSlPts)
        : p.stopLoss;
      return {
        ...p,
        stopLoss: updatedSL,
        takeProfit: updatedTP,
      };
    });

    this.saveState();
  }

  public get maxOpenPositions(): number {
    return this._maxOpenPositions;
  }

  public setMaxOpenPositions(max: number): void {
    this._maxOpenPositions = Math.max(1, Math.min(20, Math.round(max || 3)));
    this.saveState();
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
      if (closed.length > 0) this.saveState();
      return { closed };
    }

    if (direction !== this.direction || this._paused) return { closed };

    // Trava anti-acúmulo de ordens: respeita o limite máximo de posições abertas simultâneas deste EA
    const currentOpenCount = this._positions.filter((p) => p.status === 'OPEN').length;
    if (currentOpenCount >= (this._maxOpenPositions || 3)) {
      return { closed };
    }

    const validation = this.validateOrder({ type: direction, price, contracts: this._config.contracts, tagSuffix: `BOX${boxIndex}` });
    if (!validation.valid || !validation.sanitizedOrder) return { closed };
    const so = validation.sanitizedOrder;

    const slPoints = this._config.stopLossPoints && this._config.stopLossPoints > 0 ? this._config.stopLossPoints : 100;
    const tpPoints = this._config.takeProfitPoints && this._config.takeProfitPoints > 0 ? this._config.takeProfitPoints : 50;
    const stopLoss = direction === 'BUY' ? price - slPoints : price + slPoints;
    const takeProfit = direction === 'BUY' ? price + tpPoints : price - tpPoints;

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
      `Robô ${this.role} (magic ${this.magic}) sinal ${direction} box #${boxIndex} a ${price}. Intenção registrada. Comentário: ${so.comment}. SL: ${stopLoss} | TP: ${takeProfit}.`,
      price, so.contracts, undefined
    );

    const position: DirectionalPosition = {
      id: intent.id, type: direction, entryPrice: price, contracts: so.contracts, stopLoss, takeProfit,
      symbol: so.symbol, magic: this.magic, comment: so.comment, openedAt: Date.now(), status: 'OPEN',
      isBreakevenActive: false,
      highestPriceSinceEntry: price,
      lowestPriceSinceEntry: price,
      auditTrail: [evt],
    };
    this._positions.push(position);
    this.saveState();

    return { intent, closed };
  }

  /** Marca‑a‑mercado todas as posições abertas (Trailing Stop / Breakeven, SL/TP e PnL flutuante). */
  public onTick(price: number): void {
    if (!isPriceSaneForAsset(price, this.asset)) return;
    this._lastPrice = price;
    let stateChanged = false;

    const slDefault = this._config.stopLossPoints && this._config.stopLossPoints > 0 ? this._config.stopLossPoints : 100;
    const tpDefault = this._config.takeProfitPoints && this._config.takeProfitPoints > 0 ? this._config.takeProfitPoints : 50;
    const trailingEnabled = this._config.trailingStop !== false;
    const activationPts = this._config.trailingActivationPoints || 20;
    const distancePts = this._config.trailingDistancePoints || 15;
    const beOffsetPts = this._config.breakevenOffsetPoints ?? 5;

    for (let i = 0; i < this._positions.length; i++) {
      const p = this._positions[i];
      if (p.status !== 'OPEN') continue;

      // 1. Garante que SL e TP estejam preenchidos caso alguma posição antiga estivesse zerada
      let currentSL = p.stopLoss && p.stopLoss > 0
        ? p.stopLoss
        : (p.type === 'BUY' ? p.entryPrice - slDefault : p.entryPrice + slDefault);
      let currentTP = p.takeProfit && p.takeProfit > 0
        ? p.takeProfit
        : (p.type === 'BUY' ? p.entryPrice + tpDefault : p.entryPrice - tpDefault);

      let curHigh = Math.max(p.highestPriceSinceEntry || p.entryPrice, price);
      let curLow = Math.min(p.lowestPriceSinceEntry || p.entryPrice, price);
      let isBE = Boolean(p.isBreakevenActive);
      let auditTrail = p.auditTrail || [];

      // 2. Proteção de Ordem Vencedora: Breakeven + Trailing Stop Dinâmico
      // Uma ordem que atingiu o gatilho positivo (ex.: +20 pts) NUNCA mais pode voltar e dar prejuízo!
      if (trailingEnabled) {
        if (p.type === 'BUY') {
          const maxFavorablePts = curHigh - p.entryPrice;
          if (maxFavorablePts >= activationPts) {
            const minProtectedSL = p.entryPrice + beOffsetPts;
            const candidateSL = Math.max(minProtectedSL, curHigh - distancePts);
            if (candidateSL > currentSL) {
              const prevSL = currentSL;
              currentSL = candidateSL;
              if (!isBE) {
                isBE = true;
                const beEvt = OrderAuditService.createEvent(
                  'BREAKEVEN_MOVED',
                  `Proteção de ganho / Trailing Stop (${this.role})`,
                  `Ordem vencedora protegida (+${maxFavorablePts} pts atingidos). Stop Loss movido de ${prevSL} para ${currentSL} (+${currentSL - p.entryPrice} pts garantidos).`,
                  price, p.contracts, currentSL - p.entryPrice
                );
                auditTrail = [...auditTrail, beEvt];
              }
              stateChanged = true;
            }
          }
        } else {
          const maxFavorablePts = p.entryPrice - curLow;
          if (maxFavorablePts >= activationPts) {
            const minProtectedSL = p.entryPrice - beOffsetPts;
            const candidateSL = Math.min(minProtectedSL, curLow + distancePts);
            if (currentSL <= 0 || candidateSL < currentSL) {
              const prevSL = currentSL;
              currentSL = candidateSL;
              if (!isBE) {
                isBE = true;
                const beEvt = OrderAuditService.createEvent(
                  'BREAKEVEN_MOVED',
                  `Proteção de ganho / Trailing Stop (${this.role})`,
                  `Ordem vencedora protegida (+${maxFavorablePts} pts atingidos). Stop Loss movido de ${prevSL} para ${currentSL} (+${p.entryPrice - currentSL} pts garantidos).`,
                  price, p.contracts, p.entryPrice - currentSL
                );
                auditTrail = [...auditTrail, beEvt];
              }
              stateChanged = true;
            }
          }
        }
      }

      // Atualiza os campos de rastreamento da posição aberta
      if (
        p.stopLoss !== currentSL ||
        p.takeProfit !== currentTP ||
        p.highestPriceSinceEntry !== curHigh ||
        p.lowestPriceSinceEntry !== curLow ||
        p.isBreakevenActive !== isBE
      ) {
        this._positions[i] = {
          ...p,
          stopLoss: currentSL,
          takeProfit: currentTP,
          highestPriceSinceEntry: curHigh,
          lowestPriceSinceEntry: curLow,
          isBreakevenActive: isBE,
          auditTrail,
        };
      }

      // 3. Verificação de saída por Stop Loss (incluindo Trailing Stop / Breakeven) ou Take Profit
      const updatedPos = this._positions[i];
      const pts = updatedPos.type === 'BUY' ? price - updatedPos.entryPrice : updatedPos.entryPrice - price;
      const fin = pointsToBRL(pts, updatedPos.contracts, this.asset);
      let closed = false;
      let exitReason: 'TAKE_PROFIT_HIT' | 'STOP_LOSS_HIT' | 'TRAILING_STOP_HIT' | undefined;
      let finalPts = pts;
      let finalFin = fin;
      let execExitPrice = price;

      if (currentSL > 0) {
        const hitSL = updatedPos.type === 'BUY' ? price <= currentSL : price >= currentSL;
        if (hitSL) {
          closed = true;
          execExitPrice = currentSL;
          finalPts = updatedPos.type === 'BUY' ? currentSL - updatedPos.entryPrice : updatedPos.entryPrice - currentSL;
          finalFin = pointsToBRL(finalPts, updatedPos.contracts, this.asset);
          exitReason = isBE && finalPts >= 0 ? 'TRAILING_STOP_HIT' : 'STOP_LOSS_HIT';
        }
      }

      if (!closed && currentTP > 0) {
        const hitTP = updatedPos.type === 'BUY' ? price >= currentTP : price <= currentTP;
        if (hitTP) {
          closed = true;
          execExitPrice = currentTP;
          finalPts = updatedPos.type === 'BUY' ? currentTP - updatedPos.entryPrice : updatedPos.entryPrice - currentTP;
          finalFin = pointsToBRL(finalPts, updatedPos.contracts, this.asset);
          exitReason = 'TAKE_PROFIT_HIT';
        }
      }

      if (closed) {
        stateChanged = true;
        const evtType: OrderAuditEvent['action'] = exitReason === 'TAKE_PROFIT_HIT'
          ? 'TAKE_PROFIT_HIT'
          : exitReason === 'TRAILING_STOP_HIT'
            ? 'TRAILING_STOP_MOVED'
            : 'STOP_LOSS_HIT';
        const evtTitle = exitReason === 'TAKE_PROFIT_HIT'
          ? `Take Profit atingido (${this.role})`
          : exitReason === 'TRAILING_STOP_HIT'
            ? `Trailing Stop / Ganho Protegido (${this.role})`
            : `Stop Loss atingido (${this.role})`;
        const evt = OrderAuditService.createEvent(
          evtType,
          evtTitle,
          `Posição ${updatedPos.id} (${updatedPos.type}) encerrada por ${exitReason} a ${execExitPrice}. Resultado: ${finalPts >= 0 ? '+' : ''}${finalPts} pts (R$ ${finalFin.toFixed(2)}).`,
          execExitPrice, updatedPos.contracts, finalPts
        );
        this._positions[i] = {
          ...updatedPos,
          status: finalFin >= 0 ? 'CLOSED_PROFIT' : 'CLOSED_LOSS',
          exitPrice: execExitPrice,
          exitTimestamp: Date.now(),
          pointsResult: finalPts,
          financialResult: finalFin,
          auditTrail: [...auditTrail, evt],
        };
        this._totalCloses += 1;
      }
    }

    if (stateChanged) {
      this.saveState();
    }
  }

  /** Retorna snapshot completo do estado do robô. */
  public getSnapshot(): DirectionalRobotSnapshot {
    const open = this._positions.filter((p) => p.status === 'OPEN');
    const pnlFinancial = this._positions.filter((p) => p.financialResult !== undefined).reduce((acc, p) => acc + (p.financialResult || 0), 0);
    const pnlPoints = this._positions.filter((p) => p.pointsResult !== undefined).reduce((acc, p) => acc + (p.pointsResult || 0), 0);

    // Cálculo de PnL flutuante das posições em aberto contra o último preço
    let floatingPnlPoints = 0;
    let floatingPnlFinancial = 0;
    if (this._lastPrice > 0) {
      for (const op of open) {
        const pts = op.type === 'BUY' ? this._lastPrice - op.entryPrice : op.entryPrice - this._lastPrice;
        const fin = pointsToBRL(pts, op.contracts, this.asset);
        floatingPnlPoints += pts;
        floatingPnlFinancial += fin;
      }
    }

    return {
      direction: this.direction, magic: this.magic, role: this.role, paused: this._paused,
      executionMode: this._executionMode,
      customConfig: {
        contracts: this._config.contracts || 1,
        stopLossPoints: this._config.stopLossPoints || 100,
        takeProfitPoints: this._config.takeProfitPoints || 50,
        onCloseOpposite: Boolean(this._config.onCloseOpposite),
        trailingStop: this._config.trailingStop !== false,
        trailingActivationPoints: this._config.trailingActivationPoints || 20,
        trailingDistancePoints: this._config.trailingDistancePoints || 15,
        breakevenOffsetPoints: this._config.breakevenOffsetPoints ?? 5,
        maxOpenPositions: this._maxOpenPositions || 3,
      },
      lastSignal: this._lastSignal, intents: [...this._intents], positions: [...this._positions],
      openPositions: [...open], pnlPoints, pnlFinancial,
      floatingPnlFinancial, floatingPnlPoints,
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
