import React, { useState, useMemo } from 'react';
import { TradeOrder, TerminalStats } from '../types/trading';
import {
  CheckCircle2,
  TrendingUp,
  TrendingDown,
  DollarSign,
  Target,
  Award,
  ShieldAlert,
  LineChart as LineChartIcon,
  Maximize2,
  Percent,
} from 'lucide-react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceLine,
} from 'recharts';

interface OrdersAndStatsProps {
  orders: TradeOrder[];
  stats: TerminalStats;
  currentPrice: number;
  onNavigateToAudit?: () => void;
}

export const OrdersAndStats: React.FC<OrdersAndStatsProps> = ({ orders, stats, currentPrice, onNavigateToAudit }) => {
  const [chartMetric, setChartMetric] = useState<'FINANCIAL' | 'POINTS'>('FINANCIAL');

  // Prepara os dados cronológicos da Curva de Patrimônio (Equity Curve)
  const equityData = useMemo(() => {
    // Ordena do mais antigo para o mais recente para construir a série temporal
    const closedTrades = orders
      .filter((o) => o.status !== 'OPEN')
      .slice()
      .reverse();

    if (closedTrades.length === 0) {
      return [
        {
          index: 0,
          label: 'Início',
          timeStr: '09:00:00',
          pnlTrade: 0,
          pointsTrade: 0,
          cumulativeEquity: 0,
          cumulativePoints: 0,
          peakEquity: 0,
          drawdown: 0,
          type: 'START',
          status: 'START',
        },
      ];
    }

    let runningEquity = 0;
    let runningPoints = 0;
    let peakEquity = 0;

    const points = [
      {
        index: 0,
        label: 'Início',
        timeStr: closedTrades[0]?.timeStr || '09:00:00',
        pnlTrade: 0,
        pointsTrade: 0,
        cumulativeEquity: 0,
        cumulativePoints: 0,
        peakEquity: 0,
        drawdown: 0,
        type: 'START',
        status: 'START',
      },
    ];

    closedTrades.forEach((trade, idx) => {
      const pnl = trade.financialResult || 0;
      const pts = trade.pointsResult || 0;
      runningEquity += pnl;
      runningPoints += pts;

      if (runningEquity > peakEquity) {
        peakEquity = runningEquity;
      }
      const dd = runningEquity - peakEquity; // valor negativo ou zero

      points.push({
        index: idx + 1,
        label: `T${idx + 1}`,
        timeStr: trade.timeStr,
        pnlTrade: pnl,
        pointsTrade: pts,
        cumulativeEquity: runningEquity,
        cumulativePoints: runningPoints,
        peakEquity: peakEquity,
        drawdown: dd,
        type: trade.type,
        status: pnl >= 0 ? 'LUCRO' : 'PREJUÍZO',
      });
    });

    return points;
  }, [orders]);

  // Estatísticas avançadas de risco da Equity Curve
  const equityStats = useMemo(() => {
    const closed = orders.filter((o) => o.status !== 'OPEN');
    if (closed.length === 0) {
      return {
        peakEquity: 0,
        maxDrawdownVal: 0,
        avgTrade: 0,
        recoveryFactor: 0,
        consecutiveWins: 0,
        consecutiveLosses: 0,
      };
    }

    let peak = 0;
    let maxDd = 0;
    let currentEq = 0;
    let maxConsecWins = 0;
    let curConsecWins = 0;
    let maxConsecLoss = 0;
    let curConsecLoss = 0;

    // Do mais antigo para o mais novo
    closed.slice().reverse().forEach((t) => {
      const pnl = t.financialResult || 0;
      currentEq += pnl;
      if (currentEq > peak) peak = currentEq;
      const dd = peak - currentEq;
      if (dd > maxDd) maxDd = dd;

      if (pnl > 0) {
        curConsecWins++;
        curConsecLoss = 0;
        if (curConsecWins > maxConsecWins) maxConsecWins = curConsecWins;
      } else if (pnl < 0) {
        curConsecLoss++;
        curConsecWins = 0;
        if (curConsecLoss > maxConsecLoss) maxConsecLoss = curConsecLoss;
      }
    });

    const avgTrade = closed.length > 0 ? stats.netFinancial / closed.length : 0;
    const recoveryFactor = maxDd > 0 ? stats.netFinancial / maxDd : stats.netFinancial > 0 ? 99 : 0;

    return {
      peakEquity: peak,
      maxDrawdownVal: maxDd,
      avgTrade,
      recoveryFactor,
      consecutiveWins: maxConsecWins,
      consecutiveLosses: maxConsecLoss,
    };
  }, [orders, stats.netFinancial]);

  // Se o patrimônio atual for positivo ou negativo para cor do gradiente
  const isNetPositive = stats.netFinancial >= 0;

  return (
    <div className="flex flex-col h-full bg-slate-950 border border-slate-800/80 rounded-lg p-5 overflow-y-auto space-y-6">
      {/* Grade de KPIs Quantitativos */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {/* Resultado Financeiro */}
        <div className="bg-slate-900/80 p-3.5 rounded-lg border border-slate-800">
          <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
            <span>Resultado Líquido</span>
            <DollarSign className="w-3.5 h-3.5 text-emerald-400" />
          </div>
          <div
            className={`text-lg font-bold font-mono tabular-nums ${
              stats.netFinancial >= 0 ? 'text-emerald-400' : 'text-rose-400'
            }`}
          >
            R$ {stats.netFinancial.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
          </div>
          <div className="text-[11px] text-slate-500 font-mono mt-0.5">
            {stats.totalPoints > 0 ? '+' : ''}
            {stats.totalPoints} pontos
          </div>
        </div>

        {/* Taxa de Acerto (Win Rate) */}
        <div className="bg-slate-900/80 p-3.5 rounded-lg border border-slate-800">
          <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
            <span>Taxa de Acerto</span>
            <Target className="w-3.5 h-3.5 text-sky-400" />
          </div>
          <div className="text-lg font-bold font-mono tabular-nums text-slate-100">
            {stats.winRate.toFixed(1)}%
          </div>
          <div className="text-[11px] text-slate-500 font-mono mt-0.5">
            {stats.winningTrades}W · {stats.losingTrades}L
          </div>
        </div>

        {/* Fator de Lucro */}
        <div className="bg-slate-900/80 p-3.5 rounded-lg border border-slate-800">
          <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
            <span>Fator de Lucro</span>
            <Award className="w-3.5 h-3.5 text-amber-400" />
          </div>
          <div className="text-lg font-bold font-mono tabular-nums text-slate-100">
            {stats.profitFactor.toFixed(2)}
          </div>
          <div className="text-[11px] text-slate-500 font-mono mt-0.5">
            {stats.totalTrades} operações
          </div>
        </div>

        {/* Convergências Identificadas */}
        <div className="bg-slate-900/80 p-3.5 rounded-lg border border-slate-800">
          <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
            <span>Convergências</span>
            <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
          </div>
          <div className="text-lg font-bold font-mono tabular-nums text-slate-100">
            {stats.convergencesDetected}
          </div>
          <div className="text-[11px] text-slate-500 font-mono mt-0.5">
            Preço 10R + Fluxo MT5
          </div>
        </div>

        {/* Trades Vencedores */}
        <div className="bg-slate-900/80 p-3.5 rounded-lg border border-slate-800">
          <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
            <span>Ganhos</span>
            <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
          </div>
          <div className="text-lg font-bold font-mono tabular-nums text-emerald-400">
            {stats.winningTrades}
          </div>
          <div className="text-[11px] text-slate-500 font-mono mt-0.5">
            Take Profits acionados
          </div>
        </div>

        {/* Trades Perdedores */}
        <div className="bg-slate-900/80 p-3.5 rounded-lg border border-slate-800">
          <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
            <span>Perdas</span>
            <ShieldAlert className="w-3.5 h-3.5 text-rose-400" />
          </div>
          <div className="text-lg font-bold font-mono tabular-nums text-rose-400">
            {stats.losingTrades}
          </div>
          <div className="text-[11px] text-slate-500 font-mono mt-0.5">
            Stop Losses protegidos
          </div>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* SEÇÃO: GRÁFICO DE CURVA DE PATRIMÔNIO (EQUITY CURVE) COM RECHARTS */}
      {/* ========================================================================= */}
      <div className="bg-slate-900/60 rounded-lg border border-slate-800 overflow-hidden">
        {/* Cabeçalho do Gráfico com Controles */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 bg-slate-900 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <LineChartIcon className="w-4 h-4 text-emerald-400" />
            <div>
              <h3 className="text-xs font-bold text-slate-100">
                Curva de Patrimônio Acumulado (Equity Curve)
              </h3>
              <p className="text-[11px] text-slate-400">
                Evolução do saldo financeiro trade-a-trade disparado por convergência de fluxo 10R
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-md border border-slate-800 text-xs font-mono">
              <button
                onClick={() => setChartMetric('FINANCIAL')}
                className={`px-2.5 py-1 rounded text-xs transition-colors cursor-pointer ${
                  chartMetric === 'FINANCIAL'
                    ? 'bg-emerald-500/20 text-emerald-300 font-bold border border-emerald-500/30'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Patrimônio (R$)
              </button>
              <button
                onClick={() => setChartMetric('POINTS')}
                className={`px-2.5 py-1 rounded text-xs transition-colors cursor-pointer ${
                  chartMetric === 'POINTS'
                    ? 'bg-emerald-500/20 text-emerald-300 font-bold border border-emerald-500/30'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Curva de Pontos (pts)
              </button>
            </div>
          </div>
        </div>

        {/* Viewport do Gráfico Recharts */}
        <div className="p-4 pt-6">
          <div className="h-[280px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={equityData} margin={{ top: 10, right: 30, left: 10, bottom: 0 }}>
                <defs>
                  <linearGradient id="equityGradient" x1="0" y1="0" x2="0" y2="1">
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
                  tickFormatter={(val) =>
                    chartMetric === 'FINANCIAL'
                      ? `R$ ${val}`
                      : `${val > 0 ? '+' : ''}${val}`
                  }
                />

                <Tooltip
                  content={({ active, payload }) => {
                    if (active && payload && payload.length) {
                      const data = payload[0].payload;
                      const isWin = data.pnlTrade > 0;
                      const isLoss = data.pnlTrade < 0;

                      return (
                        <div className="bg-slate-900 border border-slate-700 p-3 rounded-lg shadow-2xl text-xs font-mono space-y-1.5 min-w-[210px]">
                          <div className="flex items-center justify-between border-b border-slate-800 pb-1 font-bold text-slate-200">
                            <span>
                              {data.index === 0 ? 'Ponto Inicial' : `Operação #${data.index}`}
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
                            <span className="text-slate-400">Patrimônio Acumulado:</span>
                            <span
                              className={`font-bold ${
                                data.cumulativeEquity >= 0 ? 'text-emerald-400' : 'text-rose-400'
                              }`}
                            >
                              R$ {data.cumulativeEquity.toFixed(2)}
                            </span>
                          </div>

                          <div className="flex items-center justify-between">
                            <span className="text-slate-400">Pontos Acumulados:</span>
                            <span className="text-sky-400 font-semibold">
                              {data.cumulativePoints > 0 ? '+' : ''}
                              {data.cumulativePoints} pts
                            </span>
                          </div>

                          <div className="flex items-center justify-between text-[11px] border-t border-slate-800/80 pt-1 text-slate-400">
                            <span>Rebaixamento (Drawdown):</span>
                            <span className="text-rose-400 font-mono">
                              R$ {data.drawdown.toFixed(2)}
                            </span>
                          </div>
                        </div>
                      );
                    }
                    return null;
                  }}
                />

                {/* Linha Zero */}
                <ReferenceLine y={0} stroke="#475569" strokeDasharray="4 4" />

                {/* Área Preenchida da Curva */}
                <Area
                  type="monotone"
                  dataKey={chartMetric === 'FINANCIAL' ? 'cumulativeEquity' : 'cumulativePoints'}
                  stroke={isNetPositive ? '#10b981' : '#f43f5e'}
                  strokeWidth={2.5}
                  fillOpacity={1}
                  fill="url(#equityGradient)"
                />

                {/* Linha do High-Water Mark (Pico de Patrimônio) */}
                {chartMetric === 'FINANCIAL' && equityData.length > 2 && (
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

          {/* Barra de Métricas de Risco da Equity Curve */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4 pt-4 border-t border-slate-800/80 text-xs font-mono">
            <div className="bg-slate-950/60 p-2.5 rounded border border-slate-800/60">
              <span className="text-slate-500 text-[11px] block">Pico de Capital (Topo)</span>
              <span className="font-bold text-emerald-400 text-sm">
                R$ {equityStats.peakEquity.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
              </span>
            </div>

            <div className="bg-slate-950/60 p-2.5 rounded border border-slate-800/60">
              <span className="text-slate-500 text-[11px] block">Drawdown Máximo (Queda)</span>
              <span className="font-bold text-rose-400 text-sm">
                -R$ {equityStats.maxDrawdownVal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
              </span>
            </div>

            <div className="bg-slate-950/60 p-2.5 rounded border border-slate-800/60">
              <span className="text-slate-500 text-[11px] block">Média por Trade</span>
              <span
                className={`font-bold text-sm ${
                  equityStats.avgTrade >= 0 ? 'text-emerald-400' : 'text-rose-400'
                }`}
              >
                R$ {equityStats.avgTrade.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
              </span>
            </div>

            <div className="bg-slate-950/60 p-2.5 rounded border border-slate-800/60">
              <span className="text-slate-500 text-[11px] block">Sequência Recorde</span>
              <span className="font-bold text-slate-200 text-sm">
                {equityStats.consecutiveWins}W · {equityStats.consecutiveLosses}L
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Tabela de Ordens do Robô */}
      <div className="bg-slate-900/50 rounded-lg border border-slate-800 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 bg-slate-900 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            <h3 className="text-xs font-semibold text-slate-100">
              Histórico de Ordens Automáticas Disparadas
            </h3>
          </div>
          <div className="flex items-center gap-3">
            {onNavigateToAudit && (
              <button
                onClick={onNavigateToAudit}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-[11px] transition-colors cursor-pointer"
              >
                <span>Livro de Auditoria Completo (CSV)</span>
                <span>→</span>
              </button>
            )}
            <span className="text-xs text-slate-400 font-mono">
              {orders.length} ordens registradas
            </span>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs font-mono">
            <thead className="bg-slate-900/90 text-slate-400 border-b border-slate-800 text-[11px]">
              <tr>
                <th className="py-2.5 px-4">Horário</th>
                <th className="py-2.5 px-4">Lado</th>
                <th className="py-2.5 px-4">Entrada</th>
                <th className="py-2.5 px-4">Saída / Atual</th>
                <th className="py-2.5 px-4">Stop / Alvo</th>
                <th className="py-2.5 px-4 text-right">Pontos</th>
                <th className="py-2.5 px-4 text-right">Resultado R$</th>
                <th className="py-2.5 px-4">Gatilho da Convergência</th>
                <th className="py-2.5 px-4 text-center">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/50">
              {orders.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-10 text-center text-slate-500">
                    Nenhuma ordem executada ainda. O robô aguarda convergência de fluxo (Delta ≥ Limiar) com o box 10R.
                  </td>
                </tr>
              ) : (
                orders.map((order) => {
                  const isOpen = order.status === 'OPEN';
                  // Se aberto, calcula PnL flutuante
                  let pts = order.pointsResult;
                  let fin = order.financialResult;
                  if (isOpen) {
                    pts = order.type === 'BUY' ? currentPrice - order.entryPrice : order.entryPrice - currentPrice;
                    fin = pts * 0.2 * order.contracts;
                  }

                  const isWin = (pts || 0) > 0;
                  const isLoss = (pts || 0) < 0;

                  return (
                    <tr
                      key={order.id}
                      className={`hover:bg-slate-800/40 transition-colors ${
                        isOpen ? 'bg-sky-500/5' : ''
                      }`}
                    >
                      <td className="py-2 px-4 text-[11px]">
                        <span className="text-slate-300 block">{order.timeStr}</span>
                        {order.ticket && (
                          <span className="text-slate-500 font-mono text-[10px]">#{order.ticket}</span>
                        )}
                      </td>
                      <td className="py-2 px-4">
                        <span
                          className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                            order.type === 'BUY'
                              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                              : 'bg-rose-500/10 text-rose-400 border border-rose-500/30'
                          }`}
                        >
                          {order.type === 'BUY' ? '▲ COMPRA' : '▼ VENDA'} ({order.contracts})
                        </span>
                      </td>
                      <td className="py-2 px-4 font-semibold text-slate-200">
                        {order.entryPrice.toLocaleString('pt-BR')}
                      </td>
                      <td className="py-2 px-4 text-slate-300">
                        {isOpen
                          ? `${currentPrice.toLocaleString('pt-BR')} (Aberto)`
                          : order.exitPrice?.toLocaleString('pt-BR') || '-'}
                      </td>
                      <td className="py-2 px-4 text-slate-400 text-[11px]">
                        SL: {order.stopLoss} | TP: {order.takeProfit}
                      </td>
                      <td
                        className={`py-2 px-4 text-right font-bold ${
                          isWin ? 'text-emerald-400' : isLoss ? 'text-rose-400' : 'text-slate-400'
                        }`}
                      >
                        {(pts || 0) > 0 ? '+' : ''}
                        {pts} pts
                      </td>
                      <td
                        className={`py-2 px-4 text-right font-bold ${
                          isWin ? 'text-emerald-400' : isLoss ? 'text-rose-400' : 'text-slate-400'
                        }`}
                      >
                        R$ {(fin || 0) > 0 ? '+' : ''}
                        {(fin || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                      </td>
                      <td className="py-2 px-4 text-slate-400 text-[11px] truncate max-w-[280px]">
                        {order.triggerReason}
                      </td>
                      <td className="py-2 px-4 text-center">
                        {order.status === 'PENDING_LIMIT' && (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30">
                            ⏳ RETESTE ({order.limitPrice})
                          </span>
                        )}
                        {order.status === 'EXPIRED_PULLBACK' && (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700">
                            EXPIRADA
                          </span>
                        )}
                        {order.status === 'OPEN' && (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-sky-500/15 text-sky-400 border border-sky-500/30">
                            ABERTO
                          </span>
                        )}
                        {order.status === 'CLOSED_PROFIT' && (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                            TAKE PROFIT
                          </span>
                        )}
                        {order.status === 'CLOSED_LOSS' && (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-rose-500/15 text-rose-400 border border-rose-500/30">
                            STOP LOSS
                          </span>
                        )}
                        {order.status === 'CLOSED_MANUAL' && (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-amber-500/15 text-amber-400 border border-amber-500/30">
                            MANUAL
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
