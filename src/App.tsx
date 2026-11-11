import React, { useState, useEffect, useRef, useCallback, useMemo, useSyncExternalStore } from 'react';

import { Tick, RenkoBox, TradeOrder, AutomationConfig, TerminalStats, MT5ConnectionState, LocalPregao, MANUAL_ORDER_MAGIC, mainRobotMagic, SessionGap } from './types/trading';

import { RenkoFlowEngine } from './utils/renkoCalculator';

import { RangeBarEngine, TimeBarEngine, ChartSeries } from './utils/barEngines';

import { evaluateBoxConvergence, ConvergenceResult } from './utils/convergenceEvaluator';

import { isWithinTradingWindow, sessionFinancialLock, FinancialLock } from './utils/tradingGates';

import { listarPregoesLocais, mesclarPregoes } from './services/pregoesCatalogService';

import { isSessionCloseLock, sessionCloseLockLabel, parseHHMM, setEnforceTimeGates } from './utils/sessionRules';

import { migrateLegacyTradingWindow } from './utils/tradingWindowMigration';

import { migrateMainBreakevenOnPyramidTp } from './utils/mainBreakevenMigration';

import { migrateConsolidationFilterOff } from './utils/consolidationFilterMigration';

import { migrateAdaptiveThresholdOff } from './utils/adaptiveThresholdMigration';

import { migrateDeltaThresholdTo100 } from './utils/deltaThresholdMigration';

import { migrateDeltaThresholdTo50 } from './utils/deltaThreshold50Migration';

import { migrateAutoCalibratedFunnel } from './utils/autoCalibrationMigration';

import { migrateFunnelSelA } from './utils/funnelSelAMigration';
import { migrateAntiBurstCycle } from './utils/antiBurstMigration';
import { usePanelWindows } from './hooks/usePanelWindows';
import { useSession } from './hooks/useSession';
import { useMultiRobots } from './hooks/useMultiRobots';
import { useSimulation } from './hooks/useSimulation';
import { useTerminalFeed } from './hooks/useTerminalFeed';
import { useEngines } from './hooks/useEngines';
import { useShadowRobot } from './hooks/useShadowRobot';

import {

  ASSETS,

  resolveAsset,

  pointsToBRL,

  formatPrice,

  renkoScaleLabel,

  boxPointsForR,
  clampBoxPoints,

  isStaleOrderPrice,

  referencePrice,

  rememberLastPrice,

  assetSymbols,

  chartSymbolFor,
  isOrderForAsset,
  isSymbolForAsset,
  isPriceSaneForAsset,

  type AssetId,

  type AssetSpec,

  type AssetTradeDefaults,

} from './assets/assetRegistry';

export const getAssetTradeParams = (assetId: AssetId): AssetTradeDefaults => {
  const def = ASSETS[assetId]?.tradeDefaults ?? ASSETS.WIN.tradeDefaults;
  try {
    const raw = localStorage.getItem(`fluxo_asset_trade_params_${assetId}`);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        ...def,
        ...parsed,
        boxPoints: Number(parsed.boxPoints) || def.boxPoints,
        stopLossPoints: Number(parsed.stopLossPoints) || def.stopLossPoints,
        takeProfitPoints: Number(parsed.takeProfitPoints) || def.takeProfitPoints,
        partialPoints: Number(parsed.partialPoints) || def.partialPoints,
        breakevenOffsetPoints: Number(parsed.breakevenOffsetPoints) || def.breakevenOffsetPoints,
        trailingDistancePoints: Number(parsed.trailingDistancePoints) || def.trailingDistancePoints,
        minDeltaThreshold: Number(parsed.minDeltaThreshold) || def.minDeltaThreshold,
        contracts: Number(parsed.contracts) || def.contracts,
        rangePoints: Number(parsed.rangePoints) || def.rangePoints,
      };
    }
  } catch {
    // ignora
  }
  return { ...def };
};

export const saveAssetTradeParams = (assetId: AssetId, patch: Partial<AssetTradeDefaults>) => {
  try {
    const current = getAssetTradeParams(assetId);
    const updated = { ...current, ...patch };
    localStorage.setItem(`fluxo_asset_trade_params_${assetId}`, JSON.stringify(updated));
  } catch {
    // ignora
  }
};

import { migrateAssetBaseline, AssetBaselineMigration } from './assets/assetMigration';

import { migrateAssetSelection, AssetSelectionMigration } from './assets/assetSelectionMigration';

import { migrateChartVigenteContract, ChartContractMigration } from './assets/chartContractMigration';

import {

  MarketHistoryService,

  marketHistoryService,

  type VolumeSource,

  type HistoryMeta,

} from './services/marketHistoryService';

import { realTapeService } from './services/realTapeService';

import { formatTickTimeStr } from './utils/timeFormat';

import { computeSessionLevels, computeRunningVwap, PriceLevel, VwapCurve } from './utils/priceLevels';

import type { HedgeBook, HedgeSideBook } from './components/BoletaTicket';

import { getBridgeToken, clearBridgeToken, syncBridgeTokenWithServer } from './utils/bridgeSecurity';

import { seriesCollectorService } from './services/seriesCollectorService';

import { shadowRobotService } from './services/shadowRobotService';

import { roundAuditService, buildRound } from './services/roundAuditService';

import type { SeriesKey } from './utils/paperStrategyBot';

import type { SessionRegimeMeter } from './utils/sessionRegime';
import { computeFunnelMetrics } from './utils/funnelMetrics';
import { MultiRobotId, MULTI_ROBOTS, AssetSignalState, RobotRuntimeState } from './types/multiRobots';
import { PositionSummary } from './components/MultiAssetRobotsBar';

import { SimulatorView } from './components/SimulatorView';

import { B3MarketSimulator, generateHistoricalTicks, randomReplaySeed } from './utils/marketSimulator';

import { Header } from './components/Header';

import { RenkoFlowChart } from './components/RenkoFlowChart';

import { MiniSelect } from './components/MiniSelect';

import { TimesAndTrades } from './components/TimesAndTrades';

import { AutomationPanel } from './components/AutomationPanel';

import { OrdersAndStats } from './components/OrdersAndStats';

import { PythonScriptView } from './components/PythonScriptView';

import { DocumentationView } from './components/DocumentationView';

import { SubscriptionPaywall } from './components/SubscriptionPaywall';

import { AdminPanel } from './components/AdminPanel';

import { EquityCurveView } from './components/EquityCurveView';
import { ConnectionLogModal, ConnectionLogEntry } from './components/ConnectionLogModal';

import { UserProfile } from './types/auth';

import { AuthService } from './services/authService';

import { EaConfigService } from './services/eaConfigService';

import { OrderAuditService } from './services/orderAuditService';

// Purga imediata no carregamento do módulo: garante que o storage local esteja higienizado
if (typeof window !== 'undefined' && typeof window.localStorage !== 'undefined') {
  try {
    OrderAuditService.purgeOrphanOpenOrders();
  } catch {}
}

import { IntradayOrderAudit } from './components/IntradayOrderAudit';

import { ProjectDossierPdfModal } from './components/ProjectDossierPdfModal';

import { SeriesComparisonView } from './components/SeriesComparisonView';

import { TechnicalEvaluationView } from './components/TechnicalEvaluationView';

import { StrategyStudio } from './components/StrategyStudio';

import { AlertChip } from './components/AlertChip';

import { StrategyLibraryService, mergeConfig, splitStrategyPatch } from './services/strategyLibraryService';

import { SavedStrategy } from './types/strategy';

import { ArrowUpRight, ArrowDownRight, Wifi, AlertTriangle, ShieldAlert, TrendingUp, Activity, Layers, Sliders, ShieldCheck, Terminal, LineChart, Cpu, BarChart3, AppWindow, MoreHorizontal, FileText, Box, Play, Pause, Zap, Square, Clock, Sparkles, RefreshCw, ChevronDown } from 'lucide-react';



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



/** Dias oferecidos na caixa de replay. O teto de 10 dias é do handleReplayHistory, não daqui. */

const REPLAY_DAY_CHOICES = [1, 3, 5];

/** Identifica se o símbolo recebido pela rede corresponde ao ativo alvo usando a resolução oficial. */
function isSameAssetSymbol(incomingSym: string, targetAsset: AssetSpec): boolean {
  if (!incomingSym) return true;
  return resolveAsset(incomingSym).id === targetAsset.id;
}



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

  /** Volume usado nos ticks reais ('TICKS_REAIS' da fita comprimida, 'M1_RATE' sintetizado) — undefined no sintético. */

  volumeSource?: VolumeSource;

  /** Quando REAL: 'LIVE' veio da ponte agora; 'BANK' veio do banco local de fita capturada. */

  origin?: 'LIVE' | 'BANK';

  /** Procedência completa da série servida pela ponte (resolução do bucket, dias, arquivos). */

  fonte?: HistoryMeta;

  tickCount: number;

};




/**
 * Sintetiza ticks a partir de boxes formados (ex: do SESSION_BACKFILL ou do motor Renko),
 * garantindo que séries derivadas como Range e Tempo possam ser reconstruídas imediatamente.
 */
function synthesizeTicksFromBoxes(bxList: RenkoBox[]): Tick[] {
  const result: Tick[] = [];
  const len = bxList.length;
  for (let i = 0; i < len; i++) {
    const b = bxList[i];
    if (!b || !(b.close > 0) || !(b.open > 0)) continue;
    const tsStart = b.timeStart || Date.now() - (len - i) * 3000;
    const tsEnd = b.timeEnd && b.timeEnd >= tsStart ? b.timeEnd : tsStart + 1500;
    const vol = Math.max(1, Math.round((b.totalVolume || 8) / 2));

    const mk = (p: number, t: number, agg: 'BUY' | 'SELL', sub: number): Tick => ({
      id: 'synth-' + i + '-' + sub,
      price: p,
      volume: vol,
      timestamp: t,
      timeStr: new Date(t).toLocaleTimeString('pt-BR'),
      aggressor: agg,
    });

    // Emissão suave da trajetória direcional sem micro-oscilações artificiais
    if (b.direction === 'UP') {
      const pStart = Number.isFinite(b.low) && b.low < b.open ? b.low : b.open;
      const pEnd = Number.isFinite(b.high) && b.high > b.close ? b.high : b.close;
      result.push(mk(pStart, tsStart, 'BUY', 1));
      result.push(mk(pEnd, tsEnd, 'BUY', 2));
    } else {
      const pStart = Number.isFinite(b.high) && b.high > b.open ? b.high : b.open;
      const pEnd = Number.isFinite(b.low) && b.low < b.close ? b.low : b.close;
      result.push(mk(pStart, tsStart, 'SELL', 1));
      result.push(mk(pEnd, tsEnd, 'SELL', 2));
    }
  }
  return result;
}

