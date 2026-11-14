import type { AssetId } from '../assets/assetRegistry';

export type DirectionLock = 'BOTH' | 'BUY_ONLY' | 'SELL_ONLY';
export type RobotRole = 'MAIN' | 'BUY_ROBOT' | 'SELL_ROBOT';

// ==============================================================================
// IDENTIDADE DOS ROBÔS (Fase 2 do multi-robô) — o `magic` é a placa do EA no MT5:
// cada robô carimba suas ordens com um número próprio e a ponte só mexe na posição
// cujo magic bate com quem mandou o comando. Robô 2 (sombra) é PAPEL puro: não tem
// magic e nunca despacha — quando (e se) ele virar real, nasce com magic próprio.
// =============================================================================

/** Magic padrão do Robô 1 quando o operador nunca digitou um. */
export const DEFAULT_MAGIC_NUMBER = 101010;
/** Ordens da Boleta manual: magic fixo que a ponte usa para ISOLAR o que o robô não pode tocar. */
export const MANUAL_ORDER_MAGIC = 999999;

/** Magic do robô principal efetivo (config + fallback histórico do app). */
export function mainRobotMagic(config: { magicNumber?: number }): number {
  return config.magicNumber || DEFAULT_MAGIC_NUMBER;
}

/** Rótulo humano de quem opera uma ordem pelo magic (auditoria, painel, chips). */
export function robotTagForMagic(magic?: number): string {
  if (!magic) return 'sem magic';
  if (magic === MANUAL_ORDER_MAGIC) return 'Boleta manual';
  return `Robô 1 · magic ${magic}`;
}

/** Recorte de ticks reais por pregão, catalogado pela ponte local em data/pregoes/. */
export interface LocalPregao {
  path: string;
  date: string;
  weekday: string;
  symbol: string;
  sizeMb: number;
}

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
  regimeFactor?: number; // Fator de regime (volume recente ÷ média do dia) vigente no fechamento do box
  // Box que pertence ao DIA DE CONTEXTO estático do replay (ontem): entra só para dar
  // contexto de posição ao gráfico e por isso NUNCA deve exibir marcas de ordem/convergência.
  isStaticContext?: boolean;
  // Dia (YYYY-MM-DD) da sessão a que o box pertence. É o que separa dois pregões no mesmo
  // gráfico: quando muda de um box para o seguinte, existe um gap de abertura entre eles.
  sessionDate?: string;
}

/**
 * Gap de abertura entre dois pregões: fechamento do último box de um dia → abertura do
 * primeiro tick do dia seguinte. Não vira box Renko (o motor re-ancora na abertura), mas
 * precisa ser desenhado — é justamente o salto que o operador quer enxergar.
 */
export interface SessionGap {
  fromDate: string;
  toDate: string;
  fromPrice: number;
  toPrice: number;
  /** Pontos do gap: positivo = abriu acima do fechamento anterior. */
  gapPoints: number;
  /** Índice do primeiro box da sessão nova (o gap fica à esquerda dele). */
  boxIndex: number;
  timestamp: number;
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
    | 'DAY_CLOSE_FORCED'
    // Robôs direcionais (hedge): o sinal do robô CONTRÁRIO fechou só as posições deste robô
    // (onCloseOpposite → CLOSE_POSITIONS com o magic do robô alvo). Ver directionalRobotService.
    | 'OPPOSITE_ROBOT_SIGNAL';
  title: string;
  details: string;
  price?: number;
  contracts?: number;
  delta?: number;
}

