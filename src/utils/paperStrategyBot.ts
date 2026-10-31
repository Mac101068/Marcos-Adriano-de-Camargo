import { RenkoBox, AutomationConfig } from '../types/trading';
import { isSessionCloseLock } from './sessionRules';
import { isWithinTradingWindow } from './tradingGates';
import { ASSETS, DEFAULT_ASSET_ID } from '../assets/assetRegistry';

/**
 * Robô Sombra (Paper Strategy Bot)
 * ------------------------------------------------------------------
 * Simula a MESMA estratégia do EA (Pirâmide de Confluência ou Reteste)
 * sobre barras fechadas de qualquer série (Renko, Range ou Tempo), todas
 * no formato RenkoBox. Usado pelo Coletor de Eficiência para comparar os
 * 3 gráficos rodando a mesma config, lado a lado, sem mexer nas ordens reais.
 *
 * Aproximações documentadas (o robô real roda no App com o ciclo completo):
 * - Pirâmide: MAIN entra no 1º sinal, pirâmides entram a cada sinal seguinte
 *   na mesma direção, cada pirâmide realiza em +pyramidTpPoints; na virada
 *   de fluxo tudo é zerado no preço de fechamento da barra.
 * - Reteste: SL/TP/saída parcial/breakeven pelos parâmetros da config.
 *   Trailing Stop não é simulado aqui (aproximação conservadora).
 * - Execução sempre no close da barra (BOX_CLOSE), a mercado, sem latência.
 */

/**
 * Valor do ponto usado pelo Robô Sombra. NÃO é mais um número solto: vem do registro de ativos
 * (default WIN). Fase 2 passa a receber o spec da estratégia simulada em vez deste default.
 */
export const POINT_VALUE_BRL = ASSETS[DEFAULT_ASSET_ID].pointValue; // R$ 0,20 por ponto por contrato (WIN)

export type SeriesKey =
  | 'renko'
  | 'range'
  | 'tempo'
  // Escalas Renko paralelas medidas apenas pelo coletor (nunca disparam ordens reais)
  | 'renko15r'
  | 'renko20r'
  | 'renko25r';

export interface PaperTrade {
  id: string;
  series: SeriesKey;
  mode: AutomationConfig['strategyMode'];
  direction: 'BUY' | 'SELL';
  role: 'MAIN' | 'PYRAMID';
  contracts: number;
  entryPrice: number;
  entryTime: number;
  exitPrice?: number;
  exitTime?: number;
  exitReason?: 'TAKE_PROFIT' | 'STOP_LOSS' | 'BREAKEVEN' | 'FLIP_REVERSAL' | 'PYRAMID_TP' | 'PYRAMID_SL' | 'PARTIAL' | 'DAY_CLOSE';
  points?: number;
  financial?: number;
  triggerReason: string;
  regimeFactor?: number; // Fator de regime do box de entrada (medição sempre ativa; exportado no CSV)
}

export interface EquityPoint {
  t: number;
  v: number; // equity acumulada em R$
}

export interface PaperStats {
  trades: number; // total de liquidções CONTINUAS (inclui o que saiu da lista por limite de memória)
  wins: number;
  losses: number;
  settled: number; // wins + losses (base real do win rate; exclusão = R$ 0 / breakeven)
  winRate: number; // % (0 se nenhum trade)
  totalPoints: number;
  totalFinancial: number;
  profitFactor: number; // ganho bruto / perda bruta (Infinity tratado na UI)
  maxDrawdown: number; // R$
  grossProfit: number; // soma de todas as liquidções positivas (R$)
  grossLossVal: number; // soma de todas as liquidções negativas em valor absoluto (R$)
  avgWin: number; // R$ médio por trade ganador
  avgLoss: number; // R$ médio por trade perdedor (negativo)
  expectancy: number; // R$ esperado por trade fechado = (ganho bruto - perda bruta) / settled
  largestWin: number; // maior ganho individual (R$, positivo)
  largestLoss: number; // maior perda individual (R$, negativo)
  openCount: number; // posições sombra ainda abertas
  unrealized: number; // R$ não realizado das posições abertas (marcação a mercado)
  liveEquity: number; // R$ realizado + não realizado ("resultado agora")
}

