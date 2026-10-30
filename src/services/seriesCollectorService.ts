import { RenkoBox, AutomationConfig } from '../types/trading';
import { evaluateBoxConvergence } from '../utils/convergenceEvaluator';
import {
  PaperStrategyBot,
  PaperTrade,
  PaperStats,
  PaperCounters,
  EquityPoint,
  SeriesKey,
} from '../utils/paperStrategyBot';

/**
 * Coletor de Dados Internos — Eficiência Pontos x Range x Tempo
 * ------------------------------------------------------------------
 * Mantém 3 robôs sombra (paper) rodando a MESMA config do EA sobre as
 * três séries simultaneamente, não importa qual está ativa no gráfico.
 * As ordens reais continuam sendo decisão do App (série ativa); aqui é
 * apenas contabilidade paralela para medir eficiência comparada.
 *
 * Persistência: localStorage por sessão de dia (sobrevive a F5; zera num
 * novo dia automaticamente). Exportação CSV no padrão B3 (BOM + ';').
 */

const STORAGE_KEY = 'fluxo_series_collector_v1';

export const SERIES_LABEL: Record<SeriesKey, string> = {
  renko: 'Pontos (Renko)',
  range: 'Range',
  tempo: 'Tempo',
  renko15r: 'Renko 15R',
  renko20r: 'Renko 20R',
  renko25r: 'Renko 25R',
};

export interface SeriesSnapshot {
  stats: PaperStats;
  trades: PaperTrade[];
  equityCurve: EquityPoint[];
}

export interface CollectorSnapshot {
  date: string;
  sessionStarted: number;
  updatedAt: number;
  series: Record<SeriesKey, SeriesSnapshot>;
}

interface PersistShape {
  date: string;
  sessionStarted: number;
  series: Record<
    SeriesKey,
    { trades: PaperTrade[]; equityCurve: EquityPoint[]; equity: number }
  >;
  // Acumulados contínuos: garantem que um F5 não encolhe win rate/PF/expectativa
  // (a lista de trades é limitada a 1200 por série, os contadores não)
  counters?: Record<SeriesKey, PaperCounters>;
  // true quando algum tick REAL do MT5 alimentou o coletor neste dia — é o que impede o
  // replay automático de abertura (boot) de apagar um pregão verdadeiro já coletado
  real?: boolean;
}

const todayKey = () => new Date().toISOString().slice(0, 10);

class SeriesCollectorService {
  private bots: Record<SeriesKey, PaperStrategyBot> = {
    renko: new PaperStrategyBot('renko'),
    range: new PaperStrategyBot('range'),
    tempo: new PaperStrategyBot('tempo'),
    renko15r: new PaperStrategyBot('renko15r'),
    renko20r: new PaperStrategyBot('renko20r'),
    renko25r: new PaperStrategyBot('renko25r'),
  };
  private sessionStarted = Date.now();
  private updatedAt = 0;
  private lastLiveTs = 0; // último tick visto (marcação a mercado das posições abertas)
  private version = 0;
  private listeners = new Set<() => void>();
  private loaded = false;
  private batchDepth = 0; // >0 durante replay: inibe persistência/notificação por barra
  private hadRealData = false; // coletor já recebeu tick do MT5 hoje?

