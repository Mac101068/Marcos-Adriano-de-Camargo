import { RenkoBox } from '../types/trading';

/**
 * Medidor de Regime de Sessão — assimetria intradiária em tempo real
 * ------------------------------------------------------------------
 * O mercado é assimétrico: o volume por box na abertura roda várias vezes acima
 * do almoço (curva em U) e a agressão compradora x vendedora tem distribuições
 * diferentes. Um limiar de delta FIXO para o dia inteiro ou é frouxo de manhã ou
 * travado à tarde. Este medidor quantifica o regime corrente da série:
 *
 *   fator = volume médio dos últimos N boxes ÷ média do dia até agora (clamp 0,5–3,0)
 *
 * e dois fatores direcionais (magnitude de delta positivo x negativo, mesma ideia),
 * que o convergenceEvaluator usa para adaptar o limiar de agressão. A medição é
 * SEMPRE ativa (alimentada mesmo com o gate desligado) — é a base da seção
 * "Regime do Mercado" da Avaliação Técnica.
 *
 * Reset automático na virada de dia (mesma chave YYYY-MM-DD local da âncora de
 * sessão dos motores de barra). Nada aqui envia ordem ou toca o MT5.
 */

export interface RegimePoint {
  t: number; // timeEnd do box
  factor: number; // multiplicador de volume vigente
  buy: number; // fator direcional de compra
  sell: number; // fator direcional de venda
}

export interface RegimeHourStats {
  hour: number;
  boxes: number;
  meanFactor: number;
  strongFixed: number; // boxes com |delta| >= limiar fixo
  strongAdaptive: number; // boxes com |delta| >= limiar adaptado (fixo × fator)
  posDeltaMean: number; // média das deltas positivas
  negDeltaMean: number; // média das magnitudes negativas
}

/**
 * retrato do limiar auto-calibrado (Ciclo 17 — regra "a tela nunca pode mentir sobre por que
 * não operou"): além do número final, diz DE ONDE ele veio — o percentil da janela, o piso
 * relativo (multiplicador da média do dia) e qual dos dois mandou no corte. É o que a faixa
 * do funil exibe para avaliação, sem recalcular nada em duplicidade.
 */
export interface SelfCalibratedBreakdown {
  limit: number; // o corte vigente (mesmo número que getSelfCalibratedLimit devolve)
  source: 'percentil' | 'piso' | 'fisico'; // qual regra governou o corte
  percentileValue: number | null; // P da janela rolante (null = sem estatística)
  floorValue: number | null; // piso relativo (média do dia × multiplicador)
  dayMean: number | null; // média de agressão do lado no dia inteiro
  dayCount: number; // amostras do lado no dia
  samples: number; // amostras do lado na janela (para o percentil)
}

interface BoxRecord {
  t: number;
  hour: number;
  vol: number;
  delta: number;
  factor: number; // fator calculado no fechamento deste box
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

const dayKey = (ts: number): string => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Warm-up: mínimo de boxes e minutos de sessão antes de confiar no multiplicador. */
const MIN_BOXES_WARMUP = 20;
const MIN_MINUTES_WARMUP = 15;
const MAX_RECORDS = 2000;

export class SessionRegimeMeter {
  private lookbackBoxes: number;
  private records: BoxRecord[] = [];
  private dayKey?: string;
  // Totais do dia (para as médias "até agora")
  private dayVolSum = 0;
  private dayPosDeltaSum = 0;
  private dayPosDeltaCount = 0;
  private dayNegDeltaSum = 0; // magnitude (positiva)
  private dayNegDeltaCount = 0;
  private sessionStartTs = 0;
  // Fatores do último box fechado (leitura corrente)
  private lastFactor = 1;
  private lastBuy = 1;
  private lastSell = 1;

  constructor(lookbackBoxes: number = 20) {
    this.lookbackBoxes = Math.max(5, Math.min(100, Math.round(lookbackBoxes) || 20));
  }

  setLookbackBoxes(n: number) {
    this.lookbackBoxes = Math.max(5, Math.min(100, Math.round(n) || 20));
  }

  /** Zera o estado medido (chamado quando o motor reinicializa a série). */
  reset() {
    this.dayKey = undefined;
    this.resetDay(Date.now());
  }

  private resetDay(ts: number) {
    this.records = [];
    this.dayKey = dayKey(ts);
    this.dayVolSum = 0;
    this.dayPosDeltaSum = 0;
    this.dayPosDeltaCount = 0;
    this.dayNegDeltaSum = 0;
    this.dayNegDeltaCount = 0;
    this.sessionStartTs = ts;
    this.lastFactor = 1;
    this.lastBuy = 1;
    this.lastSell = 1;
  }