export default function App() {

  const {
    activeTab, setActiveTab, paramFocus, setParamFocus,
    dadosPanelOpen, setDadosPanelOpen,
    boxWindowOpen, setBoxWindowOpen,
    shadowWindowOpen, setShadowWindowOpen,
    moreNavOpen, setMoreNavOpen,
    handleToggleDadosPanel, handleToggleBoxWindow, handleToggleShadowWindow,
  } = usePanelWindows();

  const goToRenkoParam = () => {

    setActiveTab('settings');

    setParamFocus('renkoBox');

  };

  const [currentUser, setCurrentUser] = useState<UserProfile>(() => AuthService.getCurrentUser());

  // Resultado da migração da trava de horário. É ref porque o useState do `config` logo abaixo

  // roda antes de qualquer efeito; o aviso ao operador sai no efeito de montagem.

  const windowMigrationRef = useRef<{ config: boolean; strategies: number } | null>(null);

  // Alavanca A: aviso de que mães desprotegidas foram postas no breakeven (config + biblioteca).
  const mainBreakevenRef = useRef<{ config: boolean; strategies: number } | null>(null);

  // Alavanca B: aviso de que o Filtro de Acumulação (ER) foi desligado por sobre-filtrar (config + biblioteca).
  const consolidationOffRef = useRef<{ config: boolean; strategies: number } | null>(null);

  // Limiar adaptativo (P60): aviso de que ele foi desligado — sufocava sinais ao vivo e piorava o DD.
  const adaptiveOffRef = useRef<{ config: boolean; strategies: number } | null>(null);

  // Δ físico do funil (150 → 100): aviso de que ele baixou — com o adaptativo OFF, foi o melhor nas 3 seeds.
  const delta100Ref = useRef<{ config: boolean; strategies: number } | null>(null);

  // Δ físico do funil (100 → 50): aviso de que ele baixou — no bench de 10 réplicas, 50 dominou 100.
  const delta50Ref = useRef<{ config: boolean; strategies: number } | null>(null);

  // Funil auto-calibrado (P60 do dia + piso 1,3× + divergência 40%): aviso de que o pacote chegou.
  const autoCalRef = useRef<{ config: boolean; strategies: number } | null>(null);

  // Funil SEL-A (P70 + piso 1,6× + divergência 50%): aviso de que o pacote chegou ao padrão novo.
  const funnelSelARef = useRef<{ config: boolean; strategies: number } | null>(null);

  // Idem para a migração do preço de referência do ativo (128.500 → ajuste atual do contrato).

  const assetMigrationRef = useRef<AssetBaselineMigration | null>(null);

  // E idem para a migração da SELEÇÃO de ativo (Fase 2): `assetId` no config, nas estratégias

  // salvas e o livro de auditoria, que deixa de ser uma chave única.

  const assetSelectionRef = useRef<AssetSelectionMigration | null>(null);

  // E idem para a migração do CONTRATO do gráfico: quem tinha a série contínua gravada passa a

  // abrir o vigente (a contínua ficou só para os testes de histórico).

  const chartContractRef = useRef<ChartContractMigration | null>(null);

  // Última vez que o preço real do MT5 foi gravado como régua do ativo (amortecido: 30s).

  const lastPriceWriteRef = useRef<number>(0);

  const [showRenewModal, setShowRenewModal] = useState<boolean>(false);

  const [showPdfModal, setShowPdfModal] = useState<boolean>(false);

  const [config, setConfig] = useState<AutomationConfig>(() => {

    // A trava de horário de trabalho (liberado das 08:55, zeragem compulsória às 17:30) é o

    // padrão novo. Config e estratégias salvas com janela antiga INTACTA são convertidas aqui,

    // uma única vez, antes de a primeira leitura do storage.

    windowMigrationRef.current = migrateLegacyTradingWindow();

    // Alavanca A (bench A/B): mães de Pirâmide 100% desprotegidas vão ao breakeven a cada TP.
    // Antes da primeira leitura do storage, pela mesma razão da trava de horário: gravado vence default.

    mainBreakevenRef.current = migrateMainBreakevenOnPyramidTp();

    // Alavanca B (bench A/B 3 seeds): o Filtro de Acumulação ER estava sobre-filtrando e derrubando
    // a expectativa da pirâmide. Pilamos no mesmo motivo da A: gravado vence default, então a
    // migração roda antes da primeira leitura do storage.
    consolidationOffRef.current = migrateConsolidationFilterOff();

    // Limiar adaptativo OFF (bench A/B 3 seeds): o corte P60 sufocava sinais ("SINAL FRACO") e
    // inflava o DD. Mesma razão da A e da B: gravado vence default, então migra antes da 1ª leitura.
    adaptiveOffRef.current = migrateAdaptiveThresholdOff();

    // Δ físico 150 → 100 (mesmo bench 3 seeds): com o adaptativo OFF, 100 deu mais ordens e maior fator.
    // Roda depois da migração do adaptativo (que não mexe no Δ), então o Δ ainda está em 150 aqui.
    delta100Ref.current = migrateDeltaThresholdTo100();

    // Δ físico 100 → 50 (bench 10 réplicas × 10d): Δ50 domina Δ100 em PnL/PF/DD, 10/10 réplicas. Roda
    // depois da de 100, então quem estava em 150 já chegou a 100 e agora cai a 50.
    delta50Ref.current = migrateDeltaThresholdTo50();

    // Pacote auto-calibrado do funil (adaptativo ON + divergência 40%): roda DEPOIS da migração do
    // Δ50 — o guard "Δ nunca tocado" aqui é exatamente 50, e quem calibrou por conta própria fica quieto.
    autoCalRef.current = migrateAutoCalibratedFunnel();

    // Pacote SEL-A do funil (P70 + piso 1,6 + divergência 50%): roda DEPOIS da do auto-calibrado —
    // promove exatamente o pacote Cycle 17 intocado (ON + Δ50 + div 0,4), e quem calibrou por conta
    // própria fica quieto. Bench WINZ26: PF 3,71→4,17, R$/trade 15,9→21,4, 11/11 pregões positivos.
    funnelSelARef.current = migrateFunnelSelA();

    // A seleção de ativo precisa estar gravada ANTES do loadSavedConfig lá embaixo: o storage

    // vence o default, então um config antigo sem `assetId` só resolve certo depois da migração.

    assetSelectionRef.current = migrateAssetSelection();

    // Depois das duas acima: esta reescreve só o `symbol`, e precisa ver o `assetId` já preenchido.

    chartContractRef.current = migrateChartVigenteContract();

    // Migração anti-estouro/anti-ruído: restaura piso de 300 contratos no WIN, reativa filtros de
    // consolidação e exaustão e purga ordens antigas com lucro espúrio > R$ 10.000 gravadas no cache.
    migrateAntiBurstCycle();

    // Fase A (banco de dados único): garante que TODO config ativo tenha uma estratégia por trás,

    // ANTES da primeira leitura. Id válido reusa; `profileName` que casa com uma estratégia é

    // vinculado pelo id (não duplica); sem nada, semeia "Estratégia ativa" a partir do config.

    const loaded = EaConfigService.loadSavedConfig();

    const { strategy } = StrategyLibraryService.ensureActiveStrategy(loaded);

    return StrategyLibraryService.resolveOperational(strategy, loaded);

  });

  /**

   * Números do ativo em operação (R$/ponto, tick, casas decimais, preço de referência, horário

   * de pregão). Desde a Fase 2 a origem é `config.assetId` (o seletor do Header); o símbolo é o

   * plano B para config e estratégia salvos antes disso. É a ÚNICA fonte desses números: nada mais

   * no app escreve `* 0.2` ou `128500`.

   */

  const asset = React.useMemo(() => resolveAsset(config.symbol, config.assetId), [config.symbol, config.assetId]);

  /**

   * O código que a ponte subscreve de verdade e o papel dele. O gráfico abre sempre o VIGENTE

   * (`chartSymbolFor`); os outros campos deste memo só servem para a tela não mentir quando o

   * config estiver apontando para outro vencimento — um teste longo na contínua, por exemplo.

   */

  const assetSyms = React.useMemo(() => assetSymbols(asset, config.symbol), [asset, config.symbol]);

  // REGRA DO OPERADOR (Ciclo 12): o terminal SEMPRE acorda PARADO. Nada de feed automático na

  // inicialização — o mercado só anda por comando manual: o ▶ SIM do cabeçalho (feed ao vivo

  // simulado), a setinha de replay (história rodando em corrida) ou o botão On do Robô. Motivo:

  // o "auto" e o "manual" rodavam de jeitos diferentes e a tela do boot mentia história.

  const {
    isSimulating, setIsSimulating,
    simulationSpeed, setSimulationSpeed, simulationSpeedRef,
    replayDays, setReplayDays,
    isReplaying, setIsReplaying, isReplayingRef,
    replayOperates, setReplayOperates,
    replaySeed, setReplaySeed,
  } = useSimulation();
  // Identificador exclusivo da aba para evitar loops de eco em broadcasts (SaaS / WebSocket)
  const tabSessionIdRef = useRef<string>(`tab-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`);

  // Backtest com Ticks Reais (MT5 XP)

  const [isBacktestingReal, setIsBacktestingReal] = useState<boolean>(false);

  const [realBacktestResult, setRealBacktestResult] = useState<any>(null);

  const {
    localPregoes, setLocalPregoes,
    currentAssetPregoes,
    selectedPregaoDate, setSelectedPregaoDate,
    selectedPregaoValue, setSelectedPregaoValue,
    getPregaoCompactCode,
    sessionGaps, setSessionGaps,
  } = useSession(asset);




  // "Replay opera": durante a reprodução cada tick passa pelo MESMO caminho do feed ao vivo

  // (estratégia → MAE/pirâmides → auditoria → PnL na tela). Ligado por padrão; nunca é usado

  // com o MT5 conectado, porque aí as ordens seriam reais.



  // Seed do pregão sintético. null = AUTO (um mercado novo a cada corrida — o número sorteado

  // aparece no chip de resultado, para você fixar depois). Com um seed fixo, o MESMO pregão é

  // reproduzido todas as vezes: é assim que se testa velocidade sem testar mercados diferentes.


  // A mesma velocidade vale para o replay E para o feed ao vivo — e sobrevive ao F5




  const {
    ticks, setTicks,
    bfDiag, setBfDiag,
    allTicksRef,
    pendingUiUpdateRef,
  } = useTerminalFeed();

  const [boxes, setBoxes] = useState<RenkoBox[]>([]);
  // Última resposta da ponte sobre o backfill do gráfico (diagnóstico visível na tela)


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


  const [rangePoints, setRangePoints] = useState<number>(() => Number(localStorage.getItem('fluxo_chart_range_pts_v1')) || 100);

  const [timeframeSec, setTimeframeSec] = useState<number>(() => Number(localStorage.getItem('fluxo_chart_time_sec_v1')) || 30);

  const [rangeBoxes, setRangeBoxes] = useState<RenkoBox[]>([]);

  const [rangeCurrentBox, setRangeCurrentBox] = useState<Partial<RenkoBox> | null>(null);

  const [timeBoxes, setTimeBoxes] = useState<RenkoBox[]>([]);

  const [timeCurrentBox, setTimeCurrentBox] = useState<Partial<RenkoBox> | null>(null);

  const { engineRef, rangeEngineRef, timeEngineRef, altEnginesRef } = useEngines(asset);



  // Buffer de atualização visual via requestAnimationFrame (desacopla ingestão de ticks da renderização 60 FPS)

  // =========================================================================================

  // ROBÔ 2 (SOMBRA) na interface: janela flutuante no gráfico + chip na 3ª linha.

  // O App só LÊ o service (nada daqui escreve em ordens/auditoria/socket) e repassa o patch

  // de escolha para o config, que é a fonte persistida.

  // =========================================================================================

  const shadowVersion = useSyncExternalStore(shadowRobotService.subscribe, shadowRobotService.getVersion);

  const shadowWindowRef = useRef<{ v: number; snap: ReturnType<typeof shadowRobotService.getSnapshot> } | null>(null);

  if (!shadowWindowRef.current || shadowWindowRef.current.v !== shadowVersion) {

    shadowWindowRef.current = { v: shadowVersion, snap: shadowRobotService.getSnapshot() };

  }

  const shadowSnap = shadowWindowRef.current.snap;

  // =========================================================================
  // GESTÃO MULTI-ROBÔS / COPILOTO (WIN, WDO, BIT)
  // =========================================================================
  const {
    multiRobotSignals, setMultiRobotSignals,
    focusedRobotAsset, setFocusedRobotAsset,
    multiRobotStates, setMultiRobotStates,
  } = useMultiRobots();

  const mobileMoreTabsActive = ['simulador', 'comparativo', 'avaliacao', 'audit', 'settings', 'studio', 'docs', 'admin', 'python'].includes(activeTab);

  // Biblioteca de estratégias (Estúdio). A caixinha da tira de status lê esta lista;

  // ativar uma estratégia aplica o snapshot e força o Robô PAUSADO por segurança.

  const [strategyLibrary, setStrategyLibrary] = useState<SavedStrategy[]>(() => StrategyLibraryService.list());

  // Fase A (regra 8/13 — fonte única): o NOME da estratégia ativa é resolvido pelo id, não pelo

  // `profileName` (que agora é só rótulo retrocompatível). Header, caixinha da tira e o modal de

  // exclusão bebem deste memo. Sem `strategyId` (config manual/órfão), cai no `profileName`.

  const activeStrategy = React.useMemo(

    () => (config.strategyId ? StrategyLibraryService.list().find((s) => s.id === config.strategyId) ?? null : null),

    [config.strategyId, strategyLibrary],

  );

  const activeStrategyName = activeStrategy?.name ?? config.profileName ?? null;
  const activeStrategyNameRef = useRef<string | null>(activeStrategyName);

  useEffect(() => {
    activeStrategyNameRef.current = activeStrategyName;
  }, [activeStrategyName]);

  // Referências para controle remoto do replay e conexão
  const handleReplayHistoryRef = useRef<((days: number, seedOverride?: number, dayKeyOverride?: string, isRemoteSync?: boolean) => void) | null>(null);
  const handleStopReplayRef = useRef<((isRemoteSync?: boolean) => void) | null>(null);
  const toggleMT5ConnectRef = useRef<((manualAction?: 'CONNECT' | 'DISCONNECT', isRemoteSync?: boolean) => void) | null>(null);
  const handleBoletaConfigPatchRef = useRef<((patch: Partial<AutomationConfig>, isRemoteSync?: boolean) => void) | null>(null);

  // Canal de sincronização entre abas e dispositivos (SaaS Multi-Tela em tempo real)
  const saasChannelRef = useRef<BroadcastChannel | null>(null);
  const strategyConnectAtRef = useRef<number>(0);
  const isRemoteArmSyncRef = useRef<boolean>(false);

  useEffect(() => {
    if (typeof BroadcastChannel !== 'undefined') {
      const channel = new BroadcastChannel('fluxo_saas_sync');
      saasChannelRef.current = channel;

      channel.onmessage = (event) => {
        const data = event.data;
        if (!data) return;

        if (data.type === 'ROBOT_ARMED_SYNC') {
          const armed = Boolean(data.armed);
          setMt5State((prev) => ({ ...prev, bridgeArmed: armed }));
          setConfig((prev) => {
            if (prev.active === armed) return prev;
            isRemoteArmSyncRef.current = true;
            return { ...prev, active: armed, lastSavedTimestamp: Date.now() };
          });
          setReplayOperates(armed);
        } else if (data.type === 'STRATEGY_SYNC') {
          const profileName = data.profileName;
          if (profileName && profileName !== activeStrategyNameRef.current) {
            const library = StrategyLibraryService.list();
            const existing = library.find((s) => s.name.toLowerCase() === profileName.toLowerCase());
            if (existing) {
              handleActivateStrategy(existing, true);
            } else if (data.config) {
              handleApplyConfigBundle(data.config, profileName, true);
            }
          }
        } else if (data.type === 'MT5_CONNECT_SYNC') {
          if (data.action === 'CONNECT') {
            toggleMT5ConnectRef.current?.('CONNECT', true);
          } else if (data.action === 'DISCONNECT') {
            toggleMT5ConnectRef.current?.('DISCONNECT', true);
          }
        } else if (data.type === 'MT5_DAY_STATS_SYNC') {
          if (data.dayStats) {
            setMt5State((prev) => ({
              ...prev,
              dayStats: data.dayStats,
              dayStatsBySymbol: data.dayStatsBySymbol ?? (prev as any).dayStatsBySymbol,
              balance: data.balance ?? prev.balance,
              equity: data.equity ?? prev.equity,
              floatingProfit: data.floatingProfit ?? prev.floatingProfit,
            }));
          }
        } else if (data.type === 'BOX_POINTS_SYNC') {
          const bPts = Number(data.boxPoints);
          const targetAssetId = (data.assetId || (data.symbol ? resolveAsset(data.symbol).id : null)) as AssetId | null;
          if (bPts > 0 && targetAssetId) {
            // Salva de forma estritamente isolada no storage do ativo específico
            saveAssetTradeParams(targetAssetId, { boxPoints: bPts });
            if (assetStateRef.current[targetAssetId]) {
              assetStateRef.current[targetAssetId].engine.setBoxPoints(bPts);
            }
            // SÓ atualiza a tela se a sincronização for para o ativo em exibição
            if (targetAssetId === activeAssetIdRef.current) {
              const clamped = clampBoxPoints(bPts, asset);
              handleBoletaConfigPatchRef.current?.({ boxPoints: clamped }, true);
            }
          }
        } else if (data.type === 'REPLAY_START_SYNC') {
          // Descarte de eco da própria aba e bloqueio se já estiver em replay
          if (data.senderId && data.senderId === tabSessionIdRef.current) return;
          if (isReplayingRef.current) return;

          const rDays = data.days ?? 1;
          const rSpd = data.speed;
          const rSeed = data.seed;
          const rDayKey = data.dayKey;
          const rBoxPoints = Number(data.boxPoints);
          const rTargetAssetId = (data.assetId || (data.symbol ? resolveAsset(data.symbol).id : null)) as AssetId | null;
          if (rBoxPoints > 0 && rTargetAssetId) {
            saveAssetTradeParams(rTargetAssetId, { boxPoints: rBoxPoints });
            if (assetStateRef.current[rTargetAssetId]) {
              assetStateRef.current[rTargetAssetId].engine.setBoxPoints(rBoxPoints);
            }
          }
          if (rSpd) setSimulationSpeed(rSpd);
          setReplayDays(rDays);
          if (rBoxPoints > 0 && (!rTargetAssetId || rTargetAssetId === activeAssetIdRef.current)) {
            const clamped = clampBoxPoints(rBoxPoints, asset);
            handleBoletaConfigPatchRef.current?.({ boxPoints: clamped }, true);
          }
          handleReplayHistoryRef.current?.(rDays, rSeed, rDayKey, true);
        } else if (data.type === 'REPLAY_STOP_SYNC') {
          if (data.senderId && data.senderId === tabSessionIdRef.current) return;
          if (isReplayingRef.current) {
            handleStopReplayRef.current?.(true);
          }
        } else if (data.type === 'REPLAY_SPEED_SYNC') {
          if (data.speed) setSimulationSpeed(data.speed);
        } else if (data.type === 'REPLAY_DAYS_SYNC') {
          if (data.days) setReplayDays(data.days);
        }
      };

      return () => {
        channel.close();
      };
    }
  }, []);

  const builtInPresets = React.useMemo(() => EaConfigService.getBuiltInPresets(), []);

  const currentStratSelectValue = React.useMemo(() => {
    if (config.strategyId && strategyLibrary.some((s) => s.id === config.strategyId)) {
      return `strat:${config.strategyId}`;
    }
    const matchedPreset = builtInPresets.find(
      (p) => p.name === config.profileName || p.id === config.profileName || p.config.profileName === config.profileName
    );
    if (matchedPreset) {
      return `preset:${matchedPreset.id}`;
    }
    return '__CUSTOM__';
  }, [config.strategyId, config.profileName, strategyLibrary, builtInPresets]);

  const refreshStrategyLibrary = () => {

    const list = StrategyLibraryService.list();

    setStrategyLibrary(list);

    // Varredura de conflito (Ciclo 12): apagar/renamear uma estratégia em uso não pode deixar

    // referência órfã pelo terminal — era assim que o "Reteste apagado" ficava fixado no Robô 2

    // e o Robô 1 apontava para um perfil fantasma. Toda mudança de biblioteca passa por aqui.

    const shadowSel = config.shadowRobot?.strategyId ?? null;

    const shadowStale = !!shadowSel && !list.some((s) => s.id === shadowSel);

    // Fase A: o Robô 1 é detectado por strategyId (não mais por nome). Estratégia ativa apagada →

    // limpa só o vínculo; o último config materializado continua valendo, agora solto da biblioteca.

    const mainSel = config.strategyId ?? null;

    const mainStale = !!mainSel && !list.some((s) => s.id === mainSel);

    if (!shadowStale && !mainStale) return;

    const updated: AutomationConfig = {

      ...config,

      ...(shadowStale && config.shadowRobot

        ? { shadowRobot: { ...config.shadowRobot, strategyId: null, enabled: false } }

        : {}),

      ...(mainStale ? { strategyId: null } : {}),

      lastSavedTimestamp: Date.now(),

    };

    EaConfigService.saveConfig(updated);

    setConfig(updated);

    setLatestToast({

      id: `toast-${Date.now()}`,

      type: 'INFO',

      title: 'Estratégia em uso saiu da biblioteca — referências limpas',

      description: [

        mainStale ? 'Robô 1: a estratégia ativa foi apagada da biblioteca; o config atual continua valendo, solto da biblioteca.' : null,

        shadowStale ? 'Robô 2: ficou sem estratégia e foi desligado — reescolha na janela dele.' : null,

      ]

        .filter(Boolean)

        .join(' '),

      timestamp: Date.now(),

    });

  };

  const handleActivateStrategy = (strategy: SavedStrategy, isRemoteSync?: boolean) => {

    // Fase A: ativar NÃO copia mais o snapshot inteiro por cima do config — ele vira uma visão
    // materializada da estratégia (campos de estratégia do snapshot, runtime/conexão preservados
    // do config atual) e passa a apontar para a biblioteca pelo id.

    const updated: AutomationConfig = {
      ...StrategyLibraryService.resolveOperational(strategy, config),
      active: false,
      profileName: strategy.name,
      lastSavedTimestamp: Date.now(),
    };

    EaConfigService.saveConfig(updated);
    setConfig(updated);

    if (!isRemoteSync) {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        try {
          wsRef.current.send(JSON.stringify({
            action: 'SET_ACTIVE_STRATEGY',
            profileName: strategy.name,
            config: updated
          }));
        } catch {}
      }
      try {
        saasChannelRef.current?.postMessage({
          type: 'STRATEGY_SYNC',
          profileName: strategy.name,
          config: updated
        });
      } catch {}
    }

    // Trocar de estratégia com posições no livro é mudança de regras no meio do jogo: as
    // abertas continuam gerenciadas só por TP/stop/zeragem manual (a virada de fluxo é da
    // Pirâmide; o Reteste novo não liquida herança de ninguém). O operador precisa saber.

    const openNow = orders.filter((o) => o.status === 'OPEN' || o.status === 'PENDING_LIMIT').length;

    setLatestToast({
      id: `toast-${Date.now()}`,
      type: 'INFO',
      title: isRemoteSync ? `🔄 Estratégia Sincronizada: "${strategy.name}"` : `Estratégia "${strategy.name}" ativada`,
      description:
        'Robô mantido PAUSADO por segurança — ligue no On quando quiser operar.' +
        (openNow > 0
          ? ` Atenção: ${openNow} ordem(ns) do ajuste anterior seguem no livro — saem por TP/stop ou no ZERAR da boleta.`
          : ''),
      timestamp: Date.now(),
    });
  };

  /**
   * Fase A (banco único): "aplicar perfil 1-clique", "restaurar padrões" e "importar JSON" carregam
   * um conjunto INTEIRO de números. Antes eles escreviam só no config (a biblioteca ficava defasada e
   * o Estúdio mostrava outra coisa). Agora o pacote vira estratégia no banco: atualiza a homônima se
   * já existir, senão cria uma nova — e o config ativo passa a ser a visão materializada dela, ativada
   * pelo mesmo funil de sempre. Nada sobrescreve em silêncio a estratégia que estava ativa: a anterior
   * continua inteira no Estúdio. Robô PAUSADO, como na ativação e no sync.
   */

  const handleApplyConfigBundle = (cfg: AutomationConfig, name?: string, isRemoteSync?: boolean) => {
    const bundleName = (name || cfg.profileName || 'Estratégia ativa').trim();
    const merged: AutomationConfig = {
      ...mergeConfig(cfg),
      profileName: bundleName,
      // Desempara do id anterior: o vínculo abaixo é por nome (reusa) ou por criação.
      strategyId: null,
      active: false,
      lastSavedTimestamp: Date.now(),
    };

    const existing = StrategyLibraryService.list().find((s) => s.name === bundleName);
    const strategy = existing
      ? StrategyLibraryService.updateStrategyConfig(existing.id, merged) ?? existing
      : StrategyLibraryService.save(StrategyLibraryService.newFromConfig(merged, bundleName));

    handleActivateStrategy(strategy, isRemoteSync);
    refreshStrategyLibrary();
  };

  // Sincronização de terminal (Ciclo 12): o "Importar tudo" do Estúdio devolve o config ativo

  // que veio do OUTRO navegador (interno e externo têm localStorage próprio). Ele entra pelo

  // mesmo funil de segurança da ativação de estratégia: saneado pelo mergeConfig, persistido

  // e com o Robô PAUSADO — sincronizar dados nunca liga mercado nem ordem sozinho.

  const handleApplySyncedConfig = (cfg: AutomationConfig) => {

    const merged: AutomationConfig = { ...mergeConfig(cfg), active: false, lastSavedTimestamp: Date.now() };

    // Fase A (banco único): o pacote de sync chega com o config ativo apontando para um strategyId.

    // A biblioteca do pacote já foi vertida antes daqui (applySyncPayload dá upsert por id), então o

    // id normalmente já existe no cofre local; se não existir, ensureActiveStrategy a semeia a partir

    // do config recebido e o config ativo passa a ser a visão materializada dessa estratégia.

    const { strategy } = StrategyLibraryService.ensureActiveStrategy(merged);

    const updated: AutomationConfig = StrategyLibraryService.resolveOperational(strategy, merged);

    EaConfigService.saveConfig(updated);

    setConfig(updated);

    refreshStrategyLibrary();

    const openNow = orders.filter((o) => o.status === 'OPEN' || o.status === 'PENDING_LIMIT').length;

    setLatestToast({

      id: `toast-${Date.now()}`,

      type: 'INFO',

      title: 'Terminal sincronizado',

      description:

        `Config ativo restaurado do pacote (Robô PAUSADO por segurança — ligue no On quando quiser operar).` +

        (openNow > 0

          ? ` Atenção: ${openNow} ordem(ns) deste navegador seguem no livro — saem por TP/stop ou no ZERAR da boleta.`

          : ''),

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
      if (!isOrderForAsset(o, asset)) return o;

      const isPending = o.status === 'PENDING_LIMIT';

      const activeCtros = o.remainingContracts || o.contracts;

      const sanePrice = isPriceSaneForAsset(price, asset) && isPriceSaneForAsset(o.entryPrice, asset);
      const pts = isPending || !sanePrice ? 0 : o.type === 'BUY' ? price - o.entryPrice : o.entryPrice - price;

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
  const { shadowEngineRef, ensureShadowEngine } = useShadowRobot();



  /**

   * Um tick alimenta o motor da sombra. O config passado é o da ESTRATÉGIA da sombra (limiares,

   * regime, janela e mode dela) — nunca o config ativo: por isso ela é independente do robô 1.

   */

  const feedShadowEngine = useCallback((tick: Tick) => {

    const eff = shadowRobotService.getEffectiveConfig();

    if (!eff) return;

    const eng = ensureShadowEngine();

    if (!eng) return;

    eng.getRegimeMeter().setLookbackBoxes(eff.regimeLookbackBoxes ?? 20);

    const res = eng.processTick(tick, eff);

    // Um tick pode fechar vários boxes (preenchimento Renko): cada um alimenta a sombra
    // com o histórico ANTERIOR a ele — nunca com a lista inteira já empurrada.

    for (const box of res.closedBoxes) {

      shadowRobotService.processClosedBox(box, eng.getBoxes().slice(0, box.index), eff, eng.getRegimeMeter());

    }

  }, [ensureShadowEngine]);



  const [orders, setOrders] = useState<TradeOrder[]>(() => {
    // Purga ordens fantasmas e ordens abertas órfãs de TODOS os ativos no storage
    OrderAuditService.purgeOrphanOpenOrders();

    // Troca do preço de referência do ativo: o pregão salvo no preço antigo é saneado UMA vez,
    // antes de qualquer leitura. O aviso ao operador sai no efeito de montagem.
    assetMigrationRef.current = migrateAssetBaseline(asset);

    const saved = OrderAuditService.loadIntradayOrders(asset);
    if (saved && saved.length > 0) {
      // No boot do app (sem MT5 conectado), NUNCA restauramos ordens com status OPEN ou PENDING_LIMIT
      return saved.filter((o) => o.status !== 'OPEN' && o.status !== 'PENDING_LIMIT');
    }

    return [];
  });

  const [latestToast, setLatestToast] = useState<{

    id: string;

    type: 'BUY' | 'SELL' | 'INFO';

    title: string;

    description: string;

    timestamp: number;

    // Notificações de ordens (execução/envio) só aparecem na aba Gráfico; avisos operacionais

    // críticos (ponte, segurança, travas) seguem visíveis em qualquer aba.

    chartOnly?: boolean;

  } | null>(null);

  // Trava das notificações de ordens (silencia toasts de compra/venda na tela)
  const [orderNotifsMuted, setOrderNotifsMuted] = useState<boolean>(() => {
    try {
      return localStorage.getItem('fluxo_order_notifs_muted_v1') === '1';
    } catch {
      return false;
    }
  });

  const handleToggleOrderNotifs = useCallback(() => {
    setOrderNotifsMuted((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('fluxo_order_notifs_muted_v1', next ? '1' : '0');
      } catch {}
      return next;
    });
  }, []);

  // Estado da Conexão MT5 Live Bridge

  const [mt5State, setMt5State] = useState<MT5ConnectionState>({

    status: 'DISCONNECTED',

  });

  const wsRef = useRef<WebSocket | null>(null);

  // Começa em `true`: sem pedido do operador, a ponte NÃO é tocada (regra do Ciclo 12 — o
  // Por padrão nasce falso para auto-conectar à ponte se ela estiver ativa na rede/local.
  // Só vira `true` se o usuário clicar explicitamente em Desconectar.
  const userDisconnectedRef = useRef(false);

  const multiRobotPositions: PositionSummary[] = useMemo(() => {
    const posArray = Array.isArray(mt5State.positions) ? mt5State.positions : [];
    return posArray.map((p: any) => ({
      symbol: String(p.symbol || ''),
      magic: Number(p.magic) || 0,
      type: (p.type === 0 || p.type === 'BUY' || String(p.type).toUpperCase() === 'BUY') ? 'BUY' : 'SELL',
      volume: Number(p.volume) || 1,
      profit: Number(p.profit) || 0,
      openPrice: Number(p.price_open) || 0,
    }));
  }, [mt5State.positions]);

  const handleOpenMultiRobotWindow = (assetId: MultiRobotId) => {
    setFocusedRobotAsset(assetId);
    setShadowWindowOpen(true);
    setActiveTab('chart');
  };

  const handleChangeRobotState = (assetId: MultiRobotId, patch: Partial<RobotRuntimeState>) => {
    setMultiRobotStates((prev) => {
      const next = {
        ...prev,
        [assetId]: {
          ...prev[assetId],
          ...patch,
        },
      };
      if (patch.mode && wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(
          JSON.stringify({
            action: 'SET_ROBOT_MODE',
            assetKey: assetId,
            mode: patch.mode,
          })
        );
      }
      return next;
    });
  };

  const handleExecuteMultiRobotSignal = (assetId: MultiRobotId, signal: 'BUY' | 'SELL') => {
    const spec = MULTI_ROBOTS[assetId];
    const rState = multiRobotStates[assetId] || { contracts: spec.defaultContracts, slPoints: spec.defaultSlPoints, tpPoints: spec.defaultTpPoints };

    console.log(`[COPILOTO] Disparando ordem: ${assetId} (${spec.symbol}) ${signal} ${rState.contracts}ct | Magic=${spec.magic}`);

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          action: 'ORDER_SEND',
          symbol: spec.symbol,
          type: signal,
          contracts: rState.contracts,
          sl: rState.slPoints,
          tp: rState.tpPoints,
          magic: spec.magic,
          comment: `COPILOT_${assetId}`,
        })
      );
      setLatestToast({
        id: `copilot-${Date.now()}`,
        type: signal,
        title: `⚡ COPILOTO: ${signal} EM ${spec.label}`,
        description: `Ordem enviada ao MT5 com Magic ${spec.magic} (${rState.contracts} ctro, SL ${rState.slPoints}p, TP ${rState.tpPoints}p).`,
        timestamp: Date.now(),
      });
    } else {
      console.warn('[COPILOTO] Falha ao enviar ordem: WebSocket desconectado ou não pronto.', wsRef.current?.readyState);
      setLatestToast({
        id: `err-${Date.now()}`,
        type: 'SELL',
        title: 'FALHA DE ENVIO',
        description: 'Ponte MT5 desconectada ou reconectando. Aguarde a reconexão.',
        timestamp: Date.now(),
      });
    }
  };

  const handleManualMultiRobotOrder = (assetId: MultiRobotId, type: 'BUY' | 'SELL') => {
    handleExecuteMultiRobotSignal(assetId, type);
  };

  const handleCloseMultiRobotPosition = (assetId: MultiRobotId) => {
    const spec = MULTI_ROBOTS[assetId];
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          action: 'CLOSE_POSITIONS',
          symbol: spec.symbol,
          robotMagic: spec.magic,
        })
      );
      setLatestToast({
        id: `close-${Date.now()}`,
        type: 'INFO',
        title: `ZERAGEM: ${spec.label}`,
        description: `Solicitada a zeragem das posições com Magic ${spec.magic} no MT5.`,
        timestamp: Date.now(),
      });
    }
  };

  const handleUpdateVaralConfig = (assetId: MultiRobotId, patch: any) => {
    const spec = MULTI_ROBOTS[assetId];
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          action: 'SET_VARAL_CONFIG',
          symbol: spec.symbol,
          config: patch,
        })
      );
    }
    setMt5State((prev) => ({
      ...prev,
      varalConfig: {
        ...(prev.varalConfig || {}),
        [assetId]: {
          ...((prev.varalConfig && prev.varalConfig[assetId]) || {}),
          ...patch,
        },
      },
    }));
  };

  const handleClearVaral = (assetId: MultiRobotId) => {
    const spec = MULTI_ROBOTS[assetId];
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          action: 'CLEAR_VARAL',
          symbol: spec.symbol,
        })
      );
      setLatestToast({
        id: `clear-varal-${Date.now()}`,
        type: 'INFO',
        title: `VARAL LIMPO: ${spec.label}`,
        description: `Ordens pendentes canceladas e posições do Varal zeradas no MT5.`,
        timestamp: Date.now(),
      });
    }
  };

  const handleResetRiskLock = (targetAssetId?: MultiRobotId) => {
    const assetKey = targetAssetId || focusedRobotAsset || 'WIN';
    const spec = MULTI_ROBOTS[assetKey];
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          action: 'RESET_RISK_LOCK',
          symbol: spec?.symbol || chartSymbolFor(asset),
        })
      );
      setLatestToast({
        id: `reset-risk-${Date.now()}`,
        type: 'INFO',
        title: '🔓 TRAVA DE RISCO REARMADA',
        description: `Limites diários de perda resetados para ${spec?.label || asset.label}. Robô liberado para novas operações.`,
        timestamp: Date.now(),
      });
    }
  };



  // Instâncias dos motores de cálculo

    // Repositório de feeds, motores e Times & Trades INDEPENDENTES por ativo
  const assetStateRef = useRef<Record<AssetId, {
    ticks: Tick[];
    boxes: RenkoBox[];
    sessionGaps: SessionGap[];
    currentBox: Partial<RenkoBox> | null;
    currentPrice: number;
    cvd: number;
    rangeBoxes: RenkoBox[];
    rangeCurrentBox: Partial<RenkoBox> | null;
    timeBoxes: RenkoBox[];
    timeCurrentBox: Partial<RenkoBox> | null;
    engine: RenkoFlowEngine;
    rangeEngine: RangeBarEngine;
    timeEngine: TimeBarEngine;
    allTicks: Tick[];
  }>>({
    WIN: {
      ticks: [],
      boxes: [],
      sessionGaps: [],
      currentBox: null,
      currentPrice: referencePrice(ASSETS.WIN),
      cvd: 0,
      rangeBoxes: [],
      rangeCurrentBox: null,
      timeBoxes: [],
      timeCurrentBox: null,
      engine: new RenkoFlowEngine(50, ASSETS.WIN),
      rangeEngine: new RangeBarEngine(100),
      timeEngine: new TimeBarEngine(30000),
      allTicks: [],
    },
    WDO: {
      ticks: [],
      boxes: [],
      sessionGaps: [],
      currentBox: null,
      currentPrice: referencePrice(ASSETS.WDO),
      cvd: 0,
      rangeBoxes: [],
      rangeCurrentBox: null,
      timeBoxes: [],
      timeCurrentBox: null,
      engine: new RenkoFlowEngine(2.5, ASSETS.WDO),
      rangeEngine: new RangeBarEngine(5),
      timeEngine: new TimeBarEngine(30000),
      allTicks: [],
    },
    BTCBR: {
      ticks: [],
      boxes: [],
      sessionGaps: [],
      currentBox: null,
      currentPrice: referencePrice(ASSETS.BTCBR),
      cvd: 0,
      rangeBoxes: [],
      rangeCurrentBox: null,
      timeBoxes: [],
      timeCurrentBox: null,
      engine: new RenkoFlowEngine(200, ASSETS.BTCBR),
      rangeEngine: new RangeBarEngine(400),
      timeEngine: new TimeBarEngine(30000),
      allTicks: [],
    },

  });

  const activeAssetIdRef = useRef<AssetId>(asset.id);
  useEffect(() => {
    activeAssetIdRef.current = asset.id;
  }, [asset.id]);

  const activeAssetRef = useRef<AssetSpec>(asset);
  useEffect(() => {
    activeAssetRef.current = asset;
  }, [asset]);

  const currentPriceRef = useRef<number>(currentPrice);
  useEffect(() => {
    currentPriceRef.current = currentPrice;
  }, [currentPrice]);

  const simulatorRef = useRef<B3MarketSimulator>(new B3MarketSimulator(referencePrice(asset), asset));



  // Inicialização: âncora de preço nos motores, TELA PARADA e VAZIA (Ciclo 12).

  // Antes este efeito sintetizava 350 ticks de boot para "popular" o gráfico — história falsa,

  // sorteada de novo a cada F5, que se passava pelo pregão de ontem. O histórico de ontem NÃO

  // mora no navegador (o que persiste são ordens/auditoria/estatísticas do coletor): para ver

  // a série de ontem ou mais, o operador dá o comando — ▶ SIM (feed vivo), setinha (replay) ou

  // histórico real pela ponte MT5. O gráfico acorda com "Aguardando ticks…".

  useEffect(() => {

    const reference = referencePrice(asset);

    engineRef.current.initialize(reference);

    rangeEngineRef.current.setRangePoints(rangePoints);

    rangeEngineRef.current.initialize(reference);

    timeEngineRef.current.setIntervalMs(timeframeSec * 1000);

    timeEngineRef.current.initialize(reference);

    // Restaura cache imediato da sessão atual (evita sumir o histórico no F5 ou HMR do Vite)
    try {
      const rawCache = sessionStorage.getItem(`fluxo_chart_cache_v1_${asset.id}`);
      if (rawCache) {
        const parsed = JSON.parse(rawCache);
        if (Array.isArray(parsed?.boxes) && parsed.boxes.length > 0) {
          const cachedBoxes: RenkoBox[] = parsed.boxes;
          const lastCached = cachedBoxes[cachedBoxes.length - 1];
          const cachedPrice = Number(parsed.currentPrice) || lastCached.close || reference;
          const cachedCvd = Number(parsed.cvd) || lastCached.cvdAtClose || 0;
          engineRef.current.setBoxPoints(Number(parsed.boxPoints) || config.boxPoints);
          engineRef.current.loadBackfillBoxes(cachedBoxes, cachedPrice, cachedCvd);
          setBoxes(cachedBoxes);
          setSessionGaps([...engineRef.current.getSessionGaps()]);
          setCurrentPrice(cachedPrice);
          setCurrentBox(engineRef.current.getCurrentBox());
          setCvd(cachedCvd);
          const synth = synthesizeTicksFromBoxes(cachedBoxes);
          if (synth.length > 0) {
            allTicksRef.current = synth;
            const curState = assetStateRef.current[asset.id];
            if (curState) {
              curState.boxes = cachedBoxes;
              curState.currentPrice = cachedPrice;
              curState.cvd = cachedCvd;
              curState.allTicks = [...synth];
              curState.engine.setBoxPoints(Number(parsed.boxPoints) || config.boxPoints);
              curState.engine.loadBackfillBoxes(cachedBoxes, cachedPrice, cachedCvd);
              curState.sessionGaps = [...curState.engine.getSessionGaps()];
            }
            rangeEngineRef.current.initialize(synth[0].price, synth[0].timestamp);
            for (const st of synth) rangeEngineRef.current.processTick(st);
            setRangeBoxes([...rangeEngineRef.current.getBoxes()]);
            setRangeCurrentBox(rangeEngineRef.current.getCurrentBox());
          }
        }
      }
    } catch {
      // ignora falha de sessionStorage
    }

    // Escalas paralelas 15R/20R/25R começam sincronizadas com o mercado (só o coletor usa)

    ALT_RENKO_SCALES.forEach((alt) => altEnginesRef.current[alt.key].initialize(reference));

    // Robô 2 (sombra) na mesma régua — se estiver ligado com estratégia válida

    if (shadowRobotService.getEffectiveConfig()) {

      const sEng = ensureShadowEngine();

      if (sEng) sEng.initialize(reference);

    }

    // A SOMBRA ACORDA ZERADA como a boleta: o livro do dia anterior (replays + simulação) não
    // reabre no F5 — quem persiste entre sessões são só as ESCOLHAS (ligada, estratégia, escala,
    // ativo). Sem isto o Robô 2 acordava somando os trades de todas as corridas de hoje enquanto
    // a boleta e o gráfico acordavam vazios (regra do operador, Ciclo 12).
    shadowRobotService.resetBook();

    // Se o MT5 não está conectado, força a boleta e o livro a acordarem 100% zerados de posições abertas
    OrderAuditService.purgeOrphanOpenOrders();
    setOrders([]);

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Higienização de ordens ativas: garante que ordens de outros ativos NUNCA permaneçam em memória
  useEffect(() => {
    setOrders((currentOrders) => {
      const saneOrders = currentOrders.filter((o) => isOrderForAsset(o, asset));
      if (saneOrders.length !== currentOrders.length) {
        OrderAuditService.saveIntradayOrders(saneOrders, asset.id);
        return saneOrders;
      }
      return currentOrders;
    });
  }, [asset]);

  // Salva o histórico visível na sessão do navegador para nunca sumir em edições, HMR ou F5
  useEffect(() => {
    if (boxes.length === 0) return;
    try {
      sessionStorage.setItem(
        `fluxo_chart_cache_v1_${asset.id}`,
        JSON.stringify({
          boxes: boxes.slice(-4000),
          currentPrice,
          cvd,
          boxPoints: config.boxPoints,
          updatedAt: Date.now(),
        })
      );
    } catch {
      // ignora quota
    }
  }, [boxes, currentPrice, cvd, asset.id, config.boxPoints]);



  // Escala do box (R) editável no gráfico: além de informar o motor, recalcula TODA a história

  // nos ticks guardados — trocar 10R por 8R/9R/15R/25R/29R redesenha o pregão inteiro na escala

  // nova na hora, que é o que permite testar. O `initialize()` reseta o medidor de regime, mas

  // mantém a MESMA referência de objeto, então o registro no coletor continua valendo.

  const prevBoxPointsRef = useRef<number>(config.boxPoints);
  useEffect(() => {
    const boxPointsChanged = prevBoxPointsRef.current !== config.boxPoints;
    prevBoxPointsRef.current = config.boxPoints;

    const eng = engineRef.current;
    // Se a escala não mudou e já temos boxes carregados na tela, não reinicializa nem apaga nada
    if (!boxPointsChanged && eng.getBoxes().length > 0) {
      return;
    }

    eng.setBoxPoints(config.boxPoints);
    let hist = allTicksRef.current;
    if (hist.length < boxes.length * 2 && boxes.length > 0) {
      hist = synthesizeTicksFromBoxes(boxes);
      allTicksRef.current = hist;
      const curState = assetStateRef.current[asset.id];
      if (curState) curState.allTicks = [...hist];
    }

    if (hist.length > 0) {
      const isHistSane = hist[0] && hist[0].price > 0 && Math.abs(hist[0].price - asset.basePrice) / asset.basePrice < 0.4;
      if (isHistSane) {
        eng.initialize(hist[0].price, hist[0].timestamp);
        for (const t of hist) eng.processTick(t, config);
        const rebuilt = eng.getBoxes();
        if (rebuilt.length > 0) {
          setBoxes([...rebuilt]);
          setSessionGaps([...eng.getSessionGaps()]);
          setCurrentBox(eng.getCurrentBox());
          setCvd(eng.getCvd());

          // Sincroniza o repositório do ativo em memória
          const curState = assetStateRef.current[asset.id];
          if (curState) {
            curState.boxes = [...rebuilt];
            curState.sessionGaps = [...eng.getSessionGaps()];
            curState.currentBox = eng.getCurrentBox();
            curState.cvd = eng.getCvd();
          }
        }
      }
    }

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ action: 'SET_BOX_POINTS', boxPoints: config.boxPoints, symbol: chartSymbolFor(asset) }));
      if (boxPointsChanged || boxes.length === 0) {
        wsRef.current.send(JSON.stringify({ action: 'GET_BACKFILL', symbol: chartSymbolFor(asset), days: 5, boxPoints: config.boxPoints }));
      }
    }
  }, [config.boxPoints]);



  // Paridade de regras: o que está ligado na tela é o que a ponte usa para julgar o box.
  // Antes deste sync, mexer em limiar adaptativo, filtro de acumulação ou de exaustão no app não
  // alterava nada no robô — a tela mostrava sinal filtrado e a ponte operava outro critério.
  useEffect(() => {

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(EaConfigService.buildBridgeSyncMessage(config));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps

  }, [

    config.strategyMode,

    config.minDeltaThreshold,

    config.adaptiveThresholdEnabled,

    config.regimeLookbackBoxes,

    config.consolidationFilterEnabled,

    config.consolidationLookbackBoxes,

    config.consolidationErMax,

    config.exhaustionFilterEnabled,

    config.exhaustionDeltaRatio,

    config.requireCvdNewExtreme,

    config.symbol,

  ]);



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



  // Recalcula toda a história em Range quando a escala mudar ou quando alternar para Range
  const rebuildRangeSeries = useCallback((targetPoints?: number) => {
    const pts = targetPoints ?? rangePoints;
    const eng = rangeEngineRef.current;
    eng.setRangePoints(pts);

    let hist = allTicksRef.current;
    if (hist.length === 0 && boxes.length > 0) {
      hist = synthesizeTicksFromBoxes(boxes);
      allTicksRef.current = hist;
    }

    if (hist.length > 0) {
      eng.initialize(hist[0].price, hist[0].timestamp);
      for (const t of hist) eng.processTick(t);
    }
    const bxs = [...eng.getBoxes()];
    setRangeBoxes(bxs);
    setRangeCurrentBox(eng.getCurrentBox());
    return bxs;
  }, [rangePoints, boxes]);

  useEffect(() => {
    rebuildRangeSeries(rangePoints);
  }, [rangePoints, chartSeries, rebuildRangeSeries]);



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



  // =========================================================================================

  // ROBÔ 2 (SOMBRA) — corrida.

  // O config efetivo é o snapshot da estratégia escolhida com `boxPoints` rederivado do R

  // pedido no tick do ativo atual. Nada aqui toca `setOrders`, a auditoria de ordens ou o

  // websocket da ponte: a blindagem da sombra é exatamente não existir esse wiring.

  //

  // Ligar/desligar é um `setState` do config → o efeito reconfigura e, ao desligar, derruba o

  // motor (o livro fica no storage para o F5 não apagar a corrida). Ao TROCAR estratégia,

  // escala ou ativo o service reinicia o livro — a curva de capital passa a ser de outra

  // corrida e misturar as duas seria leitura errada — e o motor vai junto: o 1º tick seguinte

  // recria o motor já no preço vivo (sem inventar boxes).

  // =========================================================================================

  useEffect(() => {

    const eff = shadowRobotService.configure(config.shadowRobot, asset, config);

    if (!eff) {

      shadowEngineRef.current = null;

      return;

    }

    const eng = ensureShadowEngine();

    if (!eng) return;

    if (eng.getBoxes().length > 0 && eng.getBoxPoints() !== eff.boxPoints) {

      // Escala trocada no meio da corrida: os tijolos velhos são de outra régua, o motor vai fora

      shadowEngineRef.current = null;

      ensureShadowEngine();

      return;

    }

    // LIGADA NO MEIO DO PREGÃO (fora do replay, que já realinha o motor na abertura da corrida):

    // um motor recém-criado está ancorado no preço de referência do boot ou num ontem parado.

    // Realinha no preço vivo para o 1º tijolo da sombra nascer de hoje.

    const anchor = eng.getCurrentBox()?.timeEnd ?? 0;

    if (!isReplaying && Math.abs(Date.now() - anchor) > 90_000 && currentPrice > 0) {

      eng.initialize(currentPrice);

    }

    // eslint-disable-next-line react-hooks/exhaustive-deps

  }, [

    config.shadowRobot?.enabled,

    config.shadowRobot?.strategyId,

    config.shadowRobot?.scaleR,

    asset.id,

    // a estratégia da biblioteca pode ter sido salva/editada/apagada com a sombra já ligada

    StrategyLibraryService.list().map((s) => `${s.id}:${s.updatedAt}`).join('|'),

  ]);



  // Função para processar a execução de um tick

  // CARGA DO PREGÃO (SESSION_BACKFILL da ponte): ticks ESTIMADOS a partir das barras de 1 min do

  // MT5 (abertura/mínima/máxima/fechamento — preço real, volume/agressão/delta aproximados). Serve

  // SÓ para desenhar o gráfico do dia ao conectar: não passa pela fita de Times & Trades, não

  // alimenta coletor, Robô Sombra, robô principal, ordens, PnL nem a Boleta. Dado estimado nunca

  // vira operação nem é rotulado como real.

  const handleBackfillTicks = useCallback(

    (backfill: Tick[]) => {

      if (!Array.isArray(backfill) || backfill.length === 0) return;

      const engine = engineRef.current;

      const rangeEng = rangeEngineRef.current;

      const timeEng = timeEngineRef.current;



      // Ancoragem na abertura do dia recebido:

      const firstTick = backfill[0];

      if (firstTick && firstTick.price > 0) {

        engine.initialize(firstTick.price, firstTick.timestamp);

        rangeEng.initialize(firstTick.price);

        timeEng.initialize(firstTick.price);

      }



      // Popula buffer de histórico para não sumir o gráfico ao alternar escalas ou parâmetros

      allTicksRef.current = [...backfill];



      for (const raw of backfill) {

        if (!raw || !(raw.price > 0)) continue;

        engine.processTick(raw, config);

        rangeEng.processTick(raw);

        timeEng.processTick(raw);

      }

      setBoxes([...engine.getBoxes()]);

      setSessionGaps([...engine.getSessionGaps()]);

      setCurrentBox(engine.getCurrentBox());

      setCvd(engine.getCvd());

      setRangeBoxes([...rangeEng.getBoxes()]);

      setRangeCurrentBox(rangeEng.getCurrentBox());

      setTimeBoxes([...timeEng.getBoxes()]);

      setTimeCurrentBox(timeEng.getCurrentBox());

      setCurrentPrice(backfill[backfill.length - 1].price);

    },

    [config]

  );



  const handleIncomingTick = useCallback(
    (tick: Tick) => {
      const currentActiveId = activeAssetIdRef.current;
      const currentAssetSpec = ASSETS[currentActiveId] || asset;
      // Guarda de sanidade: rejeita ticks de ativos diferentes para não contaminar o motor da tela
      if (
        !tick ||
        !Number.isFinite(tick.price) ||
        tick.price <= 0 ||
        Math.abs(tick.price - currentAssetSpec.basePrice) / currentAssetSpec.basePrice >= 0.4
      ) {
        return;
      }

      // Tick vindo do MT5 (corretora): marca o coletor como "dia real." Assim um replay

      // manual rodado depois jamais apaga uma coleta verdadeira já registrada hoje

      if (mt5State.status === 'CONNECTED') seriesCollectorService.markRealData();

      // Régua do ativo (Fase 2): o basePrice fixo do registro envelhece, então o último preço REAL

      // visto é persistido (escrita amortecida a cada ~30s por aba) para eixo Y, partida do

      // sintético e tolerância do sanitizador sobreviverem ao F5 sem depender da corretora.

      if (mt5State.status === 'CONNECTED' && tick.price > 0) {

        const now = Date.now();

        if (now - lastPriceWriteRef.current > 30_000) {
          lastPriceWriteRef.current = now;
          const tickSym = String((tick as any).symbol || config.symbol || '').toUpperCase();
          const tickAssetId = resolveAsset(tickSym).id;
          rememberLastPrice(tickAssetId, tick.price);
        }

      }

      // Trava de fim de pregão (hora `tradingCloseAllTime` da estratégia, padrão 17:30):
      // No Replay ou simulador, fecha obrigatoriamente às 17:30 no preço das 17:30 para proteger o lucro do dia.
      const closeLockLabel = sessionCloseLockLabel(config.tradingCloseAllTime);
      const isReplayMode = isReplayingRef.current;
      const sessionLock = (isReplayMode || mt5State.status !== 'CONNECTED') && isSessionCloseLock(tick.timestamp, config.tradingCloseAllTime, isReplayMode);
      const engine = engineRef.current;

      // Processa no motor de Renko (escala do box da config) e Fluxo
      const renkoRes = engine.processTick(tick, config);

      // Alimenta as séries experimentais (Range e Tempo) com o mesmo fluxo de ticks
      if (allTicksRef.current.length < 50000) allTicksRef.current.push(tick);
      const rangeEng = rangeEngineRef.current;
      const timeEng = timeEngineRef.current;
      // A janela do medidor segue a config (Range/Tempo; Renko sincroniza dentro do próprio motor)
      rangeEng.getRegimeMeter().setLookbackBoxes(config.regimeLookbackBoxes ?? 20);
      timeEng.getRegimeMeter().setLookbackBoxes(config.regimeLookbackBoxes ?? 20);
      const rangeRes = rangeEng.processTick(tick);
      const timeRes = timeEng.processTick(tick);

      // =========================================================================
      // BUFFER DE ATUALIZAÇÃO VISUAL (60 FPS via requestAnimationFrame)
      // Desacopla a ingestão de alta frequência dos re-renders do React
      // =========================================================================
      const buf = pendingUiUpdateRef.current;
      buf.latestPrice = tick.price;
      buf.pendingTicks.push(tick);
      if (renkoRes.newBoxClosed) buf.boxesChanged = true;
      if (rangeRes.newBarClosed) buf.rangeBoxesChanged = true;
      if (timeRes.newBarClosed) buf.timeBoxesChanged = true;

      if (!buf.scheduled) {
        buf.scheduled = true;
        requestAnimationFrame(() => {
          buf.scheduled = false;
          if (buf.latestPrice > 0) setCurrentPrice(buf.latestPrice);
          if (buf.pendingTicks.length > 0) {
            const batch = buf.pendingTicks;
            buf.pendingTicks = [];
            // Novos ticks entram na frente (mais recentes primeiro) sem descartar negócios intermediários
            setTicks((prev) => [...batch.reverse(), ...prev].slice(0, 150));
          }
          const eng = engineRef.current;
          setCvd(eng.getCvd());
          setCurrentBox(eng.getCurrentBox());
          if (buf.boxesChanged) {
            setBoxes([...eng.getBoxes()]);
            setSessionGaps([...eng.getSessionGaps()]);
            buf.boxesChanged = false;
          }
          const rEng = rangeEngineRef.current;
          setRangeCurrentBox(rEng.getCurrentBox());
          if (buf.rangeBoxesChanged || (chartSeries === 'range' && rEng.getBoxes().length !== rangeBoxes.length)) {
            setRangeBoxes([...rEng.getBoxes()]);
            buf.rangeBoxesChanged = false;
          }
          const tEng = timeEngineRef.current;
          setTimeCurrentBox(tEng.getCurrentBox());
          if (buf.timeBoxesChanged) {
            setTimeBoxes([...tEng.getBoxes()]);
            buf.timeBoxesChanged = false;
          }
        });
      }

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
      if (renkoRes.newBoxClosed) {
        // Preenchimento Renko: um tick pode fechar vários boxes — o coletor recebe TODOS,
        // cada um com o histórico anterior ao próprio box.
        for (const box of renkoRes.closedBoxes) {
          seriesCollectorService.ingest(
            'renko',
            box,
            engine.getBoxes().slice(0, box.index),
            config,
            renkoScaleLabel(config.boxPoints, asset),
            engine.getRegimeMeter()
          );
        }
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

        for (const box of altRes.closedBoxes) {

          seriesCollectorService.ingest(alt.key, box, altEng.getBoxes().slice(0, box.index), config, `${alt.pts} pts`, altEng.getRegimeMeter());

        }

      }



      // ROBÔ 2 (sombra): motor e livro próprios, na escala e estratégia escolhidas. Roda com o

      // robô principal desligado e não obedece a `config.active` nem às travas dele.

      shadowRobotService.markToMarket(tick.price, tick.timestamp, mt5State.status === 'CONNECTED');

      feedShadowEngine(tick);



      // =========================================================================

      // ROBÔ NA SÉRIE ATIVA (Opção A): as ordens são disparadas pela série

      // escolhida na barra do gráfico. Séries inativas só alimentam o coletor.

      // =========================================================================

      // A etiqueta do robô segue a escala definida no gráfico: o auditor lê aqui o box que

      // realmente formou o sinal (8R, 9R, 15R...), nunca um "10R" de quando a escala era fixa.

      const renkoTagShort = renkoScaleLabel(config.boxPoints, asset);

      const mt5TagShort = chartSeries === 'renko' ? renkoTagShort : `RNG${rangePoints}`;

      const robotTag = chartSeries === 'renko' ? `Renko ${renkoTagShort}` : `Range ${rangePoints}pts`;

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

          // ESTRATÉGIA 1: PIRÂMIDE COM CONFLUÊNCIA DE FLUXO & RENKO (escala do box da config)

          // (Compre no fechamento de cada bloco verde com TP de 50p, mantendo a principal

          // aberta até a virada de fluxo. Zeragem total por inversão sem SL fixo).

          // =========================================================================

          if (config.strategyMode === 'PYRAMID_FLOW_CONFLUENCE' || config.strategyMode === 'SIGNAL_STACK') {

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

                  if ((o.status === 'OPEN' || o.status === 'PENDING_LIMIT') && o.type === oppositeType && isOrderForAsset(o, asset)) {
                    if (!isPriceSaneForAsset(tick.price, asset) || !isPriceSaneForAsset(o.entryPrice, asset)) return o;

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

                  chartOnly: true,

                  timestamp: Date.now(),

                });



                if (mt5State.status === 'CONNECTED' && wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {

                  wsRef.current.send(JSON.stringify({ action: 'CLOSE_POSITIONS', robotMagic: mainRobotMagic(config) }));

                }

              }



              // 2. DISPARO NA DIREÇÃO ATUAL:

              // Apenas se o robô estiver ativo e dentro do horário configurado

              if (!config.active && !(isReplayingRef.current && replayOperates)) {

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

                    wsRef.current.send(JSON.stringify({ action: 'CLOSE_POSITIONS', robotMagic: mainRobotMagic(config) }));

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

                    magicNumber: mainRobotMagic(config),

                    triggerReason: `Entrada Principal ${signalType === 'BUY' ? 'Compra' : 'Venda'} (${robotTag} — Surfe até Virada do Fluxo)`,

                    isRealMT5: mt5State.status === 'CONNECTED',

                    auditTrail: [mainEvt],

                  };



                  setLatestToast({

                    id: `main-toast-${Date.now()}`,

                    type: signalType,

                    chartOnly: true,

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

                    symbol: config.symbol || (asset.activeContract || asset.primarySymbol),

                    type: signalType,

                    isLimit: useLimitEntry,

                    limitPrice: useLimitEntry ? pyrLimitPrice : undefined,

                    contracts: config.contracts,

                    comment: `PIRAMIDE_MAIN_${signalType}_${mt5TagShort}`,

                    magic: mainRobotMagic(config),

                    timestamp: tick.timestamp,

                  });

                } else {

                  // Ordem da Pirâmide (Subadd com TP de 50 pontos)

                  const pyramidOrders = openSameSide.filter((o) => o.role === 'PYRAMID');

                  const pyramidLevel = pyramidOrders.length + 1;

                  // ACUMULAÇÃO C/V: nenhum alvo e nenhum stop por contrato — a única saída é o
                  // sinal oposto. Zero aqui é intencional e é o que a estratégia promete.
                  const isSignalStack = config.strategyMode === 'SIGNAL_STACK';
                  const tpPoints = isSignalStack
                    ? 0
                    : config.strategyMode === 'PYRAMID_FLOW_CONFLUENCE'
                    ? Math.max(config.boxPoints, config.pyramidTpPoints || config.boxPoints)
                    : (config.pyramidTpPoints || 50);

                  // TP/SL são ancorados no preço real de entrada (fechamento ou nível do Limit)

                  const entryAnchor = useLimitEntry ? pyrLimitPrice : tick.price;

                  const targetTp =

                    signalType === 'BUY' ? entryAnchor + tpPoints : entryAnchor - tpPoints;

                  const pyrContracts = config.pyramidContracts || 1;

                  // Stop OPCIONAL da pirâmide: 0 = sem stop fixo (saída só pela inversão do fluxo)

                  const pyrSlPoints = !isSignalStack && (config.pyramidSlPoints ?? 0) > 0 ? config.pyramidSlPoints : 0;

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

                    stopLoss: isSignalStack ? 0 : targetSl,

                    takeProfit: isSignalStack ? 0 : targetTp,

                    status: useLimitEntry ? 'PENDING_LIMIT' : 'OPEN',

                    source: mt5State.status === 'CONNECTED' ? 'MT5_LIVE' : 'ROBOT_EA',

                    magicNumber: mainRobotMagic(config),

                    triggerReason: `Pirâmide #${pyramidLevel} ${signalType === 'BUY' ? 'Compra' : 'Venda'} ${robotTag} (+${tpPoints}p TP)`,

                    isRealMT5: mt5State.status === 'CONNECTED',

                    auditTrail: [pyrEvt],

                  };



                  setLatestToast({

                    id: `pyr-toast-${Date.now()}`,

                    type: signalType,

                    chartOnly: true,

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

                    symbol: config.symbol || (asset.activeContract || asset.primarySymbol),

                    type: signalType,

                    isLimit: useLimitEntry,

                    limitPrice: useLimitEntry ? pyrLimitPrice : undefined,

                    contracts: pyrContracts,

                    tp: tpPoints,

                    sl: pyrSlPoints,

                    comment: `PIRAMIDE_SUB_${pyramidLevel}_${mt5TagShort}`,

                    magic: mainRobotMagic(config),

                    timestamp: tick.timestamp,

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

                    chartOnly: true,

                    timestamp: Date.now(),

                  });

                } else {

                  setLatestToast({

                    id: `ord-toast-${Date.now()}`,

                    type: signalType,

                    title: `ORDEM ${signalType === 'BUY' ? 'COMPRA' : 'VENDA'} DISPARADA A MERCADO [${robotTag}]`,

                    description: `${result.signalReason} a ${tick.price.toLocaleString('pt-BR')} pts`,

                    chartOnly: true,

                    timestamp: Date.now(),

                  });

                }



                sendEntryToBridgeOnce(tick.timestamp, {

                  action: 'ORDER_SEND',

                  symbol: config.symbol || (asset.activeContract || asset.primarySymbol),

                  type: signalType,

                  isLimit: isPullbackMode,

                  limitPrice: isPullbackMode ? limitPrice : undefined,

                  contracts: config.contracts,

                  sl: config.stopLossPoints,

                  tp: config.takeProfitPoints,

                  comment: isPullbackMode ? `Reteste ${signalType} ${mt5TagShort}` : `${mt5TagShort} ${signalType}`,

                  magic: mainRobotMagic(config),

                  timestamp: tick.timestamp,

                });

              };



              setOrders((prev) => {

                // Portões do Reteste — os MESMOS da Pirâmide. Este caminho não conferia

                // nada: disparava ordem até com o Robô desligado ou fora da janela.

                if (!config.active && !(isReplayingRef.current && replayOperates)) return prev;

                if (!isWithinTradingWindow(tick.timestamp, config)) return prev;



                // TRAVA FINANCEIRA: meta / perda / limite de trades batidos → para de abrir

                const finLockPullback = sessionFinancialLock(prev, config, sessionStartRef.current);

                if (finLockPullback) {

                  if (config.closeAllOnFinancialLock) {

                    const hadOpen = prev.some((o) => o.status === 'OPEN' || o.status === 'PENDING_LIMIT');

                    if (hadOpen && mt5State.status === 'CONNECTED' && wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {

                      wsRef.current.send(JSON.stringify({ action: 'CLOSE_POSITIONS', robotMagic: mainRobotMagic(config) }));

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

                    magicNumber: mainRobotMagic(config),

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

                    magicNumber: mainRobotMagic(config),

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
          const isManagedByMT5 = (Boolean(ord.ticket) || ord.isRealMT5) && mt5State.status === 'CONNECTED' && !isReplayMode;

          // SE FOR ORDEM LIMITADA PENDENTE DE PULLBACK
          if (ord.status === 'PENDING_LIMIT' && ord.limitPrice !== undefined) {
            // Se gerenciada pelo MT5, a corretora/terminal é quem comanda execução e expiração real
            if (isManagedByMT5) {
              return ord;
            }

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

                exitTimestamp: isReplayMode ? tick.timestamp : Date.now(),

                exitTimeStr: isReplayMode ? (tick.timeStr || new Date(tick.timestamp).toTimeString().split(' ')[0]) : new Date().toTimeString().split(' ')[0],

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

                chartOnly: true,

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

                chartOnly: true,

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

                exitTimestamp: isReplayMode ? tick.timestamp : Date.now(),

                exitTimeStr: isReplayMode ? (tick.timeStr || new Date(tick.timestamp).toTimeString().split(' ')[0]) : new Date().toTimeString().split(' ')[0],

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

            // C/V também entra aqui: sem alvo, sem stop e sem parcial por contrato — a única saída
            // é o sinal oposto. Sem essa marca, a C/V caía no ramo do Reteste e a parcial/breakeven
            // liquidavam a posição sozinhas (foi o que fechou a operação com o SL em zero).
            const isPyramidMode =
              config.strategyMode === 'PYRAMID_FLOW_CONFLUENCE' || config.strategyMode === 'SIGNAL_STACK';



            // 0. TRAVA DE FIM DE PREGÃO (apenas simulação local/replay; MT5 real é gerenciado pela ponte)
            if (sessionLock && !isManagedByMT5) {
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
                exitTimestamp: isReplayMode ? tick.timestamp : Date.now(),
                exitTimeStr: isReplayMode ? (tick.timeStr || new Date(tick.timestamp).toTimeString().split(' ')[0]) : new Date().toTimeString().split(' ')[0],
                exitReason: 'DAY_CLOSE' as const,
                pointsResult: points,
                financialResult: fin,
                auditTrail: ord.auditTrail ? [...ord.auditTrail, lockEvt] : [lockEvt],
              };
            }

            // 1. CHECAGEM DE REALIZAÇÃO PARCIAL (apenas simulação local/replay; no MT5 real a saída é executada via bridge/broker)
            if (!isManagedByMT5 && !isPyramidMode && config.enablePartialExit && !ord.partialExecuted && ord.contracts > 1) {

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

                  chartOnly: true,

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

                      robotMagic: mainRobotMagic(config),

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



            // 3. CHECAGEM DE TAKE PROFIT (apenas se configurado > 0 e NÃO for gerenciado pelo MT5 real)
            //    Para posições do MT5, a liquidação no TP é feita pela corretora e sincronizada pelo MT5_EQUITY_UPDATE.
            //    Liquidar localmente antes do broker causa conflito cíclico (abrir/fechar/abrir) e faz as ordens piscarem.
            const hitTP = !isManagedByMT5 && ord.takeProfit > 0 && (isBuy ? curPrice >= ord.takeProfit : curPrice <= ord.takeProfit);

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

                chartOnly: true,

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



            // 4. CHECAGEM DE STOP LOSS (apenas se configurado > 0 e NÃO for gerenciado pelo MT5 real)
            //    Para posições do MT5, a liquidação no SL é feita pela corretora e sincronizada pelo MT5_EQUITY_UPDATE.
            const hitSL = !isManagedByMT5 && currentSL > 0 && (isBuy ? curPrice <= currentSL : curPrice >= currentSL);

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

                JSON.stringify({ action: 'ORDER_MODIFY_SL', ticket: ord.ticket, newSL: beSL, robotMagic: mainRobotMagic(config) })

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

    [config, mt5State.status, chartSeries, rangePoints, timeframeSec, replayOperates]

  );



  // =========================================================================
  // SISTEMA DE AUDITORIA & LOG DE CONEXÃO MT5 (DETECÇÃO DE QUEDAS & DIAGNÓSTICO)
  // =========================================================================
  const [connectionLogs, setConnectionLogs] = useState<ConnectionLogEntry[]>([]);
  const [isConnLogModalOpen, setIsConnLogModalOpen] = useState<boolean>(false);
  const [connDisconnectCount, setConnDisconnectCount] = useState<number>(0);
  const [currentLatency, setCurrentLatency] = useState<number | null>(null);
  const [terminalConnected, setTerminalConnected] = useState<boolean>(true);
  const [sessionUptimeSeconds, setSessionUptimeSeconds] = useState<number>(0);

  const addConnectionLog = useCallback((
    type: 'INFO' | 'SUCCESS' | 'WARN' | 'ERROR',
    category: 'WEBSOCKET' | 'MT5_TERMINAL' | 'PING_LATENCY' | 'RECONNECT',
    message: string,
    extra?: { details?: string; code?: number; reason?: string; latencyMs?: number }
  ) => {
    const now = new Date();
    const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}.${String(now.getMilliseconds()).padStart(3, '0')}`;
    const entry: ConnectionLogEntry = {
      id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      timestamp: Date.now(),
      timeStr,
      type,
      category,
      message,
      ...extra,
    };
    setConnectionLogs((prev) => [entry, ...prev].slice(0, 200));
  }, []);

  // Heartbeat PING e contagem de Uptime ativo
  useEffect(() => {
    if (mt5State.status !== 'CONNECTED') return;

    const uptimeTimer = setInterval(() => {
      setSessionUptimeSeconds((s) => s + 1);
    }, 1000);

    const pingTimer = setInterval(() => {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        try {
          wsRef.current.send(JSON.stringify({ action: 'PING', timestamp: Date.now() }));
        } catch {}
      }
    }, 4000);

    return () => {
      clearInterval(uptimeTimer);
      clearInterval(pingTimer);
    };
  }, [mt5State.status]);

  const handleIncomingTickRef = useRef(handleIncomingTick);
  handleIncomingTickRef.current = handleIncomingTick;

  // Conexão WebSocket com o MetaTrader 5 (Local Bridge)
  const toggleMT5Connect = useCallback((manualAction?: 'CONNECT' | 'DISCONNECT', isRemoteSync?: boolean) => {
    // Quem ligar esta função direto em onClick (sem arrow) recebe o MouseEvent como primeiro
    // argumento. Um objeto de evento não é pedido de conexão: ele tem que ser tratado como
    // "toggle", senão o botão de desconectar passa reto no ramo de CONNECT e abre outra ponte.
    const pedido = manualAction === 'CONNECT' || manualAction === 'DISCONNECT' ? manualAction : undefined;

    if (pedido === 'DISCONNECT' || (pedido === undefined && (mt5State.status === 'CONNECTED' || mt5State.status === 'CONNECTING'))) {
      userDisconnectedRef.current = true;
      if (!isRemoteSync) {
        try {
          saasChannelRef.current?.postMessage({
            type: 'MT5_CONNECT_SYNC',
            action: 'DISCONNECT'
          });
        } catch {}
      }
      if (wsRef.current) {
        const oldWs = wsRef.current;
        wsRef.current = null;
        oldWs.onopen = null;
        oldWs.onmessage = null;
        oldWs.onerror = null;
        oldWs.onclose = null;
        try { oldWs.close(1000, 'User disconnect'); } catch {}
      }
      setMt5State({ status: 'DISCONNECTED' });
      addConnectionLog('INFO', 'WEBSOCKET', 'Desconexão manual solicitada pelo operador.');
      return;
    }

    // Evita abrir conexões duplicadas/órfãs se já houver um socket ativo ou conectando
    if (wsRef.current && (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING)) {
      return;
    }

    if (!isRemoteSync) {
      try {
        saasChannelRef.current?.postMessage({
          type: 'MT5_CONNECT_SYNC',
          action: 'CONNECT'
        });
      } catch {}
    }

    // Limpa qualquer socket residual antes de criar um novo
    if (wsRef.current) {
      const staleWs = wsRef.current;
      wsRef.current = null;
      staleWs.onopen = null;
      staleWs.onmessage = null;
      staleWs.onerror = null;
      staleWs.onclose = null;
      try { staleWs.close(); } catch {}
    }

    userDisconnectedRef.current = false;
    setMt5State({ status: 'CONNECTING' });
    const rawHost = (config.mt5Host || '').trim();
    let host = rawHost;
    if (!host || host.toLowerCase() === 'localhost') {
      if (typeof window !== 'undefined' && window.location.hostname && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
        host = window.location.hostname;
      } else {
        host = '127.0.0.1';
      }
    }
    const port = config.mt5Port || 8765;
    const wsUrl = `ws://${host}:${port}`;
    addConnectionLog('INFO', 'WEBSOCKET', `Iniciando conexão WebSocket com ${wsUrl}...`);

    try {
      syncBridgeTokenWithServer().catch(() => {});
      const socket = new WebSocket(wsUrl);
      wsRef.current = socket;

      socket.onopen = () => {
        if (wsRef.current !== socket) return;
        addConnectionLog('SUCCESS', 'WEBSOCKET', `Conexão WebSocket aberta com sucesso em ${wsUrl}. Realizando autenticação e subscrição...`);
        try {
          socket.send(JSON.stringify({ action: 'AUTH', token: getBridgeToken(), armed: config.active }));
          // Informa à ponte QUAL estratégia está ativa neste navegador. Sem o profileName a ponte
          // mantinha o default dela ("Janela de Fluxo & Agressão") e o devolvia em broadcast,
          // trocando a estratégia do operador a cada F5.
          strategyConnectAtRef.current = Date.now();
          try {
            const syncMsg = JSON.parse(EaConfigService.buildBridgeSyncMessage(config));
            const localName = activeStrategyNameRef.current;
            if (localName) syncMsg.profileName = localName;
            socket.send(JSON.stringify(syncMsg));
          } catch {
            socket.send(EaConfigService.buildBridgeSyncMessage(config));
          }
          socket.send(JSON.stringify({ action: 'GET_BACKFILL', symbol: chartSymbolFor(asset), days: 5, boxPoints: config.boxPoints }));
          socket.send(JSON.stringify({ action: 'LIST_LOCAL_PREGOES', symbol: chartSymbolFor(asset) }));
        } catch {}

        setMt5State({
          status: 'CONNECTED',
          brokerCompany: 'MetaTrader 5 Live Bridge',
        });
        setIsSimulating(false); // Pausa simulação quando conectado ao MT5 real
        // Preserva a integridade da boleta e da sessão caso esteja em replay ou reconectando
        if (!isReplayingRef.current) {
          sessionStartRef.current = Date.now();
        }
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
        if (wsRef.current !== socket) return;
        try {
          const payload = JSON.parse(event.data);

          // Resposta do Heartbeat PING / Diagnóstico de Latência
          if (payload.type === 'PONG') {
            const rtt = Math.max(0, Date.now() - (payload.clientTimestamp || Date.now()));
            setCurrentLatency(rtt);
            if (payload.terminalConnected !== undefined) {
              setTerminalConnected(payload.terminalConnected);
              if (!payload.terminalConnected) {
                addConnectionLog('WARN', 'MT5_TERMINAL', 'Alerta: Terminal MT5 reporta estar SEM SINAL com a corretora XP (queda de internet ou servidor XP offline).');
              }
            }
            if (rtt > 120) {
              addConnectionLog('WARN', 'PING_LATENCY', `Latência local alta detectada: ${rtt}ms (Processador da máquina sob carga).`, { latencyMs: rtt });
            }
            return;
          }

          // Alerta direto da ponte quando a conexão MT5 ↔ XP muda
          if (payload.type === 'BROKER_CONNECTION_STATUS') {
            setTerminalConnected(payload.connected);
            addConnectionLog(
              payload.connected ? 'SUCCESS' : 'ERROR',
              'MT5_TERMINAL',
              payload.connected
                ? `Sinal do MT5 com a corretora XP restabelecido (${payload.server || 'XP Live'}).`
                : `Alerta Crítico: Terminal MT5 perdeu sinal com os servidores da corretora XP!`,
              { details: payload.broker ? `Corretora: ${payload.broker}` : undefined }
            );
            return;
          }

          if (payload.type === 'AUTH_RESULT') {
            authResultSeen = true;
            const ok = Boolean(payload.data?.ok);
            const armed = Boolean(payload.data?.armed);
            const requireToken = Boolean(payload.data?.requireToken);

            addConnectionLog(
              ok ? 'SUCCESS' : 'ERROR',
              'WEBSOCKET',
              ok ? `Autenticação AUTH aprovada pelo servidor. Robô: ${armed ? 'ARMADO' : 'EM SEGURO'}` : 'Autenticação RECUSADA: Token incorreto.',
              { details: `requireToken: ${requireToken}, maxOrdersPerMin: ${payload.data?.maxOrdersPerMinute ?? 'N/A'}` }
            );

            setMt5State((prev) => ({ ...prev, bridgeAuthOk: ok, bridgeArmed: armed, bridgeLegacy: !requireToken }));
            if (payload.data?.armed !== undefined && Date.now() - strategyConnectAtRef.current >= 5000) {
              const serverArmed = Boolean(payload.data.armed);
              setConfig((prev) => {
                if (prev.active === serverArmed) return prev;
                isRemoteArmSyncRef.current = true;
                return { ...prev, active: serverArmed, lastSavedTimestamp: Date.now() };
              });
              setReplayOperates(serverArmed);
            }

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

              // Ponte recusada = tela para, não mercado fantasma automático (Ciclo 12).

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

              equity: payload.data.equity ?? prev.equity,

              floatingProfit: payload.data.floatingProfit ?? prev.floatingProfit,

              margin: payload.data.margin ?? prev.margin,

              marginFree: payload.data.marginFree ?? prev.marginFree,

              deals: (() => {
                const incoming = Array.isArray(payload.data.deals) ? payload.data.deals : [];
                const existing = Array.isArray(prev.deals) ? prev.deals : [];
                if (incoming.length === 0) return existing;
                if (existing.length === 0) return incoming;
                const byTicket = new Map<number, any>();
                for (const d of existing) {
                  if (d && d.ticket !== undefined) byTicket.set(Number(d.ticket), d);
                }
                for (const d of incoming) {
                  if (d && d.ticket !== undefined) byTicket.set(Number(d.ticket), d);
                }
                return Array.from(byTicket.values()).sort((a, b) => (Number(a.time) || 0) - (Number(b.time) || 0));
              })(),

              positions: payload.data.positions ?? prev.positions,

              // Qual contrato o script .py está transmitindo agora: se for outro do que este

              // navegador tem selecionado, o seletor avisa (o histórico real viria do mercado errado)

              scriptSymbol: payload.data?.symbol ?? prev.scriptSymbol,

              // Placa do robô embutida no script: se divergir do Ajustes, o filtro por magic da

              // ponte fecharia posições de outra corrida — aviso central (regra: nada silencioso)

              scriptRobotMagic: payload.data?.robotMagic ?? prev.scriptRobotMagic,

              scriptPointValue: payload.data?.pointValue ?? prev.scriptPointValue,

              bridgeArmed: payload.data.armed ?? prev.bridgeArmed,

              // Trava de execução do LADO do processo da ponte (ORDERS_BLOCKED no PC do MT5): não
              // adianta o robô estar ligado aqui se o processo está em modo replay/validação.
              bridgeOrdersBlocked: payload.data?.ordersBlocked ?? prev.bridgeOrdersBlocked,

              bridgeReplayMode: payload.data?.replayMode ?? prev.bridgeReplayMode,

              bridgeEnvLock: payload.data?.travaAmbiente ?? prev.bridgeEnvLock,

              dayStats: payload.data?.dayStats ?? prev.dayStats,

              dayStatsBySymbol: payload.data?.dayStatsBySymbol ?? (prev as any).dayStatsBySymbol,

              pendingOrders: payload.data?.pendingOrders ?? prev.pendingOrders,

              varalConfig: payload.data?.varalConfig ?? prev.varalConfig,

              ...(!authResultSeen ? { bridgeAuthOk: true, bridgeLegacy: true } : {}),

            }));

            if (payload.data?.dayStats) {
              try {
                saasChannelRef.current?.postMessage({
                  type: 'MT5_DAY_STATS_SYNC',
                  dayStats: payload.data.dayStats,
                  dayStatsBySymbol: payload.data.dayStatsBySymbol,
                  balance: payload.data.balance,
                  equity: payload.data.equity,
                  floatingProfit: payload.data.floatingProfit,
                });
              } catch {}
            }

            // Sincroniza posições reais do MetaTrader 5 diretamente na boleta e no gráfico
            if (Array.isArray(payload.data?.positions)) {
              setOrders((prev) => {
                const curActiveAsset = activeAssetRef.current;
                const curPrice = currentPriceRef.current;
                const livePositions: Array<{
                  ticket: number;
                  symbol: string;
                  type: 'BUY' | 'SELL';
                  volume: number;
                  priceOpen?: number;
                  price_open?: number;
                  priceCurrent?: number;
                  price_current?: number;
                  sl: number;
                  tp: number;
                  profit: number;
                  comment?: string;
                  magic?: number;
                  time?: number;
                }> = payload.data.positions;
                const dealsList: any[] = Array.isArray(payload.data?.deals) ? payload.data.deals : [];

                const relevantLive = livePositions.filter((p) => isSymbolForAsset(p.symbol, curActiveAsset));
                const liveTicketSet = new Set(relevantLive.map((p) => p.ticket));

                // 1. Fecha ordens locais com ticket MT5 que não existem mais na lista de posições reais
                let updated = prev.map((o) => {
                  if (!isOrderForAsset(o, curActiveAsset)) return o;
                  if (o.status === 'OPEN' && o.ticket && !liveTicketSet.has(o.ticket)) {
                    const exitDeal = dealsList.slice().reverse().find((d) => (d.order === o.ticket || d.ticket === o.ticket) && isSymbolForAsset(d.symbol, curActiveAsset));
                    const safeEntry = isPriceSaneForAsset(o.entryPrice, curActiveAsset) ? o.entryPrice : curActiveAsset.basePrice;
                    const rawExit = exitDeal && Number(exitDeal.price) > 0 ? Number(exitDeal.price) : curPrice;
                    const safeExit = isPriceSaneForAsset(rawExit, curActiveAsset) ? rawExit : safeEntry;
                    const finRes = exitDeal ? Number(exitDeal.profit || 0) : (o.financialResult ?? 0);
                    const ptsRes = isPriceSaneForAsset(safeExit, curActiveAsset) && isPriceSaneForAsset(safeEntry, curActiveAsset)
                      ? (o.type === 'BUY' ? (safeExit - safeEntry) : (safeEntry - safeExit))
                      : (o.pointsResult ?? 0);
                    const isWin = finRes >= 0;
                    return {
                      ...o,
                      status: (isWin ? 'CLOSED_PROFIT' : 'CLOSED_LOSS') as TradeOrder['status'],
                      exitPrice: safeExit,
                      exitTimestamp: Date.now(),
                      exitTimeStr: new Date().toLocaleTimeString(),
                      exitReason: (isWin ? 'TAKE_PROFIT' : 'STOP_LOSS') as TradeOrder['exitReason'],
                      pointsResult: Number.isFinite(ptsRes) ? ptsRes : 0,
                      financialResult: Number.isFinite(finRes) ? finRes : 0,
                    };
                  }
                  // Descarta ordens locais abertas sem ticket apenas se foram disparadas para o MT5 (isRealMT5)
                  // e passaram mais de 30 segundos sem confirmação do terminal (rejeitadas pela corretora).
                  // Ordens puramente simuladas / paper jamais são descartadas aqui.
                  if (o.isRealMT5 && o.status === 'OPEN' && !o.ticket && (Date.now() - o.timestamp > 30000)) {
                    const safeExit = isPriceSaneForAsset(curPrice, curActiveAsset) ? curPrice : (isPriceSaneForAsset(o.entryPrice, curActiveAsset) ? o.entryPrice : curActiveAsset.basePrice);
                    return {
                      ...o,
                      status: 'CLOSED_LOSS' as TradeOrder['status'],
                      exitPrice: safeExit,
                      exitTimestamp: Date.now(),
                      exitTimeStr: new Date().toLocaleTimeString(),
                      exitReason: 'STOP_LOSS' as const,
                    };
                  }
                  return o;
                });

                // 2. Atualiza ou vincula ordens vivas vindas do terminal MT5 (sem duplicatas)
                for (const pos of relevantLive) {
                  // Procura primeiro pelo ticket exato
                  let existingIdx = updated.findIndex((o) => o.ticket === pos.ticket);

                  // Se não achou pelo ticket, vincula a ordem local recente aberta do mesmo tipo
                  if (existingIdx < 0) {
                    existingIdx = updated.findIndex(
                      (o) => (o.status === 'OPEN' || o.status === 'PENDING_LIMIT') &&
                             !o.ticket &&
                             o.type === pos.type &&
                             isOrderForAsset(o, curActiveAsset)
                    );
                  }

                  const openPrice = Number(pos.priceOpen ?? pos.price_open ?? 0);
                  const posCurPrice = Number(pos.priceCurrent ?? pos.price_current ?? curPrice);
                  const posSl = Number(pos.sl ?? 0);
                  const posTp = Number(pos.tp ?? 0);
                  const posProfit = Number(pos.profit ?? 0);
                  const isBuy = pos.type === 'BUY';
                  const saneOpen = isPriceSaneForAsset(openPrice, curActiveAsset) ? openPrice : (isPriceSaneForAsset(curPrice, curActiveAsset) ? curPrice : curActiveAsset.basePrice);
                  const saneCur = isPriceSaneForAsset(posCurPrice, curActiveAsset) ? posCurPrice : saneOpen;
                  const pnlPts = isBuy ? (saneCur - saneOpen) : (saneOpen - saneCur);

                  if (existingIdx >= 0) {
                    updated[existingIdx] = {
                      ...updated[existingIdx],
                      ticket: pos.ticket,
                      symbol: pos.symbol || updated[existingIdx].symbol || chartSymbolFor(curActiveAsset),
                      source: 'MT5_LIVE',
                      isRealMT5: true,
                      entryPrice: isPriceSaneForAsset(openPrice, curActiveAsset) ? openPrice : updated[existingIdx].entryPrice,
                      contracts: pos.volume,
                      remainingContracts: pos.volume,
                      status: 'OPEN',
                      stopLoss: posSl > 0 ? posSl : updated[existingIdx].stopLoss,
                      takeProfit: posTp > 0 ? posTp : updated[existingIdx].takeProfit,
                      pointsResult: Number.isFinite(pnlPts) ? pnlPts : 0,
                      financialResult: Number.isFinite(posProfit) ? posProfit : 0,
                    };
                  } else {
                    const newOrd: TradeOrder = {
                      id: `mt5-${pos.ticket}`,
                      ticket: pos.ticket,
                      symbol: pos.symbol || chartSymbolFor(curActiveAsset),
                      timestamp: pos.time ? pos.time * 1000 : Date.now(),
                      timeStr: new Date(pos.time ? pos.time * 1000 : Date.now()).toLocaleTimeString(),
                      type: pos.type,
                      role: String(pos.comment || '').toLowerCase().includes('pyr') ? 'PYRAMID' : 'MAIN',
                      entryPrice: saneOpen,
                      contracts: pos.volume,
                      remainingContracts: pos.volume,
                      status: 'OPEN',
                      source: 'MT5_LIVE',
                      magicNumber: pos.magic,
                      stopLoss: posSl > 0 ? posSl : 0,
                      takeProfit: posTp > 0 ? posTp : 0,
                      triggerReason: 'Execução MT5 Terminal',
                      isRealMT5: true,
                      pointsResult: Number.isFinite(pnlPts) ? pnlPts : 0,
                      financialResult: Number.isFinite(posProfit) ? posProfit : 0,
                    };
                    updated = [newOrd, ...updated];
                  }
                }
                return updated;
              });
            }

            if (

              typeof payload.data?.robotMagic === 'number' &&

              payload.data.robotMagic !== mainRobotMagic(config)

            ) {

              setLatestToast({

                id: `mt5-magic-${Date.now()}`,

                type: 'INFO',

                title: '⚠️ MAGIC DIVERGENTE (APP × SCRIPT)',

                description: `O script no Windows carrega o magic ${payload.data.robotMagic}, mas o Ajustes deste navegador define ${mainRobotMagic(config)}. Baixe o script de novo para as duas placas baterem — é o filtro que isola o robô da boleta manual.`,

                timestamp: Date.now(),

              });

            }

          } else if (payload.type === 'ARM_RESULT') {

            const armed = Boolean(payload.data?.armed);

            setMt5State((prev) => ({ ...prev, bridgeArmed: armed }));
            setConfig((prev) => {
              if (prev.active === armed) return prev;
              isRemoteArmSyncRef.current = true;
              return { ...prev, active: armed, lastSavedTimestamp: Date.now() };
            });
            setReplayOperates(armed);
            try {
              saasChannelRef.current?.postMessage({ type: 'ROBOT_ARMED_SYNC', armed });
            } catch {}

            setLatestToast({

              id: `mt5-arm-${Date.now()}`,

              type: armed ? 'BUY' : 'INFO',

              title: armed ? '🟢 ROBÔ ARMADO (SINCRONIZADO)' : '🔒 ROBÔ EM SEGURO (SINCRONIZADO)',

              description: armed

                ? 'A ponte do MT5 liberou as ordens de entrada em todos os dispositivos.'

                : 'A ponte do MT5 pausou as entradas em todos os dispositivos. Saídas e zeragem seguem liberadas.',

              timestamp: Date.now(),

            });

          } else if (payload.type === 'VARAL_CONFIG_UPDATE') {

            const updatedCfg = payload.data;
            if (updatedCfg) {
              setMt5State((prev) => ({
                ...prev,
                varalConfig: updatedCfg,
              }));
            }

          } else if (payload.type === 'STRATEGY_SYNC_BROADCAST') {

            const stratName = payload.data?.profileName;
            const remoteCfg = payload.data?.config;
            // Logo após (re)conectar, o broadcast da ponte pode ser só o estado padrão dela (sem
            // config enviada por nenhum cliente): não pode sobrescrever a estratégia local.
            const justConnected = Date.now() - strategyConnectAtRef.current < 5000;
            if (justConnected && !remoteCfg) {
              return;
            }
            if (stratName && stratName !== activeStrategyNameRef.current) {
              const library = StrategyLibraryService.list();
              const existing = library.find((s) => s.name.toLowerCase() === stratName.toLowerCase());
              if (existing) {
                handleActivateStrategy(existing, true);
              } else if (remoteCfg) {
                handleApplyConfigBundle(remoteCfg, stratName, true);
              } else {
                const preset = builtInPresets.find((p) => p.name.toLowerCase() === stratName.toLowerCase());
                if (preset) {
                  handleApplyConfigBundle(preset.config, preset.name, true);
                }
              }
              setLatestToast({
                id: `strat-sync-${Date.now()}`,
                type: 'INFO',
                title: '🔄 ESTRATÉGIA SINCRONIZADA',
                description: `Terminal sincronizado com o servidor: "${stratName}".`,
                timestamp: Date.now(),
              });
            }

          } else if (payload.type === 'GLOBAL_REPLAY_START') {
            // Ignora eco originado pela própria aba e bloqueia se já estiver em replay
            if (payload.data?.senderId && payload.data.senderId === tabSessionIdRef.current) {
              return;
            }
            if (isReplayingRef.current) {
              return;
            }

            const rDays = payload.data?.days ?? 1;
            const rSpd = payload.data?.speed;
            const rSeed = payload.data?.seed;
            const rDayKey = payload.data?.dayKey;
            const rBoxPoints = Number(payload.data?.boxPoints);
            const rTargetAssetSpec = (payload.data?.symbol || payload.data?.assetId)
              ? resolveAsset(payload.data?.symbol, payload.data?.assetId)
              : null;
            if (rBoxPoints > 0 && rTargetAssetSpec) {
              saveAssetTradeParams(rTargetAssetSpec.id, { boxPoints: rBoxPoints });
              if (assetStateRef.current[rTargetAssetSpec.id]) {
                assetStateRef.current[rTargetAssetSpec.id].engine.setBoxPoints(rBoxPoints);
              }
            }
            if (rSpd) setSimulationSpeed(rSpd);
            setReplayDays(rDays);
            if (rBoxPoints > 0 && (!rTargetAssetSpec || rTargetAssetSpec.id === activeAssetIdRef.current)) {
              const clamped = clampBoxPoints(rBoxPoints, asset);
              handleBoletaConfigPatchRef.current?.({ boxPoints: clamped }, true);
            }
            handleReplayHistoryRef.current?.(rDays, rSeed, rDayKey, true);

          } else if (payload.type === 'GLOBAL_REPLAY_STOP') {
            if (payload.data?.senderId && payload.data.senderId === tabSessionIdRef.current) {
              return;
            }
            if (isReplayingRef.current) {
              handleStopReplayRef.current?.(true);
            }

          } else if (payload.type === 'GLOBAL_REPLAY_SPEED') {

            if (payload.data?.speed) setSimulationSpeed(payload.data.speed);

          } else if (payload.type === 'GLOBAL_REPLAY_DAYS') {

            if (payload.data?.days) setReplayDays(payload.data.days);

          } else if (payload.type === 'GLOBAL_BOX_POINTS_SYNC') {

            const bPts = Number(payload.data?.boxPoints);
            const targetAssetSpec = resolveAsset(payload.data?.symbol, payload.data?.assetId);
            const targetAssetId = targetAssetSpec.id;
            if (bPts > 0 && targetAssetId) {
              // Salva isolado no storage do ativo específico
              saveAssetTradeParams(targetAssetId, { boxPoints: bPts });
              if (assetStateRef.current[targetAssetId]) {
                assetStateRef.current[targetAssetId].engine.setBoxPoints(bPts);
              }
              // Só atualiza a tela se a sincronização for para o ativo atualmente selecionado
              if (targetAssetId === activeAssetIdRef.current) {
                const clamped = clampBoxPoints(bPts, asset);
                handleBoletaConfigPatchRef.current?.({ boxPoints: clamped }, true);
              }
            }

          } else if (payload.type === 'REPLAY_MODE_RESULT') {

            // A ponte bateu a trava do ambiente? Então o clique em "desligar" não ligou nada e a

            // tela precisa dizer isso em vez de mostrar o botão errado.

            const on = Boolean(payload.data?.on);

            const blocked = Boolean(payload.data?.blocked);

            setMt5State((prev) => ({

              ...prev,

              bridgeReplayMode: on,

              bridgeOrdersBlocked: blocked,

              bridgeEnvLock: Boolean(payload.data?.envLocked),

            }));

            setLatestToast({

              id: `mt5-replay-mode-${Date.now()}`,

              type: on ? 'INFO' : blocked ? 'SELL' : 'BUY',

              title: on ? '🎥 MODO REPLAY/VALIDAÇÃO LIGADO' : blocked ? '⚠️ TRAVA DO AMBIENTE CONTINUA LIGADA' : '▶️ EXECUÇÃO LIBERADA',

              description: String(payload.data?.note || 'a ponte respondeu o estado da trava de execução.'),

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

          } else if (payload.type === 'ORDER_RESULT') {

            // A ponte executou (ou não) no MT5. Antes isso era mudo: a ordem saía do app, passava
            // pela trava de risco e morria no execute_market_order sem a tela dizer nada.

            const ok = Boolean(payload.data?.ok);

            setLatestToast({

              id: `mt5-order-${Date.now()}`,

              type: ok ? 'BUY' : 'SELL',

              title: ok ? '✅ ORDEM EXECUTADA NO MT5' : '⛔ MT5 NÃO ACEITOU A ORDEM',

              description: ok

                ? `A ponte confirmou a entrada no terminal (Ticket ${payload.data?.ticket ?? ''}).`

                : `${payload.data?.reason || 'motivo não informado pelo script'} — a ordem chegou à ponte, mas o MT5 não executou.`,

              timestamp: Date.now(),

            });

          } else if (payload.type === 'TICK' || payload.type === 'TICKS_BATCH') {
            const rawTicks: Tick[] = payload.type === 'TICKS_BATCH'
              ? (Array.isArray(payload.data) ? payload.data : payload.data?.ticks || [])
              : (payload.data ? [payload.data] : []);

            for (const rawTick of rawTicks) {
              if (!rawTick || !(rawTick.price > 0)) continue;
              const tickSym = String(payload.symbol || (rawTick as any).symbol || '').toUpperCase();
              const targetSpec = resolveAsset(tickSym);
              const tickAssetId = targetSpec.id;
              if (Math.abs(rawTick.price - targetSpec.basePrice) / targetSpec.basePrice >= 0.4) {
                continue;
              }
              const targetState = assetStateRef.current[tickAssetId];

              // O timeStr da ponte vem do relógio do servidor MT5; a fita deve bater com o gráfico
              if (Number.isFinite(Number(rawTick.timestamp))) {
                rawTick.timeStr = formatTickTimeStr(Number(rawTick.timestamp));
              }

              const isCurrent = tickAssetId === activeAssetIdRef.current;

              if (isCurrent) {
                // Sincroniza referências e histórico do ativo ativo na tela
                if (targetState) {
                  engineRef.current = targetState.engine;
                  rangeEngineRef.current = targetState.rangeEngine;
                  timeEngineRef.current = targetState.timeEngine;
                  targetState.currentPrice = rawTick.price;
                  targetState.ticks = [rawTick, ...targetState.ticks.slice(0, 99)];
                  if (targetState.allTicks.length < 50000) targetState.allTicks.push(rawTick);
                  allTicksRef.current = targetState.allTicks;
                }
                // Processa o tick no motor principal, fita, robô e ordens (sem chamada duplicada)
                handleIncomingTickRef.current(rawTick);
              } else if (targetState) {
                // Ativo secundário em background: processa em memória silenciosamente com as regras e escala DELE
                targetState.ticks = [rawTick, ...targetState.ticks.slice(0, 99)];
                targetState.currentPrice = rawTick.price;
                if (targetState.allTicks.length < 50000) targetState.allTicks.push(rawTick);

                const bgParams = getAssetTradeParams(tickAssetId);
                const bgConfig: AutomationConfig = {
                  ...config,
                  assetId: tickAssetId,
                  boxPoints: bgParams.boxPoints,
                  minDeltaThreshold: bgParams.minDeltaThreshold,
                };

                const renkoRes = targetState.engine.processTick(rawTick, bgConfig);
                targetState.cvd = targetState.engine.getCvd();
                targetState.currentBox = targetState.engine.getCurrentBox();
                if (renkoRes.newBoxClosed && renkoRes.closedBox) {
                  targetState.boxes = [...targetState.engine.getBoxes()];
                }

                const rangeRes = targetState.rangeEngine.processTick(rawTick);
                targetState.rangeCurrentBox = targetState.rangeEngine.getCurrentBox();
                if (rangeRes.newBarClosed) {
                  targetState.rangeBoxes = [...targetState.rangeEngine.getBoxes()];
                }
              }
            }

          } else if (MarketHistoryService.handles(payload.type)) {

            // HISTÓRICO REAL (Fase 2): chunks/done/erro do pedido feito pelo replay. A correlação,

            // a deduplicação por id e o timeout moram no serviço, não aqui.

            marketHistoryService.ingest(payload);

          } else if (payload.type === 'SESSION_BACKFILL') {
            const bfSym = String(payload.symbol || '').toUpperCase();
            const bfAssetSpec = resolveAsset(bfSym);
            const bfAssetId = bfAssetSpec.id;
            
            // Determina os pontos do box com sanitização rigorosa por ativo (evita contaminação de 50 pts no WDO)
            let effectiveBoxPoints = Number(payload.data?.boxPoints);
            if (!effectiveBoxPoints || (bfAssetId === 'WDO' && effectiveBoxPoints > 15) || (bfAssetId === 'WIN' && effectiveBoxPoints < 10)) {
              effectiveBoxPoints = bfAssetSpec.tradeDefaults.boxPoints || (bfAssetId === 'WDO' ? 2.5 : (bfAssetId === 'WIN' ? 50 : 100));
            }
            const bfBoxPoints = effectiveBoxPoints;

            // A ponte manda os boxes do ÚLTIMO PREGÃO já formados ou os ticks M1 (SESSION_BACKFILL).
            let rawBfBoxes: RenkoBox[] = [];
            const incomingTicks: Tick[] = Array.isArray(payload.data?.ticks) ? payload.data.ticks : [];
            const bfRecebidos = (payload.data?.boxes || []).length || incomingTicks.length;

            if (Array.isArray(payload.data?.boxes) && payload.data.boxes.length > 0) {
              rawBfBoxes = (payload.data.boxes || [])
                .map((b: any, i: number) => ({
                  index: Number(b?.index ?? i),
                  direction: b?.direction === 'UP' ? 'UP' : 'DOWN',
                  open: Number(b?.open),
                  close: Number(b?.close),
                  high: Number(b?.high),
                  low: Number(b?.low),
                  timeStart: Number(b?.time_start || b?.timestamp) || 0,
                  timeEnd: Number(b?.timestamp) || 0,
                  ticksCount: Number(b?.ticks_count) || 0,
                  totalVolume: (Number(b?.buy_volume) || 0) + (Number(b?.sell_volume) || 0),
                  buyVolume: Number(b?.buy_volume) || 0,
                  sellVolume: Number(b?.sell_volume) || 0,
                  delta: Number(b?.delta) || 0,
                  cvdAtClose: Number(b?.cvd_at_close) || 0,
                  isConvergence: false,
                  regimeFactor: Number(b?.regime_factor) || undefined,
                }))
                .filter((b: RenkoBox) => Number.isFinite(b.close) && b.close > 0 && Number.isFinite(b.open) && b.open > 0);
            } else if (incomingTicks.length > 0) {
              const tempEngine = new RenkoFlowEngine(bfBoxPoints, bfAssetSpec);
              const firstTick = incomingTicks[0];
              if (firstTick && firstTick.price > 0) {
                tempEngine.initialize(firstTick.price, firstTick.timestamp);
              }
              const tempConfig: AutomationConfig = {
                ...config,
                assetId: bfAssetId,
                boxPoints: bfBoxPoints,
                minDeltaThreshold: bfAssetSpec.tradeDefaults.minDeltaThreshold,
              };
              for (const t of incomingTicks) {
                if (t && t.price > 0) {
                  tempEngine.processTick(t, tempConfig);
                }
              }
              rawBfBoxes = tempEngine.getBoxes();
            }

            const bfBoxes: RenkoBox[] = [];
            const bfPriceLbl = renkoScaleLabel(bfBoxPoints, bfAssetSpec);
            for (let i = 0; i < rawBfBoxes.length; i++) {
              const bx = { ...rawBfBoxes[i], index: i };
              annotateActiveBar(bx, bfBoxes, config, bfPriceLbl);
              bfBoxes.push(bx);
            }

            // Diagnóstico visível apenas se a ponte mandou dados corrompidos (> 0 recebidos mas 0 válidos)
            if (bfBoxes.length === 0 && bfRecebidos > 0 && !isReplayingRef.current) {
              setBfDiag(`PONTE → ${bfSym}: ${bfRecebidos} box(es) recebido(s), NENHUM válido · box em uso ${bfBoxPoints} pts`);
            }

            if (bfBoxes.length > 0) {
              const lastBf = bfBoxes[bfBoxes.length - 1];
              const lastPrice = Number(payload.data?.lastPrice) || lastBf.close;
              const targetState = assetStateRef.current[bfAssetId];

              // Diagnóstico na tela: diz quantos boxes a ponte mandou e quantos sobreviveram ao
              // filtro. Sem isso o descarte era silencioso ("aguardando ticks" eterno).
              setBfDiag(`PONTE → ${bfSym}: ${bfRecebidos} box(es) recebido(s), ${bfBoxes.length} válido(s) · ativo=${bfAssetId} · série=${chartSeries}`);

              const synthTicks = synthesizeTicksFromBoxes(bfBoxes);

              if (targetState) {
                targetState.boxes = bfBoxes;
                targetState.currentPrice = lastPrice;
                targetState.cvd = Number(payload.data?.cvd) || lastBf.cvdAtClose;
                targetState.engine.loadBackfillBoxes(bfBoxes, lastPrice, targetState.cvd);
                targetState.sessionGaps = [...targetState.engine.getSessionGaps()];
                if (synthTicks.length > 0) {
                  // Preserva ticks ao vivo que já tenham chegado após o fim do último box do backfill
                  const lastBfTs = lastBf.timeEnd || lastBf.timeStart || 0;
                  const recentLive = targetState.allTicks.filter((t) => !String(t.id).startsWith('synth-') && t.timestamp > lastBfTs);
                  targetState.allTicks = [...synthTicks, ...recentLive];
                }
              }

              const isCurrent = bfAssetId === activeAssetIdRef.current;

              if (isCurrent) {
                engineRef.current.loadBackfillBoxes(bfBoxes, lastPrice, Number(payload.data?.cvd) || lastBf.cvdAtClose);
                setBoxes(bfBoxes);
                setSessionGaps([...engineRef.current.getSessionGaps()]);
                setCurrentPrice(lastPrice);
                setCurrentBox(engineRef.current.getCurrentBox());
                if (Number.isFinite(Number(payload.data?.cvd))) setCvd(Number(payload.data.cvd));

                // Sintetiza e popula imediatamente o motor de Range e o buffer de ticks
                if (synthTicks.length > 0) {
                  allTicksRef.current = targetState ? targetState.allTicks : synthTicks;
                  const rEng = rangeEngineRef.current;
                  rEng.setRangePoints(rangePoints);
                  rEng.initialize(synthTicks[0].price, synthTicks[0].timestamp);
                  for (const st of allTicksRef.current) rEng.processTick(st);
                  setRangeBoxes([...rEng.getBoxes()]);
                  setRangeCurrentBox(rEng.getCurrentBox());
                }
                setLatestToast({
                  id: `bf-${Date.now()}`,
                  type: 'INFO',
                  title: '📈 PREGÃO CARREGADO DA PONTE',
                  description: `${bfBoxes.length} boxes Renko de ${bfSym} (${payload.data?.tickSource === 'TICKS' ? 'tick real' : 'barras de 1 min'}), box de ${bfBoxPoints} pts. Gráfico parado para estudo.`,
                  timestamp: Date.now(),
                });
              }
            }

          } else if (payload.type === 'MT5_EQUITY_UPDATE') {

            setMt5State((prev) => ({

              ...prev,

              accountLogin: payload.data.accountLogin ?? prev.accountLogin,

              brokerCompany: payload.data.brokerCompany ?? prev.brokerCompany,

              balance: payload.data.balance ?? prev.balance,

              equity: payload.data.equity ?? prev.equity,

              floatingProfit: payload.data.floatingProfit ?? prev.floatingProfit,

              margin: payload.data.margin ?? prev.margin,

              marginFree: payload.data.marginFree ?? prev.marginFree,

              deals: (() => {
                const incoming = Array.isArray(payload.data.deals) ? payload.data.deals : [];
                const existing = Array.isArray(prev.deals) ? prev.deals : [];
                if (incoming.length === 0) return existing;
                if (existing.length === 0) return incoming;
                const byTicket = new Map<number, any>();
                for (const d of existing) {
                  if (d && d.ticket !== undefined) byTicket.set(Number(d.ticket), d);
                }
                for (const d of incoming) {
                  if (d && d.ticket !== undefined) byTicket.set(Number(d.ticket), d);
                }
                return Array.from(byTicket.values()).sort((a, b) => (Number(a.time) || 0) - (Number(b.time) || 0));
              })(),

              positions: payload.data.positions ?? prev.positions,

              pendingOrders: payload.data?.pendingOrders ?? prev.pendingOrders,

              varalConfig: payload.data?.varalConfig ?? prev.varalConfig,

              dayStats: payload.data?.dayStats ?? prev.dayStats,

              dayStatsBySymbol: payload.data?.dayStatsBySymbol ?? (prev as any).dayStatsBySymbol,

            }));

            if (payload.data?.dayStats) {
              try {
                saasChannelRef.current?.postMessage({
                  type: 'MT5_DAY_STATS_SYNC',
                  dayStats: payload.data.dayStats,
                  dayStatsBySymbol: payload.data.dayStatsBySymbol,
                  balance: payload.data.balance,
                  equity: payload.data.equity,
                  floatingProfit: payload.data.floatingProfit,
                });
              } catch {}
            }

            // Sincroniza posições vivas a cada pulso de equity broadcast (atualiza boleta e caixas)
            if (Array.isArray(payload.data?.positions)) {
              setOrders((prev) => {
                const curActiveAsset = activeAssetRef.current;
                const curPrice = currentPriceRef.current;
                const livePositions: Array<{
                  ticket: number;
                  symbol: string;
                  type: 'BUY' | 'SELL';
                  volume: number;
                  priceOpen?: number;
                  price_open?: number;
                  priceCurrent?: number;
                  price_current?: number;
                  sl: number;
                  tp: number;
                  profit: number;
                  comment?: string;
                  magic?: number;
                  time?: number;
                }> = payload.data.positions;
                const dealsList: any[] = Array.isArray(payload.data?.deals) ? payload.data.deals : [];

                const relevantLive = livePositions.filter((p) => isSymbolForAsset(p.symbol, curActiveAsset));
                const liveTicketSet = new Set(relevantLive.map((p) => p.ticket));

                let updated = prev.map((o) => {
                  if (!isOrderForAsset(o, curActiveAsset)) return o;
                  if (o.status === 'OPEN' && o.ticket && !liveTicketSet.has(o.ticket)) {
                    const exitDeal = dealsList.slice().reverse().find((d) => (d.order === o.ticket || d.ticket === o.ticket) && isSymbolForAsset(d.symbol, curActiveAsset));
                    const safeEntry = isPriceSaneForAsset(o.entryPrice, curActiveAsset) ? o.entryPrice : curActiveAsset.basePrice;
                    const rawExit = exitDeal && Number(exitDeal.price) > 0 ? Number(exitDeal.price) : curPrice;
                    const safeExit = isPriceSaneForAsset(rawExit, curActiveAsset) ? rawExit : safeEntry;
                    const finRes = exitDeal ? Number(exitDeal.profit || 0) : (o.financialResult ?? 0);
                    const ptsRes = isPriceSaneForAsset(safeExit, curActiveAsset) && isPriceSaneForAsset(safeEntry, curActiveAsset)
                      ? (o.type === 'BUY' ? (safeExit - safeEntry) : (safeEntry - safeExit))
                      : (o.pointsResult ?? 0);
                    const isWin = finRes >= 0;
                    return {
                      ...o,
                      status: (isWin ? 'CLOSED_PROFIT' : 'CLOSED_LOSS') as TradeOrder['status'],
                      exitPrice: safeExit,
                      exitTimestamp: Date.now(),
                      exitTimeStr: new Date().toLocaleTimeString(),
                      exitReason: (isWin ? 'TAKE_PROFIT' : 'STOP_LOSS') as TradeOrder['exitReason'],
                      pointsResult: Number.isFinite(ptsRes) ? ptsRes : 0,
                      financialResult: Number.isFinite(finRes) ? finRes : 0,
                    };
                  }
                  // Descarta ordens locais abertas sem ticket apenas se foram disparadas para o MT5 (isRealMT5)
                  // e passaram mais de 30 segundos sem confirmação do terminal (rejeitadas pela corretora).
                  // Ordens puramente simuladas / paper jamais são descartadas aqui.
                  if (o.isRealMT5 && o.status === 'OPEN' && !o.ticket && (Date.now() - o.timestamp > 30000)) {
                    const safeExit = isPriceSaneForAsset(curPrice, curActiveAsset) ? curPrice : (isPriceSaneForAsset(o.entryPrice, curActiveAsset) ? o.entryPrice : curActiveAsset.basePrice);
                    return {
                      ...o,
                      status: 'CLOSED_LOSS' as TradeOrder['status'],
                      exitPrice: safeExit,
                      exitTimestamp: Date.now(),
                      exitTimeStr: new Date().toLocaleTimeString(),
                      exitReason: 'STOP_LOSS' as const,
                    };
                  }
                  return o;
                });

                for (const pos of relevantLive) {
                  let existingIdx = updated.findIndex((o) => o.ticket === pos.ticket);
                  if (existingIdx < 0) {
                    existingIdx = updated.findIndex(
                      (o) => (o.status === 'OPEN' || o.status === 'PENDING_LIMIT') &&
                             !o.ticket &&
                             o.type === pos.type &&
                             isOrderForAsset(o, curActiveAsset)
                    );
                  }

                  const openPrice = Number(pos.priceOpen ?? pos.price_open ?? 0);
                  const posCurPrice = Number(pos.priceCurrent ?? pos.price_current ?? curPrice);
                  const posSl = Number(pos.sl ?? 0);
                  const posTp = Number(pos.tp ?? 0);
                  const posProfit = Number(pos.profit ?? 0);
                  const isBuy = pos.type === 'BUY';
                  const saneOpen = isPriceSaneForAsset(openPrice, curActiveAsset) ? openPrice : (isPriceSaneForAsset(curPrice, curActiveAsset) ? curPrice : curActiveAsset.basePrice);
                  const saneCur = isPriceSaneForAsset(posCurPrice, curActiveAsset) ? posCurPrice : saneOpen;
                  const pnlPts = isBuy ? (saneCur - saneOpen) : (saneOpen - saneCur);

                  if (existingIdx >= 0) {
                    updated[existingIdx] = {
                      ...updated[existingIdx],
                      ticket: pos.ticket,
                      symbol: pos.symbol || updated[existingIdx].symbol || chartSymbolFor(curActiveAsset),
                      source: 'MT5_LIVE',
                      isRealMT5: true,
                      entryPrice: isPriceSaneForAsset(openPrice, curActiveAsset) ? openPrice : updated[existingIdx].entryPrice,
                      contracts: pos.volume,
                      remainingContracts: pos.volume,
                      status: 'OPEN',
                      stopLoss: posSl > 0 ? posSl : updated[existingIdx].stopLoss,
                      takeProfit: posTp > 0 ? posTp : updated[existingIdx].takeProfit,
                      pointsResult: Number.isFinite(pnlPts) ? pnlPts : 0,
                      financialResult: Number.isFinite(posProfit) ? posProfit : 0,
                    };
                  } else {
                    const newOrd: TradeOrder = {
                      id: `mt5-${pos.ticket}`,
                      ticket: pos.ticket,
                      symbol: pos.symbol || chartSymbolFor(curActiveAsset),
                      timestamp: pos.time ? pos.time * 1000 : Date.now(),
                      timeStr: new Date(pos.time ? pos.time * 1000 : Date.now()).toLocaleTimeString(),
                      type: pos.type,
                      role: String(pos.comment || '').toLowerCase().includes('pyr') ? 'PYRAMID' : 'MAIN',
                      entryPrice: saneOpen,
                      contracts: pos.volume,
                      remainingContracts: pos.volume,
                      status: 'OPEN',
                      source: 'MT5_LIVE',
                      magicNumber: pos.magic,
                      stopLoss: posSl > 0 ? posSl : 0,
                      takeProfit: posTp > 0 ? posTp : 0,
                      triggerReason: 'Execução MT5 Terminal',
                      isRealMT5: true,
                      pointsResult: Number.isFinite(pnlPts) ? pnlPts : 0,
                      financialResult: Number.isFinite(posProfit) ? posProfit : 0,
                    };
                    updated = [newOrd, ...updated];
                  }
                }
                return updated;
              });
            }

          } else if (payload.type === 'LOCAL_PREGOES_LIST') {
            const raw = payload.data;
            const listaPonte: LocalPregao[] = Array.isArray(raw)
              ? raw
              : (raw?.symbols && raw.symbols[chartSymbolFor(asset)])
              ? raw.symbols[chartSymbolFor(asset)]
              : (raw?.symbols ? (Object.values(raw.symbols).flat() as LocalPregao[]) : []);

            if (listaPonte.length > 0) {
              setLocalPregoes((atual) => mesclarPregoes(atual, listaPonte));
            }
          } else if (payload.type === 'BACKTEST_RESULT') {

            setIsBacktestingReal(false);

            if (payload.status === 'DONE') {

              setRealBacktestResult(payload.data);

              setLatestToast({

                id: `bt-done-${Date.now()}`,

                type: 'BUY',

                title: '✅ BACKTEST CONCLUÍDO!',

                description: `Pregão ${payload.data.date}: ${payload.data.total_ops ?? payload.data.totalTrades} trades, Win Rate ${payload.data.win_rate ?? payload.data.winRate}%, Resultado: R$ ${(payload.data.pnl ?? payload.data.pnlBrl)?.toFixed(2) ?? '0.00'}`,

                timestamp: Date.now(),

              });

            } else {

              setLatestToast({

                id: `bt-err-${Date.now()}`,

                type: 'SELL',

                title: '❌ ERRO NO BACKTEST',

                description: payload.error || 'Falha ao processar ticks do pregão no MT5.',

                timestamp: Date.now(),

              });

            }

          } else if (payload.type === 'RISK_LOCK_RESET_OK') {

            setLatestToast({
              id: `risk-reset-ack-${Date.now()}`,
              type: 'INFO',
              title: '✅ EA DESBLOQUEADO (TRAVA RESETADA)',
              description: 'A ponte MT5 confirmou a liberação dos limites de perda. Novos sinais voltam a ser operados.',
              timestamp: Date.now(),
            });

          } else if (payload.type === 'ORDER_RESULT') {

            setLatestToast({

              id: `mt5-ord-${Date.now()}`,

              type: payload.orderType === 'BUY' ? 'BUY' : 'SELL',

              chartOnly: true,

              title: payload.status === 'DONE' ? 'ORDEM EXECUTADA NO MT5' : 'ERRO NO ENVIO MT5',

              description:

                payload.status === 'DONE'

                  ? `Ticket #${payload.ticket} executado a mercado no MetaTrader 5!`

                  : 'Falha ao enviar ordem para o MT5. Verifique margem e conexão.',

              timestamp: Date.now(),

            });

          } else if (payload.type === 'SIGNAL_GENERATED') {
            const sym = String(payload.symbol || '');
            const data = payload.data || {};
            const assetKey: MultiRobotId = sym.includes('WDO') ? 'WDO' : (sym.includes('BIT') ? 'BIT' : 'WIN');
            setMultiRobotSignals((prev) => ({
              ...prev,
              [sym]: {
                symbol: sym,
                assetKey,
                signal: data.signal,
                reason: data.reason || '',
                price: Number(data.price) || 0,
                boxIndex: Number(data.boxIndex) || 0,
                timestamp: Number(data.timestamp) || Date.now(),
              },
            }));
          }

        } catch {

          // Erro de parse ignorado

        }

      };



      socket.onerror = () => {
        if (wsRef.current !== socket) return;
        const isHttps = typeof window !== 'undefined' && window.location.protocol === 'https:';
        const msg = isHttps
          ? `Ambiente HTTPS (AI Studio / Nuvem): os navegadores bloqueiam comunicação direta com o MT5 local do seu computador (Mixed Content). No AI Studio, utilize o modo Replay ou acesse http://localhost:3000 no seu PC para feed ao vivo!`
          : `Não foi possível conectar em ${wsUrl}. Certifique-se de executar 'iniciar_ponte.bat' no seu PC.`;

        addConnectionLog('ERROR', 'WEBSOCKET', `Falha de conexão com ${wsUrl}`, { details: msg });

        setMt5State({
          status: 'ERROR',
          lastError: msg,
        });

        setLatestToast({
          id: `mt5-err-${Date.now()}`,
          type: 'SELL',
          title: isHttps ? 'MT5 LOCAL INDISPONÍVEL NA NUVEM' : 'FALHA NA CONEXÃO COM O MT5',
          description: msg,
          timestamp: Date.now(),
        });
      };

      socket.onclose = (event) => {
        if (wsRef.current !== socket) return;
        wsRef.current = null;
        marketHistoryService.dispose();
        setConnDisconnectCount((c) => c + 1);
        setCurrentLatency(null);

        const codeMap: Record<number, string> = {
          1000: 'Normal Closure (Fechamento Normal)',
          1001: 'Going Away (Navegador Fechou ou Atualizou)',
          1006: 'Abnormal Closure (Fechamento Anormal - timeout TCP, processo Python caiu ou conexão abortada pela rede/firewall)',
          1011: 'Internal Server Error (Erro Interno no Python)',
          4001: 'Token Recusado',
        };
        const friendlyDesc = codeMap[event.code] || 'Código não documentado';

        addConnectionLog(
          'ERROR',
          'WEBSOCKET',
          `Conexão WebSocket com o MT5 encerrada! Código: ${event.code} (${friendlyDesc})`,
          {
            code: event.code,
            reason: event.reason || friendlyDesc,
            details: `A ponte em ${wsUrl} foi desconectada. A reconexão automática tentará restabelecer em instantes.`,
          }
        );

        if (event && event.code === 4001) {
          clearBridgeToken();
          syncBridgeTokenWithServer().catch(() => {});
        }
        setMt5State((prev) => ({ ...prev, status: 'DISCONNECTED', bridgeAuthOk: undefined, bridgeArmed: undefined, bridgeLegacy: undefined }));
      };

    } catch {

      setMt5State({ status: 'ERROR', lastError: 'Falha ao instanciar WebSocket.' });

      // idem Ciclo 12: erro de boot da ponte não liga o SIM por conta própria

    }

  }, [config.mt5Host, config.mt5Port, config.active, mt5State.status]);



  // Sincronização sob demanda da aba Curva de Patrimônio com o MT5

  useEffect(() => {

    if (activeTab === 'equity' && mt5State.status === 'CONNECTED' && wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {

      wsRef.current.send(JSON.stringify({ action: 'GET_MT5_EQUITY', limit: 1000, days: 30 }));

    }

  }, [activeTab, mt5State.status]);



  // RECONEXÃO CONTÍNUA COM O MT5 (só depois de o operador conectar nesta sessão):

  // Se a ponte cair (Wi-Fi do PC, restart do script), o app religa sozinho em até 3s. No boot

  // frio ele NÃO conecta: foi assim que uma aba abriu armada, recebendo o pregão inteiro da

  // corretora sem ninguém pedir (userDisconnectedRef começa `true`).

  useEffect(() => {

    if (userDisconnectedRef.current) return;

    if (mt5State.status === 'CONNECTED' || mt5State.status === 'CONNECTING') return;



    // Tenta conectar imediatamente ou a cada 3 segundos enquanto estiver desconectado

    const timer = setTimeout(() => {

      if (!userDisconnectedRef.current && mt5State.status === 'DISCONNECTED') {

        toggleMT5ConnectRef.current?.('CONNECT', true);

      }

    }, 1500);



    return () => clearTimeout(timer);

  }, [mt5State.status]);



  // Robô ligado/desligado no app decide se a ponte pode ABRIR posição (arm/disarm).

  // Saídas nunca dependem disso: você sempre pode zerar a conta pelo terminal.

  useEffect(() => {

    if (mt5State.status !== 'CONNECTED' || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

    if (isRemoteArmSyncRef.current) {
      isRemoteArmSyncRef.current = false;
      return;
    }

    try {

      wsRef.current.send(JSON.stringify({ action: config.active ? 'ARM' : 'DISARM' }));

    } catch {

      // conexão caindo: o onclose limpa o estado

    }

  }, [config.active, mt5State.status]);



  // Fase A — banco de dados único. A boleta e o painel de Ajustes editam a ESTRATÉGIA ATIVA ao

  // vivo: cada patch de campo de estratégia é gravado de volta na biblioteca (upsert pelo id) e o

  // config ativo volta como VISÃO MATERIALIZADA (estratégia + runtime). Patch de runtime (shadowRobot,

  // host, porta, active) fica só no config. Robô, script Python e saídas leem o config materializado.

  const patchActiveStrategy = (patch: Partial<AutomationConfig>, isRemoteSync?: boolean) => {
    // Salva parâmetros operacionais no storage específico do ativo atual
    const tradeKeys = [
      'boxPoints',
      'stopLossPoints',
      'takeProfitPoints',
      'partialPoints',
      'breakevenOffsetPoints',
      'trailingDistancePoints',
      'minDeltaThreshold',
      'contracts',
    ];
    const tradePatch: Record<string, unknown> = {};
    for (const k of tradeKeys) {
      if (k in patch) tradePatch[k] = (patch as Record<string, unknown>)[k];
    }
    if (Object.keys(tradePatch).length > 0) {
      saveAssetTradeParams(asset.id, tradePatch as Partial<AssetTradeDefaults>);
    }

    if (!isRemoteSync && patch.boxPoints !== undefined) {
      try {
        saasChannelRef.current?.postMessage({
          type: 'BOX_POINTS_SYNC',
          boxPoints: patch.boxPoints,
          assetId: asset.id,
          symbol: chartSymbolFor(asset),
        });
      } catch {}
    }

    if (!isRemoteSync && patch.boxPoints !== undefined && wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        action: 'SET_BOX_POINTS',
        boxPoints: patch.boxPoints,
        assetId: asset.id,
        symbol: chartSymbolFor(asset),
      }));
    }

    setConfig((prev) => {
      const { strategy } = StrategyLibraryService.ensureActiveStrategy(prev);
      const { operational, runtime } = splitStrategyPatch(patch);
      let updatedStrategy = strategy;
      if (Object.keys(operational).length > 0) {
        const saved = StrategyLibraryService.updateStrategyConfig(strategy.id, operational);
        if (saved) updatedStrategy = saved;
      }
      const nextConfig = StrategyLibraryService.resolveOperational(updatedStrategy, { ...prev, ...runtime, ...operational, ...patch });
      const finalConfig: AutomationConfig = { ...nextConfig, ...patch };
      EaConfigService.saveConfig(finalConfig);
      return finalConfig;
    });
  };

  // Mesma funil para a boleta e para o `onPatchShadowConfig` (o patch de sombra é runtime e fica só no config).
  const handleBoletaConfigPatch = patchActiveStrategy;



  // Envio manual de ordem (boleta rápida da tela) com suporte à Pirâmide & Confluência

  const handleManualOrder = (type: 'BUY' | 'SELL') => {

    const entryPrice = currentPrice;

    const ticket = Math.floor(100000 + Math.random() * 900000);



    // Pirâmide & Confluência E Acumulação C/V: a ordem manual segue a regra da estratégia.
    // Na C/V não existe alvo nem stop — a saída é o sinal oposto. Sem isso, disparar pela boleta
    // faz a ordem nascer com o SL/TP da tela, exatamente o que o operador pediu para não ter.
    if (config.strategyMode === 'PYRAMID_FLOW_CONFLUENCE' || config.strategyMode === 'SIGNAL_STACK') {
      const isStackManual = config.strategyMode === 'SIGNAL_STACK';

      const activeSameDir = orders.filter((o) => o.status === 'OPEN' && o.type === type);



      // Hedge: a entrada manual NÃO zera mais o lado oposto. Compras e vendas convivem no livro

      // (cada perna com seu papel mãe/pirâmide); a forma de zerar essas ordens será definida a

      // seguir — por enquanto os botões por lado da boleta e o ZERAR geral decidem o destino.



      const hasMother = activeSameDir.some((o) => o.role === 'MAIN');

      const role: 'MAIN' | 'PYRAMID' = hasMother ? 'PYRAMID' : 'MAIN';

      const pyrCount = activeSameDir.filter((o) => o.role === 'PYRAMID').length;

      const pyrLevel = pyrCount + 1;

      const contracts = role === 'MAIN' ? config.contracts || 1 : config.pyramidContracts || 1;

      // A boleta é a BASE: ordem MANUAL disparada aqui obedece o Alvo/Stop escritos na própria

      // boleta (antes o código zerava os dois na Pirâmide — a ordem era enviada e NUNCA

      // executava por preço). Alvo 0 na mãe = surfe até a reversão, design do modo 10R; na

      // pirâmide, Alvo 0 cai no alvo da estratégia (pyramidTpPoints) para não virar ordem sem destino.

      const tpPts = isStackManual

        ? 0

        : config.takeProfitPoints > 0

        ? config.takeProfitPoints

        : role === 'PYRAMID'

        ? config.pyramidTpPoints || 50

        : 0;

      const tp = tpPts > 0 ? (type === 'BUY' ? entryPrice + tpPts : entryPrice - tpPts) : 0;

      const slPts = isStackManual ? 0 : config.stopLossPoints > 0 ? config.stopLossPoints : 0;

      const sl = slPts > 0 ? (type === 'BUY' ? entryPrice - slPts : entryPrice + slPts) : 0;



      const orderTitle =

        role === 'MAIN'

          ? `Ordem Mãe de ${type === 'BUY' ? 'COMPRA' : 'VENDA'} (${tp > 0 ? `Alvo +${tpPts}p` : 'Surfe'})`

          : `Pirâmide #${pyrLevel} de ${type === 'BUY' ? 'COMPRA' : 'VENDA'} (Alvo +${tpPts}p)`;

      const orderDetails =

        `Entrada manual a ${entryPrice} pts (${contracts}ct). ` +

        (tp > 0 ? `Alvo TP: ${tp} pts. ` : 'Sem TP fixo (surfe até a reversão). ') +

        (sl > 0 ? `Stop: ${sl} pts.` : 'Sem stop fixo (saída na virada do fluxo).');



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

        // Boleta manual carrega o magic MANUAL: a ponte isola essas posições das saídas

        // automáticas do robô (inversão/zeragem de horário nunca encostam nelas).

        magicNumber: MANUAL_ORDER_MAGIC,

        triggerReason:

          role === 'MAIN'

            ? tp > 0

              ? `Boleta Rápida · Mãe com Alvo +${tpPts}p`

              : 'Boleta Rápida · Ordem Mãe de Surfe'

            : `Boleta Rápida · Pirâmide #${pyrLevel} (Alvo +${tpPts}p)`,

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

        chartOnly: true,

        description:

          role === 'MAIN'

            ? `Entrada: ${entryPrice.toLocaleString('pt-BR')} pts · ${tp > 0 ? `Alvo TP: ${tp.toLocaleString('pt-BR')} pts (+${tpPts}p)` : 'Surfe até reversão'}${sl > 0 ? ` · Stop: ${sl.toLocaleString('pt-BR')} pts` : ''}`

            : `Entrada: ${entryPrice.toLocaleString('pt-BR')} pts · Alvo TP: ${tp.toLocaleString('pt-BR')} pts (+${tpPts}p)${sl > 0 ? ` · Stop: ${sl.toLocaleString('pt-BR')} pts` : ''}`,

        timestamp: Date.now(),

      });



      if (mt5State.status === 'CONNECTED' && wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {

        wsRef.current.send(

          JSON.stringify({

            action: 'ORDER_SEND',

            symbol: config.symbol || (asset.activeContract || asset.primarySymbol),

            type,

            contracts,

            // Distâncias em PONTOS como na boleta do modo Reteste: a ponte converte em preços

            // absolutos sobre a execução real (sl/tp 0 = ordem "limpa" na corretora).

            sl: slPts,

            tp: tpPts,

            comment: role === 'MAIN' ? 'MAE_SURFE' : `PIR_${pyrLevel}`,

            magic: MANUAL_ORDER_MAGIC,

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

      magicNumber: MANUAL_ORDER_MAGIC,

      triggerReason: `Disparo Manual via Terminal (${config.contracts} ctros)`,

      isRealMT5: mt5State.status === 'CONNECTED',

      auditTrail: [manEvt],

    };



    setOrders((prev) => [newOrder, ...prev]);



    setLatestToast({

      id: newOrder.id,

      type,

      title: `ORDEM ${type === 'BUY' ? 'COMPRA' : 'VENDA'} MANUAL ENVIADA`,

      chartOnly: true,

      description: `Entrada: ${entryPrice.toLocaleString('pt-BR')} pts · SL: ${sl} · TP: ${tp}`,

      timestamp: Date.now(),

    });



    // Se conectado ao MT5 Live, envia para execução real

    if (mt5State.status === 'CONNECTED' && wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {

      wsRef.current.send(

        JSON.stringify({

          action: 'ORDER_SEND',

          symbol: config.symbol || (asset.activeContract || asset.primarySymbol),

          type,

          contracts: config.contracts,

          sl: config.stopLossPoints,

          tp: config.takeProfitPoints,

          comment: 'Manual Web Terminal',

          magic: MANUAL_ORDER_MAGIC,

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

      magicNumber: mainRobotMagic(config),

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

      magicNumber: mainRobotMagic(config),

      triggerReason: `Fechamento Box ${renkoScaleLabel(config.boxPoints, asset)} Verde · Pirâmide #1 (Alvo: +${config.pyramidTpPoints || 50}p)`,

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

      chartOnly: true,

      timestamp: now,

    });

  }, [currentPrice, config]);



  // Zerar posições abertas. COM LADO é o início do hedge: 'BUY' zera só compras, 'SELL' só

  // vendas. SEM LADO zera tudo — é o uso interno de sempre (inversão da estratégia e trava do

  // simulador), e a ponte MT5 recebe o mesmo comando com type 'ALL' (o script filtra por lado

  // quando vem BUY/SELL).

  const handleClosePositions = (side?: 'BUY' | 'SELL') => {

    const targets = orders.filter((o) => o.status === 'OPEN' && (!side || o.type === side));

    if (targets.length === 0) return;

    setOrders((prev) =>

      prev.map((o) => {

        if (o.status !== 'OPEN') return o;

        if (side && o.type !== side) return o;
        if (!isOrderForAsset(o, asset)) return o;

        const activeCtros = o.remainingContracts || o.contracts;
        const safePrice = isPriceSaneForAsset(currentPrice, asset) ? currentPrice : (isPriceSaneForAsset(o.entryPrice, asset) ? o.entryPrice : asset.basePrice);
        const pts = isPriceSaneForAsset(o.entryPrice, asset) ? (o.type === 'BUY' ? safePrice - o.entryPrice : o.entryPrice - safePrice) : 0;

        const fin = pointsToBRL(pts, activeCtros, asset) + (o.partialFinancial || 0);



        const closeEvt = OrderAuditService.createEvent(

          'MANUAL_CLOSED',

          side

            ? `Encerramento Manual ${side === 'BUY' ? 'COMPRAS' : 'VENDAS'}`

            : 'Encerramento Manual Compulsório',

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

      wsRef.current.send(JSON.stringify({ action: 'CLOSE_POSITIONS', type: side || 'ALL' }));

    }



    setLatestToast({

      id: `close-${Date.now()}`,

      type: side === 'BUY' ? 'BUY' : 'SELL',

      title: side ? (side === 'BUY' ? 'COMPRAS ZERADAS' : 'VENDAS ZERADAS') : 'POSIÇÕES ZERADAS',

      chartOnly: true,

      description: `${targets.length} posição(ões) ${side ? (side === 'BUY' ? 'de compra' : 'de venda') : 'aberta(s)'} encerrada(s) a mercado e registrada(s) na auditoria.`,

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



  // INTERRUPTOR DE REGIME dos portões de horário (Ciclo 12 — regra do operador): o relógio do

  // pregão (janela 08:55–17:30 + zeragem das 17:30) só vale nos dois mundos que imitam a B3 de

  // verdade — MT5 conectado (ordens REAIS) e replay (SESSÃO SIMULADA com hora de barra). No

  // simulador ao vivo o portão fica escancarado 24h: teste às 18:22 não pode virar "FORA DA

  // JANELA". Robôs sombra e coletor herdam a chave (mesmas funções puras).

  useEffect(() => {

    setEnforceTimeGates(isReplaying || mt5State.status === 'CONNECTED');

  }, [isReplaying, mt5State.status]);



  // Troca manual da série do gráfico: o robô passa a operar nela (Opção A).

  // Posições abertas NÃO são liquidadas automaticamente — apenas avisamos o operador.

  const handleSeriesChange = (s: ChartSeries) => {

    if (s === chartSeries) return;

    setChartSeries(s);

    if (s === 'range') {
      rebuildRangeSeries(rangePoints);
    }

    const label =

      s === 'renko'

        ? `Pontos (Renko ${renkoScaleLabel(config.boxPoints, asset)})`

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
  const [replayDateLabel, setReplayDateLabel] = useState<string>('04/11/2026 (Hoje)');
  const [replayCurrentTimeStr, setReplayCurrentTimeStr] = useState<string>('');
  const replayAbortRef = useRef<(() => void) | null>(null);



  // Velocidade escolhida direto na tira de status: comanda o compasso do replay e o ritmo do

  // feed ao vivo. Antes era chip de ciclo (1x→2x→5x→10x); viraram opções explícitas porque um

  // teste de velocidade precisa SELECIONAR o valor, não clicar até ele aparecer.

  const SPEED_CHOICES = [1, 2, 3, 5, 10];

  // O slider da aba Simulador aceita qualquer valor de 1 a 10: se a velocidade atual não estiver

  // entre os chips, ela entra na lista para a seleção nunca ficar sem nenhum item aceso.

  const speedChoices = SPEED_CHOICES.includes(simulationSpeed) ? SPEED_CHOICES : [...SPEED_CHOICES, simulationSpeed].sort((x, y) => x - y);

  // Mesmo cuidado com os dias: um valor salvo antigo fora de 1/3/5 entra na lista, para a caixa

  // nunca ficar com o botão mostrando um número solto e nenhuma opção acesa.

  const dayChoices = REPLAY_DAY_CHOICES.includes(replayDays) ? REPLAY_DAY_CHOICES : [...REPLAY_DAY_CHOICES, replayDays].sort((a, b) => a - b);



  // Resultado da última corrida, congelado na linha de chegada (ver ReplayRunSummary acima).

  const [lastReplay, setLastReplay] = useState<ReplayRunSummary | null>(null);

  const pendingReplayMetaRef = useRef<{

    days: number; speed: number; seed: number; operated: boolean; aborted: boolean;

    source: 'REAL' | 'SYNTHETIC'; volumeSource?: VolumeSource; origin?: 'LIVE' | 'BANK'; fonte?: HistoryMeta; tickCount: number;

  } | null>(null);

  // Instante (relógio de parede) em que a última corrida começou — piso para isolar as ORDENS REAIS

  // desta rodada no ledger (o livro real usa Date.now(); sombra e coletor entram por snapshot).

  const roundStartTsRef = useRef<number>(0);

  useEffect(() => {

    if (isReplaying) return;

    const meta = pendingReplayMetaRef.current;

    if (!meta) return;

    pendingReplayMetaRef.current = null;

    // finish() e este efeito caem no MESMO batch do React: aqui `orders` já é o estado final

    // da corrida, incluindo os ticks do último passo (sem isso o resumo ficaria um passo atrás).

    const closedRun = orders.filter(

      (o) => o.status !== 'OPEN' && o.status !== 'PENDING_LIMIT'

    );

    setLastReplay({

      ...meta,

      pnl: closedRun.reduce((acc, o) => acc + (o.financialResult || 0), 0),

      trades: closedRun.length,

      openCount: orders.filter((o) => o.status === 'OPEN' || o.status === 'PENDING_LIMIT').length,

    });

    // LEDGER DE RODADAS (Raio-X): congela ESTA corrida como um registro reauditável, somando as

    // ações das QUATRO automações que participaram (robô real + boleta + MT5 no livro real, Robô 2

    // na sombra e as 6 séries no coletor). Persiste em localStorage, sobrevive a F5 e exporta CSV.

    try {

      const shadowSnap = shadowRobotService.getSnapshot();

      const collectorSnap = seriesCollectorService.getSnapshot();

      const now = Date.now();

      const round = buildRound({

        startedAt: roundStartTsRef.current || now,

        finishedAt: now,

        roundStartTs: roundStartTsRef.current || now,

        meta,

        assetId: asset.id,

        assetSymbol: asset.primarySymbol,

        boxLabel: renkoScaleLabel(config.boxPoints, asset),

        strategyName: activeStrategyName,

        strategyId: config.strategyId ?? null,

        // Com MT5 conectado os ticks ao vivo também alimentam sombra e coletor → rodada 'mista'

        // (a tela avisa, em vez de atribuir a atividade ao vivo silenciosamente ao replay).

        liveMix: mt5State.status === 'CONNECTED',

        realOrders: orders,

        shadowTrades: shadowSnap.trades,

        collectorTrades: (Object.keys(collectorSnap.series) as SeriesKey[]).map((k) => ({

          series: k,

          trades: collectorSnap.series[k].trades,

        })),

      });

      roundAuditService.record(round);

    } catch {

      // Ledger é anexo de auditoria: uma falha aqui jamais pode quebrar o fim do replay na tela.

    }

    // eslint-disable-next-line react-hooks/exhaustive-deps

  }, [isReplaying]);



  /**
   * Rótulo de PROCEDÊNCIA do replay (decisão 7: sem volume real não existe fluxo para validar).
   *
   * São três níveis de verdade, e a tela não pode embaçá-los: a FITA REAL comprimida valida
   * estratégia; a barra M1 fabricada ensaia a tela; o sintético é demonstração. A resolução do
   * bucket vai junto porque é ela que limita a virada mais fina que o Renko ainda enxerga —
   * omiti-la faria um replay de 4 s parecer igual a um de 250 ms.
   *
   * A ORIGEM (LIVE × BANK) entra no mesmo rótulo porque responde a outra pergunta: se a fita
   * saiu agora do terminal ou de um arquivo capturado. É o que diz se o ensaio depende da
   * corretora estar no ar, e se um resultado pode ser repetido tick a tick amanhã.
   */
  const fonteReplayLabel = (

    source: 'REAL' | 'SYNTHETIC',

    volumeSource?: VolumeSource,

    fonte?: HistoryMeta,

    origin?: 'LIVE' | 'BANK',

  ): string => {

    if (source === 'SYNTHETIC') return 'gerador SINTÉTICO (demonstração)';

    const origem = origin === 'BANK' ? ', capturada no banco local' : origin === 'LIVE' ? ', MT5 ao vivo' : '';

    const res = fonte?.resolucaoMs ? ` · buckets de ${fonte.resolucaoMs.toLocaleString('pt-BR')} ms` : '';

    // Se o orçamento de bytes obrigou a servir outra resolução, isso vai no rótulo: pedir 100 ms e
    // receber 1.000 ms sem aviso é o tipo de mentira que só sai do log do servidor.
    const troca = fonte?.resolucaoPedidaMs
      ? ` (pedido era ${fonte.resolucaoPedidaMs.toLocaleString('pt-BR')} ms; não coube no orçamento)`
      : '';

    const lidos = fonte?.ticksReaisLidos ? ` (${fonte.ticksReaisLidos.toLocaleString('pt-BR')} ticks de negócio lidos)` : '';

    if (volumeSource === 'TICKS_REAIS') {

      // A fita real comprimida só pode dizer "valida estratégia" na faixa onde o Δ foi MEDIDO
      // contra a fita cheia. Fora dela o caminho continua verdadeiro e o limiar não: dizer
      // "valida" num bucket de 8 s seria a tela vender uma coisa que ela não entregou.
      const fid = typeof fonte?.alinhamentoMedido === 'number'
        ? ` — ${Math.round(fonte.alinhamentoMedido * 100)}% dos boxes da fita cheia`
        : '';

      if (fonte?.validaEstrategia === false) {
        return `fita REAL da B3 comprimida${origem}${res}${troca}${lidos} — SÓ CAMINHO: Δ fora da faixa validada${fid}`;
      }

      if (fonte?.validaEstrategia !== true) {
        return `fita REAL da B3 comprimida${origem}${res}${troca}${lidos} — fidelidade desta resolução não medida`;
      }

      return `fita REAL da B3 comprimida${origem}${res}${troca}${lidos} — valida estratégia${fid}`;

    }

    if (volumeSource === 'M1_RATE') return `barras M1 do MT5${origem} com volume FABRICADO — não valida estratégia`;

    if (volumeSource === 'NONE') return `histórico SEM volume${origem} — delta/CVD não significam nada`;

    return `histórico real do MT5${origem}`;

  };



  /**

   * De onde vêm os ticks do replay (Fase 2): com a ponte do MT5 conectada pede HISTÓRICO REAL e só

   * cai no gerador sintético se a corretora não devolver nada — sempre ROTULANDO a origem, porque

   * um backtest inventado lido como mercado real é a pior mentira que esta tela pode contar.

   */

  const resolveReplayTicks = useCallback(
    async (
      targetDays: number,
      seed: number,
      targetDate?: string
    ): Promise<{
      ticks: Tick[];
      source: 'REAL' | 'SYNTHETIC';
      volumeSource?: VolumeSource;
      origin?: 'LIVE' | 'BANK';
      fonte?: HistoryMeta;
      note?: string;
    }> => {
      // Pede targetDays para carregar exatamente os dias solicitados sem mascarar o ensaio
      const daysToRequest = Math.max(1, Math.min(10, targetDays));
      const synthetic = () =>
        generateHistoricalTicks(daysToRequest, referencePrice(asset), seed, asset);

      const socket = wsRef.current;

      if (mt5State.status !== 'CONNECTED' || !socket || socket.readyState !== WebSocket.OPEN) {
        // Sem ponte, ainda assim podemos tocar REAL: o banco local guarda a fita dos pulls
        // conectados anteriores (isolado por ativo para nunca misturar WIN e WDO).
        // Só caímos no sintético se não houver NADA real capturado deste ativo.
        const bank = realTapeService.loadMostRecent(daysToRequest, asset.id);
        if (bank && bank.ticks.length > 0) {
          return {
            ticks: bank.ticks,
            source: 'REAL' as const,
            volumeSource: bank.volumeSource,
            origin: 'BANK' as const,
            note: `Origem: fita REAL CAPTURADA (banco local deste navegador, ${bank.days} dia(s)).${bank.truncated ? ' Obs.: algum dia foi recortado pelo teto de armazenamento.' : ''}`,
          };
        }
        return { ticks: synthetic(), source: 'SYNTHETIC' as const };
      }

      try {
        const res = await marketHistoryService.requestHistory({
          reqId: `hist-${Date.now()}`,
          symbol: chartSymbolFor(asset),
          days: daysToRequest,
          date: targetDate,
          asset,
          send: (payload) => socket.send(payload),
          timeoutMs: 30000,
        });

        if (res.ticks.length === 0) {
          return {
            ticks: synthetic(),
            source: 'SYNTHETIC' as const,
            note: 'O MT5 respondeu ao pedido de histórico, mas devolveu ZERO ticks. O replay rodou em mercado SINTÉTICO — confira a profundidade de histórico da sua conta na corretora.',
          };
        }

        // Banca a fita real: daqui pra frente o replay pode tocá-la mesmo sem ponte (particionado por ativo).
        realTapeService.save(res.ticks, res.volumeSource, asset.id);

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

          origin: 'LIVE' as const,

          fonte: res.meta,

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

    [asset, mt5State.status]

  );



  const handleRunRealBacktest = (date: string, renkoR: number) => {

    const isCsv = date.endsWith('.csv') || date.includes('data/');

    if (!isCsv && mt5State.status !== 'CONNECTED') {

      setLatestToast({

        id: `bt-warn-${Date.now()}`,

        type: 'SELL',

        title: 'MT5 DESCONECTADO',

        description: 'Conecte o MetaTrader 5 para rodar o backtest com ticks reais de pregões online.',

        timestamp: Date.now(),

      });

      return;

    }

    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {

      setLatestToast({

        id: `bt-warn-${Date.now()}`,

        type: 'SELL',

        title: 'PONTE DESCONECTADA',

        description: 'A ponte local (bot_mt5) precisa estar ativa na porta 8765.',

        timestamp: Date.now(),

      });

      return;

    }

    setIsBacktestingReal(true);

    setRealBacktestResult(null);

    wsRef.current.send(

      JSON.stringify({

        action: 'RUN_BACKTEST',

        source: date,

        date,

        renkoR,

        symbol: chartSymbolFor(asset),

        strategy: config.strategyMode,

      })

    );

    setLatestToast({

      id: `bt-start-${Date.now()}`,

      type: 'INFO',

      title: isCsv ? '⏳ PROCESSANDO DATASET CSV...' : '⏳ PROCESSANDO BACKTEST MT5...',

      description: `Executando simulação tick-a-tick em ${date} (${renkoR}R).`,

      timestamp: Date.now(),

    });

  };



  /**
   * Liga/desliga o MODO REPLAY direto no processo da ponte ({ action: 'SET_REPLAY_MODE' }).
   * Existe por dois motivos: (1) a trava por variável de ambiente obrigaria reiniciar o .py a cada
   * ensaio; (2) o botão 'Robô' NÃO protege uma sessão de validação -- a própria tela reenvia
   * `armed: config.active` no AUTH, então qualquer reconexão religaria as entradas sozinha. Com o
   * modo ligado, nada abre posição no PC do MT5 enquanto o replay roda, nem o loop vivo dele.
   */
  const handleToggleReplayMode = (on: boolean) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      setLatestToast({
        id: `replay-mode-offline-${Date.now()}`,
        type: 'SELL',
        title: '⛔ PONTE DESCONECTADA',
        description: 'Para ligar o modo replay/validação é preciso estar conectado ao MT5: a trava mora no processo que envia as ordens, não nesta aba.',
        timestamp: Date.now(),
      });
      return;
    }
    try {
      wsRef.current.send(JSON.stringify({ action: 'SET_REPLAY_MODE', on }));
    } catch {
      // conexão caindo: o onclose limpa o estado e a tela mostra a ponte fora do ar
    }
  };



  const changeSimulationSpeed = (spd: number, isRemoteSync?: boolean) => {
    setSimulationSpeed(spd);
    if (!isRemoteSync) {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        try {
          wsRef.current.send(JSON.stringify({ action: 'REPLAY_SPEED_SYNC', speed: spd }));
        } catch {}
      }
      try {
        saasChannelRef.current?.postMessage({ type: 'REPLAY_SPEED_SYNC', speed: spd });
      } catch {}
    }
  };

  const changeReplayDays = (days: number, isRemoteSync?: boolean) => {
    setReplayDays(days);
    if (!isRemoteSync) {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        try {
          wsRef.current.send(JSON.stringify({ action: 'REPLAY_DAYS_SYNC', days }));
        } catch {}
      }
      try {
        saasChannelRef.current?.postMessage({ type: 'REPLAY_DAYS_SYNC', days });
      } catch {}
    }
  };

  const handleReplayHistory = (days: number, seedOverride?: number, dayKeyOverride?: string, isRemoteSync?: boolean) => {

    // Trava atômica síncrona imediata contra reentrância / cliques duplos / loops de mensagens
    if (isReplayingRef.current) {
      console.warn('⚠️ [Replay] Tentativa de iniciar replay enquanto já está ativo. Ignorada.');
      return;
    }
    isReplayingRef.current = true;
    setIsReplaying(true);

    // Instala o marco de início desta corrida: ledger e PnL da sessão zeram completamente
    // para não carregar resultados anteriores nem mascarar a validação.
    roundStartTsRef.current = Date.now();
    sessionStartRef.current = Date.now();

    // Tempo mínimo de uma corrida: 1 dia inteiro (nunca "só alguns minutos")
    const replayTargetDays = Math.max(1, Math.min(10, Math.round(days)));
    setReplayDays(replayTargetDays);

    const seedForRun = seedOverride ?? replaySeed ?? randomReplaySeed();

    // O replay derruba os gráficos e o coletor e começa um pregão DO ZERO: as ordens antigas
    // e o resultado financeiro da sessão são integralmente zerados em cada nova rodada.
    OrderAuditService.clearIntradayAudit(asset.id);
    setOrders([]);
    shadowRobotService.resetBook();
    seriesCollectorService.reset();
    setRealBacktestResult(null);

    // Limpa imediatamente o gráfico e séries na tela
    setTicks([]);
    setBoxes([]);
    setSessionGaps([]);
    setCurrentBox(null);
    setCvd(0);
    setRangeBoxes([]);
    setRangeCurrentBox(null);
    setTimeBoxes([]);
    setTimeCurrentBox(null);
    allTicksRef.current = [];

    // Modo OPERA agora sempre liberado no Replay em modo Paper Trading (sem envio à corretora)
    const operate = replayOperates;
    setLatestToast({
      id: `replay-start-${Date.now()}`,
      type: 'INFO',
      title: '⏳ CARREGANDO PREGÃO DO REPLAY...',
      description: operate
        ? 'Preparando dados do pregão e ligando simulação (paper trading com confluência de fluxo)...'
        : 'Carregando dados históricos para reprodução no gráfico e indicador de fluxo.',
      timestamp: Date.now(),
    });

    // A ponte segura o ensaio sozinha: entra em modo validação agora e só sai quando o replay
    // termina (REPLAY_END). Sincroniza também com todos os dispositivos da rede (SaaS Multi-Tela).
    if (!isRemoteSync) {
      try {
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({
            action: 'REPLAY_START_SYNC',
            days: replayTargetDays,
            speed: simulationSpeed,
            seed: seedForRun,
            boxPoints: config.boxPoints,
            dayKey: dayKeyOverride,
            senderId: tabSessionIdRef.current
          }));
        }
      } catch {}
      try {
        saasChannelRef.current?.postMessage({
          type: 'REPLAY_START_SYNC',
          days: replayTargetDays,
          speed: simulationSpeed,
          seed: seedForRun,
          boxPoints: config.boxPoints,
          dayKey: dayKeyOverride,
          senderId: tabSessionIdRef.current
        });
      } catch {}
    }

    setReplayProgress(0);

    // Cede um frame para a UI mostrar "rodando 0%" antes de gerar os ticks (isso bloqueia um instante)
    window.setTimeout(async () => {
      const engine = engineRef.current;
      const rangeEng = rangeEngineRef.current;
      const timeEng = timeEngineRef.current;

      const targetDate = dayKeyOverride || selectedPregaoDate || undefined;
      const run = await resolveReplayTicks(replayTargetDays, seedForRun, targetDate);
      const rawTicks = run.ticks;

      if (!rawTicks || rawTicks.length === 0) {
        isReplayingRef.current = false;
        setIsReplaying(false);
        setLatestToast({
          id: `replay-empty-${Date.now()}`,
          type: 'SELL',
          title: 'HISTÓRICO INDISPONÍVEL',
          description: 'Nenhum tick encontrado para reprodução. Tente outro pregão ou verifique a conexão com a ponte.',
          timestamp: Date.now(),
        });
        return;
      }

      // Organiza e agrupa os ticks por data de pregão (YYYY-MM-DD local)
      const daysMap = new Map<string, Tick[]>();
      for (const t of rawTicks) {
        const d = new Date(t.timestamp);
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        const key = `${y}-${m}-${day}`;
        if (!daysMap.has(key)) daysMap.set(key, []);
        daysMap.get(key)!.push(t);
      }
      const sortedDays = Array.from(daysMap.keys()).sort();

      let ticks: Tick[] = rawTicks;
      let label = '';
      let calculatedContextEnd = 0;

      if (dayKeyOverride && daysMap.has(dayKeyOverride)) {
        const targetDayKey = dayKeyOverride;
        ticks = daysMap.get(targetDayKey) || rawTicks;
        calculatedContextEnd = 0;
        const [y, m, d] = (targetDayKey || '').split('-');
        const flowIdx = currentAssetPregoes.findIndex((p) => p.date === targetDayKey);
        const flowCode = flowIdx >= 0 ? `Flow${flowIdx + 1}` : 'Flow';
        label = `${flowCode} (${d}/${m})`;
      } else if (sortedDays.length >= 1 && replayTargetDays === 1) {
        // Replay do pregão Flow1 (mais recente): inicia 100% limpo a partir da abertura
        const targetDayKey = sortedDays[sortedDays.length - 1];
        ticks = daysMap.get(targetDayKey) || rawTicks;
        calculatedContextEnd = 0;
        const [y, m, d] = (targetDayKey || '').split('-');
        label = `Flow1 (${d}/${m})`;
      } else if (sortedDays.length >= 2 && replayTargetDays === 2) {
        // Replay do pregão Flow2 (penúltimo pregão): inicia 100% limpo
        const targetDayKey = sortedDays[sortedDays.length - 2];
        ticks = daysMap.get(targetDayKey) || rawTicks;
        calculatedContextEnd = 0;
        const [y, m, d] = (targetDayKey || '').split('-');
        label = `Flow2 (${d}/${m})`;
      } else {
        ticks = rawTicks;
        calculatedContextEnd = 0;
        label = `Flow ${replayTargetDays}D`;
      }

      setReplayDateLabel(label);

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

      // Motor do Robô 2 entra na mesma régua da corrida (senão ele começaria de outro preço)

      if (shadowRobotService.getEffectiveConfig()) {

        const sEng = ensureShadowEngine();

        if (sEng) sEng.initialize(ticks[0].price, ticks[0].timestamp);

      }

      seriesCollectorService.reset();

      seriesCollectorService.beginBatch();

      // O livro da sombra já foi zerado no clique (junto com a boleta, em handleReplayHistory);

      // aqui só entra no modo lote — resetBook de novo jogaria fora os trades deste trecho inicial

      // nos segundos entre o clique e o começo da reprodução.

      shadowRobotService.beginBatch();
      allTicksRef.current = [];

      // Garante que a tela e os acumuladores iniciem 100% zerados
      setBoxes([]);
      setSessionGaps([]);
      setCurrentBox(null);
      setCvd(0);
      setRangeBoxes([]);
      setRangeCurrentBox(null);
      setTimeBoxes([]);
      setTimeCurrentBox(null);
      setCurrentPrice(ticks[0].price);



      // Um tick atravessa os 6 contadores. No modo "OPERA" ele passa pelo MESMO caminho do

      // feed ao vivo (estratégia, ordens, auditoria, PnL e coletor); no modo silencioso só

      // alimenta os contadores do coletor.

      const ingestSilent = (t: Tick) => {

        if (allTicksRef.current.length < 50000) allTicksRef.current.push(t);

        seriesCollectorService.markToMarket(t.price, t.timestamp);

        const r = engine.processTick(t, config);

        for (const box of r.closedBoxes) {

          seriesCollectorService.ingest('renko', box, engine.getBoxes().slice(0, box.index), config, renkoScale, engine.getRegimeMeter());

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

          for (const box of ar.closedBoxes) {

            seriesCollectorService.ingest(alt.key, box, altEng.getBoxes().slice(0, box.index), config, `${alt.pts} pts`, altEng.getRegimeMeter());

          }

        }

        // Replay SEMPRE é mercado sintético: `false` para não marcar o dia como "dado real"

        shadowRobotService.markToMarket(t.price, t.timestamp, false);

        feedShadowEngine(t);

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
        if (last) {
          setReplayCurrentTimeStr(last.timeStr || new Date(last.timestamp).toLocaleTimeString('pt-BR'));
        }

        setCurrentPrice(last.price);

        setCvd(engine.getCvd());

        setBoxes([...engine.getBoxes()]);

        setCurrentBox(engine.getCurrentBox());

        setRangeBoxes([...rangeEng.getBoxes()]);

        setRangeCurrentBox(rangeEng.getCurrentBox());

        setTimeBoxes([...timeEng.getBoxes()]);

        setTimeCurrentBox(timeEng.getCurrentBox());

      };



      // DIA ANTERIOR ESTÁTICO: se houver ticks de contexto anterior, processa de uma vez
      // para aparecer no gráfico imediatamente, sem animação (servindo de suporte/resistência).
      const contextEnd = calculatedContextEnd;
      if (contextEnd > 0) {
        for (let i = 0; i < contextEnd; i += 1) ingestSilent(ticks[i]);
        const markStaticContext = (arr: { isStaticContext?: boolean }[]) => {
          for (const b of arr) b.isStaticContext = true;
        };
        markStaticContext(engine.getBoxes());
        markStaticContext(rangeEng.getBoxes());
        markStaticContext(timeEng.getBoxes());
        ALT_RENKO_SCALES.forEach((alt) => markStaticContext(altEnginesRef.current[alt.key].getBoxes()));
      }
      publish(contextEnd); // o dia anterior aparece instantaneamente inteiro na tela!
      const replayTicks = Math.max(1, ticks.length - contextEnd);

      // Compasso de velocidade adaptativo pelo volume total de ticks da fita:
      // Em 1x: reprodução em velocidade fluida permitindo acompanhar a formação dos blocos e Heikin-Ashi (~2-3min por pregão).
      // Em 2x, 3x, 5x, 10x: acelera o avanço para análise ágil e instantânea.
      const isDense = replayTicks > 25000;
      const paceFor = (s: number) => {
        // FRAÇÕES: 0,5x entrega 1 tick a cada 2 passos e 0,25x 1 a cada 4 — mais devagar que
        // o passo base sem inventar espera artificial no laço.
        if (s <= 0.5) {
          return { speed: s, stepMs: 40, chunk: s <= 0.25 ? 1 : 1, divisor: s <= 0.25 ? 4 : 2 };
        }
        const speed = Math.max(1, Math.min(10, Math.round(s)));
        if (speed === 1) {
          return { speed: 1, stepMs: 30, chunk: isDense ? 45 : 4, divisor: 1 };
        }
        if (speed === 2) {
          return { speed: 2, stepMs: 25, chunk: isDense ? 100 : 8, divisor: 1 };
        }
        if (speed === 3) {
          return { speed: 3, stepMs: 20, chunk: isDense ? 220 : 18, divisor: 1 };
        }
        if (speed === 5) {
          return { speed: 5, stepMs: 16, chunk: isDense ? 500 : 40, divisor: 1 };
        }
        // 10x = Modo ultrarrápido
        return { speed: 10, stepMs: 16, chunk: isDense ? 1200 : 90, divisor: 1 };
      };

      let pace = paceFor(simulationSpeedRef.current);

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

        shadowRobotService.endBatch();

        if (!operate) allTicksRef.current = ticks.slice(0, Math.max(cursor, contextEnd)); // no modo opera o próprio feed monta o buffer

        publish(cursor);

        setReplayProgress(0);

        // Se alguma ordem do replay ainda estiver aberta na linha de chegada,
        // liquida a mercado no preço final para consolidar o PnL sem deixar posições soltas
        const lastTick = ticks[Math.max(0, Math.min(cursor - 1, ticks.length - 1))];
        const finalPrice = lastTick ? lastTick.price : currentPrice;
        setOrders((prev) =>
          prev.map((o) => {
            if ((o.status === 'OPEN' || o.status === 'PENDING_LIMIT') && isOrderForAsset(o, asset)) {
              const safeFinal = isPriceSaneForAsset(finalPrice, asset) ? finalPrice : (isPriceSaneForAsset(o.entryPrice, asset) ? o.entryPrice : asset.basePrice);
              const pts = isPriceSaneForAsset(o.entryPrice, asset) ? (o.type === 'BUY' ? safeFinal - o.entryPrice : o.entryPrice - safeFinal) : 0;
              const rc = o.remainingContracts ?? o.contracts ?? 1;
              const fin = pointsToBRL(pts, rc, asset) + (o.partialFinancial || 0);
              const closeEvt = OrderAuditService.createEvent(
                'DAY_CLOSE_FORCED',
                `Encerramento do Replay (${pts >= 0 ? '+' : ''}${pts} pts)`,
                `Ordem liquidada a mercado no preço de fechamento do replay (${finalPrice} pts) · R$ ${fin.toFixed(2)}`,
                finalPrice,
                rc
              );
              return {
                ...o,
                status: 'CLOSED_MANUAL' as const,
                exitPrice: finalPrice,
                exitTimestamp: Date.now(),
                exitTimeStr: new Date().toTimeString().split(' ')[0],
                exitReason: 'DAY_CLOSE' as const,
                pointsResult: pts,
                financialResult: fin,
                auditTrail: o.auditTrail ? [...o.auditTrail, closeEvt] : [closeEvt],
              };
            }
            return o;
          })
        );

        isReplayingRef.current = false;
        setIsReplaying(false);

        // Fim do ensaio: a ponte volta ao estado em que estava antes do replay.
        try {
          if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({ action: 'REPLAY_END' }));
          }
        } catch {}

        // Meta da corrida (dias/velocidade/seed/modo). O PnL em si é somado no efeito de

        // [isReplaying], porque aqui o `orders` deste fechamento ainda não foi commitado.

        pendingReplayMetaRef.current = {

          days: replayTargetDays, speed: pace.speed, seed: seedForRun, operated: operate, aborted,

          source: run.source, volumeSource: run.volumeSource, origin: run.origin, fonte: run.fonte,
          tickCount: ticks.length,

        };

        setLatestToast({

          id: `replay-${Date.now()}`,

          type: 'INFO',

          title: aborted

            ? `REPLAY INTERROMPIDO: ${cursor.toLocaleString('pt-BR')} DE ${ticks.length.toLocaleString('pt-BR')} TICKS`

            : `REPLAY CONCLUÍDO: ${replayTargetDays} DIA(S) DE HISTÓRICO`,

          description: `${
            aborted
              ? `${cursor.toLocaleString('pt-BR')} ticks reproduzidos; o feed ao vivo retoma do último preço.`
              : `${replayTicks.toLocaleString('pt-BR')} ticks ${
                  run.source === 'REAL' ? (run.origin === 'BANK' ? 'REAIS capturados' : 'REAIS do MT5') : 'sintéticos'
                } reproduzidos com sucesso no pregão de ${label}.`
          } ${
            run.source === 'REAL'
              ? `Fonte: ${fonteReplayLabel(run.source, run.volumeSource, run.fonte, run.origin)}.`
              : `Seed do pregão: #${seedForRun}.`
          } Velocidade ${pace.speed}x.${operate ? ' Operações ativas na simulação (Paper Trading).' : ' Replay silencioso (OPERA desligado).'}`,

          timestamp: Date.now(),

        });

      };



      const step = () => {

        // Velocidade relida a cada passo → a caixa "Nx" responde durante a corrida

        pace = paceFor(simulationSpeedRef.current);

        const upto = Math.min(ticks.length, cursor + pace.chunk);

        // A CADA N PASSOS: nas frações (¼x e ½x) só a cada 4 ou 2 passos — o gráfico anda devagar
        // de verdade, sem inflar o passo base e sem atrasar a interface.
        // O cursor e o `upto` são locais deste passo: pular a entrega NÃO pode deixar o cursor
        // para trás, senão o laço nunca alcança o fim da fita e o replay para no meio.
        const divisor = (pace as { divisor?: number }).divisor ?? 1;
        const entregar = divisor <= 1 || iters % divisor === 0;
        if (entregar) {
          for (; cursor < upto; cursor += 1) stepFor(ticks[cursor]);
          publish(upto);
        } else {
          // avança o cursor mesmo sem entregar: o passo seguinte parte do lugar certo
          cursor = upto;
        }

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

        timerId = window.setTimeout(step, pace.stepMs);

      };



      replayAbortRef.current = () => finish(true);

      step();

    }, 60);

  };



  // Parar a reprodução no meio do caminho (o período já desenhado fica na tela e no coletor)
  const handleStopReplay = (isRemoteSync?: boolean) => {
    isReplayingRef.current = false;
    setIsReplaying(false);
    replayAbortRef.current?.();
    if (!isRemoteSync) {
      try {
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ action: 'REPLAY_STOP_SYNC', senderId: tabSessionIdRef.current }));
        }
      } catch {}
      try {
        saasChannelRef.current?.postMessage({ type: 'REPLAY_STOP_SYNC', senderId: tabSessionIdRef.current });
      } catch {}
    }
  };

  useEffect(() => {
    handleReplayHistoryRef.current = handleReplayHistory;
    handleStopReplayRef.current = handleStopReplay;
    toggleMT5ConnectRef.current = toggleMT5Connect;
    handleBoletaConfigPatchRef.current = handleBoletaConfigPatch;
  });



  // Se a página fechar/HMR desmontar o App no meio do replay, encerra o timer restante

  useEffect(() => () => { replayAbortRef.current?.(); }, []);



  // SEM REPLAY AUTOMÁTICO NO BOOT (Ciclo 12 — regra do operador). Existia aqui um efeito que,

  // ao abrir a plataforma, disparava o replay sozinho: desenhava o pregão com timestamps de

  // HORA DE SESSÃO (à vezes à frente do relógio real), ZERAVA as ordens do livro e, enquanto

  // rodava (`isReplaying`), bloqueava o ▶ SIM — era o "auto roda de um jeito, manual de outro".

  // Agora o boot é parado e vazio por design: história na tela só por comando manual

  // (setinha da tira de status), mercado vivo só pelo ▶ SIM ou pela ponte MT5.



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



  // AVISO DA ALAVANCA A (mãe no breakeven): roda uma vez por versão de flag e só fala de quem
  // estava com a mãe de Pirâmide 100% desprotegida. Estratégia que você já protegeu não é tocada.

  useEffect(() => {

    const m = mainBreakevenRef.current;

    if (!m || (!m.config && m.strategies === 0)) return;

    const timer = setTimeout(() => {

      setLatestToast({

        id: `main-breakeven-migration-${Date.now()}`,

        type: 'INFO',

        title: `PIRÂMIDE: MÃE AGORA PROTEGIDA NO BREAKEVEN`,

        description: `${[

          m.config ? 'A estratégia ativa' : '',

          m.strategies > 0 ? `${m.strategies} estratégia(s) salvas do Estúdio` : '',

        ]

          .filter(Boolean)

          .join(' e ')} estavam com a ordem mãe sem nenhuma proteção (o lucro da pirâmide voltava na virada de fluxo). Agora, a cada TP de pirâmide o stop da mãe sobe para o breakeven (+ as taxas). O banco A/B triplicou a mesa no pregão sintético. Você pode reverter na caixinha em Ajustes → Pirâmide.`,

        timestamp: Date.now(),

      });

    }, 1000);

    return () => clearTimeout(timer);

    // eslint-disable-next-line react-hooks/exhaustive-deps

  }, []);



  // AVISO DA ALAVANCA B (filtro de acumulação ER desligado): roda uma vez por versão de flag e só
  // fala de quem estava com o filtro no default intocado. Filtro que você calibrou não é tocado.
  useEffect(() => {
    const m = consolidationOffRef.current;
    if (!m || (!m.config && m.strategies === 0)) return;
    const timer = setTimeout(() => {
      setLatestToast({
        id: `consolidation-off-migration-${Date.now()}`,
        type: 'INFO',
        title: `PIRÂMIDE: FILTRO DE ACUMULAÇÃO (ER) DESLIGADO`,
        description: `${[
          m.config ? 'A estratégia ativa' : '',
          m.strategies > 0 ? `${m.strategies} estratégia(s) salvas do Estúdio` : '',
        ]
          .filter(Boolean)
          .join(' e ')} tinham o Filtro de Acumulação ligado no valor padrão. O banco A/B (3 pregões sintéticos + real) mostrou que ele estava sobre-filtrando: silenciava scalps de pirâmide que fechavam alvo. Sem o filtro, a expectativa quase triplica e o rebaixamento cai. Você pode religar em Ajustes → Filtros de Regime.`,
        timestamp: Date.now(),
      });
    }, 2000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // AVISO DO LIMIAR ADAPTATIVO (P60) DESLIGADO: roda uma vez por versão de flag e só fala de quem
  // estava com o adaptativo ligado no Δ padrão. Quem calibrou o Δ por conta própria não é tocado.
  useEffect(() => {
    const m = adaptiveOffRef.current;
    if (!m || (!m.config && m.strategies === 0)) return;
    const timer = setTimeout(() => {
      setLatestToast({
        id: `adaptive-off-migration-${Date.now()}`,
        type: 'INFO',
        title: `PIRÂMIDE: LIMIAR ADAPTATIVO (P60) DESLIGADO`,
        description: `${[
          m.config ? 'A estratégia ativa' : '',
          m.strategies > 0 ? `${m.strategies} estratégia(s) salvas do Estúdio` : '',
        ]
          .filter(Boolean)
          .join(' e ')} tinham o limiar adaptativo ligado no valor padrão. Em testes ao vivo, o corte pelo P60 do pregão subia acima do Δ dos boxes e travava as entradas (o "SINAL FRACO"). No banco A/B (3 seeds), desligá-lo deu mais ordens, rebaixamento ~30% menor e expectativa igual ou melhor. Revertido quando quiser: Ajustes → Gatilho → "Limiar adaptativo".`,
        timestamp: Date.now(),
      });
    }, 2600);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // AVISO DO Δ FÍSICO DO FUNIL (150 → 100): roda uma vez por versão de flag e só fala de quem
  // estava com o Δ no padrão antigo. Quem calibrou o Δ por conta própria não é tocado.
  useEffect(() => {
    const m = delta100Ref.current;
    if (!m || (!m.config && m.strategies === 0)) return;
    const timer = setTimeout(() => {
      setLatestToast({
        id: `delta-100-migration-${Date.now()}`,
        type: 'INFO',
        title: `PIRÂMIDE: Δ MÍNIMO DO FUNIL BAIXOU PARA 100`,
        description: `${[
          m.config ? 'A estratégia ativa' : '',
          m.strategies > 0 ? `${m.strategies} estratégia(s) salvas do Estúdio` : '',
        ]
          .filter(Boolean)
          .join(' e ')} estavam com o Δ físico no padrão antigo (150). Com o limiar adaptativo desligado, o banco de 3 seeds mostrou que Δ 100 domina: mais ordens, maior fator de lucro e rebaixamento menor. Revertido quando quiser: Ajustes → Gatilho → "Delta mínimo".`,
        timestamp: Date.now(),
      });
    }, 3200);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // AVISO DO Δ FÍSICO DO FUNIL (100 → 50): roda uma vez por versão de flag e só fala de quem
  // estava com o Δ no padrão antigo (100). Quem calibrou por conta própria não é tocado.
  useEffect(() => {
    const m = delta50Ref.current;
    if (!m || (!m.config && m.strategies === 0)) return;
    const timer = setTimeout(() => {
      setLatestToast({
        id: `delta-50-migration-${Date.now()}`,
        type: 'INFO',
        title: `PIRÂMIDE: Δ MÍNIMO DO FUNIL BAIXOU PARA 50`,
        description: `${[
          m.config ? 'A estratégia ativa' : '',
          m.strategies > 0 ? `${m.strategies} estratégia(s) salvas do Estúdio` : '',
        ]
          .filter(Boolean)
          .join(' e ')} estavam com o Δ físico no padrão antigo (100). No banco A/B headless (10 réplicas × 10 dias), Δ 50 dominou Δ 100 em todos os eixos e em 10/10 réplicas: +23% PnL, fator 1,93→2,06 e rebaixamento ~28% menor. Abaixo de ~50 é platô. Calibrado em sintético (a base real chega M1_RATE). Revertido quando quiser: Ajustes → Gatilho → "Delta mínimo".`,
        timestamp: Date.now(),
      });
    }, 3800);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // AVISO DO FUNIL AUTO-CALIBRADO: roda uma vez por versão de flag e só fala de quem estava no
  // pacote padrão intocado (adaptativo OFF + Δ50 + sem divergência). Quem calibrou por conta própria não é tocado.
  useEffect(() => {
    const m = autoCalRef.current;
    if (!m || (!m.config && m.strategies === 0)) return;
    const timer = setTimeout(() => {
      setLatestToast({
        id: `auto-cal-migration-${Date.now()}`,
        type: 'INFO',
        title: 'PIRÂMIDE: FUNIL AGORA SE AUTO-CALIBRA PELO PREGÃO',
        description: `${[
          m.config ? 'A estratégia ativa' : '',
          m.strategies > 0 ? `${m.strategies} estratégia(s) salvas do Estúdio` : '',
        ]
          .filter(Boolean)
          .join(' e ')} estavam no pacote antigo. O corte de sinal deixou de ser um número físico fixo: agora é o MAIOR valor entre o percentil 60 das agressões do PRÓPRIO dia e 1,3× a média do dia, e só vale box cuja divergência de fluxo (|Δ| ÷ volume do tijolo) é ≥ 40% — régua relativa que sobrevive à mudança de volatilidade (eleição, pânico). Na base real WINZ26 (11 pregões): PF 2,43→3,94, rebaixamento R$ 759→318, o único braço com todos os pregões positivos. Δ 50 continua valendo só nos 10 primeiros boxes do dia (aquecimento). Reversível: Ajustes → Gatilho → desmarque "Limiar Auto-Calibrado" e leve "Divergência de Fluxo" a 0%.`,
        timestamp: Date.now(),
      });
    }, 4400);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);



  // AVISO DO FUNIL SEL-A (P70 · piso 1,6 · div 50%): roda uma vez por versão de flag e só fala de
  // quem estava no pacote Cycle 17 intocado (ON + Δ50 + div 0,4). Quem calibrou por conta própria não é tocado.
  useEffect(() => {
    const m = funnelSelARef.current;
    if (!m || (!m.config && m.strategies === 0)) return;
    const timer = setTimeout(() => {
      setLatestToast({
        id: `funnel-sela-migration-${Date.now()}`,
        type: 'INFO',
        title: 'PIRÂMIDE: FUNIL APERTADO PARA MELHORAR A PERFORMANCE',
        description: `${[
          m.config ? 'A estratégia ativa' : '',
          m.strategies > 0 ? `${m.strategies} estratégia(s) salvas do Estúdio` : '',
        ]
          .filter(Boolean)
          .join(' e ')} estavam no pacote auto-calibrado anterior. Como o EA vinha no breakeven, um A/B na base real WINZ26 (11 pregões, a mesma máquina do terminal) mostrou que as alavancas que sobem a qualidade por trade são PISO e DIVERGÊNCIA (o percentil é quase inerte). O funil foi ao braço SEL-A: corte no maior valor entre o P60→P70 das agressões do dia e o piso 1,3×→1,6× a média, exigindo divergência de fluxo 40%→50% do volume do tijolo. Resultado no bench: PF 3,71→4,17 e R$/trade 15,9→21,4, mantendo os 11 pregões positivos (menos sinais, cada um melhor). Ajustável a qualquer momento no painel abaixo do gráfico (Percentil / Piso / Divergência).`,
        timestamp: Date.now(),
      });
    }, 5200);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);



  // AVISO DA TROCA DO PREÇO DE REFERÊNCIA DO ATIVO: roda uma única vez por versão de flag e só

  // fala se havia ordem presa no preço antigo. Sai depois do aviso da trava de horário de propósito

  // (1,4s), porque a tela mostra um toast por vez — o que ficou por último é este.

  useEffect(() => {
    try {
      const raw = localStorage.getItem('fluxo_asset_last_price_v1');
      if (raw) {
        const parsed = JSON.parse(raw);
        let changed = false;
        for (const k of Object.keys(parsed)) {
          const sp = ASSETS[k as AssetId];
          if (sp && parsed[k]?.price) {
            const diff = Math.abs(parsed[k].price - sp.basePrice) / sp.basePrice;
            if (diff >= 0.4) {
              delete parsed[k];
              changed = true;
            }
          }
        }
        if (changed) {
          localStorage.setItem('fluxo_asset_last_price_v1', JSON.stringify(parsed));
        }
      }
    } catch {}
  }, []);

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



  // AVISO DA TROCA DE CONTRATO DO GRÁFICO (vigente em vez de série contínua). Vai por último na

  // fila (3s) porque a tela mostra um toast por vez, e só aparece na primeira abertura depois da regra.

  useEffect(() => {

    const m = chartContractRef.current;

    if (!m || (!m.config && m.strategies === 0)) return;

    const timer = setTimeout(() => {

      setLatestToast({

        id: `chart-contract-migration-${Date.now()}`,

        type: 'INFO',

        title: `GRÁFICO AGORA ABRE O CONTRATO VIGENTE: ${m.to || asset.activeContract || asset.primarySymbol}`,

        description: `${[

          m.config ? 'A estratégia ativa' : '',

          m.strategies > 0 ? `${m.strategies} estratégia(s) salvas do Estúdio` : '',

        ]

          .filter(Boolean)

          .join(' e ')} estava(m) na série contínua ${asset.primarySymbol} sem nenhum ajuste manual e passou(ram) para ${

          chartSymbolFor(asset)

        }, o papel do pregão de hoje na corretora. A contínua continua sendo o símbolo dos testes longos de histórico; um vencimento digitado à mão por você nunca seria reescrito.`,

        timestamp: Date.now(),

      });

    }, 3000);

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

  const handleResetData = (options?: {
    assetOverride?: AssetSpec;
    keepAudit?: boolean;
    boxPointsOverride?: number;
    rangePointsOverride?: number;
  }) => {
    const activeAsset = options?.assetOverride ?? asset;
    const newBoxPts = options?.boxPointsOverride ?? (options?.assetOverride ? nextBoxPointsFor(config.boxPoints, activeAsset).points : config.boxPoints);
    const newRangePts = options?.rangePointsOverride ?? (rangePoints || getAssetTradeParams(activeAsset.id).rangePoints || activeAsset.tradeDefaults.rangePoints);

    // A régua é o último preço REAL visto do ativo (se fresco) ou o basePrice do registro.
    const reference = referencePrice(activeAsset);
    const engine = engineRef.current;
    const sim = simulatorRef.current;

    if (options?.assetOverride) {
      engine.setAsset(activeAsset);
      sim.setAsset(activeAsset);
      ALT_RENKO_SCALES.forEach((alt) => altEnginesRef.current[alt.key].setAsset(activeAsset));
      shadowRobotService.resetBook();
      seriesCollectorService.reset();
    }

    sim.setPrice(reference);
    engine.setBoxPoints(newBoxPts);
    engine.initialize(reference);
    sessionStartRef.current = Date.now(); // PnL da sessão volta ao zero junto com o reinício

    setTicks([]);
    setBoxes([]);
    setSessionGaps([]);
    setCurrentBox(null);
    setCurrentPrice(reference);
    setCvd(0);
    setOrders([]);
    if (!options?.keepAudit) OrderAuditService.clearIntradayAudit(activeAsset.id);

    // Zera também as séries experimentais (Range e Tempo)
    allTicksRef.current = [];
    setRangePoints(newRangePts);
    rangeEngineRef.current.setRangePoints(newRangePts);
    rangeEngineRef.current.initialize(reference);
    timeEngineRef.current.initialize(reference);
    ALT_RENKO_SCALES.forEach((alt) => altEnginesRef.current[alt.key].initialize(reference));

    // Motor do Robô 2 na mesma régua e no ativo novo (a escala dele é derivada do tick atual)
    if (shadowRobotService.getEffectiveConfig()) {
      const sEng = ensureShadowEngine();
      if (sEng) {
        sEng.setAsset(activeAsset);
        sEng.initialize(reference);
      }
    }

    setRangeBoxes([]);
    setRangeCurrentBox(null);
    setTimeBoxes([]);
    setTimeCurrentBox(null);
  };

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

    // 1. Salva o snapshot completo do ativo que estava na tela
    const currentState = assetStateRef.current[asset.id];
    if (currentState) {
      currentState.boxes = [...engineRef.current.getBoxes()];
      currentState.currentBox = engineRef.current.getCurrentBox();
      currentState.cvd = engineRef.current.getCvd();
      currentState.sessionGaps = [...engineRef.current.getSessionGaps()];
      currentState.rangeBoxes = [...rangeEngineRef.current.getBoxes()];
      currentState.rangeCurrentBox = rangeEngineRef.current.getCurrentBox();
      currentState.currentPrice = currentPrice;
      currentState.ticks = [...ticks];
      currentState.allTicks = [...allTicksRef.current];
    }
    OrderAuditService.saveIntradayOrders(orders, asset.id);

    // Limpeza de robôs em memória contra contaminação cruzada entre ativos (WIN vs WDO)
    shadowRobotService.resetBook();
    seriesCollectorService.reset();
    sessionStartRef.current = Date.now();

    const live = orders.filter((o) => o.status === 'OPEN' || o.status === 'PENDING_LIMIT');
    if (live.length > 0) {
      setLatestToast({
        id: `asset-switch-info-${Date.now()}`,
        type: 'INFO',
        title: `📊 VISUALIZANDO ABA ${next.label}`,
        description: `${live.length} posição(ões) em ${asset.label} continuam salvas e ativas em segundo plano no MT5.`,
        timestamp: Date.now(),
      });
    }



    const assetParams = getAssetTradeParams(id);
    const unconfirmed = next.status === 'a_confirmar';

    // TROCAR DE ATIVO NÃO TROCA A ESTRATÉGIA.
    // Antes, este trecho sobrescrevia stop, alvo, parcial, breakeven, trailing, delta e contratos
    // com os `tradeDefaults` do REGISTRO do ativo. Efeito real: o operador escolhia o preset
    // C/V DÓLAR (stop 0, alvo 0, box 2,5) e, ao clicar na aba do dólar, tudo era derrubado pelos
    // números de fábrica do ativo — a C/V voltava a ter stop e alvo sem ninguém pedir.
    //
    // Nova regra: do ativo vem só o que é DELE (box, range, símbolo). Os campos de gestão ficam
    // com a estratégia ativa — que é a fonte única, conforme a padronização de 07/11.
    const assetOwned = {
      boxPoints: assetParams.boxPoints,
      minDeltaThreshold: assetParams.minDeltaThreshold,
    };
    const updated: AutomationConfig = {
      ...config,
      assetId: id,
      // Gráfico no vigente do ativo novo (sem vencimento confirmado, cai na contínua do registro).
      symbol: chartSymbolFor(next),
      ...assetOwned,
      // Ensaio de spec não homologado nunca acorda o Robô (decisão 2 do plano).
      active: unconfirmed ? false : config.active,
      lastSavedTimestamp: Date.now(),
    };

    activeAssetIdRef.current = id;
    EaConfigService.saveConfig(updated);
    setConfig(updated);

    // Motores e eixos no preço de referência do ativo novo; o livro é o DELE (persistido à parte).
    const nextRangePts = assetParams.rangePoints || next.tradeDefaults.rangePoints;
    const targetState = assetStateRef.current[id];

    const isPriceSane = (p?: number) =>
      Number.isFinite(p) && (p || 0) > 0 && Math.abs((p || 0) - next.basePrice) / next.basePrice < 0.4;
    const isBoxSane = (b: RenkoBox) =>
      isPriceSane(b.close) && isPriceSane(b.open) && (!b.high || isPriceSane(b.high)) && (!b.low || isPriceSane(b.low));

    if (targetState) {
      targetState.boxes = targetState.boxes.filter(isBoxSane);
      targetState.allTicks = targetState.allTicks.filter((t) => isPriceSane(t.price));
      targetState.ticks = targetState.ticks.filter((t) => isPriceSane(t.price));
      if (targetState.currentBox && !isPriceSane(targetState.currentBox.open)) {
        targetState.currentBox = null;
      }
      if (!isPriceSane(targetState.currentPrice)) {
        targetState.currentPrice = targetState.boxes.length > 0
          ? targetState.boxes[targetState.boxes.length - 1].close
          : (targetState.allTicks.length > 0 ? targetState.allTicks[targetState.allTicks.length - 1].price : referencePrice(next));
      }
      targetState.engine.setAsset(next);
      targetState.engine.setBoxPoints(assetParams.boxPoints);
      engineRef.current = targetState.engine;
      rangeEngineRef.current = targetState.rangeEngine;
      timeEngineRef.current = targetState.timeEngine;
      allTicksRef.current = targetState.allTicks;
    }

    pendingUiUpdateRef.current.latestPrice = targetState ? targetState.currentPrice : referencePrice(next);
    pendingUiUpdateRef.current.pendingTicks = [];
    pendingUiUpdateRef.current.boxesChanged = false;
    pendingUiUpdateRef.current.rangeBoxesChanged = false;
    pendingUiUpdateRef.current.timeBoxesChanged = false;

    const hasSaneBoxes = Boolean(targetState && targetState.boxes.length > 0 && isPriceSane(targetState.boxes[0].open));

    if (hasSaneBoxes && targetState) {
      setBoxes([...targetState.boxes]);
      setSessionGaps([...targetState.sessionGaps]);
      setCurrentBox(targetState.currentBox);
      setCvd(targetState.cvd);
      setTicks([...targetState.ticks]);
      setRangeBoxes([...targetState.rangeBoxes]);
      setRangeCurrentBox(targetState.rangeCurrentBox);
      const safeP = isPriceSane(targetState.currentPrice) ? targetState.currentPrice : referencePrice(next);
      setCurrentPrice(safeP);
    } else if (targetState && targetState.allTicks.length > 0 && isPriceSane(targetState.allTicks[0].price)) {
      targetState.engine.setAsset(next);
      targetState.engine.setBoxPoints(assetParams.boxPoints);
      targetState.engine.initialize(targetState.allTicks[0].price, targetState.allTicks[0].timestamp);
      for (const t of targetState.allTicks) {
        targetState.engine.processTick(t, updated);
      }
      targetState.boxes = [...targetState.engine.getBoxes()];
      targetState.currentBox = targetState.engine.getCurrentBox();
      targetState.cvd = targetState.engine.getCvd();
      setBoxes([...targetState.boxes]);
      setCurrentBox(targetState.currentBox);
      setCvd(targetState.cvd);
      const lastP = targetState.allTicks[targetState.allTicks.length - 1].price;
      targetState.currentPrice = lastP;
      setCurrentPrice(lastP);
    } else {
      if (targetState) {
        targetState.engine.setAsset(next);
        targetState.engine.setBoxPoints(assetParams.boxPoints);
        targetState.engine.initialize(referencePrice(next));
        targetState.rangeEngine.setRangePoints(nextRangePts);
        targetState.rangeEngine.initialize(referencePrice(next));
        targetState.timeEngine.initialize(referencePrice(next));
        targetState.boxes = [];
        targetState.currentBox = null;
        targetState.allTicks = [];
        targetState.ticks = [];
        targetState.currentPrice = referencePrice(next);
      }
      setBoxes([]);
      setSessionGaps([]);
      setCurrentBox(null);
      setCurrentPrice(referencePrice(next));
      setCvd(0);
      setTicks([]);
      allTicksRef.current = [];
      setRangeBoxes([]);
      setRangeCurrentBox(null);
    }

    const nextSaved = OrderAuditService.loadIntradayOrders(next) ?? [];
    const filteredNext = mt5State.status === 'CONNECTED'
      ? nextSaved
      : nextSaved.filter((o) => o.status !== 'OPEN' && o.status !== 'PENDING_LIMIT');
    setOrders(filteredNext);

    if (config.strategyId) {
      StrategyLibraryService.updateStrategyConfig(config.strategyId, {
        assetId: id,
        symbol: chartSymbolFor(next),
        boxPoints: assetParams.boxPoints,
      });
    }

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      setBfDiag(`ATIVO SELECIONADO → ${chartSymbolFor(next)} · box de ${assetParams.boxPoints} pts`);
      wsRef.current.send(JSON.stringify({
        action: 'SELECT_ASSET',
        assetId: id,
        symbol: chartSymbolFor(next),
        boxPoints: assetParams.boxPoints,
      }));
      // O backfill é por contrato: ao trocar de ativo, o gráfico novo precisa do próprio pregão
      // (o Dólar não recebia nada porque o pedido saía com o símbolo do ativo anterior).
      wsRef.current.send(JSON.stringify({ action: 'GET_BACKFILL', symbol: chartSymbolFor(next), days: 5, boxPoints: (next.id === 'WDO' ? getAssetTradeParams('WDO').boxPoints : (next.id === 'WIN' ? getAssetTradeParams('WIN').boxPoints : config.boxPoints)) }));
      wsRef.current.send(JSON.stringify({ action: 'LIST_LOCAL_PREGOES', symbol: chartSymbolFor(next) }));
    }



    const sessionNote =

      updated.tradingStartTime === next.session.open && updated.tradingStopEntriesTime === next.session.close

        ? ''

        : ` A trava de horário continua em ${updated.tradingStartTime}–${updated.tradingStopEntriesTime}, e o pregão de ${next.label} é ${next.session.open}–${next.session.close} (ajustar por ativo vem na Fase 3).`;



    setLatestToast({

      id: `asset-switch-${Date.now()}`,

      type: 'INFO',

      title: unconfirmed ? `🧪 ENSAIO: ${next.label} (SPEC NÃO HOMOLOGADO)` : `ATIVO: ${next.label}`,

      description: `${next.contractNote}. Preço de referência ${formatPrice(referencePrice(next), next)} pts · escala ${formatPrice(assetParams.boxPoints, next)} pts (${renkoScaleLabel(assetParams.boxPoints, next)}).${unconfirmed ? ' Robô deixado OFF e ponte em seguro até você homologar R$/ponto, tick e casas decimais.' : ''}${sessionNote} Conectado ao MT5, baixe o script de novo: ele grava o símbolo na hora de subir a ponte.`,

      timestamp: Date.now(),

    });

  };



  // Estatísticas calculadas — contam SÓ o que foi fechado nesta abertura da página

  // (o livro de ordens continua persistido para a auditoria, mas o PnL do canto

  // direito zera a cada reinício para não confundir com resultados de sessões passadas)

  const sessionStartRef = React.useRef<number>(Date.now());

  const stats: TerminalStats = React.useMemo(() => {

    const isReplayOrPaperStats = isReplaying || isSimulating || orders.some((o) => !o.isRealMT5 && isOrderForAsset(o, asset));

    const closed = orders.filter(

      (o) => o.status !== 'OPEN' && o.status !== 'PENDING_LIMIT' && isOrderForAsset(o, asset) && (isReplayOrPaperStats || (o.exitTimestamp ?? 0) >= sessionStartRef.current)

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



  // Livro do hedge para a boleta (a fonte única é o App — dono das ordens): contratos e preço

  // médio por lado, flutuante de cada lado, realizado da sessão (ganhos/perdas) e PnL do dia.

  // Migração dos chips que viviam nas linhas de menu; os pontos flutuantes seguem a mesma

  // convenção do antigo chip do gráfico (soma dos pontos por ordem, sem ponderar contratos).

  const hedgeBook: HedgeBook = React.useMemo(() => {
    // Posições abertas no hedge só existem enquanto estiver conectado ao MT5 ou rodando replay/simulador
    const canHaveLivePositions = mt5State.status === 'CONNECTED' || isReplaying || isSimulating;

    const sideBook = (type: 'BUY' | 'SELL'): HedgeSideBook => {
      const filled = canHaveLivePositions ? orders.filter((o) => o.status === 'OPEN' && o.type === type && isOrderForAsset(o, asset)) : [];
      const pending = canHaveLivePositions ? orders.filter((o) => o.status === 'PENDING_LIMIT' && o.type === type && isOrderForAsset(o, asset)).length : 0;
      let ctros = 0;
      let avgNum = 0;
      let livePts = 0;
      let liveBRL = 0;
      let partialBRL = 0;

      filled.forEach((o) => {
        const rc = o.remainingContracts ?? o.contracts ?? 1;
        const safeEntry = isPriceSaneForAsset(o.entryPrice, asset) ? Number(o.entryPrice) : (isPriceSaneForAsset(currentPrice, asset) ? currentPrice : asset.basePrice);
        const safeCurPrice = isPriceSaneForAsset(currentPrice, asset) ? currentPrice : safeEntry;
        ctros += rc;
        avgNum += safeEntry * rc;
        const pts = type === 'BUY' ? safeCurPrice - safeEntry : safeEntry - safeCurPrice;
        const validPts = Number.isFinite(pts) ? pts : 0;
        livePts += validPts;
        const brlVal = pointsToBRL(validPts, rc, asset);
        liveBRL += Number.isFinite(brlVal) ? brlVal : 0;
        partialBRL += Number.isFinite(o.partialFinancial) ? (o.partialFinancial || 0) : 0;
      });

      return {
        orders: filled.length + pending,
        filled: filled.length,
        pending,
        contracts: ctros,
        avgEntry: ctros > 0 ? avgNum / ctros : 0,
        livePts: Number.isFinite(livePts) ? livePts : 0,
        liveBRL: Number.isFinite(liveBRL) ? liveBRL : 0,
        partialBRL: Number.isFinite(partialBRL) ? partialBRL : 0,
      };
    };

    // Ordens fechadas da sessão: DEVEM PERMANECER VISÍVEIS após o encerramento do replay
    // (para permitir a análise e auditoria na boleta), sendo zeradas apenas ao iniciar
    // um novo replay ou com o retorno do mercado real (MT5 conectado).
    const isReplayOrPaper = isReplaying || isSimulating || orders.some((o) => !o.isRealMT5 && isOrderForAsset(o, asset));

    const closed = orders.filter(
      (o) => o.status !== 'OPEN' && o.status !== 'PENDING_LIMIT' && isOrderForAsset(o, asset) && (isReplayOrPaper || (o.exitTimestamp ?? 0) >= sessionStartRef.current)
    );

    const localRealizedProfit = closed.reduce((a, o) => a + Math.max(0, o.financialResult || 0), 0);
    const localRealizedLoss = closed.reduce((a, o) => a + Math.min(0, o.financialResult || 0), 0);
    const buy = sideBook('BUY');
    const sell = sideBook('SELL');

    const traded = orders.filter((o) => o.status !== 'PENDING_LIMIT' && isOrderForAsset(o, asset) && (isReplayOrPaper || o.timestamp >= sessionStartRef.current));

    const localBuyContractsToday = traded.filter((o) => o.type === 'BUY').reduce((a, o) => a + (o.contracts || 1), 0);
    const localSellContractsToday = traded.filter((o) => o.type === 'SELL').reduce((a, o) => a + (o.contracts || 1), 0);

    // Quando conectado ao MetaTrader 5 SEM estar em replay:
    // os contratos e o resultado são buscados do MT5. Se houver estatísticas por ativo, usamos do ativo corrente.
    // Se a tela contém ordens de uma sessão de replay/estudo, preserva os números locais até nova limpeza ou início real.
    const hasReplayOrders = (isReplaying || isSimulating) && orders.length > 0 && orders.some((o) => !o.isRealMT5 && isOrderForAsset(o, asset));
    const isRealMT5 = mt5State.status === 'CONNECTED' && !isReplaying && !isSimulating && !hasReplayOrders;
    const statsBySym = (mt5State as any).dayStatsBySymbol;
    const isBitAsset = asset.id.includes('BTC') || asset.id.includes('BIT') || asset.prefixes.includes('BIT');
    const assetPrefix = isBitAsset ? 'BIT' : (asset.id || 'WIN').substring(0, 3).toUpperCase();
    const symStats = statsBySym
      ? (statsBySym[assetPrefix] || (isBitAsset ? (statsBySym['BIT'] || statsBySym['BTCBR'] || statsBySym['BTC']) : undefined) || statsBySym[asset.id] || statsBySym[asset.primarySymbol])
      : undefined;
    const fallbackAssetStats = {
      buyContractsToday: 0,
      sellContractsToday: 0,
      totalContractsToday: 0,
      realizedProfit: 0,
      realizedLoss: 0,
      netRealized: 0,
      dealsCount: 0,
    };
    const mt5Stats = isRealMT5 ? (symStats || fallbackAssetStats) : undefined;

    const buyContractsToday = mt5Stats ? mt5Stats.buyContractsToday : localBuyContractsToday;
    const sellContractsToday = mt5Stats ? mt5Stats.sellContractsToday : localSellContractsToday;
    const contractsTodayTotal = mt5Stats ? mt5Stats.totalContractsToday : (buyContractsToday + sellContractsToday);
    const realizedProfit = mt5Stats ? mt5Stats.realizedProfit : localRealizedProfit;
    const realizedLoss = mt5Stats ? mt5Stats.realizedLoss : localRealizedLoss;

    const floatingTotal = (buy.liveBRL + buy.partialBRL + sell.liveBRL + sell.partialBRL);
    const rawNetRealized = mt5Stats ? Number(mt5Stats.netRealized) : (Number(realizedProfit) + Number(realizedLoss));
    const dayPnl = (Number.isFinite(rawNetRealized) ? rawNetRealized : 0) + (Number.isFinite(floatingTotal) ? floatingTotal : 0);

    return {
      buy,
      sell,
      realizedProfit: Number.isFinite(realizedProfit) ? Number(realizedProfit) : 0,
      realizedLoss: Number.isFinite(realizedLoss) ? Number(realizedLoss) : 0,
      dayPnl: Number.isFinite(dayPnl) ? Number(dayPnl) : 0,
      buyContractsToday: Number(buyContractsToday) || 0,
      sellContractsToday: Number(sellContractsToday) || 0,
      contractsTodayTotal: Number(contractsTodayTotal) || 0,
    };
  }, [orders, currentPrice, asset, mt5State.status, mt5State.dayStats, (mt5State as any).dayStatsBySymbol, mt5State.floatingProfit, isReplaying, isSimulating]);



  /**

   * Envio de ENTRADA à ponte, idempotente por tick: o updater de setOrders pode ser

   * reinvocado pelo React para o mesmo tick, e cada tick só pode gerar uma ordem real.

   * Saídas (CLOSE_POSITIONS) nunca passam por aqui — zerar sempre é permitido.

   */

  const bridgeEntrySentRef = useRef<number>(0);

  const sendEntryToBridgeOnce = (tickTimestamp: number, payload: Record<string, unknown>) => {
    if (isReplaying) return; // NUNCA envia ordem real durante o replay!

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
    // Trava de realidade: sem MT5 conectado, sem replay ativo e sem simulação rodando,
    // não existe posição aberta no mercado. Retorna lista vazia imediatamente.
    if (mt5State.status !== 'CONNECTED' && !isReplaying && !isSimulating) {
      return [];
    }
    const seenTickets = new Set<number>();
    const list = orders.filter((o) => {
      if (o.status !== 'OPEN' && o.status !== 'PENDING_LIMIT') return false;
      if (!isOrderForAsset(o, asset)) return false;
      if (o.ticket) {
        if (seenTickets.has(o.ticket)) return false;
        seenTickets.add(o.ticket);
      }
      return true;
    });
    // Ordenação estável e determinística para evitar pulo/piscar de tags no canvas
    return list.sort((a, b) => {
      if (a.ticket && b.ticket) return a.ticket - b.ticket;
      return a.timestamp - b.timestamp;
    });
  }, [orders, asset, mt5State.status, isReplaying, isSimulating]);



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



  // Auto-dismiss toast: 2,4s. O aviso dura o suficiente para registrar o disparo e sai antes

  // de virar propaganda na frente do gráfico.

  useEffect(() => {

    if (!latestToast) return;

    const t = setTimeout(() => {

      setLatestToast(null);

    }, 2400);

    return () => clearTimeout(t);

  }, [latestToast]);



  // Ao sair da aba Gráfico, descarta o aviso de ordem ainda pendente: ele só vive na tela do

  // gráfico, e não pode pipocar atrasado quando o operador voltar para a aba.

  useEffect(() => {

    if (activeTab !== 'chart') {

      setLatestToast((t) => (t && t.chartOnly ? null : t));

    }

  }, [activeTab]);



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

    // Robô ativo sem feed = robô olhando tela congelada. O balão agora nomeia esse estado

    // (acontece quando o operador pausa o ▶ SIM com o Robô ligado — o On religa sozinho).

    if (config.active && !isSimulating && !isReplaying) {

      gateReasons.push('MERCADO PARADO: o Robô está ligado, mas sem ticks nada anda — aperte ▶ SIM no topo.');

    }

    // Laudo do sinal (Ciclo 12): Robô ligado + feed andando + dentro da janela, e AINDA ASSIM

    // nenhuma ordem sai? Na prática quase sempre é o DELTA do último box não passando do limiar

    // (fixo ou adaptativo) — ou a série ativa, que é Tempo e o Robô não opera Tempo. O balão

    // mostra os números da última barra fechada em vez de deixar o operador no escuro.

    if (

      config.active &&

      (isSimulating || isReplaying) &&

      !finLockNow &&

      !isSessionCloseLock(marketClockTs, config.tradingCloseAllTime) &&

      isWithinTradingWindow(marketClockTs, config)

    ) {

      if (chartSeries === 'tempo') {

        gateReasons.push('SÉRIE SEM ROBÔ: o gráfico está em Tempo, e as entradas disparam só nas séries Renko ou Range — troque no seletor acima do gráfico.');

      } else {

        const activeEng = chartSeries === 'renko' ? engineRef.current : rangeEngineRef.current;

        const bs = activeEng.getBoxes();

        const lastClosed = bs[bs.length - 2]; // o último elemento é o box EM FORMAÇÃO

        // Só dá o laudo quando o Robô está PASSANDO FOME: nenhum dos últimos 6 boxes fechados

        // sinalizou. Um box fraco isolado não liga o alerta (era isso que fazia o triângulo

        // piscar a cada tijolo).

        const recentClosed = bs.slice(Math.max(0, bs.length - 7), Math.max(0, bs.length - 1));

        const starving = recentClosed.length >= 5 && recentClosed.every((b) => !b.isConvergence);

        if (starving && lastClosed && lastClosed.direction) {

          const adaptive = config.adaptiveThresholdEnabled === true;

          const side: 'BUY' | 'SELL' = lastClosed.direction === 'UP' ? 'BUY' : 'SELL';

          const limit = adaptive

            ? activeEng.getRegimeMeter().getSelfCalibratedLimit(side, config.adaptiveThresholdPercentile ?? 0.6, config.adaptiveFloorMultiple ?? 1.3, config.minDeltaThreshold)

            : config.minDeltaThreshold;

          const weak = lastClosed.direction === 'UP' ? lastClosed.delta < limit : lastClosed.delta > -limit;

          if (weak) {

            gateReasons.push(

              `SINAL FRACO HÁ ${recentClosed.length} BOXES: último ${lastClosed.direction === 'UP' ? 'verde' : 'vermelho'} fechou com Δ ${lastClosed.delta} ctros e o limiar é ${

                adaptive ? `auto-calibrado do próprio pregão (percentil + piso da média do dia): ${limit} ctros` : `físico: ${limit} ctros`

              } — o Robô só entra com agressão acima do limiar. Baixe o Δ mínimo em Ajustes ou desligue o filtro adaptativo.`

            );

          } else if (config.requireCvdNewExtreme) {

            // A regra do CVD novo extremo agora vale nos dois modos: Pirâmide e Reteste.

            gateReasons.push('ESPERANDO CVD: os boxes passam no Δ calculado, mas a estratégia também exige o CVD fazendo máxima/mínima dos 3 boxes anteriores — é a confluência pedida, não um defeito.');

          }

        }

      }

    }

    // "Por que minha estratégia não dispara?" também mora no LIVRO: o caminho do Reteste em

    // modo NETTING só abre posição com o livro vazio, e o HEDGE tem teto de simultâneas — os

    // dois bloqueavam em silêncio absoluto. O balão do alerta agora diz o motivo e o que fazer.

    if (config.active) {

      const openNow = orders.filter((o) => o.status === 'OPEN').length;

      if (

        config.strategyMode !== 'PYRAMID_FLOW_CONFLUENCE' &&

        config.accountMode === 'NETTING' &&

        openNow > 0

      ) {

        gateReasons.push(`Modo NETTING: o Robô Reteste só abre posição com o livro vazio — zere a(s) ${openNow} aberta(s) no ZERAR da boleta.`);

      } else if (config.accountMode === 'HEDGE' && openNow >= config.maxSimultaneousPositions) {

        gateReasons.push(`Teto de posições simultâneas batido (${openNow}/${config.maxSimultaneousPositions}): o Robô não abre entrada nova — zere na boleta para liberar.`);

      }

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



  // =========================================================================
  // FAIXA DO FUNIL: retrato vivo do limiar auto-calibrado (percentil da janela x
  // piso relativo à média do dia) para o operador avaliar em tela. Só para Renko e
  // Range (as séries com robô); na série Tempo não entregamos métrica e a faixa some.
  // O corte exibido vem do MESMO medidor que julga o sinal, então a tela nunca mente.
  // =========================================================================
  const funnelMetrics = React.useMemo(() => {
    if (chartSeries !== 'renko' && chartSeries !== 'range') return undefined;
    const eng = chartSeries === 'renko' ? engineRef.current : rangeEngineRef.current;
    const bx = chartSeries === 'renko' ? boxes : rangeBoxes;
    return computeFunnelMetrics(config, eng.getRegimeMeter(), bx);
    // boxes/rangeBoxes mudam de identidade a cada tick; config, a cada patch — o retrato reflete.
  }, [chartSeries, config, boxes, rangeBoxes]);

  // Chip do Robô 2 na 3ª linha: texto neutro + número colorido (a regra de cor da plataforma).

  const shadowRun = shadowSnap.run;

  const shadowChipSummary = shadowRun.enabled

    ? `Sombra ${shadowRun.scaleR}R${shadowRun.strategyName ? ` · "${shadowRun.strategyName}"` : ''}`

    : '+ Sombra';

  const shadowChipDetail = shadowRun.enabled

    ? [

        `Robô 2 (sombra) · ${shadowRun.scaleR}R = ${shadowRun.boxPoints} pts · ${shadowRun.assetId}`,

        shadowRun.strategyName ? `Estratégia: "${shadowRun.strategyName}"` : 'Sem estratégia',

        `Trades ${shadowSnap.stats.trades} · ${shadowSnap.stats.wins}W/${shadowSnap.stats.losses}L · win rate ${shadowSnap.stats.winRate.toFixed(1)}%`,

        `Rebaixamento máx. R$ ${shadowSnap.stats.maxDrawdown.toFixed(2)}`,

        shadowRun.warning || 'Clique para abrir o livro e os controles',

      ].join('\n')

    : 'Robô 2 (sombra) desligado — clique para abrir e escolher a estratégia';

  const strategySelectorNode = (
    <div
      className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-slate-900 border border-slate-700/80 text-[11px] shrink-0 shadow-sm"
      title="Selecione uma estratégia oficial ou criada no Estúdio (o Robô é pausado por segurança). Para programar ou editar, clique no ícone do Estúdio ao lado."
    >
      <span className="hidden sm:inline text-amber-400 font-semibold">Trocar:</span>
      <select
        value={currentStratSelectValue}
        onChange={(e) => {
          const val = e.target.value;
          if (!val || val === '__CUSTOM__') return;

          if (val.startsWith('preset:')) {
            const pid = val.replace('preset:', '');
            const p = builtInPresets.find((x) => x.id === pid);
            if (p) {
              handleApplyConfigBundle(p.config, p.name);
              setLatestToast({
                id: `preset-applied-${Date.now()}`,
                type: 'BUY',
                title: 'PRESET OFICIAL APLICADO',
                description: `Estratégia "${p.name}" ativada no terminal (Robô pausado por segurança).`,
                timestamp: Date.now(),
              });
            }
          } else if (val.startsWith('strat:')) {
            const sid = val.replace('strat:', '');
            const list = StrategyLibraryService.list();
            setStrategyLibrary(list);
            const s = list.find((x) => x.id === sid);
            if (s) {
              handleActivateStrategy(s);
              setLatestToast({
                id: `strat-applied-${Date.now()}`,
                type: 'BUY',
                title: 'ESTRATÉGIA DO ESTÚDIO ATIVADA',
                description: `Estratégia "${s.name}" aplicada no terminal (Robô pausado por segurança).`,
                timestamp: Date.now(),
              });
            }
          }
        }}
        className="bg-transparent font-mono text-slate-100 font-medium focus:outline-none cursor-pointer max-w-[170px] sm:max-w-[240px] truncate"
      >
        {currentStratSelectValue === '__CUSTOM__' && (
          <option value="__CUSTOM__" className="bg-slate-900 text-amber-300 font-semibold">
            ★ {activeStrategyName || 'Configuração Atual (Manual)'}
          </option>
        )}
        <optgroup label="── 🏛️ PRESETS OFICIAIS B3 ──" className="bg-slate-950 font-bold text-emerald-400">
          {builtInPresets.map((p) => (
            <option key={p.id} value={`preset:${p.id}`} className="bg-slate-900 text-slate-100 font-normal">
              {p.name}
            </option>
          ))}
        </optgroup>
        <optgroup label="── 🎨 MINHAS ESTRATÉGIAS (ESTÚDIO) ──" className="bg-slate-950 font-bold text-sky-400">
          {strategyLibrary.length === 0 ? (
            <option value="" disabled className="bg-slate-900 text-slate-500 italic">
              (Nenhuma personalizada — use o Estúdio)
            </option>
          ) : (
            strategyLibrary.map((s) => (
              <option key={s.id} value={`strat:${s.id}`} className="bg-slate-900 text-slate-100 font-normal">
                {s.name}
              </option>
            ))
          )}
        </optgroup>
      </select>

      <button
        onClick={() => setActiveTab('studio')}
        className="text-amber-400/80 hover:text-amber-300 transition-colors cursor-pointer p-0.5"
        title="Abrir o Estúdio de Estratégias (programar, salvar, importar/exportar)"
      >
        <Sparkles className="w-3.5 h-3.5" />
      </button>

      <span
        className={`w-1.5 h-1.5 rounded-full ${config.active ? 'bg-emerald-400 animate-pulse' : 'bg-slate-600'}`}
        title={config.active ? 'Robô ligado' : 'Robô pausado'}
      />
    </div>
  );

  const sessionTotalFinancialVolume = useMemo(() => {
    const pv = asset.pointValue || 0.2;
    const ticksArr = allTicksRef.current.length > 0 ? allTicksRef.current : ticks;
    let sum = 0;
    for (let i = 0; i < ticksArr.length; i++) {
      sum += (ticksArr[i].price || 0) * pv * (ticksArr[i].volume || 0);
    }
    return sum;
  }, [ticks, asset]);

  return (

    <div className="flex flex-col h-[100dvh] w-screen bg-[#0a0a0a] text-slate-100 overflow-hidden font-sans">

      {/* Top Bar seguindo o contrato de 3 zonas */}

      <Header

        activeTab={activeTab}

        setActiveTab={setActiveTab}

        totalFinancialVolume={sessionTotalFinancialVolume}

        isSimulating={isSimulating}

        setIsSimulating={setIsSimulating}

        robotActive={config.active}

        setRobotActive={(active) => {

          setConfig((prev) => {

            const updated = { ...prev, active, lastSavedTimestamp: Date.now() };

            EaConfigService.saveConfig(updated);

            return updated;

          });

          setReplayOperates(active);

          if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            try {
              wsRef.current.send(JSON.stringify({ action: active ? 'ARM' : 'DISARM' }));
            } catch {}
          }

          try {
            saasChannelRef.current?.postMessage({
              type: 'ROBOT_ARMED_SYNC',
              armed: active
            });
          } catch {}

          // Ligar o Robô é um comando manual do operador — e sem ticks ele ficaria "ativo"

          // olhando tela congelada (a regra de boot parado abriu esse buraco): em simulação,

          // On também põe o mercado para andar no ▶ SIM. Desligar o Robô NÃO pausa o feed —

          // quem quiser tela viva sem estratégia é só deixar o Robô Off.

          if (active && mt5State.status !== 'CONNECTED' && !isReplaying) setIsSimulating(true);

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

        liveSymbol={assetSyms.live}

        activeStrategyName={activeStrategyName}

        activeStrategyId={config.strategyId ?? null}

        activeStrategyLive={!!config.strategyId && !!activeStrategy}

        onOpenStudio={() => setActiveTab('studio')}

      />



      {/* Tira de Métricas e Status Rápido — a esquerda rola sozinha e o PnL fica SEMPRE à vista

          (antes, com o replay na linha, o conteúdo estourava a largura e o PnL sumia da tela) */}

      <div className="flex items-center gap-2.5 px-3 sm:px-4 md:px-5 py-1 bg-slate-950 border-b border-slate-900 text-[11px] sm:text-xs shrink-0 font-mono">

        <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1 overflow-x-auto no-scrollbar">

          {/* Botão compacto OPERA: ícone + bolinha pulsante + texto 'Opera' */}
          <button
            onClick={() => {
              const nextVal = !replayOperates;
              setReplayOperates(nextVal);
              setConfig((prev) => {
                const updated = { ...prev, active: nextVal, lastSavedTimestamp: Date.now() };
                EaConfigService.saveConfig(updated);
                return updated;
              });
              if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
                try {
                  wsRef.current.send(JSON.stringify({ action: nextVal ? 'ARM' : 'DISARM' }));
                } catch {}
              }
              try {
                saasChannelRef.current?.postMessage({
                  type: 'ROBOT_ARMED_SYNC',
                  armed: nextVal
                });
              } catch {}
            }}
            className={`flex items-center gap-1.5 h-6 px-2 rounded border transition-all cursor-pointer select-none text-[11px] font-semibold ${
              replayOperates
                ? 'bg-emerald-950/50 border-emerald-500/50 text-emerald-300 hover:border-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.2)]'
                : 'bg-slate-900 border-slate-800 text-zinc-500 hover:text-zinc-300'
            }`}
            title={replayOperates ? 'Robô Opera: LIGADO (paper trading ativo)' : 'Robô Opera: DESLIGADO (modo silencioso)'}
          >
            <Zap className={`w-3.5 h-3.5 ${replayOperates ? 'text-emerald-400 fill-emerald-400' : 'text-zinc-600'}`} />
            <span className={`w-2 h-2 rounded-full ${replayOperates ? 'bg-emerald-400 shadow-[0_0_8px_#34d399] animate-pulse' : 'bg-zinc-600'}`} />
            <span>Opera</span>
          </button>

          {/* Janela de Seleção do Pregão com chip compacto (mostra só o código Flow1, 2, 3) */}
          <div className="flex items-center gap-1.5 ml-3 pl-3 border-l border-slate-800">
            <span className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">Pregão:</span>
            <div className="relative inline-flex items-center" title="Escolha o pregão gravado da base ou período acumulado para o replay">
              {/* Botão visual compacto: mostra APENAS o código (1/3 da largura anterior!) */}
              <div className="h-6 px-2 rounded bg-slate-900 border border-slate-800 text-slate-200 text-[11px] font-mono font-bold flex items-center gap-1 cursor-pointer hover:bg-slate-800 transition-colors pointer-events-none">
                <span className="text-emerald-400">{getPregaoCompactCode(selectedPregaoValue)}</span>
                <ChevronDown className="w-3 h-3 text-slate-500" />
              </div>
              {/* Select nativo invisível por cima para disparar o menu nativo completo com datas e MB */}
              <select
                value={selectedPregaoValue}
                onChange={(e) => {
                  const val = e.target.value;
                  setSelectedPregaoValue(val);
                  if (val.startsWith('date:')) {
                    const d = val.replace('date:', '');
                    setSelectedPregaoDate(d);
                    changeReplayDays(1);
                  }
                }}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                title="Escolha o pregão dos últimos 10 dias para o replay"
              >
                {currentAssetPregoes.length > 0 && (
                  <optgroup label={`── 📂 ÚLTIMOS 10 PREGÕES (${chartSymbolFor(asset)}) ──`} className="bg-slate-950 font-bold text-emerald-400">
                    {currentAssetPregoes.map((p, idx) => (
                      <option key={p.date} value={`date:${p.date}`} className="bg-slate-900 text-slate-100 font-normal">
                        Flow{idx + 1} · {p.date.split('-').reverse().join('/')} ({p.weekday}) · {p.sizeMb.toLocaleString('pt-BR')} MB
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
            </div>
          </div>

          {/* SELETOR DE VELOCIDADE EM CAIXA COMPACTA */}
          <div className="flex items-center gap-1 border-l border-slate-800 pl-2.5">
            <span className="text-[10px] font-bold text-amber-400 uppercase tracking-wide flex items-center gap-0.5 shrink-0">
              ⚡ Vel:
            </span>
            <select
              value={simulationSpeed}
              onChange={(e) => changeSimulationSpeed(Number(e.target.value))}
              className="h-6 rounded bg-slate-900 border border-slate-800 text-amber-400 font-bold text-[11px] px-1.5 cursor-pointer focus:outline-none focus:border-amber-500 hover:bg-slate-800 transition-colors"
              title="Velocidade da reprodução do replay"
            >
              <option value={0.25}>¼x (Muito lenta)</option>
              <option value={0.5}>½x (Lenta)</option>
              <option value={1}>1x (Normal)</option>
              <option value={2}>2x (Rápida)</option>
              <option value={3}>3x (Dinâmica)</option>
              <option value={5}>5x (Acelerada)</option>
              <option value={10}>10x (Máxima)</option>
            </select>
          </div>

          {/* Botão de Disparo / Indicador de Replay Ativo — Clean, sem roxo, sem bordas */}
          {!isReplaying ? (
            <button
              onClick={() => handleReplayHistory(replayDays, undefined, selectedPregaoDate || undefined)}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded text-slate-200 hover:text-white hover:bg-slate-800/60 text-[11px] font-bold cursor-pointer transition-all select-none ml-2"
              title="Iniciar simulação com os dados reais do pregão selecionado"
            >
              <Play className="w-3.5 h-3.5 fill-emerald-400 text-emerald-400" />
              <span>Replay</span>
            </button>
          ) : (
            <div className="flex items-center gap-1.5 text-[10.5px] font-mono select-none ml-2">
              <button
                onClick={() => handleStopReplay()}
                className="flex items-center gap-1 px-2 py-0.5 rounded text-amber-300 hover:text-amber-200 hover:bg-amber-950/40 cursor-pointer transition-colors"
                title="Pausar replay"
              >
                <Pause className="w-3.5 h-3.5 fill-amber-400 text-amber-400 animate-pulse" />
                <span className="font-sans font-bold">Pausar</span>
              </button>
              <span className="text-slate-600">·</span>
              <span className="text-white font-bold">{replayDateLabel}</span>
              {replayCurrentTimeStr && <span className="text-emerald-400 font-normal">{replayCurrentTimeStr}</span>}
              <span className="text-amber-300 font-bold ml-0.5">({simulationSpeed}x)</span>
              <span className="text-emerald-300 tabular-nums">[{replayProgress}%]</span>
            </div>
          )}

          {/* Seed do pregão sintético: fonte aumentada e sem caixa no manual */}
          <div className="flex items-center gap-1 shrink-0 ml-1">
            <span className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Seed</span>
            <button
              onClick={() => setReplaySeed((prev) => (prev === null ? lastReplay?.seed ?? randomReplaySeed() : null))}
              className={`px-1 py-0 rounded text-[11px] font-semibold transition-colors whitespace-nowrap cursor-pointer font-mono tabular-nums ${
                replaySeed === null
                  ? 'text-slate-400 hover:text-slate-100'
                  : 'text-emerald-400 hover:text-emerald-300'
              }`}
              title={
                replaySeed === null
                  ? `AUTO: cada corrida sorteia um pregão sintético diferente. Clique para FIXAR o seed da última corrida.`
                  : `Pregão sintético FIXO (seed #${replaySeed}): toda corrida reproduz o MESMO mercado. Clique para voltar ao AUTO.`
              }
            >
              {replaySeed === null ? 'AUTO' : `#${replaySeed}`}
            </button>
            {replaySeed !== null && (
              <button
                onClick={() => setReplaySeed(randomReplaySeed())}
                className="p-0.5 rounded text-slate-500 hover:text-slate-200 transition-colors cursor-pointer"
                title="Sortear outro seed fixo"
              >
                <RefreshCw className="w-3 h-3" />
              </button>
            )}
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">

            {/* O código do contrato aberto saiu desta linha: ele já está no seletor de ativo do

                cabeçalho, e o mesmo símbolo escrito duas vezes na mesma tela era a duplicidade. */}

            <span className="text-emerald-400 font-semibold">{formatPrice(currentPrice, asset)} pts</span>

            {/* Spec não homologado mora no grupo DIREITO da tira, junto dos outros alertas: o grupo

                esquerdo rola com overflow-x-auto e recortaria o balão do AlertChip (armadilha já

                conhecida dos dropdowns da tira). O aviso continua na tela o tempo todo, porque um

                R$/ponto errado contamina PnL e a trava financeira em dinheiro real. */}

          </div>

          {/* O CVD saiu da tira: ele já mora no card do Box Renko (e na linha do próprio gráfico) —

              na tela do pregão a mesma medida escrita em dois lugares só convida a discordarem. */}

          <div className="hidden md:flex items-center gap-2 shrink-0">

            <span className="text-slate-400">Origem:</span>

            <span className={mt5State.status === 'CONNECTED' ? 'text-emerald-400 font-bold' : 'text-neutral-400'}>

              {mt5State.status === 'CONNECTED'

                ? `MT5 XP ${mt5State.accountLogin || ''}`.trim()

                : 'Simulação B3'}

            </span>

            {/* BOTÃO AUDITORIA & LOG DE CONEXÃO MT5 COM MEDIÇÃO DE LATÊNCIA E QUEDAS */}
            <button
              onClick={() => setIsConnLogModalOpen(true)}
              className={`flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-mono font-bold transition-all ml-1 ${
                connDisconnectCount > 0
                  ? 'bg-rose-950/60 text-rose-300 border border-rose-800'
                  : mt5State.status === 'CONNECTED'
                  ? 'bg-slate-900 text-emerald-400 border border-slate-800 hover:border-emerald-600'
                  : 'bg-slate-900 text-slate-400 border border-slate-800 hover:text-slate-200'
              }`}
              title="Abrir Auditoria e Log de Conexão com Diagnóstico de Quedas"
            >
              <Activity className="w-3 h-3 text-emerald-400" />
              <span>LOG CONEXÃO</span>
              {currentLatency !== null && mt5State.status === 'CONNECTED' && (
                <span className="text-emerald-400 font-semibold">{currentLatency}ms</span>
              )}
              {connDisconnectCount > 0 && (
                <span className="px-1 py-0.2 rounded bg-rose-600 text-white text-[9px] font-bold">
                  {connDisconnectCount} {connDisconnectCount === 1 ? 'queda' : 'quedas'}
                </span>
              )}
            </button>

          </div>

        </div>

        {/* ZONA FIXA DIREITA: Resumo da Corrida + Alertas (alinhados com a caixa Adm do topo).
            Possui shrink-0 para NUNCA sumir em telas estreitas como o navegador interno! */}
        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          {/* A medida da corrida fica na zona fixa (a direita nunca some). O eco de velocidade/seed
              que existia aqui saiu: os dois valores agora só têm um lugar na tela — o grupo do replay. */}
          {lastReplay && !isReplaying && (

            <div

              className="hidden sm:flex items-center gap-1.5 px-1.5 py-0 rounded border border-slate-800 bg-slate-900/70 text-[10px] shrink-0"

              title={`Corrida de ${lastReplay.days} dia(s) em ${lastReplay.speed}x · ${

                lastReplay.source === 'REAL'

                  ? `${fonteReplayLabel(lastReplay.source, lastReplay.volumeSource, lastReplay.fonte, lastReplay.origin)}, ${lastReplay.tickCount.toLocaleString('pt-BR')} ticks na tela`

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

              {/* A ORIGEM da corrida (histórico real x sintético) saiu do texto do chip: a tira

                  "Origem" já diz de onde vem o mercado, e o hover do chip repete o detalhe. */}

              <span className="text-slate-500">

                {lastReplay.trades}t

              </span>

              {!lastReplay.operated && <span className="text-amber-400/80">silencioso</span>}

            </div>

          )}

          {/* Os dois alertas vivem no fim da tira, na coluna do selo Adm — caixas alinhadas à

              direita e balões que abrem no hover/toque (AlertChip), porque o `title` nativo não

              entregava a mensagem. Ordem: spec não homologado, depois portões de entrada. */}

          {asset.status === 'a_confirmar' && (

            <AlertChip

              tone="amber"

              align="right"

              icon={<ShieldAlert className="w-3.5 h-3.5" />}

              message={`SPEC NÃO HOMOLOGADO — ${asset.contractNote}\nO Robô fica travado em OFF enquanto o ativo estiver neste estado; homologar é mudar o status no registro de ativos.`}

            />

          )}

          {/* Por que nenhuma ordem sai? Espelho ao vivo dos portões de entrada (Robô / trava financeira / janela de entradas / trava de pregão). */}

          {blocksEntries && (

            <AlertChip

              tone={finLockNow && config.active ? 'rose' : 'amber'}

              align="right"

              icon={<AlertTriangle className="w-3.5 h-3.5" />}

              message={[

                ...(!config.active ? ['Robô pausado: nenhuma ordem sai — ligue no botão On/Off no topo direito. Ativar uma estratégia pausa o Robô de propósito.'] : []),

                ...(finLockNow ? [finLockNow.reason, config.closeAllOnFinancialLock ? 'Posições abertas foram zeradas a mercado (trava com zeragem ligada na estratégia).' : 'Posições abertas seguem gerenciadas até a saída natural (TP, trailing, virada de fluxo).'] : []),

                ...gateReasons,

                ...(isReplaying && !replayOperates ? ['O replay está no modo SILENCIOSO: ligue o chip OPERA ao lado da setinha para ele disparar ordens na tela.'] : []),

              ].join('\n')}

            />

          )}

          {/* Posições abertas e PnL da sessão saíram daqui: migraram para o painel Hedge da boleta,

              abaixo dos botões COMPRA/VENDA (contratos por lado, flutuante, ganhos, perdas, PnL do dia). */}

        </div>

      </div>



      {/* Conteúdo Principal com compensação inferior no celular. Sem vão no topo (p-todo menos

          pb): as três faixas do topo precisam colar uma na outra — qualquer padding superior aqui

          cria um segundo vão visível entre a tira de status e a barra do gráfico. */}

      <main className="flex-1 min-h-0 px-3 sm:px-4 md:px-5 pt-0 pb-16 lg:pb-1 bg-slate-950 overflow-hidden">

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
                  rightContent={strategySelectorNode}
                  boxes={chartSeries === 'renko' ? boxes : chartSeries === 'range' ? rangeBoxes : timeBoxes}


                  sessionGaps={chartSeries === 'renko' ? sessionGaps : []}

                  currentBox={chartSeries === 'renko' ? currentBox : chartSeries === 'range' ? rangeCurrentBox : timeCurrentBox}

                  currentPrice={currentPrice}

                  openOrders={openOrders}

                  hedgeBook={hedgeBook}

                  minDeltaThreshold={config.minDeltaThreshold}

                  onManualOrder={handleManualOrder}

                  onClosePositions={handleClosePositions}

                  onClosePositionsSide={handleClosePositions}

                  contracts={config.contracts}

                  stopLossPoints={config.stopLossPoints}

                  takeProfitPoints={config.takeProfitPoints}

                  breakevenOffsetPoints={config.breakevenOffsetPoints}

                  trailingDistancePoints={config.trailingDistancePoints}

                  onTakeProfitChange={(v) => handleBoletaConfigPatch({ takeProfitPoints: v })}

                  onStopLossPointsChange={(v) => handleBoletaConfigPatch({ stopLossPoints: v })}

                  onPartialPointsChange={(v) => handleBoletaConfigPatch({ partialPoints: v })}

                  onBreakevenChange={(v) => handleBoletaConfigPatch({ breakevenOffsetPoints: v })}

                  breakevenTriggerPoints={config.breakevenTriggerPoints}

                  breakevenLockPoints={config.breakevenLockPoints}

                  onBreakevenTriggerChange={(v) => handleBoletaConfigPatch({ breakevenTriggerPoints: v })}

                  onBreakevenLockChange={(v) => handleBoletaConfigPatch({ breakevenLockPoints: v })}

                  onTrailingChange={(v) => handleBoletaConfigPatch({ trailingDistancePoints: v })}

                  onContractsChange={(v) => handleBoletaConfigPatch({ contracts: v })}

                  isRealMT5Connected={mt5State.status === 'CONNECTED'}

                  strategyMode={config.strategyMode}

                  enablePartialExit={config.enablePartialExit}

                  partialPoints={config.partialPoints}

                  partialContracts={config.partialContracts}

                  trailingStop={config.trailingStop}

                  onExecutePyramidDemo={handleExecutePyramidDemo}

                  chartSeries={chartSeries}

                  onSeriesChange={handleSeriesChange}

                  renkoBoxPoints={config.boxPoints}

                  onRenkoBoxPointsChange={(v) => handleBoletaConfigPatch({ boxPoints: v })}

                  onOpenRenkoParam={goToRenkoParam}

                  rangePoints={rangePoints}

                  onRangePointsChange={setRangePoints}

                  timeframeSec={timeframeSec}

                  onTimeframeChange={setTimeframeSec}

                  dadosWindowOpen={dadosPanelOpen}

                  onDadosWindowClose={() => setDadosPanelOpen(false)}

                  boxWindowOpen={boxWindowOpen}

                  onBoxWindowClose={() => setBoxWindowOpen(false)}

                  shadowEnabled={shadowRun.enabled}

                  shadowSummary={shadowChipSummary}

                  shadowPnl={shadowRun.enabled ? shadowSnap.stats.liveEquity : undefined}

                  shadowDetail={shadowChipDetail}

                  onOpenShadowWindow={handleToggleShadowWindow}

                  shadowWindowOpen={shadowWindowOpen}

                  onShadowWindowClose={() => setShadowWindowOpen(false)}

                  onPatchShadowConfig={handleBoletaConfigPatch}

                  multiRobotSignals={multiRobotSignals}

                  multiRobotPositions={multiRobotPositions}

                  multiRobotStates={multiRobotStates}

                  onChangeRobotState={handleChangeRobotState}

                  onExecuteMultiRobotSignal={handleExecuteMultiRobotSignal}

                  onManualMultiRobotOrder={handleManualMultiRobotOrder}

                  onCloseMultiRobotPosition={handleCloseMultiRobotPosition}

                  onResetRiskLock={handleResetRiskLock}

                  focusedRobotAsset={focusedRobotAsset}

                  onOpenMultiRobotWindow={handleOpenMultiRobotWindow}

                  varalPendingOrders={mt5State.pendingOrders}

                  varalConfig={mt5State.varalConfig}

                  onChangeVaralConfig={handleUpdateVaralConfig}

                  onClearVaral={handleClearVaral}

                  priceLevels={sessionLevels}

                  vwapCurve={vwapCurve}

                  asset={asset}

                  funnelMetrics={funnelMetrics}

                  onFunnelPatch={handleBoletaConfigPatch}

                  orderNotifsMuted={orderNotifsMuted}

                  onToggleOrderNotifs={handleToggleOrderNotifs}

                  dayStatsBySymbol={(mt5State as any)?.dayStatsBySymbol}

                />

              </div>

            )}



            {activeTab === 'tape' && (

              <div className="h-full w-full">

                <TimesAndTrades ticks={ticks} cvd={cvd} asset={asset} />

              </div>

            )}



            {activeTab === 'equity' && (

              <div className="h-full w-full">

                <EquityCurveView

                  orders={orders}

                  stats={stats}

                  currentPrice={currentPrice}

                  asset={asset}

                  mt5State={mt5State}

                  onRefreshMt5={() => {

                    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {

                      wsRef.current.send(JSON.stringify({ action: 'GET_MT5_EQUITY', limit: 1000, days: 30 }));

                    }

                  }}

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
                  
                  bridgeOrdersBlocked={mt5State.bridgeOrdersBlocked}

                  bridgeReplayMode={mt5State.bridgeReplayMode}

                  bridgeEnvLock={mt5State.bridgeEnvLock}

                  onToggleReplayMode={handleToggleReplayMode}

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

                  onRunRealBacktest={handleRunRealBacktest}

                  isBacktestingReal={isBacktestingReal}

                  realBacktestResult={realBacktestResult}

                  localPregoes={localPregoes}

                />

              </div>

            )}



            {activeTab === 'comparativo' && (

              <div className="h-full w-full">

                <SeriesComparisonView

                  onReplayHistory={handleReplayHistory}

                  isReplaying={isReplaying}

                  onPatchConfig={handleBoletaConfigPatch}

                />

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

                  boxScaleLabel={renkoScaleLabel(config.boxPoints, asset)}

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

                  boxScaleLabel={renkoScaleLabel(config.boxPoints, asset)}

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

                    // Fase A: host/porta são runtime (ficam só no config); tetos da ponte são campo

                    // de estratégia (voltam para a biblioteca). O funil separa os dois.

                    patchActiveStrategy(partial);

                  }}

                />

              </div>

            )}



            {activeTab === 'settings' && (

              <div className="h-full w-full">

                <AutomationPanel

                  config={config}

                  setConfig={setConfig}

                  onPatchStrategy={patchActiveStrategy}

                  onApplyConfigBundle={handleApplyConfigBundle}

                  activeStrategyName={activeStrategyName}

                  simulationSpeed={simulationSpeed}

                  setSimulationSpeed={setSimulationSpeed}

                  onStepTick={handleStepTick}

                  onInjectLargeAggression={handleInjectLargeAggression}

                  // Arrow explícita: handleResetData ganhou opções (troca de ativo) e o clique do

                  // botão passaria o MouseEvent como se fosse `options`.

                  onResetData={() => handleResetData()}

                  focusParam={paramFocus}

                  onFocusParamConsumed={() => setParamFocus(null)}

                />

              </div>

            )}



            {activeTab === 'studio' && (

              <div className="h-full w-full">

                <StrategyStudio

                  currentConfig={config}

                  activeProfileName={activeStrategyName ?? undefined}

                  activeStrategyId={config.strategyId ?? null}

                  shadowStrategyId={config.shadowRobot?.strategyId ?? null}

                  onLibraryChanged={refreshStrategyLibrary}

                  onApplyConfig={handleApplySyncedConfig}

                  onActivate={(s) => {

                    handleActivateStrategy(s);

                    refreshStrategyLibrary();

                  }}

                  onOpenEditor={() => setActiveTab('settings')}

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
          title="Curva de Patrimônio & Gráfico Subaquático de Exposição (Drawdown)"
        >
          <LineChart className="w-4 h-4 mb-0.5" />
          <span>Patrimônio</span>
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

                onClick={() => { handleToggleShadowWindow(); setMoreNavOpen(false); }}

                className={`flex flex-col items-center justify-center py-3 rounded-lg text-[10px] font-medium border transition-colors ${

                  shadowWindowOpen && activeTab === 'chart' ? 'border-emerald-600 bg-emerald-950/40 text-emerald-200 font-semibold' : 'border-slate-800 bg-slate-900/60 text-slate-400'

                }`}

                title="Janela do segundo robô, em papel, com estratégia e escala próprias"

              >

                <Cpu className="w-5 h-5 mb-1" />

                <span>Robô 2</span>

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



      {/* Toast flutuante de Disparo de Ordem / Conexão — centrado no QUADRO DE DESENHO do

          gráfico (variáveis --fluxo-chart-left/--fluxo-chart-width publicadas pelo canvas como

          rect.left × lineRight): o MESMO centro do punho do divisor, nunca o da tela (que com a

          lateral docked deslocaria o aviso) nem o do canvas inteiro (que embute a reserva da

          boleta e a régua e empurraria o aviso para a faixa da boleta). Base a 14px ACIMA da

          linha divisória (--fluxo-divider-y), acompanhando o arrasto do divisor; os fallbacks

          valem só antes do primeiro desenho. Some sozinho em 2,4s ou no ✕. O palco é

          pointer-events-none (o gráfico continua clicável); só o cartão recebe eventos.

          Avisos marcados com chartOnly (ordens executadas/enviadas) só aparecem na aba Gráfico. */}

      {/* DIAGNÓSTICO DA PONTE: faixa fixa no topo, visível em qualquer aba. Existe porque o toast
          se sobrepõe a outros avisos e o operador não tinha como ver se o backfill chegou. */}
      {bfDiag && (
        <div className="fixed top-0 left-0 right-0 z-[60] bg-amber-500 text-slate-950 text-[11px] font-bold px-3 py-1 text-center">
          {bfDiag}
        </div>
      )}

      {latestToast && (activeTab === 'chart' || !latestToast.chartOnly) && (!orderNotifsMuted || latestToast.type === 'INFO') && (

        <div

          className="fixed z-50 flex justify-center pointer-events-none"

          style={{

            left: 'var(--fluxo-chart-left, 0px)',

            width: 'var(--fluxo-chart-width, 100vw)',

            top: 'calc(max(84px, var(--fluxo-divider-y, 46vh)) - 14px)',

            transform: 'translateY(-100%)',

          }}

        >

          <div className="flow-toast pointer-events-auto w-[min(92vw,320px)] bg-slate-900/95 border border-slate-700 rounded-md px-2.5 py-1.5 shadow-xl shadow-black/50 backdrop-blur-sm">

            <div className="flex items-start gap-1.5">

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

                  <ArrowUpRight className="w-3 h-3" />

                ) : latestToast.type === 'INFO' ? (

                  <Activity className="w-3 h-3" />

                ) : (

                  <ArrowDownRight className="w-3 h-3" />

                )}

              </span>

              <div className="flex-1 min-w-0">

                <span className="block text-[10px] font-semibold text-slate-200 leading-snug font-mono">

                  {latestToast.title}

                </span>

                {latestToast.description && (

                  <span className="block text-[9.5px] text-slate-400 leading-snug mt-0.5">

                    {latestToast.description}

                  </span>

                )}

              </div>

              <span className="shrink-0 flex items-center gap-0.5 text-[9px] text-slate-500 font-mono">

                <Clock className="w-2.5 h-2.5" />

                {mt5State.status === 'CONNECTED' ? 'MT5' : 'SIM'}

              </span>

              {/* O aviso mora em cima do gráfico mesmo: fechar na hora tem de ser um toque. */}

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

      {/* MODAL AUDITORIA & DIAGNÓSTICO DE CONEXÃO MT5 */}
      <ConnectionLogModal
        isOpen={isConnLogModalOpen}
        onClose={() => setIsConnLogModalOpen(false)}
        logs={connectionLogs}
        onClearLogs={() => setConnectionLogs([])}
        connectionStatus={mt5State.status}
        currentLatency={currentLatency}
        disconnectCount={connDisconnectCount}
        sessionUptimeSeconds={sessionUptimeSeconds}
        wsUrl={`ws://${config.mt5Host || '127.0.0.1'}:${config.mt5Port || 8765}`}
        brokerCompany={mt5State.brokerCompany}
        accountLogin={mt5State.accountLogin != null ? String(mt5State.accountLogin) : undefined}
        terminalConnected={terminalConnected}
      />

    </div>

  );

}

