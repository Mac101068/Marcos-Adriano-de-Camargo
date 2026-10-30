export interface Tick {
  id: string;
  timestamp: number;
  timeStr: string;
  price: number;
  volume: number; // Quantidade de contratos
  aggressor: 'BUY' | 'SELL' | 'CROSS'; // Agressão compradora ou vendedora
  buyerBroker?: string;
  sellerBroker?: string;
}

export interface RenkoBox {
  index: number;
  direction: 'UP' | 'DOWN';
  open: number;
  close: number;
  high: number;
  low: number;
  timeStart: number;
  timeEnd: number;
  ticksCount: number;
  totalVolume: number;
  buyVolume: number;
  sellVolume: number;
  delta: number; // buyVolume - sellVolume
  cvdAtClose: number; // Cumulative Volume Delta at close of box
  isConvergence: boolean; // Se fechou com confirmação de fluxo
  convergenceType?: 'BUY_CONVERGENCE' | 'SELL_CONVERGENCE' | 'DIVERGENCE';
  orderDispatched?: 'BUY' | 'SELL';
}

export interface OrderAuditEvent {
  id: string;
  timestamp: number;
  timeStr: string;
  action:
    | 'TRIGGER_DETECTED'
    | 'ORDER_DISPATCHED'
    | 'ORDER_FILLED'
    | 'PARTIAL_FILLED'
    | 'BREAKEVEN_MOVED'
    | 'TRAILING_STOP_MOVED'
    | 'TAKE_PROFIT_HIT'
    | 'STOP_LOSS_HIT'
    | 'MANUAL_CLOSED'
    | 'ORDER_EXPIRED'
    | 'FLIP_REVERSAL_CLOSED'
    | 'DAY_CLOSE_FORCED';
  title: string;
  details: string;
  price?: number;
  contracts?: number;
  delta?: number;
}

export interface TradeOrder {
  id: string;
  ticket?: number;
  timestamp: number;
  timeStr: string;
  fillTimestamp?: number;
  fillTimeStr?: string;
  type: 'BUY' | 'SELL';
  role?: 'MAIN' | 'PYRAMID'; // Ordem Principal (Surfe) ou Ordem Adicional da Pirâmide (TP 50p)
  pyramidLevel?: number; // Nível da pirâmide (1, 2, 3...)
  entryPrice: number;
  exitPrice?: number;
  exitTimestamp?: number;
  exitTimeStr?: string;
  exitReason?: 'TAKE_PROFIT' | 'STOP_LOSS' | 'BREAKEVEN' | 'TRAILING_STOP' | 'MANUAL' | 'EXPIRED_PULLBACK' | 'FLIP_REVERSAL' | 'DAY_CLOSE';
  source?: 'ROBOT_EA' | 'MANUAL' | 'MT5_LIVE';
  magicNumber?: number;
  contracts: number;
  remainingContracts?: number; // Contratos restantes após saída parcial
  partialExecuted?: boolean; // Se a parcial já foi executada
  partialPrice?: number; // Preço de execução da parcial
  partialPoints?: number; // Pontos ganhos na parcial
  partialFinancial?: number; // Lucro em R$ da parcial
  partialTimestamp?: number;
  isBreakevenActive?: boolean; // Se SL já foi movido para o breakeven
  highestPriceSinceEntry?: number; // Para trailing stop em COMPRA
  lowestPriceSinceEntry?: number; // Para trailing stop em VENDA
  stopLoss: number;
  takeProfit: number;
  status: 'PENDING_LIMIT' | 'OPEN' | 'CLOSED_PROFIT' | 'CLOSED_LOSS' | 'CLOSED_MANUAL' | 'EXPIRED_PULLBACK';
  limitPrice?: number;
  pendingBoxIndex?: number;
  pointsResult?: number;
  financialResult?: number; // em R$ (R$ 0.20 por ponto por minicontrato WIN)
  triggerReason: string; // Ex: "Convergência Alta 10R (Delta +380 contratos)"
  isRealMT5?: boolean;
  auditTrail?: OrderAuditEvent[];
}

