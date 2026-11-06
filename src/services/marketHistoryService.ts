import { Tick } from '../types/trading';
import { AssetSpec, snapToTick } from '../assets/assetRegistry';

/**
 * HISTÓRICO REAL PELA PONTE MT5/XP.
 *
 * Até a Fase 2 o único mercado deste app era o SINTÉTICO (`utils/marketSimulator.ts`): o replay
 * de 1/3/5 dias reproduzia um pregão inventado com seed. A ponte do MT5 só falava para frente —
 * `copy_ticks_from(SYMBOL, now, ...)` no script gerado — então não existia caminho para "me dá
 * os últimos N dias desse contrato". Este serviço é a metade de front-end desse pedido:
 * correlaciona a resposta (chunks fora de ordem, deduplicados por id), normaliza cada tick com
 * os números do ATIVO pedido e decide se o que voltou presta para operar fluxo.
 *
 * O serviço não conhece React nem WebSocket: o App injeta a função `send` e chama `ingest()`
 * dentro do `socket.onmessage` que já existe. É assim que ele é testável headless.
 */

/** De onde veio o volume de cada tick — decide se delta/CVD são confiáveis. */
export type VolumeSource = 'TICK' | 'TICKS_REAIS' | 'M1_RATE' | 'NONE';

/**
 * Metadados que a ponte devolve no HISTORY_DONE. Não são decoração: `resolucaoMs` diz de quantos
 * em quantos milissegundos a fita real foi agrupada (e portanto qual é a menor virada de box que o
 * replay ainda consegue enxergar) e `arquivosServidos` diz qual recorte de disco atendeu cada dia —
 * a contínua da tela é servida pelo contrato vigente daquele pregão.
 */
export type HistoryMeta = {
  resolucaoMs?: number;
  /**
   * Resolução que o cliente pediu quando o orçamento de bytes obrigou a servir outra (mais grossa).
   * Existe para a tela poder dizer 'você pediu 100 ms, veio 1.000 ms' em vez de embelecer a troca.
   */
  resolucaoPedidaMs?: number;
  /** Datas AAAAMMDD efetivamente servidas da fita real. */
  diasServidos?: string[];
  arquivosServidos?: string[];
  /** Ticks de negócio lidos do arquivo antes de comprimir. */
  ticksReaisLidos?: number;
  contratosCompra?: number;
  contratosVenda?: number;
  /**
   * Faixa de fidelidade MEDIDA da resolução servida (pregão 04/Nov/2026, box 50 pts, contra a fita
   * cheia no mesmo motor). `validaEstrategia=false` não é timidez: é a diferença entre um replay que
   * pode julgar limiar de Δ e um que só reproduz o caminho -- em 4.000 ms o erro do Δ por box já é
   * 80% e em 8.000 ms 97%, porque o bucket engoliu as viradas que constroem o Δ.
   */
  validaEstrategia?: boolean;
  alinhamentoMedido?: number;
  erroDeltaMedido?: number;
  sinaisRecuperados?: string;
  /** Texto da ponte declarando o que a série é (e o que ela não mede). */
  nota?: string;
};

export type HistoryResult = {
  ticks: Tick[];
  /** `TICKS_REAIS` = fita da B3 comprimida; `M1_RATE` = 4 ticks fabricados por barra de 1min. */
  volumeSource: VolumeSource;
  /** Dias efetivamente recebidos (a corretora pode devolver menos do que foi pedido). */
  days: number;
  meta: HistoryMeta;
};

export type SufficiencyReport = {
  total: number;
  /** Fração dos ticks com volume 0 (0 a 1). */
  zeroVolumePct: number;
  /** Fração dos ticks sem agressão identificada (CROSS). */
  crossPct: number;
  verdict: 'OK' | 'VOLUME_BAIXO' | 'SEM_VOLUME';
};

type PendingRequest = {
  reqId: string;
  asset: AssetSpec;
  /** Buffer por id: chunk repetido ou fora de ordem nunca duplica tick. */
  ticks: Map<string, Tick>;
  onProgress?: (received: number) => void;
  resolve: (result: HistoryResult) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout> | null;
  volumeSource: VolumeSource;
  meta: HistoryMeta;
  days: number;
  /** Rearma o prazo de inatividade a cada mensagem recebida (veja `requestHistory`). */
  armar?: (ms: number) => void;
};

/**
 * Prazo do PRIMEIRO byte. Ler e comprimir um pregão custa 2,1M de linhas de um .gz — segundos de
 * disco/CPU do lado da ponte, e a ponte só manda o primeiro chunk quando o trabalho acabou. Um
 * timeout curto aqui mataria o replay de validação justo no caminho que ele precisa usar.
 */
const FIRST_BYTE_TIMEOUT_MS = 120_000;

/** Depois do primeiro chunk, a entrega está andando: silêncio de 20s já é conexão morta. */
const IDLE_TIMEOUT_MS = 20_000;