/** Acumulados contínuos do bot (persistidos para sobreviver a F5 sem perder métricas). */
export interface PaperCounters {
  bookedCount: number;
  winsCount: number;
  lossesCount: number;
  grossWin: number;
  grossLoss: number;
  totalPointsSum: number;
  equityPeak: number;
  maxDdRun: number;
  largestWin: number;
  largestLoss: number;
}

interface OpenPosition {
  trade: PaperTrade;
  sl: number;
  tp: number;
  partialExecuted: boolean;
  slIsBreakeven: boolean;
  remainingContracts: number; // qtde ainda aberta após saída parcial (fonte da verdade contábil)
  extremeHigh?: number; // máxima da perna (alimenta o acompanhamento da ordem mãe)
  extremeLow?: number; // mínima da perna
}

/** Ordem LIMITADA de entrada da Pirâmide aguardando o preço recuar até o nível do box. */
interface PendingEntry {
  direction: 'BUY' | 'SELL';
  role: 'MAIN' | 'PYRAMID';
  level: number; // preço de execução da limitada (abertura ou 50% do box)
  contracts: number;
  placedIndex: number; // box.index em que a ordem foi posicionada (para expiração)
  triggerReason: string;
}

let uid = 0;
const nextId = () => `paper_${Date.now().toString(36)}_${++uid}`;

export class PaperStrategyBot {
  readonly series: SeriesKey;
  private closedTrades: PaperTrade[] = [];
  private equity = 0;
  private equityCurve: EquityPoint[] = [];
  private openPositions: OpenPosition[] = [];
  private pendingEntries: PendingEntry[] = []; // apenas na Pirâmide com entrada Limit
  private livePrice = 0; // último preço visto (para marcação a mercado das posições abertas)
  // Acumulados contínuos: sobrevivem ao truncamento da lista de trades (replay de dias)
  private bookedCount = 0;
  private winsCount = 0;
  private lossesCount = 0;
  private grossWin = 0;
  private grossLoss = 0;
  private totalPointsSum = 0;
  private equityPeak = 0;
  private maxDdRun = 0;
  private largestWin = 0;
  private largestLoss = 0;

  constructor(series: SeriesKey) {
    this.series = series;
  }

  /** Atualiza o preço vivo para calcular o resultado não realizado (chamado a cada tick). */
  markToMarket(price: number) {
    this.livePrice = price;
  }

  /** R$ não realizado das posições abertas, marcado a mercado no último preço. */
  getUnrealized(): number {
    if (this.livePrice <= 0) return 0;
    let sum = 0;
    for (const pos of this.openPositions) {
      const t = pos.trade;
      const ct = pos.remainingContracts ?? t.contracts;
      if (ct <= 0) continue; // nada aberto nesta posição (parcial consumiu tudo)
      const dirSign = t.direction === 'BUY' ? 1 : -1;
      const pts = (this.livePrice - t.entryPrice) * dirSign;
      sum += pts * POINT_VALUE_BRL * ct;
    }
    return sum;
  }

  getLiveEquity(): number {
    return this.equity + this.getUnrealized();
  }

  /**
   * Curva de capital realizada + um ponto sintético "agora" com o não realizado,
   * para a tela Comparativo se mover em tempo real mesmo quando os boxes são grandes.
   */
  getEquityCurveWithLive(now: number): EquityPoint[] {
    if (this.openPositions.length === 0 || this.livePrice <= 0) return this.equityCurve;
    return [...this.equityCurve, { t: now, v: Number(this.getLiveEquity().toFixed(2)) }];
  }

  getTrades(): PaperTrade[] {
    return this.closedTrades;
  }

  getEquityCurve(): EquityPoint[] {
    return this.equityCurve;
  }

  getEquity(): number {
    return this.equity;
  }