export interface TradeOrder {
  id: string;
  ticket?: number;
  symbol?: string;
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
  exitReason?: 'TAKE_PROFIT' | 'STOP_LOSS' | 'BREAKEVEN' | 'TRAILING_STOP' | 'MANUAL' | 'EXPIRED_PULLBACK' | 'FLIP_REVERSAL' | 'DAY_CLOSE' | 'FINANCIAL_LOCK' | 'OPPOSITE_ROBOT_SIGNAL';
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
  /**
   * Ativo escolhido no seletor do Header (Fase 2). Opcional de propósito: config e estratégia
   * salvos antes disto não têm o campo e continuam resolvendo pelo prefixo do `symbol`.
   */
  assetId?: AssetId;
  symbol: string; // Ex: WIN$N ou WINFUT
  boxPoints: number; // FONTE ÚNICA da escala do tijolo (WIN: 50 pts = 10R; editável na engrenagem do gráfico)
  contracts: number; // Lote (ex: 1, 2, 5 contratos)
  minDeltaThreshold: number; // Delta mínimo para validar convergência (ex: 200 contratos)
  adaptiveThresholdEnabled: boolean; // Limiar adaptativo: ±minDeltaThreshold × fator de regime do momento
  /**
   * Percentil do pregão usado pelo corte adaptativo (0..0.95). P60 = "os 40% boxes mais
   * agressivos deste lado sinalizam". Subir (P70/P75/P80) torna o funil mais SELETIVO: só as
   * viradas com agressão acima da média do próprio pregão disparam. Opcional: config antigo
   * sem o campo cai no 0.60 histórico (mesmo comportamento de antes).
   */
  adaptiveThresholdPercentile?: number;
  /**
   * Habilita a afinação dinâmica dos limiares de agressão (P70 vs P80 e divergência)
   * por fase do pregão segundo o Tape Time da fita:
   * - Abertura (09:00 - 10:30): P70 e divergência 15% (alta liquidez e volatilidade)
   * - Meio-dia (12:00 - 14:00): P80 e divergência 25% (consolidação / almoço)
   * - Fechamento (16:00 - 17:30): P80 e divergência 20% (desaceleração pré-leilão)
   */
  timeBasedRegimeEnabled?: boolean;
  /**
   * Piso RELATIVO do limiar auto-calibrado (multiplicador da média de agressão do mesmo lado no
   * DIA inteiro; 1–5). O corte do funil é o maior entre o percentil da janela e piso × média-do-dia:
   * num pregão morto o piso impede o funil de afrouxar junto com o dia (dia lateral sem agressão
   * simplesmente não sinaliza). Opcional: sem o campo, 1,3×. Zero valor físico envolvedo.
   */
  adaptiveFloorMultiple?: number;
  /**
   * DIVERGÊNCIA DE FLUXO mínima (escala-free, 0–1): fração do volume do box que precisa ser
   * agressão LÍQUIDA (|Δ| ÷ volume total). Um box 100% comprado a mercado tem divergência ~1;
   * um box de leilão/lado confuso tem ~0. Como é uma FRAÇÃO, não depende da grandeza física do
   * volume — sobrevive a mudanças de escala, volatilidade e proxy de volume. Opcional: sem o
   * campo (undefined) o funil NÃO aplica este corte (comportamento histórico intacto).
   */
  flowDivergenceMin?: number;
  regimeLookbackBoxes: number; // Nº de boxes recentes na janela do medidor de regime (padrão 20)
  /**
   * Filtro de ACUMULAÇÃO (range curto). Com LIGADO, um sinal só vale se o mercado estiver
   * DIRECIONAL nos últimos `consolidationLookbackBoxes` boxes — medido pela Efficiency Ratio
   * (deslocamento líquido ÷ caminho percorrido, 0..1). ER abaixo de `consolidationErMax` =
   * o mercado está só serrando → silencia o sinal (não abre, não piramida, não vira). Padrão DESLIGADO.
   */
  consolidationFilterEnabled: boolean;
  consolidationLookbackBoxes: number; // Nº de boxes recentes na janela da Efficiency Ratio (padrão 10)
  consolidationErMax: number; // Abaixo desta ER (0..1) considera acumulação/range curto (padrão 0.30)
  /**
   * Filtro de EXAUSTÃO (opcional, padrão DESLIGADO): silencia o sinal quando a agressão do box
   * caiu a `exhaustionDeltaRatio` (ou menos) da do último box do MESMO lado — movimento perdendo força.
   */
  exhaustionFilterEnabled: boolean;
  exhaustionDeltaRatio: number; // Fração da força do box anterior que ainda vale (padrão 0.7)
  /**
   * Filtro de TENDÊNCIA DO FLUXO (cor do painel FLUXO, padrão DESLIGADO): em CVD subindo só
   * passam sinais de compra, em CVD caindo só os de venda. O sinal contrário é calado com o
   * motivo `CALADO_TENDENCIA_FLUXO` no diário — nunca vira ordem.
   */
  flowTrendFilterEnabled?: boolean;
  flowTrendLookback?: number; // Boxes que definem a inclinação do CVD (padrão 20)
  requireCvdNewExtreme: boolean; // Exige que o CVD faça nova máxima/mínima
  confirmationMode: 'BOX_CLOSE' | 'TICK_BREAKOUT'; // Disparar no fechamento ou no rompimento
  stopLossPoints: number; // Stop Loss (ex: 100 pontos = 2 boxes)
  takeProfitPoints: number; // Take Profit (ex: 150 pontos = 3 boxes)
  
