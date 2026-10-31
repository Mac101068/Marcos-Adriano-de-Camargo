import { Tick } from '../types/trading';
import { ASSETS, AssetSpec, DEFAULT_ASSET_ID, formatPrice } from '../assets/assetRegistry';

/**
 * NÍVEIS RELEVANTES DE PREÇO DO PREGÃO.
 *
 * Função PURA e sem dependência de React de propósito: dá para conferir headless (npx tsx) e
 * reutilizar no gráfico e em qualquer legenda. O RenkoFlowChart só desenha o que ela devolver.
 *
 * Tudo é calculado sobre o DIA MAIS RECENTE do buffer de ticks (o dia-alvo do replay / o pregão
 * de hoje no feed do MT5), mais o dia anterior — que no replay é o dia de contexto e entrega as
 * referências oficiais de fechamento e ajuste diário. Como a sessão começa em 08:55, os primeiros
 * minutos são o leilão de abertura — e o VWAP dele é o nível que o trader realmente olha nessa hora.
 */

export type PriceLevelKey =
  | 'ajuste'
  | 'prevClose'
  | 'open'
  | 'auctionVwap'
  | 'dayHigh'
  | 'dayLow';

export interface PriceLevel {
  key: PriceLevelKey;
  /** Etiqueta curta desenhada no gráfico. */
  label: string;
  price: number;
  /** Detalhe para o hover/legenda (volume e janela que geraram o nível). */
  detail: string;
  /** Cor do traço e da etiqueta: cada nível tem a sua, sempre em tom discreto. */
  color: string;
}

/** Janela do leilão de abertura, contada a partir do 1º tick do dia (fallback = WIN). */
export const AUCTION_WINDOW_MIN = ASSETS[DEFAULT_ASSET_ID].session.auctionMinutes;

/** Janela do ajuste diário: média ponderada do fim do pregão anterior (fallback = WIN). */
export const SETTLEMENT_WINDOW_MIN = ASSETS[DEFAULT_ASSET_ID].session.settlementWindowMinutes;

/** Cor da curva de VWAP acumulada do dia — laranja, única curva do gráfico de níveis. */
export const VWAP_CURVE_COLOR = '#fb923c';

/** Abaixo disso o pregão ainda não tem ticks suficientes para um nível fazer sentido. */
const MIN_DAY_TICKS = 20;

/**
 * Cores por nível, escolhidas para darem um pouco de cor na tela preta sem brigar com os tijolos:
 * máxima verde limão, mínima vermelha, abertura azul clarinho, fechamento azul escuro, ajuste
 * branco. A VWAP saiu daqui e virou curva laranja (computeRunningVwap).
 */
export const LEVEL_COLORS: Record<PriceLevelKey, string> = {
  auctionVwap: '#94a3b8',
  open: '#93c5fd',
  dayHigh: '#a3e635',
  dayLow: '#ef4444',
  prevClose: '#2563eb',
  ajuste: '#f8fafc',
};

const LEVEL_LABELS: Record<PriceLevelKey, string> = {
  auctionVwap: 'LEILÃO',
  open: 'ABERTURA',
  dayHigh: 'MÁX',
  dayLow: 'MÍN',
  prevClose: 'FECHAMENTO',
  ajuste: 'AJUSTE',
};

/** Níveis mais importantes primeiro: na deduplicação quem fica é o que vier antes. */
const PRIORITY: PriceLevelKey[] = ['auctionVwap', 'ajuste', 'open', 'prevClose', 'dayHigh', 'dayLow'];

const dayKey = (ts: number) => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
};

const brlPts = (v: number) => v.toLocaleString('pt-BR', { maximumFractionDigits: 0 });

/** Preço no formato do ativo (WIN inteiro, dólar com 1 casa) para as legendas dos níveis. */
const fmtPrice = (v: number, asset: AssetSpec) => formatPrice(v, asset);

/** Volume-weighted average price; null se o volume total for zero (pregão morto). */
function vwapOf(list: Tick[]): number | null {
  let pv = 0;
  let vol = 0;
  for (const t of list) {
    const v = t.volume > 0 ? t.volume : 0;
    if (!Number.isFinite(t.price) || v <= 0) continue;
    pv += t.price * v;
    vol += v;
  }
  return vol > 0 ? pv / vol : null;
}

