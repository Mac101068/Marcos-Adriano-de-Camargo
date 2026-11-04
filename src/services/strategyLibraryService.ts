import { AutomationConfig } from '../types/trading';
import { SavedStrategy } from '../types/strategy';
import { DEFAULT_EA_CONFIG } from './eaConfigService';
import { ASSETS, resolveAsset, DEFAULT_ASSET_ID, type AssetId } from '../assets/assetRegistry';

/**
 * Biblioteca de Estratégias do Estúdio (localStorage `fluxo_strategy_library_v1`).
 * CRUD simples e defensivo: cada estratégia lida volta a receber os campos novos
 * do AutomationConfig via merge com DEFAULT_EA_CONFIG — estratégia antiga salva
 * antes de um parâmetro existir nunca quebra o terminal.
 *
 * ATENÇÃO: salvar/editar aqui NÃO altera o config ativo. A ativação é sempre um
 * gesto explícito do operador (App.tsx aplica o snapshot + pausa o robô).
 */

const STORAGE_KEY = 'fluxo_strategy_library_v1';

/**
 * FASE A (banco de dados único): campos de RUNTIME/CONEXÃO que vivem só no config ativo —
 * nunca vão para a `SavedStrategy`. Todo o RESTO do `AutomationConfig` é campo de estratégia e
 * tem como fonte autoritativa a biblioteca.
 */
const RUNTIME_KEYS: ReadonlySet<keyof AutomationConfig> = new Set<keyof AutomationConfig>([
  'active',
  'dataSourceMode',
  'mt5Host',
  'mt5Port',
  'shadowRobot',
  'lastSavedTimestamp',
  'strategyId',
  'assetId',
  'symbol',
]);

/** Só os campos de runtime presentes em `cfg` (para re-aplicar por cima da estratégia). */
function pickRuntime(cfg: Partial<AutomationConfig>): Partial<AutomationConfig> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(cfg) as (keyof AutomationConfig)[]) {
    if (RUNTIME_KEYS.has(key)) out[key as string] = cfg[key];
  }
  return out as Partial<AutomationConfig>;
}

/** Divide um patch em { operational (vai para a estratégia), runtime (fica no config) }. */
export function splitStrategyPatch(patch: Partial<AutomationConfig>): {
  operational: Partial<AutomationConfig>;
  runtime: Partial<AutomationConfig>;
} {
  const operational: Record<string, unknown> = {};
  const runtime: Record<string, unknown> = {};
  for (const key of Object.keys(patch) as (keyof AutomationConfig)[]) {
    (RUNTIME_KEYS.has(key) ? runtime : operational)[key as string] = patch[key];
  }
  return { operational: operational as Partial<AutomationConfig>, runtime: runtime as Partial<AutomationConfig> };
}

/**
 * Merge defensivo de qualquer config parcial com o DEFAULT (campos novos que estratégia ou
 * sincronização antiga não tinham voltam saneados). Exportado para o App usar no "Importar
 * tudo" da sincronização de terminal — nenhum caminho aplica config cru sem saneamento.
 */
export function mergeConfig(partial: unknown): AutomationConfig {
  const p = (partial ?? {}) as Partial<AutomationConfig>;
  return {
    ...DEFAULT_EA_CONFIG,
    ...p,
    // Estratégia salva antes da Fase 2 não tem `assetId`: sem resolver pelo símbolo, o spread do
    // DEFAULT devolveria WIN (R$ 0,20/pt) para uma estratégia gravada em WDO$N.
    assetId: (ASSETS[p.assetId as AssetId] ? p.assetId : resolveAsset(p.symbol as string).id) as AssetId,
    // Fase A: `strategyId` é runtime e NÃO pertence à estratégia, mas sobrevive ao merge do config
    // ativo (load/import/sync) — sem isto, o spread do DEFAULT o apagaria e o vínculo se perderia.
    strategyId: typeof p.strategyId === 'string' && p.strategyId ? p.strategyId : null,
  };
}