const HISTORY_MESSAGE_TYPES = new Set(['HISTORY_CHUNK', 'HISTORY_DONE', 'HISTORY_ERROR']);

export class MarketHistoryService {
  private pending = new Map<string, PendingRequest>();

  /** O payload é nosso? (o App usa isto para não engolir mensagem de outro ramo do onmessage) */
  static handles(type?: string): boolean {
    return !!type && HISTORY_MESSAGE_TYPES.has(type);
  }

  /**
   * Pede `days` dias de ticks reais de `symbol`. Resolve na chegada do `HISTORY_DONE`; rejeita em
   * `HISTORY_ERROR`, no timeout ou se o `send` falhar — o chamador decide o fallback (sintético).
   */
  requestHistory(
    opts: {
      reqId: string;
      symbol: string;
      days: number;
      asset: AssetSpec;
      send: (payload: string) => void;
      onProgress?: (received: number) => void;
      timeoutMs?: number;
    }
  ): Promise<HistoryResult> {
    const { reqId, symbol, days, asset, send, onProgress } = opts;
    // Um pedido por vez por reqId: recomeçar o replay com o mesmo id não pode deixar duas
    // promessas vivas disputando o mesmo buffer.
    this.drop(reqId);

    return new Promise<HistoryResult>((resolve, reject) => {
      const entry: PendingRequest = {
        reqId,
        asset,
        ticks: new Map(),
        onProgress,
        resolve,
        reject,
        timer: null,
        volumeSource: 'TICK',
        meta: {},
        days,
      };
      // Timeout de ATIVIDADE, não de duração: o prazo cheio vale até o primeiro chunk (a ponte
      // lê e comprime o pregão inteiro antes de mandar a primeira linha) e depois vira
      // inatividade — cada chunk que chega empurra a deadline. Assinaria um replay de 5 dias
      // com um cronômetro de 25s fixo, que é exatamente o tamanho do trabalho no disco.
      const armar = (ms: number) => {
        if (entry.timer) clearTimeout(entry.timer);
        entry.timer = setTimeout(() => {
          this.drop(reqId);
          reject(new Error(
            `A ponte do MT5 não respondeu ao pedido de histórico (${Math.round(ms / 1000)}s sem sinal).`
          ));
        }, ms);
      };
      armar(opts.timeoutMs ?? FIRST_BYTE_TIMEOUT_MS);
      entry.armar = armar;

      this.pending.set(reqId, entry);

      try {
        send(JSON.stringify({ action: 'REQUEST_HISTORY', reqId, symbol, days }));
      } catch (e) {
        this.drop(reqId);
        reject(new Error(`Não foi possível pedir histórico à ponte: ${String(e)}`));
      }
    });
  }

  /**
   * Alimenta uma mensagem recebida do socket. Devolve true quando a mensagem era de histórico
   * (mesmo de um pedido que já expirou — neste caso ela é ignorada em silêncio, sem quebrar).
   */
  ingest(payload: any): boolean {
    const type = payload?.type as string | undefined;
    if (!type || !HISTORY_MESSAGE_TYPES.has(type)) return false;

    const reqId = payload?.data?.reqId ?? payload?.reqId;
    const entry = reqId ? this.pending.get(String(reqId)) : undefined;
    if (!entry) return true; // pedido já concluído/cancelado: a resposta chega tarde, ignora
    entry.armar?.(IDLE_TIMEOUT_MS);

    if (type === 'HISTORY_CHUNK') {
      const chunk = Array.isArray(payload.data?.ticks) ? payload.data.ticks : [];
      for (const raw of chunk) {
        const tick = normalizeTick(raw, entry.asset);
        if (tick) entry.ticks.set(tick.id, tick);
      }
      if (payload.data?.volumeSource) entry.volumeSource = payload.data.volumeSource as VolumeSource;
      coletarMeta(entry.meta, payload.data);
      entry.onProgress?.(entry.ticks.size);
      return true;
    }

    if (type === 'HISTORY_DONE') {
      const ticks = [...entry.ticks.values()].sort((a, b) => a.timestamp - b.timestamp);
      coletarMeta(entry.meta, payload.data);
      const result: HistoryResult = {
        ticks,
        volumeSource: (payload.data?.volumeSource as VolumeSource) || entry.volumeSource,
        days: Number(payload.data?.days) || entry.days,
        meta: entry.meta,
      };
      this.finish(String(reqId));
      entry.resolve(result);
      return true;
    }

    // HISTORY_ERROR
    const reason = String(payload.data?.reason || 'a ponte do MT5 recusou o pedido de histórico');
    this.finish(String(reqId));
    entry.reject(new Error(reason));
    return true;
  }

