import { DEFAULT_EA_CONFIG } from '../services/eaConfigService';

/**
 * Migração única da trava de horário.
 *
 * A regra de trabalho é: BLOQUEADO de 17:30 até 08:55 e LIBERADO das 08:55 (leilão à vista,
 * EA operando desde o 1º candle), com zeragem compulsória às 17:30 — e é o terminal que agora
 * obedece de verdade a hora de zeragem da estratégia (utils/sessionRules.ts lê
 * `tradingCloseAllTime`; antes ela era hardcoded e só a ponte Python respeitava o campo).
 *
 * Por que migração existe: `loadSavedConfig`/`mergeConfig` fazem `{...DEFAULT, ...salvo}`, então
 * o valor gravado SEMPRE vence o padrão novo — mudar só o DEFAULT não faria nada na sua máquina.
 *
 * Segurança: só é tocado quem está EXATAMENTE em algum quarteto de padrão antigo intocado
 * (lista `PRIOR_WINDOWS` abaixo). Se você ajustou qualquer um dos quatro campos na estratégia,
 * nada muda aqui. Roda uma vez por versão de flag e cobre a configuração ativa e a biblioteca
 * de estratégias do Estúdio.
 *
 * Ao subir uma nova regra de pregão: mude DEFAULT_EA_CONFIG, adicione o quarteto antigo em
 * `PRIOR_WINDOWS` e INCREMENTE a versão da flag (…_v3) — flag nova força rodar de novo.
 */

const CONFIG_KEY = 'fluxo_renko_ea_config_v3';
const LIBRARY_KEY = 'fluxo_strategy_library_v1';
const DONE_FLAG = 'fluxo_trading_window_08_55_17_30_v2';

type WindowQuartet = {
  tradingHoursEnabled: boolean;
  tradingStartTime: string;
  tradingStopEntriesTime: string;
  tradingCloseAllTime: string;
};

/** Padrões antigos que ninguém mexeu — cada um já foi o default do app em alguma versão. */
const PRIOR_WINDOWS: WindowQuartet[] = [
  // original: trava desligada e zeragem 17:45
  { tradingHoursEnabled: false, tradingStartTime: '09:05', tradingStopEntriesTime: '17:00', tradingCloseAllTime: '17:45' },
  // primeira versão da trava ligada (substituída pela janela com leilão)
  { tradingHoursEnabled: true, tradingStartTime: '09:00', tradingStopEntriesTime: '17:30', tradingCloseAllTime: '17:30' },
];

type LooseConfig = Record<string, unknown> & Partial<WindowQuartet>;

/** Tem a janela gravada E ela ainda é exatamente algum padrão antigo intocado? */
function isPriorWindow(raw: unknown): raw is LooseConfig {
  if (!raw || typeof raw !== 'object') return false;
  const c = raw as LooseConfig;
  const savedAnyWindowField =
    c.tradingStartTime !== undefined ||
    c.tradingStopEntriesTime !== undefined ||
    c.tradingCloseAllTime !== undefined ||
    c.tradingHoursEnabled !== undefined;
  if (!savedAnyWindowField) return false; // sem janela gravada: herda os padrões novos sozinho
  return PRIOR_WINDOWS.some(
    (w) =>
      (c.tradingHoursEnabled ?? undefined) === w.tradingHoursEnabled &&
      (c.tradingStartTime ?? undefined) === w.tradingStartTime &&
      (c.tradingStopEntriesTime ?? undefined) === w.tradingStopEntriesTime &&
      (c.tradingCloseAllTime ?? undefined) === w.tradingCloseAllTime
  );
}

/** Aplica a janela de trabalho atual (08:55–17:30, zeragem 17:30) — valores vindos dos padrões. */
function withCurrentWindow(c: LooseConfig): LooseConfig {
  return {
    ...c,
    tradingHoursEnabled: DEFAULT_EA_CONFIG.tradingHoursEnabled,
    tradingStartTime: DEFAULT_EA_CONFIG.tradingStartTime,
    tradingStopEntriesTime: DEFAULT_EA_CONFIG.tradingStopEntriesTime,
    tradingCloseAllTime: DEFAULT_EA_CONFIG.tradingCloseAllTime,
  };
}

export function migrateLegacyTradingWindow(): { config: boolean; strategies: number } {
  const result = { config: false, strategies: 0 };
  try {
    if (localStorage.getItem(DONE_FLAG)) return result;

    const rawConfig = localStorage.getItem(CONFIG_KEY);
    if (rawConfig) {
      const parsed = JSON.parse(rawConfig);
      if (isPriorWindow(parsed)) {
        localStorage.setItem(CONFIG_KEY, JSON.stringify(withCurrentWindow(parsed)));
        result.config = true;
      }
    }

    const rawLibrary = localStorage.getItem(LIBRARY_KEY);
    if (rawLibrary) {
      const list = JSON.parse(rawLibrary);
      if (Array.isArray(list)) {
        let touched = 0;
        const migrated = list.map((strategy: Record<string, unknown>) => {
          if (!strategy || !isPriorWindow(strategy.config)) return strategy;
          touched += 1;
          return { ...strategy, config: withCurrentWindow(strategy.config as LooseConfig) };
        });
        if (touched > 0) {
          localStorage.setItem(LIBRARY_KEY, JSON.stringify(migrated));
          result.strategies = touched;
        }
      }
    }

    // Só marca como feito depois das duas leituras: se estourar acima, tenta de novo na próxima
    localStorage.setItem(DONE_FLAG, '1');
  } catch {
    // Sem storage (modo privado / JSON corrompido): a trava nova vale para o que for criado daqui
    // para frente e nada é destruído.
  }
  return result;
}