export function computeSessionLevels(
  ticks: Tick[],
  /** Ativo dono dos níveis: define as casas decimais da legenda e as janelas de pregão. */
  asset: AssetSpec = ASSETS[DEFAULT_ASSET_ID],
  auctionMinutes: number = asset.session.auctionMinutes
): PriceLevel[] {
  if (!Array.isArray(ticks) || ticks.length < MIN_DAY_TICKS) return [];

  // O buffer vem ordenado do mais antigo para o mais recente (allTicksRef); se vier invertido
  // (estado `ticks` da fita, mais recente primeiro), nós mesmos consertamos a ordem.
  const ordered =
    ticks[ticks.length - 1].timestamp >= ticks[0].timestamp ? ticks : [...ticks].reverse();

  const lastDay = dayKey(ordered[ordered.length - 1].timestamp);
  let startIdx = ordered.length - 1;
  while (startIdx > 0 && dayKey(ordered[startIdx - 1].timestamp) === lastDay) startIdx -= 1;

  const day = ordered.slice(startIdx);
  if (day.length < MIN_DAY_TICKS) return [];

  const levels: PriceLevel[] = [];
  const add = (key: PriceLevelKey, price: number, detail: string) =>
    levels.push({ key, label: LEVEL_LABELS[key], price, detail, color: LEVEL_COLORS[key] });

  // 1) Abertura: o primeiro preço do pregão é a referência contra a qual se mede o dia inteiro.
  const open = day[0].price;
  add(
    'open',
    open,
    `Primeiro tick do pregão às ${new Date(day[0].timestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`
  );

  // 2) VWAP do leilão: média ponderada pelo volume dos primeiros minutos, exatamente o trecho
  //    em que o book descobre o preço. Acima dele o dia abriu comprador; abaixo, vendedor.
  const auctionEnd = day[0].timestamp + Math.max(1, auctionMinutes) * 60_000;
  let auctionEndIdx = 0;
  while (auctionEndIdx < day.length && day[auctionEndIdx].timestamp < auctionEnd) auctionEndIdx += 1;
  const auction = day.slice(0, auctionEndIdx);
  const auctionVwap = vwapOf(auction);
  if (auctionVwap !== null && auction.length >= 5) {
    const vol = auction.reduce((acc, t) => acc + (t.volume > 0 ? t.volume : 0), 0);
    add(
      'auctionVwap',
      auctionVwap,
      `VWAP do leilão (${auction.length} ticks · ${brlPts(vol)} contratos nos primeiros ${Math.round(auctionMinutes)}min)`
    );
  }

  // 3) Máxima e mínima do pregão.
  let hi = day[0].price;
  let lo = day[0].price;
  for (const t of day) {
    if (t.price > hi) hi = t.price;
    if (t.price < lo) lo = t.price;
  }
  add('dayHigh', hi, `Máxima do pregão (${fmtPrice(hi, asset)} pts)`);
  add('dayLow', lo, `Mínima do pregão (${fmtPrice(lo, asset)} pts)`);

  // 4) DIA ANTERIOR (o dia de contexto do replay): fechamento e ajuste diário. Por isso estes
  //    dois níveis só aparecem com ~2 dias de dados no buffer — com um dia só não há o que medir.
  if (startIdx > 0) {
    const prev = ordered[startIdx - 1];
    const prevDayKey = dayKey(prev.timestamp);
    let prevStartIdx = startIdx - 1;
    while (prevStartIdx > 0 && dayKey(ordered[prevStartIdx - 1].timestamp) === prevDayKey) {
      prevStartIdx -= 1;
    }
    const prevDay = ordered.slice(prevStartIdx, startIdx);
    const prevDate = new Date(prev.timestamp).toLocaleDateString('pt-BR');
    add('prevClose', prev.price, `Fechamento da sessão anterior (${prevDate})`);

    // Ajuste B3 = preço oficial de liquidação, a média ponderada pelo volume do fim do pregão. A
    // janela exata varia por ativo (no WIN são os negócios depois das 15:30); aqui usamos os
    // últimos minutos do dia anterior, que é a mesma ideia com o dado que realmente temos.
    const settlementMinutes = Math.max(1, asset.session.settlementWindowMinutes);
    const settleStart = prev.timestamp - settlementMinutes * 60_000;
    // Janela estritamente depois de settleStart: com tick de 1 em 1 minuto isso são exatamente os
    // últimos minutos do fechamento, sem arrastar um 31º tick de fora da janela.
    const settleTail = prevDay.filter((t) => t.timestamp > settleStart);
    const ajuste = vwapOf(settleTail) ?? prev.price;
    add(
      'ajuste',
      ajuste,
      `Ajuste diário: VWAP dos últimos ${settlementMinutes}min de ${prevDate} (${settleTail.length} ticks)`
    );
  }

  // Deduplicação: níveis colados (menos de uma variação mínima) viram um só — fica o de maior
  // prioridade e o repetido é descartado, senão o gráfico ganharia três etiquetas no mesmo pixel.
  // No WIN isso segue sendo 1 pt (nada muda); num ativo de tick 0,5 a régua aperta sozinha.
  const glue = Math.min(1, asset.tickSize > 0 ? asset.tickSize : 1);
  const byPriority = [...levels].sort(
    (a, b) => PRIORITY.indexOf(a.key) - PRIORITY.indexOf(b.key)
  );
  const kept: PriceLevel[] = [];
  for (const lv of byPriority) {
    if (kept.some((k) => Math.abs(k.price - lv.price) < glue)) continue;
    kept.push(lv);
  }

  // Devolvido em ordem de preço (topo primeiro) para a leitura visual ficar estável.
  return kept.sort((a, b) => b.price - a.price);
}

