import { Tick } from '../types/trading';
import type { VolumeSource } from './marketHistoryService';
import { AssetId, ASSETS } from '../assets/assetRegistry';

/**
 * BANCO LOCAL DE FITA REAL (Time & Trades capturado) SEPARADO POR ATIVO.
 *
 * Cada ativo (WIN, WDO, BTC) possui seu próprio armazenamento isolado:
 * `fluxo_real_tape_${assetId}_v1`.
 * Isso impede que ticks de Dólar (5.000 pts) vazem para o Mini Índice (170.000 pts)
 * e vice-versa quando o replay offline é executado.
 */

const STORAGE_PREFIX = 'fluxo_real_tape_';
const MAX_DAYS = 6;
const MAX_TICKS_PER_DAY = 40_000;

interface StoredDay {
  day: string; // YYYY-MM-DD local
  capturedAt: number;
  volumeSource: VolumeSource;
  count: number;
  truncated: boolean;
  ticks: Tick[];
}

interface BankShape {
  version: 1;
  days: Record<string, StoredDay>;
}

function getStorageKey(assetId: AssetId): string {
  return `${STORAGE_PREFIX}${assetId}_v1`;
}

function migrateLegacyStorage(): void {
  try {
    const legacyRaw = localStorage.getItem('fluxo_real_tape_v1');
    if (!legacyRaw) return;
    const parsed = JSON.parse(legacyRaw);
    if (parsed && typeof parsed === 'object' && parsed.days) {
      let detectedAsset: AssetId = 'WIN';
      for (const day of Object.values(parsed.days as Record<string, any>)) {
        if (day && Array.isArray(day.ticks) && day.ticks.length > 0) {
          const samplePrice = Number(day.ticks[0]?.price);
          if (samplePrice > 0) {
            if (samplePrice < 20_000) detectedAsset = 'WDO';
            else if (samplePrice > 200_000) detectedAsset = 'BTC';
            else detectedAsset = 'WIN';
            break;
          }
        }
      }
      const targetKey = getStorageKey(detectedAsset);
      if (!localStorage.getItem(targetKey)) {
        localStorage.setItem(targetKey, legacyRaw);
      }
    }
    localStorage.removeItem('fluxo_real_tape_v1');
  } catch {
    /* ignore */
  }
}

/**
 * Ordem de confiança de volume: o pior volumeSource do conjunto vale para o lote todo.
 * TICK (fita crua, tick a tick) > TICKS_REAIS (a mesma fita real comprimida em buckets — os
 * somatórios de compra/venda batem com o arquivo, mas a granularidade de tempo é do bucket,
 * não do print) > M1_RATE (volume fabricado da barra de 1min) > NONE. A ordem é também o que
 * faz o `worstVolumeSource` acima funcionar: ele começa em TICK e só desce, então qualquer
 * valor novo precisa de posto próprio — num empate o rótulo do lote ficaria no valor anterior.
 */
const VOLUME_RANK: Record<VolumeSource, number> = { TICK: 3, TICKS_REAIS: 2, M1_RATE: 1, NONE: 0 };

