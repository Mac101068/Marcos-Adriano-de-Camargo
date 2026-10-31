/**
 * REGISTRO DE ATIVO — a única fonte dos números que mudam de um contrato para o outro.
 *
 * Antes desta fase, o Mini Índice estava SOLDADO no código: `* 0.2` (R$ por ponto) em 15 pontos
 * de 7 arquivos, o preço-base `128500` em 22 pontos e o "tick de 5 pontos / 1R = 5 pts" em 10.
 * Trocar de ativo (mini dólar, bitcoin) exigia caçar número por número — e errava: o sanitizador
 * de ordens comparava com 128.500 e descartaria QUALQUER ordem de um WDO (~5.300 pts).
 *
 * Tudo que depende de ativo mora aqui. Estratégia, Renko, fluxo e portões continuam trabalhando
 * em PONTOS; só convertem para dinheiro/formatação ao chegar na tela, via estas funções.
 *
 * Fase 1: só o WIN está 'ativo'. WDO e BTC já têm linha para a forma do registro ficar provada.
 * Fase 2: existe seletor na tela e o id escolhido mora no config — mas um spec 'a_confirmar'
 * SÓ vira ensaio (Robô OFF, ponte armada não). Homologar é trocar `status` aqui: nada mais
 * no app precisa mudar para o WDO ficar liberado de verdade.
 */

/**
 * Permite ENSAIAR um spec ainda não homologado (depois de uma confirmação explícita na tela).
 * Trancar isto numa linha é o botão de pânico se um dia o ensaio de dólar der problema.
 */
export const ALLOW_UNCONFIRMED_PREVIEW = true;

export type AssetId = 'WIN' | 'WDO' | 'BTC';

export interface AssetSessionSpec {
  /** Abertura do pregão no relógio de Brasília ("HH:MM"). */
  open: string;
  /** Fechamento do pregão ("HH:MM") — não confundir com a trava de entradas da estratégia. */
  close: string;
  /** Fim de semana tem pregão? (bitcoin negocia fora de seg–sex) */
  weekdaysOnly: boolean;
  /** Janela do leilão de abertura, em minutos, contada do 1º tick (utils/priceLevels). */
  auctionMinutes: number;
  /** Janela do ajuste diário: média ponderada dos últimos N minutos do pregão anterior. */
  settlementWindowMinutes: number;
}

export interface AssetSpec {
  id: AssetId;
  label: string;
  /** Código do contrato que o seletor grava no config e a ponte do MT5 usa (WIN$N, WDO$N...). */
  primarySymbol: string;
  /** Prefixos de código B3/MT5 do ativo: casa 'WIN$N', 'WINZ26', 'WDO$N', 'WBRA10'... */
  prefixes: string[];
  /** R$ por ponto, por contrato. WIN = 0,20 | WDO = 0,10. */
  pointValue: number;
  /** Menor variação de preço, em pontos. WIN = 5 | WDO = 0,5. */
  tickSize: number;
  /** Casas decimais do preço na tela (WIN 0, dólar 1). */
  decimals: number;
  /**
   * Preço de referência do mercado SINTÉTICO e fallback do eixo Y. Quando o MT5 conecta, o
   * preço real manda e este valor só serve de ponto de partida — é por isso que ele precisa
   * acompanhar o nível corrente do contrato (WINZ26: ajuste anterior ~171.500).
   */
  basePrice: number;
  /** Tolerância do sanitizador de ordens, em fração do basePrice (0.05 = 5%). */
  staleTolerancePct: number;
  /** Escalas de Renko que fazem sentido para a volatilidade do ativo (F2 usa). */
  renkoDefaults: number[];
  session: AssetSessionSpec;
  /** 'a_confirmar' marca spec ainda não validado na corretora — nunca vira padrão silencioso. */
  status: 'ativo' | 'a_confirmar';
  contractNote: string;
}

