import { Tick } from '../types/trading';
import type { VolumeSource } from './marketHistoryService';

/**
 * BANCO LOCAL DE FITA REAL (Time & Trades capturado).
 *
 * Por que existe: até aqui o replay só era "mercado de verdade" com a ponte MT5 CONECTADA
 * (resolveReplayTicks → REQUEST_HISTORY). Desconectado, o replay caía sempre no SINTÉTICO.
 * Este serviço persiste a fita REAL já baixada/observada, então UMA captura conectada rende
 * replays reais para sempre — mesmo offline, em outro navegador da mesma máquina não vale
 * (localStorage é por navegador), mas dentro do mesmo navegador sobrevive ao F5 e ao dia.
 *
 * Custos e limites (o motivo de ser um banco separado, não o coletor): um dia de ticks reais
 * é grande demais para gravar a cada tick. Aqui a escrita é pontual (um dia por vez, depois de
 * um pull real bem-sucedido), com teto de dias e de ticks/dia e expurgo do mais antigo quando o
 * `localStorage` reclama de cota.
 *
 * O serviço não conhece React nem WebSocket — testável headless.
 */

const STORAGE_KEY = 'fluxo_real_tape_v1';
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

/** Ordem de confiança de volume: o pior volumeSource do conjunto vale para o lote todo. */
const VOLUME_RANK: Record<VolumeSource, number> = { TICK: 2, M1_RATE: 1, NONE: 0 };

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
  private bank: BankShape;

  constructor() {
    this.bank = this.load();
  }

  private load(): BankShape {
    const empty: BankShape = { version: 1, days: {} };
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return empty;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || !parsed.days || typeof parsed.days !== 'object') {
        return empty;
      }
      // Parse defensivo: descarta dias malformados sem derrubar o boot.
      const days: Record<string, StoredDay> = {};
      for (const [key, v] of Object.entries(parsed.days as Record<string, any>)) {
        if (!v || !Array.isArray(v.ticks)) continue;
        const ticks = (v.ticks as any[]).filter(
          (t) => t && Number.isFinite(Number(t.timestamp)) && Number.isFinite(Number(t.price)) && Number(t.price) > 0,
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
  private persist(): boolean {
    for (let attempt = 0; attempt <= MAX_DAYS; attempt++) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.bank));
        return true;
      } catch {
        const keys = Object.keys(this.bank.days);
        if (keys.length === 0) return false;
        const oldest = keys.sort((a, b) => this.bank.days[a].capturedAt - this.bank.days[b].capturedAt)[0];
        delete this.bank.days[oldest];
      }
    }
    return false;
  }

  /**
   * Guarda (mesclando por id, sem duplicar) a fita real de um pull/histórico bem-sucedido.
   * Agrupa por dia; cada dia é limitado a MAX_TICKS_PER_DAY mantendo os mais recentes
   * (marca `truncated` para o replay ser honesto sobre o recorte).
   */
  save(ticks: Tick[], volumeSource: VolumeSource): { daysSaved: number } {
    const byDay = new Map<string, Tick[]>();
    for (const t of ticks) {
      if (!t || !Number.isFinite(t.price) || t.price <= 0) continue;
      const key = dayKeyOf(t.timestamp);
      if (!byDay.has(key)) byDay.set(key, []);
      byDay.get(key)!.push(t);
    }

    let daysSaved = 0;
    for (const [key, fresh] of byDay) {
      const existing = this.bank.days[key]?.ticks ?? [];
      const merged = new Map<string, Tick>();
      for (const t of existing) merged.set(String(t.id ?? t.timestamp), t);
      for (const t of fresh) merged.set(String(t.id ?? t.timestamp), t);
      let all = Array.from(merged.values()).sort((a, b) => a.timestamp - b.timestamp);
      let truncated = this.bank.days[key]?.truncated ?? false;
      if (all.length > MAX_TICKS_PER_DAY) {
        all = all.slice(all.length - MAX_TICKS_PER_DAY); // mantém o fim do período
        truncated = true;
      }
      this.bank.days[key] = {
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
    const keys = Object.keys(this.bank.days);
    if (keys.length > MAX_DAYS) {
      const drop = keys
        .sort((a, b) => (a < b ? -1 : 1))
        .slice(0, keys.length - MAX_DAYS);
      for (const k of drop) delete this.bank.days[k];
    }

    this.persist();
    return { daysSaved };
  }

  /** Retorna a fita real dos N dias mais recentes (ordenados por sessão), ou null se não há banco. */
  loadMostRecent(days: number): { ticks: Tick[]; volumeSource: VolumeSource; days: number; truncated: boolean } | null {
    const keys = Object.keys(this.bank.days).sort((a, b) => (a < b ? 1 : -1)).slice(0, Math.max(1, days));
    if (keys.length === 0) return null;
    const chosen = keys.sort((a, b) => (a < b ? -1 : 1)); // cronológico
    const ticks: Tick[] = [];
    let truncated = false;
    for (const k of chosen) {
      ticks.push(...this.bank.days[k].ticks);
      if (this.bank.days[k].truncated) truncated = true;
    }
    return {
      ticks,
      volumeSource: worstVolumeSource(chosen.map((k) => this.bank.days[k].volumeSource)),
      days: chosen.length,
      truncated,
    };
  }

  hasData(): boolean {
    return Object.keys(this.bank.days).length > 0;
  }

  /** Metadados leves para a tela (sem os ticks) — ordenado do mais recente ao mais antigo. */
  listDays(): Array<{ day: string; count: number; volumeSource: VolumeSource; capturedAt: number; truncated: boolean }> {
    return Object.values(this.bank.days)
      .map((d) => ({ day: d.day, count: d.count, volumeSource: d.volumeSource, capturedAt: d.capturedAt, truncated: d.truncated }))
      .sort((a, b) => (a.day < b.day ? 1 : -1));
  }

  clearAll(): void {
    this.bank = { version: 1, days: {} };
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }
}

export const realTapeService = new RealTapeService();