  // Realização Parcial e Breakeven
  enablePartialExit: boolean; // Habilitar ordem parcial
  partialPoints: number; // Pontos para a parcial (ex: 1 box do tamanho definido em boxPoints)
  partialContracts: number; // Quantidade de contratos na parcial (ex: 1)
  moveStopToBreakevenOnPartial: boolean; // Mover Stop Loss para Breakeven ao bater a parcial
  breakevenOffsetPoints: number; // Offset além da entrada (ex: +5 pontos para pagar taxas)

  // Breakeven POR DISTÂNCIA (padronização 07/11/2026): a boleta é a fonte única de verdade.
  // Quando a operação anda `breakevenTriggerPoints` a favor, o stop sobe para
  // entrada + max(breakevenLockPoints, breakevenOffsetPoints) — o colchão de taxa nunca é
  // violado e o operador manda no número que quer garantir. 0 em qualquer um dos dois
  // desliga este breakeven (nada fixo no código: o valor é sempre o da boleta).
  breakevenTriggerPoints: number; // Pontos A FAVOR até armar o breakeven (ex: 150)
  breakevenLockPoints: number; // Pontos GARANTIDOS quando arma (ex: 100)

  // Trailing Stop Dinâmico
  trailingStop: boolean; // Habilitar Trailing Stop móvel
  trailingActivationPoints: number; // Pontos a favor necessários para ativar o trailing (ex: 60 pts)
  trailingDistancePoints: number; // Distância fixa atrás da máxima/mínima (ex: 50 pontos = 1 box)
  
  maxDailyLoss: number; // Trava de perda diária em R$
  maxDailyProfit: number; // Meta diária de ganho em R$
  maxDailyTrades: number; // Trava máxima de trades por dia
  closeAllOnFinancialLock: boolean; // Ao bater qualquer trava financeira, zerar o que está aberto (false = só para de abrir)
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
  /**
   * Número Mágico do EA para rastreamento no MT5.
   *
   * LEGADO NA ESTRATÉGIA (remoção gradual, Passo 2 robôs direcionais): o magic é IDENTIDADE
   * RUNTIME do robô, não parâmetro de estratégia. O campo continua no tipo e continua sendo LIDO
   * de estratégias salvas antigas (compatibilidade), mas `strategyLibraryService` o trata como
   * chave de runtime: ativar/editar estratégia não troca mais o magic do Robô 1, e os robôs
   * direcionais (RoboCompra 100001 / RoboVenda 100002) recebem o magic na ATIVAÇÃO
   * (`createDirectionalRobot`), nunca da estratégia.
   */
  magicNumber: number;
  orderComment: string; // Identificador da ordem na boleta da B3

  /**
   * Trava de direção da ESTRATÉGIA (conta hedge). undefined = 'BOTH' — estratégia salva antes do
   * campo continua operando os dois lados, exatamente como antes. Um robô direcional rejeita
   * qualquer ordem que conflite com esta trava.
   */
  directionLock?: DirectionLock;
  /**
   * Sinal contrário fecha as posições do robô ALVO (só as do magic dele) — campo de estratégia.
   * undefined/false = comportamento atual (nenhum fechamento cruzado entre robôs).
   */
  onCloseOpposite?: boolean;
  /**
   * Papel do robô dono deste config. É RUNTIME (identidade, como o magic): nunca vem da estratégia.
   * undefined = 'MAIN' = Robô 1 de hoje, nada muda para ele.
   */
  robotRole?: RobotRole;
  
  // Configurações de Entrada no Pullback / Reteste da Abertura
  entryTriggerType: 'MARKET_ON_CLOSE' | 'PULLBACK_ENTRY'; // A mercado no fechamento vs Ordem limitada no retorno
  pullbackTarget: 'BOX_OPEN' | 'BOX_50_PCT' | 'CUSTOM_POINTS'; // Nível de reteste (Abertura do box = 50 pts, 50% = 25 pts, etc)
  pullbackCustomPoints: number; // Se custom, quantos pontos de recuo
  pullbackMaxBoxesWait: number; // Quantos boxes esperar o preço voltar antes de cancelar (ex: 2 boxes)