export const ASSETS: Record<AssetId, AssetSpec> = {
  WIN: {
    id: 'WIN',
    label: 'Mini Índice (WIN)',
    primarySymbol: 'WIN$N',
    prefixes: ['WIN'],
    pointValue: 0.2,
    tickSize: 5,
    decimals: 0,
    // WINZ26 (dez/2026): ajuste anterior da sessão, informado pelo operador. O valor antigo
    // (128.500) era de um pregão já distante e deixava o sintético e o sanitizador defasados.
    basePrice: 171500,
    staleTolerancePct: 0.05,
    renkoDefaults: [25, 50, 100],
    session: {
      open: '08:55',
      close: '17:45',
      weekdaysOnly: true,
      auctionMinutes: 10,
      settlementWindowMinutes: 30,
    },
    status: 'ativo',
    contractNote: '1 contrato = R$ 0,20 por ponto (variação mínima de 5 pontos = 1R)',
  },
  WDO: {
    id: 'WDO',
    label: 'Mini Dólar (WDO)',
    primarySymbol: 'WDO$N',
    prefixes: ['WDO', 'DOL'],
    pointValue: 0.1,
    tickSize: 0.5,
    decimals: 1,
    basePrice: 5300,
    staleTolerancePct: 0.05,
    renkoDefaults: [2, 5, 10],
    session: {
      // Horário de pregão do dólar e o fix das 13:00 (PTAX) ainda serão tratados — Fase 2/3.
      open: '09:00',
      close: '18:00',
      weekdaysOnly: true,
      auctionMinutes: 10,
      settlementWindowMinutes: 30,
    },
    status: 'a_confirmar',
    contractNote: 'A CONFIRMAR NA CORRETORA: R$ 0,10 por ponto, tick de 0,5 ponto',
  },
  BTC: {
    id: 'BTC',
    label: 'Bitcoin B3 (BIT/WBRA)',
    // 'BIT$N' é o código que o seletor grava HOJE; o exato do produto B3 (BIT x WBRA) ainda
    // será confirmado na corretora junto com o resto do spec.
    primarySymbol: 'BIT$N',
    prefixes: ['BTC', 'BIT', 'WBRA'],
    // Placeholder declarado (não é chute "oficial": nenhum código consome este ativo na Fase 1).
    // O contrato WBRA é fracionário e o ponto em R$ varia com a especificação da B3/corretora.
    pointValue: 1,
    tickSize: 5,
    decimals: 0,
    basePrice: 5000,
    staleTolerancePct: 0.15,
    renkoDefaults: [50, 100, 200],
    session: {
      open: '09:00',
      close: '18:00',
      weekdaysOnly: false, // cripto negocia fora de seg–sex; o gap de fim de semana é real
      auctionMinutes: 10,
      settlementWindowMinutes: 30,
    },
    status: 'a_confirmar',
    contractNote: 'A CONFIRMAR NA CORRETORA: contrato, valor do ponto e horário de pregão',
  },
};

/**
 * Ativo de fallback: config antigo sem `assetId` e símbolo não reconhecido caem aqui.
 * (Na Fase 1 era também o único ativo consumido; desde a Fase 2 o que manda é `config.assetId`.)
 */
export const DEFAULT_ASSET_ID: AssetId = 'WIN';

/**
 * Traduz o que está gravado na estratégia em spec.
 * Ordem de grandeza: (1) o id escolhido no seletor, (2) o prefixo do símbolo ('WIN$N', 'WDO$N',
 * 'WINZ26'...), (3) o padrão. O id vence o símbolo porque o operador pode digitar um código de
 * vencimento novo na tela de Parâmetros — e aí o número de R$/ponto dele não muda.
 * Desconhecido devolve o padrão e avisa UMA vez por símbolo — o app nunca pode quebrar.
 */
const warnedSymbols = new Set<string>();
export function resolveAsset(symbol?: string | null, assetId?: AssetId | null): AssetSpec {
  if (assetId && ASSETS[assetId]) return ASSETS[assetId];
  const raw = (symbol || '').toUpperCase().trim();
  if (raw) {
    const ids = Object.keys(ASSETS) as AssetId[];
    for (const id of ids) {
      if (ASSETS[id].prefixes.some((p) => raw.startsWith(p))) return ASSETS[id];
    }
    if (!warnedSymbols.has(raw)) {
      warnedSymbols.add(raw);
      console.warn(
        `[assetRegistry] Símbolo "${raw}" não é reconhecido; usando os números do ${ASSETS[DEFAULT_ASSET_ID].label}. ` +
          `Cadastre o prefixo em src/assets/assetRegistry.ts.`
      );
    }
  }
  return ASSETS[DEFAULT_ASSET_ID];
}

/** Pontos → R$ da posição. É o que substitui o `pts * 0.2 * contratos` espalhado pelo app. */
export function pointsToBRL(points: number, contracts: number, asset: AssetSpec): number {
  return points * asset.pointValue * contracts;
}

