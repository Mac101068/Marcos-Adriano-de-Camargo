import React, { useState, useMemo, useEffect } from 'react';
import { TradeOrder, TerminalStats, MT5ConnectionState, MT5Deal } from '../types/trading';
import { ASSETS, AssetSpec, DEFAULT_ASSET_ID, pointsToBRL } from '../assets/assetRegistry';
import {
  TrendingUp,
  TrendingDown,
  DollarSign,
  Target,
  Award,
  ShieldAlert,
  LineChart as LineChartIcon,
  Download,
  Percent,
  Activity,
  ArrowUpRight,
  ArrowDownRight,
  Sparkles,
  Info,
  Calendar,
  Layers,
  RefreshCw,
  Wallet,
  CheckCircle2,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  Maximize2,
  Minimize2,
  RotateCcw,
  Eye,
  EyeOff,
} from 'lucide-react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceLine,
} from 'recharts';

interface EquityCurveViewProps {
  orders: TradeOrder[];
  stats: TerminalStats;
  currentPrice: number;
  /** Ativo das ordens: só serve para converter pontos em R$ no PnL flutuante. */
  asset?: AssetSpec;
  mt5State?: MT5ConnectionState;
  onRefreshMt5?: () => void;
}

export const EquityCurveView: React.FC<EquityCurveViewProps> = ({
  orders,
  stats,
  currentPrice,
  asset = ASSETS[DEFAULT_ASSET_ID],
  mt5State,
  onRefreshMt5,
}) => {
  const isMt5Online = mt5State?.status === 'CONNECTED';

  // Fonte de dados: se MT5 estiver online, padrão é MT5_LIVE, senão SIM
  const [viewSource, setViewSource] = useState<'MT5_LIVE' | 'SIM'>(() => {
    return isMt5Online ? 'MT5_LIVE' : 'SIM';
  });

  // Se o MT5 conectar após montar, seleciona MT5_LIVE
  useEffect(() => {
    if (isMt5Online && viewSource === 'SIM' && (!orders || orders.length === 0)) {
      setViewSource('MT5_LIVE');
    }
  }, [isMt5Online]);

  // Filtro de período para o MT5
  const [mt5PeriodFilter, setMt5PeriodFilter] = useState<'ALL' | '7D' | 'TODAY'>('ALL');

  // Configuração de Capital Inicial para simulação
  const [initialCapital, setInitialCapital] = useState<number>(5000); // R$ 5.000 padrão
  const [chartMetric, setChartMetric] = useState<'TOTAL_EQUITY' | 'NET_PNL' | 'POINTS'>('TOTAL_EQUITY');
  const [includeFloating, setIncludeFloating] = useState<boolean>(true);
  const [tradeFilter, setTradeFilter] = useState<'ALL' | 'WINNERS' | 'LOSERS'>('ALL');

  // =========================================================================
  // CONTROLES DE LAYOUT COMPACTO & MINIMIZAÇÃO DE JANELAS
  // =========================================================================
  const [showAccountBanner, setShowAccountBanner] = useState<boolean>(true);
  const [showKpiCards, setShowKpiCards] = useState<boolean>(true);
  const [showMainEquityChart, setShowMainEquityChart] = useState<boolean>(true);
  const [mainChartHeight, setMainChartHeight] = useState<'normal' | 'expanded'>('normal'); // 250px vs 420px
  const [showUnderwaterChart, setShowUnderwaterChart] = useState<boolean>(true);
  const [underwaterExpanded, setUnderwaterExpanded] = useState<boolean>(false); // destaque col-span-2 e h-[290px]
  const [showHistogramChart, setShowHistogramChart] = useState<boolean>(true);
  const [histogramExpanded, setHistogramExpanded] = useState<boolean>(false);
  const [showRiskMatrix, setShowRiskMatrix] = useState<boolean>(true);

  // Alternador de foco nos gráficos (minimiza painéis para dar espaço total aos gráficos)
  const isChartsFocused = !showAccountBanner && !showKpiCards && mainChartHeight === 'expanded';
  const handleToggleFocusCharts = () => {
    if (isChartsFocused) {
      setShowAccountBanner(true);
      setShowKpiCards(true);
      setMainChartHeight('normal');
      setUnderwaterExpanded(false);
      setHistogramExpanded(false);
    } else {
      setShowAccountBanner(false);
      setShowKpiCards(false);
      setMainChartHeight('expanded');
      setShowMainEquityChart(true);
      setShowUnderwaterChart(true);
    }
  };

  // Calcula o PnL flutuante local das ordens abertas em tempo real
  const localFloatingPnL = useMemo(() => {
    return orders
      .filter((o) => o.status === 'OPEN')
      .reduce((acc, o) => {
        const activeCtros = o.remainingContracts || o.contracts;
        const pts = o.type === 'BUY' ? currentPrice - o.entryPrice : o.entryPrice - currentPrice;
        const fin = pointsToBRL(pts, activeCtros, asset) + (o.partialFinancial || 0);
        return acc + fin;
      }, 0);
  }, [orders, currentPrice, asset]);

  const localFloatingPoints = useMemo(() => {
    return orders
      .filter((o) => o.status === 'OPEN')
      .reduce((acc, o) => {
        const pts = o.type === 'BUY' ? currentPrice - o.entryPrice : o.entryPrice - currentPrice;
        return acc + pts;
      }, 0);
  }, [orders, currentPrice]);

  // Deals filtrados do MT5
  const mt5FilteredDeals = useMemo(() => {
    if (!mt5State?.deals || mt5State.deals.length === 0) return [];
    const now = Date.now();
    const oneDayMs = 24 * 3600 * 1000;
    const sevenDaysMs = 7 * oneDayMs;

    return mt5State.deals.filter((d) => {
      // Prioriza negócios com resultado financeiro (lucro/prejuízo de saída ou reversão)
      const hasTradeResult = (d.profit !== undefined && d.profit !== 0) || (d as any).entry === 1 || (d as any).entry === 2;
      if (!hasTradeResult) return false;

      if (mt5PeriodFilter === 'TODAY') {
        const dDate = new Date(d.time);
        const nowDate = new Date(now);
        return (
          dDate.getDate() === nowDate.getDate() &&
          dDate.getMonth() === nowDate.getMonth() &&
          dDate.getFullYear() === nowDate.getFullYear()
        );
      }
      if (mt5PeriodFilter === '7D') {
        return now - d.time <= sevenDaysMs;
      }
      return true; // ALL (30 dias)
    });
  }, [mt5State?.deals, mt5PeriodFilter]);

  // Construção da curva de patrimônio
  const { equitySeries, underwaterSeries, tradeDistribution, extendedStats, baseCapital } = useMemo(() => {
    const isMt5 = viewSource === 'MT5_LIVE' && isMt5Online;

    if (isMt5) {
      // DADOS REAIS DO METATRADER 5 (XP LIVE)
      const deals = mt5FilteredDeals.slice().sort((a, b) => a.time - b.time);
      const totalProfitFromDeals = deals.reduce((acc, d) => acc + (d.profit || 0), 0);
      const currentLiveBalance = mt5State?.balance ?? 1000000;
      const computedStartCapital = Math.max(1000, currentLiveBalance - totalProfitFromDeals);
      const startCap = computedStartCapital;

      let runningPnl = 0;
      let peakEquity = startCap;
      let maxDrawdownNominal = 0;
      let maxDrawdownPercent = 0;

      let winsCount = 0;
      let lossesCount = 0;
      let totalWinFin = 0;
      let totalLossFin = 0;
      let maxConsecWins = 0;
      let curConsecWins = 0;
      let maxConsecLoss = 0;
      let curConsecLoss = 0;
      let largestWin = 0;
      let largestLoss = 0;

      const eqPoints: any[] = [
        {
          index: 0,
          label: 'Início',
          timeStr: deals[0]?.timeStr || 'Abertura',
          pnlTrade: 0,
          pointsTrade: 0,
          cumulativePnl: 0,
          cumulativePoints: 0,
          totalEquity: startCap,
          peakEquity: startCap,
          drawdownNominal: 0,
          drawdownPct: 0,
          type: 'START',
          status: 'START',
          contracts: 0,
          isLiveFloating: false,
        },
      ];

      const uwPoints: any[] = [
        {
          index: 0,
          label: 'Início',
          timeStr: deals[0]?.timeStr || 'Abertura',
          drawdownPct: 0,
          drawdownNominal: 0,
        },
      ];

      const distribution: Array<{
        tradeNum: string;
        pnl: number;
        points: number;
        isWin: boolean;
        timeStr: string;
      }> = [];

      deals.forEach((deal, idx) => {
        const pnl = deal.profit || 0;
        runningPnl += pnl;
        const currentTotEquity = startCap + runningPnl;

        if (currentTotEquity > peakEquity) {
          peakEquity = currentTotEquity;
        }

        const ddNominal = peakEquity - currentTotEquity;
        const ddPct = peakEquity > 0 ? (ddNominal / peakEquity) * 100 : 0;

        if (ddNominal > maxDrawdownNominal) maxDrawdownNominal = ddNominal;
        if (ddPct > maxDrawdownPercent) maxDrawdownPercent = ddPct;

        if (pnl > 0) {
          winsCount++;
          totalWinFin += pnl;
          curConsecWins++;
          curConsecLoss = 0;
          if (curConsecWins > maxConsecWins) maxConsecWins = curConsecWins;
          if (pnl > largestWin) largestWin = pnl;
        } else if (pnl < 0) {
          lossesCount++;
          totalLossFin += Math.abs(pnl);
          curConsecLoss++;
          curConsecWins = 0;
          if (curConsecLoss > maxConsecLoss) maxConsecLoss = curConsecLoss;
          if (Math.abs(pnl) > largestLoss) largestLoss = Math.abs(pnl);
        }

        const isWin = pnl >= 0;

        eqPoints.push({
          index: idx + 1,
          label: `#${idx + 1}`,
          ticket: deal.ticket,
          timeStr: deal.timeStr,
          comment: deal.comment,
          pnlTrade: pnl,
          pointsTrade: 0,
          cumulativePnl: runningPnl,
          cumulativePoints: 0,
          totalEquity: currentTotEquity,
          peakEquity: peakEquity,
          drawdownNominal: -ddNominal,
          drawdownPct: -ddPct,
          type: deal.type,
          status: isWin ? 'LUCRO' : 'PREJUÍZO',
          contracts: deal.volume,
          isLiveFloating: false,
        });

        uwPoints.push({
          index: idx + 1,
          label: `#${idx + 1}`,
          timeStr: deal.timeStr,
          drawdownPct: -ddPct,
          drawdownNominal: -ddNominal,
        });

        distribution.push({
          tradeNum: `#${idx + 1}`,
          pnl,
          points: 0,
          isWin,
          timeStr: deal.timeStr,
        });
      });

      // MTM ao vivo do MT5 se houver lucro flutuante
      const mt5Floating = mt5State?.floatingProfit || 0;
      if (includeFloating && (mt5Floating !== 0 || (mt5State?.positions && mt5State.positions.length > 0))) {
        const livePnl = runningPnl + mt5Floating;
        const liveTotEquity = mt5State?.equity ?? (startCap + livePnl);
        const livePeak = Math.max(peakEquity, liveTotEquity);
        const liveDdNominal = livePeak - liveTotEquity;
        const liveDdPct = livePeak > 0 ? (liveDdNominal / livePeak) * 100 : 0;

        eqPoints.push({
          index: eqPoints.length,
          label: 'MT5 Ao Vivo',
          timeStr: 'Agora',
          pnlTrade: mt5Floating,
          pointsTrade: 0,
          cumulativePnl: livePnl,
          cumulativePoints: 0,
          totalEquity: liveTotEquity,
          peakEquity: livePeak,
          drawdownNominal: -liveDdNominal,
          drawdownPct: -liveDdPct,
          type: 'MTM',
          status: mt5Floating >= 0 ? 'LUCRO' : 'PREJUÍZO',
          contracts: mt5State?.positions?.reduce((a, b) => a + b.volume, 0) || 0,
          isLiveFloating: true,
        });

        uwPoints.push({
          index: uwPoints.length,
          label: 'MT5 Ao Vivo',
          timeStr: 'Agora',
          drawdownPct: -liveDdPct,
          drawdownNominal: -liveDdNominal,
        });
      }

      const totalTradesCount = deals.length;
      const winRate = totalTradesCount > 0 ? (winsCount / totalTradesCount) * 100 : 0;
      const profitFactor = totalLossFin > 0 ? totalWinFin / totalLossFin : totalWinFin > 0 ? 9.99 : 0;
      const avgWin = winsCount > 0 ? totalWinFin / winsCount : 0;
      const avgLoss = lossesCount > 0 ? totalLossFin / lossesCount : 0;
      const payoff = avgLoss > 0 ? avgWin / avgLoss : avgWin > 0 ? 9.99 : 0;
      const expectancy = totalTradesCount > 0 ? runningPnl / totalTradesCount : 0;
      const recoveryFactor = maxDrawdownNominal > 0 ? runningPnl / maxDrawdownNominal : runningPnl > 0 ? 99 : 0;
      const totalReturnPct = startCap > 0 ? (runningPnl / startCap) * 100 : 0;

      return {
        baseCapital: startCap,
        equitySeries: eqPoints,
        underwaterSeries: uwPoints,
        tradeDistribution: distribution,
        extendedStats: {
          totalTrades: totalTradesCount,
          winsCount,
          lossesCount,
          winRate,
          profitFactor,
          netPnl: runningPnl,
          totalPoints: 0,
          totalReturnPct,
          finalEquity: mt5State?.equity ?? (startCap + runningPnl),
          peakEquity,
          maxDrawdownNominal,
          maxDrawdownPercent,
          avgWin,
          avgLoss,
          payoff,
          expectancy,
          recoveryFactor,
          maxConsecWins,
          maxConsecLoss,
          largestWin,
          largestLoss,
        },
      };
    } else {
      // DADOS DA SIMULAÇÃO LOCAL / ORDENS DA INTERFACE
      const closedTrades = orders
        .filter((o) => o.status !== 'OPEN' && o.status !== 'PENDING_LIMIT' && o.status !== 'EXPIRED_PULLBACK')
        .slice()
        .reverse();

      let runningPnl = 0;
      let runningPoints = 0;
      let peakEquity = initialCapital;
      let maxDrawdownNominal = 0;
      let maxDrawdownPercent = 0;

      let winsCount = 0;
      let lossesCount = 0;
      let totalWinFin = 0;
      let totalLossFin = 0;
      let maxConsecWins = 0;
      let curConsecWins = 0;
      let maxConsecLoss = 0;
      let curConsecLoss = 0;
      let largestWin = 0;
      let largestLoss = 0;

      const eqPoints: any[] = [
        {
          index: 0,
          label: 'Início',
          timeStr: closedTrades[0]?.timeStr || '09:00:00',
          pnlTrade: 0,
          pointsTrade: 0,
          cumulativePnl: 0,
          cumulativePoints: 0,
          totalEquity: initialCapital,
          peakEquity: initialCapital,
          drawdownNominal: 0,
          drawdownPct: 0,
          type: 'START',
          status: 'START',
          contracts: 0,
          isLiveFloating: false,
        },
      ];

      const uwPoints: any[] = [
        {
          index: 0,
          label: 'Início',
          timeStr: closedTrades[0]?.timeStr || '09:00:00',
          drawdownPct: 0,
          drawdownNominal: 0,
        },
      ];

      const distribution: Array<{
        tradeNum: string;
        pnl: number;
        points: number;
        isWin: boolean;
        timeStr: string;
      }> = [];

      closedTrades.forEach((trade, idx) => {
        const pnl = trade.financialResult || 0;
        const pts = trade.pointsResult || 0;

        runningPnl += pnl;
        runningPoints += pts;
        const currentTotEquity = initialCapital + runningPnl;

        if (currentTotEquity > peakEquity) {
          peakEquity = currentTotEquity;
        }

        const ddNominal = peakEquity - currentTotEquity;
        const ddPct = peakEquity > 0 ? (ddNominal / peakEquity) * 100 : 0;

        if (ddNominal > maxDrawdownNominal) maxDrawdownNominal = ddNominal;
        if (ddPct > maxDrawdownPercent) maxDrawdownPercent = ddPct;

        if (pnl > 0) {
          winsCount++;
          totalWinFin += pnl;
          curConsecWins++;
          curConsecLoss = 0;
          if (curConsecWins > maxConsecWins) maxConsecWins = curConsecWins;
          if (pnl > largestWin) largestWin = pnl;
        } else if (pnl < 0) {
          lossesCount++;
          totalLossFin += Math.abs(pnl);
          curConsecLoss++;
          curConsecWins = 0;
          if (curConsecLoss > maxConsecLoss) maxConsecLoss = curConsecLoss;
          if (Math.abs(pnl) > largestLoss) largestLoss = Math.abs(pnl);
        }

        const isWin = pnl >= 0;

        eqPoints.push({
          index: idx + 1,
          label: `#${idx + 1}`,
          timeStr: trade.timeStr,
          pnlTrade: pnl,
          pointsTrade: pts,
          cumulativePnl: runningPnl,
          cumulativePoints: runningPoints,
          totalEquity: currentTotEquity,
          peakEquity: peakEquity,
          drawdownNominal: -ddNominal,
          drawdownPct: -ddPct,
          type: trade.type,
          status: isWin ? 'LUCRO' : 'PREJUÍZO',
          contracts: trade.contracts,
          isLiveFloating: false,
        });

        uwPoints.push({
          index: idx + 1,
          label: `#${idx + 1}`,
          timeStr: trade.timeStr,
          drawdownPct: -ddPct,
          drawdownNominal: -ddNominal,
        });

        distribution.push({
          tradeNum: `#${idx + 1}`,
          pnl,
          points: pts,
          isWin,
          timeStr: trade.timeStr,
        });
      });

      if (includeFloating && orders.some((o) => o.status === 'OPEN')) {
        const livePnl = runningPnl + localFloatingPnL;
        const livePts = runningPoints + localFloatingPoints;
        const liveTotEquity = initialCapital + livePnl;
        const livePeak = Math.max(peakEquity, liveTotEquity);
        const liveDdNominal = livePeak - liveTotEquity;
        const liveDdPct = livePeak > 0 ? (liveDdNominal / livePeak) * 100 : 0;

        eqPoints.push({
          index: eqPoints.length,
          label: 'MTM (Ao Vivo)',
          timeStr: 'Agora',
          pnlTrade: localFloatingPnL,
          pointsTrade: localFloatingPoints,
          cumulativePnl: livePnl,
          cumulativePoints: livePts,
          totalEquity: liveTotEquity,
          peakEquity: livePeak,
          drawdownNominal: -liveDdNominal,
          drawdownPct: -liveDdPct,
          type: 'MTM',
          status: localFloatingPnL >= 0 ? 'LUCRO' : 'PREJUÍZO',
          contracts: orders.filter((o) => o.status === 'OPEN').reduce((a, b) => a + (b.remainingContracts || b.contracts), 0),
          isLiveFloating: true,
        });

        uwPoints.push({
          index: uwPoints.length,
          label: 'MTM',
          timeStr: 'Agora',
          drawdownPct: -liveDdPct,
          drawdownNominal: -liveDdNominal,
        });
      }

      const totalTradesCount = closedTrades.length;
      const winRate = totalTradesCount > 0 ? (winsCount / totalTradesCount) * 100 : 0;
      const profitFactor = totalLossFin > 0 ? totalWinFin / totalLossFin : totalWinFin > 0 ? 9.99 : 0;
      const avgWin = winsCount > 0 ? totalWinFin / winsCount : 0;
      const avgLoss = lossesCount > 0 ? totalLossFin / lossesCount : 0;
      const payoff = avgLoss > 0 ? avgWin / avgLoss : avgWin > 0 ? 9.99 : 0;
      const expectancy = totalTradesCount > 0 ? runningPnl / totalTradesCount : 0;
      const recoveryFactor = maxDrawdownNominal > 0 ? runningPnl / maxDrawdownNominal : runningPnl > 0 ? 99 : 0;
      const totalReturnPct = initialCapital > 0 ? (runningPnl / initialCapital) * 100 : 0;

      return {
        baseCapital: initialCapital,
        equitySeries: eqPoints,
        underwaterSeries: uwPoints,
        tradeDistribution: distribution,
        extendedStats: {
          totalTrades: totalTradesCount,
          winsCount,
          lossesCount,
          winRate,
          profitFactor,
          netPnl: runningPnl,
          totalPoints: runningPoints,
          totalReturnPct,
          finalEquity: initialCapital + runningPnl,
          peakEquity,
          maxDrawdownNominal,
          maxDrawdownPercent,
          avgWin,
          avgLoss,
          payoff,
          expectancy,
          recoveryFactor,
          maxConsecWins,
          maxConsecLoss,
          largestWin,
          largestLoss,
        },
      };
    }
  }, [
    viewSource,
    isMt5Online,
    mt5FilteredDeals,
    mt5State?.balance,
    mt5State?.equity,
    mt5State?.floatingProfit,
    mt5State?.positions,
    orders,
    initialCapital,
    includeFloating,
    localFloatingPnL,
    localFloatingPoints,
  ]);

  // Exportar dados da Curva para CSV
  const handleExportCSV = () => {
    const isMt5 = viewSource === 'MT5_LIVE' && isMt5Online;
    const prefix = isMt5 ? 'curva_patrimonio_mt5_real' : 'curva_patrimonio_simulada';
    const headers = 'Trade,Horário,Lado,Resultado_Trade_RS,Pontos,Patrimonio_Acumulado_RS,Drawdown_Nominal_RS,Drawdown_Pct\n';
    const rows = equitySeries
      .slice(1)
      .map(
        (p) =>
          `"${p.label}","${p.timeStr}","${p.type}",${p.pnlTrade.toFixed(2)},${p.pointsTrade || 0},${p.totalEquity.toFixed(
            2
          )},${p.drawdownNominal.toFixed(2)},${p.drawdownPct.toFixed(2)}`
      )
      .join('\n');

    const blob = new Blob([headers + rows], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `${prefix}_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const isNetPositive = extendedStats.netPnl >= 0;

  return (
    <div className="flex flex-col h-full bg-slate-950 border border-slate-800/80 rounded-lg p-2 sm:p-3 overflow-y-auto space-y-3">
      {/* ========================================================================= */}
      {/* BARRA SUPERIOR: SELETORES, FILTROS E CONTROLE DE LAYOUT DOS GRÁFICOS */}
      {/* ========================================================================= */}
      <div className="flex flex-wrap items-center justify-between gap-2 bg-slate-900/90 border border-slate-800 px-3 py-2 rounded-xl shadow-md">
        {/* Lado Esquerdo: Modo MT5 vs Simulação */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <button
            onClick={() => setViewSource('MT5_LIVE')}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold transition-all ${
              viewSource === 'MT5_LIVE'
                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/50 shadow-inner'
                : 'bg-slate-800/60 text-slate-400 hover:text-slate-200 border border-transparent'
            }`}
          >
            <span className={`w-2 h-2 rounded-full ${isMt5Online ? 'bg-emerald-400 animate-pulse' : 'bg-slate-600'}`} />
            <span>MT5 Real (XP Live)</span>
            {isMt5Online && mt5State?.deals && (
              <span className="text-[10px] px-1 py-0.2 rounded bg-emerald-950 text-emerald-400 border border-emerald-800/60 font-mono">
                {mt5FilteredDeals.length}
              </span>
            )}
          </button>

          <button
            onClick={() => setViewSource('SIM')}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold transition-all ${
              viewSource === 'SIM'
                ? 'bg-blue-500/20 text-blue-300 border border-blue-500/50 shadow-inner'
                : 'bg-slate-800/60 text-slate-400 hover:text-slate-200 border border-transparent'
            }`}
          >
            <Activity className="w-3.5 h-3.5 text-blue-400" />
            <span>Simulação Local</span>
            <span className="text-[10px] px-1 py-0.2 rounded bg-slate-950 text-slate-400 border border-slate-800 font-mono">
              {orders.filter((o) => o.status !== 'OPEN' && o.status !== 'PENDING_LIMIT').length}
            </span>
          </button>
        </div>

        {/* Lado Direito: Filtros, Foco nos Gráficos e Ações */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {viewSource === 'MT5_LIVE' && (
            <div className="flex items-center gap-1 bg-slate-950 px-2 py-0.5 rounded-lg border border-slate-800 text-[11px] font-mono">
              <span className="text-slate-500 text-[10px] uppercase mr-0.5">Período:</span>
              <button
                onClick={() => setMt5PeriodFilter('TODAY')}
                className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                  mt5PeriodFilter === 'TODAY' ? 'bg-emerald-500/20 text-emerald-300' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Hoje
              </button>
              <button
                onClick={() => setMt5PeriodFilter('7D')}
                className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                  mt5PeriodFilter === '7D' ? 'bg-emerald-500/20 text-emerald-300' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                7D
              </button>
              <button
                onClick={() => setMt5PeriodFilter('ALL')}
                className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                  mt5PeriodFilter === 'ALL' ? 'bg-emerald-500/20 text-emerald-300' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                30D
              </button>
            </div>
          )}

          {/* BOTÃO DE FOCO TOTAL NOS GRÁFICOS (Recolhe painéis para liberar espaço) */}
          <button
            onClick={handleToggleFocusCharts}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold border transition-all ${
              isChartsFocused
                ? 'bg-amber-500/20 text-amber-300 border-amber-500/50 shadow-inner'
                : 'bg-emerald-950/40 hover:bg-emerald-900/60 text-emerald-300 border-emerald-700/60'
            }`}
            title={isChartsFocused ? 'Restaurar todos os painéis e cards' : 'Recolher painéis e focar espaço 100% nos gráficos'}
          >
            {isChartsFocused ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
            <span>{isChartsFocused ? 'Restaurar Painéis' : 'Foco Gráficos'}</span>
          </button>

          {isMt5Online && onRefreshMt5 && (
            <button
              onClick={onRefreshMt5}
              className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors"
              title="Solicitar atualização imediata da conta MT5"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span className="hidden md:inline">Atualizar MT5</span>
            </button>
          )}

          <button
            onClick={handleExportCSV}
            className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors"
            title="Exportar dados para CSV"
          >
            <Download className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">CSV</span>
          </button>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* BANNER DA CONTA MT5 (COM BOTÃO DE MINIMIZAR / EXPANDIR) */}
      {/* ========================================================================= */}
      {viewSource === 'MT5_LIVE' && (
        <div className="bg-slate-900/90 border border-emerald-500/30 rounded-xl overflow-hidden shadow-md transition-all">
          {!showAccountBanner ? (
            /* Versão Slim / Minimizada do Banner da Conta */
            <div className="flex items-center justify-between px-3 py-1.5 bg-slate-900/90 text-xs font-mono">
              <div className="flex items-center gap-3 flex-wrap">
                <span className="flex items-center gap-1.5 text-emerald-400 font-bold">
                  <Wallet className="w-3.5 h-3.5" />
                  <span>XP #{mt5State?.accountLogin || '50534540'}</span>
                </span>
                <span className="text-slate-400">
                  Saldo: <strong className="text-slate-100">R$ {(mt5State?.balance ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</strong>
                </span>
                <span className="text-slate-400">
                  Patrimônio: <strong className="text-emerald-400">R$ {(mt5State?.equity ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</strong>
                </span>
                <span className="text-slate-400">
                  Flutuante:{' '}
                  <strong className={(mt5State?.floatingProfit || 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                    {(mt5State?.floatingProfit || 0) >= 0 ? '+' : ''}R$ {(mt5State?.floatingProfit || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                  </strong>
                </span>
              </div>

              <button
                onClick={() => setShowAccountBanner(true)}
                className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-200 font-sans px-2 py-0.5 rounded bg-slate-800/60 border border-slate-700/60 transition-colors"
                title="Expandir dados detalhados da conta"
              >
                <span>Expandir Conta</span>
                <ChevronDown className="w-3 h-3" />
              </button>
            </div>
          ) : (
            /* Versão Completa do Banner da Conta */
            <div className="p-3">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/80 pb-2 mb-2.5">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
                    <Wallet className="w-3.5 h-3.5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-bold text-slate-100 uppercase tracking-wide">
                        {mt5State?.brokerCompany || 'XP Investimentos CCTVM S/A'}
                      </span>
                      <span className="px-1.5 py-0.2 rounded text-[10px] font-mono font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                        Conta #{mt5State?.accountLogin || '50534540'}
                      </span>
                      {isMt5Online ? (
                        <span className="flex items-center gap-1 text-[10px] text-emerald-400 font-semibold">
                          <CheckCircle2 className="w-2.5 h-2.5" /> ONLINE
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-[10px] text-rose-400 font-semibold">
                          <AlertCircle className="w-2.5 h-2.5" /> DESCONECTADO
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-3 font-mono text-xs">
                    <div className="text-right">
                      <span className="text-[9px] uppercase text-slate-500 block leading-tight">Saldo</span>
                      <span className="font-bold text-slate-200 text-xs">
                        R$ {(mt5State?.balance ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                      </span>
                    </div>
                    <div className="text-right">
                      <span className="text-[9px] uppercase text-slate-500 block leading-tight">Patrimônio</span>
                      <span className="font-bold text-emerald-400 text-xs">
                        R$ {(mt5State?.equity ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                      </span>
                    </div>
                    <div className="text-right">
                      <span className="text-[9px] uppercase text-slate-500 block leading-tight">Flutuante</span>
                      <span
                        className={`font-bold text-xs ${
                          (mt5State?.floatingProfit || 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'
                        }`}
                      >
                        {(mt5State?.floatingProfit || 0) >= 0 ? '+' : ''}R${' '}
                        {(mt5State?.floatingProfit || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                      </span>
                    </div>
                  </div>

                  <button
                    onClick={() => setShowAccountBanner(false)}
                    className="flex items-center gap-1 text-[10px] text-slate-400 hover:text-slate-200 px-1.5 py-0.5 rounded bg-slate-800/60 border border-slate-700/60 transition-colors ml-1"
                    title="Minimizar para ganhar espaço"
                  >
                    <span>Recolher</span>
                    <ChevronUp className="w-3 h-3" />
                  </button>
                </div>
              </div>

              {/* Posições Abertas Reais no MT5 */}
              {mt5State?.positions && mt5State.positions.length > 0 && (
                <div className="bg-slate-950/80 border border-slate-800 rounded-lg p-2 mt-2">
                  <div className="flex items-center justify-between text-[11px] text-slate-300 font-bold mb-1">
                    <span>Posições Abertas ({mt5State.positions.length}):</span>
                    <span className="font-mono text-emerald-400 text-[10px]">
                      Flutuante Total: R$ {(mt5State.floatingProfit || 0).toFixed(2)}
                    </span>
                  </div>
                  <div className="space-y-1">
                    {mt5State.positions.map((pos) => (
                      <div
                        key={pos.ticket}
                        className="flex items-center justify-between text-[10px] font-mono bg-slate-900/60 px-2 py-1 rounded border border-slate-800/80"
                      >
                        <div className="flex items-center gap-1.5">
                          <span className={`px-1 py-0.2 rounded font-bold ${pos.type === 'BUY' ? 'bg-emerald-500/20 text-emerald-300' : 'bg-rose-500/20 text-rose-300'}`}>
                            {pos.type}
                          </span>
                          <span className="text-slate-200 font-semibold">{pos.symbol}</span>
                          <span className="text-slate-400">{pos.volume} ctro(s)</span>
                          <span className="text-slate-500">#{pos.ticket}</span>
                        </div>
                        <div className="flex items-center gap-2.5">
                          <span className="text-slate-400">Entrada: {pos.priceOpen}</span>
                          <span className="text-slate-300">Atual: {pos.priceCurrent}</span>
                          <span className={`font-bold ${pos.profit >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                            {pos.profit >= 0 ? '+' : ''}R$ {pos.profit.toFixed(2)}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* 4 CARDS DE INDICADORES PRINCIPAIS DE PATRIMÔNIO (COM MINIMIZAR) */}
      {/* ========================================================================= */}
      {!showKpiCards ? (
        /* Barra compacta quando os 4 cards estão recolhidos */
        <div className="flex items-center justify-between bg-slate-900/80 border border-slate-800 px-3 py-1.5 rounded-xl text-xs font-mono shadow-sm">
          <div className="flex items-center gap-4 flex-wrap text-[11px]">
            <span>
              Patrimônio: <strong className="text-slate-100">R$ {extendedStats.finalEquity.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</strong>
            </span>
            <span>
              Resultado:{' '}
              <strong className={isNetPositive ? 'text-emerald-400' : 'text-rose-400'}>
                {isNetPositive ? '+' : ''}R$ {extendedStats.netPnl.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
              </strong>{' '}
              <span className="text-slate-500">({isNetPositive ? '+' : ''}{extendedStats.totalReturnPct.toFixed(2)}%)</span>
            </span>
            <span>
              F. Lucro: <strong className="text-amber-300">{extendedStats.profitFactor.toFixed(2)}</strong>
            </span>
            <span>
              Acerto: <strong className="text-neutral-300">{extendedStats.winRate.toFixed(1)}%</strong>
            </span>
            <span>
              Drawdown Máx: <strong className="text-rose-400">-{extendedStats.maxDrawdownPercent.toFixed(2)}%</strong>
            </span>
          </div>

          <button
            onClick={() => setShowKpiCards(true)}
            className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-200 font-sans px-2 py-0.5 rounded bg-slate-800/60 border border-slate-700/60 transition-colors"
            title="Expandir cards de métricas"
          >
            <span>Expandir Cards</span>
            <ChevronDown className="w-3 h-3" />
          </button>
        </div>
      ) : (
        /* Cards de Métricas em visual compacto com botão de colapso */
        <div className="space-y-1.5">
          <div className="flex items-center justify-between px-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Métricas de Patrimônio & Risco</span>
            <button
              onClick={() => setShowKpiCards(false)}
              className="flex items-center gap-1 text-[10px] text-slate-400 hover:text-slate-200 px-1.5 py-0.5 rounded bg-slate-800/40 border border-slate-800 transition-colors"
              title="Recolher cards para dar espaço aos gráficos"
            >
              <span>Recolher Cards</span>
              <ChevronUp className="w-3 h-3" />
            </button>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
            {/* Card 1: Patrimônio Final / Saldo */}
            <div className="bg-slate-900/80 px-3 py-2 rounded-xl border border-slate-800 shadow-sm">
              <div className="flex items-center justify-between text-slate-400 text-[10px] uppercase font-bold tracking-wider mb-0.5">
                <span>Patrimônio Atual</span>
                <DollarSign className="w-3.5 h-3.5 text-emerald-400" />
              </div>
              <div className="text-sm sm:text-base font-bold font-mono tabular-nums text-slate-100">
                R$ {extendedStats.finalEquity.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
              </div>
              <div className="flex items-center gap-1 text-[10px] mt-0.5">
                <span
                  className={`font-mono font-bold flex items-center ${
                    isNetPositive ? 'text-emerald-400' : 'text-rose-400'
                  }`}
                >
                  {isNetPositive ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                  {isNetPositive ? '+' : ''}R$ {extendedStats.netPnl.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                </span>
                <span className="text-slate-500">
                  ({isNetPositive ? '+' : ''}{extendedStats.totalReturnPct.toFixed(2)}%)
                </span>
              </div>
            </div>

            {/* Card 2: Fator de Lucro */}
            <div className="bg-slate-900/80 px-3 py-2 rounded-xl border border-slate-800 shadow-sm">
              <div className="flex items-center justify-between text-slate-400 text-[10px] uppercase font-bold tracking-wider mb-0.5">
                <span>Fator de Lucro</span>
                <Award className="w-3.5 h-3.5 text-amber-400" />
              </div>
              <div className="text-sm sm:text-base font-bold font-mono tabular-nums text-slate-100">
                {extendedStats.profitFactor.toFixed(2)}
              </div>
              <div className="text-[10px] text-slate-400 font-mono mt-0.5">
                Payoff: {extendedStats.payoff.toFixed(2)} · {extendedStats.totalTrades} trades
              </div>
            </div>

            {/* Card 3: Taxa de Acerto (Win Rate) */}
            <div className="bg-slate-900/80 px-3 py-2 rounded-xl border border-slate-800 shadow-sm">
              <div className="flex items-center justify-between text-slate-400 text-[10px] uppercase font-bold tracking-wider mb-0.5">
                <span>Taxa de Acerto</span>
                <Target className="w-3.5 h-3.5 text-neutral-400" />
              </div>
              <div className="text-sm sm:text-base font-bold font-mono tabular-nums text-slate-100">
                {extendedStats.winRate.toFixed(1)}%
              </div>
              <div className="text-[10px] text-slate-400 font-mono mt-0.5">
                {extendedStats.winsCount} ganhos · {extendedStats.lossesCount} perdas
              </div>
            </div>

            {/* Card 4: Drawdown Máximo */}
            <div className="bg-slate-900/80 px-3 py-2 rounded-xl border border-slate-800 shadow-sm">
              <div className="flex items-center justify-between text-slate-400 text-[10px] uppercase font-bold tracking-wider mb-0.5">
                <span>Rebaixamento Máx</span>
                <ShieldAlert className="w-3.5 h-3.5 text-rose-400" />
              </div>
              <div className="text-sm sm:text-base font-bold font-mono tabular-nums text-rose-400">
                -R$ {extendedStats.maxDrawdownNominal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
              </div>
              <div className="text-[10px] text-slate-400 font-mono mt-0.5">
                -{extendedStats.maxDrawdownPercent.toFixed(2)}% do topo
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* GRÁFICO PRINCIPAL: CURVA DE PATRIMÔNIO (EQUITY CURVE) */}
      {/* ========================================================================= */}
      <div className="bg-slate-900/70 rounded-xl border border-slate-800 overflow-hidden shadow-xl">
        <div className="flex flex-wrap items-center justify-between px-3 py-2 bg-slate-900 border-b border-slate-800 gap-2">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <h3 className="text-xs font-bold text-slate-100 uppercase tracking-wide">
              {chartMetric === 'TOTAL_EQUITY'
                ? 'Evolução do Patrimônio Total (Capital + Lucro Líquido)'
                : chartMetric === 'NET_PNL'
                ? 'Lucro Líquido Acumulado (R$)'
                : 'Curva de Pontos B3 (pts)'}
            </h3>
            {viewSource === 'MT5_LIVE' && (
              <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-300">
                MT5 REAL
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs font-mono text-slate-400">
            {/* Seletor de métrica */}
            <div className="flex items-center gap-1 bg-slate-950 p-0.5 rounded-lg border border-slate-800">
              <button
                onClick={() => setChartMetric('TOTAL_EQUITY')}
                className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                  chartMetric === 'TOTAL_EQUITY' ? 'bg-slate-800 text-emerald-400' : 'text-slate-400'
                }`}
              >
                Patrimônio
              </button>
              <button
                onClick={() => setChartMetric('NET_PNL')}
                className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                  chartMetric === 'NET_PNL' ? 'bg-slate-800 text-emerald-400' : 'text-slate-400'
                }`}
              >
                Lucro R$
              </button>
            </div>

            <label className="flex items-center gap-1 cursor-pointer text-slate-300 text-[11px] select-none">
              <input
                type="checkbox"
                checked={includeFloating}
                onChange={(e) => setIncludeFloating(e.target.checked)}
                className="rounded border-slate-700 bg-slate-950 text-emerald-500 focus:ring-0 w-3 h-3"
              />
              <span>Flutuante MTM</span>
            </label>

            {/* Alternador de Altura do Gráfico Principal */}
            <button
              onClick={() => setMainChartHeight(mainChartHeight === 'normal' ? 'expanded' : 'normal')}
              className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors"
              title={mainChartHeight === 'normal' ? 'Expandir altura do gráfico (400px)' : 'Reduzir altura do gráfico (250px)'}
            >
              {mainChartHeight === 'expanded' ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
            </button>

            {/* Minimizar/Expandir Gráfico Principal */}
            <button
              onClick={() => setShowMainEquityChart(!showMainEquityChart)}
              className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors"
              title={showMainEquityChart ? 'Recolher gráfico principal' : 'Expandir gráfico principal'}
            >
              {showMainEquityChart ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>

        {showMainEquityChart && (
          <div className="p-2 sm:p-3 pt-4">
            <div className={`w-full transition-all ${mainChartHeight === 'expanded' ? 'h-[400px]' : 'h-[250px]'}`}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={equitySeries} margin={{ top: 8, right: 15, left: 5, bottom: 0 }}>
                  <defs>
                    <linearGradient id="equityViewGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop
                        offset="5%"
                        stopColor={isNetPositive ? '#10b981' : '#f43f5e'}
                        stopOpacity={0.35}
                      />
                      <stop
                        offset="95%"
                        stopColor={isNetPositive ? '#10b981' : '#f43f5e'}
                        stopOpacity={0.0}
                      />
                    </linearGradient>
                  </defs>

                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" opacity={0.6} />

                  <XAxis dataKey="label" stroke="#64748b" fontSize={10} tickLine={false} />
                  <YAxis
                    stroke="#64748b"
                    fontSize={10}
                    domain={['auto', 'auto']}
                    tickFormatter={(val) => `R$ ${(val / 1000).toFixed(0)}k`}
                    tickLine={false}
                  />

                  <Tooltip
                    content={({ active, payload }) => {
                      if (active && payload && payload.length) {
                        const data = payload[0].payload;
                        const isWin = data.pnlTrade > 0;
                        const isLoss = data.pnlTrade < 0;

                        return (
                          <div className="bg-slate-900/95 border border-slate-700 p-2.5 rounded-lg shadow-xl text-xs font-mono space-y-1 z-50 min-w-[200px]">
                            <div className="flex items-center justify-between border-b border-slate-800 pb-1 text-slate-200 font-bold">
                              <span>
                                {data.label} {data.ticket ? `(#${data.ticket})` : ''}
                              </span>
                              <span className="text-[10px] text-slate-400">{data.timeStr}</span>
                            </div>

                            {data.comment && (
                              <div className="text-[10px] text-slate-400 italic">
                                {data.comment}
                              </div>
                            )}

                            {data.index > 0 && (
                              <div className="flex items-center justify-between">
                                <span className="text-slate-400">Resultado:</span>
                                <span
                                  className={`font-bold ${
                                    isWin ? 'text-emerald-400' : isLoss ? 'text-rose-400' : 'text-slate-300'
                                  }`}
                                >
                                  {data.pnlTrade > 0 ? '+' : ''}R$ {data.pnlTrade.toFixed(2)}
                                </span>
                              </div>
                            )}

                            <div className="flex items-center justify-between pt-0.5">
                              <span className="text-slate-400">Patrimônio:</span>
                              <span className="font-bold text-slate-100">
                                R$ {data.totalEquity.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                              </span>
                            </div>

                            <div className="flex items-center justify-between">
                              <span className="text-slate-400">Lucro Acum:</span>
                              <span
                                className={`font-bold ${
                                  data.cumulativePnl >= 0 ? 'text-emerald-400' : 'text-rose-400'
                                }`}
                              >
                                R$ {data.cumulativePnl.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                              </span>
                            </div>

                            <div className="flex items-center justify-between text-[10px] border-t border-slate-800/80 pt-1 text-slate-400">
                              <span>Drawdown:</span>
                              <span className="text-rose-400 font-mono">
                                R$ {data.drawdownNominal.toFixed(2)} ({data.drawdownPct.toFixed(2)}%)
                              </span>
                            </div>
                          </div>
                        );
                      }
                      return null;
                    }}
                  />

                  <ReferenceLine
                    y={chartMetric === 'TOTAL_EQUITY' ? baseCapital : 0}
                    stroke="#475569"
                    strokeDasharray="4 4"
                  />

                  <Area
                    type="monotone"
                    dataKey={chartMetric === 'TOTAL_EQUITY' ? 'totalEquity' : 'cumulativePnl'}
                    stroke={isNetPositive ? '#10b981' : '#f43f5e'}
                    strokeWidth={2}
                    fillOpacity={1}
                    fill="url(#equityViewGradient)"
                  />

                  {chartMetric === 'TOTAL_EQUITY' && equitySeries.length > 2 && (
                    <Line
                      type="stepAfter"
                      dataKey="peakEquity"
                      stroke="#38bdf8"
                      strokeWidth={1.5}
                      strokeDasharray="3 3"
                      dot={false}
                    />
                  )}
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </div>

      {/* ========================================================================= */}
      {/* SEÇÃO DUPLA: GRÁFICO SUBAQUÁTICO DE EXPOSIÇÃO / DRAWDOWN E HISTOGRAMA */}
      {/* ========================================================================= */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {/* Gráfico 2: Underwater Drawdown (Gráfico de Exposição) */}
        {showUnderwaterChart && (
          <div
            className={`bg-slate-900/70 rounded-xl border border-slate-800 overflow-hidden shadow-lg transition-all ${
              underwaterExpanded ? 'col-span-1 lg:col-span-2' : ''
            }`}
          >
            <div className="flex items-center justify-between px-3 py-2 bg-slate-900 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <ShieldAlert className="w-3.5 h-3.5 text-rose-400" />
                <h4 className="text-[11px] font-bold text-slate-200 uppercase tracking-wide">
                  Gráfico Subaquático de Exposição (Underwater / Drawdown)
                </h4>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-[10px] font-mono text-rose-400 font-semibold bg-rose-950/40 px-1.5 py-0.5 rounded border border-rose-900/50">
                  Máx: -{extendedStats.maxDrawdownPercent.toFixed(2)}%
                </span>

                {/* Botão de Destaque / Expandir para Tela Cheia */}
                <button
                  onClick={() => setUnderwaterExpanded(!underwaterExpanded)}
                  className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors"
                  title={underwaterExpanded ? 'Restaurar tamanho normal' : 'Expandir Gráfico de Exposição (Largura Total)'}
                >
                  {underwaterExpanded ? <Minimize2 className="w-3.5 h-3.5 text-emerald-400" /> : <Maximize2 className="w-3.5 h-3.5" />}
                </button>

                {/* Botão de Minimizar */}
                <button
                  onClick={() => setShowUnderwaterChart(false)}
                  className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors"
                  title="Ocultar Gráfico de Exposição"
                >
                  <EyeOff className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            <div className="p-2 sm:p-3">
              <div className={`w-full transition-all ${underwaterExpanded ? 'h-[300px]' : 'h-[210px]'}`}>
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={underwaterSeries} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="drawdownGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#f43f5e" stopOpacity={0.05} />
                        <stop offset="95%" stopColor="#f43f5e" stopOpacity={0.4} />
                      </linearGradient>
                    </defs>

                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" opacity={0.5} />
                    <XAxis dataKey="label" stroke="#64748b" fontSize={9} tickLine={false} />
                    <YAxis
                      stroke="#64748b"
                      fontSize={9}
                      domain={['dataMin - 1', 0]}
                      tickFormatter={(val) => `${val.toFixed(1)}%`}
                      tickLine={false}
                    />
                    <Tooltip
                      content={({ active, payload }) => {
                        if (active && payload && payload.length) {
                          const d = payload[0].payload;
                          return (
                            <div className="bg-slate-900 border border-slate-700 p-2 rounded text-xs font-mono text-slate-200">
                              <div>{d.label} ({d.timeStr})</div>
                              <div className="text-rose-400 font-bold mt-0.5">
                                Drawdown: {d.drawdownPct.toFixed(2)}% (R$ {Math.abs(d.drawdownNominal).toFixed(2)})
                              </div>
                            </div>
                          );
                        }
                        return null;
                      }}
                    />
                    <ReferenceLine y={0} stroke="#475569" />
                    <Area
                      type="monotone"
                      dataKey="drawdownPct"
                      stroke="#f43f5e"
                      strokeWidth={1.8}
                      fill="url(#drawdownGradient)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        )}

        {/* Gráfico 3: Histograma de Resultados */}
        {showHistogramChart && (
          <div
            className={`bg-slate-900/70 rounded-xl border border-slate-800 overflow-hidden shadow-lg transition-all ${
              histogramExpanded ? 'col-span-1 lg:col-span-2' : ''
            }`}
          >
            <div className="flex items-center justify-between px-3 py-2 bg-slate-900 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <Layers className="w-3.5 h-3.5 text-neutral-400" />
                <h4 className="text-[11px] font-bold text-slate-200 uppercase tracking-wide">
                  Resultado por Operação (R$)
                </h4>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-[10px] font-mono text-slate-400">
                  {tradeDistribution.length} trades
                </span>

                {/* Botão de Destaque / Expandir */}
                <button
                  onClick={() => setHistogramExpanded(!histogramExpanded)}
                  className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors"
                  title={histogramExpanded ? 'Restaurar tamanho normal' : 'Expandir Histograma (Largura Total)'}
                >
                  {histogramExpanded ? <Minimize2 className="w-3.5 h-3.5 text-emerald-400" /> : <Maximize2 className="w-3.5 h-3.5" />}
                </button>

                {/* Botão de Minimizar */}
                <button
                  onClick={() => setShowHistogramChart(false)}
                  className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors"
                  title="Ocultar Histograma"
                >
                  <EyeOff className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            <div className="p-2 sm:p-3">
              <div className={`w-full transition-all ${histogramExpanded ? 'h-[300px]' : 'h-[210px]'}`}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={tradeDistribution} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" opacity={0.5} />
                    <XAxis dataKey="tradeNum" stroke="#64748b" fontSize={9} tickLine={false} />
                    <YAxis
                      stroke="#64748b"
                      fontSize={9}
                      tickFormatter={(val) => `R$ ${val}`}
                      tickLine={false}
                    />
                    <Tooltip
                      content={({ active, payload }) => {
                        if (active && payload && payload.length) {
                          const d = payload[0].payload;
                          return (
                            <div className="bg-slate-900 border border-slate-700 p-2 rounded text-xs font-mono text-slate-200">
                              <div>{d.tradeNum} ({d.timeStr})</div>
                              <div className={`font-bold mt-0.5 ${d.pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                {d.pnl > 0 ? '+' : ''}R$ {d.pnl.toFixed(2)}
                              </div>
                            </div>
                          );
                        }
                        return null;
                      }}
                    />
                    <ReferenceLine y={0} stroke="#475569" />
                    <Bar
                      dataKey="pnl"
                      fill="#10b981"
                      shape={(props: any) => {
                        const { x, y, width, height, value } = props;
                        const fill = value >= 0 ? '#10b981' : '#f43f5e';
                        return <rect x={x} y={y} width={width} height={height} fill={fill} rx={2} />;
                      }}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Tira restauradora quando um dos subgráficos estiver oculto */}
      {(!showUnderwaterChart || !showHistogramChart) && (
        <div className="flex items-center gap-2 text-xs font-mono bg-slate-900/60 p-2 rounded-lg border border-slate-800">
          <span className="text-slate-400">Gráficos Ocultos:</span>
          {!showUnderwaterChart && (
            <button
              onClick={() => setShowUnderwaterChart(true)}
              className="px-2 py-0.5 rounded bg-rose-950/40 text-rose-300 border border-rose-800/60 text-[11px] hover:bg-rose-900/50 flex items-center gap-1"
            >
              <Eye className="w-3 h-3" />
              <span>Restaurar Gráfico de Exposição</span>
            </button>
          )}
          {!showHistogramChart && (
            <button
              onClick={() => setShowHistogramChart(true)}
              className="px-2 py-0.5 rounded bg-blue-950/40 text-blue-300 border border-blue-800/60 text-[11px] hover:bg-blue-900/50 flex items-center gap-1"
            >
              <Eye className="w-3 h-3" />
              <span>Restaurar Histograma</span>
            </button>
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* DETALHES DE PERFORMANCE QUANTITATIVA (COLAPSÁVEL) */}
      {/* ========================================================================= */}
      <div className="bg-slate-900/60 rounded-xl border border-slate-800 p-2.5 shadow-md">
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-[11px] font-bold text-slate-200 flex items-center gap-1.5 uppercase tracking-wide">
            <Info className="w-3.5 h-3.5 text-emerald-400" />
            <span>Matriz de Risco & Consistência {viewSource === 'MT5_LIVE' ? '· MT5 Real' : '· Simulação 10R'}</span>
          </h4>

          <button
            onClick={() => setShowRiskMatrix(!showRiskMatrix)}
            className="flex items-center gap-1 text-[10px] text-slate-400 hover:text-slate-200 px-1.5 py-0.5 rounded bg-slate-800/50 border border-slate-800 transition-colors"
          >
            <span>{showRiskMatrix ? 'Recolher' : 'Expandir'}</span>
            {showRiskMatrix ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>
        </div>

        {showRiskMatrix && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs font-mono">
            <div className="bg-slate-950/70 p-2 rounded-lg border border-slate-800/80">
              <span className="text-slate-500 text-[10px] block leading-tight">Maior Ganho</span>
              <span className="font-bold text-emerald-400 text-xs">
                +R$ {extendedStats.largestWin.toFixed(2)}
              </span>
            </div>

            <div className="bg-slate-950/70 p-2 rounded-lg border border-slate-800/80">
              <span className="text-slate-500 text-[10px] block leading-tight">Maior Perda</span>
              <span className="font-bold text-rose-400 text-xs">
                -R$ {extendedStats.largestLoss.toFixed(2)}
              </span>
            </div>

            <div className="bg-slate-950/70 p-2 rounded-lg border border-slate-800/80">
              <span className="text-slate-500 text-[10px] block leading-tight">Média Ganho / Perda</span>
              <span className="font-bold text-slate-200 text-xs">
                +R$ {extendedStats.avgWin.toFixed(0)} / -R$ {extendedStats.avgLoss.toFixed(0)}
              </span>
            </div>

            <div className="bg-slate-950/70 p-2 rounded-lg border border-slate-800/80">
              <span className="text-slate-500 text-[10px] block leading-tight">Sequência Máxima</span>
              <span className="font-bold text-neutral-400 text-xs">
                {extendedStats.maxConsecWins} G · {extendedStats.maxConsecLoss} P
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
