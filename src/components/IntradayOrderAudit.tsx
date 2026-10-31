import React, { useState, useMemo } from 'react';
import { TradeOrder, OrderAuditEvent } from '../types/trading';
import { ASSETS, AssetSpec, DEFAULT_ASSET_ID, pointsToBRL } from '../assets/assetRegistry';
import { OrderAuditService } from '../services/orderAuditService';
import {
  ShieldCheck,
  Download,
  Copy,
  Check,
  Search,
  Filter,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Clock,
  ArrowUpRight,
  ArrowDownRight,
  Layers,
  FileSpreadsheet,
  Activity,
  Maximize2,
  RotateCcw,
  Sliders,
  DollarSign,
  TrendingUp,
  Percent,
  Compass,
} from 'lucide-react';

interface IntradayOrderAuditProps {
  orders: TradeOrder[];
  currentPrice: number;
  symbol?: string;
  /** Spec do ativo (R$/ponto e casas do preço); `symbol` continua sendo o código do contrato nos relatórios. */
  asset?: AssetSpec;
  onClearAudit?: () => void;
  onOpenSettings?: () => void;
}

export const IntradayOrderAudit: React.FC<IntradayOrderAuditProps> = ({
  orders,
  currentPrice,
  symbol = 'WIN$N',
  asset = ASSETS[DEFAULT_ASSET_ID],
  onClearAudit,
  onOpenSettings,
}) => {
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [sideFilter, setSideFilter] = useState<string>('ALL');
  const [sourceFilter, setSourceFilter] = useState<string>('ALL');
  const [selectedOrderForAudit, setSelectedOrderForAudit] = useState<TradeOrder | null>(null);
  const [copiedToast, setCopiedToast] = useState<boolean>(false);
  const [showConfirmReset, setShowConfirmReset] = useState<boolean>(false);

  // Calcula resumo consolidado da auditoria do dia
  const summary = useMemo(() => {
    return OrderAuditService.computeSummary(orders);
  }, [orders]);

  // Filtra as ordens de acordo com os filtros selecionados
  const filteredOrders = useMemo(() => {
    return orders.filter((o) => {
      // Filtro de busca de texto (Ticket, horário, gatilho, status)
      if (searchQuery.trim() !== '') {
        const q = searchQuery.toLowerCase().trim();
        const ticketStr = o.ticket ? o.ticket.toString() : '';
        const idStr = o.id.toLowerCase();
        const reasonStr = o.triggerReason.toLowerCase();
        const timeStr = o.timeStr.toLowerCase();
        const statusStr = o.status.toLowerCase();

        if (
          !ticketStr.includes(q) &&
          !idStr.includes(q) &&
          !reasonStr.includes(q) &&
          !timeStr.includes(q) &&
          !statusStr.includes(q)
        ) {
          return false;
        }
      }

      // Filtro de Status
      if (statusFilter === 'OPEN' && o.status !== 'OPEN') return false;
      if (statusFilter === 'PROFIT' && o.status !== 'CLOSED_PROFIT') return false;
      if (statusFilter === 'LOSS' && o.status !== 'CLOSED_LOSS') return false;
      if (statusFilter === 'PENDING' && o.status !== 'PENDING_LIMIT') return false;
      if (statusFilter === 'EXPIRED' && o.status !== 'EXPIRED_PULLBACK') return false;
      if (statusFilter === 'MANUAL' && o.status !== 'CLOSED_MANUAL') return false;

      // Filtro de Direção
      if (sideFilter === 'BUY' && o.type !== 'BUY') return false;
      if (sideFilter === 'SELL' && o.type !== 'SELL') return false;

      // Filtro de Origem
      if (sourceFilter === 'ROBOT' && (o.source === 'MANUAL' || o.source === 'MT5_LIVE' || o.isRealMT5)) return false;
      if (sourceFilter === 'MANUAL' && o.source !== 'MANUAL') return false;
      if (sourceFilter === 'MT5' && !(o.source === 'MT5_LIVE' || o.isRealMT5)) return false;

      return true;
    });
  }, [orders, searchQuery, statusFilter, sideFilter, sourceFilter]);

  // Ação de exportar CSV
  const handleExportCSV = () => {
    OrderAuditService.exportToCSV(orders, symbol);
  };

  // Ação de copiar relatório para a área de transferência
  const handleCopyReport = () => {
    const text = OrderAuditService.generateClipboardAuditReport(orders, symbol);
    navigator.clipboard.writeText(text);
    setCopiedToast(true);
    setTimeout(() => setCopiedToast(false), 2500);
  };

  return (
    <div className="flex flex-col h-full bg-slate-950 border border-slate-800/80 rounded-lg p-3 sm:p-5 overflow-y-auto space-y-5">
      {/* 1. Header do Painel de Auditoria Intraday */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 bg-slate-900/90 border border-slate-800 p-4 rounded-xl shadow-lg">
        <div className="flex items-start sm:items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shrink-0 shadow-inner">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-base sm:text-lg font-bold text-slate-100 tracking-tight">
                Livro de Auditoria de Ordens Intraday
              </h2>
              <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 text-[10px] font-mono font-semibold">
                AUDITORIA ATIVA · B3 {symbol}
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              Rastreamento imutável de todas as ordens geradas pelo Robô 10R e disparos manuais no pregão de hoje.
            </p>
          </div>
        </div>

        {/* Botões de Ação de Compliance */}
        <div className="flex items-center gap-2 flex-wrap shrink-0">
          <button
            onClick={handleCopyReport}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-700 transition-all cursor-pointer shadow-xs"
            title="Copiar diário de bordo e auditoria em texto formatado"
          >
            {copiedToast ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-400" />
                <span className="text-emerald-400">Copiado!</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5 text-slate-400" />
                <span>Copiar Relatório</span>
              </>
            )}
          </button>

          <button
            onClick={handleExportCSV}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition-all cursor-pointer shadow-md shadow-emerald-950/30"
            title="Baixar planilha de auditoria completa (.CSV) compatível com Excel e Google Planilhas"
          >
            <FileSpreadsheet className="w-4 h-4" />
            <span>Exportar CSV (Excel)</span>
          </button>

          {onClearAudit && (
            <button
              onClick={() => setShowConfirmReset(true)}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-800/60 hover:bg-rose-950/40 text-slate-400 hover:text-rose-300 border border-slate-700 hover:border-rose-500/30 text-xs transition-colors cursor-pointer"
              title="Limpar ordens e reiniciar o pregão de auditoria"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Novo Pregão</span>
            </button>
          )}
        </div>
      </div>

      {/* 2. Grid de KPIs Auditados do Pregão */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {/* Total Ordens Geradas */}
        <div className="bg-slate-900/70 p-3 rounded-lg border border-slate-800/80">
          <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
            <span>Ordens Disparadas</span>
            <Layers className="w-3.5 h-3.5 text-neutral-400" />
          </div>
          <div className="text-lg font-bold font-mono text-slate-100 tabular-nums">
            {summary.totalOrdersGenerated}
          </div>
          <div className="text-[10px] text-slate-500 mt-0.5">
            {summary.ordersExecuted} executadas ({summary.executionRate.toFixed(0)}%)
          </div>
        </div>

        {/* Resultado Financeiro Líquido Auditado */}
        <div className="bg-slate-900/70 p-3 rounded-lg border border-slate-800/80">
          <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
            <span>Lucro Líquido</span>
            <DollarSign className="w-3.5 h-3.5 text-emerald-400" />
          </div>
          <div
            className={`text-lg font-bold font-mono tabular-nums ${
              summary.netFinancial >= 0 ? 'text-emerald-400' : 'text-rose-400'
            }`}
          >
            {summary.netFinancial >= 0 ? '+' : ''}R${' '}
            {summary.netFinancial.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
          </div>
          <div className="text-[10px] text-slate-500 mt-0.5">
            {summary.totalPoints > 0 ? '+' : ''}
            {summary.totalPoints} pontos líquidos
          </div>
        </div>

        {/* Taxa de Acerto / Win Rate */}
        <div className="bg-slate-900/70 p-3 rounded-lg border border-slate-800/80">
          <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
            <span>Taxa de Acerto</span>
            <Percent className="w-3.5 h-3.5 text-amber-400" />
          </div>
          <div className="text-lg font-bold font-mono text-amber-300 tabular-nums">
            {summary.winRate.toFixed(1)}%
          </div>
          <div className="text-[10px] text-slate-400 mt-0.5">
            <span className="text-emerald-400 font-semibold">{summary.winningOrders}W</span> ·{' '}
            <span className="text-rose-400 font-semibold">{summary.losingOrders}L</span> ·{' '}
            <span className="text-slate-400">{summary.breakevenOrders}BE</span>
          </div>
        </div>

        {/* Fator de Lucro / Profit Factor */}
        <div className="bg-slate-900/70 p-3 rounded-lg border border-slate-800/80">
          <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
            <span>Fator de Lucro</span>
            <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
          </div>
          <div className="text-lg font-bold font-mono text-slate-100 tabular-nums">
            {summary.profitFactor >= 99 ? '∞' : summary.profitFactor.toFixed(2)}
          </div>
          <div className="text-[10px] text-slate-500 mt-0.5">
            {summary.ordersClosed} posições encerradas
          </div>
        </div>

        {/* Parciais & Proteção Breakeven */}
        <div className="bg-slate-900/70 p-3 rounded-lg border border-slate-800/80">
          <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
            <span>Saídas Parciais</span>
            <CheckCircle2 className="w-3.5 h-3.5 text-neutral-400" />
          </div>
          <div className="text-lg font-bold font-mono text-neutral-300 tabular-nums">
            {summary.partialExitsExecuted}
          </div>
          <div className="text-[10px] text-neutral-400/90 mt-0.5 font-mono">
            +R$ {summary.totalPartialProfit.toFixed(2)} colhidos
          </div>
        </div>

        {/* Ordens Canceladas/Expiradas no Pullback */}
        <div className="bg-slate-900/70 p-3 rounded-lg border border-slate-800/80">
          <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
            <span>Expiradas no Reteste</span>
            <Clock className="w-3.5 h-3.5 text-slate-400" />
          </div>
          <div className="text-lg font-bold font-mono text-slate-300 tabular-nums">
            {summary.ordersCancelledExpired}
          </div>
          <div className="text-[10px] text-slate-500 mt-0.5">
            {summary.ordersPending} retestes aguardando
          </div>
        </div>
      </div>

      {/* 3. Barra de Filtros e Busca */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-slate-900/50 p-3 rounded-lg border border-slate-800">
        <div className="flex items-center gap-2 flex-1 max-w-md">
          <div className="relative w-full">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar por Ticket #, horário, gatilho ou status..."
              className="w-full bg-slate-950 border border-slate-800 pl-8 pr-3 py-1.5 rounded-md text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-emerald-500 font-mono"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 text-xs"
              >
                ✕
              </button>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Filtro de Status */}
          <div className="flex items-center gap-1 text-xs">
            <Filter className="w-3 h-3 text-slate-500" />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="bg-slate-950 border border-slate-800 px-2 py-1 rounded text-xs text-slate-300 focus:outline-none focus:border-emerald-500 cursor-pointer"
            >
              <option value="ALL">Status: Todos</option>
              <option value="OPEN">Abertas (Flutuantes)</option>
              <option value="PROFIT">Fechadas no Lucro (TP)</option>
              <option value="LOSS">Fechadas no Prejuízo (SL)</option>
              <option value="PENDING">Aguardando Reteste</option>
              <option value="EXPIRED">Expiradas/Canceladas</option>
              <option value="MANUAL">Encerradas Manuais</option>
            </select>
          </div>

          {/* Filtro de Lado */}
          <select
            value={sideFilter}
            onChange={(e) => setSideFilter(e.target.value)}
            className="bg-slate-950 border border-slate-800 px-2 py-1 rounded text-xs text-slate-300 focus:outline-none focus:border-emerald-500 cursor-pointer"
          >
            <option value="ALL">Lado: Todos</option>
            <option value="BUY">▲ Apenas Compras</option>
            <option value="SELL">▼ Apenas Vendas</option>
          </select>

          {/* Filtro de Origem */}
          <select
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value)}
            className="bg-slate-950 border border-slate-800 px-2 py-1 rounded text-xs text-slate-300 focus:outline-none focus:border-emerald-500 cursor-pointer"
          >
            <option value="ALL">Origem: Todas</option>
            <option value="ROBOT">Robô EA Automático</option>
            <option value="MANUAL">Terminal Manual</option>
            <option value="MT5">MT5 Real B3</option>
          </select>
        </div>
      </div>

      {/* 4. Tabela de Auditoria de Ordens */}
      <div className="bg-slate-900/60 rounded-xl border border-slate-800 overflow-hidden shadow-xl">
        <div className="flex items-center justify-between px-4 py-3 bg-slate-900 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400" />
            <h3 className="text-xs font-semibold text-slate-200">
              Registros Auditados do Dia ({filteredOrders.length} de {orders.length})
            </h3>
          </div>
          <span className="text-[11px] text-slate-400 font-mono">
            Clique na ordem para auditar a trilha cronológica
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs font-mono">
            <thead className="bg-slate-900/90 text-slate-400 border-b border-slate-800 text-[11px]">
              <tr>
                <th className="py-2.5 px-3">Ticket / Horário</th>
                <th className="py-2.5 px-3">Lado</th>
                <th className="py-2.5 px-3">Lote</th>
                <th className="py-2.5 px-3">Preço Entrada</th>
                <th className="py-2.5 px-3">Preço Saída</th>
                <th className="py-2.5 px-3">Stop / Alvo</th>
                <th className="py-2.5 px-3">Parcial</th>
                <th className="py-2.5 px-3 text-right">Resultado Pontos</th>
                <th className="py-2.5 px-3 text-right">Resultado R$</th>
                <th className="py-2.5 px-3">Gatilho de Fluxo</th>
                <th className="py-2.5 px-3 text-center">Status</th>
                <th className="py-2.5 px-3 text-center">Auditoria</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/40">
              {filteredOrders.length === 0 ? (
                <tr>
                  <td colSpan={12} className="py-12 text-center text-slate-500">
                    Nenhum registro encontrado para os filtros selecionados.
                  </td>
                </tr>
              ) : (
                filteredOrders.map((order) => {
                  const isOpen = order.status === 'OPEN';
                  const isPending = order.status === 'PENDING_LIMIT';
                  const isExpired = order.status === 'EXPIRED_PULLBACK';

                  let pts = order.pointsResult;
                  let fin = order.financialResult;
                  if (isOpen) {
                    pts = order.type === 'BUY' ? currentPrice - order.entryPrice : order.entryPrice - currentPrice;
                    fin = pointsToBRL(pts, order.remainingContracts || order.contracts, asset) + (order.partialFinancial || 0);
                  }

                  const isWin = (pts || 0) > 0;
                  const isLoss = (pts || 0) < 0;

                  return (
                    <tr
                      key={order.id}
                      onClick={() => setSelectedOrderForAudit(order)}
                      className={`hover:bg-slate-800/50 transition-colors cursor-pointer ${
                        isOpen ? 'bg-neutral-500/5' : isPending ? 'bg-amber-500/5' : ''
                      }`}
                    >
                      {/* Ticket & Horário */}
                      <td className="py-2.5 px-3">
                        <div className="font-bold text-slate-200">
                          {order.ticket ? `#${order.ticket}` : `ID-${order.id.slice(-6)}`}
                        </div>
                        <div className="text-[10px] text-slate-400 flex items-center gap-1 mt-0.5">
                          <Clock className="w-2.5 h-2.5" />
                          <span>{order.timeStr}</span>
                        </div>
                      </td>

                      {/* Lado */}
                      <td className="py-2.5 px-3">
                        <span
                          className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded ${
                            order.type === 'BUY'
                              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                              : 'bg-rose-500/10 text-rose-400 border border-rose-500/30'
                          }`}
                        >
                          {order.type === 'BUY' ? (
                            <ArrowUpRight className="w-3 h-3" />
                          ) : (
                            <ArrowDownRight className="w-3 h-3" />
                          )}
                          {order.type === 'BUY' ? 'COMPRA' : 'VENDA'}
                        </span>
                      </td>

                      {/* Lote */}
                      <td className="py-2.5 px-3 text-slate-300">
                        <span>{order.contracts} ctr</span>
                        {order.remainingContracts !== undefined && order.remainingContracts < order.contracts && (
                          <span className="block text-[10px] text-neutral-400">
                            ({order.remainingContracts} restante)
                          </span>
                        )}
                      </td>

                      {/* Preço de Entrada */}
                      <td className="py-2.5 px-3 font-semibold text-slate-200">
                        {order.entryPrice.toLocaleString('pt-BR')}
                        {order.limitPrice && order.limitPrice !== order.entryPrice && (
                          <span className="block text-[10px] text-amber-400 font-normal">
                            Limite: {order.limitPrice.toLocaleString('pt-BR')}
                          </span>
                        )}
                      </td>

                      {/* Preço de Saída */}
                      <td className="py-2.5 px-3 text-slate-300">
                        {isOpen ? (
                          <span className="text-neutral-400 font-medium">
                            {currentPrice.toLocaleString('pt-BR')} (Flutuante)
                          </span>
                        ) : isPending ? (
                          <span className="text-amber-400">Pendente</span>
                        ) : isExpired ? (
                          <span className="text-slate-500">-</span>
                        ) : (
                          order.exitPrice?.toLocaleString('pt-BR') || '-'
                        )}
                      </td>

                      {/* Stop / Alvo */}
                      <td className="py-2.5 px-3 text-[11px] text-slate-400">
                        <div>SL: {order.stopLoss}</div>
                        <div>TP: {order.takeProfit}</div>
                        {order.isBreakevenActive && (
                          <span className="text-[9px] text-neutral-300 font-semibold block">
                            🛡️ BE Ativo
                          </span>
                        )}
                      </td>

                      {/* Parcial */}
                      <td className="py-2.5 px-3 text-[11px]">
                        {order.partialExecuted ? (
                          <div className="text-neutral-400 font-semibold">
                            <span>+{order.partialPoints} pts</span>
                            <span className="block text-[10px] text-neutral-300">
                              +R$ {order.partialFinancial?.toFixed(2)}
                            </span>
                          </div>
                        ) : (
                          <span className="text-slate-500">-</span>
                        )}
                      </td>

                      {/* Resultado Pontos */}
                      <td
                        className={`py-2.5 px-3 text-right font-bold ${
                          isPending || isExpired
                            ? 'text-slate-500'
                            : isWin
                            ? 'text-emerald-400'
                            : isLoss
                            ? 'text-rose-400'
                            : 'text-slate-400'
                        }`}
                      >
                        {isPending || isExpired ? '-' : `${(pts || 0) > 0 ? '+' : ''}${pts} pts`}
                      </td>

                      {/* Resultado Financeiro */}
                      <td
                        className={`py-2.5 px-3 text-right font-bold ${
                          isPending || isExpired
                            ? 'text-slate-500'
                            : isWin
                            ? 'text-emerald-400'
                            : isLoss
                            ? 'text-rose-400'
                            : 'text-slate-400'
                        }`}
                      >
                        {isPending || isExpired
                          ? '-'
                          : `R$ ${(fin || 0) > 0 ? '+' : ''}${(fin || 0).toLocaleString('pt-BR', {
                              minimumFractionDigits: 2,
                            })}`}
                      </td>

                      {/* Gatilho */}
                      <td className="py-2.5 px-3 text-slate-400 text-[11px] max-w-[220px] truncate">
                        <span title={order.triggerReason}>{order.triggerReason}</span>
                      </td>

                      {/* Status */}
                      <td className="py-2.5 px-3 text-center">
                        {order.status === 'PENDING_LIMIT' && (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30">
                            RETESTE PENDENTE
                          </span>
                        )}
                        {order.status === 'EXPIRED_PULLBACK' && (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700">
                            EXPIRADA
                          </span>
                        )}
                        {order.status === 'OPEN' && (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-neutral-500/15 text-neutral-400 border border-neutral-500/30">
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

                      {/* Botão de Trilha de Auditoria */}
                      <td className="py-2.5 px-3 text-center">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedOrderForAudit(order);
                          }}
                          className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-emerald-400 text-[10px] border border-slate-700 transition-colors"
                          title="Ver trilha de eventos cronológicos desta ordem"
                        >
                          Trilha
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 5. Modal de Detalhamento da Trilha de Auditoria do Ticket Selecionado */}
      {selectedOrderForAudit && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
          <div className="relative w-full max-w-2xl bg-slate-900 border border-slate-700 rounded-xl shadow-2xl p-4 sm:p-6 my-auto text-slate-100 font-sans">
            {/* Header do Modal */}
            <div className="flex items-center justify-between border-b border-slate-800 pb-3 mb-4">
              <div className="flex items-center gap-2.5">
                <div
                  className={`w-8 h-8 rounded-lg flex items-center justify-center font-bold text-xs ${
                    selectedOrderForAudit.type === 'BUY'
                      ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                      : 'bg-rose-500/15 text-rose-400 border border-rose-500/30'
                  }`}
                >
                  {selectedOrderForAudit.type === 'BUY' ? '▲' : '▼'}
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-100">
                    Trilha de Auditoria: Ordem{' '}
                    {selectedOrderForAudit.ticket ? `#${selectedOrderForAudit.ticket}` : selectedOrderForAudit.id}
                  </h3>
                  <span className="text-xs text-slate-400 font-mono">
                    Horário Disparo: {selectedOrderForAudit.timeStr} ·{' '}
                    {selectedOrderForAudit.type === 'BUY' ? 'COMPRA' : 'VENDA'} ({selectedOrderForAudit.contracts} ctros)
                  </span>
                </div>
              </div>

              <button
                onClick={() => setSelectedOrderForAudit(null)}
                className="w-7 h-7 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white flex items-center justify-center text-sm font-bold transition-colors cursor-pointer"
              >
                ✕
              </button>
            </div>

            {/* Ficha Técnica de Compliance */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 bg-slate-950/60 p-3 rounded-lg border border-slate-800/80 text-xs font-mono mb-5">
              <div>
                <span className="text-slate-500 text-[10px] block">Preço Entrada</span>
                <span className="font-bold text-slate-200">
                  {selectedOrderForAudit.entryPrice.toLocaleString('pt-BR')} pts
                </span>
              </div>
              <div>
                <span className="text-slate-500 text-[10px] block">Preço Saída</span>
                <span className="font-bold text-slate-200">
                  {selectedOrderForAudit.exitPrice
                    ? `${selectedOrderForAudit.exitPrice.toLocaleString('pt-BR')} pts`
                    : 'Posição Aberta'}
                </span>
              </div>
              <div>
                <span className="text-slate-500 text-[10px] block">Resultado Pontos</span>
                <span
                  className={`font-bold ${
                    (selectedOrderForAudit.pointsResult || 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'
                  }`}
                >
                  {selectedOrderForAudit.pointsResult !== undefined
                    ? `${selectedOrderForAudit.pointsResult > 0 ? '+' : ''}${selectedOrderForAudit.pointsResult} pts`
                    : '-'}
                </span>
              </div>
              <div>
                <span className="text-slate-500 text-[10px] block">Resultado R$</span>
                <span
                  className={`font-bold ${
                    (selectedOrderForAudit.financialResult || 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'
                  }`}
                >
                  {selectedOrderForAudit.financialResult !== undefined
                    ? `R$ ${selectedOrderForAudit.financialResult > 0 ? '+' : ''}${selectedOrderForAudit.financialResult.toFixed(2)}`
                    : '-'}
                </span>
              </div>
            </div>

            {/* Linha do Tempo de Auditoria (Timeline) */}
            <div className="space-y-3">
              <h4 className="text-xs font-semibold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-emerald-400" />
                Linha do Tempo Cronológica dos Fatos
              </h4>

              <div className="relative pl-6 border-l-2 border-slate-800 space-y-4 font-mono text-xs">
                {/* 1. Detecção do Sinal */}
                <div className="relative">
                  <span className="absolute -left-[31px] top-0.5 w-3.5 h-3.5 rounded-full bg-slate-900 border-2 border-emerald-400" />
                  <div className="flex items-center justify-between text-slate-300 font-bold">
                    <span>1. Detecção de Sinal & Convergência 10R</span>
                    <span className="text-[10px] text-slate-400">{selectedOrderForAudit.timeStr}</span>
                  </div>
                  <p className="text-slate-400 text-[11px] mt-0.5">
                    {selectedOrderForAudit.triggerReason}
                  </p>
                </div>

                {/* 2. Disparo da Ordem */}
                <div className="relative">
                  <span className="absolute -left-[31px] top-0.5 w-3.5 h-3.5 rounded-full bg-slate-900 border-2 border-neutral-400" />
                  <div className="flex items-center justify-between text-slate-300 font-bold">
                    <span>2. Roteamento da Ordem</span>
                    <span className="text-[10px] text-slate-400">{selectedOrderForAudit.timeStr}</span>
                  </div>
                  <p className="text-slate-400 text-[11px] mt-0.5">
                    Enviada ordem de {selectedOrderForAudit.type === 'BUY' ? 'COMPRA' : 'VENDA'} para {selectedOrderForAudit.contracts} contrato(s).
                    {selectedOrderForAudit.limitPrice
                      ? ` Ordem LIMITADA posicionada no reteste em ${selectedOrderForAudit.limitPrice} pts.`
                      : ` Ordem A MERCADO executada a ${selectedOrderForAudit.entryPrice} pts.`}
                  </p>
                </div>

                {/* 3. Saída Parcial (se ocorreu) */}
                {selectedOrderForAudit.partialExecuted && (
                  <div className="relative">
                    <span className="absolute -left-[31px] top-0.5 w-3.5 h-3.5 rounded-full bg-slate-900 border-2 border-amber-400" />
                    <div className="flex items-center justify-between text-amber-300 font-bold">
                      <span>3. Saída Parcial Executada</span>
                      <span className="text-[10px] text-slate-400">
                        {selectedOrderForAudit.partialTimestamp
                          ? new Date(selectedOrderForAudit.partialTimestamp).toTimeString().split(' ')[0]
                          : selectedOrderForAudit.timeStr}
                      </span>
                    </div>
                    <p className="text-slate-300 text-[11px] mt-0.5">
                      Parcial batida com ganho de +{selectedOrderForAudit.partialPoints} pts (+R$ {selectedOrderForAudit.partialFinancial?.toFixed(2)}).
                      Contratos restantes na posição: {selectedOrderForAudit.remainingContracts}.
                    </p>
                  </div>
                )}

                {/* 4. Breakeven ou Trailing Stop (se ativado) */}
                {selectedOrderForAudit.isBreakevenActive && (
                  <div className="relative">
                    <span className="absolute -left-[31px] top-0.5 w-3.5 h-3.5 rounded-full bg-slate-900 border-2 border-neutral-400" />
                    <div className="flex items-center justify-between text-neutral-300 font-bold">
                      <span>4. Proteção de Risco (Breakeven)</span>
                      <span className="text-[10px] text-slate-400">{selectedOrderForAudit.timeStr}</span>
                    </div>
                    <p className="text-slate-400 text-[11px] mt-0.5">
                      Stop Loss movido para o preço de entrada protegido ({selectedOrderForAudit.stopLoss} pts) para garantir taxa zero de risco.
                    </p>
                  </div>
                )}

                {/* 5. Desfecho Final */}
                <div className="relative">
                  <span
                    className={`absolute -left-[31px] top-0.5 w-3.5 h-3.5 rounded-full bg-slate-900 border-2 ${
                      selectedOrderForAudit.status === 'CLOSED_PROFIT'
                        ? 'border-emerald-400'
                        : selectedOrderForAudit.status === 'CLOSED_LOSS'
                        ? 'border-rose-400'
                        : selectedOrderForAudit.status === 'OPEN'
                        ? 'border-neutral-400 animate-pulse'
                        : 'border-slate-500'
                    }`}
                  />
                  <div className="flex items-center justify-between text-slate-200 font-bold">
                    <span>
                      5. Liquidação & Status:{' '}
                      {selectedOrderForAudit.status === 'OPEN'
                        ? 'POSIÇÃO ABERTA EM ANDAMENTO'
                        : selectedOrderForAudit.status === 'CLOSED_PROFIT'
                        ? 'TAKE PROFIT ATINGIDO'
                        : selectedOrderForAudit.status === 'CLOSED_LOSS'
                        ? 'STOP LOSS ATINGIDO'
                        : selectedOrderForAudit.status === 'EXPIRED_PULLBACK'
                        ? 'CANCELADA / SEM RETORNO'
                        : 'ENCERRAMENTO MANUAL'}
                    </span>
                    <span className="text-[10px] text-slate-400">
                      {selectedOrderForAudit.exitTimeStr || selectedOrderForAudit.timeStr}
                    </span>
                  </div>
                  <p className="text-slate-400 text-[11px] mt-0.5">
                    {selectedOrderForAudit.status === 'OPEN'
                      ? `Preço atual do mercado: ${currentPrice} pts. Posição monitorada em tempo real.`
                      : selectedOrderForAudit.exitPrice
                      ? `Encerrada a ${selectedOrderForAudit.exitPrice} pts com resultado líquido final de R$ ${selectedOrderForAudit.financialResult?.toFixed(2)}.`
                      : 'Ordem expirou sem acionamento.'}
                  </p>
                </div>
              </div>
            </div>

            {/* Rodapé de Compliance */}
            <div className="mt-6 pt-3 border-t border-slate-800 flex items-center justify-between text-[11px] text-slate-500">
              <span>Selo de Rastreabilidade Fluxo & Renko EA</span>
              <button
                onClick={() => setSelectedOrderForAudit(null)}
                className="px-3 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Confirmação para Iniciar Novo Pregão */}
      {showConfirmReset && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-xl p-5 max-w-sm w-full text-slate-200 shadow-2xl">
            <div className="flex items-center gap-2.5 text-amber-400 mb-3 font-bold text-sm">
              <AlertTriangle className="w-5 h-5" />
              <span>Iniciar Novo Pregão?</span>
            </div>
            <p className="text-xs text-slate-400 leading-relaxed mb-4">
              Isto irá zerar o livro de auditoria e estatísticas do pregão atual para iniciar um novo dia de operações limpo. Deseja prosseguir?
            </p>
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => setShowConfirmReset(false)}
                className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-300 transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={() => {
                  setShowConfirmReset(false);
                  onClearAudit?.();
                }}
                className="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-xs font-bold text-white transition-colors"
              >
                Confirmar e Zerar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
