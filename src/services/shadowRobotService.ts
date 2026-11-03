import { AutomationConfig, RenkoBox } from '../types/trading';
import type { ShadowRobotConfig, ShadowScaleR } from '../types/trading';
import { ASSETS, boxPointsForR, DEFAULT_ASSET_ID, type AssetId, type AssetSpec } from '../assets/assetRegistry';
import type { SavedStrategy } from '../types/strategy';
import { evaluateBoxConvergence } from '../utils/convergenceEvaluator';
import type { SessionRegimeMeter } from '../utils/sessionRegime';
import { StrategyLibraryService } from './strategyLibraryService';
import { normalizeShadowRobot } from './eaConfigService';
import {
  PaperStrategyBot,
  PaperTrade,
  PaperStats,
  PaperCounters,
  EquityPoint,
} from '../utils/paperStrategyBot';

/**
 * ROBÔ 2 (SOMBRA) — segundo robô em PAPEL, independente do principal
 * ------------------------------------------------------------------
 * Roda UMA estratégia da biblioteca numa escala Renko própria (15R/20R/25R), com
 * motor, CVD, medidor de regime, livro e curva de capital próprios. Funciona ao vivo,
 * no replay e com o robô principal desligado.
 *
 * BLINDAGEM (por que este robô não pode mexer dinheiro):
 * - O service NÃO recebe socket da ponte MT5, NÃO recebe `setOrders` do App e NÃO tem
 *   callback de dispatch. Não existe caminho daqui para uma ordem real.
 * - `config.active` (liga/desliga o robô principal) e as travas financeiras do App são
 *   ignoradas de propósito: a contabilidade da sombra continua rodando com o principal OFF.
 * - A janela de horário e a zeragem de fim de pregão OBEDECEM à estratégia da sombra,
 *   porque é ela (e não o config ativo) que está sendo testada.
 *
 * Fase 2 do multi-robô REAL (ponte): cada robô despacha com `magicNumber` próprio e a ponte
 * filtra por magic nas saídas — a estrutura já existe (types/trading.ts + script gerado). O
 * Robô 2 continua PAPEL puro de propósito: sem magic, sem socket, sem dispatch.
 *
 * Persistência: localStorage por dia (sobrevive a F5; rotaciona num dia novo), no mesmo
 * padrão do Coletor de Eficiência.
 */

const STORAGE_KEY = 'fluxo_shadow_robot_v1';

export const SHADOW_LABEL = 'Robô 2 (sombra)';

/** Estado da corrida em curso, resolvido a partir de (strategyId, scaleR, ativo). */
export interface ShadowRun {
  enabled: boolean;
  scaleR: ShadowScaleR;
  boxPoints: number;
  assetId: string;
  strategyId: string | null;
  strategyName: string | null;
  /** Motivo de a sombra estar inativa mesmo ligada (UI mostra no chip). */
  warning: string | null;
}

export interface ShadowSnapshot {
  date: string;
  sessionStarted: number;
  updatedAt: number;
  run: ShadowRun;
  stats: PaperStats;
  trades: PaperTrade[];
  equityCurve: EquityPoint[];
}

interface PersistShape {
  date: string;
  sessionStarted: number;
  run: {
    enabled: boolean;
    scaleR: ShadowScaleR;
    assetId: string;
    strategyId: string | null;
    strategyName: string | null;
  };
  book: { trades: PaperTrade[]; equityCurve: EquityPoint[]; equity: number };
  counters?: PaperCounters;
  // true quando algum tick REAL do MT5 alimentou a sombra neste dia — espelha a regra do
  // coletor: com coleta real no storage, o replay automático do boot não pode apagar o dia
  real?: boolean;
}

const todayKey = () => new Date().toISOString().slice(0, 10);

const inactiveRun = (scaleR: ShadowScaleR): ShadowRun => ({
  enabled: false,
  scaleR,
  boxPoints: 0,
  assetId: 'WIN',
  strategyId: null,
  strategyName: null,
  warning: 'Robô 2 desligado.',
});

