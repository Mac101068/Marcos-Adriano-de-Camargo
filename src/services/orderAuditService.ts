import { TradeOrder, OrderAuditEvent, IntradayAuditSummary } from '../types/trading';

const AUDIT_STORAGE_KEY = 'fluxo_renko_intraday_audit_v3';

export class OrderAuditService {
  /**
   * Cria um registro de evento de auditoria com timestamp
   */
  static createEvent(
    action: OrderAuditEvent['action'],
    title: string,
    details: string,
    price?: number,
    contracts?: number,
    delta?: number
  ): OrderAuditEvent {
    const now = Date.now();
    return {
      id: `evt-${now}-${Math.random().toString(36).substring(2, 7)}`,
      timestamp: now,
      timeStr: new Date(now).toTimeString().split(' ')[0],
      action,
      title,
      details,
      price,
      contracts,
      delta,
    };
  }

  /**
   * Salva a lista de ordens do pregão atual no LocalStorage
   */
  static saveIntradayOrders(orders: TradeOrder[]): void {
    try {
      localStorage.setItem(AUDIT_STORAGE_KEY, JSON.stringify(orders));
    } catch {
      // Ignora erro de quota em navegadores restritos
    }
  }

  /**
   * Recupera a lista de ordens do pregão salvas
   */
  static loadIntradayOrders(): TradeOrder[] | null {
    try {
      const raw = localStorage.getItem(AUDIT_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as TradeOrder[];
        if (Array.isArray(parsed)) {
          // Sanitiza ordens abertas muito distantes (> 400 pts do baseline 128.500)
          return parsed.map((o) => {
            if (o.status === 'OPEN' && Math.abs(o.entryPrice - 128500) > 400) {
              return {
                ...o,
                status: 'CLOSED_MANUAL' as const,
                exitPrice: o.entryPrice,
                exitReason: 'MANUAL' as const,
              };
            }
            return o;
          });
        }
      }
    } catch {
      // Fallback
    }
    return null;
  }

  /**
   * Limpa o histórico de auditoria para iniciar um novo pregão
   */
  static clearIntradayAudit(): void {
    try {
      localStorage.removeItem(AUDIT_STORAGE_KEY);
    } catch {
      // Fallback
    }
  }

  /**
   * Calcula as métricas consolidadas de auditoria intraday
   */
  static computeSummary(orders: TradeOrder[]): IntradayAuditSummary {
    const totalOrdersGenerated = orders.length;
    const ordersPending = orders.filter((o) => o.status === 'PENDING_LIMIT').length;
    const ordersCancelledExpired = orders.filter((o) => o.status === 'EXPIRED_PULLBACK').length;
    const ordersOpen = orders.filter((o) => o.status === 'OPEN').length;
    const ordersExecuted = totalOrdersGenerated - ordersPending - ordersCancelledExpired;

    const closed = orders.filter((o) =>
      ['CLOSED_PROFIT', 'CLOSED_LOSS', 'CLOSED_MANUAL'].includes(o.status)
    );

    let netFinancial = 0;
    let totalPoints = 0;
    let grossProfit = 0;
    let grossLoss = 0;
    let winningOrders = 0;
    let losingOrders = 0;
    let breakevenOrders = 0;
    let partialExitsExecuted = 0;
    let totalPartialProfit = 0;
    let maxWinningTrade = 0;
    let maxLosingTrade = 0;

    // Inclui ordens fechadas
    closed.forEach((o) => {
      const fin = o.financialResult || 0;
      const pts = o.pointsResult || 0;

      netFinancial += fin;
      totalPoints += pts;

      if (o.partialExecuted) {
        partialExitsExecuted++;
        totalPartialProfit += o.partialFinancial || 0;
      }

      if (fin > 0) {
        winningOrders++;
        grossProfit += fin;
        if (fin > maxWinningTrade) maxWinningTrade = fin;
      } else if (fin < 0) {
        losingOrders++;
        grossLoss += Math.abs(fin);
        if (Math.abs(fin) > maxLosingTrade) maxLosingTrade = Math.abs(fin);
      } else {
        breakevenOrders++;
      }
    });

    const executionRate =
      totalOrdersGenerated > 0 ? (ordersExecuted / totalOrdersGenerated) * 100 : 0;

    const totalDecided = winningOrders + losingOrders;
    const winRate = totalDecided > 0 ? (winningOrders / totalDecided) * 100 : 0;
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 99 : 0;

    return {
      totalOrdersGenerated,
      ordersExecuted,
      ordersPending,
      ordersCancelledExpired,
      ordersClosed: closed.length,
      winningOrders,
      losingOrders,
      breakevenOrders,
      executionRate,
      winRate,
      netFinancial,
      totalPoints,
      profitFactor,
      partialExitsExecuted,
      totalPartialProfit,
      maxWinningTrade,
      maxLosingTrade,
    };
  }

