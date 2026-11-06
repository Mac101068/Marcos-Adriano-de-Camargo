import { TradeOrder } from '../types/trading';
import { PaperTrade, SeriesKey } from '../utils/paperStrategyBot';
import type { HistoryMeta, VolumeSource } from './marketHistoryService';
import type { AssetId } from '../assets/assetRegistry';

/**
 * LEDGER DE RODADAS — auditoria por corrida de replay (Ciclo 15).
 *
 * O Raio-X sempre mostrou o pipeline AO VIVO, mas as ações ficavam espalhadas em três depósitos
 * separados (robô real + boleta + MT5 no livro de ordens; Coletor nos 6 contadores; Robô 2 no livro
 * da sombra). Este serviço junta tudo de UMA CORRIDA (uma "rodada" = um clique no replay 1d/3d/5d)
 * num registro persistente: sobrevive a F5, pode ser reaberto na tela e exportado em CSV padrão BR.
 *
 * É PURA CONTABILIDADE DE PAPEL: lê snapshots que já existem e os agrupa. Não tem socket, não tem
 * setOrders, não tem dispatch — nenhum caminho para a corretora real (regra 2). A lógica de
 * montagem (`buildRound`) é uma função pura separada do armazenamento, para ser conferida headless.
 */

const STORAGE_KEY = 'fluxo_round_audit_v1';
const MAX_ROUNDS = 60; // nº de rodadas guardadas (a mais antiga sai quando estoura)
const MAX_ACTIONS_PER_ROUND = 500; // teto de linhas de ação por rodada (protege a quota do storage)

/** De onde veio cada ação dentro de uma rodada — uma etiqueta por automação. */
export type RoundActionSource = 'ROBOT_EA' | 'MANUAL' | 'MT5_LIVE' | 'SHADOW' | 'COLLECTOR';

export const ROUND_SOURCE_LABEL: Record<RoundActionSource, string> = {
  ROBOT_EA: 'Robô 1 (EA)',
  MANUAL: 'Boleta manual',
  MT5_LIVE: 'MT5 real',
  SHADOW: 'Robô 2 (sombra)',
  COLLECTOR: 'Coletor (papel)',
};

/** Rótulo das séries medida pelo coletor (definido aqui para o serviço não depender do coletor). */
const SERIES_LABEL: Record<SeriesKey, string> = {
  renko: 'Renko',
  range: 'Range',
  tempo: 'Tempo',
  renko15r: 'Renko 15R',
  renko20r: 'Renko 20R',
  renko25r: 'Renko 25R',
};

/** Uma linha auditável: cada ordem/trade que uma automação produziu durante a rodada. */
export interface RoundAction {
  id: string;
  ts: number; // instante usado para ordenar a timeline
  timeStr: string; // HH:MM:SS
  source: RoundActionSource;
  series?: SeriesKey | 'shadow';
  side?: 'BUY' | 'SELL';
  role?: 'MAIN' | 'PYRAMID';
  title: string;
  detail: string;
  price?: number;
  contracts?: number;
  exitReason?: string;
  pnl?: number; // R$ (só quando a posição fechou)
  /**
   * De qual relógio vem o `timeStr`: 'wall' = relógio de parede (ordens reais, Date.now); 'bar'
   * = hora da BARRA simulada (sombra/coletor). Os dois nunca são o mesmo tempo, então a tela
   * precisa dizer isso em vez de fingir uma linha do tempo única (regra da honestidade).
   */
  clock: 'wall' | 'bar';
}

/** Contagem por automação — quantas ações cada uma teve na rodada. */
export interface RoundCounts {
  robot: number;
  manual: number;
  mt5: number;
  shadow: number;
  collector: number;
  total: number;
}

/** Fecho contábil de um conjunto de trades (livro real, sombra ou coletor). */
export interface RoundBookStat {
  trades: number; // liquidações
  wins: number;
  losses: number;
  breakeven: number;
  pnl: number; // R$
}