  /**
   * Chamado pelo motor de barra UMA ÚNICA vez por box fechado (antes da avaliação
   * de convergência, para o box carregar o fator com que foi julgado).
   */
  feedClosedBox(box: RenkoBox) {
    const ts = box.timeEnd;
    if (this.dayKey === undefined || dayKey(ts) !== this.dayKey) {
      this.resetDay(ts);
    }

    const rec: BoxRecord = {
      t: ts,
      hour: new Date(ts).getHours(),
      vol: Math.max(0, box.totalVolume || 0),
      delta: box.delta || 0,
      factor: 1,
    };

    // Acumula os totais do dia ANTES do box atual (a média de referência é "até aqui")
    const n = this.records.length;
    const dayBoxes = n + 1;
    const dayMeanVol = (this.dayVolSum + rec.vol) / dayBoxes;
    const win = this.records.slice(-this.lookbackBoxes);
    const winMeanVol =
      win.length > 0 ? win.reduce((a, b) => a + b.vol, 0) / win.length : dayMeanVol;

    // Direcionais: magnitude média de delta por lado (dia x janela recente)
    const dayPosMean = this.dayPosDeltaCount > 0 ? this.dayPosDeltaSum / this.dayPosDeltaCount : 0;
    const dayNegMean = this.dayNegDeltaCount > 0 ? this.dayNegDeltaSum / this.dayNegDeltaCount : 0;
    const winPos = win.filter((b) => b.delta > 0);
    const winNeg = win.filter((b) => b.delta < 0);
    const winPosMean = winPos.length > 0 ? winPos.reduce((a, b) => a + b.delta, 0) / winPos.length : dayPosMean;
    const winNegMean = winNeg.length > 0 ? winNeg.reduce((a, b) => a - b.delta, 0) / winNeg.length : dayNegMean;

    const warm =
      dayBoxes >= MIN_BOXES_WARMUP && ts - this.sessionStartTs >= MIN_MINUTES_WARMUP * 60 * 1000;

    rec.factor = warm && dayMeanVol > 0 ? clamp(winMeanVol / dayMeanVol, 0.5, 3.0) : 1;
    this.lastFactor = rec.factor;
    this.lastBuy = warm && dayPosMean > 0 ? clamp(winPosMean / dayPosMean, 0.5, 3.0) : 1;
    this.lastSell = warm && dayNegMean > 0 ? clamp(winNegMean / dayNegMean, 0.5, 3.0) : 1;

    this.records.push(rec);
    if (this.records.length > MAX_RECORDS) this.records.splice(0, this.records.length - MAX_RECORDS);
    this.dayVolSum += rec.vol;
    if (rec.delta > 0) {
      this.dayPosDeltaSum += rec.delta;
      this.dayPosDeltaCount++;
    } else if (rec.delta < 0) {
      this.dayNegDeltaSum += -rec.delta;
      this.dayNegDeltaCount++;
    }
  }

  /** Multiplicador de volume vigente (1.0 no warm-up). */
  getFactor(): number {
    return this.lastFactor;
  }

  /** Fatores direacionais correntes: pressão de compra x pressão de venda. */
  getDirectionalFactors(): { buy: number; sell: number } {
    return { buy: this.lastBuy, sell: this.lastSell };
  }

  /** Limite adaptado para o lado pedido: fixo × fator de volume × fator direcional. */
  getAdaptiveLimit(baseThreshold: number, side: 'BUY' | 'SELL', boxDelta: number): number {
    // boxDelta entra só para o caso degenerado (sem warm-up ambos são 1)
    const dir = side === 'BUY' ? this.lastBuy : this.lastSell;
    // Direção do box dominante: usa o fator do lado correspondente ao sinal
    return Math.round(baseThreshold * clamp(this.lastFactor * dir, 0.5, 3.0));
  }

  /**
   * Limiar CALCULADO do pregão (Ciclo 12 — regra do operador: "os limiares são calculados,
   * não dependem de valores físicos"). Em vez de um número de contratos travado, o corte é
   * o percentil `percentile` das agressões DO PRÓPRIO LADO nas últimas janelas de boxes:
   * P60 de compra = "os 40% boxes verdes mais agressivos deste pregão sinalizam". O limiar
   * sobe e desce com a régua da sessão (abertura forte, almoço magro) sem nenhum valor físico.
   * Sem histórico suficiente (menos de 10 boxes fechados), não há estatística: cai no velho
   * fixo × fator — que é também o comportamento de warm-up.
   */
  getPercentileLimit(side: 'BUY' | 'SELL', percentile: number, baseThreshold: number): number {
    if (this.records.length < 10) return this.getAdaptiveLimit(baseThreshold, side, 0);
    const win = this.records.slice(-Math.max(this.lookbackBoxes, 20));
    const mags =
      side === 'BUY'
        ? win.map((r) => r.delta).filter((d) => d > 0)
        : win.map((r) => -r.delta).filter((d) => d > 0);
    if (mags.length < 5) return this.getAdaptiveLimit(baseThreshold, side, 0);
    const sorted = [...mags].sort((a, b) => a - b);
    const idx = Math.min(sorted.length - 1, Math.floor(clamp(percentile, 0, 0.95) * sorted.length));
    return Math.max(1, Math.round(sorted[idx]));
  }

