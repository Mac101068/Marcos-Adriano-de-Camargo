import React, { useState, useMemo } from 'react';
import { TradeOrder, TerminalStats } from '../types/trading';
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
  ComposedChart,
} from 'recharts';

interface EquityCurveViewProps {
  orders: TradeOrder[];
  stats: TerminalStats;
  currentPrice: number;
}

export const EquityCurveView: React.FC<EquityCurveViewProps> = ({
  orders,
  stats,
  currentPrice,
}) => {
  // Configuração de Capital Inicial
  const [initialCapital, setInitialCapital] = useState<number>(5000); // R$ 5.000 padrão Mini-Índice
  const [chartMetric, setChartMetric] = useState<'TOTAL_EQUITY' | 'NET_PNL' | 'POINTS'>('TOTAL_EQUITY');
  const [includeFloating, setIncludeFloating] = useState<boolean>(true);
  const [tradeFilter, setTradeFilter] = useState<'ALL' | 'WINNERS' | 'LOSERS'>('ALL');

  // Calcula o PnL flutuante das ordens abertas em tempo real
  const floatingPnL = useMemo(() => {
    return orders
      .filter((o) => o.status === 'OPEN')
      .reduce((acc, o) => {
        const activeCtros = o.remainingContracts || o.contracts;
        const pts = o.type === 'BUY' ? currentPrice - o.entryPrice : o.entryPrice - currentPrice;
        const fin = pts * 0.2 * activeCtros + (o.partialFinancial || 0);
        return acc + fin;
      }, 0);
  }, [orders, currentPrice]);

  const floatingPoints = useMemo(() => {
    return orders
      .filter((o) => o.status === 'OPEN')
      .reduce((acc, o) => {
        const pts = o.type === 'BUY' ? currentPrice - o.entryPrice : o.entryPrice - currentPrice;
        return acc + pts;
      }, 0);
  }, [orders, currentPrice]);

  // Construção detalhada ponto a ponto da Curva de Patrimônio
  const { equitySeries, underwaterSeries, tradeDistribution, extendedStats } = useMemo(() => {
    // Ordena do mais antigo para o mais recente
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

    // Ponto 0: Início
    const eqPoints = [
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

    const uwPoints = [
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

      const ddNominal = peakEquity - currentTotEquity; // positivo para quantificar a queda
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

    // Ponto adicional em tempo real se houver trade aberto
    if (includeFloating && orders.some((o) => o.status === 'OPEN')) {
      const livePnl = runningPnl + floatingPnL;
      const livePts = runningPoints + floatingPoints;
      const liveTotEquity = initialCapital + livePnl;
      const livePeak = Math.max(peakEquity, liveTotEquity);
      const liveDdNominal = livePeak - liveTotEquity;
      const liveDdPct = livePeak > 0 ? (liveDdNominal / livePeak) * 100 : 0;

      eqPoints.push({
        index: eqPoints.length,
        label: 'MTM (Ao Vivo)',
        timeStr: 'Agora',
        pnlTrade: floatingPnL,
        pointsTrade: floatingPoints,
        cumulativePnl: livePnl,
        cumulativePoints: livePts,
        totalEquity: liveTotEquity,
        peakEquity: livePeak,
        drawdownNominal: -liveDdNominal,
        drawdownPct: -liveDdPct,
        type: 'MTM',
        status: floatingPnL >= 0 ? 'LUCRO' : 'PREJUÍZO',
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
  }, [orders, initialCapital, includeFloating, floatingPnL, floatingPoints]);

  // Exportar dados da Curva para CSV
  const handleExportCSV = () => {
    const headers = 'Trade,Horário,Lado,Resultado_Trade_RS,Pontos,Patrimonio_Acumulado_RS,Pontos_Acumulados,Drawdown_Nominal_RS,Drawdown_Pct\n';
    const rows = equitySeries
      .slice(1) // ignora ponto 0 inicial
      .map(
        (p) =>
          `"${p.label}","${p.timeStr}","${p.type}",${p.pnlTrade.toFixed(2)},${p.pointsTrade},${p.totalEquity.toFixed(
            2
          )},${p.cumulativePoints},${p.drawdownNominal.toFixed(2)},${p.drawdownPct.toFixed(2)}`
      )
      .join('\n');

    const blob = new Blob([headers + rows], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `curva_patrimonio_renko10r_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const isNetPositive = extendedStats.netPnl >= 0;

  return (
    <div className="flex flex-col h-full bg-slate-950 border border-slate-800/80 rounded-lg p-3 sm:p-5 overflow-y-auto space-y-5">
      {/* ========================================================================= */}
      {/* CABEÇALHO & BARRA DE CONTROLE DA CURVA DE PATRIMÔNIO */}
      {/* ========================================================================= */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-slate-900/90 border border-slate-800 p-4 rounded-xl shadow-lg">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shrink-0 shadow-inner">
            <LineChartIcon className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm sm:text-base font-bold text-slate-100 tracking-tight">
                Curva de Patrimônio Acumulado (Equity Curve)
              </h2>
              <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                10R Quant
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              Rastreamento trade-a-trade com High-Water Mark e Rebaixamento de Capital (Drawdown)
            </p>
          </div>
        </div>

        {/* Controles de Capital Inicial e Métrica */}
        <div className="flex flex-wrap items-center gap-3 text-xs font-mono">
          {/* Seletor de Capital Inicial */}
          <div className="flex items-center gap-1.5 bg-slate-950 px-2.5 py-1.5 rounded-lg border border-slate-800">
            <span className="text-slate-400 text-[11px]">Capital Inicial:</span>
            <select
              value={initialCapital}
              onChange={(e) => setInitialCapital(Number(e.target.value))}
              aria-label="Capital inicial para simulação da curva de patrimônio"
              className="bg-transparent text-emerald-400 font-bold focus:outline-none cursor-pointer"
            >
              <option value={2000} className="bg-slate-900 text-slate-200">R$ 2.000 (1 ctro)</option>
              <option value={5000} className="bg-slate-900 text-slate-200">R$ 5.000 (Padrão 2 ctros)</option>
              <option value={10000} className="bg-slate-900 text-slate-200">R$ 10.000 (Conservador)</option>
              <option value={25000} className="bg-slate-900 text-slate-200">R$ 25.000 (Institucional)</option>
            </select>
          </div>

          {/* Alternador de Métrica do Gráfico */}
          <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800">
            <button
              onClick={() => setChartMetric('TOTAL_EQUITY')}
              className={`px-2.5 py-1 rounded text-xs transition-colors cursor-pointer ${
                chartMetric === 'TOTAL_EQUITY'
                  ? 'bg-emerald-500/20 text-emerald-300 font-bold border border-emerald-500/30'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Patrimônio Total
            </button>
            <button
              onClick={() => setChartMetric('NET_PNL')}
              className={`px-2.5 py-1 rounded text-xs transition-colors cursor-pointer ${
                chartMetric === 'NET_PNL'
                  ? 'bg-emerald-500/20 text-emerald-300 font-bold border border-emerald-500/30'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Lucro Líquido
            </button>
            <button
              onClick={() => setChartMetric('POINTS')}
              className={`px-2.5 py-1 rounded text-xs transition-colors cursor-pointer ${
                chartMetric === 'POINTS'
                  ? 'bg-emerald-500/20 text-emerald-300 font-bold border border-emerald-500/30'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Pontos (pts)
            </button>
          </div>

          {/* Botão de Exportação CSV */}
          <button
            onClick={handleExportCSV}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-sans transition-colors cursor-pointer border border-slate-700"
          >
            <Download className="w-3.5 h-3.5 text-slate-400" />
            <span className="hidden sm:inline">Exportar CSV</span>
          </button>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* GRADE DE KPIS INSTITUCIONAIS QUANTITATIVOS */}
      {/* ========================================================================= */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {/* Patrimônio Atual */}
        <div className="bg-slate-900/80 p-3.5 rounded-xl border border-slate-800">
          <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
            <span>Patrimônio Atual</span>
            <DollarSign className="w-3.5 h-3.5 text-emerald-400" />
          </div>
          <div className="text-lg font-bold font-mono tabular-nums text-slate-100">
            R$ {extendedStats.finalEquity.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
          </div>
          <div className="flex items-center gap-1 text-[11px] font-mono mt-0.5">
            <span className={extendedStats.totalReturnPct >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
              {extendedStats.totalReturnPct >= 0 ? '+' : ''}
              {extendedStats.totalReturnPct.toFixed(2)}%
            </span>
            <span className="text-slate-500">s/ capital</span>
          </div>
        </div>

        {/* Lucro Líquido Acumulado */}
        <div className="bg-slate-900/80 p-3.5 rounded-xl border border-slate-800">
          <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
            <span>Lucro Líquido</span>
            {extendedStats.netPnl >= 0 ? (
              <ArrowUpRight className="w-3.5 h-3.5 text-emerald-400" />
            ) : (
              <ArrowDownRight className="w-3.5 h-3.5 text-rose-400" />
            )}
          </div>
          <div
            className={`text-lg font-bold font-mono tabular-nums ${
              extendedStats.netPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'
            }`}
          >
            R$ {extendedStats.netPnl.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
          </div>
          <div className="text-[11px] text-slate-400 font-mono mt-0.5">
            {extendedStats.totalPoints > 0 ? '+' : ''}
            {extendedStats.totalPoints} pts acumulados
          </div>
        </div>

        {/* Fator de Lucro (Profit Factor) */}
        <div className="bg-slate-900/80 p-3.5 rounded-xl border border-slate-800">
          <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
            <span>Fator de Lucro</span>
            <Award className="w-3.5 h-3.5 text-amber-400" />
          </div>
          <div className="text-lg font-bold font-mono tabular-nums text-slate-100">
            {extendedStats.profitFactor.toFixed(2)}
          </div>
          <div className="text-[11px] text-slate-500 font-mono mt-0.5">
            Payoff: {extendedStats.payoff.toFixed(2)}
          </div>
        </div>

        {/* Taxa de Acerto (Win Rate) */}
        <div className="bg-slate-900/80 p-3.5 rounded-xl border border-slate-800">
          <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
            <span>Taxa de Acerto</span>
            <Target className="w-3.5 h-3.5 text-sky-400" />
          </div>
          <div className="text-lg font-bold font-mono tabular-nums text-slate-100">
            {extendedStats.winRate.toFixed(1)}%
          </div>
          <div className="text-[11px] text-slate-500 font-mono mt-0.5">
            {extendedStats.winsCount}W · {extendedStats.lossesCount}L
          </div>
        </div>

        {/* Drawdown Máximo */}
        <div className="bg-slate-900/80 p-3.5 rounded-xl border border-slate-800">
          <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
            <span>Drawdown Máx</span>
            <ShieldAlert className="w-3.5 h-3.5 text-rose-400" />
          </div>
          <div className="text-lg font-bold font-mono tabular-nums text-rose-400">
            -R$ {extendedStats.maxDrawdownNominal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
          </div>
          <div className="text-[11px] text-slate-500 font-mono mt-0.5">
            -{extendedStats.maxDrawdownPercent.toFixed(2)}% do topo
          </div>
        </div>

        {/* Fator de Recuperação */}
        <div className="bg-slate-900/80 p-3.5 rounded-xl border border-slate-800">
          <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
            <span>Recuperação</span>
            <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
          </div>
          <div className="text-lg font-bold font-mono tabular-nums text-slate-100">
            {extendedStats.recoveryFactor.toFixed(2)}
          </div>
          <div className="text-[11px] text-slate-500 font-mono mt-0.5">
            Expectativa: R$ {extendedStats.expectancy.toFixed(2)}
          </div>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* GRÁFICO PRINCIPAL 1: CURVA DE PATRIMÔNIO (EQUITY CURVE COM HIGH-WATER MARK) */}
      {/* ========================================================================= */}
      <div className="bg-slate-900/70 rounded-xl border border-slate-800 overflow-hidden shadow-xl">
        <div className="flex flex-wrap items-center justify-between px-4 py-3 bg-slate-900 border-b border-slate-800 gap-3">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
            <h3 className="text-xs font-bold text-slate-100">
              {chartMetric === 'TOTAL_EQUITY'
                ? 'Evolução do Patrimônio Total (Capital + Resultado Líquido)'
                : chartMetric === 'NET_PNL'
                ? 'Lucro Líquido Acumulado (R$)'
                : 'Curva de Pontos B3 (pts)'}
            </h3>
          </div>

          <div className="flex items-center gap-4 text-xs font-mono text-slate-400">
            <div className="flex items-center gap-1.5">
              <span className="w-3 h-0.5 bg-emerald-400 inline-block" />
              <span>Patrimônio</span>
            </div>
            {chartMetric === 'TOTAL_EQUITY' && (
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-0.5 bg-sky-400 border-dashed inline-block" />
                <span>High-Water Mark (Pico)</span>
              </div>
            )}
            <label className="flex items-center gap-1.5 cursor-pointer text-slate-300 select-none">
              <input
                type="checkbox"
                checked={includeFloating}
                onChange={(e) => setIncludeFloating(e.target.checked)}
                className="rounded border-slate-700 bg-slate-950 text-emerald-500 focus:ring-0"
              />
              <span>Incluir MTM ao vivo</span>
            </label>
          </div>
        </div>

        <div className="p-4 pt-6">
          <div className="h-[290px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={equitySeries} margin={{ top: 10, right: 25, left: 10, bottom: 0 }}>
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

                <XAxis
                  dataKey="label"
                  stroke="#64748b"
                  fontSize={11}
                  tickLine={false}
                  axisLine={{ stroke: '#334155' }}
                />

                <YAxis
                  stroke="#64748b"
                  fontSize={11}
                  tickLine={false}
                  axisLine={{ stroke: '#334155' }}
                  tickFormatter={(val) => {
                    if (chartMetric === 'POINTS') return `${val > 0 ? '+' : ''}${val}`;
                    return `R$ ${val >= 1000 ? `${(val / 1000).toFixed(1)}k` : val}`;
                  }}
                />

                <Tooltip
                  content={({ active, payload }) => {
                    if (active && payload && payload.length) {
                      const data = payload[0].payload;
                      const isWin = data.pnlTrade > 0;
                      const isLoss = data.pnlTrade < 0;

                      return (
                        <div className="bg-slate-900/95 border border-slate-700 p-3 rounded-lg shadow-2xl text-xs font-mono space-y-1.5 min-w-[230px] backdrop-blur-md">
                          <div className="flex items-center justify-between border-b border-slate-800 pb-1 font-bold text-slate-200">
                            <span>
                              {data.index === 0
                                ? 'Ponto Inicial'
                                : data.isLiveFloating
                                ? 'Mark-to-Market (Ao Vivo)'
                                : `Operação #${data.index}`}
                            </span>
                            <span className="text-[11px] text-slate-400">{data.timeStr}</span>
                          </div>

                          {data.index > 0 && (
                            <div className="flex items-center justify-between">
                              <span className="text-slate-400">Resultado Trade:</span>
                              <span
                                className={`font-bold ${
                                  isWin ? 'text-emerald-400' : isLoss ? 'text-rose-400' : 'text-slate-300'
                                }`}
                              >
                                {data.pnlTrade > 0 ? '+' : ''}
                                R$ {data.pnlTrade.toFixed(2)} ({data.pointsTrade > 0 ? '+' : ''}
                                {data.pointsTrade} pts)
                              </span>
                            </div>
                          )}

                          <div className="flex items-center justify-between pt-0.5">
                            <span className="text-slate-400">Patrimônio Total:</span>
                            <span className="font-bold text-slate-100">
                              R$ {data.totalEquity.toFixed(2)}
                            </span>
                          </div>

                          <div className="flex items-center justify-between">
                            <span className="text-slate-400">Lucro Acumulado:</span>
                            <span
                              className={`font-bold ${
                                data.cumulativePnl >= 0 ? 'text-emerald-400' : 'text-rose-400'
                              }`}
                            >
                              R$ {data.cumulativePnl.toFixed(2)}
                            </span>
                          </div>

                          <div className="flex items-center justify-between">
                            <span className="text-slate-400">Pontos B3:</span>
                            <span className="text-sky-400 font-semibold">
                              {data.cumulativePoints > 0 ? '+' : ''}
                              {data.cumulativePoints} pts
                            </span>
                          </div>

                          <div className="flex items-center justify-between text-[11px] border-t border-slate-800/80 pt-1 text-slate-400">
                            <span>Drawdown Atual:</span>
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

                {/* Linha de Referência (Capital Inicial se Total, ou Zero se PnL) */}
                <ReferenceLine
                  y={chartMetric === 'TOTAL_EQUITY' ? initialCapital : 0}
                  stroke="#475569"
                  strokeDasharray="4 4"
                />

                {/* Área da Curva de Patrimônio */}
                <Area
                  type="monotone"
                  dataKey={
                    chartMetric === 'TOTAL_EQUITY'
                      ? 'totalEquity'
                      : chartMetric === 'NET_PNL'
                      ? 'cumulativePnl'
                      : 'cumulativePoints'
                  }
                  stroke={isNetPositive ? '#10b981' : '#f43f5e'}
                  strokeWidth={2.5}
                  fillOpacity={1}
                  fill="url(#equityViewGradient)"
                />

                {/* High-Water Mark (Linha de Topo Histórico) */}
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
      </div>

      {/* ========================================================================= */}
      {/* SEÇÃO DUPLA: UNDERWATER DRAWDOWN (%) E HISTOGRAMA DE TRADES */}
      {/* ========================================================================= */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Gráfico 2: Underwater Drawdown (% de Queda Subaquática) */}
        <div className="bg-slate-900/70 rounded-xl border border-slate-800 overflow-hidden shadow-lg">
          <div className="flex items-center justify-between px-4 py-2.5 bg-slate-900 border-b border-slate-800">
            <div className="flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-rose-400" />
              <h4 className="text-xs font-bold text-slate-200">
                Gráfico Subaquático de Drawdown (Underwater Chart)
              </h4>
            </div>
            <span className="text-[11px] font-mono text-rose-400 font-semibold">
              Máx: -{extendedStats.maxDrawdownPercent.toFixed(2)}%
            </span>
          </div>

          <div className="p-3">
            <div className="h-[170px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={underwaterSeries} margin={{ top: 5, right: 15, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="drawdownGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#f43f5e" stopOpacity={0.05} />
                      <stop offset="95%" stopColor="#f43f5e" stopOpacity={0.4} />
                    </linearGradient>
                  </defs>

                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" opacity={0.5} />
                  <XAxis dataKey="label" stroke="#64748b" fontSize={10} tickLine={false} />
                  <YAxis
                    stroke="#64748b"
                    fontSize={10}
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

        {/* Gráfico 3: Distribuição de Resultado por Operação (Histograma de Ganhos/Perdas) */}
        <div className="bg-slate-900/70 rounded-xl border border-slate-800 overflow-hidden shadow-lg">
          <div className="flex items-center justify-between px-4 py-2.5 bg-slate-900 border-b border-slate-800">
            <div className="flex items-center gap-2">
              <Layers className="w-4 h-4 text-sky-400" />
              <h4 className="text-xs font-bold text-slate-200">
                Resultado Nominal por Operação (R$)
              </h4>
            </div>
            <span className="text-[11px] font-mono text-slate-400">
              {tradeDistribution.length} trades
            </span>
          </div>

          <div className="p-3">
            <div className="h-[170px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={tradeDistribution} margin={{ top: 5, right: 15, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" opacity={0.5} />
                  <XAxis dataKey="tradeNum" stroke="#64748b" fontSize={10} tickLine={false} />
                  <YAxis
                    stroke="#64748b"
                    fontSize={10}
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
                              {d.pnl > 0 ? '+' : ''}R$ {d.pnl.toFixed(2)} ({d.points > 0 ? '+' : ''}{d.points} pts)
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
      </div>

      {/* ========================================================================= */}
      {/* DETALHES DE PERFORMANCE QUANTITATIVA (ESTATÍSTICAS DA ESTRATÉGIA) */}
      {/* ========================================================================= */}
      <div className="bg-slate-900/50 rounded-xl border border-slate-800 p-4">
        <h4 className="text-xs font-bold text-slate-200 mb-3 flex items-center gap-2">
          <Info className="w-4 h-4 text-emerald-400" />
          <span>Matriz de Risco e Consistência da Estratégia 10R</span>
        </h4>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs font-mono">
          <div className="bg-slate-950/70 p-3 rounded-lg border border-slate-800/80">
            <span className="text-slate-500 text-[11px] block">Maior Ganho Unitário</span>
            <span className="font-bold text-emerald-400 text-sm">
              +R$ {extendedStats.largestWin.toFixed(2)}
            </span>
          </div>

          <div className="bg-slate-950/70 p-3 rounded-lg border border-slate-800/80">
            <span className="text-slate-500 text-[11px] block">Maior Perda Unitária</span>
            <span className="font-bold text-rose-400 text-sm">
              -R$ {extendedStats.largestLoss.toFixed(2)}
            </span>
          </div>

          <div className="bg-slate-950/70 p-3 rounded-lg border border-slate-800/80">
            <span className="text-slate-500 text-[11px] block">Média Ganho / Perda</span>
            <span className="font-bold text-slate-200 text-sm">
              +R$ {extendedStats.avgWin.toFixed(0)} / -R$ {extendedStats.avgLoss.toFixed(0)}
            </span>
          </div>

          <div className="bg-slate-950/70 p-3 rounded-lg border border-slate-800/80">
            <span className="text-slate-500 text-[11px] block">Sequência Máxima</span>
            <span className="font-bold text-sky-400 text-sm">
              {extendedStats.maxConsecWins} Ganhos · {extendedStats.maxConsecLoss} Perdas
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