  /**
   * Exporta a auditoria completa para CSV com delimitador ';' e BOM UTF-8 (compatível 100% com Excel e Planilhas Google no Brasil)
   */
  static exportToCSV(orders: TradeOrder[], assetSymbol: string = 'WIN$N'): void {
    const todayStr = new Date().toISOString().split('T')[0];
    const headers = [
      'Ticket',
      'Data/Hora Disparo',
      'Data/Hora Execução',
      'Data/Hora Saída',
      'Direção (Lado)',
      'Origem da Ordem',
      'Status Atual',
      'Contratos Iniciais',
      'Contratos Restantes',
      'Preço de Envio (Pts)',
      'Preço Executado (Pts)',
      'Preço de Saída (Pts)',
      'Resultado Pontos',
      'Resultado Financeiro (R$)',
      'Stop Loss (Pts)',
      'Take Profit (Pts)',
      'Saída Parcial?',
      'Preço Parcial (Pts)',
      'Pontos Parcial',
      'Lucro Parcial (R$)',
      'Breakeven Ativado?',
      'Motivo da Saída',
      'Gatilho de Fluxo / Convergência',
      'Eventos de Auditoria',
    ];

    const rows = orders.map((o) => {
      const isBuy = o.type === 'BUY';
      const sideStr = isBuy ? 'COMPRA' : 'VENDA';
      const sourceStr =
        o.source === 'MT5_LIVE' || o.isRealMT5
          ? 'MT5 Real B3'
          : o.source === 'MANUAL'
          ? 'Manual Terminal'
          : 'Robô EA 10R Automático';

      const statusMap: Record<string, string> = {
        OPEN: 'ABERTO',
        PENDING_LIMIT: 'AGUARDANDO RETESTE',
        EXPIRED_PULLBACK: 'CANCELADA / EXPIRADA',
        CLOSED_PROFIT: 'TAKE PROFIT',
        CLOSED_LOSS: 'STOP LOSS',
        CLOSED_MANUAL: 'ENCERRAMENTO MANUAL',
      };

      const statusStr = statusMap[o.status] || o.status;

      // Formatação numérica brasileira com vírgula para não quebrar no Excel
      const formatPtBrNum = (val?: number) => {
        if (val === undefined || val === null || isNaN(val)) return '';
        return val.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      };

      const formatPtBrPts = (val?: number) => {
        if (val === undefined || val === null || isNaN(val)) return '';
        return val.toLocaleString('pt-BR', { maximumFractionDigits: 0 });
      };

      const cleanString = (val?: string) => {
        if (!val) return '';
        return `"${val.replace(/"/g, '""')}"`;
      };

      const auditEventCount = o.auditTrail ? o.auditTrail.length : 1;

      return [
        o.ticket ? `#${o.ticket}` : o.id,
        cleanString(o.timeStr),
        cleanString(o.fillTimeStr || (o.status !== 'PENDING_LIMIT' ? o.timeStr : '')),
        cleanString(o.exitTimeStr || (o.status.startsWith('CLOSED') ? o.timeStr : '')),
        sideStr,
        sourceStr,
        statusStr,
        o.contracts,
        o.remainingContracts !== undefined ? o.remainingContracts : o.contracts,
        formatPtBrPts(o.limitPrice || o.entryPrice),
        formatPtBrPts(o.entryPrice),
        formatPtBrPts(o.exitPrice),
        formatPtBrPts(o.pointsResult),
        formatPtBrNum(o.financialResult),
        formatPtBrPts(o.stopLoss),
        formatPtBrPts(o.takeProfit),
        o.partialExecuted ? 'SIM' : 'NÃO',
        formatPtBrPts(o.partialPrice),
        formatPtBrPts(o.partialPoints),
        formatPtBrNum(o.partialFinancial),
        o.isBreakevenActive ? 'SIM' : 'NÃO',
        cleanString(o.exitReason || (o.status === 'CLOSED_PROFIT' ? 'Take Profit' : o.status === 'CLOSED_LOSS' ? 'Stop Loss' : '')),
        cleanString(o.triggerReason),
        `${auditEventCount} eventos registrados`,
      ].join(';');
    });

    const csvContent = '\uFEFF' + [headers.join(';'), ...rows].join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `auditoria_ordens_${assetSymbol.replace('$', '')}_${todayStr}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  /**
   * Gera texto sumarizado para cópia rápida na área de transferência (Diário de Bordo de Auditoria)
   */
  static generateClipboardAuditReport(orders: TradeOrder[], assetSymbol: string = 'WIN$N'): string {
    const summary = this.computeSummary(orders);
    const now = new Date();
    const dateFormatted = now.toLocaleDateString('pt-BR');
    const timeFormatted = now.toLocaleTimeString('pt-BR');

    const lines: string[] = [
      `=======================================================`,
      `📊 RELATÓRIO DE AUDITORIA INTRADAY - ${assetSymbol}`,
      `Data: ${dateFormatted} às ${timeFormatted}`,
      `Motor: Robô Fluxo & Renko 10R Institucional B3`,
      `=======================================================`,
      ``,
      `📋 RESUMO EXECUTIVO DO PREGÃO:`,
      `• Total de Ordens Geradas: ${summary.totalOrdersGenerated}`,
      `• Ordens Efetivamente Executadas: ${summary.ordersExecuted} (${summary.executionRate.toFixed(1)}% taxa de preenchimento)`,
      `• Ordens Canceladas/Expiradas no Reteste: ${summary.ordersCancelledExpired}`,
      `• Posições Encerradas: ${summary.ordersClosed}`,
      `• Taxa de Acerto (Win Rate): ${summary.winRate.toFixed(1)}% (${summary.winningOrders}W / ${summary.losingOrders}L / ${summary.breakevenOrders}BE)`,
      `• Pontuação Total Acumulada: ${summary.totalPoints > 0 ? '+' : ''}${summary.totalPoints} pts`,
      `• Resultado Financeiro Líquido: R$ ${summary.netFinancial.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,
      `• Fator de Lucro (Profit Factor): ${summary.profitFactor.toFixed(2)}`,
      `• Saídas Parciais Concretizadas: ${summary.partialExitsExecuted} (Lucro Parcial: R$ ${summary.totalPartialProfit.toLocaleString('pt-BR', { minimumFractionDigits: 2 })})`,
      `• Melhor Operação: R$ ${summary.maxWinningTrade.toFixed(2)}`,
      `• Pior Operação: -R$ ${summary.maxLosingTrade.toFixed(2)}`,
      ``,
      `=======================================================`,
      `DETALHAMENTO DAS ORDENS AUDITADAS:`,
      `=======================================================`,
    ];

    if (orders.length === 0) {
      lines.push(`(Nenhuma ordem registrada no pregão de hoje)`);
    } else {
      orders.forEach((o, i) => {
        const ticketStr = o.ticket ? `#${o.ticket}` : `ID ${o.id.substring(0, 8)}`;
        const ptsStr = o.pointsResult !== undefined ? `${o.pointsResult > 0 ? '+' : ''}${o.pointsResult} pts` : '-';
        const finStr = o.financialResult !== undefined ? `R$ ${o.financialResult > 0 ? '+' : ''}${o.financialResult.toFixed(2)}` : '-';
        const sideStr = o.type === 'BUY' ? 'COMPRA' : 'VENDA';

        lines.push(
          `[${o.timeStr}] ${ticketStr} | ${sideStr} (${o.contracts} ctros) | Ent: ${o.entryPrice} pts | Saída: ${o.exitPrice || 'Aberta'} | PnL: ${ptsStr} (${finStr}) | Status: ${o.status}`
        );
        lines.push(`   └ Gatilho: ${o.triggerReason}`);
        if (o.partialExecuted) {
          lines.push(`   └ Parcial: +${o.partialPoints} pts (R$ ${o.partialFinancial?.toFixed(2)}) com SL no Breakeven`);
        }
      });
    }

    lines.push(``);
    lines.push(`Auditado por: Fluxo & Renko EA Engine v2.4 · MetaTrader 5 Bridge`);
    lines.push(`=======================================================`);

    return lines.join('\n');
  }
}