  /** Cancela tudo (fechamento do socket): nenhuma promessa pode ficar pendendo para sempre. */
  dispose(): void {
    for (const reqId of [...this.pending.keys()]) {
      const entry = this.pending.get(reqId);
      this.finish(reqId);
      entry?.reject(new Error('A conexão com o MT5 caiu antes do histórico terminar.'));
    }
  }

  private finish(reqId: string): void {
    const entry = this.pending.get(reqId);
    if (entry?.timer) clearTimeout(entry.timer);
    this.pending.delete(reqId);
  }

  private drop(reqId: string): void {
    const existing = this.pending.get(reqId);
    if (!existing) return;
    if (existing.timer) clearTimeout(existing.timer);
    this.pending.delete(reqId);
  }

  /**
   * O tick de índice futuro no MT5 costuma chegar sem volume e sem flag de agressão — e é disso
   * que vivem CVD, delta e convergência (utils/renkoCalculator.ts). Este relatório é o que resolve
   * o aviso honesto ("esse histórico não sustenta fluxo") em vez de deixar a estratégia muda.
   */
  static assessSufficiency(ticks: Tick[]): SufficiencyReport {
    const total = ticks.length;
    if (total === 0) return { total: 0, zeroVolumePct: 1, crossPct: 1, verdict: 'SEM_VOLUME' };
    const zeroVolume = ticks.filter((t) => !(t.volume > 0)).length;
    const cross = ticks.filter((t) => t.aggressor === 'CROSS').length;
    const zeroVolumePct = zeroVolume / total;
    const crossPct = cross / total;
    const verdict = zeroVolumePct >= 0.8 ? 'SEM_VOLUME' : zeroVolumePct >= 0.2 ? 'VOLUME_BAIXO' : 'OK';
    return { total, zeroVolumePct, crossPct, verdict };
  }
}

/**
 * Copia para o `meta` os campos de procedência que a ponte manda no CHUNK/DONE.
 * Só grava o que veio: um M1_RATE não declara resolução de fita, e a tela tem de conseguir
 * distinguir "não informou" de "informou zero".
 */
function coletarMeta(meta: HistoryMeta, data: any): void {
  if (!data || typeof data !== 'object') return;
  if (typeof data.resolucaoMs === 'number') meta.resolucaoMs = data.resolucaoMs;
  if (typeof data.resolucaoPedidaMs === 'number') meta.resolucaoPedidaMs = data.resolucaoPedidaMs;
  if (Array.isArray(data.diasServidos)) meta.diasServidos = data.diasServidos.map(String);
  if (Array.isArray(data.arquivosServidos)) meta.arquivosServidos = data.arquivosServidos.map(String);
  if (typeof data.ticksReaisLidos === 'number') meta.ticksReaisLidos = data.ticksReaisLidos;
  if (typeof data.contratosCompra === 'number') meta.contratosCompra = data.contratosCompra;
  if (typeof data.contratosVenda === 'number') meta.contratosVenda = data.contratosVenda;
  if (typeof data.validaEstrategia === 'boolean') meta.validaEstrategia = data.validaEstrategia;
  if (typeof data.alinhamentoMedido === 'number') meta.alinhamentoMedido = data.alinhamentoMedido;
  if (typeof data.erroDeltaMedido === 'number') meta.erroDeltaMedido = data.erroDeltaMedido;
  if (typeof data.sinaisRecuperados === 'string') meta.sinaisRecuperados = data.sinaisRecuperados;
  if (typeof data.nota === 'string') meta.nota = data.nota;
}

/**
 * Converte o tick cru da ponte no `Tick` do app, com os números do ativo:
 * preço arredondado para a variação mínima SOMENTE se ele estiver a meia variação de um nível
 * válido (tick real de corretora pode vir 171500.4 por conta do FP), e agressor sempre válido.
 */
export function normalizeTick(raw: any, asset: AssetSpec): Tick | null {
  if (!raw || typeof raw !== 'object') return null;
  const timestamp = Number(raw.timestamp);
  const price = Number(raw.price);
  if (!Number.isFinite(timestamp) || !Number.isFinite(price) || price <= 0) return null;

  const snapped = snapToTick(price, asset);
  const near = asset.tickSize > 0 && Math.abs(price - snapped) <= asset.tickSize / 2;
  const aggressor = raw.aggressor === 'BUY' || raw.aggressor === 'SELL' ? raw.aggressor : 'CROSS';

  return {
    id: String(raw.id ?? `mt5-h-${timestamp}`),
    timestamp,
    timeStr:
      typeof raw.timeStr === 'string' && raw.timeStr.length > 0
        ? raw.timeStr
        : new Date(timestamp).toTimeString().split(' ')[0],
    price: near ? snapped : price,
    volume: Number.isFinite(Number(raw.volume)) && Number(raw.volume) > 0 ? Number(raw.volume) : 0,
    aggressor,
  };
}

export const marketHistoryService = new MarketHistoryService();