  /** Reconstrói o estado a partir de um snapshot persistido (F5 não perde o histórico).
   *  Com `counters` persistidos, os acumulados contínuos sobrevivem inteiros ao reload;
   *  sem eles (snapshot antigo), recalcula a partir da lista de trades disponível. */
  hydrate(trades: PaperTrade[], curve: EquityPoint[], equity: number, counters?: PaperCounters) {
    this.closedTrades = trades;
    this.equityCurve = curve;
    this.equity = equity;
    if (counters) {
      this.bookedCount = counters.bookedCount ?? trades.length;
      this.winsCount = counters.winsCount ?? 0;
      this.lossesCount = counters.lossesCount ?? 0;
      this.grossWin = counters.grossWin ?? 0;
      this.grossLoss = counters.grossLoss ?? 0;
      this.totalPointsSum = counters.totalPointsSum ?? 0;
      this.equityPeak = counters.equityPeak ?? 0;
      this.maxDdRun = counters.maxDdRun ?? 0;
      this.largestWin = counters.largestWin ?? 0;
      this.largestLoss = counters.largestLoss ?? 0;
      return;
    }
    // Fallback: recupera os acumulados a partir dos trades persistidos
    this.bookedCount = 0;
    this.winsCount = 0;
    this.lossesCount = 0;
    this.grossWin = 0;
    this.grossLoss = 0;
    this.totalPointsSum = 0;
    this.largestWin = 0;
    this.largestLoss = 0;
    for (const t of trades) {
      const fin = t.financial ?? 0;
      this.bookedCount++;
      this.totalPointsSum += t.points ?? 0;
      if (fin > 0) {
        this.winsCount++;
        this.grossWin += fin;
        this.largestWin = Math.max(this.largestWin, fin);
      } else if (fin < 0) {
        this.lossesCount++;
        this.grossLoss += Math.abs(fin);
        this.largestLoss = Math.min(this.largestLoss, fin);
      }
    }
    this.equityPeak = 0;
    this.maxDdRun = 0;
    for (const p of curve) {
      this.equityPeak = Math.max(this.equityPeak, p.v);
      this.maxDdRun = Math.max(this.maxDdRun, this.equityPeak - p.v);
    }
  }

  /** Exposição dos acumulados contínuos para o coletor persistir junto. */
  getCounters(): PaperCounters {
    return {
      bookedCount: this.bookedCount,
      winsCount: this.winsCount,
      lossesCount: this.lossesCount,
      grossWin: this.grossWin,
      grossLoss: this.grossLoss,
      totalPointsSum: this.totalPointsSum,
      equityPeak: this.equityPeak,
      maxDdRun: this.maxDdRun,
      largestWin: this.largestWin,
      largestLoss: this.largestLoss,
    };
  }

  /** Registra o resultado de um trade sombra (ou perna parcial) na contabilidade. */
  private book(trade: PaperTrade, exitPrice: number, exitTime: number, reason: PaperTrade['exitReason']) {
    // Trava contábil: posição sem contratos (parcial consumiu tudo) NÃO pode ser liquidada
    if (trade.contracts <= 0) return;
    const dirSign = trade.direction === 'BUY' ? 1 : -1;
    const points = (exitPrice - trade.entryPrice) * dirSign;
    trade.exitPrice = exitPrice;
    trade.exitTime = exitTime;
    trade.exitReason = reason;
    trade.points = points;
    trade.financial = points * POINT_VALUE_BRL * trade.contracts;
    this.equity += trade.financial;
    this.closedTrades.push(trade);
    this.equityCurve.push({ t: exitTime, v: Number(this.equity.toFixed(2)) });
    // Acumulados contínuos (independentes do truncamento das listas)
    this.bookedCount++;
    this.totalPointsSum += points;
    if (trade.financial > 0) {
      this.winsCount++;
      this.grossWin += trade.financial;
      this.largestWin = Math.max(this.largestWin, trade.financial);
    } else if (trade.financial < 0) {
      this.lossesCount++;
      this.grossLoss += Math.abs(trade.financial);
      this.largestLoss = Math.min(this.largestLoss, trade.financial);
    }
    this.equityPeak = Math.max(this.equityPeak, this.equity);
    this.maxDdRun = Math.max(this.maxDdRun, this.equityPeak - this.equity);
    // Tetos de memória/persistência (replay de vários dias pode gerar milhares):
    // mantém as últimas 1200 unidades de cada estrutura
    if (this.closedTrades.length > 1200) this.closedTrades.splice(0, this.closedTrades.length - 1200);
    if (this.equityCurve.length > 1200) this.equityCurve.splice(0, this.equityCurve.length - 1200);
  }