export interface IntradayAuditSummary {
  totalOrdersGenerated: number;
  ordersExecuted: number;
  ordersPending: number;
  ordersCancelledExpired: number;
  ordersClosed: number;
  winningOrders: number;
  losingOrders: number;
  breakevenOrders: number;
  executionRate: number; // %
  winRate: number; // %
  netFinancial: number; // R$
  totalPoints: number;
  profitFactor: number;
  partialExitsExecuted: number;
  totalPartialProfit: number;
  maxWinningTrade: number;
  maxLosingTrade: number;
}

export interface AutomationConfig {
  active: boolean;
  symbol: string; // Ex: WIN$N ou WINFUT
  boxPoints: number; // 50 pontos (10R no Mini-Índice)
  contracts: number; // Lote (ex: 1, 2, 5 contratos)
  minDeltaThreshold: number; // Delta mínimo para validar convergência (ex: 200 contratos)
  requireCvdNewExtreme: boolean; // Exige que o CVD faça nova máxima/mínima
  confirmationMode: 'BOX_CLOSE' | 'TICK_BREAKOUT'; // Disparar no fechamento ou no rompimento
  stopLossPoints: number; // Stop Loss (ex: 100 pontos = 2 boxes)
  takeProfitPoints: number; // Take Profit (ex: 150 pontos = 3 boxes)
  
  // Realização Parcial e Breakeven
  enablePartialExit: boolean; // Habilitar ordem parcial
  partialPoints: number; // Pontos para a parcial (ex: 50 pontos = 1 box 10R)
  partialContracts: number; // Quantidade de contratos na parcial (ex: 1)
  moveStopToBreakevenOnPartial: boolean; // Mover Stop Loss para Breakeven ao bater a parcial
  breakevenOffsetPoints: number; // Offset além da entrada (ex: +5 pontos para pagar taxas)

  // Trailing Stop Dinâmico
  trailingStop: boolean; // Habilitar Trailing Stop móvel
  trailingActivationPoints: number; // Pontos a favor necessários para ativar o trailing (ex: 60 pts)
  trailingDistancePoints: number; // Distância fixa atrás da máxima/mínima (ex: 50 pontos = 1 box)
  
  maxDailyLoss: number; // Trava de perda diária em R$
  maxDailyProfit: number; // Meta diária de ganho em R$
  maxDailyTrades: number; // Trava máxima de trades por dia
  mt5Host: string; // Ex: "localhost" ou "127.0.0.1"
  mt5Port: number; // Porta do WebSocket bridge Python (default 8765)

  // Segurança da Ponte WebSocket (o script .py gerado exige os mesmos valores)
  // Obs.: o token NÃO fica aqui — vive sozinho em localStorage (fluxo_bridge_token_v1),
  // para você trocar de preset / importar JSON sem perder (nem vazar) o segredo da ponte.
  mt5MaxContractsPerOrder: number; // teto de contratos por ordem que a ponte aceita
  mt5MaxOrdersPerMinute: number; // teto de ordens de entrada por minuto que a ponte aceita

  dataSourceMode: 'SIMULATION' | 'MT5_LIVE';
  
  // Configurações de Conta Hedge e Identificação MT5
  accountMode: 'HEDGE' | 'NETTING';
  maxSimultaneousPositions: number;
  hedgeOppositeAction: 'ALLOW_SIMULTANEOUS' | 'CLOSE_OPPOSITE' | 'IGNORE_NEW';
  orderFillingMode: 'ORDER_FILLING_IOC' | 'ORDER_FILLING_RETURN' | 'ORDER_FILLING_FOK';
  magicNumber: number; // Número Mágico do EA para rastreamento no MT5
  orderComment: string; // Identificador da ordem na boleta da B3
  