  /**
   * Limiar AUTO-CALIBRADO (zero valor físico): o corte é o MAIOR entre
   *   1) o percentil `percentile` das agressões do próprio lado na janela rolante da sessão
   *      (a régua local: abertura forte sobe o corte, almoço magro o abaixa), e
   *   2) `floorMultiple` × média do DIA inteiro do mesmo lado (o piso relativo: impede o
   *      funil de afrouxar junto com um pregão morto — dia lateral só sinaliza caixa que é
   *      agressiva PARA aquele dia, e em dia sem agressão nenhuma simplesmente não sinaliza).
   * Zera na virada de dia (como todo o medidor), então cada pregão calibra a própria régua.
   * Sem estatística (menos de 10 boxes ou 5 amostras do lado) cai no fixo físico informado
   * — aquecimento conservador, nunca inventa sinal.
   */
  getSelfCalibratedLimit(side: 'BUY' | 'SELL', percentile: number, floorMultiple: number, baseThreshold: number): number {
    return this.getSelfCalibratedBreakdown(side, percentile, floorMultiple, baseThreshold).limit;
  }

  /**
   * RETRATO do limiar auto-calibrado — a mesma matemática de `getSelfCalibratedLimit`, mas
   * devolvendo também as peças (percentil da janela, piso relativo, média do dia) e qual delas
   * governou o corte. É a fonte honesta da faixa do funil: o número exibido é LITERALMENTE o
   * número que o avaliador de convergência usa, porque `getSelfCalibratedLimit` só delega aqui.
   */
  getSelfCalibratedBreakdown(
    side: 'BUY' | 'SELL',
    percentile: number,
    floorMultiple: number,
    baseThreshold: number
  ): SelfCalibratedBreakdown {
    const win = this.records.slice(-Math.max(this.lookbackBoxes, 20));
    const mags =
      side === 'BUY'
        ? win.map((r) => r.delta).filter((d) => d > 0)
        : win.map((r) => -r.delta).filter((d) => d > 0);
    const dayCount = side === 'BUY' ? this.dayPosDeltaCount : this.dayNegDeltaCount;
    const daySum = side === 'BUY' ? this.dayPosDeltaSum : this.dayNegDeltaSum;
    const dayMean = dayCount >= 5 ? daySum / dayCount : null;
    const floorMult = clamp(floorMultiple, 1, 5);
    const floorValue = dayMean != null ? dayMean * floorMult : null;

    // Sem estatística (menos de 10 boxes fechados ou 5 amostras do lado): cai no físico.
    if (this.records.length < 10 || mags.length < 5) {
      return {
        limit: baseThreshold,
        source: 'fisico',
        percentileValue: null,
        floorValue,
        dayMean,
        dayCount,
        samples: mags.length,
      };
    }

    const sorted = [...mags].sort((a, b) => a - b);
    const idx = Math.min(sorted.length - 1, Math.floor(clamp(percentile, 0, 0.95) * sorted.length));
    const p = sorted[idx];
    const useFloor = floorValue != null && floorValue > p;
    return {
      limit: Math.max(1, Math.round(useFloor ? floorValue! : p)),
      source: useFloor ? 'piso' : 'percentil',
      percentileValue: p,
      floorValue,
      dayMean,
      dayCount,
      samples: mags.length,
    };
  }

  isWarmedUp(): boolean {
    return this.lastFactor !== 1 || this.records.length >= MIN_BOXES_WARMUP;
  }

  /** Série temporal do fator (para gráfico/inspeção futura). */
  getSeries(): RegimePoint[] {
    return this.records.map((r) => ({ t: r.t, factor: r.factor, buy: this.lastBuy, sell: this.lastSell }));
  }

  /** Estatísticas por hora de fechamento do box — a prova visual da curva em U. */
  getHourStats(baseThreshold: number): RegimeHourStats[] {
    const byHour = new Map<number, BoxRecord[]>();
    for (const r of this.records) {
      const list = byHour.get(r.hour);
      if (list) list.push(r);
      else byHour.set(r.hour, [r]);
    }
    const out: RegimeHourStats[] = [];
    for (const [hour, list] of [...byHour.entries()].sort((a, b) => a[0] - b[0])) {
      let posSum = 0;
      let posN = 0;
      let negSum = 0;
      let negN = 0;
      let strongFixed = 0;
      let strongAdaptive = 0;
      for (const r of list) {
        const abs = Math.abs(r.delta);
        if (abs >= baseThreshold) strongFixed++;
        if (abs >= baseThreshold * r.factor) strongAdaptive++;
        if (r.delta > 0) {
          posSum += r.delta;
          posN++;
        } else if (r.delta < 0) {
          negSum += -r.delta;
          negN++;
        }
      }
      out.push({
        hour,
        boxes: list.length,
        meanFactor: list.reduce((a, r) => a + r.factor, 0) / list.length,
        strongFixed,
        strongAdaptive,
        posDeltaMean: posN > 0 ? posSum / posN : 0,
        negDeltaMean: negN > 0 ? negSum / negN : 0,
      });
    }
    return out;
  }

  getBoxCount(): number {
    return this.records.length;
  }
}