class StrategyLibraryStore {
  list(): SavedStrategy[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter((s) => s && typeof s.id === 'string' && typeof s.name === 'string')
        .map((s) => ({
          id: s.id,
          name: s.name,
          description: typeof s.description === 'string' ? s.description : undefined,
          createdAt: Number(s.createdAt) || Date.now(),
          updatedAt: Number(s.updatedAt) || Date.now(),
          config: mergeConfig(s.config),
        }));
    } catch {
      return [];
    }
  }

  private persist(list: SavedStrategy[]) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  }

  /** Upsert pela id; nome único (ganha sufixo numérico se colidir com outra estratégia). */
  save(strategy: SavedStrategy): SavedStrategy {
    const list = this.list();
    const now = Date.now();
    let name = strategy.name.trim() || 'Estratégia sem nome';
    let suffix = 2;
    while (list.some((s) => s.name === name && s.id !== strategy.id)) {
      name = `${strategy.name.trim()} (${suffix++})`;
    }
    const clean: SavedStrategy = {
      ...strategy,
      name,
      updatedAt: now,
      createdAt: strategy.createdAt || now,
      config: mergeConfig(strategy.config),
    };
    const idx = list.findIndex((s) => s.id === clean.id);
    if (idx >= 0) list[idx] = clean;
    else list.push(clean);
    this.persist(list);
    return clean;
  }

  remove(id: string): void {
    this.persist(this.list().filter((s) => s.id !== id));
  }

  duplicate(id: string): SavedStrategy | null {
    const src = this.list().find((s) => s.id === id);
    if (!src) return null;
    return this.save({
      ...src,
      id: `strategy-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
      name: `${src.name} (cópia)`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      config: { ...src.config },
    });
  }

  /** Estratégia cujo nome corresponde ao profileName ativo (para a caixinha da tira de status). */
  findByProfileName(profileName?: string): SavedStrategy | undefined {
    if (!profileName) return undefined;
    return this.list().find((s) => s.name === profileName);
  }

  exportJson(strategy: SavedStrategy): string {
    return JSON.stringify(strategy, null, 2);
  }

  importJson(jsonStr: string): SavedStrategy {
    const parsed = JSON.parse(jsonStr);
    if (!parsed || typeof parsed !== 'object' || !parsed.config) {
      throw new Error('JSON sem campo "config"');
    }
    const now = Date.now();
    return {
      id: typeof parsed.id === 'string' ? parsed.id : `strategy-${now}`,
      name: typeof parsed.name === 'string' ? parsed.name : 'Estratégia importada',
      description: typeof parsed.description === 'string' ? parsed.description : undefined,
      createdAt: Number(parsed.createdAt) || now,
      updatedAt: now,
      config: mergeConfig(parsed.config),
    };
  }

  newFromConfig(config: AutomationConfig, name: string): SavedStrategy {
    const now = Date.now();
    return {
      id: `strategy-${now}-${Math.floor(Math.random() * 1e6)}`,
      name,
      createdAt: now,
      updatedAt: now,
      config: mergeConfig(config),
    };
  }

  // ==========================================================================
  // FASE A — biblioteca como banco de dados único
  // ==========================================================================

  /**
   * Materializa o config ativo a partir de uma estratégia: campos de estratégia vêm do
   * `SavedStrategy.config` (saneados), runtime/conexão vêm de `baseConfig`. Único funil que
   * produz config ativo — os leitores do App (handleIncomingTick, script, boleta) leem o resultado.
   */
  resolveOperational(strategy: SavedStrategy, baseConfig: Partial<AutomationConfig>): AutomationConfig {
    const runtime = pickRuntime(baseConfig);
    const activeAssetId = (runtime.assetId || baseConfig.assetId || strategy.config.assetId || DEFAULT_ASSET_ID) as AssetId;
    const activeSymbol = (runtime.symbol || baseConfig.symbol || strategy.config.symbol || ASSETS[activeAssetId]?.activeContract || ASSETS[activeAssetId]?.primarySymbol) as string;

    const stratAssetId = strategy.config.assetId || resolveAsset(strategy.config.symbol).id;
    const isDifferentAsset = stratAssetId !== activeAssetId;

    const merged = mergeConfig(strategy.config);
    if (isDifferentAsset) {
      // Se a estratégia foi salva para outro ativo (ex: WIN), preserva os pontos de trading calibrados do ativo atual (ex: WDO)
      const def = ASSETS[activeAssetId]?.tradeDefaults;
      if (def) {
        merged.boxPoints = Number(baseConfig.boxPoints) || def.boxPoints;
        merged.stopLossPoints = Number(baseConfig.stopLossPoints) || def.stopLossPoints;
        merged.takeProfitPoints = Number(baseConfig.takeProfitPoints) || def.takeProfitPoints;
        merged.partialPoints = Number(baseConfig.partialPoints) || def.partialPoints;
        merged.breakevenOffsetPoints = Number(baseConfig.breakevenOffsetPoints) || def.breakevenOffsetPoints;
        merged.trailingDistancePoints = Number(baseConfig.trailingDistancePoints) || def.trailingDistancePoints;
        merged.minDeltaThreshold = Number(baseConfig.minDeltaThreshold) || def.minDeltaThreshold;
      }
    }

    return {
      ...merged,
      ...runtime,
      assetId: activeAssetId,
      symbol: activeSymbol,
      strategyId: strategy.id,
    };
  }

  /**
   * Garante que TODO config ativo tenha uma estratégia por trás:
   * (1) `strategyId` válido existente → reusa; (2) `profileName` igual a uma estratégia → vincula
   * pelo id (não duplica); (3) senão cria "Estratégia ativa" a partir dos campos atuais.
   * Idempotente: depois de vinculado, sempre cai no caso (1).
   */
  ensureActiveStrategy(config: AutomationConfig): { strategy: SavedStrategy; strategyId: string } {
    const list = this.list();
    if (config.strategyId) {
      const byId = list.find((s) => s.id === config.strategyId);
      if (byId) return { strategy: byId, strategyId: byId.id };
    }
    if (config.profileName) {
      const byName = list.find((s) => s.name === config.profileName);
      if (byName) return { strategy: byName, strategyId: byName.id };
    }
    const created = this.save(this.newFromConfig(config, config.profileName?.trim() || 'Estratégia ativa'));
    return { strategy: created, strategyId: created.id };
  }

  /** Aplica só os campos de estratégia a uma `SavedStrategy` e salva. Id ausente/inexistente → null. */
  updateStrategyConfig(strategyId: string, operationalPatch: Partial<AutomationConfig>): SavedStrategy | null {
    const target = this.list().find((s) => s.id === strategyId);
    if (!target) return null;
    // Garante que nenhum runtime escape para dentro da estratégia, mesmo vindo de um patch malformado.
    const { operational } = splitStrategyPatch(operationalPatch);
    const merged = mergeConfig({ ...target.config, ...operational });
    return this.save({ ...target, config: merged, updatedAt: Date.now() });
  }
}

export const StrategyLibraryService = new StrategyLibraryStore();