  /**
   * Paridade terminal x coletor: a janela de entradas configurada é comparada com a HORA
   * DA BARRA (box.timeEnd), exatamente como o App faz com o timestamp do tick — e chama a
   * MESMA função do portão (utils/tradingGates), para as duas pontas nunca divergirem.
   * Fora da janela não abrem entradas novas — posições abertas continuam geridas normalmente.
   */
  private entryWindowBlocked(ts: number, config: AutomationConfig): boolean {
    return !isWithinTradingWindow(ts, config);
  }

  /**
   * Ciclo principal: chamado pelo Coletor para CADA barra fechada da série,
   * com o sinal já avaliado pelo convergenceEvaluator compartilhado.
   */
  onClosedBox(box: RenkoBox, signal: 'BUY' | 'SELL' | undefined, config: AutomationConfig) {
    if (box.close > 0) this.livePrice = box.close;
    // TRAVA DE FIM DE PREGÃO (hora `tradingCloseAllTime` da estratégia, padrão 17:30): quita as
    // posições sombra a mercado, derruba as limitadas pendentes e para de abrir operações. Sem isso
    // a posição "surfada" da Pirâmide atravessaria a noite e viraria uma trade do dia seguinte,
    // contaminando a estatística por dia.
    if (isSessionCloseLock(box.timeEnd, config.tradingCloseAllTime)) {
      for (const pos of this.openPositions) {
        this.book(pos.trade, box.close, box.timeEnd, 'DAY_CLOSE');
      }
      this.openPositions = [];
      this.pendingEntries = [];
      return;
    }
    if (config.strategyMode === 'PYRAMID_FLOW_CONFLUENCE') {
      this.stepPyramid(box, signal, config);
    } else {
      this.stepPullback(box, signal, config);
    }
  }

