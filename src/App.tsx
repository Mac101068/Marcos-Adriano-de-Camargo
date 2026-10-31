import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Tick, RenkoBox, TradeOrder, AutomationConfig, TerminalStats, MT5ConnectionState } from './types/trading';
import { RenkoFlowEngine } from './utils/renkoCalculator';
import { RangeBarEngine, TimeBarEngine, ChartSeries } from './utils/barEngines';
import { evaluateBoxConvergence, ConvergenceResult } from './utils/convergenceEvaluator';
import { isWithinTradingWindow, sessionFinancialLock, FinancialLock } from './utils/tradingGates';
import { isSessionCloseLock, sessionCloseLockLabel, parseHHMM } from './utils/sessionRules';
import { migrateLegacyTradingWindow } from './utils/tradingWindowMigration';
import {
  ASSETS,
  resolveAsset,
  pointsToBRL,
  formatPrice,
  renkoScaleLabel,
  isStaleOrderPrice,
  referencePrice,
  rememberLastPrice,
  type AssetId,
  type AssetSpec,
} from './assets/assetRegistry';
import { migrateAssetBaseline, AssetBaselineMigration } from './assets/assetMigration';
import { migrateAssetSelection, AssetSelectionMigration } from './assets/assetSelectionMigration';
import {
  MarketHistoryService,
  marketHistoryService,
  type VolumeSource,
} from './services/marketHistoryService';
import { computeSessionLevels, computeRunningVwap, PriceLevel, VwapCurve } from './utils/priceLevels';
import { getBridgeToken } from './utils/bridgeSecurity';
import { seriesCollectorService } from './services/seriesCollectorService';
import type { SessionRegimeMeter } from './utils/sessionRegime';
import { SimulatorView } from './components/SimulatorView';
import { B3MarketSimulator, generateHistoricalTicks, randomReplaySeed } from './utils/marketSimulator';
import { Header } from './components/Header';
import { RenkoFlowChart } from './components/RenkoFlowChart';
import { TimesAndTrades } from './components/TimesAndTrades';
import { AutomationPanel } from './components/AutomationPanel';
import { OrdersAndStats } from './components/OrdersAndStats';
import { PythonScriptView } from './components/PythonScriptView';
import { DocumentationView } from './components/DocumentationView';
import { SubscriptionPaywall } from './components/SubscriptionPaywall';
import { AdminPanel } from './components/AdminPanel';
import { EquityCurveView } from './components/EquityCurveView';
import { UserProfile } from './types/auth';
import { AuthService } from './services/authService';
import { EaConfigService } from './services/eaConfigService';
import { OrderAuditService } from './services/orderAuditService';
import { IntradayOrderAudit } from './components/IntradayOrderAudit';
import { ProjectDossierPdfModal } from './components/ProjectDossierPdfModal';
import { SeriesComparisonView } from './components/SeriesComparisonView';
import { TechnicalEvaluationView } from './components/TechnicalEvaluationView';
import { StrategyStudio } from './components/StrategyStudio';
import { StrategyLibraryService } from './services/strategyLibraryService';
import { SavedStrategy } from './types/strategy';
import { ArrowUpRight, ArrowDownRight, Wifi, AlertTriangle, TrendingUp, Activity, Layers, Sliders, ShieldCheck, Terminal, LineChart, Cpu, BarChart3, AppWindow, MoreHorizontal, FileText, Box, Play, Square, Clock, Sparkles, RefreshCw } from 'lucide-react';

type ActiveTickResult = {
  newBoxClosed: boolean;
  closedBox?: RenkoBox;
  signal?: 'BUY' | 'SELL';
  signalReason?: string;
};

/** Anota uma barra fechada (Range/Tempo) com a convergência da MESMA estratégia do Renko. */
function annotateActiveBar(
  box: RenkoBox,
  previousBoxes: RenkoBox[],
  config: AutomationConfig,
  priceLabel: string,
  meter?: SessionRegimeMeter
): ConvergenceResult {
  const pts = Math.max(1, Math.round(Math.abs(box.close - box.open)));
  const conv = evaluateBoxConvergence(box, config, previousBoxes, {
    priceLabel,
    gainLabelUp: `+${pts} pts`,
    gainLabelDown: `-${pts} pts`,
  }, meter);
  box.isConvergence = conv.isConvergence;
  box.convergenceType = conv.type;
  return conv;
}

// Escalas Renko paralelas (1R = 5 pts no Mini-Índice): medidas APENAS pelo coletor
// de eficiência. Elas nunca disparam ordens reais — quem opera é a série ativa.
const ALT_RENKO_SCALES: { key: 'renko15r' | 'renko20r' | 'renko25r'; pts: number; label: string }[] = [
  { key: 'renko15r', pts: 75, label: '15R (75 pts)' },
  { key: 'renko20r', pts: 100, label: '20R (100 pts)' },
  { key: 'renko25r', pts: 125, label: '25R (125 pts)' },
];

/**
 * Resumo de uma corrida de replay, congelado NA LINHA DE CHEGADA. Existe porque o feed ao
 * vivo continua somando ticks depois que a reprodução termina — sem isto, comparar o PnL do
 * canto da tela entre 1x e 10x compararia mercados de tamanhos diferentes.
 */
type ReplayRunSummary = {
  pnl: number;
  trades: number;
  openCount: number;
  days: number;
  speed: number;
  seed: number;
  operated: boolean;
  aborted: boolean;
  /** De onde vieram os ticks desta corrida: MT5 real ou o gerador sintético (Fase 2). */
  source: 'REAL' | 'SYNTHETIC';
  /** Volume usado nos ticks reais ('TICK' do feed, 'M1_RATE' sintetizado) — undefined no sintético. */
  volumeSource?: VolumeSource;
  tickCount: number;
};

