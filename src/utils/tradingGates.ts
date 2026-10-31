import { AutomationConfig, TradeOrder } from '../types/trading';
import { parseHHMM } from './sessionRules';

/**
 * Portões de ENTRADA compartilhados pelas duas estratégias (Pirâmide e Reteste) e pelo
 * espelho da tira de status. Ficam fora do App de propósito: são funções puras, então
 * dá para conferir a regra headless (sem navegador) e reutilizar na ponte Python gerada.
 *
 * Nenhum helper aqui envia ordem — eles só respondem "pode abrir posição agora?".
 */

/**
 * Janela do day trade medida na HORA DO TICK (replay/feed sintético obedece a barra simulada).
 * Falha ABERTA de propósito: se a estratégia vier com o horário vazio ou fora de 'HH:MM'
 * (campo de texto digitado errado), o portão NÃO bloqueia — um `nowHM < ''` silencioso travaria
 * o robô para sempre sem aviso nenhum. O chip de diagnóstico da tira mostra a janela interpretada.
 */
export function isWithinTradingWindow(timestamp: number, config: AutomationConfig): boolean {
  if (!config.tradingHoursEnabled) return true;
  const startMin = parseHHMM(config.tradingStartTime);
  const endMin = parseHHMM(config.tradingStopEntriesTime);
  if (startMin === null || endMin === null) return true;
  const d = new Date(timestamp);
  const nowMin = d.getHours() * 60 + d.getMinutes();
  return nowMin >= startMin && nowMin < endMin;
}

export const brl = (v: number) =>
  `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export interface FinancialLock {
  /** Uma linha curta, para o chip da tira de status. */
  short: string;
  /** Explicação completa, para o toast e para o hover do chip. */
  reason: string;
  /** Realizado da sessão em R$. */
  net: number;
  /** Ordens fechadas na sessão. */
  trades: number;
}

/**
 * TRAVA FINANCEIRA DA SESSÃO: meta de ganho, perda máxima e limite de trades.
 * Julga pelo RESULTADO REALIZADO desta abertura da página — o mesmo critério do
 * PnL exibido no canto da tela (ordem fechada com exitTimestamp >= início da sessão).
 * Ponto flutuante NÃO trava: com `closeAllOnFinancialLock` ligado a posição aberta é
 * liquidada a mercado pelo App e só então entra na conta.
 *
 * Cada estratégia carrega os próprios valores (snapshot do Estúdio); 0 = livre.
 */
export function sessionFinancialLock(
  list: TradeOrder[],
  config: AutomationConfig,
  sessionStart: number
): FinancialLock | null {
  const profitOn = config.maxDailyProfit > 0;
  const lossOn = config.maxDailyLoss > 0;
  const tradesOn = config.maxDailyTrades > 0;
  if (!profitOn && !lossOn && !tradesOn) return null;

  let net = 0;
  let trades = 0;
  for (const o of list) {
    if (o.status !== 'OPEN' && o.status !== 'PENDING_LIMIT' && (o.exitTimestamp ?? 0) >= sessionStart) {
      net += o.financialResult || 0;
      trades += 1;
    }
  }

  if (profitOn && net >= config.maxDailyProfit) {
    return {
      short: `Meta batida · ${brl(net)} de ${brl(config.maxDailyProfit)}`,
      reason: `Meta diária de ganho atingida: ${brl(net)} ≥ ${brl(config.maxDailyProfit)} em ${trades} trade(s). O Robô para de abrir posições até reiniciar o pregão.`,
      net,
      trades,
    };
  }
  if (lossOn && net <= -config.maxDailyLoss) {
    return {
      short: `Perda máxima · ${brl(net)} de -${brl(config.maxDailyLoss)}`,
      reason: `Trava de perda diária acionada: ${brl(net)} ≤ -${brl(config.maxDailyLoss)} em ${trades} trade(s). O Robô para de abrir posições até reiniciar o pregão.`,
      net,
      trades,
    };
  }
  if (tradesOn && trades >= config.maxDailyTrades) {
    return {
      short: `Limite de trades · ${trades}/${config.maxDailyTrades}`,
      reason: `Limite de ${config.maxDailyTrades} trades do dia atingido (${trades} fechados, ${brl(net)}). O Robô para de abrir posições até reiniciar o pregão.`,
      net,
      trades,
    };
  }
  return null;
}