export interface RoundRecord {
  id: string;
  startedAt: number;
  finishedAt: number;
  dateLabel: string; // dd/mm/aaaa
  timeLabel: string; // HH:MM:SS
  // Metadados da corrida (vieram do pendingReplayMeta do App)
  days: number;
  speed: number;
  seed: number;
  source: 'REAL' | 'SYNTHETIC';
  volumeSource?: VolumeSource;
  /**
   * Procedência da série de ticks desta corrida (fonte, resolução do bucket, dias e arquivos que
   * atenderam cada dia). Fica no ledger porque uma rodada de validação só é reproduzível se souber
   * QUAL caminho de preço existia — dois replays de 22/Out com buckets de 500 ms e de 4 s não são
   * a mesma experiência de mercado.
   */
  fonte?: HistoryMeta;
  tickCount: number;
  operated: boolean;
  aborted: boolean;
  /**
   * true quando a corrida rodou com o MT5 CONECTADO: nesse caso os ticks AO VIVO também alimentam
   * sombra e coletor, então o snapshot deles mistura atividade real da sessão com a do replay — a
   * rodada é marcada como 'mista' para a tela avisar em vez de atribuir tudo silenciosamente ao replay.
   */
  liveMix: boolean;
  // Contexto do pregão simulado
  assetId: AssetId;
  assetSymbol: string;
  boxLabel: string;
  strategyName: string | null;
  strategyId: string | null;
  // Contabilidade consolidada por fonte
  counts: RoundCounts;
  book: RoundBookStat & { openCount: number }; // livro real (Robô 1 + boleta + MT5) — só no OPERA
  shadow: RoundBookStat; // Robô 2
  collector: RoundBookStat; // 6 séries em papel
  actions: RoundAction[];
  actionsTruncated: number; // quantas linhas a mais existiam além do teto
}

export interface BuildRoundInput {
  startedAt: number;
  finishedAt: number;
  /**
   * Piso de relógio de parede que isola as ORDENS REAIS desta corrida (sessionStart do App).
   * Só se aplica ao livro real (que usa Date.now()): Sombra e Coletor entram POR SNAPSHOT —
   * o replay zera os dois no clique, então tudo que eles carregam ao fim É desta rodada (e o
   * tempo deles é o da barra simulada, não o do relógio, por isso filtrar por data estaria errado).
   */
  roundStartTs: number;
  meta: {
    days: number;
    speed: number;
    seed: number;
    operated: boolean;
    aborted: boolean;
    source: 'REAL' | 'SYNTHETIC';
    volumeSource?: VolumeSource;
    fonte?: HistoryMeta;
    tickCount: number;
  };
  assetId: AssetId;
  assetSymbol: string;
  boxLabel: string;
  strategyName: string | null;
  strategyId: string | null;
  /** Rodada captada com MT5 conectado (ver RoundRecord.liveMix). */
  liveMix: boolean;
  realOrders: TradeOrder[];
  shadowTrades: PaperTrade[];
  collectorTrades: Array<{ series: SeriesKey; trades: PaperTrade[] }>;
}

const fmtTime = (ts: number) => new Date(ts).toTimeString().split(' ')[0];
const fmtDate = (ts: number) => new Date(ts).toLocaleDateString('pt-BR');
const uid = (p: string, ts: number) => `${p}-${ts}-${Math.random().toString(36).substring(2, 7)}`;

/** Fecho contábil de uma lista de PaperTrade já filtrada pela rodada. */
function statFromPaper(trades: PaperTrade[]): RoundBookStat {
  let wins = 0;
  let losses = 0;
  let breakeven = 0;
  let pnl = 0;
  for (const t of trades) {
    if (t.exitTime === undefined) continue; // ainda aberta: não liquida
    const fin = t.financial || 0;
    pnl += fin;
    if (fin > 0) wins += 1;
    else if (fin < 0) losses += 1;
    else breakeven += 1;
  }
  return { trades: wins + losses + breakeven, wins, losses, breakeven, pnl };
}

/** Título legível de um trade-papel (sombra/coletor). */
function paperTitle(t: PaperTrade, roleTag: string): string {
  const side = t.direction === 'BUY' ? 'COMPRA' : 'VENDA';
  return `${roleTag} ${side}`;
}

