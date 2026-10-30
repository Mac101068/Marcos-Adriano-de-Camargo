/**
 * Regras de horário do pregão brasileiro (B3) compartilhadas entre o terminal (App.tsx)
 * e os robôs sombra do coletor de eficiência (paperStrategyBot.ts).
 *
 * O WIN$N encerra às 17:45. A trava entra às 17:30: o simulador liquida tudo o que estiver
 * aberto a mercado e para de abrir operações novas. A janela vai até 18:05 apenas para
 * cobrir o encerramento — fora dela (madrugada/noite, quando o simulador continua gerando
 * ticks) o robô opera normalmente, senão ficaria parado o dia inteiro.
 */

export const SESSION_CLOSE_LOCK_START_MIN = 17 * 60 + 30; // 17:30
export const SESSION_CLOSE_LOCK_END_MIN = 18 * 60 + 5; // 18:05 (fim da janela de liquidação)
export const SESSION_CLOSE_LOCK_LABEL = '17:30';

/** O timestamp cai dentro da janela de fechamento obrigatório do pregão? */
export function isSessionCloseLock(timestamp: number): boolean {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return false;
  const d = new Date(timestamp);
  const minutes = d.getHours() * 60 + d.getMinutes();
  return minutes >= SESSION_CLOSE_LOCK_START_MIN && minutes < SESSION_CLOSE_LOCK_END_MIN;
}