/** Chave de sessão (dia local) de um timestamp — mesma regra do motor Renko. */
function dayKeyOf(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function worstVolumeSource(sources: VolumeSource[]): VolumeSource {
  if (sources.length === 0) return 'NONE';
  return sources.reduce(
    (worst, s) => (VOLUME_RANK[s] < VOLUME_RANK[worst] ? s : worst),
    'TICK' as VolumeSource,
  );
}

export class RealTapeService {
  private banks: Partial<Record<AssetId, BankShape>> = {};

  constructor() {
    migrateLegacyStorage();
  }

  private getBank(assetId: AssetId): BankShape {
    if (!this.banks[assetId]) {
      this.banks[assetId] = this.load(assetId);
    }
    return this.banks[assetId]!;
  }

  private load(assetId: AssetId): BankShape {
    const empty: BankShape = { version: 1, days: {} };
    try {
      const raw = localStorage.getItem(getStorageKey(assetId));
      if (!raw) return empty;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || !parsed.days || typeof parsed.days !== 'object') {
        return empty;
      }
      const spec = ASSETS[assetId];
      const isPriceSane = (p: number) => {
        if (!spec) return true;
        return Math.abs(p - spec.basePrice) / spec.basePrice < 0.45;
      };

      // Parse defensivo: descarta dias malformados sem derrubar o boot.
      const days: Record<string, StoredDay> = {};
      for (const [key, v] of Object.entries(parsed.days as Record<string, any>)) {
        if (!v || !Array.isArray(v.ticks)) continue;
        const ticks = (v.ticks as any[]).filter(
          (t) => t && Number.isFinite(Number(t.timestamp)) && Number.isFinite(Number(t.price)) && Number(t.price) > 0 && isPriceSane(Number(t.price)),
        );
        if (ticks.length === 0) continue;
        days[key] = {
          day: key,
          capturedAt: Number(v.capturedAt) || 0,
          volumeSource: (v.volumeSource === 'TICK' || v.volumeSource === 'M1_RATE' || v.volumeSource === 'NONE'
            ? v.volumeSource
            : 'NONE') as VolumeSource,
          count: ticks.length,
          truncated: !!v.truncated,
          ticks: ticks as Tick[],
        };
      }
      return { version: 1, days };
    } catch {
      return empty;
    }
  }

  /** Grava com expurgo do dia mais antigo em caso de cota estourada. Retorna false se não coube. */
  private persist(assetId: AssetId): boolean {
    const bank = this.getBank(assetId);
    const key = getStorageKey(assetId);
    for (let attempt = 0; attempt <= MAX_DAYS; attempt++) {
      try {
        localStorage.setItem(key, JSON.stringify(bank));
        return true;
      } catch {
        const keys = Object.keys(bank.days);
        if (keys.length === 0) return false;
        const oldest = keys.sort((a, b) => bank.days[a].capturedAt - bank.days[b].capturedAt)[0];
        delete bank.days[oldest];
      }
    }
    return false;
  }

  /**
   * Guarda (mesclando por id, sem duplicar) a fita real de um pull/histórico bem-sucedido.
   * Agrupa por dia; cada dia é limitado a MAX_TICKS_PER_DAY mantendo os mais recentes
   * (marca `truncated` para o replay ser honesto sobre o recorte).
   */
  save(ticks: Tick[], volumeSource: VolumeSource, assetId: AssetId = 'WIN'): { daysSaved: number } {
    const spec = ASSETS[assetId];
    const isPriceSane = (p: number) => {
      if (!spec) return true;
      return Math.abs(p - spec.basePrice) / spec.basePrice < 0.45;
    };

    const byDay = new Map<string, Tick[]>();
    for (const t of ticks) {
      if (!t || !Number.isFinite(t.price) || t.price <= 0) continue;
      if (!isPriceSane(t.price)) continue; // Rejeita ticks de outro ativo (ex: 5.000 no WIN ou 170.000 no WDO)
      const key = dayKeyOf(t.timestamp);
      if (!byDay.has(key)) byDay.set(key, []);
      byDay.get(key)!.push(t);
    }

    const bank = this.getBank(assetId);
    let daysSaved = 0;
    for (const [key, fresh] of byDay) {
      const existing = bank.days[key]?.ticks ?? [];
      const merged = new Map<string, Tick>();
      for (const t of existing) merged.set(String(t.id ?? t.timestamp), t);
      for (const t of fresh) merged.set(String(t.id ?? t.timestamp), t);
      let all = Array.from(merged.values()).sort((a, b) => a.timestamp - b.timestamp);
      let truncated = bank.days[key]?.truncated ?? false;
      if (all.length > MAX_TICKS_PER_DAY) {
        all = all.slice(all.length - MAX_TICKS_PER_DAY); // mantém o fim do período
        truncated = true;
      }
      bank.days[key] = {
        day: key,
        capturedAt: Date.now(),
        volumeSource,
        count: all.length,
        truncated,
        ticks: all,
      };
      daysSaved++;
    }

    // Teto de dias: mantém os mais recentes por data de sessão.
    const keys = Object.keys(bank.days);
    if (keys.length > MAX_DAYS) {
      const drop = keys
        .sort((a, b) => (a < b ? -1 : 1))
        .slice(0, keys.length - MAX_DAYS);
      for (const k of drop) delete bank.days[k];
    }

    this.persist(assetId);
    return { daysSaved };
  }

  /** Retorna a fita real dos N dias mais recentes (ordenados por sessão), ou null se não há banco. */
  loadMostRecent(days: number, assetId: AssetId = 'WIN'): { ticks: Tick[]; volumeSource: VolumeSource; days: number; truncated: boolean } | null {
    const bank = this.getBank(assetId);
    const keys = Object.keys(bank.days).sort((a, b) => (a < b ? 1 : -1)).slice(0, Math.max(1, days));
    if (keys.length === 0) return null;
    const chosen = keys.sort((a, b) => (a < b ? -1 : 1)); // cronológico
    const ticks: Tick[] = [];
    let truncated = false;
    for (const k of chosen) {
      ticks.push(...bank.days[k].ticks);
      if (bank.days[k].truncated) truncated = true;
    }
    return {
      ticks,
      volumeSource: worstVolumeSource(chosen.map((k) => bank.days[k].volumeSource)),
      days: chosen.length,
      truncated,
    };
  }

  hasData(assetId: AssetId = 'WIN'): boolean {
    return Object.keys(this.getBank(assetId).days).length > 0;
  }

  /** Metadados leves para a tela (sem os ticks) — ordenado do mais recente ao mais antigo. */
  listDays(assetId: AssetId = 'WIN'): Array<{ day: string; count: number; volumeSource: VolumeSource; capturedAt: number; truncated: boolean }> {
    const bank = this.getBank(assetId);
    return Object.values(bank.days)
      .map((d) => ({ day: d.day, count: d.count, volumeSource: d.volumeSource, capturedAt: d.capturedAt, truncated: d.truncated }))
      .sort((a, b) => (a.day < b.day ? 1 : -1));
  }

  clearAll(assetId?: AssetId): void {
    if (assetId) {
      this.banks[assetId] = { version: 1, days: {} };
      try {
        localStorage.removeItem(getStorageKey(assetId));
      } catch {
        /* ignore */
      }
    } else {
      this.banks = {};
      try {
        localStorage.removeItem(getStorageKey('WIN'));
        localStorage.removeItem(getStorageKey('WDO'));
        localStorage.removeItem(getStorageKey('BTC'));
      } catch {
        /* ignore */
      }
    }
  }
}

export const realTapeService = new RealTapeService();