  // TRAVA DE HORÁRIO DE NEGOCIAÇÃO (Day Trade B3) — livre das 08:55 às 17:30, bloqueado de 17:30
  // até 08:55 do dia seguinte (assim o leilão de abertura aparece e o 1º candle já é operável)
  tradingHoursEnabled: boolean; // Ligar/desligar a trava de horário
  tradingStartTime: string; // Primeira entrada permitida ("HH:MM", padrão "08:55")
  tradingStopEntriesTime: string; // Última entrada permitida ("HH:MM", padrão "17:30")
  tradingCloseAllTime: string; // Zeragem compulsória do pregão ("HH:MM", padrão "17:30")

  // Modalidade de Estratégia Quantitativa
  // Reteste clássico, Pirâmide com Confluência de Fluxo, ou Acumulação por Sinal (só C/V)
  strategyMode: 'PULLBACK_RETEST' | 'PYRAMID_FLOW_CONFLUENCE' | 'SIGNAL_STACK';
  pyramidTpPoints: number; // Saída de TP para as ordens adicionais da pirâmide (padrão 50 pts)
  pyramidSlPoints: number; // Stop fixo OPCIONAL das ordens da pirâmide (0 = sem stop, saída só por inversão; se > 0, mínimo válido 25 pts)
  pyramidContracts: number; // Contratos para cada nova ordem da pirâmide (padrão 1 ctro)
  pyramidEntryType: 'MARKET_ON_CLOSE' | 'BOX_50_LIMIT' | 'BOX_OPEN_LIMIT'; // Entrada da Pirâmide: a mercado no fechamento, Limit a 50% do box ou Limit na entrada (abertura) do box (renko, range ou pontos)
  moveMainToBreakevenOnPyramidTp: boolean; // Ao bater o TP de uma pirâmide, mover o SL da ordem mãe para o breakeven (+offset de taxas)
  holdMainUntilFlip: boolean; // Manter a entrada principal aberta surfando até a virada de fluxo
  closeAllOnFlowFlip: boolean; // Zerar a entrada principal e qualquer ordem da pirâmide aberta na virada do fluxo
  /**
   * Confirmação da virada (revalidação pós-calibração): nº de boxes CONSECUTIVOS na direção
   * do sinal novo exigidos antes de deixar o flip zerar o lado contrário. Padrão 1 = regra atual.
   * Com N>1 o sinal contrário não confirmado é ignorado (sem flip E sem entrada — não vira hedge).
   */
  flipConfirmBoxes?: number;
  noFixedStopLoss: boolean; // Elimina stops fixos: saídas 100% governadas por inversão do mercado

  /**
   * ROBÔ 2 (SOMBRA) — segundo robô rodando em PAPEL, com estratégia própria da biblioteca e
   * escala Renko alternativa. Opcional de propósito: config antigas recebem o default do
   * eaConfigService. NUNCA dispara ordem real — a blindagem é a ausência de wiring (o runner
   * não recebe socket nem o setOrders do App).
   */
  shadowRobot?: ShadowRobotConfig;

  // Metadados de Persistência e Perfil do Operador
  profileName?: string; // Nome do setup selecionado (ex: "Institucional 10R") — rótulo de exibição
  /**
   * FASE A (banco de dados único): id da `SavedStrategy` na biblioteca
   * (`fluxo_strategy_library_v1`) que é a FONTE AUTORITATIVA dos campos de estratégia deste
   * config. Opcional de propósito: config antigos não têm o campo e são vinculados/semeados por
   * `StrategyLibraryService.ensureActiveStrategy` no boot. Runtime/conexão (active, host, porta,
   * dataSourceMode, shadowRobot) ficam SÓ aqui, nunca na estratégia.
   */
  strategyId?: string | null;
  lastSavedTimestamp?: number; // Data/Hora em que a configuração foi salva
}

/**
 * Escala do Robô 2 PEDIDA EM R, nunca em pontos: pontos dependem do tick do ativo
 * (15R = 75 pts no WIN, 7,5 pts no WDO). Guardar R é o que mantém o relatório comparável
 * depois de trocar de mercado.
 */
export type ShadowScaleR = 15 | 20 | 25;

export interface ShadowRobotConfig {
  enabled: boolean;
  /** id da estratégia na biblioteca (StrategyLibraryService). null = ainda sem estratégia escolhida. */
  strategyId: string | null;
  scaleR: ShadowScaleR;
}