export default function App() {
  const [activeTab, setActiveTab] = useState<'chart' | 'tape' | 'equity' | 'simulador' | 'comparativo' | 'avaliacao' | 'stats' | 'audit' | 'python' | 'docs' | 'settings' | 'studio' | 'admin'>('chart');
  const [currentUser, setCurrentUser] = useState<UserProfile>(() => AuthService.getCurrentUser());
  // Resultado da migração da trava de horário. É ref porque o useState do `config` logo abaixo
  // roda antes de qualquer efeito; o aviso ao operador sai no efeito de montagem.
  const windowMigrationRef = useRef<{ config: boolean; strategies: number } | null>(null);
  // Idem para a migração do preço de referência do ativo (128.500 → ajuste atual do contrato).
  const assetMigrationRef = useRef<AssetBaselineMigration | null>(null);
  // E idem para a migração da SELEÇÃO de ativo (Fase 2): `assetId` no config, nas estratégias
  // salvas e o livro de auditoria, que deixa de ser uma chave única.
  const assetSelectionRef = useRef<AssetSelectionMigration | null>(null);
  // Última vez que o preço real do MT5 foi gravado como régua do ativo (amortecido: 30s).
  const lastPriceWriteRef = useRef<number>(0);
  const [showRenewModal, setShowRenewModal] = useState<boolean>(false);
  const [showPdfModal, setShowPdfModal] = useState<boolean>(false);
  const [config, setConfig] = useState<AutomationConfig>(() => {
    // A trava de horário de trabalho (liberado das 08:55, zeragem compulsória às 17:30) é o
    // padrão novo. Config e estratégias salvas com janela antiga INTACTA são convertidas aqui,
    // uma única vez, antes de a primeira leitura do storage.
    windowMigrationRef.current = migrateLegacyTradingWindow();
    // A seleção de ativo precisa estar gravada ANTES do loadSavedConfig lá embaixo: o storage
    // vence o default, então um config antigo sem `assetId` só resolve certo depois da migração.
    assetSelectionRef.current = migrateAssetSelection();
    return EaConfigService.loadSavedConfig();
  });
  /**
   * Números do ativo em operação (R$/ponto, tick, casas decimais, preço de referência, horário
   * de pregão). Desde a Fase 2 a origem é `config.assetId` (o seletor do Header); o símbolo é o
   * plano B para config e estratégia salvos antes disso. É a ÚNICA fonte desses números: nada mais
   * no app escreve `* 0.2` ou `128500`.
   */
  const asset = React.useMemo(() => resolveAsset(config.symbol, config.assetId), [config.symbol, config.assetId]);
  const [isSimulating, setIsSimulating] = useState<boolean>(true);
  const [simulationSpeed, setSimulationSpeed] = useState<number>(() => {
    const saved = Number(localStorage.getItem('fluxo_sim_speed_v1'));
    return saved >= 1 ? Math.min(10, Math.round(saved)) : 1;
  });
  // Replay de histórico: quantos dias a setinha amarela da tira de status vai rodar.
  // MÍNIMO ABSOLUTO DE 1 DIA — abrir a plataforma já dispara isso sozinho (ver efeito
  // do bootReplay), então o gráfico nasce com uma sessão inteira em vez de minuto a minuto.
  const [replayDays, setReplayDays] = useState<number>(() => {
    const saved = Number(localStorage.getItem('fluxo_replay_days_v1'));
    return saved >= 1 ? Math.min(10, Math.round(saved)) : 1;
  });
  const [isReplaying, setIsReplaying] = useState<boolean>(false);
  // "Replay opera": durante a reprodução cada tick passa pelo MESMO caminho do feed ao vivo
  // (estratégia → MAE/pirâmides → auditoria → PnL na tela). Ligado por padrão; nunca é usado
  // com o MT5 conectado, porque aí as ordens seriam reais.
  const [replayOperates, setReplayOperates] = useState<boolean>(() => {
    try {
      return localStorage.getItem('fluxo_replay_operate_v1') !== '0';
    } catch {
      return true;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem('fluxo_replay_operate_v1', replayOperates ? '1' : '0');
    } catch {
      // Ignora erro de storage
    }
  }, [replayOperates]);
  useEffect(() => {
    try {
      localStorage.setItem('fluxo_replay_days_v1', String(replayDays));
    } catch {
      // Ignora erro de storage
    }
  }, [replayDays]);
  // Seed do pregão sintético. null = AUTO (um mercado novo a cada corrida — o número sorteado
  // aparece no chip de resultado, para você fixar depois). Com um seed fixo, o MESMO pregão é
  // reproduzido todas as vezes: é assim que se testa velocidade sem testar mercados diferentes.
  const [replaySeed, setReplaySeed] = useState<number | null>(() => {
    const raw = localStorage.getItem('fluxo_replay_seed_v1');
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  });
  useEffect(() => {
    try {
      if (replaySeed === null) localStorage.removeItem('fluxo_replay_seed_v1');
      else localStorage.setItem('fluxo_replay_seed_v1', String(replaySeed));
    } catch {
      // Ignora erro de storage
    }
  }, [replaySeed]);
  // A mesma velocidade vale para o replay E para o feed ao vivo — e sobrevive ao F5
  useEffect(() => {
    try {
      localStorage.setItem('fluxo_sim_speed_v1', String(simulationSpeed));
    } catch {
      // Ignora erro de storage
    }
  }, [simulationSpeed]);

  const [ticks, setTicks] = useState<Tick[]>([]);
  const [boxes, setBoxes] = useState<RenkoBox[]>([]);
  const [currentBox, setCurrentBox] = useState<Partial<RenkoBox> | null>(null);
  // Estado inicial na RÉGUA DO ATIVO: o último preço real visto (< 7 dias) ou o basePrice do
  // registro. Ligar sempre no basePrice faria o eixo Y "pular" a cada F5 depois de um pregão real.
  const [currentPrice, setCurrentPrice] = useState<number>(() => referencePrice(asset));
  const [cvd, setCvd] = useState<number>(0);

  // =========================================================================
  // SÉRIES: Pontos (Renko) x Range — escolha na barra do gráfico. Tempo saiu do
  // gráfico (coisa do passado); o motor de tempo continua rodando escondido só
  // para alimentar o Coletor de Eficiência com o que já foi registrado.
  // =========================================================================
  const [chartSeries, setChartSeries] = useState<ChartSeries>(() => {
    try {
      const saved = localStorage.getItem('fluxo_chart_series_v1');
      if (saved === 'renko' || saved === 'range') return saved;
    } catch (e) {
      // Ignora
    }
    return 'renko';
  });
  const [rangePoints, setRangePoints] = useState<number>(() => Number(localStorage.getItem('fluxo_chart_range_pts_v1')) || 50);
  const [timeframeSec, setTimeframeSec] = useState<number>(() => Number(localStorage.getItem('fluxo_chart_time_sec_v1')) || 30);
  const [rangeBoxes, setRangeBoxes] = useState<RenkoBox[]>([]);
  const [rangeCurrentBox, setRangeCurrentBox] = useState<Partial<RenkoBox> | null>(null);
  const [timeBoxes, setTimeBoxes] = useState<RenkoBox[]>([]);
  const [timeCurrentBox, setTimeCurrentBox] = useState<Partial<RenkoBox> | null>(null);
  const rangeEngineRef = useRef<RangeBarEngine>(new RangeBarEngine(50));
  const timeEngineRef = useRef<TimeBarEngine>(new TimeBarEngine(30000));
  const allTicksRef = useRef<Tick[]>([]);

  // Janela flutuante "Dados" (controles do painel Renko) — visível por padrão, persistida
  const [dadosPanelOpen, setDadosPanelOpen] = useState<boolean>(() => {
    try {
      return localStorage.getItem('fluxo_dados_window_v1') !== '0';
    } catch {
      return true;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem('fluxo_dados_window_v1', dadosPanelOpen ? '1' : '0');
    } catch {
      // Ignora erro de storage
    }
  }, [dadosPanelOpen]);
  const handleToggleDadosPanel = () => {
    setDadosPanelOpen((v) => {
      // Ao reabrir pelo menu, leva o operador para a aba do gráfico onde a janela vive
      if (!v) setActiveTab('chart');
      return !v;
    });
  };
  // Janela flutuante "Box Renko" (card do box ativo) — visível por padrão, persistida
  const [boxWindowOpen, setBoxWindowOpen] = useState<boolean>(() => {
    try {
      return localStorage.getItem('fluxo_renko_box_window_v1') !== '0';
    } catch {
      return true;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem('fluxo_renko_box_window_v1', boxWindowOpen ? '1' : '0');
    } catch {
      // Ignora erro de storage
    }
  }, [boxWindowOpen]);
  const handleToggleBoxWindow = () => {
    setBoxWindowOpen((v) => {
      // Ao reabrir pelo menu, leva o operador para a aba do gráfico onde a janela vive
      if (!v) setActiveTab('chart');
      return !v;
    });
  };
  // Menu "Mais" da barra inferior móvel — agrupa as abas secundárias sem rolagem lateral
  const [moreNavOpen, setMoreNavOpen] = useState<boolean>(false);
  const mobileMoreTabsActive = ['simulador', 'comparativo', 'avaliacao', 'audit', 'settings', 'studio', 'docs', 'admin', 'python'].includes(activeTab);
  // Biblioteca de estratégias (Estúdio). A caixinha da tira de status lê esta lista;
  // ativar uma estratégia aplica o snapshot e força o Robô PAUSADO por segurança.
  const [strategyLibrary, setStrategyLibrary] = useState<SavedStrategy[]>(() => StrategyLibraryService.list());
  const refreshStrategyLibrary = () => setStrategyLibrary(StrategyLibraryService.list());
  const handleActivateStrategy = (strategy: SavedStrategy) => {
    const updated: AutomationConfig = {
      ...strategy.config,
      profileName: strategy.name,
      active: false,
      lastSavedTimestamp: Date.now(),
    };
    EaConfigService.saveConfig(updated);
    setConfig(updated);
    setLatestToast({
      id: `toast-${Date.now()}`,
      type: 'INFO',
      title: `Estratégia "${strategy.name}" ativada`,
      description: 'Robô mantido PAUSADO por segurança — ligue no On quando quiser operar.',
      timestamp: Date.now(),
    });
  };
  // Anuncia a trava financeira UMA vez por pregão (o chip da tira de status continua
  // no ar enquanto ela estiver batida, então o operador sempre vê o motivo).
  const financialLockAnnouncedRef = useRef<string | null>(null);
  const announceFinancialLock = (lock: FinancialLock) => {
    if (financialLockAnnouncedRef.current === lock.short) return;
    financialLockAnnouncedRef.current = lock.short;
    setLatestToast({
      id: `finlock-${Date.now()}`,
      type: 'INFO',
      title: `🔒 TRAVA FINANCEIRA: ${lock.short}`,
      description: lock.reason,
      timestamp: Date.now(),
    });
  };

  /**
   * Liquidação da trava financeira (closeAllOnFinancialLock): zera a mercado o que está
   * aberto e cancela as limitadas pendentes, com rastro de auditoria em cada ordem.
   */
  const liquidateForFinancialLock = (list: TradeOrder[], price: number, lock: FinancialLock): TradeOrder[] =>
    list.map((o) => {
      if (o.status !== 'OPEN' && o.status !== 'PENDING_LIMIT') return o;
      const isPending = o.status === 'PENDING_LIMIT';
      const activeCtros = o.remainingContracts || o.contracts;
      const pts = isPending ? 0 : o.type === 'BUY' ? price - o.entryPrice : o.entryPrice - price;
      const fin = pointsToBRL(pts, activeCtros, asset) + (o.partialFinancial || 0);
      const evt = OrderAuditService.createEvent(
        isPending ? 'ORDER_EXPIRED' : 'MANUAL_CLOSED',
        isPending ? 'Limitada cancelada pela trava financeira' : `Liquidação pela trava financeira (${pts >= 0 ? '+' : ''}${pts} pts)`,
        `${lock.reason} ${
          isPending
            ? `Entrada limitada em ${o.limitPrice} pts foi cancelada sem executar.`
            : `Posição ${o.role === 'MAIN' ? 'principal (surfe)' : `pirâmide #${o.pyramidLevel || 1}`} liquidada a mercado a ${price} pts. Resultado: R$ ${fin.toFixed(2)}.`
        }`,
        price,
        activeCtros
      );
      const closed = {
        exitPrice: price,
        exitTimestamp: Date.now(),
        exitTimeStr: new Date().toTimeString().split(' ')[0],
        exitReason: 'FINANCIAL_LOCK' as const,
        pointsResult: pts,
        financialResult: fin,
        auditTrail: o.auditTrail ? [...o.auditTrail, evt] : [evt],
      };
      return isPending
        ? { ...o, status: 'EXPIRED_PULLBACK' as const, ...closed }
        : { ...o, status: fin >= 0 ? ('CLOSED_PROFIT' as const) : ('CLOSED_LOSS' as const), ...closed };
    });

  // Motores Renko extras (15R/20R/25R) rodando em paralelo só para o coletor
  const altEnginesRef = useRef<Record<'renko15r' | 'renko20r' | 'renko25r', RenkoFlowEngine>>({
    renko15r: new RenkoFlowEngine(75, asset),
    renko20r: new RenkoFlowEngine(100, asset),
    renko25r: new RenkoFlowEngine(125, asset),
  });

  const [orders, setOrders] = useState<TradeOrder[]>(() => {
    // Troca do preço de referência do ativo: o pregão salvo no preço antigo é saneado UMA vez,
    // antes de qualquer leitura. O aviso ao operador sai no efeito de montagem.
    assetMigrationRef.current = migrateAssetBaseline(asset);
    const saved = OrderAuditService.loadIntradayOrders(asset);
    // Se já existem ordens salvas e alguma delas é da estratégia de pirâmide, preserva
    if (saved && saved.length > 0 && saved.some((o) => o.role === 'PYRAMID' || o.role === 'MAIN')) {
      // Descarta se houver ordens abertas presas em preços de outro nível de mercado
      const hasStale = saved.some((o) => o.status === 'OPEN' && isStaleOrderPrice(o.entryPrice, asset));
      if (!hasStale) {
        return saved;
      }
    }

    // Ordens de demonstração nascem em ÂNCORAS do preço de referência do ativo — nada de
    // 128.450/128.500 soldados no código: no WIN de hoje elas saem de 171.500.
    const base = referencePrice(asset);
    const at = (offset: number) => base + offset;
    const priceLabel = (offset: number) => formatPrice(base + offset, asset);

    const defaultPyramidOrders: TradeOrder[] = [
      {
        id: 'ord-mother-main-buy',
        ticket: 849501,
        role: 'MAIN',
        timestamp: Date.now() - 3600000 * 0.25,
        timeStr: new Date(Date.now() - 3600000 * 0.25).toTimeString().split(' ')[0],
        type: 'BUY',
        entryPrice: at(-50),
        contracts: 1,
        remainingContracts: 1,
        stopLoss: 0,
        takeProfit: 0,
        status: 'OPEN',
        source: 'ROBOT_EA',
        magicNumber: 101010,
        triggerReason: 'Virada de Fluxo Heikin-Ashi (Verde) · Ordem Mãe de Surfe',
        auditTrail: [
          {
            id: 'evt-mother-1',
            timestamp: Date.now() - 3600000 * 0.25,
            timeStr: new Date(Date.now() - 3600000 * 0.25).toTimeString().split(' ')[0],
            action: 'ORDER_DISPATCHED',
            title: 'Ordem Mãe de Surfe Executada',
            details: `Entrada na virada de fluxo a ${priceLabel(-50)} pts (1 contrato). Sem TP fixo (surfe contínuo até reversão) e sem SL em pontos (zeragem na virada do fluxo).`,
            price: at(-50),
            contracts: 1,
            delta: 420,
          },
        ],
      },
      {
        id: 'ord-pyramid-1-buy',
        ticket: 849502,
        role: 'PYRAMID',
        pyramidLevel: 1,
        timestamp: Date.now() - 3600000 * 0.15,
        timeStr: new Date(Date.now() - 3600000 * 0.15).toTimeString().split(' ')[0],
        type: 'BUY',
        entryPrice: at(0),
        contracts: 1,
        remainingContracts: 1,
        stopLoss: 0,
        takeProfit: at(50), // +50 pts alvo
        status: 'OPEN',
        source: 'ROBOT_EA',
        magicNumber: 101010,
        triggerReason: 'Fechamento Box 10R Verde · Pirâmide #1 (Alvo +50p)',
        auditTrail: [
          {
            id: 'evt-pyr-1',
            timestamp: Date.now() - 3600000 * 0.15,
            timeStr: new Date(Date.now() - 3600000 * 0.15).toTimeString().split(' ')[0],
            action: 'ORDER_DISPATCHED',
            title: 'Pirâmide #1 Disparada no Box Verde',
            details: `Entrada em ${priceLabel(0)} pts com alvo de +50 pontos (TP: ${priceLabel(50)} pts). Stop pela virada do fluxo.`,
            price: at(0),
            contracts: 1,
            delta: 310,
          },
        ],
      },
      {
        id: 'ord-pyramid-2-buy',
        ticket: 849503,
        role: 'PYRAMID',
        pyramidLevel: 2,
        timestamp: Date.now() - 3600000 * 0.05,
        timeStr: new Date(Date.now() - 3600000 * 0.05).toTimeString().split(' ')[0],
        type: 'BUY',
        entryPrice: at(50),
        contracts: 1,
        remainingContracts: 1,
        stopLoss: 0,
        takeProfit: at(100), // +50 pts alvo
        status: 'OPEN',
        source: 'ROBOT_EA',
        magicNumber: 101010,
        triggerReason: 'Fechamento Box 10R Verde · Pirâmide #2 (Alvo +50p)',
        auditTrail: [
          {
            id: 'evt-pyr-2',
            timestamp: Date.now() - 3600000 * 0.05,
            timeStr: new Date(Date.now() - 3600000 * 0.05).toTimeString().split(' ')[0],
            action: 'ORDER_DISPATCHED',
            title: 'Pirâmide #2 Disparada no Box Verde',
            details: `Entrada em ${priceLabel(50)} pts com alvo de +50 pontos (TP: ${priceLabel(100)} pts). Stop pela virada do fluxo.`,
            price: at(50),
            contracts: 1,
            delta: 290,
          },
        ],
      },
      {
        id: 'ord-pyr-closed-prev',
        ticket: 849490,
        role: 'PYRAMID',
        pyramidLevel: 1,
        timestamp: Date.now() - 3600000 * 0.5,
        timeStr: new Date(Date.now() - 3600000 * 0.5).toTimeString().split(' ')[0],
        type: 'BUY',
        entryPrice: at(-100),
        exitPrice: at(-50),
        exitTimestamp: Date.now() - 3600000 * 0.45,
        exitTimeStr: new Date(Date.now() - 3600000 * 0.45).toTimeString().split(' ')[0],
        exitReason: 'TAKE_PROFIT',
        source: 'ROBOT_EA',
        magicNumber: 101010,
        contracts: 1,
        stopLoss: 0,
        takeProfit: at(-50),
        status: 'CLOSED_PROFIT',
        pointsResult: 50,
        financialResult: pointsToBRL(50, 1, asset),
        triggerReason: 'Fechamento Box 10R Verde · Pirâmide Anterior (+50p Alvo Concluído)',
        auditTrail: [
          {
            id: 'evt-pyr-prev-1',
            timestamp: Date.now() - 3600000 * 0.5,
            timeStr: new Date(Date.now() - 3600000 * 0.5).toTimeString().split(' ')[0],
            action: 'ORDER_DISPATCHED',
            title: 'Pirâmide Disparada no Box Verde',
            details: `Entrada em ${priceLabel(-100)} pts com alvo de +50 pontos.`,
            price: at(-100),
            contracts: 1,
          },
          {
            id: 'evt-pyr-prev-2',
            timestamp: Date.now() - 3600000 * 0.45,
            timeStr: new Date(Date.now() - 3600000 * 0.45).toTimeString().split(' ')[0],
            action: 'TAKE_PROFIT_HIT',
            title: 'Alvo de 50 Pontos da Pirâmide Atingido!',
            details: 'Take Profit de +50 pontos liquidado com sucesso (+R$ 10,00).',
            price: at(-50),
            contracts: 1,
          },
        ],
      },
    ];

    const historicClosed: TradeOrder[] = [
      {
        id: 'init-ord-1',
        ticket: 849102,
        timestamp: Date.now() - 3600000 * 3.5,
        timeStr: '09:18:24',
        type: 'BUY',
        entryPrice: at(-300),
        exitPrice: at(-150),
        exitTimestamp: Date.now() - 3600000 * 3.42,
        exitTimeStr: '09:23:10',
        exitReason: 'TAKE_PROFIT',
        source: 'ROBOT_EA',
        magicNumber: 101010,
        contracts: 2,
        stopLoss: at(-400),
        takeProfit: at(-150),
        status: 'CLOSED_PROFIT',
        pointsResult: 150,
        financialResult: pointsToBRL(150, 2, asset),
        triggerReason: 'Convergência Alta 10R (Delta +380 contratos)',
        auditTrail: [
          {
            id: 'evt-init-1-1',
            timestamp: Date.now() - 3600000 * 3.5,
            timeStr: '09:18:24',
            action: 'ORDER_DISPATCHED',
            title: 'Ordem Disparada pelo Robô 10R',
            details: 'Convergência Alta confirmada. Delta +380 contratos no fechamento do box 10R.',
            price: at(-300),
            contracts: 2,
          },
          {
            id: 'evt-init-1-2',
            timestamp: Date.now() - 3600000 * 3.42,
            timeStr: '09:23:10',
            action: 'TAKE_PROFIT_HIT',
            title: 'Take Profit Atingido (+150 pts)',
            details: `Alvo final liquidado a ${priceLabel(-150)} pts com lucro de R$ 60,00.`,
            price: at(-150),
            contracts: 2,
          },
        ],
      },
      {
        id: 'init-ord-2',
        ticket: 849156,
        timestamp: Date.now() - 3600000 * 2.9,
        timeStr: '09:34:10',
        type: 'BUY',
        entryPrice: at(-150),
        exitPrice: at(-100),
        exitTimestamp: Date.now() - 3600000 * 2.82,
        exitTimeStr: '09:39:05',
        exitReason: 'TAKE_PROFIT',
        source: 'ROBOT_EA',
        magicNumber: 101010,
        contracts: 2,
        remainingContracts: 1,
        partialExecuted: true,
        partialPrice: at(-100),
        partialPoints: 50,
        partialFinancial: pointsToBRL(50, 2, asset),
        partialTimestamp: Date.now() - 3600000 * 2.86,
        isBreakevenActive: true,
        stopLoss: at(-145),
        takeProfit: at(0),
        status: 'CLOSED_PROFIT',
        pointsResult: 50,
        financialResult: pointsToBRL(50, 2, asset),
        triggerReason: 'Convergência Alta 10R [Parcial Batida]',
        auditTrail: [
          {
            id: 'evt-init-2-1',
            timestamp: Date.now() - 3600000 * 2.9,
            timeStr: '09:34:10',
            action: 'ORDER_DISPATCHED',
            title: 'Ordem Disparada pelo Robô 10R',
            details: `Compra enviada a mercado a ${priceLabel(-150)} pts com 2 contratos.`,
            price: at(-150),
            contracts: 2,
          },
          {
            id: 'evt-init-2-2',
            timestamp: Date.now() - 3600000 * 2.86,
            timeStr: '09:36:30',
            action: 'PARTIAL_FILLED',
            title: 'Saída Parcial Concluída (+50 pts)',
            details: '1 contrato liquidado no 1º box a favor (+R$ 20,00).',
            price: at(-100),
            contracts: 1,
          },
          {
            id: 'evt-init-2-3',
            timestamp: Date.now() - 3600000 * 2.85,
            timeStr: '09:36:31',
            action: 'BREAKEVEN_MOVED',
            title: 'Stop Loss Protegido no Breakeven',
            details: `SL reposicionado em ${priceLabel(-145)} pts (+5 pts offset de taxas da B3).`,
            price: at(-145),
          },
        ],
      },
    ];

    const closedSaved = saved && saved.length > 0 ? saved.filter((o) => o.status !== 'OPEN' && o.status !== 'PENDING_LIMIT') : historicClosed;
    return [...defaultPyramidOrders, ...closedSaved];
  });
  const [latestToast, setLatestToast] = useState<{
    id: string;
    type: 'BUY' | 'SELL' | 'INFO';
    title: string;
    description: string;
    timestamp: number;
  } | null>(null);

  // Estado da Conexão MT5 Live Bridge
  const [mt5State, setMt5State] = useState<MT5ConnectionState>({
    status: 'DISCONNECTED',
  });
  const wsRef = useRef<WebSocket | null>(null);

  // Instâncias dos motores de cálculo
  const engineRef = useRef<RenkoFlowEngine>(new RenkoFlowEngine(50, asset));
  const simulatorRef = useRef<B3MarketSimulator>(new B3MarketSimulator(referencePrice(asset), asset));

  // Inicializa dados históricos iniciais para que o terminal comece populado
  useEffect(() => {
    const engine = engineRef.current;
    const sim = simulatorRef.current;
    // Partida na régua do ativo (último preço real fresco ou o basePrice do registro)
    const reference = referencePrice(asset);
    engine.initialize(reference);

    const initialTicks: Tick[] = [];
    rangeEngineRef.current.setRangePoints(rangePoints);
    rangeEngineRef.current.initialize(reference);
    timeEngineRef.current.setIntervalMs(timeframeSec * 1000);
    timeEngineRef.current.initialize(reference);
    // Escalas paralelas 15R/20R/25R começam sincronizadas com o mercado (só o coletor usa)
    ALT_RENKO_SCALES.forEach((alt) => altEnginesRef.current[alt.key].initialize(reference));
    // Simula 350 ticks para gerar os primeiros ~20 boxes
    for (let i = 0; i < 350; i++) {
      const t = sim.generateNextTick();
      initialTicks.unshift(t);
      engine.processTick(t, config);
      rangeEngineRef.current.processTick(t);
      timeEngineRef.current.processTick(t);
    }

    setTicks(initialTicks.slice(0, 100));
    setBoxes([...engine.getBoxes()]);
    setCurrentBox(engine.getCurrentBox());
    setCurrentPrice(sim.getPrice());
    setCvd(engine.getCvd());
    setRangeBoxes([...rangeEngineRef.current.getBoxes()]);
    setRangeCurrentBox(rangeEngineRef.current.getCurrentBox());
    setTimeBoxes([...timeEngineRef.current.getBoxes()]);
    setTimeCurrentBox(timeEngineRef.current.getCurrentBox());
    // initialTicks está do mais recente para o mais antigo; o replay precisa da ordem cronológica
    allTicksRef.current = [...initialTicks].reverse();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Atualiza tamanho do box quando a config mudar
  useEffect(() => {
    engineRef.current.setBoxPoints(config.boxPoints);
  }, [config.boxPoints]);

  // Persiste a escolha de série e as escalas experimentais no navegador
  useEffect(() => {
    try {
      localStorage.setItem('fluxo_chart_series_v1', chartSeries);
      localStorage.setItem('fluxo_chart_range_pts_v1', String(rangePoints));
      localStorage.setItem('fluxo_chart_time_sec_v1', String(timeframeSec));
    } catch (e) {
      // Ignora
    }
  }, [chartSeries, rangePoints, timeframeSec]);

  // Recalcula toda a história em Range quando a escala mudar (experimentar instantâneo)
  useEffect(() => {
    const eng = rangeEngineRef.current;
    eng.setRangePoints(rangePoints);
    const hist = allTicksRef.current;
    if (hist.length > 0) {
      eng.initialize(hist[0].price, hist[0].timestamp);
      for (const t of hist) eng.processTick(t);
    }
    setRangeBoxes([...eng.getBoxes()]);
    setRangeCurrentBox(eng.getCurrentBox());
  }, [rangePoints]);

  // Recalcula toda a história temporal quando o intervalo mudar
  useEffect(() => {
    const eng = timeEngineRef.current;
    eng.setIntervalMs(timeframeSec * 1000);
    const hist = allTicksRef.current;
    if (hist.length > 0) {
      eng.initialize(hist[0].price, hist[0].timestamp);
      for (const t of hist) eng.processTick(t);
    }
    setTimeBoxes([...eng.getBoxes()]);
    setTimeCurrentBox(eng.getCurrentBox());
  }, [timeframeSec]);

  // Registra os medidores de regime dos 6 motores no coletor (leitura da Avaliação Técnica;
  // os medidores são alimentados pelos próprios motores, aqui só se expõe a leitura)
  useEffect(() => {
    seriesCollectorService.registerRegimeMeter('renko', engineRef.current.getRegimeMeter());
    seriesCollectorService.registerRegimeMeter('range', rangeEngineRef.current.getRegimeMeter());
    seriesCollectorService.registerRegimeMeter('tempo', timeEngineRef.current.getRegimeMeter());
    for (const alt of ALT_RENKO_SCALES) {
      seriesCollectorService.registerRegimeMeter(alt.key, altEnginesRef.current[alt.key].getRegimeMeter());
    }
  }, []);

  // Função para processar a execução de um tick
  const handleIncomingTick = useCallback(
    (tick: Tick) => {
      // Tick vindo do MT5 (corretora): marca o coletor como "dia real." Assim o replay
      // automático de abertura nunca apaga uma coleta verdadeira já registrada hoje
      if (mt5State.status === 'CONNECTED') seriesCollectorService.markRealData();
      // Régua do ativo (Fase 2): o basePrice fixo do registro envelhece, então o último preço REAL
      // visto é persistido (escrita amortecida a cada ~30s por aba) para eixo Y, partida do
      // sintético e tolerância do sanitizador sobreviverem ao F5 sem depender da corretora.
      if (mt5State.status === 'CONNECTED' && tick.price > 0) {
        const now = Date.now();
        if (now - lastPriceWriteRef.current > 30_000) {
          lastPriceWriteRef.current = now;
          rememberLastPrice(asset.id, tick.price);
        }
      }
      // Trava de fim de pregão (hora `tradingCloseAllTime` da estratégia, padrão 17:30): no
      // simulador o robô quita tudo e para de abrir operações. Com o MT5 conectado a trava é
      // ignorada pelo app — liquidar posição real exigiria ordem na corretora (quem faz isso lá é
      // a ponte Python, que obedece a mesma hora do CLOSE_ALL_TIME gerado).
      const closeLockLabel = sessionCloseLockLabel(config.tradingCloseAllTime);
      const sessionLock = mt5State.status !== 'CONNECTED' && isSessionCloseLock(tick.timestamp, config.tradingCloseAllTime);
      const engine = engineRef.current;
      setCurrentPrice(tick.price);

      // Adiciona na fita de Times & Trades
      setTicks((prev) => [tick, ...prev.slice(0, 99)]);

      // Processa no motor de Renko 10R e Fluxo
      const renkoRes = engine.processTick(tick, config);
      setCvd(engine.getCvd());
      setCurrentBox(engine.getCurrentBox());

      // Alimenta as séries experimentais (Range e Tempo) com o mesmo fluxo de ticks
      if (allTicksRef.current.length < 50000) allTicksRef.current.push(tick);
      const rangeEng = rangeEngineRef.current;
      const timeEng = timeEngineRef.current;
      // A janela do medidor segue a config (Range/Tempo; Renko sincroniza dentro do próprio motor)
      rangeEng.getRegimeMeter().setLookbackBoxes(config.regimeLookbackBoxes ?? 20);
      timeEng.getRegimeMeter().setLookbackBoxes(config.regimeLookbackBoxes ?? 20);
      const rangeRes = rangeEng.processTick(tick);
      setRangeCurrentBox(rangeEng.getCurrentBox());
      if (rangeRes.newBarClosed) setRangeBoxes([...rangeEng.getBoxes()]);
      const timeRes = timeEng.processTick(tick);
      setTimeCurrentBox(timeEng.getCurrentBox());
      if (timeRes.newBarClosed) setTimeBoxes([...timeEng.getBoxes()]);

      // =========================================================================
      // COLETOR INTERNO: toda barra fechada (das 3 séries, não importa a ativa)
      // alimenta os robôs sombra com a MESMA config do EA.
      // =========================================================================
      seriesCollectorService.markToMarket(tick.price, tick.timestamp);
      const tfShortLabel =
        timeframeSec < 60
          ? `${timeframeSec}s`
          : timeframeSec < 3600
          ? `${Math.round(timeframeSec / 60)}min`
          : `${Math.round(timeframeSec / 3600)}h`;
      if (renkoRes.newBoxClosed && renkoRes.closedBox) {
        setBoxes([...engine.getBoxes()]);
        seriesCollectorService.ingest(
          'renko',
          renkoRes.closedBox,
          engine.getBoxes().slice(0, -1),
          config,
          renkoScaleLabel(config.boxPoints, asset),
          engine.getRegimeMeter()
        );
      }
      let rangeConv: ConvergenceResult | null = null;
      if (rangeRes.newBarClosed && rangeRes.closedBox) {
        rangeConv = annotateActiveBar(rangeRes.closedBox, rangeEng.getBoxes().slice(0, -1), config, `Range ${rangePoints} pts`, rangeEng.getRegimeMeter());
        seriesCollectorService.ingest('range', rangeRes.closedBox, rangeEng.getBoxes().slice(0, -1), config, `${rangePoints} pts`, rangeEng.getRegimeMeter());
      }
      let timeConv: ConvergenceResult | null = null;
      if (timeRes.newBarClosed && timeRes.closedBox) {
        timeConv = annotateActiveBar(timeRes.closedBox, timeEng.getBoxes().slice(0, -1), config, `Tempo ${tfShortLabel}`, timeEng.getRegimeMeter());
        seriesCollectorService.ingest('tempo', timeRes.closedBox, timeEng.getBoxes().slice(0, -1), config, tfShortLabel, timeEng.getRegimeMeter());
      }

      // Escalas Renko paralelas (15R/20R/25R): processam os mesmos ticks e alimentam o coletor
      for (const alt of ALT_RENKO_SCALES) {
        const altEng = altEnginesRef.current[alt.key];
        const altRes = altEng.processTick(tick, config);
        if (altRes.newBoxClosed && altRes.closedBox) {
          seriesCollectorService.ingest(alt.key, altRes.closedBox, altEng.getBoxes().slice(0, -1), config, `${alt.pts} pts`, altEng.getRegimeMeter());
        }
      }

      // =========================================================================
      // ROBÔ NA SÉRIE ATIVA (Opção A): as ordens são disparadas pela série
      // escolhida na barra do gráfico. Séries inativas só alimentam o coletor.
      // =========================================================================
      const mt5TagShort = chartSeries === 'renko' ? '10R' : `RNG${rangePoints}`;
      const robotTag = chartSeries === 'renko' ? 'Renko 10R' : `Range ${rangePoints}pts`;
      let result: ActiveTickResult = { newBoxClosed: false };
      if (chartSeries === 'renko') {
        result = renkoRes;
      } else if (chartSeries === 'range' && rangeRes.newBarClosed && rangeRes.closedBox && rangeConv) {
        result = { newBoxClosed: true, closedBox: rangeRes.closedBox, signal: rangeConv.signal, signalReason: rangeConv.reason };
      }

      // Se uma barra da série ativa fechou
      if (result.newBoxClosed && result.closedBox) {

        // Se gerou sinal de fechamento de box (na trava de pregão nenhum sinal novo é operado)
        if (result.signal && result.closedBox && !sessionLock) {
          const signalType = result.signal; // 'BUY' (bloco verde) ou 'SELL' (bloco vermelho)
          const oppositeType = signalType === 'BUY' ? 'SELL' : 'BUY';

          // =========================================================================
          // ESTRATÉGIA 1: PIRÂMIDE COM CONFLUÊNCIA DE FLUXO & RENKO 10R
          // (Compre no fechamento de cada bloco verde com TP de 50p, mantendo a principal
          // aberta até a virada de fluxo. Zeragem total por inversão sem SL fixo).
          // =========================================================================
          if (config.strategyMode === 'PYRAMID_FLOW_CONFLUENCE') {
            setOrders((prev) => {
              let updatedPrev = [...prev];

              // 1. SAÍDA COMPULSÓRIA POR INVERSÃO DE MERCADO:
              // Se o fluxo virou de VENDA para COMPRA (ou vice-versa),
              // encerra a entrada principal oposta e qualquer ordem da pirâmide oposta ainda aberta.
              // Isso ocorre incondicionalmente para proteger o capital!
              const hasOppositeOpen = updatedPrev.some(
                (o) => (o.status === 'OPEN' || o.status === 'PENDING_LIMIT') && o.type === oppositeType
              );

              if (hasOppositeOpen) {
                let totalClosedPnL = 0;
                updatedPrev = updatedPrev.map((o) => {
                  if ((o.status === 'OPEN' || o.status === 'PENDING_LIMIT') && o.type === oppositeType) {
                    const pts = o.type === 'BUY' ? tick.price - o.entryPrice : o.entryPrice - tick.price;
                    const activeCtros = o.remainingContracts || o.contracts;
                    const fin = pointsToBRL(pts, activeCtros, asset) + (o.partialFinancial || 0);
                    totalClosedPnL += fin;

                    const flipEvt = OrderAuditService.createEvent(
                      'FLIP_REVERSAL_CLOSED',
                      `Zeragem por Inversão de Mercado (${oppositeType} ➔ ${signalType})`,
                      `Virada do fluxo para ${signalType === 'BUY' ? 'ALTA (Bloco Verde)' : 'BAIXA (Bloco Vermelho)'}. Posição ${
                        o.role === 'MAIN' ? 'Principal (Surfe)' : `Pirâmide #${o.pyramidLevel || 1}`
                      } liquidada a mercado a ${tick.price} pts. Resultado: ${pts >= 0 ? '+' : ''}${pts} pts (R$ ${fin.toFixed(2)}).`,
                      tick.price,
                      activeCtros
                    );

                    return {
                      ...o,
                      status: fin >= 0 ? ('CLOSED_PROFIT' as const) : ('CLOSED_LOSS' as const),
                      exitPrice: tick.price,
                      exitTimestamp: Date.now(),
                      exitTimeStr: new Date().toTimeString().split(' ')[0],
                      exitReason: 'FLIP_REVERSAL' as const,
                      pointsResult: pts,
                      financialResult: fin,
                      auditTrail: o.auditTrail ? [...o.auditTrail, flipEvt] : [flipEvt],
                    };
                  }
                  return o;
                });

                setLatestToast({
                  id: `flip-toast-${Date.now()}`,
                  type: signalType,
                  title: `🔄 INVERSÃO DE MERCADO [${robotTag}]: POSIÇÕES ANTERIORES ZERADAS!`,
                  description: `Virada do fluxo para ${signalType === 'BUY' ? 'ALTA' : 'BAIXA'}. Entrada mãe e ordens da pirâmide encerradas (R$ ${totalClosedPnL.toFixed(2)}).`,
                  timestamp: Date.now(),
                });

                if (mt5State.status === 'CONNECTED' && wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
                  wsRef.current.send(JSON.stringify({ action: 'CLOSE_POSITIONS' }));
                }
              }

              // 2. DISPARO NA DIREÇÃO ATUAL:
              // Apenas se o robô estiver ativo e dentro do horário configurado
              if (!config.active) {
                return updatedPrev;
              }

              // Janela do day trade: comparada na hora do TICK (não o relógio de parede) —
              // no replay/feed sintético o robô obedece a barra simulada, ex.: 08:55–17:30.
              if (!isWithinTradingWindow(tick.timestamp, config)) {
                return updatedPrev;
              }

              // 3. TRAVA FINANCEIRA DA SESSÃO: bateu meta de ganho, perda máxima ou limite
              // de trades → o Robô para de abrir. As SAÍDAS seguem funcionando (TP, trailing,
              // inversão, trava de pregão): a trava protege o resultado, não prende ninguém.
              const finLock = sessionFinancialLock(updatedPrev, config, sessionStartRef.current);
              if (finLock) {
                if (config.closeAllOnFinancialLock) {
                  const hadOpen = updatedPrev.some((o) => o.status === 'OPEN' || o.status === 'PENDING_LIMIT');
                  updatedPrev = liquidateForFinancialLock(updatedPrev, tick.price, finLock);
                  if (hadOpen && mt5State.status === 'CONNECTED' && wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
                    wsRef.current.send(JSON.stringify({ action: 'CLOSE_POSITIONS' }));
                  }
                }
                announceFinancialLock(finLock);
                return updatedPrev;
              }

              // Se não há ordem MAIN aberta nesta direção: cria a Entrada Principal (Surfe sem TP/SL fixo)
              // Se já há ordem MAIN aberta nesta direção: cria uma nova Ordem da Pirâmide com TP de 50 pts!
              const openSameSide = updatedPrev.filter(
                (o) => (o.status === 'OPEN' || o.status === 'PENDING_LIMIT') && o.type === signalType
              );
              const hasMainOrder = openSameSide.some((o) => o.role === 'MAIN');

              // TIPO DE ENTRADA DA PIRÂMIDE (vale para mãe e pirâmides): a mercado no fechamento,
              // Limit a 50% do box ou Limit na entrada (abertura) do box — renko, range ou pontos.
              const pyrEntryType = config.pyramidEntryType || 'MARKET_ON_CLOSE';
              const useLimitEntry = pyrEntryType !== 'MARKET_ON_CLOSE';
              const pyrLimitPrice = useLimitEntry
                ? pyrEntryType === 'BOX_50_LIMIT'
                  ? (result.closedBox!.open + result.closedBox!.close) / 2
                  : result.closedBox!.open
                : 0;

                let newOrder: TradeOrder;

                if (!hasMainOrder) {
                  const mainEvt = OrderAuditService.createEvent(
                    'ORDER_DISPATCHED',
                    `Ordem Principal ${signalType === 'BUY' ? 'COMPRA' : 'VENDA'} (Surfe de Tendência) [Robô ${robotTag}]`,
                    `Entrada Matriz no fechamento do 1º bloco ${signalType === 'BUY' ? 'verde' : 'vermelho'} a ${tick.price} pts (${config.contracts} ctro(s)). Mantida aberta até a virada do fluxo!` +
                      (useLimitEntry ? ` Ordem LIMITADA posicionada em ${pyrLimitPrice} pts (${pyrEntryType === 'BOX_OPEN_LIMIT' ? 'entrada do box' : '50% do box'}).` : ''),
                    tick.price,
                    config.contracts,
                    result.closedBox!.delta
                  );

                  newOrder = {
                    id: `ord-main-${Date.now()}`,
                    ticket: Math.floor(100000 + Math.random() * 900000),
                    timestamp: Date.now(),
                    timeStr: new Date().toTimeString().split(' ')[0],
                    type: signalType,
                    role: 'MAIN',
                    entryPrice: useLimitEntry ? pyrLimitPrice : tick.price,
                    limitPrice: useLimitEntry ? pyrLimitPrice : undefined,
                    pendingBoxIndex: useLimitEntry ? result.closedBox!.index : undefined,
                    contracts: config.contracts,
                    stopLoss: 0,
                    takeProfit: 0,
                    status: useLimitEntry ? 'PENDING_LIMIT' : 'OPEN',
                    source: mt5State.status === 'CONNECTED' ? 'MT5_LIVE' : 'ROBOT_EA',
                    magicNumber: config.magicNumber,
                    triggerReason: `Entrada Principal ${signalType === 'BUY' ? 'Compra' : 'Venda'} (${robotTag} — Surfe até Virada do Fluxo)`,
                    isRealMT5: mt5State.status === 'CONNECTED',
                    auditTrail: [mainEvt],
                  };

                  setLatestToast({
                    id: `main-toast-${Date.now()}`,
                    type: signalType,
                    title: useLimitEntry
                      ? `🎯 ORDEM LIMITADA DA MÃE POSICIONADA! [${robotTag}]`
                      : `🚀 ENTRADA PRINCIPAL ${signalType === 'BUY' ? 'COMPRA' : 'VENDA'} EXECUTADA!`,
                    description: useLimitEntry
                      ? `Limit em ${pyrLimitPrice.toLocaleString('pt-BR')} pts (${pyrEntryType === 'BOX_OPEN_LIMIT' ? 'entrada do box' : '50% do box'}). Só executa se o preço recuar.`
                      : `Surfe iniciado a ${tick.price.toLocaleString('pt-BR')} pts (${config.contracts} ct). Aberta até a virada do fluxo.`,
                    timestamp: Date.now(),
                  });

                  sendEntryToBridgeOnce(tick.timestamp, {
                    action: 'ORDER_SEND',
                    type: signalType,
                    isLimit: useLimitEntry,
                    limitPrice: useLimitEntry ? pyrLimitPrice : undefined,
                    contracts: config.contracts,
                    comment: `PIRAMIDE_MAIN_${signalType}_${mt5TagShort}`,
                  });
                } else {
                  // Ordem da Pirâmide (Subadd com TP de 50 pontos)
                  const pyramidOrders = openSameSide.filter((o) => o.role === 'PYRAMID');
                  const pyramidLevel = pyramidOrders.length + 1;
                  const tpPoints = config.pyramidTpPoints || 50;
                  // TP/SL são ancorados no preço real de entrada (fechamento ou nível do Limit)
                  const entryAnchor = useLimitEntry ? pyrLimitPrice : tick.price;
                  const targetTp =
                    signalType === 'BUY' ? entryAnchor + tpPoints : entryAnchor - tpPoints;
                  const pyrContracts = config.pyramidContracts || 1;
                  // Stop OPCIONAL da pirâmide: 0 = sem stop fixo (saída só pela inversão do fluxo)
                  const pyrSlPoints = (config.pyramidSlPoints ?? 0) > 0 ? config.pyramidSlPoints : 0;
                  const targetSl = pyrSlPoints > 0
                    ? (signalType === 'BUY' ? entryAnchor - pyrSlPoints : entryAnchor + pyrSlPoints)
                    : 0;

                  const pyrEvt = OrderAuditService.createEvent(
                    'ORDER_DISPATCHED',
                    `Ordem da Pirâmide #${pyramidLevel} (${signalType === 'BUY' ? 'COMPRA' : 'VENDA'}) [Robô ${robotTag}]`,
                    `Nova compra/venda no fechamento do bloco ${signalType === 'BUY' ? 'verde' : 'vermelho'} (${pyrContracts} ctro). ${useLimitEntry ? `Ordem LIMITADA em ${pyrLimitPrice} pts (${pyrEntryType === 'BOX_OPEN_LIMIT' ? 'entrada do box' : '50% do box'}).` : `Entrada a mercado a ${tick.price} pts.`} Alvo TP fixo em +${tpPoints} pts (${targetTp} pts).${pyrSlPoints > 0 ? ` Stop de proteção em ${targetSl} pts (-${pyrSlPoints} pts).` : ' Sem stop fixo (saída por inversão).'}`,
                    tick.price,
                    pyrContracts,
                    result.closedBox!.delta
                  );

                  newOrder = {
                    id: `ord-pyr-${Date.now()}-${pyramidLevel}`,
                    ticket: Math.floor(100000 + Math.random() * 900000),
                    timestamp: Date.now(),
                    timeStr: new Date().toTimeString().split(' ')[0],
                    type: signalType,
                    role: 'PYRAMID',
                    pyramidLevel,
                    entryPrice: entryAnchor,
                    limitPrice: useLimitEntry ? pyrLimitPrice : undefined,
                    pendingBoxIndex: useLimitEntry ? result.closedBox!.index : undefined,
                    contracts: pyrContracts,
                    stopLoss: targetSl,
                    takeProfit: targetTp,
                    status: useLimitEntry ? 'PENDING_LIMIT' : 'OPEN',
                    source: mt5State.status === 'CONNECTED' ? 'MT5_LIVE' : 'ROBOT_EA',
                    magicNumber: config.magicNumber,
                    triggerReason: `Pirâmide #${pyramidLevel} ${signalType === 'BUY' ? 'Compra' : 'Venda'} ${robotTag} (+${tpPoints}p TP)`,
                    isRealMT5: mt5State.status === 'CONNECTED',
                    auditTrail: [pyrEvt],
                  };

                  setLatestToast({
                    id: `pyr-toast-${Date.now()}`,
                    type: signalType,
                    title: useLimitEntry
                      ? `🎯 PIRÂMIDE #${pyramidLevel} LIMIT POSICIONADA [${mt5TagShort}] (+${tpPoints}p TP)`
                      : `🔺 PIRÂMIDE #${pyramidLevel} ${signalType === 'BUY' ? 'COMPRA' : 'VENDA'} [${mt5TagShort}] (+${tpPoints}p TP)!`,
                    description: useLimitEntry
                      ? `Aguardando recuo até ${pyrLimitPrice.toLocaleString('pt-BR')} pts (${pyrEntryType === 'BOX_OPEN_LIMIT' ? 'entrada do box' : '50% do box'}). TP em ${targetTp.toLocaleString('pt-BR')} pts.`
                      : `Entrada a ${tick.price.toLocaleString('pt-BR')} pts. Alvo TP em ${targetTp.toLocaleString('pt-BR')} pts (+1 box).`,
                    timestamp: Date.now(),
                  });

                  sendEntryToBridgeOnce(tick.timestamp, {
                    action: 'ORDER_SEND',
                    type: signalType,
                    isLimit: useLimitEntry,
                    limitPrice: useLimitEntry ? pyrLimitPrice : undefined,
                    contracts: pyrContracts,
                    tp: tpPoints,
                    sl: pyrSlPoints,
                    comment: `PIRAMIDE_SUB_${pyramidLevel}_${mt5TagShort}`,
                  });
                }

                return [newOrder, ...updatedPrev];
              });
            } else {
              // =========================================================================
              // ESTRATÉGIA 2: RETESTE / PULLBACK CLÁSSICO INSTITUCIONAL
              // =========================================================================
              const signalType = result.signal;
              const isPullbackMode = config.entryTriggerType === 'PULLBACK_ENTRY';

              // Calcula o preço do reteste/pullback na entrada
              let limitPrice = tick.price;
              if (isPullbackMode) {
                if (config.pullbackTarget === 'BOX_OPEN') {
                  limitPrice = result.closedBox.open; // Retorna 100% até a abertura onde o bloco iniciou
                } else if (config.pullbackTarget === 'BOX_50_PCT') {
                  limitPrice = (result.closedBox.open + result.closedBox.close) / 2; // Retorno de 50%
                } else {
                  limitPrice =
                    signalType === 'BUY'
                      ? result.closedBox.close - config.pullbackCustomPoints
                      : result.closedBox.close + config.pullbackCustomPoints;
                }
              }

              const effectivePrice = isPullbackMode ? limitPrice : tick.price;
              const sl =
                signalType === 'BUY'
                  ? effectivePrice - config.stopLossPoints
                  : effectivePrice + config.stopLossPoints;
              const tp =
                signalType === 'BUY'
                  ? effectivePrice + config.takeProfitPoints
                  : effectivePrice - config.takeProfitPoints;

              // Aviso na tela + envio à ponte: só quando a ordem REALMENTE entra no livro.
              // Antes ficava depois do setOrders, então disparava mesmo quando um gate
              // bloqueava a criação — com o MT5 conectado seria uma ordem real não autorizada.
              const announceAndDispatchPullback = () => {
                if (isPullbackMode) {
                  setLatestToast({
                    id: `ord-toast-${Date.now()}`,
                    type: signalType,
                    title: `ORDEM LIMITADA POSICIONADA NO RETESTE [${robotTag}]`,
                    description: `Convergência detectada! Aguardando o preço VOLTAR para testar a entrada em ${limitPrice.toLocaleString('pt-BR')} pts.`,
                    timestamp: Date.now(),
                  });
                } else {
                  setLatestToast({
                    id: `ord-toast-${Date.now()}`,
                    type: signalType,
                    title: `ORDEM ${signalType === 'BUY' ? 'COMPRA' : 'VENDA'} DISPARADA A MERCADO [${robotTag}]`,
                    description: `${result.signalReason} a ${tick.price.toLocaleString('pt-BR')} pts`,
                    timestamp: Date.now(),
                  });
                }

                sendEntryToBridgeOnce(tick.timestamp, {
                  action: 'ORDER_SEND',
                  type: signalType,
                  isLimit: isPullbackMode,
                  limitPrice: isPullbackMode ? limitPrice : undefined,
                  contracts: config.contracts,
                  sl: config.stopLossPoints,
                  tp: config.takeProfitPoints,
                  comment: isPullbackMode ? `Reteste ${signalType} ${mt5TagShort}` : `${mt5TagShort} ${signalType}`,
                });
              };

              setOrders((prev) => {
                // Portões do Reteste — os MESMOS da Pirâmide. Este caminho não conferia
                // nada: disparava ordem até com o Robô desligado ou fora da janela.
                if (!config.active) return prev;
                if (!isWithinTradingWindow(tick.timestamp, config)) return prev;

                // TRAVA FINANCEIRA: meta / perda / limite de trades batidos → para de abrir
                const finLockPullback = sessionFinancialLock(prev, config, sessionStartRef.current);
                if (finLockPullback) {
                  if (config.closeAllOnFinancialLock) {
                    const hadOpen = prev.some((o) => o.status === 'OPEN' || o.status === 'PENDING_LIMIT');
                    if (hadOpen && mt5State.status === 'CONNECTED' && wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
                      wsRef.current.send(JSON.stringify({ action: 'CLOSE_POSITIONS' }));
                    }
                    announceFinancialLock(finLockPullback);
                    return liquidateForFinancialLock(prev, tick.price, finLockPullback);
                  }
                  announceFinancialLock(finLockPullback);
                  return prev;
                }

                const currentOpen = prev.filter((o) => o.status === 'OPEN' || o.status === 'PENDING_LIMIT');

                let updatedPrev = prev;
                if (config.accountMode === 'HEDGE') {
                  if (config.hedgeOppositeAction === 'CLOSE_OPPOSITE') {
                    const oppositeType = signalType === 'BUY' ? 'SELL' : 'BUY';
                    updatedPrev = prev.map((o) => {
                      if (o.status === 'OPEN' && o.type === oppositeType) {
                        const pts = o.type === 'BUY' ? tick.price - o.entryPrice : o.entryPrice - tick.price;
                        return {
                          ...o,
                          status: 'CLOSED_MANUAL' as const,
                          exitPrice: tick.price,
                          pointsResult: pts,
                          financialResult: pointsToBRL(pts, o.contracts, asset),
                        };
                      }
                      return o;
                    });
                  } else if (config.hedgeOppositeAction === 'IGNORE_NEW') {
                    const oppositeType = signalType === 'BUY' ? 'SELL' : 'BUY';
                    if (currentOpen.some((o) => o.type === oppositeType && o.status === 'OPEN')) {
                      return prev;
                    }
                  }

                  if (currentOpen.filter((o) => o.status === 'OPEN').length >= config.maxSimultaneousPositions) {
                    return updatedPrev;
                  }

                  const initialAuditEvt = OrderAuditService.createEvent(
                    'ORDER_DISPATCHED',
                    isPullbackMode ? 'Ordem Limitada Posicionada no Reteste' : 'Ordem a Mercado Disparada',
                    isPullbackMode
                      ? `Aguardando pullback de reteste na abertura do box em ${limitPrice} pts. Sinal: ${result.signalReason}`
                      : `Execução imediata a mercado em ${effectivePrice} pts. Sinal: ${result.signalReason}`,
                    isPullbackMode ? limitPrice : effectivePrice,
                    config.contracts,
                    result.closedBox!.delta
                  );

                  const newOrder: TradeOrder = {
                    id: `ord-${Date.now()}`,
                    ticket: Math.floor(100000 + Math.random() * 900000),
                    timestamp: Date.now(),
                    timeStr: new Date().toTimeString().split(' ')[0],
                    type: signalType,
                    entryPrice: effectivePrice,
                    limitPrice: isPullbackMode ? limitPrice : undefined,
                    pendingBoxIndex: result.closedBox!.index,
                    contracts: config.contracts,
                    stopLoss: sl,
                    takeProfit: tp,
                    status: isPullbackMode ? 'PENDING_LIMIT' : 'OPEN',
                    triggerReason: isPullbackMode
                      ? `${result.signalReason} [Aguardando Reteste em ${limitPrice.toLocaleString('pt-BR')} pts]`
                      : `${result.signalReason} [MERCADO]`,
                    isRealMT5: mt5State.status === 'CONNECTED',
                    source: mt5State.status === 'CONNECTED' ? 'MT5_LIVE' : 'ROBOT_EA',
                    magicNumber: config.magicNumber,
                    auditTrail: [initialAuditEvt],
                  };

                  announceAndDispatchPullback();
                  return [newOrder, ...updatedPrev];
                } else {
                  if (currentOpen.length > 0) return prev;

                  const initialAuditEvt = OrderAuditService.createEvent(
                    'ORDER_DISPATCHED',
                    isPullbackMode ? 'Ordem Limitada Posicionada no Reteste' : 'Ordem a Mercado Disparada',
                    isPullbackMode
                      ? `Aguardando pullback de reteste na abertura do box em ${limitPrice} pts. Sinal: ${result.signalReason}`
                      : `Execução imediata a mercado em ${effectivePrice} pts. Sinal: ${result.signalReason}`,
                    isPullbackMode ? limitPrice : effectivePrice,
                    config.contracts,
                    result.closedBox!.delta
                  );

                  const newOrder: TradeOrder = {
                    id: `ord-${Date.now()}`,
                    ticket: Math.floor(100000 + Math.random() * 900000),
                    timestamp: Date.now(),
                    timeStr: new Date().toTimeString().split(' ')[0],
                    type: signalType,
                    entryPrice: effectivePrice,
                    limitPrice: isPullbackMode ? limitPrice : undefined,
                    pendingBoxIndex: result.closedBox!.index,
                    contracts: config.contracts,
                    stopLoss: sl,
                    takeProfit: tp,
                    status: isPullbackMode ? 'PENDING_LIMIT' : 'OPEN',
                    triggerReason: isPullbackMode
                      ? `${result.signalReason} [Aguardando Retorno na Entrada]`
                      : `${result.signalReason}`,
                    isRealMT5: mt5State.status === 'CONNECTED',
                    source: mt5State.status === 'CONNECTED' ? 'MT5_LIVE' : 'ROBOT_EA',
                    magicNumber: config.magicNumber,
                    auditTrail: [initialAuditEvt],
                  };

                  announceAndDispatchPullback();
                  return [newOrder, ...prev];
                }
              });
            }
          }
        }

      // 1. Monitoramento de ordens pendentes de PULLBACK (aciona quando o preço recua para testar a entrada)
      // 2. Checagem de ordens abertas para Stop Loss ou Take Profit
      // A validade da limitada é contada em BOXES FECHADOS DA SÉRIE ATIVA, então o índice é lido do
      // MOTOR (ref) e não do estado `boxes`: o estado só é commitado no render seguinte, então num
      // passo de replay com dezenas de ticks por vez ele congelaria e a expiração aconteceria em
      // momentos diferentes só porque a velocidade é outra. Na série Range o índice também não
      // batia com o `pendingBoxIndex` (vinha da escala Renko), expirando ordem no ritmo errado.
      const validityBoxes = chartSeries === 'range' ? rangeEng.getBoxes() : engine.getBoxes();
      const liveCurrentBoxIdx = validityBoxes.length > 0 ? validityBoxes[validityBoxes.length - 1].index : 0;
      setOrders((prevOrders) => {
        let changed = false;
        let dayClosedCount = 0;
        const currentBoxIdx = liveCurrentBoxIdx;
        // Direções das ordens mãe que devem ser protegidas no breakeven (TP de pirâmide batido neste tick)
        const breakevenMainDirs: ('BUY' | 'SELL')[] = [];

        let updated = prevOrders.map((ord) => {
          // SE FOR ORDEM LIMITADA PENDENTE DE PULLBACK
          if (ord.status === 'PENDING_LIMIT' && ord.limitPrice !== undefined) {
            // TRAVA DE FIM DE PREGÃO (hora da estratégia): limitada que não virou posição é cancelada
            if (sessionLock) {
              changed = true;
              dayClosedCount += 1;
              const lockEvt = OrderAuditService.createEvent(
                'DAY_CLOSE_FORCED',
                `Cancelada na trava de fim de pregão (${closeLockLabel})`,
                `Entrada limitada em ${ord.limitPrice} pts não foi executada antes do encerramento do pregão e foi cancelada.`,
                tick.price,
                ord.contracts
              );
              return {
                ...ord,
                status: 'EXPIRED_PULLBACK' as const,
                exitTimestamp: Date.now(),
                exitTimeStr: new Date().toTimeString().split(' ')[0],
                exitReason: 'DAY_CLOSE' as const,
                triggerReason: `Cancelada: trava de fim de pregão (${closeLockLabel}).`,
                auditTrail: ord.auditTrail ? [...ord.auditTrail, lockEvt] : [lockEvt],
              };
            }
            // Se for COMPRA pendente e o preço recuou até o preço limite da entrada (ou abaixo)
            if (ord.type === 'BUY' && tick.price <= ord.limitPrice) {
              changed = true;
              setLatestToast({
                id: `fill-toast-${Date.now()}`,
                type: 'BUY',
                title: `🎯 COMPRA ACIONADA NO RETESTE DA ENTRADA!`,
                description: `O preço voltou e executou a compra a ${ord.limitPrice.toLocaleString('pt-BR')} pts (Abertura do Box)!`,
                timestamp: Date.now(),
              });
              const fillEvt = OrderAuditService.createEvent(
                'ORDER_FILLED',
                'Ordem Executada no Reteste (COMPRA)',
                `Preço recuou para a abertura do box e executou a entrada em ${ord.limitPrice} pts.`,
                ord.limitPrice,
                ord.contracts
              );
              return {
                ...ord,
                status: 'OPEN' as const,
                entryPrice: ord.limitPrice,
                fillTimestamp: Date.now(),
                fillTimeStr: new Date().toTimeString().split(' ')[0],
                triggerReason: `Executado no Reteste da Entrada (${ord.limitPrice} pts)`,
                auditTrail: ord.auditTrail ? [...ord.auditTrail, fillEvt] : [fillEvt],
              };
            }

            // Se for VENDA pendente e o preço subiu até o preço limite da entrada (ou acima)
            if (ord.type === 'SELL' && tick.price >= ord.limitPrice) {
              changed = true;
              setLatestToast({
                id: `fill-toast-${Date.now()}`,
                type: 'SELL',
                title: `🎯 VENDA ACIONADA NO RETESTE DA ENTRADA!`,
                description: `O preço subiu e executou a venda a ${ord.limitPrice.toLocaleString('pt-BR')} pts (Abertura do Box)!`,
                timestamp: Date.now(),
              });
              const fillEvt = OrderAuditService.createEvent(
                'ORDER_FILLED',
                'Ordem Executada no Reteste (VENDA)',
                `Preço subiu para a abertura do box e executou a venda em ${ord.limitPrice} pts.`,
                ord.limitPrice,
                ord.contracts
              );
              return {
                ...ord,
                status: 'OPEN' as const,
                entryPrice: ord.limitPrice,
                fillTimestamp: Date.now(),
                fillTimeStr: new Date().toTimeString().split(' ')[0],
                triggerReason: `Executado no Reteste da Entrada (${ord.limitPrice} pts)`,
                auditTrail: ord.auditTrail ? [...ord.auditTrail, fillEvt] : [fillEvt],
              };
            }

            // Se o preço se afastou sem voltar e ultrapassou a validade
            if (ord.pendingBoxIndex !== undefined && currentBoxIdx - ord.pendingBoxIndex >= config.pullbackMaxBoxesWait) {
              changed = true;
              const expEvt = OrderAuditService.createEvent(
                'ORDER_EXPIRED',
                'Validade da Ordem Expirada',
                `Preço se afastou ${config.pullbackMaxBoxesWait} boxes sem retornar ao patamar de ${ord.limitPrice} pts.`,
                tick.price,
                ord.contracts
              );
              return {
                ...ord,
                status: 'EXPIRED_PULLBACK' as const,
                exitTimestamp: Date.now(),
                exitTimeStr: new Date().toTimeString().split(' ')[0],
                exitReason: 'EXPIRED_PULLBACK' as const,
                triggerReason: 'Expirada: Preço continuou sem retornar para testar a entrada.',
                auditTrail: ord.auditTrail ? [...ord.auditTrail, expEvt] : [expEvt],
              };
            }

            return ord;
          }

          // SE FOR POSIÇÃO ABERTA (VERIFICA PARCIAL, TRAILING STOP, SL E TP)
          if (ord.status === 'OPEN') {
            const isBuy = ord.type === 'BUY';
            const curPrice = tick.price;
            // Parcial e Trailing são exclusivos da estratégia Reteste; na Pirâmide só valem TP/stop próprios
            const isPyramidMode = config.strategyMode === 'PYRAMID_FLOW_CONFLUENCE';

            // 0. TRAVA DE FIM DE PREGÃO (hora da estratégia): liquida a posição a mercado — nenhuma
            // ordem do simulador atravessa o fechamento do WIN$N (17:45), senão fica pendurada para sempre
            if (sessionLock) {
              changed = true;
              dayClosedCount += 1;
              const points = isBuy ? curPrice - ord.entryPrice : ord.entryPrice - curPrice;
              const activeCtros = ord.remainingContracts || ord.contracts;
              const fin = pointsToBRL(points, activeCtros, asset) + (ord.partialFinancial || 0);

              const lockEvt = OrderAuditService.createEvent(
                'DAY_CLOSE_FORCED',
                `Fechamento obrigatório do pregão (${points >= 0 ? '+' : ''}${points} pts)`,
                `Trava das ${closeLockLabel}: posição ${ord.role === 'MAIN' ? 'principal (surfe)' : `pirâmide #${ord.pyramidLevel || 1}`} liquidada a mercado a ${curPrice} pts antes do encerramento do WIN$N. Resultado: R$ ${fin.toFixed(2)}.`,
                curPrice,
                activeCtros
              );

              return {
                ...ord,
                status: fin >= 0 ? ('CLOSED_PROFIT' as const) : ('CLOSED_LOSS' as const),
                exitPrice: curPrice,
                exitTimestamp: Date.now(),
                exitTimeStr: new Date().toTimeString().split(' ')[0],
                exitReason: 'DAY_CLOSE' as const,
                pointsResult: points,
                financialResult: fin,
                auditTrail: ord.auditTrail ? [...ord.auditTrail, lockEvt] : [lockEvt],
              };
            }

            // 1. CHECAGEM DE REALIZAÇÃO PARCIAL
            if (!isPyramidMode && config.enablePartialExit && !ord.partialExecuted && ord.contracts > 1) {
              const reachedPartial = isBuy
                ? curPrice >= ord.entryPrice + config.partialPoints
                : curPrice <= ord.entryPrice - config.partialPoints;

              if (reachedPartial) {
                changed = true;
                const partialCtros = Math.min(config.partialContracts, ord.contracts - 1);
                const pts = config.partialPoints;
                const partialFin = pointsToBRL(pts, partialCtros, asset);
                const remaining = ord.contracts - partialCtros;

                // Move Stop Loss para Breakeven (+ offset de segurança) se configurado
                const newSL = config.moveStopToBreakevenOnPartial
                  ? isBuy
                    ? ord.entryPrice + config.breakevenOffsetPoints
                    : ord.entryPrice - config.breakevenOffsetPoints
                  : ord.stopLoss;

                setLatestToast({
                  id: `partial-toast-${Date.now()}`,
                  type: ord.type,
                  title: `🎯 SAÍDA PARCIAL EXECUTADA (+${pts} pts)!`,
                  description: `${partialCtros} contrato(s) realizado(s) com lucro de R$ ${partialFin.toFixed(2)}. ${
                    config.moveStopToBreakevenOnPartial ? 'Stop Loss movido para o Breakeven protegido!' : ''
                  }`,
                  timestamp: Date.now(),
                });

                if (mt5State.status === 'CONNECTED' && wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
                  wsRef.current.send(
                    JSON.stringify({
                      action: 'ORDER_PARTIAL_CLOSE',
                      ticket: ord.ticket,
                      partialVolume: partialCtros,
                      newSL: config.moveStopToBreakevenOnPartial ? newSL : undefined,
                    })
                  );
                }

                const partialEvt = OrderAuditService.createEvent(
                  'PARTIAL_FILLED',
                  `Saída Parcial Concluída (+${pts} pts)`,
                  `${partialCtros} contrato(s) realizado(s) com lucro de R$ ${partialFin.toFixed(2)}. Restante: ${remaining} contrato(s).`,
                  isBuy ? ord.entryPrice + config.partialPoints : ord.entryPrice - config.partialPoints,
                  partialCtros
                );

                const newAuditTrail = ord.auditTrail ? [...ord.auditTrail, partialEvt] : [partialEvt];
                if (config.moveStopToBreakevenOnPartial) {
                  newAuditTrail.push(
                    OrderAuditService.createEvent(
                      'BREAKEVEN_MOVED',
                      'Stop Loss Movido para o Breakeven',
                      `SL protegido em ${newSL} pts (+${config.breakevenOffsetPoints} pts offset taxas B3).`,
                      newSL
                    )
                  );
                }

                return {
                  ...ord,
                  partialExecuted: true,
                  partialPrice: isBuy ? ord.entryPrice + config.partialPoints : ord.entryPrice - config.partialPoints,
                  partialPoints: pts,
                  partialFinancial: partialFin,
                  partialTimestamp: Date.now(),
                  remainingContracts: remaining,
                  stopLoss: newSL,
                  isBreakevenActive: config.moveStopToBreakevenOnPartial,
                  auditTrail: newAuditTrail,
                };
              }
            }

            // 2. CHECAGEM DE TRAILING STOP DINÂMICO
            // Duas etapas: o GATILHO dispara a proteção (piso na entrada + offset das taxas) e
            // depois o ACCOMPANHAMENTO arrasta o stop sempre a N pts da máxima/mínima da perna.
            // Na Pirâmide vale só para a ORDEM MÃE (as pirâmides morrem no próprio TP).
            let currentSL = ord.stopLoss;
            let beActive = ord.isBreakevenActive;
            let curHigh = ord.highestPriceSinceEntry || ord.entryPrice;
            let curLow = ord.lowestPriceSinceEntry || ord.entryPrice;

            const trailApplies = config.trailingStop && (!isPyramidMode || ord.role === 'MAIN');
            if (trailApplies) {
              const actPts = config.trailingActivationPoints ?? 60;
              const distPts = config.trailingDistancePoints ?? 50;
              const offsetPts = config.breakevenOffsetPoints ?? 0;
              if (isBuy) {
                curHigh = Math.max(curHigh, curPrice);
                if (curHigh - ord.entryPrice >= actPts) {
                  // piso do gatilho (entrada + offset) ou o rastro da máxima — vale o que proteger mais
                  const trailTarget = Math.max(ord.entryPrice + offsetPts, curHigh - distPts);
                  // sem stop fixo (0) é o próprio trailing que coloca o primeiro stop da operação
                  if (trailTarget > 0 && (currentSL <= 0 || trailTarget > currentSL)) {
                    currentSL = trailTarget;
                    beActive = true;
                    changed = true;
                  }
                }
              } else {
                curLow = Math.min(curLow, curPrice);
                if (ord.entryPrice - curLow >= actPts) {
                  const trailTarget = Math.min(ord.entryPrice - offsetPts, curLow + distPts);
                  if (trailTarget > 0 && (currentSL <= 0 || trailTarget < currentSL)) {
                    currentSL = trailTarget;
                    beActive = true;
                    changed = true;
                  }
                }
              }
            }

            // 3. CHECAGEM DE TAKE PROFIT (apenas se configurado > 0)
            const hitTP = ord.takeProfit > 0 && (isBuy ? curPrice >= ord.takeProfit : curPrice <= ord.takeProfit);
            if (hitTP) {
              changed = true;
              const points = isBuy ? ord.takeProfit - ord.entryPrice : ord.entryPrice - ord.takeProfit;
              const activeCtros = ord.remainingContracts || ord.contracts;
              const fin = pointsToBRL(points, activeCtros, asset) + (ord.partialFinancial || 0);
              const isPyr = ord.role === 'PYRAMID';
              // TP da pirâmide batido → liberar a proteção da ordem mãe no breakeven
              const protectMainOnBE =
                isPyr && isPyramidMode && config.moveMainToBreakevenOnPyramidTp === true;
              if (protectMainOnBE && ord.type) {
                breakevenMainDirs.push(ord.type);
              }

              const tpEvt = OrderAuditService.createEvent(
                'TAKE_PROFIT_HIT',
                isPyr
                  ? `TP da Pirâmide #${ord.pyramidLevel || 1} Atingido (+${points} pts)`
                  : `Take Profit Atingido (+${points} pts)`,
                `Alvo alcançado e liquidado a ${ord.takeProfit} pts. Lucro: R$ ${fin.toFixed(2)}. ${
                  isPyr
                    ? protectMainOnBE
                      ? 'Entrada principal segue surfando com o stop protegido no breakeven.'
                      : 'A entrada principal continua aberta surfando a perna!'
                    : ''
                }`,
                ord.takeProfit,
                activeCtros
              );

              setLatestToast({
                id: `tp-toast-${Date.now()}`,
                type: ord.type,
                title: isPyr ? `🎯 TP PIRÂMIDE (+${points} pts)!` : `🎯 TAKE PROFIT BATIDO (+${points} pts)!`,
                description: `${isPyr ? `Ordem da pirâmide #${ord.pyramidLevel || 1}` : 'Operação'} liquidada com lucro de R$ ${fin.toFixed(2)}. ${
                  isPyr
                    ? config.moveMainToBreakevenOnPyramidTp
                      ? 'Ordem mãe segue surfando com o stop protegido no breakeven!'
                      : 'Ordem mãe segue aberta surfando!'
                    : ''
                }`,
                timestamp: Date.now(),
              });

              return {
                ...ord,
                status: 'CLOSED_PROFIT' as const,
                exitPrice: ord.takeProfit,
                exitTimestamp: Date.now(),
                exitTimeStr: new Date().toTimeString().split(' ')[0],
                exitReason: 'TAKE_PROFIT' as const,
                pointsResult: points,
                financialResult: fin,
                auditTrail: ord.auditTrail ? [...ord.auditTrail, tpEvt] : [tpEvt],
              };
            }

            // 4. CHECAGEM DE STOP LOSS (apenas se configurado > 0)
            const hitSL = currentSL > 0 && (isBuy ? curPrice <= currentSL : curPrice >= currentSL);
            if (hitSL) {
              changed = true;
              const points = isBuy ? currentSL - ord.entryPrice : ord.entryPrice - currentSL;
              const activeCtros = ord.remainingContracts || ord.contracts;
              const fin = pointsToBRL(points, activeCtros, asset) + (ord.partialFinancial || 0);
              const isBE = ord.isBreakevenActive && fin >= 0;

              const slEvt = OrderAuditService.createEvent(
                'STOP_LOSS_HIT',
                isBE ? `Saída Protegida no Breakeven (${points >= 0 ? '+' : ''}${points} pts)` : `Stop Loss Atingido (${points} pts)`,
                `Executada saída de contenção de risco a ${currentSL} pts. Resultado: R$ ${fin.toFixed(2)}.`,
                currentSL,
                activeCtros
              );

              return {
                ...ord,
                status: fin >= 0 ? ('CLOSED_PROFIT' as const) : ('CLOSED_LOSS' as const),
                exitPrice: currentSL,
                exitTimestamp: Date.now(),
                exitTimeStr: new Date().toTimeString().split(' ')[0],
                exitReason: isBE ? ('BREAKEVEN' as const) : ('STOP_LOSS' as const),
                pointsResult: points,
                financialResult: fin,
                stopLoss: currentSL,
                auditTrail: ord.auditTrail ? [...ord.auditTrail, slEvt] : [slEvt],
              };
            }

            // Se o Trailing Stop atualizou o SL ou o preço extremo
            if (
              currentSL !== ord.stopLoss ||
              curHigh !== ord.highestPriceSinceEntry ||
              curLow !== ord.lowestPriceSinceEntry
            ) {
              const trailEvt = currentSL !== ord.stopLoss ? [
                OrderAuditService.createEvent(
                  'TRAILING_STOP_MOVED',
                  'Trailing Stop Atualizado',
                  `SL movido para ${currentSL} pts acompanhando nova máxima/mínima.`,
                  currentSL
                )
              ] : [];

              return {
                ...ord,
                stopLoss: currentSL,
                isBreakevenActive: beActive,
                highestPriceSinceEntry: curHigh,
                lowestPriceSinceEntry: curLow,
                auditTrail: trailEvt.length > 0 && ord.auditTrail ? [...ord.auditTrail, ...trailEvt] : ord.auditTrail,
              };
            }
          }

          return ord;
        });

        // 5. BREAKEVEN DA ORDEM MÃE (Pirâmide): a cada TP de pirâmide batido, o stop da mãe
        // sobe/desce para a entrada + offset de taxas, travando o resultado da perna.
        if (breakevenMainDirs.length > 0) {
          const offset = config.breakevenOffsetPoints ?? 0;
          const dirs = new Set(breakevenMainDirs);
          updated = updated.map((ord) => {
            if (ord.status !== 'OPEN' || ord.role !== 'MAIN' || !dirs.has(ord.type)) return ord;
            const isBuy = ord.type === 'BUY';
            const beSL = isBuy ? ord.entryPrice + offset : ord.entryPrice - offset;
            const improves =
              ord.stopLoss <= 0 || (isBuy ? beSL > ord.stopLoss : beSL < ord.stopLoss);
            if (!improves || beSL <= 0) return ord;
            changed = true;
            const beEvt = OrderAuditService.createEvent(
              'BREAKEVEN_MOVED',
              `Ordem Mãe protegida no Breakeven (+${offset} pts)`,
              `TP de uma pirâmide da direção ${isBuy ? 'COMPRA' : 'VENDA'} foi batido. Stop da entrada mãe movido para ${beSL} pts (entrada +${offset} pts de offset para taxas B3).`,
              beSL,
              ord.remainingContracts || ord.contracts
            );

            if (mt5State.status === 'CONNECTED' && wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
              wsRef.current.send(
                JSON.stringify({ action: 'ORDER_MODIFY_SL', ticket: ord.ticket, newSL: beSL })
              );
            }

            return {
              ...ord,
              stopLoss: beSL,
              isBreakevenActive: true,
              auditTrail: ord.auditTrail ? [...ord.auditTrail, beEvt] : [beEvt],
            };
          });
        }

        // Aviso único da trava no tick (não repete para cada ordem liquidada na mesma vez)
        if (dayClosedCount > 0) {
          setLatestToast({
            id: `dayclose-toast-${Date.now()}`,
            type: 'INFO',
            title: `🔒 TRAVA DE FIM DE PREGÃO (${closeLockLabel})`,
            description: `${dayClosedCount} ordem(ns) zerada(s) a mercado a ${tick.price.toLocaleString('pt-BR')} pts. O robô não abre operação nova até o próximo pregão.`,
            timestamp: Date.now(),
          });
        }

        return changed ? updated : prevOrders;
      });
    },
    [config, mt5State.status, chartSeries, rangePoints, timeframeSec]
  );

  // Conexão WebSocket com o MetaTrader 5 (Local Bridge)
  const toggleMT5Connect = useCallback(() => {
    if (mt5State.status === 'CONNECTED' || mt5State.status === 'CONNECTING') {
      if (wsRef.current) {
        wsRef.current.close();
      }
      setMt5State({ status: 'DISCONNECTED' });
      setIsSimulating(true);
      return;
    }

    setMt5State({ status: 'CONNECTING' });
    const host = config.mt5Host || 'localhost';
    const port = config.mt5Port || 8765;
    const wsUrl = `ws://${host}:${port}`;

    try {
      const socket = new WebSocket(wsUrl);
      wsRef.current = socket;

      socket.onopen = () => {
        // Handshake de segurança: a ponte não entrega tick, nem saldo, nem aceita ordem de
        // quem não provar o token no primeiro frame. Sem isso, QUALQUER dispositivo da rede
        // (ou site aberto no navegador) operaria a conta logada no terminal.
        try {
          socket.send(JSON.stringify({ action: 'AUTH', token: getBridgeToken(), armed: config.active }));
        } catch {
          // socket fechado no interim: o onclose/onerror cuida do estado
        }
        setMt5State({
          status: 'CONNECTED',
          brokerCompany: 'MetaTrader 5 Live Bridge',
        });
        setIsSimulating(false); // Pausa simulação quando conectado ao MT5 real
        setLatestToast({
          id: `mt5-conn-${Date.now()}`,
          type: 'BUY',
          title: 'METATRADER 5 CONECTADO COM SUCESSO',
          description: `Ponte ativa em ${wsUrl}. Apresentando o token da ponte...`,
          timestamp: Date.now(),
        });
      };

      // esta conexão respondeu ao handshake AUTH? se não, é script antigo (modo legado)
      let authResultSeen = false;

      socket.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          if (payload.type === 'AUTH_RESULT') {
            authResultSeen = true;
            const ok = Boolean(payload.data?.ok);
            const armed = Boolean(payload.data?.armed);
            const requireToken = Boolean(payload.data?.requireToken);
            setMt5State((prev) => ({ ...prev, bridgeAuthOk: ok, bridgeArmed: armed, bridgeLegacy: !requireToken }));
            if (!ok) {
              setLatestToast({
                id: `mt5-auth-${Date.now()}`,
                type: 'SELL',
                title: '🔒 PONTE RECUSOU O TOKEN',
                description: 'O script .py do PC do MT5 tem um token diferente deste navegador. Gere um token novo em Ajustes > Segurança da Ponte e baixe o script de novo.',
                timestamp: Date.now(),
              });
              if (wsRef.current) wsRef.current.close();
              setMt5State({ status: 'DISCONNECTED' });
              setIsSimulating(true);
              return;
            }
            setLatestToast({
              id: `mt5-auth-${Date.now()}`,
              type: armed ? 'BUY' : 'INFO',
              title: armed ? '🔓 PONTE AUTENTICADA E ARMADA' : '🔒 PONTE AUTENTICADA (EM SEGURO)',
              description: requireToken
                ? armed
                  ? `Token aceito. Tetos da ponte: ${payload.data?.maxContractsPerOrder ?? '?'} ctros por ordem e ${payload.data?.maxOrdersPerMinute ?? '?'} entradas por minuto.`
                  : 'Token aceito, mas o Robô está desligado: a ponte recusa qualquer ordem de ENTRADA até você ligar o robô.'
                : 'O script atual não exige token: ele aceita ordem de qualquer dispositivo da rede. Baixe o script novo em Ajustes > Segurança da Ponte.',
              timestamp: Date.now(),
            });
          } else if (payload.type === 'ACCOUNT_INFO') {
            // script antigo nunca manda AUTH_RESULT: o ACCOUNT_INFO antes denuncia a ponte legado
            if (!authResultSeen) {
              setLatestToast({
                id: `mt5-legacy-${Date.now()}`,
                type: 'INFO',
                title: '⚠️ PONTE SEM AUTENTICAÇÃO (SCRIPT ANTIGO)',
                description: 'Este script .py não exige token: qualquer aparelho da rede pode operar sua conta. Baixe o script novo (Ajustes > Segurança da Ponte) e rode no lugar do antigo.',
                timestamp: Date.now(),
              });
            }
            setMt5State((prev) => ({
              ...prev,
              accountLogin: payload.data.login,
              brokerCompany: payload.data.broker,
              balance: payload.data.balance,
              // Qual contrato o script .py está transmitindo agora: se for outro do que este
              // navegador tem selecionado, o seletor avisa (o histórico real viria do mercado errado)
              scriptSymbol: payload.data?.symbol ?? prev.scriptSymbol,
              bridgeArmed: payload.data.armed ?? prev.bridgeArmed,
              ...(!authResultSeen ? { bridgeAuthOk: true, bridgeLegacy: true } : {}),
            }));
          } else if (payload.type === 'ARM_RESULT') {
            const armed = Boolean(payload.data?.armed);
            setMt5State((prev) => ({ ...prev, bridgeArmed: armed }));
            setLatestToast({
              id: `mt5-arm-${Date.now()}`,
              type: armed ? 'BUY' : 'INFO',
              title: armed ? '🟢 PONTE ARMADA' : '🔒 PONTE EM SEGURO',
              description: armed
                ? 'A ponte do MT5 liberou as ordens de entrada.'
                : 'A ponte do MT5 vai recusar ordens de entrada. Saídas e "zerar terminal" seguem liberados.',
              timestamp: Date.now(),
            });
          } else if (payload.type === 'RISK_REJECT') {
            setLatestToast({
              id: `mt5-reject-${Date.now()}`,
              type: 'SELL',
              title: '⛔ ORDEM RECUSADA PELA PONTE',
              description: `${payload.data?.reason || 'motivo não informado'} — as travas de risco do script .py bloquearam esta ordem.`,
              timestamp: Date.now(),
            });
          } else if (payload.type === 'TICK') {
            handleIncomingTick(payload.data);
          } else if (MarketHistoryService.handles(payload.type)) {
            // HISTÓRICO REAL (Fase 2): chunks/done/erro do pedido feito pelo replay. A correlação,
            // a deduplicação por id e o timeout moram no serviço, não aqui.
            marketHistoryService.ingest(payload);
          } else if (payload.type === 'ORDER_RESULT') {
            setLatestToast({
              id: `mt5-ord-${Date.now()}`,
              type: payload.orderType === 'BUY' ? 'BUY' : 'SELL',
              title: payload.status === 'DONE' ? 'ORDEM EXECUTADA NO MT5' : 'ERRO NO ENVIO MT5',
              description:
                payload.status === 'DONE'
                  ? `Ticket #${payload.ticket} executado a mercado no MetaTrader 5!`
                  : 'Falha ao enviar ordem para o MT5. Verifique margem e conexão.',
              timestamp: Date.now(),
            });
          }
        } catch {
          // Erro de parse ignorado
        }
      };

      socket.onerror = () => {
        setMt5State({
          status: 'ERROR',
          lastError: `Não foi possível conectar em ${wsUrl}. Certifique-se de executar 'python bot_mt5_convergencia_10r.py'`,
        });
        setLatestToast({
          id: `mt5-err-${Date.now()}`,
          type: 'SELL',
          title: 'FALHA NA CONEXÃO COM O MT5',
          description: `Execute o script 'python bot_mt5_convergencia_10r.py' no seu PC para habilitar o servidor local em ${wsUrl}.`,
          timestamp: Date.now(),
        });
        setIsSimulating(true);
      };

      socket.onclose = () => {
        // Nenhum pedido de histórico pode ficar prometendo para sempre sobre uma ponte morta
        marketHistoryService.dispose();
        setMt5State((prev) => ({ ...prev, status: 'DISCONNECTED', bridgeAuthOk: undefined, bridgeArmed: undefined, bridgeLegacy: undefined }));
      };
    } catch {
      setMt5State({ status: 'ERROR', lastError: 'Falha ao instanciar WebSocket.' });
      setIsSimulating(true);
    }
  }, [config.mt5Host, config.mt5Port, config.active, mt5State.status, handleIncomingTick]);

  // Robô ligado/desligado no app decide se a ponte pode ABRIR posição (arm/disarm).
  // Saídas nunca dependem disso: você sempre pode zerar a conta pelo terminal.
  useEffect(() => {
    if (mt5State.status !== 'CONNECTED' || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    try {
      wsRef.current.send(JSON.stringify({ action: config.active ? 'ARM' : 'DISARM' }));
    } catch {
      // conexão caindo: o onclose limpa o estado
    }
  }, [config.active, mt5State.status]);

  // Envio manual de ordem (boleta rápida da tela) com suporte à Pirâmide & Confluência
  const handleManualOrder = (type: 'BUY' | 'SELL') => {
    const entryPrice = currentPrice;
    const ticket = Math.floor(100000 + Math.random() * 900000);

    // Se estiver no modo Pirâmide & Confluência
    if (config.strategyMode === 'PYRAMID_FLOW_CONFLUENCE') {
      const activeSameDir = orders.filter((o) => o.status === 'OPEN' && o.type === type);
      const activeOppDir = orders.filter((o) => o.status === 'OPEN' && o.type !== type);

      // Inversão se houver posições opostas: encerra tudo
      if (activeOppDir.length > 0) {
        handleClosePositions();
      }

      const hasMother = activeSameDir.some((o) => o.role === 'MAIN');
      const role: 'MAIN' | 'PYRAMID' = hasMother ? 'PYRAMID' : 'MAIN';
      const pyrCount = activeSameDir.filter((o) => o.role === 'PYRAMID').length;
      const pyrLevel = pyrCount + 1;
      const contracts = role === 'MAIN' ? config.contracts || 1 : config.pyramidContracts || 1;
      const tp =
        role === 'PYRAMID'
          ? type === 'BUY'
            ? entryPrice + (config.pyramidTpPoints || 50)
            : entryPrice - (config.pyramidTpPoints || 50)
          : 0;
      const sl = 0;

      const orderTitle =
        role === 'MAIN'
          ? `Ordem Mãe de ${type === 'BUY' ? 'COMPRA' : 'VENDA'} (Surfe)`
          : `Pirâmide #${pyrLevel} de ${type === 'BUY' ? 'COMPRA' : 'VENDA'} (+50p Alvo)`;
      const orderDetails =
        role === 'MAIN'
          ? `Ordem mãe aberta em ${entryPrice} pts (${contracts}ct). Sem TP fixo (surfe até reversão) e sem SL fixo (stop na virada do fluxo).`
          : `Pirâmide #${pyrLevel} aberta em ${entryPrice} pts (${contracts}ct) com Alvo Take Profit de +50 pts (${tp} pts).`;

      const manEvt = OrderAuditService.createEvent(
        'ORDER_DISPATCHED',
        orderTitle,
        orderDetails,
        entryPrice,
        contracts
      );

      const newOrder: TradeOrder = {
        id: `manual-${Date.now()}`,
        ticket,
        timestamp: Date.now(),
        timeStr: new Date().toTimeString().split(' ')[0],
        type,
        role,
        pyramidLevel: role === 'PYRAMID' ? pyrLevel : undefined,
        entryPrice,
        contracts,
        stopLoss: sl,
        takeProfit: tp,
        status: 'OPEN',
        source: mt5State.status === 'CONNECTED' ? 'MT5_LIVE' : 'MANUAL',
        magicNumber: config.magicNumber || 101010,
        triggerReason:
          role === 'MAIN'
            ? 'Boleta Rápida · Ordem Mãe de Surfe'
            : `Boleta Rápida · Pirâmide #${pyrLevel} (Alvo +50p)`,
        isRealMT5: mt5State.status === 'CONNECTED',
        auditTrail: [manEvt],
      };

      setOrders((prev) => [newOrder, ...prev]);

      setLatestToast({
        id: newOrder.id,
        type,
        title:
          role === 'MAIN'
            ? `🟢 ORDEM MÃE ${type} EXECUTADA`
            : `🔺 PIRÂMIDE #${pyrLevel} ${type} EXECUTADA`,
        description:
          role === 'MAIN'
            ? `Entrada: ${entryPrice.toLocaleString('pt-BR')} pts · Surfe até reversão`
            : `Entrada: ${entryPrice.toLocaleString('pt-BR')} pts · Alvo TP: ${tp.toLocaleString('pt-BR')} pts (+50p)`,
        timestamp: Date.now(),
      });

      if (mt5State.status === 'CONNECTED' && wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(
          JSON.stringify({
            action: 'ORDER_SEND',
            type,
            contracts,
            sl: 0,
            tp: tp > 0 ? (config.pyramidTpPoints || 50) : 0,
            comment: role === 'MAIN' ? 'MAE_SURFE' : `PIR_${pyrLevel}`,
          })
        );
      }
      return;
    }

    const sl = type === 'BUY' ? entryPrice - config.stopLossPoints : entryPrice + config.stopLossPoints;
    const tp = type === 'BUY' ? entryPrice + config.takeProfitPoints : entryPrice - config.takeProfitPoints;

    const manEvt = OrderAuditService.createEvent(
      'ORDER_DISPATCHED',
      `Ordem Manual de ${type === 'BUY' ? 'COMPRA' : 'VENDA'} Enviada`,
      `Boleta manual rápida disparada a ${entryPrice} pts (${config.contracts} contrato(s)). SL: ${sl} pts | TP: ${tp} pts.`,
      entryPrice,
      config.contracts
    );

    const newOrder: TradeOrder = {
      id: `manual-${Date.now()}`,
      ticket,
      timestamp: Date.now(),
      timeStr: new Date().toTimeString().split(' ')[0],
      type,
      entryPrice,
      contracts: config.contracts,
      stopLoss: sl,
      takeProfit: tp,
      status: 'OPEN',
      source: mt5State.status === 'CONNECTED' ? 'MT5_LIVE' : 'MANUAL',
      magicNumber: 999999,
      triggerReason: `Disparo Manual via Terminal (${config.contracts} ctros)`,
      isRealMT5: mt5State.status === 'CONNECTED',
      auditTrail: [manEvt],
    };

    setOrders((prev) => [newOrder, ...prev]);

    setLatestToast({
      id: newOrder.id,
      type,
      title: `ORDEM ${type === 'BUY' ? 'COMPRA' : 'VENDA'} MANUAL ENVIADA`,
      description: `Entrada: ${entryPrice.toLocaleString('pt-BR')} pts · SL: ${sl} · TP: ${tp}`,
      timestamp: Date.now(),
    });

    // Se conectado ao MT5 Live, envia para execução real
    if (mt5State.status === 'CONNECTED' && wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          action: 'ORDER_SEND',
          type,
          contracts: config.contracts,
          sl: config.stopLossPoints,
          tp: config.takeProfitPoints,
          comment: 'Manual Web Terminal',
        })
      );
    }
  };

  // Executar demonstração ao vivo da estratégia da pirâmide (Ordem Mãe + Pirâmides com alvo +50p)
  const handleExecutePyramidDemo = useCallback(() => {
    const basePrice = Math.round(currentPrice / 50) * 50;
    const motherPrice = basePrice - 50;
    const pyr1Price = basePrice;
    const now = Date.now();

    const demoMother: TradeOrder = {
      id: `ord-mother-${now}`,
      ticket: Math.floor(840000 + Math.random() * 9000),
      role: 'MAIN',
      timestamp: now - 180000,
      timeStr: new Date(now - 180000).toTimeString().split(' ')[0],
      type: 'BUY',
      entryPrice: motherPrice,
      contracts: config.contracts || 1,
      remainingContracts: config.contracts || 1,
      stopLoss: 0,
      takeProfit: 0,
      status: 'OPEN',
      source: 'ROBOT_EA',
      magicNumber: config.magicNumber || 101010,
      triggerReason: 'Virada de Fluxo Heikin-Ashi (Verde) · Ordem Mãe de Surfe',
      auditTrail: [
        OrderAuditService.createEvent(
          'ORDER_DISPATCHED',
          'Ordem Mãe de Surfe Executada',
          `Entrada em ${motherPrice} pts (1 contrato). Sem TP fixo (surfe contínuo até reversão) e sem SL fixo em pontos.`,
          motherPrice,
          config.contracts || 1
        ),
      ],
    };

    const demoPyr1: TradeOrder = {
      id: `ord-pyr-1-${now}`,
      ticket: Math.floor(840000 + Math.random() * 9000),
      role: 'PYRAMID',
      pyramidLevel: 1,
      timestamp: now - 60000,
      timeStr: new Date(now - 60000).toTimeString().split(' ')[0],
      type: 'BUY',
      entryPrice: pyr1Price,
      contracts: config.pyramidContracts || 1,
      remainingContracts: config.pyramidContracts || 1,
      stopLoss: 0,
      takeProfit: pyr1Price + (config.pyramidTpPoints || 50),
      status: 'OPEN',
      source: 'ROBOT_EA',
      magicNumber: config.magicNumber || 101010,
      triggerReason: `Fechamento Box 10R Verde · Pirâmide #1 (Alvo: +${config.pyramidTpPoints || 50}p)`,
      auditTrail: [
        OrderAuditService.createEvent(
          'ORDER_DISPATCHED',
          'Pirâmide #1 Disparada',
          `Entrada em ${pyr1Price} pts com alvo de +50 pontos (TP: ${pyr1Price + 50} pts).`,
          pyr1Price,
          config.pyramidContracts || 1
        ),
      ],
    };

    setOrders((prev) => {
      const closed = prev.filter((o) => o.status !== 'OPEN' && o.status !== 'PENDING_LIMIT');
      const updated = [demoMother, demoPyr1, ...closed];
      OrderAuditService.saveIntradayOrders(updated, asset.id);
      return updated;
    });

    setIsSimulating(true);

    setLatestToast({
      id: `toast-pyr-${now}`,
      type: 'BUY',
      title: '🎯 ESTRATÉGIA PIRÂMIDE EXECUTANDO!',
      description: `Ordem Mãe @ ${motherPrice} pts (surfe) + Pirâmide #1 @ ${pyr1Price} pts (Alvo TP +50p: ${pyr1Price + 50} pts).`,
      timestamp: now,
    });
  }, [currentPrice, config]);

  // Zerar posições abertas
  const handleClosePositions = () => {
    setOrders((prev) =>
      prev.map((o) => {
        if (o.status !== 'OPEN') return o;
        const activeCtros = o.remainingContracts || o.contracts;
        const pts = o.type === 'BUY' ? currentPrice - o.entryPrice : o.entryPrice - currentPrice;
        const fin = pointsToBRL(pts, activeCtros, asset) + (o.partialFinancial || 0);

        const closeEvt = OrderAuditService.createEvent(
          'MANUAL_CLOSED',
          'Encerramento Manual Compulsório',
          `Posição zerada a mercado a ${currentPrice} pts. Resultado obtido: ${pts > 0 ? '+' : ''}${pts} pts (R$ ${fin.toFixed(2)}).`,
          currentPrice,
          activeCtros
        );

        return {
          ...o,
          status: 'CLOSED_MANUAL' as const,
          exitPrice: currentPrice,
          exitTimestamp: Date.now(),
          exitTimeStr: new Date().toTimeString().split(' ')[0],
          exitReason: 'MANUAL' as const,
          pointsResult: pts,
          financialResult: fin,
          auditTrail: o.auditTrail ? [...o.auditTrail, closeEvt] : [closeEvt],
        };
      })
    );

    if (mt5State.status === 'CONNECTED' && wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ action: 'CLOSE_POSITIONS' }));
    }

    setLatestToast({
      id: `close-${Date.now()}`,
      type: 'SELL',
      title: 'POSIÇÕES ZERADAS',
      description: 'Todas as operações abertas foram encerradas a mercado e registradas na auditoria.',
      timestamp: Date.now(),
    });
  };

  // Persistência contínua do livro de auditoria intraday
  useEffect(() => {
    // No replay que "opera" o livro muda a cada bloco: serializar centenas de ordens 25x por
    // segundo travaria a tela — o fim da corrida grava tudo de uma vez (efeito re-executa ao
    // virar isReplaying para false na mesma renderização)
    if (isReplaying) return;
    OrderAuditService.saveIntradayOrders(orders, asset.id);
  }, [orders, isReplaying, asset.id]);

  // Zerar e reiniciar auditoria para novo pregão
  const handleResetAudit = () => {
    OrderAuditService.clearIntradayAudit(asset.id);
    setOrders([]);
    setLatestToast({
      id: `reset-audit-${Date.now()}`,
      type: 'BUY',
      title: 'AUDITORIA ZERADA',
      description: 'Novo pregão iniciado. Livro de ordens limpo para auditoria.',
      timestamp: Date.now(),
    });
  };

  // Loop de simulação em tempo real (quando não conectado ao MT5)
  useEffect(() => {
    if (!isSimulating || isReplaying || mt5State.status === 'CONNECTED') return;

    // Ritmo alinhado ao gerador histórico do replay (2000ms por tick em 1x), para a tela
    // principal obedecer o mesmo compasso dos testes de 1/3/5 dias
    const intervalMs = Math.max(50, Math.floor(2000 / simulationSpeed));
    const timer = setInterval(() => {
      const nextTick = simulatorRef.current.generateNextTick();
      handleIncomingTick(nextTick);
    }, intervalMs);

    return () => clearInterval(timer);
  }, [isSimulating, isReplaying, simulationSpeed, mt5State.status, handleIncomingTick]);

  // Troca manual da série do gráfico: o robô passa a operar nela (Opção A).
  // Posições abertas NÃO são liquidadas automaticamente — apenas avisamos o operador.
  const handleSeriesChange = (s: ChartSeries) => {
    if (s === chartSeries) return;
    setChartSeries(s);
    const label =
      s === 'renko'
        ? 'Pontos (Renko 10R)'
        : s === 'range'
        ? `Range ${rangePoints} pts`
        : `Tempo ${timeframeSec}s`;
    const hasOpen = orders.some((o) => o.status === 'OPEN' || o.status === 'PENDING_LIMIT');
    setLatestToast({
      id: `series-switch-${Date.now()}`,
      type: 'INFO',
      title: `ROBÔ AGORA OPERA: ${label.toUpperCase()}`,
      description: hasOpen
        ? `Atenção: há posições abertas — elas foram mantidas e continuam sendo geridas por SL/TP/virada de fluxo. Os próximos disparos vêm do gráfico ${label}.`
        : `Próximas entradas serão disparadas no fechamento de barras do gráfico ${label}. O coletor de eficiência continua rodando os 3 em paralelo.`,
      timestamp: Date.now(),
    });
  };

  // Replay de histórico sintético (mínimo 1 dia útil, 08:55–17:45) nos gráficos e no
  // coletor de eficiência. NÃO toca ordens reais, auditoria nem MT5 — é um backtest 100%
  // em memória com os mesmos motores de barra do terminal.
  // A corrida é PROGRESSIVA: começa na PRIMEIRA barra e desenha o período inteiro aos
  // poucos, em vez de despejar tudo de uma vez. A velocidade (1x–10x) controla o compasso:
  // 1x ≈ 1min45 para rodar o período (bem lento, dá para acompanhar cada bloco nascendo),
  // 2x ≈ 55s, 5x ≈ 15s e 10x ≈ 5s (modo apresentação). O feed ao vivo em 1x continua no
  // ritmo real de 1 tick a cada 2s (mesmo passo do histórico).
  const [replayProgress, setReplayProgress] = useState<number>(0);
  const replayAbortRef = useRef<(() => void) | null>(null);

  // Velocidade escolhida direto na tira de status: comanda o compasso do replay e o ritmo do
  // feed ao vivo. Antes era chip de ciclo (1x→2x→5x→10x); viraram opções explícitas porque um
  // teste de velocidade precisa SELECIONAR o valor, não clicar até ele aparecer.
  const SPEED_CHOICES = [1, 2, 3, 5, 10];
  // O slider da aba Simulador aceita qualquer valor de 1 a 10: se a velocidade atual não estiver
  // entre os chips, ela entra na lista para a seleção nunca ficar sem nenhum item aceso.
  const speedChoices = SPEED_CHOICES.includes(simulationSpeed) ? SPEED_CHOICES : [...SPEED_CHOICES, simulationSpeed].sort((x, y) => x - y);

  // Resultado da última corrida, congelado na linha de chegada (ver ReplayRunSummary acima).
  const [lastReplay, setLastReplay] = useState<ReplayRunSummary | null>(null);
  const pendingReplayMetaRef = useRef<{
    days: number; speed: number; seed: number; operated: boolean; aborted: boolean;
    source: 'REAL' | 'SYNTHETIC'; volumeSource?: VolumeSource; tickCount: number;
  } | null>(null);
  useEffect(() => {
    if (isReplaying) return;
    const meta = pendingReplayMetaRef.current;
    if (!meta) return;
    pendingReplayMetaRef.current = null;
    // finish() e este efeito caem no MESMO batch do React: aqui `orders` já é o estado final
    // da corrida, incluindo os ticks do último passo (sem isso o resumo ficaria um passo atrás).
    const closedRun = orders.filter(
      (o) => o.status !== 'OPEN' && o.status !== 'PENDING_LIMIT' && (o.exitTimestamp ?? 0) >= sessionStartRef.current
    );
    setLastReplay({
      ...meta,
      pnl: closedRun.reduce((acc, o) => acc + (o.financialResult || 0), 0),
      trades: closedRun.length,
      openCount: orders.filter((o) => o.status === 'OPEN' || o.status === 'PENDING_LIMIT').length,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReplaying]);

  // Atalho na zona SEMPRE visível da tira: em janela estreita a esquerda rola e o grupo do replay
  // (velocidade + seed) sai da vista junto. Este chip mostra os valores atuais e leva até eles.
  const replayGroupRef = useRef<HTMLDivElement | null>(null);
  const revealReplayControls = () => {
    replayGroupRef.current?.scrollIntoView({ behavior: 'smooth', inline: 'start', block: 'nearest' });
  };

  /** Rótulo honesto do volume usado nos ticks reais (decisão 7: sem volume não existe fluxo). */
  const volumeSourceLabel = (v?: VolumeSource): string =>
    v === 'M1_RATE' ? 'volume distribuído das barras de 1min'
    : v === 'NONE' ? 'SEM volume (delta/CVD não sustentam fluxo)'
    : v === 'TICK' ? 'volume do próprio tick'
    : 'volume não informado';

  /**
   * De onde vêm os ticks do replay (Fase 2): com a ponte do MT5 conectada pede HISTÓRICO REAL e só
   * cai no gerador sintético se a corretora não devolver nada — sempre ROTULANDO a origem, porque
   * um backtest inventado lido como mercado real é a pior mentira que esta tela pode contar.
   */
  const resolveReplayTicks = useCallback(
    async (
      targetDays: number,
      seed: number
    ): Promise<{
      ticks: Tick[];
      source: 'REAL' | 'SYNTHETIC';
      volumeSource?: VolumeSource;
      note?: string;
    }> => {
      const synthetic = () =>
        generateHistoricalTicks(targetDays + 1, referencePrice(asset), seed, asset);
      const socket = wsRef.current;
      if (mt5State.status !== 'CONNECTED' || !socket || socket.readyState !== WebSocket.OPEN) {
        return { ticks: synthetic(), source: 'SYNTHETIC' as const };
      }
      try {
        const res = await marketHistoryService.requestHistory({
          reqId: `hist-${Date.now()}`,
          symbol: config.symbol || asset.primarySymbol,
          days: targetDays + 1,
          asset,
          send: (payload) => socket.send(payload),
        });
        if (res.ticks.length === 0) {
          return {
            ticks: synthetic(),
            source: 'SYNTHETIC' as const,
            note: 'O MT5 respondeu ao pedido de histórico, mas devolveu ZERO ticks. O replay rodou em mercado SINTÉTICO — confira a profundidade de histórico da sua conta na corretora.',
          };
        }
        const sufficiency = MarketHistoryService.assessSufficiency(res.ticks);
        const sufficiencyNote =
          sufficiency.verdict === 'SEM_VOLUME'
            ? `Atenção: ${Math.round(sufficiency.zeroVolumePct * 100)}% dos ticks reais chegaram sem volume — CVD, delta e convergência ficam comprometidos neste replay.`
            : sufficiency.verdict === 'VOLUME_BAIXO'
            ? `Atenção: ${Math.round(sufficiency.zeroVolumePct * 100)}% dos ticks reais chegaram sem volume (fluxo parcialmente comprometido).`
            : undefined;
        return {
          ticks: res.ticks,
          source: 'REAL' as const,
          volumeSource: res.volumeSource,
          note: sufficiencyNote,
        };
      } catch (e) {
        return {
          ticks: synthetic(),
          source: 'SYNTHETIC' as const,
          note: `Histórico real indisponível (${e instanceof Error ? e.message : 'erro na ponte'}). O replay rodou no gerador SINTÉTICO.`,
        };
      }
    },
    [asset, config.symbol, mt5State.status]
  );

  const handleReplayHistory = (days: number) => {
    if (isReplaying) return;
    // Tempo mínimo de uma corrida: 1 dia inteiro (nunca "só alguns minutos")
    const replayTargetDays = Math.max(1, Math.min(10, Math.round(days)));
    setReplayDays(replayTargetDays);
    // O replay derruba os gráficos e o coletor e começa um pregão DO ZERO: as ordens antigas
    // ficariam flutuando sobre barras que não existem mais, então zeramos tudo junto (livro de
    // auditoria + posições + PnL da sessão). Com o MT5 conectado NADA é apagado — lá a posição é
    // real na corretora e o replay sintético não tem autoridade sobre ela.
    const zeroedOrders = mt5State.status !== 'CONNECTED';
    if (zeroedOrders) {
      OrderAuditService.clearIntradayAudit(asset.id);
      setOrders([]);
    }
    // Modo "opera": o replay dispara estratégia/ordens/PnL na tela. Só vale em simulação —
    // com a ponte do MT5 ativa o replay alimenta apenas o coletor, para jamais enviar ordem real
    const operate = replayOperates && zeroedOrders;
    if (replayOperates && !zeroedOrders) {
      setLatestToast({
        id: `replay-nooperate-${Date.now()}`,
        type: 'INFO',
        title: 'REPLAY NÃO VAI OPERAR: MT5 CONECTADO',
        description: 'Com a ponte da corretora ativa o replay só alimenta o coletor de eficiência, para jamais disparar ordens reais. Desconecte o MT5 para usar o modo OPERA.',
        timestamp: Date.now(),
      });
    }
    setIsReplaying(true);
    setReplayProgress(0);

    // Cede um frame para a UI mostrar "rodando 0%" antes de gerar os ticks (isso bloqueia um instante)
    window.setTimeout(async () => {
      const engine = engineRef.current;
      const rangeEng = rangeEngineRef.current;
      const timeEng = timeEngineRef.current;
      // Sempre +1 dia anterior de contexto: a abertura do 1º dia-alvo passa a ter o
      // fechamento de ontem como referência na tela (nada é apagado ao virar o dia;
      // os chips 1d/3d/5d continuam contando os dias de replay efetivos).
      // Seed: usa o número travado por você; no AUTO sorteia um pregão novo e mostra o número no
      // resultado da corrida, para você fixá-lo e repetir o MESMO mercado em outra velocidade.
      const seedForRun = replaySeed ?? randomReplaySeed();
      const run = await resolveReplayTicks(replayTargetDays, seedForRun);
      const ticks = run.ticks;
      if (ticks.length === 0) {
        setIsReplaying(false);
        return;
      }
      if (run.note) {
        setLatestToast({
          id: `replay-source-${Date.now()}`,
          type: run.source === 'REAL' ? 'INFO' : 'SELL',
          title: run.source === 'REAL' ? 'HISTÓRICO REAL COM AVISO' : 'REPLAY EM MERCADO SINTÉTICO',
          description: run.note,
          timestamp: Date.now(),
        });
      }

      const tfShortLabel =
        timeframeSec < 60
          ? `${timeframeSec}s`
          : timeframeSec < 3600
          ? `${Math.round(timeframeSec / 60)}min`
          : `${Math.round(timeframeSec / 3600)}h`;
      const renkoScale = renkoScaleLabel(config.boxPoints, asset);

      // Zera os motores e o coletor para o replay limpo (ordens reais preservadas)
      engine.setBoxPoints(config.boxPoints);
      engine.initialize(ticks[0].price, ticks[0].timestamp);
      rangeEng.setRangePoints(rangePoints);
      rangeEng.initialize(ticks[0].price, ticks[0].timestamp);
      timeEng.setIntervalMs(timeframeSec * 1000);
      timeEng.initialize(ticks[0].price, ticks[0].timestamp);
      ALT_RENKO_SCALES.forEach((alt) => altEnginesRef.current[alt.key].initialize(ticks[0].price, ticks[0].timestamp));
      seriesCollectorService.reset();
      seriesCollectorService.beginBatch();
      allTicksRef.current = [];

      // Um tick atravessa os 6 contadores. No modo "OPERA" ele passa pelo MESMO caminho do
      // feed ao vivo (estratégia, ordens, auditoria, PnL e coletor); no modo silencioso só
      // alimenta os contadores do coletor.
      const ingestSilent = (t: Tick) => {
        if (allTicksRef.current.length < 50000) allTicksRef.current.push(t);
        seriesCollectorService.markToMarket(t.price, t.timestamp);
        const r = engine.processTick(t, config);
        if (r.newBoxClosed && r.closedBox) {
          seriesCollectorService.ingest('renko', r.closedBox, engine.getBoxes().slice(0, -1), config, renkoScale, engine.getRegimeMeter());
        }
        rangeEng.getRegimeMeter().setLookbackBoxes(config.regimeLookbackBoxes ?? 20);
        timeEng.getRegimeMeter().setLookbackBoxes(config.regimeLookbackBoxes ?? 20);
        const rr = rangeEng.processTick(t);
        if (rr.newBarClosed && rr.closedBox) {
          annotateActiveBar(rr.closedBox, rangeEng.getBoxes().slice(0, -1), config, `Range ${rangePoints} pts`, rangeEng.getRegimeMeter());
          seriesCollectorService.ingest('range', rr.closedBox, rangeEng.getBoxes().slice(0, -1), config, `${rangePoints} pts`, rangeEng.getRegimeMeter());
        }
        const tr = timeEng.processTick(t);
        if (tr.newBarClosed && tr.closedBox) {
          annotateActiveBar(tr.closedBox, timeEng.getBoxes().slice(0, -1), config, `Tempo ${tfShortLabel}`, timeEng.getRegimeMeter());
          seriesCollectorService.ingest('tempo', tr.closedBox, timeEng.getBoxes().slice(0, -1), config, tfShortLabel, timeEng.getRegimeMeter());
        }
        for (const alt of ALT_RENKO_SCALES) {
          const altEng = altEnginesRef.current[alt.key];
          const ar = altEng.processTick(t, config);
          if (ar.newBoxClosed && ar.closedBox) {
            seriesCollectorService.ingest(alt.key, ar.closedBox, altEng.getBoxes().slice(0, -1), config, `${alt.pts} pts`, altEng.getRegimeMeter());
          }
        }
      };

      const stepFor = (t: Tick) => {
        if (operate) {
          handleIncomingTick(t);
          return;
        }
        ingestSilent(t);
      };

      // Publica o estado até o cursor atual (o React pinta a tela a cada passo, ~25fps)
      const publish = (upto: number) => {
        const last = ticks[Math.max(0, upto - 1)];
        simulatorRef.current.setPrice(last.price);
        setCurrentPrice(last.price);
        setCvd(engine.getCvd());
        setBoxes([...engine.getBoxes()]);
        setCurrentBox(engine.getCurrentBox());
        setRangeBoxes([...rangeEng.getBoxes()]);
        setRangeCurrentBox(rangeEng.getCurrentBox());
        setTimeBoxes([...timeEng.getBoxes()]);
        setTimeCurrentBox(timeEng.getCurrentBox());
      };

      // =======================================================================
      // DIA ANTERIOR ESTÁTICO: o dia de contexto é processado DE UMA VEZ, sem
      // animação e SEM nunca operar (só alimenta os contadores — jamais abre ordem).
      // A animação do replay começa na abertura do dia-alvo, com ontem já desenhado.
      // =======================================================================
      const day0 = new Date(ticks[0].timestamp).getDate();
      let contextEnd = 0;
      while (contextEnd < ticks.length && new Date(ticks[contextEnd].timestamp).getDate() === day0) {
        contextEnd += 1;
      }
      // Se todos os ticks caírem no mesmo dia (não deveria acontecer com +1 dia), não há contexto
      if (contextEnd >= ticks.length) contextEnd = 0;
      for (let i = 0; i < contextEnd; i += 1) ingestSilent(ticks[i]);
      // O motor marca convergência nesses boxes (análise de fluxo), mas o dia de contexto é
      // ESTÁTICO e nunca opera. Sinaliza os boxes já existentes como contexto para o gráfico
      // suprimir as marcas de compra/venda em ontem — só os tijolos crus aparecem.
      const markStaticContext = (arr: { isStaticContext?: boolean }[]) => {
        for (const b of arr) b.isStaticContext = true;
      };
      markStaticContext(engine.getBoxes());
      markStaticContext(rangeEng.getBoxes());
      markStaticContext(timeEng.getBoxes());
      ALT_RENKO_SCALES.forEach((alt) => markStaticContext(altEnginesRef.current[alt.key].getBoxes()));
      publish(contextEnd); // ontem já aparece inteiro na tela, antes de o replay começar

      const STEP_MS = 40; // ~25 atualizações por segundo em 1x
      // 3000 passos de 40ms ≈ 1min45 de reprodução em 1x (seja 1 dia ou 5). Subir esse número
      // deixa o 1x mais lento; o 10x continua rápido porque queima mais ticks por passo
      const BASE_STEPS = 3000;
      // Velocidade escolhida (vale também para o feed ao vivo): mais rápido = mais ticks por passo
      const speed = Math.max(1, Math.min(10, Math.round(simulationSpeed)));
      const stepMs = speed >= 8 ? 16 : speed >= 4 ? 25 : STEP_MS;
      // A animação reproduz apenas os dias-alvo (o contexto já está na tela)
      const replayTicks = ticks.length - contextEnd;
      const chunk = Math.max(2, Math.ceil((replayTicks * speed) / BASE_STEPS));
      let cursor = contextEnd;
      let iters = 0;
      let timerId: number | null = null;
      let done = false;

      const finish = (aborted: boolean) => {
        if (done) return;
        done = true;
        if (timerId !== null) clearTimeout(timerId);
        replayAbortRef.current = null;
        seriesCollectorService.endBatch();
        if (!operate) allTicksRef.current = ticks.slice(0, Math.max(cursor, contextEnd)); // no modo opera o próprio feed monta o buffer
        publish(cursor);
        setReplayProgress(0);
        setIsReplaying(false);
        // Meta da corrida (dias/velocidade/seed/modo). O PnL em si é somado no efeito de
        // [isReplaying], porque aqui o `orders` deste fechamento ainda não foi commitado.
        pendingReplayMetaRef.current = {
          days: replayTargetDays, speed, seed: seedForRun, operated: operate, aborted,
          source: run.source, volumeSource: run.volumeSource, tickCount: ticks.length,
        };
        setLatestToast({
          id: `replay-${Date.now()}`,
          type: 'INFO',
          title: aborted
            ? `REPLAY INTERROMPIDO: ${cursor.toLocaleString('pt-BR')} DE ${ticks.length.toLocaleString('pt-BR')} TICKS`
            : `REPLAY CONCLUÍDO: ${replayTargetDays} DIA(S) DE HISTÓRICO`,
          description: `${
            aborted
              ? `${Math.max(0, cursor - contextEnd).toLocaleString('pt-BR')} ticks do dia-alvo já reproduzidos ficaram no gráfico e no coletor; o feed ao vivo retoma do último preço.`
              : `${replayTicks.toLocaleString('pt-BR')} ticks ${
                  run.source === 'REAL' ? 'REAIS do MT5' : 'sintéticos do dia-alvo (sessões 08:55–17:45)'
                } rodaram da abertura até o fim do período, com o dia anterior desenhado estático como contexto.`
          } ${
            run.source === 'REAL'
              ? `Fonte: HISTÓRICO REAL (MT5) · ${volumeSourceLabel(run.volumeSource)}.`
              : `Seed do pregão: #${seedForRun}.`
          } Velocidade ${speed}x.${operate ? '' : ' Replay silencioso (OPERA desligado): não abriu ordem nenhuma.'} ${
            zeroedOrders
              ? ' Ordens abertas, auditoria e PnL da sessão foram zerados antes de começar (nada de real é enviado à corretora).'
              : ' MT5 conectado: suas posições reais foram preservadas.'
          }`,
          timestamp: Date.now(),
        });
      };

      const step = () => {
        const upto = Math.min(ticks.length, cursor + chunk);
        for (; cursor < upto; cursor += 1) stepFor(ticks[cursor]);
        publish(upto);
        // O buffer de ticks (contador da tela Simulador e repick das séries) sincroniza a cada
        // ~10 passos — copiar dezenas de milhares de ticks 25x por segundo sairia caro.
        // No modo OPERA quem preenche o buffer é o próprio handleIncomingTick.
        if (!operate && (iters % 10 === 0 || upto >= ticks.length)) allTicksRef.current = ticks.slice(0, upto);
        iters += 1;
        setReplayProgress(Math.round(((upto - contextEnd) / Math.max(1, replayTicks)) * 100));
        if (upto >= ticks.length) {
          finish(false);
          return;
        }
        timerId = window.setTimeout(step, stepMs);
      };

      replayAbortRef.current = () => finish(true);
      step();
    }, 60);
  };

  // Parar a reprodução no meio do caminho (o período já desenhado fica na tela e no coletor)
  const handleStopReplay = () => {
    replayAbortRef.current?.();
  };

  // Se a página fechar/HMR desmontar o App no meio do replay, encerra o timer restante
  useEffect(() => () => { replayAbortRef.current?.(); }, []);

  // ABRIU A PLATAFORMA → dispara o simulador sozinho com o replay (mínimo 1 dia), desenhando
  // o período desde a primeira barra e zerando as ordens do pregão anterior. A única coisa que
  // pula a corrida automática é o coletor já ter DADO REAL do MT5 neste dia — aí ninguém apaga
  // uma coleta verdadeira; o ▶ da tira de status continua disponível para rodar manualmente.
  const bootReplayDoneRef = useRef<boolean>(false);
  useEffect(() => {
    if (bootReplayDoneRef.current) return;
    bootReplayDoneRef.current = true;
    if (seriesCollectorService.hasRealData()) {
      setLatestToast({
        id: `boot-replay-skipped-${Date.now()}`,
        type: 'INFO',
        title: 'REPLAY AUTOMÁTICO PULADO: DADO REAL DE HOJE',
        description: 'O coletor já registrou ticks do MT5 neste dia, então a plataforma não zerou nada. Para rodar um dia sintético mesmo assim, use a setinha da tira de status (isso zera ordens e coletor).',
        timestamp: Date.now(),
      });
      return;
    }
    const timer = setTimeout(() => handleReplayHistory(replayDays), 400);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // AVISO DA CONVERSÃO DA TRAVA DE HORÁRIO: a migração roda no initializer do `config` (antes de
  // qualquer efeito) e devolve o que ela tocou. Só aparece na primeira abertura depois dessa regra
  // e só fala de quem estava na janela antiga INTACTA — estratégia ajustada por você nunca é aberta.
  useEffect(() => {
    const m = windowMigrationRef.current;
    if (!m || (!m.config && m.strategies === 0)) return;
    const timer = setTimeout(() => {
      setLatestToast({
        id: `window-migration-${Date.now()}`,
        type: 'INFO',
        title: `TRAVA DE HORÁRIO: LIBERADO DAS 08:55 ÀS 17:30`,
        description: `${[
          m.config ? 'A estratégia ativa' : '',
          m.strategies > 0 ? `${m.strategies} estratégia(s) salvas do Estúdio` : '',
        ]
          .filter(Boolean)
          .join(' e ')} estavam na janela antiga sem nenhum ajuste e foram convertidas: entradas das 08:55 às 17:30 (leilão à vista, EA livre desde o 1º candle) e zeragem compulsória às 17:30. Valores que você tinha mexido ficaram intactos.`,
        timestamp: Date.now(),
      });
    }, 600);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // AVISO DA TROCA DO PREÇO DE REFERÊNCIA DO ATIVO: roda uma única vez por versão de flag e só
  // fala se havia ordem presa no preço antigo. Sai depois do aviso da trava de horário de propósito
  // (1,4s), porque a tela mostra um toast por vez — o que ficou por último é este.
  useEffect(() => {
    const m = assetMigrationRef.current;
    if (!m || m.discarded === 0) return;
    const timer = setTimeout(() => {
      setLatestToast({
        id: `asset-migration-${Date.now()}`,
        type: 'INFO',
        title: `PREÇO DE REFERÊNCIA ATUALIZADO: ${asset.label} EM ${m.baseFormatted} PTS`,
        description: `${m.discarded} ordem(ns) do pregão salvo estava(m) aberta(s) em preço de outro nível de mercado e deixou(m) de ser posição viva (encerrada(s) manual, sem efeito no PnL). O histórico continua na auditoria. Conecte o MT5 para reconstruir o histórico real deste contrato.`,
        timestamp: Date.now(),
      });
    }, 1400);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // AVISO DA SELEÇÃO DE ATIVO (Fase 2): a migração também roda no initializer do `config` e só
  // toca registro que não tinha `assetId` nem contrato reconhecível. Vai por último na fila
  // (2,2s) porque a tela mostra um toast por vez.
  useEffect(() => {
    const m = assetSelectionRef.current;
    if (!m || (!m.config && m.strategies === 0 && !m.auditCopied)) return;
    const timer = setTimeout(() => {
      const who = [
        m.config ? 'A estratégia ativa' : '',
        m.strategies > 0 ? `${m.strategies} estratégia(s) do Estúdio` : '',
      ]
        .filter(Boolean)
        .join(' e ');
      setLatestToast({
        id: `asset-selection-migration-${Date.now()}`,
        type: 'INFO',
        title: 'SELETOR DE ATIVO DISPONIBILIZADO',
        description: [
          who ? `${who} passaram a guardar o ativo escolhido (WIN) e o código do contrato.` : '',
          m.auditCopied
            ? 'O livro de auditoria ganhou uma prateleira por mercado (o conteúdo antigo foi copiado para WIN, nada apagado).'
            : '',
        ]
          .filter(Boolean)
          .join(' '),
        timestamp: Date.now(),
      });
    }, 2200);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Avançar 1 tick manual
  const handleStepTick = () => {
    const nextTick = simulatorRef.current.generateNextTick();
    handleIncomingTick(nextTick);
  };

  // Injetar onda institucional (para testar convergência)
  const handleInjectLargeAggression = (type: 'BUY' | 'SELL') => {
    const now = Date.now();
    const currentP = simulatorRef.current.getPrice();
    const isBuy = type === 'BUY';
    // Uma variação mínima do ativo por tick injetado (WIN: 5 pts)
    const step = asset.tickSize;

    for (let i = 0; i < 6; i++) {
      const p = isBuy ? currentP + i * step : currentP - i * step;
      simulatorRef.current.setPrice(p);
      const tick: Tick = {
        id: `inject-${Date.now()}-${i}`,
        timestamp: now + i * 20,
        timeStr: new Date(now + i * 20).toTimeString().split(' ')[0],
        price: p,
        volume: 65 + i * 15,
        aggressor: isBuy ? 'BUY' : 'SELL',
        buyerBroker: isBuy ? 'BTG Pactual (Institucional)' : 'XP Investimentos',
        sellerBroker: isBuy ? 'Bradesco' : 'UBS Brasil (Institucional)',
      };
      handleIncomingTick(tick);
    }
  };

  // Limpar e reiniciar dados.
  // `assetOverride` (seletor, Fase 2): o config ainda é o ANTIGO quando a troca de ativo chama
  // isto no mesmo handler, então quem manda aqui é o spec passado, não o memo `asset`.
  // `keepAudit`: ao trocar de mercado NUNCA se limpa o livro do ativo antigo — ele é histórico
  // real de outro pregão; só o do ativo novo é que entra em cena.
  const handleResetData = (options?: { assetOverride?: AssetSpec; keepAudit?: boolean }) => {
    const activeAsset = options?.assetOverride ?? asset;
    // A régua é o último preço REAL visto do ativo (se fresco) ou o basePrice do registro.
    const reference = referencePrice(activeAsset);
    const engine = engineRef.current;
    const sim = simulatorRef.current;
    if (options?.assetOverride) {
      engine.setAsset(activeAsset);
      sim.setAsset(activeAsset);
      ALT_RENKO_SCALES.forEach((alt) => altEnginesRef.current[alt.key].setAsset(activeAsset));
    }
    sim.setPrice(reference);
    engine.setBoxPoints(config.boxPoints);
    engine.initialize(reference);
    sessionStartRef.current = Date.now(); // PnL da sessão volta ao zero junto com o reinício
    setTicks([]);
    setBoxes([]);
    setCurrentBox(null);
    setCurrentPrice(reference);
    setCvd(0);
    setOrders([]);
    if (!options?.keepAudit) OrderAuditService.clearIntradayAudit(activeAsset.id);
    // Zera também as séries experimentais (Range e Tempo)
    allTicksRef.current = [];
    rangeEngineRef.current.initialize(reference);
    timeEngineRef.current.initialize(reference);
    ALT_RENKO_SCALES.forEach((alt) => altEnginesRef.current[alt.key].initialize(reference));
    setRangeBoxes([]);
    setRangeCurrentBox(null);
    setTimeBoxes([]);
    setTimeCurrentBox(null);
  };

  /**
   * Escala de Renko que faz sentido no ativo novo (decisão 5 do plano): mantém o `boxPoints`
   * atual se ele é um múltiplo válido da variação mínima E cai na faixa das escalas do spec;
   * senão aplica a escala do meio de `renkoDefaults`. No WIN de hoje (50 pts, faixa 25-100)
   * nada muda; no WDO (faixa 2-10, tick 0,5) 50 pts viraria 5 pts com o aviso na tela.
   */
  const nextBoxPointsFor = (current: number, next: AssetSpec): { points: number; changed: boolean } => {
    const tick = next.tickSize > 0 ? next.tickSize : 1;
    const multipleOfTick = Number.isFinite(current / tick) && Math.abs(current / tick - Math.round(current / tick)) < 1e-9;
    const lo = Math.min(...next.renkoDefaults);
    const hi = Math.max(...next.renkoDefaults);
    if (multipleOfTick && current >= lo && current <= hi) return { points: current, changed: false };
    return { points: next.renkoDefaults[Math.floor(next.renkoDefaults.length / 2)] ?? current, changed: true };
  };

  /**
   * SELETOR DE ATIVO (Fase 2). Troca o spec, o símbolo que a ponte usa, a escala de Renko e o
   * livro de auditoria (cada ativo tem o seu). Três regras de segurança, todas de propósito:
   *  - posição aberta BLOQUEIA a troca (liquidar WIN a mercado para operar WDO é dinheiro real);
   *  - spec 'a_confirmar' (WDO/BTC) força o Robô OFF — o R$/ponto ainda não homologado não pode
   *    virar ordem na corretora;
   *  - nada apaga config, estratégias nem histórico do ativo que está saindo.
   */
  const handleSelectAsset = (id: AssetId) => {
    if (id === asset.id) return;
    const next = ASSETS[id];
    if (!next) return;

    const live = orders.filter((o) => o.status === 'OPEN' || o.status === 'PENDING_LIMIT');
    if (live.length > 0) {
      setLatestToast({
        id: `asset-switch-blocked-${Date.now()}`,
        type: 'SELL',
        title: `TROCA DE ATIVO BLOQUEADA: ${live.length} ORDEM(NS) VIVA(S)`,
        description: `${asset.label} tem ${live.length} posição(ões)/limitada(s) em aberto. Zere o pregão antes de passar para ${next.label}: trocar de mercado com posição aberta deixaria uma ordem apontando para outro ativo, em outro R$/ponto.`,
        timestamp: Date.now(),
      });
      return;
    }

    const box = nextBoxPointsFor(config.boxPoints, next);
    const unconfirmed = next.status === 'a_confirmar';
    const updated: AutomationConfig = {
      ...config,
      assetId: id,
      symbol: next.primarySymbol,
      boxPoints: box.points,
      // Ensaio de spec não homologado nunca acorda o Robô (decisão 2 do plano).
      active: unconfirmed ? false : config.active,
      lastSavedTimestamp: Date.now(),
    };
    EaConfigService.saveConfig(updated);
    setConfig(updated);

    // Motores e eixos no preço de referência do ativo novo; o livro é o DELE (persistido à parte).
    handleResetData({ assetOverride: next, keepAudit: true });
    setOrders(OrderAuditService.loadIntradayOrders(next) ?? []);

    const sessionNote =
      updated.tradingStartTime === next.session.open && updated.tradingStopEntriesTime === next.session.close
        ? ''
        : ` A trava de horário continua em ${updated.tradingStartTime}–${updated.tradingStopEntriesTime}, e o pregão de ${next.label} é ${next.session.open}–${next.session.close} (ajustar por ativo vem na Fase 3).`;

    setLatestToast({
      id: `asset-switch-${Date.now()}`,
      type: 'INFO',
      title: unconfirmed ? `🧪 ENSAIO: ${next.label} (SPEC NÃO HOMOLOGADO)` : `ATIVO: ${next.label}`,
      description: `${next.contractNote}. Preço de referência ${formatPrice(referencePrice(next), next)} pts · escala ${formatPrice(box.points, next)} pts (${renkoScaleLabel(box.points, next)})${
        box.changed ? ` — a escala anterior (${config.boxPoints} pts) não fazia sentido neste ativo e foi trocada` : ''
      }.${unconfirmed ? ' Robô deixado OFF e ponte em seguro até você homologar R$/ponto, tick e casas decimais.' : ''}${sessionNote} Conectado ao MT5, baixe o script de novo: ele grava o símbolo na hora de subir a ponte.`,
      timestamp: Date.now(),
    });
  };

  // Estatísticas calculadas — contam SÓ o que foi fechado nesta abertura da página
  // (o livro de ordens continua persistido para a auditoria, mas o PnL do canto
  // direito zera a cada reinício para não confundir com resultados de sessões passadas)
  const sessionStartRef = React.useRef<number>(Date.now());
  const stats: TerminalStats = React.useMemo(() => {
    const closed = orders.filter(
      (o) => o.status !== 'OPEN' && o.status !== 'PENDING_LIMIT' && (o.exitTimestamp ?? 0) >= sessionStartRef.current
    );
    const winning = closed.filter((o) => (o.financialResult || 0) > 0);
    const losing = closed.filter((o) => (o.financialResult || 0) < 0);
    const totalWinR = winning.reduce((acc, o) => acc + (o.financialResult || 0), 0);
    const totalLossR = Math.abs(losing.reduce((acc, o) => acc + (o.financialResult || 0), 0));
    const netFin = closed.reduce((acc, o) => acc + (o.financialResult || 0), 0);
    const totalPts = closed.reduce((acc, o) => acc + (o.pointsResult || 0), 0);

    const winRate = closed.length > 0 ? (winning.length / closed.length) * 100 : 0;
    const profitFactor = totalLossR > 0 ? totalWinR / totalLossR : totalWinR > 0 ? 9.99 : 0;
    const convergencesCount = boxes.filter((b) => b.isConvergence || b.convergenceType?.includes('CONVERGENCE')).length;

    return {
      totalTrades: closed.length,
      winningTrades: winning.length,
      losingTrades: losing.length,
      winRate,
      totalPoints: totalPts,
      netFinancial: netFin,
      profitFactor,
      maxDrawdown: 100,
      convergencesDetected: convergencesCount,
    };
  }, [orders, boxes]);

  /**
   * Envio de ENTRADA à ponte, idempotente por tick: o updater de setOrders pode ser
   * reinvocado pelo React para o mesmo tick, e cada tick só pode gerar uma ordem real.
   * Saídas (CLOSE_POSITIONS) nunca passam por aqui — zerar sempre é permitido.
   */
  const bridgeEntrySentRef = useRef<number>(0);
  const sendEntryToBridgeOnce = (tickTimestamp: number, payload: Record<string, unknown>) => {
    if (mt5State.status !== 'CONNECTED' || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    if (bridgeEntrySentRef.current === tickTimestamp) return;
    bridgeEntrySentRef.current = tickTimestamp;
    wsRef.current.send(JSON.stringify(payload));
  };

  // Trava destravada (novo pregão, replay, resete): libera um novo anúncio na próxima vez que bater
  useEffect(() => {
    if (!sessionFinancialLock(orders, config, sessionStartRef.current)) {
      financialLockAnnouncedRef.current = null;
    }
  }, [orders, config]);

  const openOrders = React.useMemo(() => {
    return orders.filter((o) => o.status === 'OPEN' || o.status === 'PENDING_LIMIT');
  }, [orders]);

  // =========================================================================
  // NÍVEIS RELEVANTES DO PREGÃO (leilão, abertura, máx/mín + fechamento e ajuste do dia anterior)
  // e a CURVA DE VWAP do dia. Recalculados a cada 2s a partir do buffer completo de ticks
  // (allTicksRef), e não a cada tick: o buffer chega a 50.000 entradas e esses níveis se movem
  // devagar — 2 segundos é imperceptível para referência visual e custa uma fração do re-render.
  // =========================================================================
  const [sessionLevels, setSessionLevels] = useState<PriceLevel[]>([]);
  const [vwapCurve, setVwapCurve] = useState<VwapCurve>({ points: [], current: null });
  // A curva é amostrada nos tijolos da série que está na tela (Pontos / Range / Tempo): gráfico e
  // curva têm de concordar sobre qual é o "tijolo i". Um ref guarda a série ativa para o intervalo.
  const activeBoxesRef = useRef<{ timeEnd: number }[]>([]);
  useEffect(() => {
    activeBoxesRef.current =
      chartSeries === 'renko' ? boxes : chartSeries === 'range' ? rangeBoxes : timeBoxes;
  }, [chartSeries, boxes, rangeBoxes, timeBoxes]);

  useEffect(() => {
    const recompute = () => {
      const buffer = allTicksRef.current;
      const next = computeSessionLevels(buffer, asset);
      setSessionLevels((prev) =>
        prev.length === next.length && JSON.stringify(prev) === JSON.stringify(next) ? prev : next
      );

      const nextCurve = computeRunningVwap(buffer, activeBoxesRef.current);
      // Assinatura barata: mesma quantidade de pontos e mesma VWAP corrente = nada mudou na tela.
      setVwapCurve((prev) =>
        prev.points.length === nextCurve.points.length && prev.current === nextCurve.current
          ? prev
          : nextCurve
      );
    };
    recompute();
    const id = setInterval(recompute, 2000);
    return () => clearInterval(id);
  }, [asset]);

  // Auto-dismiss toast
  useEffect(() => {
    if (!latestToast) return;
    const t = setTimeout(() => {
      setLatestToast(null);
    }, 4500);
    return () => clearTimeout(t);
  }, [latestToast]);

  // =========================================================================
  // DIAGNÓSTICO DOS PORTÕES DE ORDEM: com o MT5 conectado o robô obedece o tick real da
  // corretora e nenhum dos portões abaixo age. Em simulação o espelho chama as MESMAS funções
  // do portão real, medindo na HORA DO MERCADO (timestamp do último tick) — não no relógio de
  // parede. Era isso que fazia o chip acusar "FORA DA JANELA" no meio de um replay das 10h, dando
  // a impressão de trava invertida: o replay roda hora de pregão, o relógio da sala é outro.
  // =========================================================================
  const marketClockTs = ticks.length > 0 ? ticks[0].timestamp : Date.now();
  const marketClockHM = new Date(marketClockTs).toTimeString().slice(0, 5);
  const closeLockLabel = sessionCloseLockLabel(config.tradingCloseAllTime);
  const gateReasons: string[] = [];
  const finLockNow = sessionFinancialLock(orders, config, sessionStartRef.current);
  if (mt5State.status !== 'CONNECTED') {
    if (config.tradingHoursEnabled) {
      if (parseHHMM(config.tradingStartTime) === null || parseHHMM(config.tradingStopEntriesTime) === null) {
        // O portão falha ABERTO com horário ilegível (campo HH:MM vazio ou digitado errado), então o
        // robô segue operando — mas o operador precisa saber que a janela não está valendo.
        gateReasons.push(`JANELA IGNORADA: horário da estratégia fora de HH:MM (${config.tradingStartTime}–${config.tradingStopEntriesTime})`);
      } else if (!isWithinTradingWindow(marketClockTs, config)) {
        gateReasons.push(`FORA DA JANELA DE ENTRADAS ${config.tradingStartTime}–${config.tradingStopEntriesTime} · hora do pregão: ${marketClockHM}`);
      }
    }
    if (isSessionCloseLock(marketClockTs, config.tradingCloseAllTime)) {
      gateReasons.push(`TRAVA DE PREGÃO às ${closeLockLabel}: nenhum sinal novo e tudo o que estiver aberto é liquidado · hora do pregão: ${marketClockHM}`);
    }
  }
  const blocksEntries = !config.active || finLockNow !== null || gateReasons.length > 0;

  // A ponte do MT5 transmite UM contrato, escolhido no script .py baixado. Se este navegador
  // selecionou outro ativo sem o operador gerar o script de novo, tick ao vivo e histórico real
  // viriam do mercado errado — por isso o seletor recebe esta checagem (undefined = sem info).
  const mt5SymbolOk =
    mt5State.status === 'CONNECTED' && mt5State.scriptSymbol
      ? asset.prefixes.some((p) => (mt5State.scriptSymbol ?? '').toUpperCase().startsWith(p))
      : undefined;

  return (
    <div className="flex flex-col h-[100dvh] w-screen bg-[#0a0a0a] text-slate-100 overflow-hidden font-sans">
      {/* Top Bar seguindo o contrato de 3 zonas */}
      <Header
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        isSimulating={isSimulating}
        setIsSimulating={setIsSimulating}
        robotActive={config.active}
        setRobotActive={(active) => {
          setConfig((prev) => {
            const updated = { ...prev, active, lastSavedTimestamp: Date.now() };
            EaConfigService.saveConfig(updated);
            return updated;
          });
        }}
        lastPrice={currentPrice}
        openOrdersCount={openOrders.length}
        mt5State={mt5State}
        onToggleMT5Connect={toggleMT5Connect}
        currentUser={currentUser}
        onUserChanged={(u) => setCurrentUser(u)}
        onOpenRenewModal={() => setShowRenewModal(true)}
        onOpenPdfModal={() => setShowPdfModal(true)}
        dadosPanelOpen={dadosPanelOpen}
        onToggleDadosPanel={handleToggleDadosPanel}
        boxWindowOpen={boxWindowOpen}
        onToggleBoxWindow={handleToggleBoxWindow}
        asset={asset}
        assetId={asset.id}
        onSelectAsset={handleSelectAsset}
        mt5SymbolOk={mt5SymbolOk}
      />

      {/* Tira de Métricas e Status Rápido — a esquerda rola sozinha e o PnL fica SEMPRE à vista
          (antes, com o replay na linha, o conteúdo estourava a largura e o PnL sumia da tela) */}
      <div className="flex items-center gap-3 px-3 sm:px-6 py-1.5 bg-slate-950 border-b border-slate-900 text-[11px] sm:text-xs shrink-0 font-mono">
        <div className="flex items-center gap-3 sm:gap-6 min-w-0 flex-1 overflow-x-auto no-scrollbar">
          {/* ── REPLAY DO SIMULADOR (discreto, na cor apenas a setinha) ──
              Roda o histórico desde a PRIMEIRA barra (mínimo 1 dia) desenhando o período
              aos poucos; na abertura da plataforma já se dispara sozinho. Clicar de novo para
              parar. O chip "Nx" é a velocidade do replay e do feed ao vivo. */}
          <div
            ref={replayGroupRef}
            className="flex items-center gap-1 shrink-0 rounded-md border border-slate-800 bg-slate-900/70 px-1 py-0.5"
            title="Simulador: reproduz o histórico desde a primeira barra (mínimo 1 dia cheio). Ao abrir a plataforma isso já dispara sozinho, sem precisar da aba Simulador."
          >
            <button
              onClick={() => (isReplaying ? handleStopReplay() : handleReplayHistory(replayDays))}
              className="flex items-center gap-1 rounded border border-slate-800 px-1.5 py-0.5 text-[10px] font-semibold text-slate-300 transition-colors whitespace-nowrap cursor-pointer hover:text-slate-100 hover:border-slate-600"
              title={isReplaying ? `Parar a reprodução (${replayProgress}% rodado)` : `Rodar ${replayDays} dia(s) de simulador agora — zera as ordens e começa na primeira barra`}
            >
              {isReplaying ? (
                <Square className="w-2.5 h-2.5 text-amber-400 fill-amber-400" />
              ) : (
                <Play className="w-3 h-3 text-amber-400 fill-amber-400" />
              )}
              <span className="tabular-nums">{isReplaying ? `${replayProgress}%` : ''}</span>
            </button>
            <div className="flex items-center gap-0.5 shrink-0"
              title={`Velocidade do simulador: comanda o compasso do replay e o ritmo do feed ao vivo (1x ≈ 1min45 para rodar o dia; 2x ≈ 55s, 3x ≈ 35s, 5x ≈ 15s, 10x ≈ 5s).

A velocidade NÃO muda o mercado: com o mesmo seed, todos os ticks são reproduzidos na mesma ordem em qualquer velocidade, então o PnL da corrida tem de sair IDÊNTICO em 1x, 2x, 3x, 5x e 10x. Se mudar com o seed fixo, é bug de determinismo — o chip "Corrida" mostra o seed usado.`}
            >
              {speedChoices.map((s) => (
                <button
                  key={s}
                  onClick={() => setSimulationSpeed(s)}
                  className={`px-1 py-0.5 rounded text-[10px] font-semibold border transition-colors whitespace-nowrap cursor-pointer font-mono ${
                    simulationSpeed === s
                      ? 'border-slate-600 bg-slate-800 text-slate-100'
                      : 'border-transparent text-slate-500 hover:text-slate-300'
                  }`}
                  title={`Rodar em ${s}x — no feed ao vivo isso é ${(2 / s).toFixed(2).replace('.', ',')}s por tick`}
                >
                  {s}x
                </button>
              ))}
            </div>
            {/* Replay OPERA a estratégia (ordens/PnL na tela) x replay silencioso (só coletor) */}
            <button
              onClick={() => setReplayOperates((v) => !v)}
              disabled={isReplaying}
              className={`px-1.5 py-0.5 rounded text-[10px] font-semibold border transition-colors whitespace-nowrap cursor-pointer ${
                replayOperates
                  ? 'border-slate-600 bg-slate-800 text-slate-100'
                  : 'border-slate-800 text-slate-600 hover:text-slate-400'
              } ${isReplaying ? 'opacity-40 cursor-wait' : ''}`}
              title={
                replayOperates
                  ? 'Replay OPERA a estratégia: ao reproduzir o dia ele abre MAE/pirâmides, preenche a auditoria e move o PnL na tela (só em simulação — com o MT5 conectado jamais dispara ordem real). Clique para voltar ao modo silencioso, que alimenta só o coletor. Requer o Robô LIGADO.'
                  : 'Replay silencioso: alimenta apenas o coletor de eficiência. Clique para o replay também operar a estratégia na tela (ordens, auditoria e PnL).'
              }
            >
              OPERA
            </button>
            <div className="flex items-center gap-0.5">
              {[1, 3, 5].map((d) => (
                <button
                  key={d}
                  onClick={() => handleReplayHistory(d)}
                  disabled={isReplaying}
                  className={`px-1 py-0.5 rounded text-[10px] font-semibold border transition-colors whitespace-nowrap cursor-pointer ${
                    replayDays === d
                      ? 'border-slate-700 bg-slate-800 text-slate-100'
                      : 'border-transparent text-slate-500 hover:text-slate-300'
                  } ${isReplaying ? 'opacity-40 cursor-wait' : ''}`}
                  title={`Rodar ${d} dia(s) e lembrar essa escolha para a próxima abertura`}
                >
                  {d}d
                </button>
              ))}
            </div>
            {/* Seed do pregão sintético: é o que torna honesta a comparação entre velocidades */}
            <div className="flex items-center gap-0.5 shrink-0 ml-0.5">
              <button
                onClick={() => setReplaySeed((prev) => (prev === null ? lastReplay?.seed ?? randomReplaySeed() : null))}
                className={`px-1 py-0.5 rounded text-[10px] font-semibold border transition-colors whitespace-nowrap cursor-pointer font-mono ${
                  replaySeed === null
                    ? 'border-transparent text-slate-500 hover:text-slate-300'
                    : 'border-slate-600 bg-slate-800 text-emerald-300'
                }`}
                title={
                  replaySeed === null
                    ? `SEED AUTO: cada corrida sorteia um pregão sintético diferente (o número fica no chip "Corrida"). Clique para FIXAR o seed da última corrida e reproduzir exatamente o mesmo mercado — só assim faz sentido comparar PnL entre velocidades.`
                    : `Pregão sintético FIXO (seed #${replaySeed}): toda corrida reproduz o MESMO mercado, tick por tick. Clique para voltar ao AUTO.`
                }
              >
                {replaySeed === null ? 'SEED AUTO' : `SEED #${replaySeed}`}
              </button>
              {replaySeed !== null && (
                <button
                  onClick={() => setReplaySeed(randomReplaySeed())}
                  className="p-1 rounded text-slate-500 hover:text-slate-200 transition-colors cursor-pointer"
                  title="Sortear outro seed fixo (outro pregão, também reproduzível)"
                >
                  <RefreshCw className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            <span className="text-slate-400">Ativo:</span>
            <span className="text-slate-100 font-bold">{config.symbol || asset.primarySymbol}</span>
            <span className="text-emerald-400 font-semibold">{currentPrice.toLocaleString('pt-BR')} pts</span>
            {/* Spec não homologado: o aviso fica na tira o tempo todo, não só no dropdown, porque um
                R$/ponto errado contamina PnL e a trava financeira em dinheiro real. */}
            {asset.status === 'a_confirmar' && (
              <span
                className="px-1.5 py-0.5 rounded border border-amber-500/40 bg-amber-500/10 text-amber-400 font-bold uppercase tracking-wider"
                title={`SPEC NÃO HOMOLOGADO — ${asset.contractNote}. O Robô fica travado em OFF enquanto o ativo estiver neste estado; homologar é mudar o status no registro de ativos.`}
              >
                spec não homologado
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            <span className="text-slate-400">CVD:</span>
            <span className={`font-semibold ${cvd >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
              {cvd > 0 ? '+' : ''}
              {cvd.toLocaleString('pt-BR')}
            </span>
          </div>
          <div className="hidden md:flex items-center gap-2 shrink-0">
            <span className="text-slate-400">Origem:</span>
            <span className={mt5State.status === 'CONNECTED' ? 'text-emerald-400 font-bold' : 'text-neutral-400'}>
              {mt5State.status === 'CONNECTED'
                ? `MT5 Real (${mt5State.brokerCompany} #${mt5State.accountLogin || ''})`
                : 'Simulação B3'}
            </span>
          </div>
          <div className="hidden lg:flex items-center gap-1.5 px-2 py-0.5 rounded bg-slate-900 border border-slate-800 text-[11px] shrink-0">
            <span className="text-slate-400">Modo:</span>
            <span className="text-emerald-400 font-bold">{config.accountMode}</span>
          </div>
          {/* Estratégia ativa — caixinha de seleção da biblioteca do Estúdio. Trocar aqui
              aplica o snapshot e força o Robô PAUSADO; o link dos ajustes continua no cadeado. */}
          <div className="hidden lg:flex items-center gap-1.5 px-2 py-0.5 rounded bg-slate-900 border border-slate-800 text-[11px] shrink-0"
            title="Selecione uma estratégia salva para aplicar no terminal (o Robô é pausado por segurança). Para programar novas, abra o Estúdio."
          >
            <span className="text-slate-400">Estratégia:</span>
            <select
              value={StrategyLibraryService.findByProfileName(config.profileName)?.id ?? ''}
              onChange={(e) => {
                const target = strategyLibrary.find((s) => s.id === e.target.value);
                if (target) {
                  handleActivateStrategy(target);
                  refreshStrategyLibrary();
                }
              }}
              className="bg-transparent font-mono text-slate-200 font-medium focus:outline-none cursor-pointer max-w-[180px]"
            >
              {config.profileName && !StrategyLibraryService.findByProfileName(config.profileName) && (
                <option value="" className="bg-slate-900">{config.profileName} (config manual)</option>
              )}
              {!config.profileName && <option value="" className="bg-slate-900">— selecione —</option>}
              {strategyLibrary.map((s) => (
                <option key={s.id} value={s.id} className="bg-slate-900">{s.name}</option>
              ))}
            </select>
            <button
              onClick={() => setActiveTab('studio')}
              className="text-slate-500 hover:text-slate-200 transition-colors cursor-pointer"
              title="Abrir o Estúdio de Estratégias (programar, salvar, importar/exportar)"
            >
              <Sparkles className="w-3 h-3" />
            </button>
            <span className={`w-1.5 h-1.5 rounded-full ${config.active ? 'bg-emerald-400 animate-pulse' : 'bg-slate-600'}`} title={config.active ? 'Robô ligado' : 'Robô pausado'} />
          </div>
          {/* Por que nenhuma ordem sai? Espelho ao vivo dos portões de entrada (Robô / trava financeira / janela de entradas / trava de pregão) */}
          {blocksEntries && (
            <div className={`flex items-center gap-1.5 px-2 py-0.5 rounded border text-[10px] font-semibold shrink-0 max-w-[340px] ${
              finLockNow && config.active
                ? 'bg-rose-500/10 border-rose-500/40 text-rose-300'
                : 'bg-amber-500/10 border-amber-500/40 text-amber-300'
            }`}
              title={[
                ...(!config.active ? ['O Robô está pausado — ligue no botão On/Off no topo direito. Ativar uma estratégia pausa o Robô de propósito.'] : []),
                ...(finLockNow ? [finLockNow.reason, config.closeAllOnFinancialLock ? 'Posições abertas foram zeradas a mercado (trava com zeragem ligada na estratégia).' : 'Posições abertas seguem gerenciadas até a saída natural (TP, trailing, virada de fluxo).'] : []),
                ...gateReasons,
                ...(isReplaying && !replayOperates ? ['O replay está no modo SILENCIOSO: ligue o chip OPERA ao lado da setinha para ele disparar ordens na tela.'] : []),
              ].join(' ')}
            >
              <AlertTriangle className="w-3 h-3 shrink-0" />
              <span className="truncate">
                {!config.active
                  ? 'Robô pausado: nenhuma ordem sai'
                  : finLockNow
                  ? `Trava financeira: ${finLockNow.short}`
                  : gateReasons[0]}
              </span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2.5 sm:gap-4 shrink-0">
          {/* A medida da corrida e o atalho ficam na zona fixa (a direita nunca some), porque os
              controles de velocidade/seed moram no grupo do replay, que rola na esquerda. */}
          {lastReplay && !isReplaying && (
            <div
              className="hidden sm:flex items-center gap-1.5 px-2 py-0.5 rounded border border-slate-800 bg-slate-900/70 text-[10px] shrink-0"
              title={`Corrida de ${lastReplay.days} dia(s) em ${lastReplay.speed}x · ${
                lastReplay.source === 'REAL'
                  ? `HISTÓRICO REAL (MT5), ${lastReplay.tickCount.toLocaleString('pt-BR')} ticks${lastReplay.volumeSource ? ` · volume: ${volumeSourceLabel(lastReplay.volumeSource)}` : ''}`
                  : `SINTÉTICO, seed #${lastReplay.seed}`
              }${lastReplay.aborted ? ' · interrompida no meio' : ''}.

PnL REALIZADO no fim da corrida: R$ ${lastReplay.pnl.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} em ${lastReplay.trades} trade(s) fechado(s)${lastReplay.openCount > 0 ? `, com ${lastReplay.openCount} posição(ões) ainda aberta(s)` : ''}.

Diferente do PnL ao lado: este número congela na linha de chegada e não recebe os ticks do feed ao vivo.

${
  lastReplay.source === 'REAL'
    ? 'O mercado real não se repete: a reprodutibilidade aqui é a MESMA janela de ticks devolvida pela corretora, não um seed.'
    : 'Teste de determinismo: fixe este seed, rode a mesma corrida em outra velocidade e confira se o número se repete.'
}`}
            >
              <Clock className="w-3 h-3 text-slate-500 shrink-0" />
              <span className="text-slate-500">Corrida</span>
              <span className={`font-bold ${lastReplay.pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                R$ {lastReplay.pnl.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
              <span className="text-slate-500">
                {lastReplay.trades}t · {lastReplay.speed}x ·{' '}
                {lastReplay.source === 'REAL'
                  ? `HISTÓRICO REAL (MT5) · ${lastReplay.tickCount.toLocaleString('pt-BR')} ticks`
                  : `#${lastReplay.seed} SINTÉTICO`}
              </span>
              {!lastReplay.operated && <span className="text-amber-400/80">silencioso</span>}
            </div>
          )}
          <button
            onClick={revealReplayControls}
            className="flex items-center gap-1.5 px-2 py-0.5 rounded border border-slate-800 bg-slate-900/70 text-[10px] font-semibold text-slate-300 shrink-0 cursor-pointer hover:border-slate-600 transition-colors"
            title={`Velocidade ${simulationSpeed}x · seed ${replaySeed === null ? 'AUTO (um pregão novo a cada corrida)' : `fixo #${replaySeed}`}.

Os controles ficam no grupo do replay, no começo desta tira. Em janela estreita aquela área rola sozinha e eles somem da vista — clique aqui para levar a tela até eles.`}
          >
            <Activity className="w-3 h-3 text-slate-500" />
            <span className="font-mono">{simulationSpeed}x</span>
            <span className="text-slate-600">·</span>
            <span className="font-mono text-slate-400">{replaySeed === null ? 'SEED AUTO' : `#${replaySeed}`}</span>
          </button>
          {openOrders.length > 0 && (
            <div className="flex items-center gap-1.5 text-neutral-400 bg-neutral-500/10 px-2 py-0.5 rounded border border-neutral-500/30 text-[10px] sm:text-xs">
              <span className="w-1.5 h-1.5 rounded-full bg-neutral-400 animate-pulse" />
              <span>
                {openOrders.length === 1
                  ? `${openOrders[0].type} ${openOrders[0].contracts}x @ ${openOrders[0].entryPrice}`
                  : `${openOrders.length} Pos`}
              </span>
            </div>
          )}

          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0" title="PnL apenas das ordens fechadas NESTA abertura da página — o replay zera isso de propósito, pois começa um pregão limpo. O histórico completo fica no livro de Auditoria.">
            <span className="text-slate-400 text-[10px] sm:text-xs">PnL:</span>
            <span
              className={`font-bold ${
                stats.netFinancial >= 0 ? 'text-emerald-400' : 'text-rose-400'
              }`}
            >
              R$ {stats.netFinancial.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
            </span>
          </div>
        </div>
      </div>

      {/* Conteúdo Principal com compensação inferior no celular */}
      <main className="flex-1 min-h-0 p-1.5 sm:p-3 pb-16 lg:pb-3 bg-slate-950 overflow-hidden">
        {!AuthService.isSubscriptionActive(currentUser) && currentUser.role !== 'ADMIN' ? (
          <div className="h-full w-full overflow-y-auto">
            <SubscriptionPaywall
              user={currentUser}
              onRenewSuccess={(updatedUser) => {
                setCurrentUser(updatedUser);
                setLatestToast({
                  id: `toast-${Date.now()}`,
                  type: 'BUY',
                  title: 'Acesso Web Liberado!',
                  description: `Sua assinatura foi renovada e o terminal está ativo.`,
                  timestamp: Date.now(),
                });
              }}
              onSwitchUser={() => {
                const admin =
                  AuthService.getAllUsers().find((u) => u.role === 'ADMIN') || AuthService.getAllUsers()[0];
                AuthService.setCurrentUser(admin);
                setCurrentUser(admin);
              }}
            />
          </div>
        ) : (
          <>
            {activeTab === 'chart' && (
              <div className="h-full w-full rounded-lg border border-slate-800 overflow-hidden flex flex-col">
                <RenkoFlowChart
                  boxes={chartSeries === 'renko' ? boxes : chartSeries === 'range' ? rangeBoxes : timeBoxes}
                  currentBox={chartSeries === 'renko' ? currentBox : chartSeries === 'range' ? rangeCurrentBox : timeCurrentBox}
                  currentPrice={currentPrice}
                  openOrders={openOrders}
                  minDeltaThreshold={config.minDeltaThreshold}
                  onManualOrder={handleManualOrder}
                  onClosePositions={handleClosePositions}
                  contracts={config.contracts}
                  stopLossPoints={config.stopLossPoints}
                  takeProfitPoints={config.takeProfitPoints}
                  isRealMT5Connected={mt5State.status === 'CONNECTED'}
                  enablePartialExit={config.enablePartialExit}
                  partialPoints={config.partialPoints}
                  partialContracts={config.partialContracts}
                  trailingStop={config.trailingStop}
                  onExecutePyramidDemo={handleExecutePyramidDemo}
                  chartSeries={chartSeries}
                  onSeriesChange={handleSeriesChange}
                  renkoBoxPoints={config.boxPoints}
                  rangePoints={rangePoints}
                  onRangePointsChange={setRangePoints}
                  timeframeSec={timeframeSec}
                  onTimeframeChange={setTimeframeSec}
                  dadosWindowOpen={dadosPanelOpen}
                  onDadosWindowClose={() => setDadosPanelOpen(false)}
                  boxWindowOpen={boxWindowOpen}
                  onBoxWindowClose={() => setBoxWindowOpen(false)}
                  priceLevels={sessionLevels}
                  vwapCurve={vwapCurve}
                  asset={asset}
                />
              </div>
            )}

            {activeTab === 'tape' && (
              <div className="h-full w-full">
                <TimesAndTrades ticks={ticks} cvd={cvd} />
              </div>
            )}

            {activeTab === 'equity' && (
              <div className="h-full w-full">
                <EquityCurveView
                  orders={orders}
                  stats={stats}
                  currentPrice={currentPrice}
                  asset={asset}
                />
              </div>
            )}

            {activeTab === 'simulador' && (
              <div className="h-full w-full">
                <SimulatorView
                  isSimulating={isSimulating}
                  setIsSimulating={setIsSimulating}
                  simulationSpeed={simulationSpeed}
                  setSimulationSpeed={setSimulationSpeed}
                  robotActive={config.active}
                  onToggleRobot={() => {
                    setConfig((prev) => {
                      const updated = { ...prev, active: !prev.active, lastSavedTimestamp: Date.now() };
                      EaConfigService.saveConfig(updated);
                      return updated;
                    });
                  }}
                  currentPrice={currentPrice}
                  mt5Status={mt5State.status}
                  chartSeries={chartSeries}
                  rangePoints={rangePoints}
                  timeframeSec={timeframeSec}
                  config={config}
                  boxCounts={{
                    renko: boxes.length,
                    range: rangeBoxes.length,
                    tempo: timeBoxes.length,
                    renko15r: altEnginesRef.current.renko15r.getBoxes().length,
                    renko20r: altEnginesRef.current.renko20r.getBoxes().length,
                    renko25r: altEnginesRef.current.renko25r.getBoxes().length,
                  }}
                  tickBufferCount={allTicksRef.current.length}
                  ordersOpen={openOrders.length}
                  ordersClosed={orders.filter((o) => o.status.startsWith('CLOSED') || o.status === 'EXPIRED_PULLBACK').length}
                  onStepTick={handleStepTick}
                  onInjectAggression={handleInjectLargeAggression}
                  onReplayHistory={handleReplayHistory}
                  isReplaying={isReplaying}
                  asset={asset}
                />
              </div>
            )}

            {activeTab === 'comparativo' && (
              <div className="h-full w-full">
                <SeriesComparisonView onReplayHistory={handleReplayHistory} isReplaying={isReplaying} />
              </div>
            )}

            {activeTab === 'avaliacao' && (
              <div className="h-full w-full">
                <TechnicalEvaluationView onReplayHistory={handleReplayHistory} isReplaying={isReplaying} config={config} />
              </div>
            )}

            {activeTab === 'stats' && (
              <div className="h-full w-full">
                <OrdersAndStats
                  orders={orders}
                  stats={stats}
                  currentPrice={currentPrice}
                  asset={asset}
                  onNavigateToAudit={() => setActiveTab('audit')}
                />
              </div>
            )}

            {activeTab === 'audit' && (
              <div className="h-full w-full">
                <IntradayOrderAudit
                  orders={orders}
                  currentPrice={currentPrice}
                  symbol={config.symbol}
                  asset={asset}
                  onClearAudit={handleResetAudit}
                  onOpenSettings={() => setActiveTab('settings')}
                />
              </div>
            )}

            {activeTab === 'python' && (
              <div className="h-full w-full">
                <PythonScriptView config={config} />
              </div>
            )}

            {activeTab === 'docs' && (
              <div className="h-full w-full">
                <DocumentationView
                  config={config}
                  mt5State={mt5State}
                  onToggleMT5Connect={toggleMT5Connect}
                  onOpenPdfModal={() => setShowPdfModal(true)}
                  onConfigChange={(partial) => {
                    setConfig((prev) => {
                      const updated = { ...prev, ...partial, lastSavedTimestamp: Date.now() };
                      EaConfigService.saveConfig(updated);
                      return updated;
                    });
                  }}
                />
              </div>
            )}

            {activeTab === 'settings' && (
              <div className="h-full w-full">
                <AutomationPanel
                  config={config}
                  setConfig={setConfig}
                  simulationSpeed={simulationSpeed}
                  setSimulationSpeed={setSimulationSpeed}
                  onStepTick={handleStepTick}
                  onInjectLargeAggression={handleInjectLargeAggression}
                  // Arrow explícita: handleResetData ganhou opções (troca de ativo) e o clique do
                  // botão passaria o MouseEvent como se fosse `options`.
                  onResetData={() => handleResetData()}
                />
              </div>
            )}

            {activeTab === 'studio' && (
              <div className="h-full w-full">
                <StrategyStudio
                  currentConfig={config}
                  activeProfileName={config.profileName}
                  onLibraryChanged={refreshStrategyLibrary}
                  onActivate={(s) => {
                    handleActivateStrategy(s);
                    refreshStrategyLibrary();
                  }}
                />
              </div>
            )}

            {activeTab === 'admin' && (
              <div className="h-full w-full">
                <AdminPanel
                  currentUser={currentUser}
                  onUserListUpdated={() => {
                    setCurrentUser(AuthService.getCurrentUser());
                  }}
                  onSelectUserToTest={(targetUser) => {
                    AuthService.setCurrentUser(targetUser);
                    setCurrentUser(targetUser);
                    if (targetUser.role !== 'ADMIN') {
                      setActiveTab('chart');
                    }
                  }}
                />
              </div>
            )}
          </>
        )}
      </main>

      {/* Barra de Navegação Inferior Móvel (< 1024px) — 4 abas principais + menu "Mais" (sem rolagem) */}
      <nav className="fixed bottom-0 left-0 right-0 z-40 bg-slate-950/95 backdrop-blur-md border-t border-slate-800 lg:hidden px-2 py-1.5 flex items-center justify-around safe-area-pb shadow-lg">
        <button
          onClick={() => setActiveTab('chart')}
          className={`flex flex-col items-center justify-center py-1 px-2 rounded-lg text-[10px] font-medium transition-all ${
            activeTab === 'chart'
              ? 'text-neutral-400 bg-neutral-950/40 font-semibold'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <TrendingUp className="w-4 h-4 mb-0.5" />
          <span>Gráfico</span>
        </button>

        <button
          onClick={() => setActiveTab('tape')}
          className={`flex flex-col items-center justify-center py-1 px-2 rounded-lg text-[10px] font-medium transition-all ${
            activeTab === 'tape'
              ? 'text-neutral-400 bg-neutral-950/40 font-semibold'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Activity className="w-4 h-4 mb-0.5" />
          <span>Fluxo</span>
        </button>

        <button
          onClick={() => setActiveTab('equity')}
          className={`flex flex-col items-center justify-center py-1 px-2 rounded-lg text-[10px] font-medium transition-all ${
            activeTab === 'equity'
              ? 'text-neutral-400 bg-neutral-950/40 font-semibold'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <LineChart className="w-4 h-4 mb-0.5" />
          <span>Curva</span>
        </button>

        <button
          onClick={() => setActiveTab('stats')}
          className={`relative flex flex-col items-center justify-center py-1 px-2 rounded-lg text-[10px] font-medium transition-all ${
            activeTab === 'stats'
              ? 'text-neutral-400 bg-neutral-950/40 font-semibold'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          {openOrders.length > 0 && (
            <span className="absolute top-1 right-2 w-2 h-2 rounded-full bg-neutral-400 animate-pulse" />
          )}
          <Layers className="w-4 h-4 mb-0.5" />
          <span>Ordens</span>
        </button>

        <button
          onClick={() => setMoreNavOpen(true)}
          className={`relative flex flex-col items-center justify-center py-1 px-2 rounded-lg text-[10px] font-medium transition-all ${
            mobileMoreTabsActive
              ? 'text-neutral-400 bg-neutral-950/40 font-semibold'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          {mobileMoreTabsActive && (
            <span className="absolute top-1 right-2 w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          )}
          <MoreHorizontal className="w-4 h-4 mb-0.5" />
          <span>Mais</span>
        </button>
      </nav>

      {/* Menu "Mais" — painel que sobe acima da barra inferior com as abas secundárias */}
      {moreNavOpen && (
        <div className="fixed inset-0 z-40 lg:hidden" onClick={() => setMoreNavOpen(false)}>
          <div className="absolute inset-0 bg-slate-950/60 backdrop-blur-sm" />
          <div
            className="absolute bottom-20 left-2 right-2 bg-slate-900 border border-slate-700 rounded-xl p-3 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-2 px-1">
              <span className="text-[10px] font-bold tracking-widest text-slate-500 uppercase">Mais abas</span>
              <button
                onClick={() => setMoreNavOpen(false)}
                className="text-[10px] text-slate-400 hover:text-white px-2 py-1 rounded-md bg-slate-800 font-medium"
              >
                Fechar ✕
              </button>
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              <button
                onClick={() => { setActiveTab('simulador'); setMoreNavOpen(false); }}
                className={`flex flex-col items-center justify-center py-3 rounded-lg text-[10px] font-medium border transition-colors ${
                  activeTab === 'simulador' ? 'border-slate-600 bg-slate-800 text-slate-100 font-semibold' : 'border-slate-800 bg-slate-900/60 text-slate-400'
                }`}
              >
                <Cpu className="w-5 h-5 mb-1" />
                <span>Simulador</span>
              </button>
              <button
                onClick={() => { setActiveTab('comparativo'); setMoreNavOpen(false); }}
                className={`flex flex-col items-center justify-center py-3 rounded-lg text-[10px] font-medium border transition-colors ${
                  activeTab === 'comparativo' ? 'border-slate-600 bg-slate-800 text-slate-100 font-semibold' : 'border-slate-800 bg-slate-900/60 text-slate-400'
                }`}
              >
                <BarChart3 className="w-5 h-5 mb-1" />
                <span>Comparativo</span>
              </button>
              <button
                onClick={() => { setActiveTab('avaliacao'); setMoreNavOpen(false); }}
                className={`flex flex-col items-center justify-center py-3 rounded-lg text-[10px] font-medium border transition-colors ${
                  activeTab === 'avaliacao' ? 'border-slate-600 bg-slate-800 text-slate-100 font-semibold' : 'border-slate-800 bg-slate-900/60 text-slate-400'
                }`}
              >
                <BarChart3 className="w-5 h-5 mb-1" />
                <span>Avaliação</span>
              </button>
              <button
                onClick={() => { setActiveTab('audit'); setMoreNavOpen(false); }}
                className={`flex flex-col items-center justify-center py-3 rounded-lg text-[10px] font-medium border transition-colors ${
                  activeTab === 'audit' ? 'border-slate-600 bg-slate-800 text-slate-100 font-semibold' : 'border-slate-800 bg-slate-900/60 text-slate-400'
                }`}
              >
                <ShieldCheck className="w-5 h-5 mb-1" />
                <span>Auditoria</span>
              </button>
              <button
                onClick={() => { handleToggleDadosPanel(); setMoreNavOpen(false); }}
                className={`flex flex-col items-center justify-center py-3 rounded-lg text-[10px] font-medium border transition-colors ${
                  dadosPanelOpen && activeTab === 'chart' ? 'border-emerald-600 bg-emerald-950/40 text-emerald-200 font-semibold' : 'border-slate-800 bg-slate-900/60 text-slate-400'
                }`}
              >
                <AppWindow className="w-5 h-5 mb-1" />
                <span>Dados</span>
              </button>
              <button
                onClick={() => { handleToggleBoxWindow(); setMoreNavOpen(false); }}
                className={`flex flex-col items-center justify-center py-3 rounded-lg text-[10px] font-medium border transition-colors ${
                  boxWindowOpen && activeTab === 'chart' ? 'border-emerald-600 bg-emerald-950/40 text-emerald-200 font-semibold' : 'border-slate-800 bg-slate-900/60 text-slate-400'
                }`}
              >
                <Box className="w-5 h-5 mb-1" />
                <span>Box Renko</span>
              </button>
              <button
                onClick={() => { setActiveTab('docs'); setMoreNavOpen(false); }}
                className={`flex flex-col items-center justify-center py-3 rounded-lg text-[10px] font-medium border transition-colors ${
                  activeTab === 'docs' ? 'border-slate-600 bg-slate-800 text-slate-100 font-semibold' : 'border-slate-800 bg-slate-900/60 text-slate-400'
                }`}
              >
                <FileText className="w-5 h-5 mb-1" />
                <span>Guia</span>
              </button>
              <button
                onClick={() => { setActiveTab('settings'); setMoreNavOpen(false); }}
                className={`flex flex-col items-center justify-center py-3 rounded-lg text-[10px] font-medium border transition-colors ${
                  activeTab === 'settings' ? 'border-slate-600 bg-slate-800 text-slate-100 font-semibold' : 'border-slate-800 bg-slate-900/60 text-slate-400'
                }`}
              >
                <Sliders className="w-5 h-5 mb-1" />
                <span>Ajustes</span>
              </button>
              <button
                onClick={() => { setActiveTab('studio'); setMoreNavOpen(false); }}
                className={`flex flex-col items-center justify-center py-3 rounded-lg text-[10px] font-medium border transition-colors ${
                  activeTab === 'studio' ? 'border-slate-600 bg-slate-800 text-slate-100 font-semibold' : 'border-slate-800 bg-slate-900/60 text-slate-400'
                }`}
              >
                <Sparkles className="w-5 h-5 mb-1" />
                <span>Estúdio</span>
              </button>
              {currentUser.role === 'ADMIN' ? (
                <button
                  onClick={() => { setActiveTab('admin'); setMoreNavOpen(false); }}
                  className={`flex flex-col items-center justify-center py-3 rounded-lg text-[10px] font-medium border transition-colors ${
                    activeTab === 'admin' ? 'border-amber-600 bg-amber-950/40 text-amber-200 font-semibold' : 'border-slate-800 bg-slate-900/60 text-slate-400'
                  }`}
                >
                  <ShieldCheck className="w-5 h-5 mb-1 text-amber-400/80" />
                  <span>Admin</span>
                </button>
              ) : (
                <button
                  onClick={() => { setActiveTab('python'); setMoreNavOpen(false); }}
                  className={`flex flex-col items-center justify-center py-3 rounded-lg text-[10px] font-medium border transition-colors ${
                    activeTab === 'python' ? 'border-slate-600 bg-slate-800 text-slate-100 font-semibold' : 'border-slate-800 bg-slate-900/60 text-slate-400'
                  }`}
                >
                  <Terminal className="w-5 h-5 mb-1" />
                  <span>MT5 Bot</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modal de Renovação Manual / Planos (quando clicado pelo usuário no header) */}
      {showRenewModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
          <div className="relative w-full max-w-4xl my-auto">
            <button
              onClick={() => setShowRenewModal(false)}
              className="absolute top-4 right-4 z-50 w-8 h-8 rounded-full bg-slate-800 text-slate-300 hover:text-white flex items-center justify-center font-bold hover:bg-slate-700 transition-colors"
            >
              ✕
            </button>
            <SubscriptionPaywall
              user={currentUser}
              onRenewSuccess={(updatedUser) => {
                setCurrentUser(updatedUser);
                setShowRenewModal(false);
                setLatestToast({
                  id: `toast-${Date.now()}`,
                  type: 'BUY',
                  title: 'Assinatura Atualizada!',
                  description: `Sua assinatura foi renovada com sucesso.`,
                  timestamp: Date.now(),
                });
              }}
              onSwitchUser={() => {
                setShowRenewModal(false);
              }}
            />
          </div>
        </div>
      )}

      {/* Modal Executivo do Dossiê do Projeto & Exportação em PDF */}
      <ProjectDossierPdfModal
        isOpen={showPdfModal}
        onClose={() => setShowPdfModal(false)}
        config={config}
      />

      {/* Toast Flutuante de Disparo de Ordem / Conexão — abre no CENTRO da tela. O palco é
          inset-0 com pointer-events-none (o gráfico continua clicável atrás do aviso); só o cartão
          recebe eventos. Some sozinho em 4,5s ou no ✕. */}
      {latestToast && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
          <div className="flow-toast pointer-events-auto w-full max-w-sm bg-slate-900/95 border border-slate-700 rounded-lg px-3 py-2.5 shadow-2xl shadow-black/50 backdrop-blur-sm">
            <div className="flex items-start gap-2">
              <span
                className={`shrink-0 mt-[1px] ${
                  latestToast.type === 'BUY'
                    ? 'text-emerald-400/80'
                    : latestToast.type === 'INFO'
                    ? 'text-amber-400/80'
                    : 'text-rose-400/80'
                }`}
              >
                {latestToast.type === 'BUY' ? (
                  <ArrowUpRight className="w-3.5 h-3.5" />
                ) : latestToast.type === 'INFO' ? (
                  <Activity className="w-3.5 h-3.5" />
                ) : (
                  <ArrowDownRight className="w-3.5 h-3.5" />
                )}
              </span>
              <div className="flex-1 min-w-0">
                <span className="block text-[11px] font-semibold text-slate-200 leading-snug font-mono">
                  {latestToast.title}
                </span>
                {latestToast.description && (
                  <span className="block text-[11px] text-slate-400 leading-snug mt-0.5">
                    {latestToast.description}
                  </span>
                )}
              </div>
              <span className="shrink-0 flex items-center gap-0.5 text-[9px] text-slate-500 font-mono">
                <Clock className="w-2.5 h-2.5" />
                {mt5State.status === 'CONNECTED' ? 'MT5' : 'SIM'}
              </span>
              {/* No centro o aviso cobre o gráfico: dar um jeito de fechá-lo na hora é obrigatório */}
              <button
                onClick={() => setLatestToast(null)}
                className="shrink-0 -mr-1 -mt-0.5 px-1 text-[11px] leading-none text-slate-500 hover:text-slate-200 cursor-pointer"
                title="Fechar aviso"
                aria-label="Fechar aviso"
              >
                ✕
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