/** Arredonda o preço para uma variação válida do ativo (WIN: múltiplos de 5; WDO: de 0,5). */
export function snapToTick(price: number, asset: AssetSpec): number {
  const tick = asset.tickSize > 0 ? asset.tickSize : 1;
  return Math.round(price / tick) * tick;
}

/** Preço formatado com as casas decimais do ativo (WIN inteiro, dólar com 1 casa). */
export function formatPrice(price: number, asset: AssetSpec): string {
  return price.toLocaleString('pt-BR', {
    minimumFractionDigits: asset.decimals,
    maximumFractionDigits: asset.decimals,
  });
}

/** Rótulo da escala de Renko: quantos "R" (ticks) tem o box. WIN 50 pts = 10R. */
export function renkoScaleLabel(boxPoints: number, asset: AssetSpec): string {
  const tick = asset.tickSize > 0 ? asset.tickSize : 1;
  return `${Math.max(1, Math.round(boxPoints / tick))}R`;
}

/**
 * Ordem aberta longe demais da referência do ativo = resto de outro pregão/outro
 * mercado. A tolerância é percentual de propósito: em pontos absolutos ela ficaria apertada
 * demais num índice de 171.000 e frouxa demais num dólar de 5.300.
 */
export function isStaleOrderPrice(entryPrice: number, asset: AssetSpec): boolean {
  if (!Number.isFinite(entryPrice)) return true;
  const reference = referencePrice(asset);
  const tolerance = Math.abs(reference) * asset.staleTolerancePct;
  return Math.abs(entryPrice - reference) > tolerance;
}

/**
 * RÉGUA DE PREÇO POR ATIVO — `fluxo_asset_last_price_v1`.
 * O `basePrice` do registro é um número de código: ele envelhece (a Fase 1 acabou de trocar
 * 128.500 por 171.500 porque o outro era de um pregão distante). Com o MT5 conectado o app
 * guarda o último preço REAL visto, por ativo, e passa a usar isso como referência — sem isso,
 * o sanitizador da Fase 1 chamaria ordem legítima de velha depois de algumas semanas.
 */
const LAST_PRICE_KEY = 'fluxo_asset_last_price_v1';
const LAST_PRICE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 dias

type LastPriceMap = Partial<Record<AssetId, { price: number; at: number }>>;

function readLastPriceMap(): LastPriceMap {
  try {
    const raw = localStorage.getItem(LAST_PRICE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as LastPriceMap) : {};
  } catch {
    // Sem storage (modo privado) ou JSON corrompido: o basePrice do registro manda sozinho.
    return {};
  }
}

/**
 * Referência viva do ativo: último preço real do MT5 (se tem menos de 7 dias) ou o `basePrice`
 * do registro. É o que alimenta o eixo Y, a partida do sintético e a tolerância do sanitizador.
 */
export function referencePrice(asset: AssetSpec): number {
  const seen = readLastPriceMap()[asset.id];
  if (seen && Number.isFinite(seen.price) && seen.price > 0 && Date.now() - seen.at < LAST_PRICE_MAX_AGE_MS) {
    return seen.price;
  }
  return asset.basePrice;
}

/** Guarda o último preço real visto do ativo (chamado do feed do MT5, amortecido por tempo). */
export function rememberLastPrice(assetId: AssetId, price: number): void {
  if (!Number.isFinite(price) || price <= 0) return;
  try {
    const map = readLastPriceMap();
    map[assetId] = { price, at: Date.now() };
    localStorage.setItem(LAST_PRICE_KEY, JSON.stringify(map));
  } catch {
    // Storage cheio/indisponível: a referência só continua sendo a do registro.
  }
}

/** Hora/minuto da abertura e do fechamento do pregão, para o gerador de mercado sintético. */
export function sessionClock(asset: AssetSpec): {
  openHour: number;
  openMinute: number;
  closeHour: number;
  closeMinute: number;
} {
  const parse = (clock: string, fallback: [number, number]): [number, number] => {
    const m = /^(\d{1,2}):(\d{2})$/.exec((clock || '').trim());
    if (!m) return fallback;
    const h = Number(m[1]);
    const min = Number(m[2]);
    return h >= 0 && h <= 23 && min >= 0 && min <= 59 ? [h, min] : fallback;
  };
  const [openHour, openMinute] = parse(asset.session.open, [8, 55]);
  const [closeHour, closeMinute] = parse(asset.session.close, [17, 45]);
  return { openHour, openMinute, closeHour, closeMinute };
}