  // =========================================================================
  // PIRÂMIDE DE CONFLUÊNCIA (espelho da regra viva do App)
  // =========================================================================
  private stepPyramid(box: RenkoBox, signal: 'BUY' | 'SELL' | undefined, config: AutomationConfig) {
    const entryType = config.pyramidEntryType || 'MARKET_ON_CLOSE';
    const useLimitEntry = entryType !== 'MARKET_ON_CLOSE';

    // 1) Zera o lado contrário na virada de fluxo (posições abertas e limitadas pendentes)
    if (signal && config.closeAllOnFlowFlip) {
      const opposite = this.openPositions.filter((p) => p.trade.direction !== signal);
      for (const pos of opposite) {
        this.book(pos.trade, box.close, box.timeEnd, 'FLIP_REVERSAL');
      }
      if (opposite.length > 0) {
        this.openPositions = this.openPositions.filter((p) => p.trade.direction === signal);
      }
      this.pendingEntries = this.pendingEntries.filter((p) => p.direction === signal);
    }

    // 2) Execução das ordens LIMITADAS de entrada: só entram se o preço recuar até o nível.
    // Fora da janela de horários nenhuma nova entrada se materializa (paridade com a tela).
    const windowBlocked = this.entryWindowBlocked(box.timeEnd, config);
    if (!windowBlocked) {
      for (const pend of [...this.pendingEntries]) {
        const waitBoxes = Math.max(1, config.pullbackMaxBoxesWait ?? 2);
        if (box.index - pend.placedIndex >= waitBoxes) {
          this.pendingEntries = this.pendingEntries.filter((p) => p !== pend);
          continue;
        }
        const filled = pend.direction === 'BUY' ? box.low <= pend.level : box.high >= pend.level;
        if (!filled) continue;
        this.pendingEntries = this.pendingEntries.filter((p) => p !== pend);
        this.openPyramidPosition(pend.direction, pend.role, pend.contracts, pend.level, box.timeEnd, config, pend.triggerReason, box.regimeFactor);
      }
    }

    // 3) Saídas: TP das pirâmides (+pyramidTpPoints), stop opcional e breakeven liberado na ordem mãe
    const tpPts = Math.max(1, config.pyramidTpPoints);
    const pyrSlPts = (config.pyramidSlPoints ?? 0) > 0 ? config.pyramidSlPoints : 0;
    for (const pos of [...this.openPositions]) {
      const isBuy = pos.trade.direction === 'BUY';
      if (pos.trade.role === 'PYRAMID') {
        const target = isBuy ? pos.trade.entryPrice + tpPts : pos.trade.entryPrice - tpPts;
        const hit = isBuy ? box.high >= target : box.low <= target;
        if (hit) {
          this.book(pos.trade, target, box.timeEnd, 'PYRAMID_TP');
          this.openPositions = this.openPositions.filter((p) => p !== pos);
          if (config.moveMainToBreakevenOnPyramidTp) {
            this.protectMainAtBreakeven(pos.trade.direction, config);
          }
          continue;
        }
        if (pyrSlPts > 0 && pos.sl > 0) {
          const hitSl = isBuy ? box.low <= pos.sl : box.high >= pos.sl;
          if (hitSl) {
            this.book(pos.trade, pos.sl, box.timeEnd, 'PYRAMID_SL');
            this.openPositions = this.openPositions.filter((p) => p !== pos);
          }
        }
      } else {
        // Ordem mãe: gatilho + acompanhamento do preço (mesma regra do terminal) e só depois a checagem
        this.trailMainStop(pos, box, config);
        if (pos.sl > 0) {
          // Protegida no breakeven/trailing (ou com stop) — sai se o preço voltar até ele
          const hitSl = isBuy ? box.low <= pos.sl : box.high >= pos.sl;
          if (hitSl) {
            this.book(pos.trade, pos.sl, box.timeEnd, pos.slIsBreakeven ? 'BREAKEVEN' : 'STOP_LOSS');
            this.openPositions = this.openPositions.filter((p) => p !== pos);
          }
        }
      }
    }

    // 4) Nova entrada/piramidação no sinal
    if (!signal) return;
    // Janela de horários desligada para ENTRADAS (mesmo gate do terminal; saídas seguem livres)
    if (windowBlocked) return;
    const sameSide = this.openPositions.filter((p) => p.trade.direction === signal);
    const pendingSameSide = this.pendingEntries.filter((p) => p.direction === signal);
    const hasMain =
      sameSide.some((p) => p.trade.role === 'MAIN') || pendingSameSide.some((p) => p.role === 'MAIN');
    const role: 'MAIN' | 'PYRAMID' = hasMain ? 'PYRAMID' : 'MAIN';
    // Uma limitada por vez por lado + limite de 10 pirâmides simultâneas
    if (pendingSameSide.length > 0) return;
    if (role === 'PYRAMID' && sameSide.filter((p) => p.trade.role === 'PYRAMID').length >= 10) return;

    const contracts = role === 'MAIN' ? config.contracts : Math.max(1, config.pyramidContracts);
    const level =
      entryType === 'BOX_50_LIMIT'
        ? (box.open + box.close) / 2
        : entryType === 'BOX_OPEN_LIMIT'
        ? box.open
        : box.close;
    const reason = `Bloco #${box.index} @ ${level.toFixed?.(0) ?? level}`;

    if (useLimitEntry) {
      this.pendingEntries.push({
        direction: signal,
        role,
        level,
        contracts,
        placedIndex: box.index,
        triggerReason: `${reason} [LIMIT ${entryType === 'BOX_OPEN_LIMIT' ? 'entrada do box' : '50% do box'}]`,
      });
      return;
    }

    this.openPyramidPosition(signal, role, contracts, box.close, box.timeEnd, config, reason, box.regimeFactor);
  }