class ShadowRobotService {
  private bot = new PaperStrategyBot('shadow');
  private run: ShadowRun = inactiveRun(20);
  /** Config efetiva da última barra (snapshot da estratégia + escala derivada). */
  private effectiveConfig: AutomationConfig | null = null;
  private sessionStarted = Date.now();
  private updatedAt = 0;
  private lastLiveTs = 0;
  private version = 0;
  private listeners = new Set<() => void>();
  private loaded = false;
  private batchDepth = 0; // >0 durante replay: inibe persistência/notificação por barra
  private hadRealData = false;
  private regimeMeter: SessionRegimeMeter | null = null;

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
        // Dia novo: sessão nova (o dia anterior fica só no CSV exportado)
        localStorage.removeItem(STORAGE_KEY);
        return;
      }
      this.sessionStarted = data.sessionStarted;
      this.hadRealData = data.real === true;
      const run = data.run || {};
      const cfg = normalizeShadowRobot({ enabled: run.enabled, strategyId: run.strategyId, scaleR: run.scaleR });
      const storedAsset = ASSETS[run.assetId as AssetId] || ASSETS[DEFAULT_ASSET_ID];
      // R$/ponto da contabilidade restaurado no ativo gravado (não soldar no WIN após F5)
      this.bot.setAsset(storedAsset.id);
      this.run = {
        enabled: cfg.enabled,
        scaleR: cfg.scaleR,
        // pts rederivados no boot (o que vale é o R pedido; configure() recalcula com o ativo real)
        boxPoints: boxPointsForR(cfg.scaleR, storedAsset),
        assetId: storedAsset.id,
        strategyId: cfg.strategyId,
        strategyName: typeof run.strategyName === 'string' ? run.strategyName : null,
        warning: cfg.enabled ? null : 'Robô 2 desligado.',
      };
      const book = data.book;
      if (book) this.bot.hydrate(book.trades || [], book.equityCurve || [], book.equity || 0, data.counters);
    } catch {
      /* estado corrompido: recomeça limpo */
    }
  }

  private persist() {
    try {
      const data: PersistShape = {
        date: todayKey(),
        sessionStarted: this.sessionStarted,
        run: {
          enabled: this.run.enabled,
          scaleR: this.run.scaleR,
          assetId: this.run.assetId,
          strategyId: this.run.strategyId,
          strategyName: this.run.strategyName,
        },
        book: {
          trades: this.bot.getTrades(),
          equityCurve: this.bot.getEquityCurve(),
          equity: this.bot.getEquity(),
        },
        counters: this.bot.getCounters(),
        real: this.hadRealData,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {
      /* cota cheia: a contabilidade segue em memória */
    }
  }

  private notify() {
    this.updatedAt = Date.now();
    this.version++;
    this.listeners.forEach((l) => l());
  }

  /**
   * Chamado pelo App em todo tick vindo do MT5: marca que o dia tem dado REAL e
   * mantém a marcação a mercado das posições abertas. Não persiste (seria caro).
   */
  markToMarket(price: number, timestamp: number, isReal = false) {
    if (price <= 0) return;
    this.ensureLoaded();
    if (isReal && !this.hadRealData) {
      this.hadRealData = true;
      this.persist();
    }
    this.bot.markToMarket(price);
    this.lastLiveTs = timestamp;
    this.notify();
  }

  hasRealData(): boolean {
    this.ensureLoaded();
    return this.hadRealData;
  }

  /** Modo lote para REPLAY: evita gravar e notificar a cada barra (milhares em segundos). */
  beginBatch() {
    this.ensureLoaded();
    this.batchDepth++;
  }

  endBatch() {
    if (this.batchDepth > 0) this.batchDepth--;
    if (this.batchDepth === 0) {
      this.persist();
      this.notify();
    }
  }

  // ------------------------------------------------------------------
  // Configuração da corrida
  // ------------------------------------------------------------------
  /**
   * Resolve a corrida a partir da escolha do operador: o config efetivo da sombra é o
   * snapshot `SavedStrategy.config` com `boxPoints` SUBSTITUÍDO pela escala derivada em
   * runtime (`pts = scaleR × tick do ativo`). Nada mais é ritocado — limiares, SL/TP,
   * breakeven, trailing e `strategyMode` vêm da estratégia salva.
   *
   * Retorna o config efetivo quando a sombra está ativa (o App usa para criar/realocar o
   * motor da sombra) ou `null` quando inativa — sem config, não há motor nem alimentação.
   *
   * Trocar estratégia, escala ou ativo REINICIA o livro: a curva de capital e as métricas
   * passam a ser de outra corrida e misturar as duas seria leitura errada.
   */
  configure(
    shadow: ShadowRobotConfig | undefined,
    asset: AssetSpec,
    baseConfig: AutomationConfig
  ): AutomationConfig | null {
    this.ensureLoaded();
    const cfg = normalizeShadowRobot(shadow);
    const boxPoints = boxPointsForR(cfg.scaleR, asset);
    // Contabilidade sempre no R$/ponto DO ativo escolhido (WIN 0,20 · WDO 0,10 · BTC 1,00)
    this.bot.setAsset(asset.id);

    const next: ShadowRun = {
      enabled: cfg.enabled,
      scaleR: cfg.scaleR,
      boxPoints,
      assetId: asset.id,
      strategyId: cfg.strategyId,
      strategyName: null,
      warning: null,
    };

    if (!cfg.enabled) {
      next.warning = 'Robô 2 desligado.';
      this.run = next;
      this.effectiveConfig = null;
      this.persist();
      this.notify();
      return null;
    }

    if (!cfg.strategyId) {
      next.warning = 'Escolha uma estratégia da biblioteca para a sombra.';
      this.run = next;
      this.effectiveConfig = null;
      this.persist();
      this.notify();
      return null;
    }

    const strategy: SavedStrategy | undefined = StrategyLibraryService.list().find((s) => s.id === cfg.strategyId);
    if (!strategy) {
      // Estratégia apagada da biblioteca: `enabled` persiste, o runner fica inativo com aviso.
      next.warning = 'Estratégia não encontrada na biblioteca (foi apagada?). Reescolha.';
      this.run = next;
      this.effectiveConfig = null;
      this.persist();
      this.notify();
      return null;
    }

    next.strategyName = strategy.name;
    const strategyConfig: AutomationConfig = {
      ...baseConfig,
      ...strategy.config,
      // A escala é SEMPRE derivada do pedido em R + tick do ativo atual. Os pts gravados na
      // estratégia (ou no config ativo) não valem para outro mercado.
      boxPoints,
      assetId: asset.id,
      symbol: strategy.config.symbol || baseConfig.symbol,
      // Sem janela própria = herda a do config ativo; com janela própria = só a dela.
      tradingHoursEnabled:
        strategy.config.tradingHoursEnabled === undefined ? baseConfig.tradingHoursEnabled : strategy.config.tradingHoursEnabled,
    };

    const changedRun =
      this.run.strategyId !== cfg.strategyId || this.run.scaleR !== cfg.scaleR || this.run.assetId !== asset.id;
    if (changedRun) {
      // Corrida nova: livro e sessão zerados. `hadRealData` NÃO é tocado aqui — a marca de
      // "dia tem tick real" é do pregão, não desta escolha, e protege o boot-replay.
      this.bot.reset();
      this.sessionStarted = Date.now();
    }

    this.run = next;
    this.effectiveConfig = strategyConfig;
    this.persist();
    this.notify();
    return strategyConfig;
  }

  /** Motor da sombra registrado pelo App (leitura de regime na Avaliação Técnica). */
  registerRegimeMeter(meter: SessionRegimeMeter) {
    this.ensureLoaded();
    this.regimeMeter = meter;
  }

  getRegimeMeter(): SessionRegimeMeter | null {
    return this.regimeMeter;
  }

  getEffectiveConfig(): AutomationConfig | null {
    this.ensureLoaded();
    return this.effectiveConfig;
  }

  // ------------------------------------------------------------------
  // Ingestão: chamada pelo App em TODA barra fechada do motor da sombra
  // ------------------------------------------------------------------
  processClosedBox(
    closedBox: RenkoBox,
    previousBoxes: RenkoBox[],
    config: AutomationConfig,
    meter?: SessionRegimeMeter
  ) {
    this.ensureLoaded();
    // Primeiro box da corrida nova: limpa o aviso “Livro zerado — aguardando ticks.”
    if (this.run.warning === 'Livro zerado — aguardando ticks.') {
      this.run.warning = null;
    }
    const pts = Math.max(1, Math.round(Math.abs(closedBox.close - closedBox.open)));
    const conv = evaluateBoxConvergence(
      closedBox,
      config,
      previousBoxes,
      {
        priceLabel: `${SHADOW_LABEL} ${this.run.scaleR}R`,
        gainLabelUp: `+${pts} pts`,
        gainLabelDown: `-${pts} pts`,
      },
      meter
    );
    this.effectiveConfig = config;
    this.bot.onClosedBox(closedBox, conv.signal, config);
    this.notify();
    if (this.batchDepth === 0) this.persist();
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

  getSnapshot(): ShadowSnapshot {
    this.ensureLoaded();
    return {
      date: todayKey(),
      sessionStarted: this.sessionStarted,
      updatedAt: this.updatedAt,
      run: { ...this.run },
      stats: this.bot.getStats(),
      trades: this.bot.getTrades(),
      equityCurve: this.bot.getEquityCurveWithLive(this.lastLiveTs || Date.now()),
    };
  }

  /**
   * Zera o livro da sombra SEM tocar na escolha de corrida (estratégia/escala/ativo).
   * É o que o replay usa: cada corrida começa do zero, mas o `enabled` continua sendo o
   * `config.shadowRobot` persistido pelo operador (senão um replay desligaria o Robô 2).
   */
  resetBook() {
    this.ensureLoaded();
    this.bot.reset();
    this.hadRealData = false;
    this.sessionStarted = Date.now();
    // Warning visível: o operador vê que o livro foi zerado (e não que “está herdando” da corrida
    // anterior). O primeiro box processado limpa a mensagem.
    if (this.run.enabled) this.run.warning = 'Livro zerado — aguardando ticks.';
    this.persist();
    this.notify();
  }

  /** Zera o livro e a escolha de corrida (o operador pediu explicitamente para zerar). */
  reset() {
    this.ensureLoaded();
    this.run = inactiveRun(this.run.scaleR);
    this.effectiveConfig = null;
    this.resetBook();
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* noop */
    }
    this.persist();
    this.notify();
  }

  // ------------------------------------------------------------------
  // Exportação CSV (padrão B3: UTF-8 BOM + separador ';') — mesmo formato do coletor
  // ------------------------------------------------------------------
  exportCsv() {
    const snap = this.getSnapshot();
    const rows: string[] = [];
    rows.push(`${SHADOW_LABEL} — ${snap.run.strategyName || 'sem estratégia'} · ${snap.run.scaleR}R (${snap.run.boxPoints} pts) · ${snap.run.assetId}`);
    rows.push(`Dia;${snap.date};Início da sessão;${new Date(snap.sessionStarted).toLocaleString('pt-BR')}`);
    rows.push('');
    rows.push(
      'MODO;DIREÇÃO;PAPEL;CTROS;ENTRADA HORA;ENTRADA PREÇO;SAÍDA HORA;SAÍDA PREÇO;MOTIVO SAÍDA;PONTOS;R$;FATOR REGIME'
    );
    for (const t of snap.trades) {
      rows.push(
        [
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
          (t.regimeFactor ?? 1).toFixed(2).replace('.', ','),
        ].join(';')
      );
    }
    rows.push('');
    rows.push(
      'RESUMO;TRADES LIQUIDADOS;GANHOS;PERDAS;WIN RATE %;PONTOS;R$ LÍQUIDO;FATOR DE LUCRO;MAX DRAWDOWN R$;EXPECTATIVA R$/TRADE'
    );
    const s = snap.stats;
    rows.push(
      [
        SHADOW_LABEL,
        s.trades,
        s.wins,
        s.losses,
        s.winRate.toFixed(1).replace('.', ','),
        s.totalPoints.toFixed(0),
        s.totalFinancial.toFixed(2).replace('.', ','),
        Number.isFinite(s.profitFactor) ? s.profitFactor.toFixed(2).replace('.', ',') : '∞',
        s.maxDrawdown.toFixed(2).replace('.', ','),
        s.expectancy.toFixed(2).replace('.', ','),
      ].join(';')
    );
    const csv = '\uFEFF' + rows.join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `robo2_sombra_${snap.date}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }
}

export const shadowRobotService = new ShadowRobotService();
export type { ShadowRobotConfig };
