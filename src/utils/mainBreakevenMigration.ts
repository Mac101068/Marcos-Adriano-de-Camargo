import { DEFAULT_EA_CONFIG } from '../services/eaConfigService';

/**
 * Migração única da Alavanca A — "Ordem Mãe no breakeven ao bater TP de pirâmide".
 *
 * Por que existe: o banco A/B headless (motor + contabilidade idênticos ao terminal) mostrou que,
 * no padrão da Pirâmide, a mãe surfava SEM NENHUMA proteção (breakeven OFF e trailing OFF) e a
 * virada de fluxo devolvia quase todo o lucro das pirâmides. No sintético honesto, ligar o
 * breakeven na mãe TRIPLICOU a mesa (+R$650 → +R$2169) e cortou o rebaixamento em ~42%.
 *
 * A "regra que já mordeu" obriga esta migração: `loadSavedConfig`/`mergeConfig` fazem
 * `{...DEFAULT, ...salvo}`, então o valor gravado SEMPRE vence o padrão novo — mudar só o DEFAULT
 * não faria nada em uma máquina que já salvou a estratégia.
 *
 * Segurança ( conservadorismo ): só é tocada estratégia em MODO PIRÂMIDE cuja mãe está 100%
 * DESPROTEGIDA — `moveMainToBreakevenOnPyramidTp !== true` E `trailingStop !== true`. Quem já
 * ligou o breakeven ou o trailing por conta própria NÃO é mexido. Roda uma vez por versão de flag
 * e cobre tanto a configuração ativa quanto a biblioteca de estratégias do Estúdio. É reversível
 * pela mesma caixinha em Ajustes → Pirâmide.
 */

const CONFIG_KEY = 'fluxo_renko_ea_config_v3';
const LIBRARY_KEY = 'fluxo_strategy_library_v1';
const DONE_FLAG = 'fluxo_main_breakeven_on_pyr_tp_v1';

type LooseConfig = Record<string, unknown> & {
  strategyMode?: string;
  moveMainToBreakevenOnPyramidTp?: boolean;
  trailingStop?: boolean;
};

/** É Pirâmide e a mãe está sem nenhuma proteção (nem breakeven, nem trailing)? */
function isUnprotectedPyramid(raw: unknown): raw is LooseConfig {
  if (!raw || typeof raw !== 'object') return false;
  const c = raw as LooseConfig;
  return (
    c.strategyMode === 'PYRAMID_FLOW_CONFLUENCE' &&
    c.moveMainToBreakevenOnPyramidTp !== true &&
    c.trailingStop !== true
  );
}

/** Liga o breakeven na mãe (mesmo valor do padrão novo). */
function withMainBreakeven(c: LooseConfig): LooseConfig {
  return { ...c, moveMainToBreakevenOnPyramidTp: DEFAULT_EA_CONFIG.moveMainToBreakevenOnPyramidTp };
}

export function migrateMainBreakevenOnPyramidTp(): { config: boolean; strategies: number } {
  const result = { config: false, strategies: 0 };
  try {
    if (localStorage.getItem(DONE_FLAG)) return result;

    const rawConfig = localStorage.getItem(CONFIG_KEY);
    if (rawConfig) {
      const parsed = JSON.parse(rawConfig);
      if (isUnprotectedPyramid(parsed)) {
        localStorage.setItem(CONFIG_KEY, JSON.stringify(withMainBreakeven(parsed)));
        result.config = true;
      }
    }

    const rawLibrary = localStorage.getItem(LIBRARY_KEY);
    if (rawLibrary) {
      const list = JSON.parse(rawLibrary);
      if (Array.isArray(list)) {
        let touched = 0;
        const migrated = list.map((strategy: Record<string, unknown>) => {
          if (!strategy || !isUnprotectedPyramid(strategy.config)) return strategy;
          touched += 1;
          return { ...strategy, config: withMainBreakeven(strategy.config as LooseConfig) };
        });
        if (touched > 0) {
          localStorage.setItem(LIBRARY_KEY, JSON.stringify(migrated));
          result.strategies = touched;
        }
      }
    }

    // Só marca como feito depois das duas leituras: se estourar acima, tenta de novo na próxima.
    localStorage.setItem(DONE_FLAG, '1');
  } catch {
    // Sem storage (modo privado / JSON corrompido): o padrão novo vale para o que for criado daqui
    // para frente e nada é destruído.
  }
  return result;
}