// ===========================================================================
// VWAP ACUMULADA DO DIA — a curva, não o traço horizontal
// ===========================================================================

export interface VwapPoint {
  /** Posição do tijolo na série enviada ao gráfico (mesmo índice do eixo X do canvas). */
  index: number;
  price: number;
  /** Qual pregão gerou o ponto (0 = o primeiro dia da série). A curva quebra a cada troca. */
  seg: number;
}

export interface VwapCurve {
  points: VwapPoint[];
  /** VWAP acumulada do pregão mais recente, no último tick do buffer. */
  current: number | null;
}

/**
 * VWAP que anda com o pregão: para cada tijolo da série, a média ponderada pelo volume de todos
 * os ticks até o fechamento daquele tijolo, reiniciada a cada novo dia (VWAP é por pregão — por
 * isso o dia anterior também ganha a curva dele).
 *
 * O eixo X aqui é o tijolo, não o relógio: no Renko/Range o tempo é desigual, e é assim que a
 * curva sai alinhada com os blocos desenhados. Uma passada só nos ticks e nos tijolos (O(n)),
 * com amostragem para nunca devolver mais que `maxPoints`.
 */
export function computeRunningVwap(
  ticks: Tick[],
  boxes: { timeEnd: number }[],
  maxPoints = 3000
): VwapCurve {
  if (!Array.isArray(ticks) || ticks.length === 0 || !Array.isArray(boxes) || boxes.length === 0) {
    return { points: [], current: null };
  }

  const ordered =
    ticks[ticks.length - 1].timestamp >= ticks[0].timestamp ? ticks : [...ticks].reverse();

  const stride = Math.max(1, Math.ceil(boxes.length / Math.max(2, maxPoints)));
  const points: VwapPoint[] = [];

  let cursor = 0;
  let pv = 0;
  let vol = 0;
  let accDay = '';
  let seg = -1;
  // VWAP do pregão corrente (zera na virada) e a última vista (a que vai para o retorno).
  let dayVwap: number | null = null;
  let current: number | null = null;

  for (let i = 0; i < boxes.length; i++) {
    const boxEnd = boxes[i].timeEnd;
    let dayRolled = false;

    while (cursor < ordered.length && ordered[cursor].timestamp <= boxEnd) {
      const t = ordered[cursor];
      const dk = dayKey(t.timestamp);
      if (dk !== accDay) {
        // Novo pregão: zera o acumulador e abre um novo segmento da curva.
        accDay = dk;
        pv = 0;
        vol = 0;
        dayVwap = null;
        seg += 1;
        dayRolled = true;
      }
      const v = t.volume > 0 ? t.volume : 0;
      if (v > 0 && Number.isFinite(t.price)) {
        pv += t.price * v;
        vol += v;
      }
      cursor += 1;
    }

    if (vol > 0) dayVwap = pv / vol;
    // Sem volume no pregão ainda não há VWAP: não se desenha o valor do dia anterior.
    if (dayVwap === null) continue;
    current = dayVwap;
    // Guarda um ponto a cada `stride` tijolos, e sempre o primeiro de cada pregão.
    if (i % stride !== 0 && i !== boxes.length - 1 && !dayRolled) continue;
    points.push({ index: i, price: dayVwap, seg });
  }

  return { points, current };
}