  // Configurações de Entrada no Pullback / Reteste da Abertura
  entryTriggerType: 'MARKET_ON_CLOSE' | 'PULLBACK_ENTRY'; // A mercado no fechamento vs Ordem limitada no retorno
  pullbackTarget: 'BOX_OPEN' | 'BOX_50_PCT' | 'CUSTOM_POINTS'; // Nível de reteste (Abertura do box = 50 pts, 50% = 25 pts, etc)
  pullbackCustomPoints: number; // Se custom, quantos pontos de recuo
  pullbackMaxBoxesWait: number; // Quantos boxes esperar o preço voltar antes de cancelar (ex: 2 boxes)

  // Filtro de Horários de Negociação (Day Trade B3)
  tradingHoursEnabled: boolean; // Habilitar filtro de horários
  tradingStartTime: string; // Início das operações (ex: "09:05")
  tradingStopEntriesTime: string; // Fim de novas entradas (ex: "17:00")
  tradingCloseAllTime: string; // Encerramento compulsório day trade (ex: "17:45")

  // Modalidade de Estratégia Quantitativa
  strategyMode: 'PULLBACK_RETEST' | 'PYRAMID_FLOW_CONFLUENCE'; // Reteste clássico ou Pirâmide com Confluência de Fluxo
  pyramidTpPoints: number; // Saída de TP para as ordens adicionais da pirâmide (padrão 50 pts)
  pyramidSlPoints: number; // Stop fixo OPCIONAL das ordens da pirâmide (0 = sem stop, saída só por inversão; se > 0, mínimo válido 25 pts)
  pyramidContracts: number; // Contratos para cada nova ordem da pirâmide (padrão 1 ctro)
  pyramidEntryType: 'MARKET_ON_CLOSE' | 'BOX_50_LIMIT' | 'BOX_OPEN_LIMIT'; // Entrada da Pirâmide: a mercado no fechamento, Limit a 50% do box ou Limit na entrada (abertura) do box (renko, range ou pontos)
  moveMainToBreakevenOnPyramidTp: boolean; // Ao bater o TP de uma pirâmide, mover o SL da ordem mãe para o breakeven (+offset de taxas)
  holdMainUntilFlip: boolean; // Manter a entrada principal aberta surfando até a virada de fluxo
  closeAllOnFlowFlip: boolean; // Zerar a entrada principal e qualquer ordem da pirâmide aberta na virada do fluxo
  noFixedStopLoss: boolean; // Elimina stops fixos: saídas 100% governadas por inversão do mercado

  // Metadados de Persistência e Perfil do Operador
  profileName?: string; // Nome do setup selecionado (ex: "Institucional 10R")
  lastSavedTimestamp?: number; // Data/Hora em que a configuração foi salva
}

export interface ConfigPreset {
  id: string;
  name: string;
  description: string;
  badge: string;
  isCustom?: boolean;
  config: AutomationConfig;
}

export interface MT5ConnectionState {
  status: 'DISCONNECTED' | 'CONNECTING' | 'CONNECTED' | 'ERROR';
  pingMs?: number;
  accountLogin?: number;
  brokerCompany?: string;
  balance?: number;
  isHedgeAccount?: boolean;
  lastError?: string;
  /** A ponte aceitou o token no handshake AUTH? undefined = ainda sem resposta */
  bridgeAuthOk?: boolean;
  /** Ponte liberada para ordens de ENTRADA (robô ligado no app). Saídas continuam livres. */
  bridgeArmed?: boolean;
  /** Ponte antiga, sem suporte a token (AUTH_TOKEN vazio no script baixado) */
  bridgeLegacy?: boolean;
}

export interface TerminalStats {
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number; // %
  totalPoints: number;
  netFinancial: number; // R$
  profitFactor: number;
  maxDrawdown: number; // R$
  convergencesDetected: number;
}