  // ------------------------------------------------------------------
  // Ciclo de vida / persistência
  // ------------------------------------------------------------------
  private ensureLoaded() {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const data: PersistShape = JSON.parse(raw);
      if (data.date !== todayKey()) {
        // Dia novo: sessão nova (dados de ontem ficam só no CSV exportado)
        localStorage.removeItem(STORAGE_KEY);
        return;
      }
      this.sessionStarted = data.sessionStarted;
      this.hadRealData = data.real === true;
      (Object.keys(this.bots) as SeriesKey[]).forEach((k) => {
        const snap = data.series?.[k];
        if (snap) this.bots[k].hydrate(snap.trades || [], snap.equityCurve || [], snap.equity || 0, data.counters?.[k]);
      });
    } catch {
      /* estado corrompido: recomeça limpo */
    }
  }

  private persist() {
    try {
      const data: PersistShape = {
        date: todayKey(),
        sessionStarted: this.sessionStarted,
        series: (Object.keys(this.bots) as SeriesKey[]).reduce(
          (acc, k) => {
            acc[k] = {
              trades: this.bots[k].getTrades(),
              equityCurve: this.bots[k].getEquityCurve(),
              equity: this.bots[k].getEquity(),
            };
            return acc;
          },
          {} as PersistShape['series']
        ),
        counters: (Object.keys(this.bots) as SeriesKey[]).reduce(
          (acc, k) => {
            acc[k] = this.bots[k].getCounters();
            return acc;
          },
          {} as Record<SeriesKey, PaperCounters>
        ),
        real: this.hadRealData,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {
      /* cota cheia: a contabilidade segue em memória */
    }
  }

  /**
   * Chamado pelo App a CADA tick: marca as posições abertas dos 6 robôs sombra
   * a mercado, para os cards e curvas da tela Comparativo se moverem em tempo real.
   * Não persiste (seria caro) nem cria trades — só atualiza a leitura ao vivo.
   */
  markToMarket(price: number, timestamp: number) {
    if (price <= 0) return;
    this.ensureLoaded();
    (Object.keys(this.bots) as SeriesKey[]).forEach((k) => this.bots[k].markToMarket(price));
    this.lastLiveTs = timestamp;
    this.updatedAt = Date.now();
    this.version++;
    this.listeners.forEach((l) => l());
  }

  /**
   * Chamado pelo App em todo tick vindo do MT5: marca que o dia em curso tem dado REAL.
   * Só grava no localStorage na primeira vez (o boot-replay usa essa marca para não apagar
   * a coleta verdadeira).
   */
  markRealData() {
    this.ensureLoaded();
    if (this.hadRealData) return;
    this.hadRealData = true;
    this.persist();
  }

  hasRealData(): boolean {
    this.ensureLoaded();
    return this.hadRealData;
  }

  /**
   * Modo lote para REPLAY de histórico: evita gravar no localStorage e
   * notificar a UI a cada barra (seriam milhares de gravações em segundos).
   */
  beginBatch() {
    this.ensureLoaded();
    this.batchDepth++;
  }

  endBatch() {
    if (this.batchDepth > 0) this.batchDepth--;
    if (this.batchDepth === 0) {
      this.updatedAt = Date.now();
      this.version++;
      this.persist();
      this.listeners.forEach((l) => l());
    }
  }

  // ------------------------------------------------------------------
  // Ingestão: chamada pelo App em TODA barra fechada de cada série
  // ------------------------------------------------------------------
  ingest(
    series: SeriesKey,
    closedBox: RenkoBox,
    previousBoxes: RenkoBox[],
    config: AutomationConfig,
    scaleLabel: string
  ) {
    this.ensureLoaded();
    const conv = evaluateBoxConvergence(
      closedBox,
      config,
      previousBoxes,
      {
        priceLabel: `${SERIES_LABEL[series]} ${scaleLabel}`,
        gainLabelUp: `+${Math.round(Math.abs(closedBox.close - closedBox.open))} pts`,
        gainLabelDown: `-${Math.round(Math.abs(closedBox.close - closedBox.open))} pts`,
      }
    );
    this.bots[series].onClosedBox(closedBox, conv.signal, config);
    this.updatedAt = Date.now();
    this.version++;
    if (this.batchDepth === 0) {
      this.persist();
      this.listeners.forEach((l) => l());
    }
  }

  // ------------------------------------------------------------------
  // Leitura para a UI (useSyncExternalStore)
  // ------------------------------------------------------------------
  subscribe = (listener: () => void) => {
    this.ensureLoaded();
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getVersion = () => {
    this.ensureLoaded();
    return this.version;
  };

  getSnapshot(): CollectorSnapshot {
    this.ensureLoaded();
    const series = (Object.keys(this.bots) as SeriesKey[]).reduce(
      (acc, k) => {
        acc[k] = {
          stats: this.bots[k].getStats(),
          trades: this.bots[k].getTrades(),
          equityCurve: this.bots[k].getEquityCurveWithLive(this.lastLiveTs || Date.now()),
        };
        return acc;
      },
      {} as Record<SeriesKey, SeriesSnapshot>
    );
    return {
      date: todayKey(),
      sessionStarted: this.sessionStarted,
      updatedAt: this.updatedAt,
      series,
    };
  }

  // ------------------------------------------------------------------
  // Exportação CSV (padrão B3: UTF-8 BOM + separador ';')
  // ------------------------------------------------------------------
  exportCsv() {
    const snap = this.getSnapshot();
    const rows: string[] = [];
    rows.push('Coletor de Eficiência — Pontos x Range x Tempo');
    rows.push(`Dia;${snap.date};Início da sessão;${new Date(snap.sessionStarted).toLocaleString('pt-BR')}`);
    rows.push('');
    rows.push(
      'SÉRIE;MODO;DIREÇÃO;PAPEL;CTROS;ENTRADA HORA;ENTRADA PREÇO;SAÍDA HORA;SAÍDA PREÇO;MOTIVO SAÍDA;PONTOS;R$'
    );
    (Object.keys(snap.series) as SeriesKey[]).forEach((k) => {
      for (const t of snap.series[k].trades) {
        rows.push(
          [
            SERIES_LABEL[k],
            t.mode,
            t.direction,
            t.role,
            t.contracts,
            new Date(t.entryTime).toLocaleTimeString('pt-BR'),
            t.entryPrice.toFixed(0),
            t.exitTime ? new Date(t.exitTime).toLocaleTimeString('pt-BR') : '',
            t.exitPrice !== undefined ? t.exitPrice.toFixed(0) : '',
            t.exitReason ?? '',
            (t.points ?? 0).toFixed(1).replace('.', ','),
            (t.financial ?? 0).toFixed(2).replace('.', ','),
          ].join(';')
        );
      }
    });
    rows.push('');
    rows.push(
      'RESUMO;TRADES LIQUIDADOS;GANHOS;PERDAS;WIN RATE %;PONTOS;R$ LÍQUIDO;FATOR DE LUCRO;MAX DRAWDOWN R$;GANHO BRUTO R$;PERDA BRUTA R$;MÉDIA GANHADOR R$;MÉDIA PERDEDOR R$;EXPECTATIVA R$/TRADE;MAIOR GANHO R$;MAIOR PERDA R$'
    );
    (Object.keys(snap.series) as SeriesKey[]).forEach((k) => {
      const s = snap.series[k].stats;
      rows.push(
        [
          SERIES_LABEL[k],
          s.trades,
          s.wins,
          s.losses,
          s.winRate.toFixed(1).replace('.', ','),
          s.totalPoints.toFixed(0),
          s.totalFinancial.toFixed(2).replace('.', ','),
          Number.isFinite(s.profitFactor) ? s.profitFactor.toFixed(2).replace('.', ',') : '∞',
          s.maxDrawdown.toFixed(2).replace('.', ','),
          s.grossProfit.toFixed(2).replace('.', ','),
          s.grossLossVal.toFixed(2).replace('.', ','),
          s.avgWin.toFixed(2).replace('.', ','),
          s.avgLoss.toFixed(2).replace('.', ','),
          s.expectancy.toFixed(2).replace('.', ','),
          s.largestWin.toFixed(2).replace('.', ','),
          s.largestLoss.toFixed(2).replace('.', ','),
        ].join(';')
      );
    });
    const csv = '\uFEFF' + rows.join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `coletor_eficiencia_${snap.date}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  reset() {
    (Object.keys(this.bots) as SeriesKey[]).forEach((k) => this.bots[k].reset());
    this.sessionStarted = Date.now();
    this.hadRealData = false; // replay sintético do zero: deixa de ser dado real
    this.updatedAt = Date.now();
    this.version++;
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* noop */
    }
    this.listeners.forEach((l) => l());
  }
}

export const seriesCollectorService = new SeriesCollectorService();
