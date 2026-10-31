/**
 * Regras de horário do pregão brasileiro (B3) compartilhadas entre o terminal (App.tsx),
 * os robôs sombra do coletor (paperStrategyBot.ts) e a ponte Python gerada.
 *
 * São DOIS portões, e agora os dois saem da estratégia configurada:
 *  - Janela de ENTRADAS: `tradingStartTime` → `tradingStopEntriesTime` (App usa via
 *    `isWithinTradingWindow`, em utils/tradingGates.ts).
 *  - ZERAGEM COMPULSÓRIA: `tradingCloseAllTime`. O WIN$N encerra às 17:45, então o padrão
 *    histórico é 17:30 — a janela de liquidação dura +35 min só para cobrir o encerramento.
 *    Fora dela (madrugada/noite, quando o simulador continua gerando ticks) o robô opera
 *    normalmente, senão ficaria parado o dia inteiro.
 */

/** Fallback quando a estratégia não informa a hora de zeragem: trava das 17:30. */
export const SESSION_CLOSE_LOCK_DEFAULT_TIME = '17:30';

/** Quanto tempo a trava fica no ar depois da hora de zeragem (liquidação + cancelamento de limitadas). */
export const SESSION_CLOSE_LIQUIDATION_WINDOW_MIN = 35;

/** 'HH:MM' → minutos do dia; null se vier vazio ou fora do formato. */
export function parseHHMM(value?: string): number | null {
  if (!value || typeof value !== 'string') return null;
  const [h, m] = value.split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m) || m < 0 || m > 59 || h < 0 || h > 23) return null;
  return Math.round(h) * 60 + Math.round(m);
}

const fmtMin = (min: number) =>
  `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

/** Minuto do dia em que a zeragem compulsória começa (a hora da estratégia, ou 17:30). */
export function sessionCloseLockStartMin(closeAllTime?: string): number {
  return parseHHMM(closeAllTime) ?? parseHHMM(SESSION_CLOSE_LOCK_DEFAULT_TIME)!;
}

/** Minuto do dia em que a trava de pregão se desliga (início + janela de liquidação). */
export function sessionCloseLockEndMin(closeAllTime?: string): number {
  return sessionCloseLockStartMin(closeAllTime) + SESSION_CLOSE_LIQUIDATION_WINDOW_MIN;
}

/** Rótulo 'HH:MM' para os avisos na tela, sempre igual ao valor configurado. */
export function sessionCloseLockLabel(closeAllTime?: string): string {
  return fmtMin(sessionCloseLockStartMin(closeAllTime));
}

/** O timestamp cai dentro da janela de fechamento obrigatório do pregão? */
export function isSessionCloseLock(timestamp: number, closeAllTime?: string): boolean {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return false;
  const d = new Date(timestamp);
  const minutes = d.getHours() * 60 + d.getMinutes();
  return minutes >= sessionCloseLockStartMin(closeAllTime) && minutes < sessionCloseLockEndMin(closeAllTime);
}