export interface ConfigPreset {
  id: string;
  name: string;
  description: string;
  badge: string;
  isCustom?: boolean;
  config: AutomationConfig;
}

export interface MT5Deal {
  ticket: number;
  order: number;
  time: number;
  timeStr: string;
  symbol: string;
  type: 'BUY' | 'SELL';
  volume: number;
  price: number;
  profit: number;
  commission?: number;
  swap?: number;
  comment?: string;
  magic?: number;
}

export interface MT5Position {
  ticket: number;
  time: number;
  timeStr: string;
  symbol: string;
  type: 'BUY' | 'SELL';
  volume: number;
  priceOpen: number;
  priceCurrent: number;
  profit: number;
  sl: number;
  tp: number;
  magic?: number;
  comment?: string;
}

export interface MT5ConnectionState {
  status: 'DISCONNECTED' | 'CONNECTING' | 'CONNECTED' | 'ERROR';
  pingMs?: number;
  accountLogin?: number;
  brokerCompany?: string;
  /** Servidor da conta no MT5 (ex.: "XPMT5-DEMO"): é o que separa demo de real. */
  server?: string;
  /** trade_mode do MT5: 0 = demo, 1 = concurso, 2 = real. */
  tradeMode?: number;
  balance?: number;
  equity?: number;
  floatingProfit?: number;
  margin?: number;
  marginFree?: number;
  deals?: MT5Deal[];
  positions?: MT5Position[];
  dayStats?: {
    buyContractsToday: number;
    sellContractsToday: number;
    totalContractsToday: number;
    realizedProfit: number;
    realizedLoss: number;
    netRealized: number;
    dealsCount: number;
  };
  dayStatsBySymbol?: Record<string, {
    buyContractsToday: number;
    sellContractsToday: number;
    totalContractsToday: number;
    realizedProfit: number;
    realizedLoss: number;
    netRealized: number;
    dealsCount: number;
  }>;
  isHedgeAccount?: boolean;
  lastError?: string;
  /** A ponte aceitou o token no handshake AUTH? undefined = ainda sem resposta */
  bridgeAuthOk?: boolean;
  /** Ponte liberada para ordens de ENTRADA (robô ligado no app). Saídas continuam livres. */
  bridgeArmed?: boolean;
  /**
   * Trava de execução do processo da ponte (variável de ambiente ORDERS_BLOCKED no PC do MT5).
   * true = a ponte está em modo replay/validação: serve ticks, histórico, sinais e diário, mas
   * nenhuma ordem de ENTRADA sai, mesmo com o robô ligado aqui. Precisa aparecer na tela senão o
   * operador acha que o robô vai operar e ele está apenas ensaiando.
   */
  bridgeOrdersBlocked?: boolean;
  /** Modo replay ligado PELO APP (action SET_REPLAY_MODE) no processo atual. Não é persistente. */
  bridgeReplayMode?: boolean;
  /** A trava veio do ambiente (ORDERS_BLOCKED=1 no PC do MT5)? Então o app não consegue desligá-la. */
  bridgeEnvLock?: boolean;
  /** Ponte antiga, sem suporte a token (AUTH_TOKEN vazio no script baixado) */
  bridgeLegacy?: boolean;
  /** Contrato que o script .py está transmitindo (ACCOUNT_INFO.symbol) — confere com o ativo escolhido */
  scriptSymbol?: string;
  /** Magic do robô embutido no script .py (ACCOUNT_INFO.robotMagic) — se divergir do Ajustes,
   * as posições ficam carimbadas com placa diferente da que o app espera filtrar */
  scriptRobotMagic?: number;
  /** R$/ponto que o script .py usa nos relatórios em dinheiro (ACCOUNT_INFO.pointValue) */
  scriptPointValue?: number;
  /** Ordens pendentes no book do MT5 (incluindo degraus do Varal) */
  pendingOrders?: Array<{
    ticket: number;
    time: number;
    symbol: string;
    type: 'BUY_STOP' | 'SELL_STOP' | 'BUY_LIMIT' | 'SELL_LIMIT';
    volume: number;
    price: number;
    sl: number;
    tp: number;
    magic: number;
    comment: string;
  }>;
  /** Configurações ativas do Varal de Ordens (Robô 2 real) */
  varalConfig?: Record<string, any>;
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
