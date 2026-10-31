import { AUDIT_STORAGE_KEY, auditKeyForAsset } from '../services/orderAuditService';
import { ASSETS, DEFAULT_ASSET_ID, resolveAsset, type AssetId } from './assetRegistry';

/**
 * MIGRAÇÃO DA SELEÇÃO DE ATIVO (flag v1).
 *
 * A Fase 2 coloca um seletor no Header e grava o `assetId` escolhido dentro do
 * `AutomationConfig`. Existe migração porque o storage manda: `loadSavedConfig` e
 * `mergeConfig` fazem `{...DEFAULT, ...salvo}`, então um config gravado antes desta fase não tem
 * o campo e continuaria resolvendo só pelo prefixo do símbolo — e o livro de auditoria, que hoje
 * é uma chave única, passaria a ser lido por chave por ativo.
 *
 * O que esta migração faz, UMA única vez:
 *  - config ativo: sem `assetId`, grava o ativo resolvido do `symbol` (símbolo vazio ou
 *    desconhecido cai no WIN) e completa um `symbol` faltante com o `primarySymbol` do ativo;
 *  - biblioteca do Estúdio: a mesma regra em cada estratégia salva, contando quantas foram
 *    tocadas;
 *  - livro de auditoria: COPIA `fluxo_renko_intraday_audit_v3` para `..._v3_WIN` (o legado era
 *    todo WIN). A chave antiga fica onde está — nada é destruído, e se algo der errado ainda dá
 *    para voltar.
 *
 * O que esta migração NÃO toca: nenhum parâmetro de estratégia, janela de horário, trava
 * financeira ou valor que o operador ajustou.
 *
 * Ao subir outra regra de seleção no futuro: troque a flag (…_v2) — flag nova força rodar de novo.
 */

const CONFIG_KEY = 'fluxo_renko_ea_config_v3';
const LIBRARY_KEY = 'fluxo_strategy_library_v1';
const DONE_FLAG = 'fluxo_asset_selection_v1';

export interface AssetSelectionMigration {
  /** A configuração ativa ganhou um `assetId` que ela não tinha. */
  config: boolean;
  /** quantas estratégias salvas do Estúdio foram preenchidas. */
  strategies: number;
  /** O livro legado foi copiado para o livro do WIN. */
  auditCopied: boolean;
}

type LooseConfig = Record<string, unknown> & { assetId?: AssetId; symbol?: string };

/**
 * Preenche o ativo de um config gravado antes da Fase 2. Devolve o objeto novo só se algo mudou
 * (retornar `null` significa "não reescreve"), para nunca reordenar o JSON do operador à toa.
 */
function withAssetId(raw: unknown): LooseConfig | null {
  if (!raw || typeof raw !== 'object') return null;
  const c = raw as LooseConfig;
  if (c.assetId && ASSETS[c.assetId]) return null; // já tem ativo e ele é conhecido: intocado

  const id = resolveAsset(c.symbol).id;
  const next: LooseConfig = { ...c, assetId: id };
  if (!c.symbol) next.symbol = ASSETS[id].primarySymbol;
  return next;
}

/** Copia o livro único legado para o livro por ativo do WIN (sem apagar a chave antiga). */
function migrateLegacyAuditBook(): boolean {
  const winKey = auditKeyForAsset(DEFAULT_ASSET_ID);
  const legacy = localStorage.getItem(AUDIT_STORAGE_KEY);
  if (!legacy || localStorage.getItem(winKey)) return false;
  localStorage.setItem(winKey, legacy);
  return true;
}

export function migrateAssetSelection(): AssetSelectionMigration {
  const result: AssetSelectionMigration = { config: false, strategies: 0, auditCopied: false };
  try {
    if (localStorage.getItem(DONE_FLAG)) return result;

    const rawConfig = localStorage.getItem(CONFIG_KEY);
    if (rawConfig) {
      const migrated = withAssetId(JSON.parse(rawConfig));
      if (migrated) {
        localStorage.setItem(CONFIG_KEY, JSON.stringify(migrated));
        result.config = true;
      }
    }

    const rawLibrary = localStorage.getItem(LIBRARY_KEY);
    if (rawLibrary) {
      const list = JSON.parse(rawLibrary);
      if (Array.isArray(list)) {
        let touched = 0;
        const migrated = list.map((strategy: Record<string, unknown>) => {
          const nextConfig = withAssetId(strategy?.config);
          if (!nextConfig) return strategy;
          touched += 1;
          return { ...strategy, config: nextConfig };
        });
        if (touched > 0) {
          localStorage.setItem(LIBRARY_KEY, JSON.stringify(migrated));
          result.strategies = touched;
        }
      }
    }

    result.auditCopied = migrateLegacyAuditBook();

    // Só marca como feito depois das três leituras/escritas: se estourar acima, tenta de novo.
    localStorage.setItem(DONE_FLAG, '1');
  } catch {
    // Sem storage (modo privado / JSON corrompido): o `assetId` continua vindo do símbolo em
    // cada leitura e nada aqui é destruído.
  }
  return result;
}