  /** Registra a posição aberta da Pirâmide no preço de entrada (fechamento do box ou nível do Limit). */
  private openPyramidPosition(
    direction: 'BUY' | 'SELL',
    role: 'MAIN' | 'PYRAMID',
    contracts: number,
    entryPrice: number,
    entryTime: number,
    config: AutomationConfig,
    triggerReason: string,
    regimeFactor?: number
  ) {
    // Stop opcional apenas das ordens da pirâmide (ordem mãe continua sem SL fixo)
    const entrySl =
      role === 'PYRAMID' && (config.pyramidSlPoints ?? 0) > 0
        ? direction === 'BUY'
          ? entryPrice - config.pyramidSlPoints
          : entryPrice + config.pyramidSlPoints
        : 0;
    const trade: PaperTrade = {
      id: nextId(),
      series: this.series,
      mode: 'PYRAMID_FLOW_CONFLUENCE',
      direction,
      role,
      contracts,
      entryPrice,
      entryTime,
      triggerReason,
      regimeFactor,
    };
    this.openPositions.push({
      trade,
      sl: entrySl,
      tp: 0,
      partialExecuted: false,
      slIsBreakeven: false,
      remainingContracts: contracts,
    });
  }

  /**
   * Proteção móvel da ordem mãe, espelhando o terminal: o GATILHO (trailingActivationPoints pts a
   * favor) coloca o primeiro stop no piso entrada + offset das taxas e, a partir daí, o stop
   * acompanha a máxima/mínima da perna sempre a trailingDistancePoints de distância.
   */
  private trailMainStop(pos: OpenPosition, box: RenkoBox, config: AutomationConfig) {
    if (!config.trailingStop || pos.trade.role !== 'MAIN') return;
    const entry = pos.trade.entryPrice;
    const isBuy = pos.trade.direction === 'BUY';
    const actPts = config.trailingActivationPoints ?? 60;
    const distPts = config.trailingDistancePoints ?? 50;
    const offsetPts = config.breakevenOffsetPoints ?? 0;

    const hi = Math.max(pos.extremeHigh ?? entry, box.high);
    const lo = Math.min(pos.extremeLow ?? entry, box.low);
    pos.extremeHigh = hi;
    pos.extremeLow = lo;

    // vale o que proteger mais: o piso do gatilho ou o rastro do extremo
    const target = isBuy
      ? hi - entry >= actPts
        ? Math.max(entry + offsetPts, hi - distPts)
        : 0
      : entry - lo >= actPts
      ? Math.min(entry - offsetPts, lo + distPts)
      : 0;
    if (target <= 0) return;

    const improves = pos.sl <= 0 || (isBuy ? target > pos.sl : target < pos.sl);
    if (!improves) return;
    pos.sl = target;
    pos.slIsBreakeven = true;
  }

  /** Move o stop da ordem mãe para o breakeven (entrada + offset de taxas) após um TP de pirâmide. */
  private protectMainAtBreakeven(direction: 'BUY' | 'SELL', config: AutomationConfig) {
    const offset = config.breakevenOffsetPoints ?? 0;
    for (const pos of this.openPositions) {
      if (pos.trade.role !== 'MAIN' || pos.trade.direction !== direction) continue;
      const isBuy = direction === 'BUY';
      const beSL = isBuy ? pos.trade.entryPrice + offset : pos.trade.entryPrice - offset;
      const improves = pos.sl <= 0 || (isBuy ? beSL > pos.sl : beSL < pos.sl);
      if (!improves || beSL <= 0) continue;
      pos.sl = beSL;
      pos.slIsBreakeven = true;
    }
  }

