import { RenkoBox, AutomationConfig } from '../types/trading';

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

export const POINT_VALUE_BRL = 0.2; // R$ 0,20 por ponto por contrato (WIN)

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
  exitReason?: 'TAKE_PROFIT' | 'STOP_LOSS' | 'BREAKEVEN' | 'FLIP_REVERSAL' | 'PYRAMID_TP' | 'PARTIAL';
  points?: number;
  financial?: number;
  triggerReason: string;
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
}

let uid = 0;
const nextId = () => `paper_${Date.now().toString(36)}_${++uid}`;

export class PaperStrategyBot {
  readonly series: SeriesKey;
  private closedTrades: PaperTrade[] = [];
  private equity = 0;
  private equityCurve: EquityPoint[] = [];
  private openPositions: OpenPosition[] = [];
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
   * Ciclo principal: chamado pelo Coletor para CADA barra fechada da série,
   * com o sinal já avaliado pelo convergenceEvaluator compartilhado.
   */
  onClosedBox(box: RenkoBox, signal: 'BUY' | 'SELL' | undefined, config: AutomationConfig) {
    if (box.close > 0) this.livePrice = box.close;
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
    // 1) Zera o lado contrário na virada de fluxo
    if (signal && config.closeAllOnFlowFlip) {
      const opposite = this.openPositions.filter((p) => p.trade.direction !== signal);
      for (const pos of opposite) {
        this.book(pos.trade, box.close, box.timeEnd, 'FLIP_REVERSAL');
      }
      if (opposite.length > 0) {
        this.openPositions = this.openPositions.filter((p) => p.trade.direction === signal);
      }
    }

    // 2) TP das pirâmides abertas (+pyramidTpPoints)
    const tpPts = Math.max(1, config.pyramidTpPoints);
    for (const pos of [...this.openPositions]) {
      if (pos.trade.role !== 'PYRAMID') continue;
      const target =
        pos.trade.direction === 'BUY'
          ? pos.trade.entryPrice + tpPts
          : pos.trade.entryPrice - tpPts;
      const hit =
        pos.trade.direction === 'BUY' ? box.high >= target : box.low <= target;
      if (hit) {
        this.book(pos.trade, target, box.timeEnd, 'PYRAMID_TP');
        this.openPositions = this.openPositions.filter((p) => p !== pos);
      }
    }

    // 3) Nova entrada/piramidação no sinal
    if (!signal) return;
    const sameSide = this.openPositions.filter((p) => p.trade.direction === signal);
    const hasMain = sameSide.some((p) => p.trade.role === 'MAIN');
    const role: 'MAIN' | 'PYRAMID' = hasMain ? 'PYRAMID' : 'MAIN';
    // Limite de pirâmides simultâneas para não explodir a memória: 10 níveis
    if (role === 'PYRAMID' && sameSide.filter((p) => p.trade.role === 'PYRAMID').length >= 10) return;

    const contracts = role === 'MAIN' ? config.contracts : Math.max(1, config.pyramidContracts);
    const trade: PaperTrade = {
      id: nextId(),
      series: this.series,
      mode: 'PYRAMID_FLOW_CONFLUENCE',
      direction: signal,
      role,
      contracts,
      entryPrice: box.close,
      entryTime: box.timeEnd,
      triggerReason: `Bloco #${box.index} @ ${box.close.toFixed?.(0) ?? box.close}`,
    };
    this.openPositions.push({
      trade,
      sl: 0,
      tp: 0,
      partialExecuted: false,
      slIsBreakeven: false,
      remainingContracts: contracts,
    });
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

    // 2) Nova entrada por convergência (uma por lado por vez)
    if (!signal) return;
    if (this.openPositions.some((p) => p.trade.direction === signal)) return;
    const entry = box.close;
    const trade: PaperTrade = {
      id: nextId(),
      series: this.series,
      mode: 'PULLBACK_RETEST',
      direction: signal,
      role: 'MAIN',
      contracts: config.contracts,
      entryPrice: entry,
      entryTime: box.timeEnd,
      triggerReason: `Box #${box.index} @ ${entry.toFixed?.(0) ?? entry}`,
    };
    this.openPositions.push({
      trade,
      sl: signal === 'BUY' ? entry - config.stopLossPoints : entry + config.stopLossPoints,
      tp: signal === 'BUY' ? entry + config.takeProfitPoints : entry - config.takeProfitPoints,
      partialExecuted: false,
      slIsBreakeven: false,
      remainingContracts: config.contracts,
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
