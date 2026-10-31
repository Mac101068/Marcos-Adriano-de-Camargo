import { AutomationConfig } from '../types/trading';
import { SavedStrategy } from '../types/strategy';
import { DEFAULT_EA_CONFIG } from './eaConfigService';
import { ASSETS, resolveAsset, type AssetId } from '../assets/assetRegistry';

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

function mergeConfig(partial: unknown): AutomationConfig {
  const p = (partial ?? {}) as Partial<AutomationConfig>;
  return {
    ...DEFAULT_EA_CONFIG,
    ...p,
    // Estratégia salva antes da Fase 2 não tem `assetId`: sem resolver pelo símbolo, o spread do
    // DEFAULT devolveria WIN (R$ 0,20/pt) para uma estratégia gravada em WDO$N.
    assetId: (ASSETS[p.assetId as AssetId] ? p.assetId : resolveAsset(p.symbol as string).id) as AssetId,
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
}

export const StrategyLibraryService = new StrategyLibraryStore();