  // =========================================================================
  // RETESTE / PULLBACK CLÁSSICO (SL, TP, parcial e breakeven pela config)
  // =========================================================================
  private stepPullback(box: RenkoBox, signal: 'BUY' | 'SELL' | undefined, config: AutomationConfig) {
    // 1) Gere as posições abertas contra a caminhada do preço (SL antes de TP: conservador)
    for (const pos of [...this.openPositions]) {
      const t = pos.trade;
      // Posição já consumida pela saída parcial: encerra sem liquidar (evita trade-fantasma de 0 ctros)
      if (pos.remainingContracts <= 0) {
        this.openPositions = this.openPositions.filter((p) => p !== pos);
        continue;
      }
      if (t.direction === 'BUY') {
        // Parcial + breakeven
        if (
          config.enablePartialExit &&
          !pos.partialExecuted &&
          box.high >= t.entryPrice + config.partialPoints
        ) {
          const partialContracts = Math.min(config.partialContracts, pos.remainingContracts);
          if (partialContracts > 0) {
            const leg: PaperTrade = { ...t, id: nextId(), contracts: partialContracts, exitPrice: undefined, exitTime: undefined, exitReason: undefined, points: undefined, financial: undefined };
            this.book(leg, t.entryPrice + config.partialPoints, box.timeEnd, 'PARTIAL');
            pos.remainingContracts -= partialContracts;
            t.contracts = pos.remainingContracts; // espelho contábil para CSV/inspeção
            pos.partialExecuted = true;
            if (config.moveStopToBreakevenOnPartial) {
              pos.sl = t.entryPrice + config.breakevenOffsetPoints;
              pos.slIsBreakeven = true;
            }
          }
        }
        if (pos.remainingContracts <= 0) {
          this.openPositions = this.openPositions.filter((p) => p !== pos);
          continue;
        }
        if (box.low <= pos.sl) {
          this.book(t, pos.sl, box.timeEnd, pos.slIsBreakeven ? 'BREAKEVEN' : 'STOP_LOSS');
          this.openPositions = this.openPositions.filter((p) => p !== pos);
          continue;
        }
        if (box.high >= pos.tp) {
          this.book(t, pos.tp, box.timeEnd, 'TAKE_PROFIT');
          this.openPositions = this.openPositions.filter((p) => p !== pos);
          continue;
        }
      } else {
        if (
          config.enablePartialExit &&
          !pos.partialExecuted &&
          box.low <= t.entryPrice - config.partialPoints
        ) {
          const partialContracts = Math.min(config.partialContracts, pos.remainingContracts);
          if (partialContracts > 0) {
            const leg: PaperTrade = { ...t, id: nextId(), contracts: partialContracts, exitPrice: undefined, exitTime: undefined, exitReason: undefined, points: undefined, financial: undefined };
            this.book(leg, t.entryPrice - config.partialPoints, box.timeEnd, 'PARTIAL');
            pos.remainingContracts -= partialContracts;
            t.contracts = pos.remainingContracts; // espelho contábil para CSV/inspeção
            pos.partialExecuted = true;
            if (config.moveStopToBreakevenOnPartial) {
              pos.sl = t.entryPrice - config.breakevenOffsetPoints;
              pos.slIsBreakeven = true;
            }
          }
        }
        if (pos.remainingContracts <= 0) {
          this.openPositions = this.openPositions.filter((p) => p !== pos);
          continue;
        }
        if (box.high >= pos.sl) {
          this.book(t, pos.sl, box.timeEnd, pos.slIsBreakeven ? 'BREAKEVEN' : 'STOP_LOSS');
          this.openPositions = this.openPositions.filter((p) => p !== pos);
          continue;
        }
        if (box.low <= pos.tp) {
          this.book(t, pos.tp, box.timeEnd, 'TAKE_PROFIT');
          this.openPositions = this.openPositions.filter((p) => p !== pos);
          continue;
        }
      }
    }

    // 1.5) Execução das LIMITADAS de reteste (paridade com o terminal): só entram se o preço
    // recuar até o nível dentro da validade; SL/TP nascem ancorados no nível executado.
    if (!this.entryWindowBlocked(box.timeEnd, config)) {
      for (const pend of [...this.pendingEntries]) {
        const waitBoxes = Math.max(1, config.pullbackMaxBoxesWait ?? 2);
        if (box.index - pend.placedIndex >= waitBoxes) {
          this.pendingEntries = this.pendingEntries.filter((p) => p !== pend);
          continue;
        }
        const filled = pend.direction === 'BUY' ? box.low <= pend.level : box.high >= pend.level;
        if (!filled) continue;
        this.pendingEntries = this.pendingEntries.filter((p) => p !== pend);
        this.openPullbackPosition(pend.direction, pend.contracts, pend.level, box.timeEnd, config, pend.triggerReason, box.regimeFactor);
      }
    }

    // 2) Nova entrada por convergência (uma por lado por vez)
    if (!signal) return;
    // Paridade com a tela: fora da janela de horários configurada não abre entrada nova
    if (this.entryWindowBlocked(box.timeEnd, config)) return;
    if (this.openPositions.some((p) => p.trade.direction === signal)) return;
    if (this.pendingEntries.some((p) => p.direction === signal)) return;

    // Entradas LIMITADAS no reteste (PULLBACK_ENTRY): espelha o cálculo de nível do App.tsx
    if (config.entryTriggerType === 'PULLBACK_ENTRY') {
      const level =
        config.pullbackTarget === 'BOX_50_PCT'
          ? (box.open + box.close) / 2
          : config.pullbackTarget === 'CUSTOM_POINTS'
          ? signal === 'BUY'
            ? box.close - config.pullbackCustomPoints
            : box.close + config.pullbackCustomPoints
          : box.open; // BOX_OPEN (100% de recuo)
      this.pendingEntries.push({
        direction: signal,
        role: 'MAIN',
        level,
        contracts: config.contracts,
        placedIndex: box.index,
        triggerReason: `Box #${box.index} [LIMIT ${config.pullbackTarget} @ ${level.toFixed?.(0) ?? level}]`,
      });
      return;
    }

    this.openPullbackPosition(signal, config.contracts, box.close, box.timeEnd, config, `Box #${box.index} @ ${box.close.toFixed?.(0) ?? box.close}`, box.regimeFactor);
  }

