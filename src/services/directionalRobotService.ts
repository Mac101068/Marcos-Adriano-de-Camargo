import { AutomationConfig, DirectionLock, RobotRole } from '../types/trading';
import { SavedStrategy } from '../types/strategy';
import { AssetSpec, isPriceSaneForAsset, chartSymbolFor } from '../assets/assetRegistry';

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

export class DirectionalRobot {
  public readonly direction: 'BUY' | 'SELL';
  public readonly magic: 100001 | 100002;
  public readonly role: RobotRole;
  public readonly asset: AssetSpec;
  private _config: AutomationConfig;

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
