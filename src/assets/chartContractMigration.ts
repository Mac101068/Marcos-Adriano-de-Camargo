import { chartSymbolFor, resolveAsset, type AssetId } from './assetRegistry';

/**
 * MIGRAÇÃO DO CONTRATO DO GRÁFICO (flag v1).
 *
 * Regra de trabalho agora é uma linha só: **o gráfico abre o contrato VIGENTE** ('WINZ26') — o
 * papel que a corretora tem na conta. A série contínua ('WIN$N') continua no produto, mas como
 * símbolo interno do TESTE LONGO (o pedido de histórico ao MT5 e o coletor), não como escolha do
 * operador: quem assina a plataforma não tem motivo para escolher entre dois códigos do mesmo
 * ativo, e um contrato vencendo no meio do mês deixaria o terminal apontando para papel morto.
 *
 * Por que migração existe: o storage manda. `loadSavedConfig`/`mergeConfig` fazem
 * `{...DEFAULT, ...salvo}`, então quem já tinha 'WIN$N' gravado continuaria abrindo a contínua
 * mesmo com o padrão novo — mudar só o DEFAULT não faria nada em máquina nenhuma.
 *
 * Segurança: só é tocado o `symbol` EXATAMENTE igual à série contínua do ativo resolvido. Um
 * vencimento digitado à mão na tela de Parâmetros ('WINJ27', 'WINM27'…) é escolha deliberada e
 * nunca é reescrito. Ativo sem vigente confirmado no registro (WDO, BIT) também fica intacto —
 * inventar código de vencimento seria assinar um gráfico que não existe na corretora.
 *
 * Ao subir outra regra de contrato no futuro: INCREMENTE a versão da flag (…_v2).
 */

const CONFIG_KEY = 'fluxo_renko_ea_config_v3';
const LIBRARY_KEY = 'fluxo_strategy_library_v1';
const DONE_FLAG = 'fluxo_chart_vigente_v1';

type LooseConfig = Record<string, unknown> & { assetId?: AssetId; symbol?: string };

/**
 * Troca a contínua gravada pelo vigente do mesmo ativo. Devolve o objeto novo só se algo mudou —
 * retornar `null` é "não reescreve", para nunca mexer no JSON do operador à toa.
 */
function withVigente(raw: unknown): LooseConfig | null {
  if (!raw || typeof raw !== 'object') return null;
  const c = raw as LooseConfig;
  const saved = (c.symbol || '').toUpperCase().trim();
  if (!saved) return null; // sem símbolo gravado: herda o padrão novo sozinho

  const asset = resolveAsset(c.symbol, c.assetId);
  const chartSym = chartSymbolFor(asset);
  // Intactos: quem não está na contínua (vencimento digitado) e ativo sem vigente confirmado.
  if (saved !== asset.primarySymbol.toUpperCase()) return null;
  if (!asset.activeContract || chartSym.toUpperCase() === saved) return null;
  return { ...c, symbol: asset.activeContract };
}

export interface ChartContractMigration {
  config: boolean;
  strategies: number;
  /** Código para o qual a estratégia ativa foi movida (usado no aviso ao operador). */
  to: string | null;
}

export function migrateChartVigenteContract(): ChartContractMigration {
  const result: ChartContractMigration = { config: false, strategies: 0, to: null };
  try {
    if (localStorage.getItem(DONE_FLAG)) return result;

    const rawConfig = localStorage.getItem(CONFIG_KEY);
    if (rawConfig) {
      const parsed = JSON.parse(rawConfig);
      const migrated = withVigente(parsed);
      if (migrated) {
        localStorage.setItem(CONFIG_KEY, JSON.stringify(migrated));
        result.config = true;
        result.to = String(migrated.symbol ?? '');
      }
    }

    const rawLibrary = localStorage.getItem(LIBRARY_KEY);
    if (rawLibrary) {
      const list = JSON.parse(rawLibrary);
      if (Array.isArray(list)) {
        let touched = 0;
        const migrated = list.map((strategy: Record<string, unknown>) => {
          const nextConfig = withVigente(strategy?.config);
          if (!nextConfig) return strategy;
          touched += 1;
          if (!result.to) result.to = String(nextConfig.symbol ?? '');
          return { ...strategy, config: nextConfig };
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
    // Sem storage (modo privado / JSON corrompido): o padrão novo vale para o que for criado
    // daqui para frente e nada é destruído.
  }
  return result;
}