  /** Abre a posição do Reteste com SL/TP ancorados no preço real de entrada (fechamento ou nível do Limit). */
  private openPullbackPosition(
    direction: 'BUY' | 'SELL',
    contracts: number,
    entryPrice: number,
    entryTime: number,
    config: AutomationConfig,
    triggerReason: string,
    regimeFactor?: number
  ) {
    const trade: PaperTrade = {
      id: nextId(),
      series: this.series,
      mode: 'PULLBACK_RETEST',
      direction,
      role: 'MAIN',
      contracts,
      entryPrice,
      entryTime,
      triggerReason,
      regimeFactor,
    };
    this.openPositions.push({
      trade,
      sl: direction === 'BUY' ? entryPrice - config.stopLossPoints : entryPrice + config.stopLossPoints,
      tp: direction === 'BUY' ? entryPrice + config.takeProfitPoints : entryPrice - config.takeProfitPoints,
      partialExecuted: false,
      slIsBreakeven: false,
      remainingContracts: contracts,
    });
  }

  getStats(): PaperStats {
    const wins = this.winsCount;
    const losses = this.lossesCount;
    const settled = wins + losses;

    return {
      trades: this.bookedCount,
      wins,
      losses,
      settled,
      winRate: settled > 0 ? (wins / settled) * 100 : 0,
      totalPoints: this.totalPointsSum,
      totalFinancial: this.equity,
      profitFactor: this.grossLoss > 0 ? this.grossWin / this.grossLoss : this.grossWin > 0 ? Number.POSITIVE_INFINITY : 0,
      maxDrawdown: this.maxDdRun,
      grossProfit: this.grossWin,
      grossLossVal: this.grossLoss,
      avgWin: wins > 0 ? this.grossWin / wins : 0,
      avgLoss: losses > 0 ? -this.grossLoss / losses : 0,
      expectancy: settled > 0 ? (this.grossWin - this.grossLoss) / settled : 0,
      largestWin: this.largestWin,
      largestLoss: this.largestLoss,
      openCount: this.openPositions.length,
      unrealized: this.getUnrealized(),
      liveEquity: this.getLiveEquity(),
    };
  }

  reset() {
    this.closedTrades = [];
    this.equityCurve = [];
    this.equity = 0;
    this.openPositions = [];
    this.pendingEntries = [];
    this.bookedCount = 0;
    this.winsCount = 0;
    this.lossesCount = 0;
    this.grossWin = 0;
    this.grossLoss = 0;
    this.totalPointsSum = 0;
    this.equityPeak = 0;
    this.maxDdRun = 0;
    this.largestWin = 0;
    this.largestLoss = 0;
  }
}