function paperDetail(t: PaperTrade, closed: boolean): string {
  const entry = `${t.entryPrice.toLocaleString('pt-BR')} pts`;
  const contratos = `${t.contracts} ctros`;
  if (!closed) return `Aberta em ${entry} · ${contratos} · ainda sem saída`;
  const saida = t.exitPrice !== undefined ? `${t.exitPrice.toLocaleString('pt-BR')} pts` : '—';
  const motivo = t.exitReason ? ` · ${t.exitReason.replace(/_/g, ' ')}` : '';
  const fin = t.financial !== undefined ? ` · R$ ${t.financial.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '';
  return `${entry} → ${saida}${motivo}${fin} · ${contratos} · ${t.triggerReason}`;
}

/**
 * Monta o registro de uma rodada a partir dos snapshots do fim da corrida. Função PURA: recebe,
 * calcula e devolve — não toca em localStorage nem em React, por isso é conferível headless.
 */
export function buildRound(input: BuildRoundInput): RoundRecord {
  const { startedAt, finishedAt, roundStartTs, meta } = input;
  // Livro real: Date.now(), então o corte por relógio de parede é correto e necessário (com MT5
  // conectado as posições reais NÃO são zeradas na largada — só entram as abertas nesta corrida).
  const withinWallClock = (ts: number | undefined) => (ts ?? 0) >= roundStartTs;

  const actions: RoundAction[] = [];

  // ---- Livro REAL (Robô 1 EA + boleta manual + MT5) ------------------------------------------
  const realThisRound = input.realOrders.filter((o) => withinWallClock(o.timestamp));
  const counts: RoundCounts = { robot: 0, manual: 0, mt5: 0, shadow: 0, collector: 0, total: 0 };
  let bookWins = 0;
  let bookLosses = 0;
  let bookBE = 0;
  let bookPnl = 0;
  let bookOpen = 0;

  for (const o of realThisRound) {
    const src: RoundActionSource =
      o.source === 'MT5_LIVE' ? 'MT5_LIVE' : o.source === 'MANUAL' ? 'MANUAL' : 'ROBOT_EA';
    if (src === 'MT5_LIVE') counts.mt5 += 1;
    else if (src === 'MANUAL') counts.manual += 1;
    else counts.robot += 1;

    const roleTag = o.role === 'PYRAMID' ? 'Pirâmide' : o.role === 'MAIN' ? 'Mãe' : 'Ordem';
    const side = o.type === 'BUY' ? 'COMPRA' : 'VENDA';
    const closed = o.status === 'CLOSED_PROFIT' || o.status === 'CLOSED_LOSS' || o.status === 'CLOSED_MANUAL';
    if (closed) {
      const fin = o.financialResult || 0;
      bookPnl += fin;
      if (fin > 0) bookWins += 1;
      else if (fin < 0) bookLosses += 1;
      else bookBE += 1;
    } else if (o.status === 'OPEN' || o.status === 'PENDING_LIMIT') {
      bookOpen += 1;
    }

    actions.push({
      id: uid('rbo', o.timestamp),
      ts: o.timestamp,
      timeStr: fmtTime(o.timestamp),
      source: src,
      side: o.type,
      role: o.role,
      title: `${roleTag} ${side}`,
      detail:
        `${o.entryPrice.toLocaleString('pt-BR')} pts · ${o.contracts} ctros · ` +
        (closed
          ? `saída ${o.exitReason ? o.exitReason.replace(/_/g, ' ') : o.status.replace(/_/g, ' ')}` +
            (o.financialResult !== undefined
              ? ` · R$ ${o.financialResult.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
              : '')
          : o.status === 'PENDING_LIMIT'
          ? 'aguardando reteste'
          : 'ainda aberta'),
      price: o.entryPrice,
      contracts: o.contracts,
      exitReason: o.exitReason,
      pnl: closed ? o.financialResult || 0 : undefined,
      clock: 'wall',
    });
  }

  // ---- Robô 2 (sombra) — snapshot inteiro (o replay zerou o livro no clique) ----------------
  const shadowThisRound = input.shadowTrades;
  counts.shadow = shadowThisRound.length;
  for (const t of shadowThisRound) {
    const closed = t.exitTime !== undefined;
    actions.push({
      id: uid('shd', t.entryTime),
      ts: t.entryTime,
      timeStr: fmtTime(t.entryTime),
      source: 'SHADOW',
      series: 'shadow',
      side: t.direction,
      role: t.role,
      title: paperTitle(t, t.role === 'PYRAMID' ? 'Pirâmide' : 'Mãe'),
      detail: paperDetail(t, closed),
      price: t.entryPrice,
      contracts: t.contracts,
      exitReason: t.exitReason,
      pnl: closed ? t.financial || 0 : undefined,
      clock: 'bar',
    });
  }

  // ---- Coletor (6 séries em papel) — snapshot inteiro (o replay zerou os contadores) ---------
  const collectorTradesAll: PaperTrade[] = [];
  for (const { series, trades } of input.collectorTrades) {
    const inRound = trades;
    collectorTradesAll.push(...inRound);
    counts.collector += inRound.length;
    for (const t of inRound) {
      const closed = t.exitTime !== undefined;
      actions.push({
        id: uid('col', t.entryTime),
        ts: t.entryTime,
        timeStr: fmtTime(t.entryTime),
        source: 'COLLECTOR',
        series,
        side: t.direction,
        role: t.role,
        title: `${SERIES_LABEL[series]} · ${t.direction === 'BUY' ? 'COMPRA' : 'VENDA'}`,
        detail: paperDetail(t, closed),
        price: t.entryPrice,
        contracts: t.contracts,
        exitReason: t.exitReason,
        pnl: closed ? t.financial || 0 : undefined,
        clock: 'bar',
      });
    }
  }

  // Ordena a timeline, mas agrupa por CLASSE DE RELÓGIO primeiro: as ordens reais (relógio de
  // parede) vêm juntas, depois o papel (hora da barra) — misturar os dois numa única ordem serial
  // produziria uma cronologia que não existiu (relógios incompatíveis).
  actions.sort((a, b) => (a.clock === b.clock ? a.ts - b.ts : a.clock === 'wall' ? -1 : 1));
  const actionsTruncated = Math.max(0, actions.length - MAX_ACTIONS_PER_ROUND);
  const keptActions = actions.slice(0, MAX_ACTIONS_PER_ROUND);
  counts.total = actions.length;

  return {
    id: uid('rod', finishedAt),
    startedAt,
    finishedAt,
    dateLabel: fmtDate(finishedAt),
    timeLabel: fmtTime(finishedAt),
    days: meta.days,
    speed: meta.speed,
    seed: meta.seed,
    source: meta.source,
    volumeSource: meta.volumeSource,
    fonte: meta.fonte,
    tickCount: meta.tickCount,
    operated: meta.operated,
    aborted: meta.aborted,
    liveMix: input.liveMix,
    assetId: input.assetId,
    assetSymbol: input.assetSymbol,
    boxLabel: input.boxLabel,
    strategyName: input.strategyName,
    strategyId: input.strategyId,
    counts,
    book: {
      trades: bookWins + bookLosses + bookBE,
      wins: bookWins,
      losses: bookLosses,
      breakeven: bookBE,
      pnl: bookPnl,
      openCount: bookOpen,
    },
    shadow: statFromPaper(shadowThisRound),
    collector: statFromPaper(collectorTradesAll),
    actions: keptActions,
    actionsTruncated,
  };
}

// ============================================================================================
// Armazenamento + assinatura para o React (mesmo micropadrão do coletor e da sombra).
// ============================================================================================

class RoundAuditService {
  private rounds: RoundRecord[] = [];
  private listeners = new Set<() => void>();
  private version = 0;
  private loaded = false;

  private ensureLoaded() {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          // Descarta itens malformados (chave editada à mão / escrita parcial / versão futura):
          // uma rodada quebrada não pode derrubar a página inteira do Raio-X.
          this.rounds = (parsed as RoundRecord[]).filter(
            (r) =>
              r &&
              typeof r.id === 'string' &&
              Array.isArray(r.actions) &&
              r.counts &&
              r.book &&
              r.shadow &&
              r.collector,
          );
        }
      }
    } catch {
      // Ignora storage corrompido: começa vazio, nunca quebra a tela.
    }
  }

  private persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.rounds));
    } catch {
      // Quota cheia: descarta as mais antigas e tenta de novo, sem derrubar a aplicação.
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.rounds.slice(0, 20)));
      } catch {
        // desiste em silêncio — a rodada do meio do caminho nunca é perdida em memória
      }
    }
  }

  /** Grava uma rodada no topo do ledger (mais recente primeiro) e avisa os assinantes. */
  record(round: RoundRecord): void {
    this.ensureLoaded();
    this.rounds = [round, ...this.rounds].slice(0, MAX_ROUNDS);
    this.persist();
    this.bump();
  }

  list(): RoundRecord[] {
    this.ensureLoaded();
    return this.rounds;
  }

  get(id: string): RoundRecord | null {
    return this.list().find((r) => r.id === id) ?? null;
  }

  clear(): void {
    this.ensureLoaded();
    this.rounds = [];
    this.persist();
    this.bump();
  }

  /** Última rodada registrada (para o chip "rodada N" do Raio-X). */
  latest(): RoundRecord | null {
    return this.list()[0] ?? null;
  }

  private bump() {
    this.version += 1;
    this.listeners.forEach((l) => l());
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getVersion = () => this.version;

  // ---- CSV padrão BR (UTF-8 com BOM, separador ';') ----------------------------------------

  exportRoundCSV(round: RoundRecord): void {
    this.download([round], `rodada_${round.assetSymbol.replace('$', '')}_${round.dateLabel.split('/').reverse().join('-')}`);
  }

  exportAllCSV(): void {
    this.download(this.list(), 'rodadas_raio_x');
  }

  private download(rounds: RoundRecord[], baseName: string): void {
    const headers = [
      'Rodada',
      'Data',
      'Hora corrida',
      'Dias',
      'Velocidade',
      'Seed',
      'Origem',
      'Volume',
      'Ticks',
      'Modo',
      'Ativo',
      'Estratégia',
      'Escala',
      'Hora da ação',
      'Automação',
      'Série',
      'Lado',
      'Papel',
      'Preço (pts)',
      'Contratos',
      'Motivo de saída',
      'Resultado (R$)',
      'Detalhe',
    ];
    const clean = (v?: string | number | null) => {
      if (v === undefined || v === null || v === '') return '';
      return `"${String(v).replace(/"/g, '""')}"`;
    };
    // Fonte e resolução na MESMA coluna do CSV (acrescentar coluna quebraria o cabeçalho abaixo):
    // uma rodada TICKS_REAIS sem `bucket=1000ms` no arquivo não diz a ninguém qual caminho existia.
    // O marcador de faixa é o que deixa o CSV falar a verdade: em bucket grosso o caminho vem e o
    // Δ não -- quem lê o estudo do arquivo precisa poder ver isso sem consultar a escada.
    const fonteVolume = (r: RoundRecord) => {
      const bucket = r.fonte?.resolucaoMs ? ` bucket=${r.fonte.resolucaoMs}ms` : '';
      const faixa = r.fonte?.validaEstrategia === false
        ? ' Δ-fora-da-faixa-validada'
        : r.fonte?.validaEstrategia === true ? ' Δ-validado-por-medida' : ' Δ-sem-medicao';
      return `${r.volumeSource || ''}${bucket}${faixa}`;
    };
    const num = (v?: number) =>
      v === undefined || v === null || isNaN(v) ? '' : v.toLocaleString('pt-BR', { maximumFractionDigits: 2 });

    const rows: string[] = [];
    for (const r of rounds) {
      if (r.actions.length === 0) {
        rows.push(
          [
            clean(r.id),
            clean(r.dateLabel),
            clean(r.timeLabel),
            r.days,
            `${r.speed}x`,
            `#${r.seed}`,
            clean(r.source === 'REAL' ? 'HISTÓRICO REAL (MT5)' : 'SINTÉTICO'),
            clean(fonteVolume(r)),
            r.tickCount,
            clean(r.operated ? 'OPERA' : 'silencioso'),
            clean(r.assetSymbol),
            clean(r.strategyName || ''),
            clean(r.boxLabel),
            clean('—'),
            clean('nenhuma ação'),
            '',
            '',
            '',
            '',
            '',
            '',
            '',
            '',
          ].join(';'),
        );
        continue;
      }
      for (const a of r.actions) {
        rows.push(
          [
            clean(r.id),
            clean(r.dateLabel),
            clean(r.timeLabel),
            r.days,
            `${r.speed}x`,
            `#${r.seed}`,
            clean(r.source === 'REAL' ? 'HISTÓRICO REAL (MT5)' : 'SINTÉTICO'),
            clean(fonteVolume(r)),
            r.tickCount,
            clean(r.operated ? 'OPERA' : 'silencioso'),
            clean(r.assetSymbol),
            clean(r.strategyName || ''),
            clean(r.boxLabel),
            clean(a.timeStr),
            clean(ROUND_SOURCE_LABEL[a.source]),
            clean(a.series ? (a.series === 'shadow' ? 'Robô 2' : SERIES_LABEL[a.series as SeriesKey]) : ''),
            clean(a.side === 'BUY' ? 'COMPRA' : a.side === 'SELL' ? 'VENDA' : ''),
            clean(a.role === 'MAIN' ? 'mãe' : a.role === 'PYRAMID' ? 'pirâmide' : ''),
            num(a.price),
            a.contracts ?? '',
            clean(a.exitReason ? a.exitReason.replace(/_/g, ' ') : ''),
            num(a.pnl),
            clean(a.detail),
          ].join(';'),
        );
      }
    }

    const csv = '\uFEFF' + [headers.join(';'), ...rows].join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `${baseName}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }
}

export const roundAuditService = new RoundAuditService();
