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

export type AssetId = 'WIN' | 'WDO' | 'BTC' | 'BTCBR';

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

export interface AssetTradeDefaults {
  boxPoints: number;
  stopLossPoints: number;
  takeProfitPoints: number;
  partialPoints: number;
  breakevenOffsetPoints: number;
  trailingDistancePoints: number;
  minDeltaThreshold: number;
  contracts: number;
  rangePoints: number;
  stepperStep: number;
  maxSL: number;
  maxTP: number;
}

export interface AssetSpec {
  id: AssetId;
  label: string;
  /**
   * SÉRIE CONTÍNUA do MT5 ('WIN$N', 'WDO$N'): emenda vencimentos, então é o código que serve
   * para TESTE LONGO (replay de dias, coletor de eficiência). Não é mais o padrão do config —
   * o gráfico opera o vigente (ver `chartSymbolFor`); a contínua continua sendo o símbolo pedido
   * ao MT5 nos testes de histórico.
   */
  primarySymbol: string;
  /**
   * CONTRATO VIGENTE — o papel específico do pregão de hoje ('WINZ26'). É o que a corretora
   * mostra na conta e o que o gráfico abre quando você opera o real. Rolou o vencimento? Troca
   * aqui (ou digita o novo na tela de Parâmetros). `undefined` = vencimento ainda não confirmado.
   */
  activeContract?: string;
  /** Texto miúdo da marca-d'água do gráfico (nome curto do produto, sem duplicar a sigla). */
  watermarkCaption: string;
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
  /** Parâmetros operacionais e de boleta específicos e isolados deste contrato. */
  tradeDefaults: AssetTradeDefaults;
  /** 'a_confirmar' marca spec ainda não validado na corretora — nunca vira padrão silencioso. */
  status: 'ativo' | 'a_confirmar';
  contractNote: string;
}

export const ASSETS: Record<AssetId, AssetSpec> = {
  WIN: {
    id: 'WIN',
    label: 'Mini Índice (WIN)',
    primarySymbol: 'WIN$N',
    // Vencimento informado pelo operador (o mesmo do basePrice abaixo). Dez/2026.
    activeContract: 'WINZ26',
    watermarkCaption: 'Mini Índice · B3',
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
    tradeDefaults: {
      boxPoints: 50,
      stopLossPoints: 50,
      takeProfitPoints: 100,
      partialPoints: 50,
      breakevenOffsetPoints: 5,
      trailingDistancePoints: 50,
      minDeltaThreshold: 50,
      contracts: 1,
      rangePoints: 100,
      stepperStep: 5,
      maxSL: 1000,
      maxTP: 2000,
    },
    status: 'ativo',
    contractNote: '1 contrato = R$ 0,20 por ponto (variação mínima de 5 pontos = 1R)',
  },
  WDO: {
    id: 'WDO',
    label: 'Mini Dólar (WDO)',
    primarySymbol: 'WDO$',
    activeContract: 'WDOZ26',
    watermarkCaption: 'Mini Dólar · B3',
    prefixes: ['WDO', 'DOL'],
    pointValue: 10.0,
    tickSize: 0.5,
    decimals: 1,
    basePrice: 5480,
    staleTolerancePct: 0.1,
    renkoDefaults: [2.5, 5, 10],
    session: {
      open: '09:00',
      close: '18:00',
      weekdaysOnly: true,
      auctionMinutes: 10,
      settlementWindowMinutes: 30,
    },
    tradeDefaults: {
      boxPoints: 5.0,
      stopLossPoints: 5.0,
      takeProfitPoints: 10.0,
      partialPoints: 5.0,
      breakevenOffsetPoints: 0.5,
      trailingDistancePoints: 5.0,
      minDeltaThreshold: 10,
      contracts: 1,
      rangePoints: 10,
      stepperStep: 0.5,
      maxSL: 100,
      maxTP: 200,
    },
    status: 'ativo',
    contractNote: '1 contrato = R$ 10,00 por ponto (variação mínima de 0,5 pt = R$ 5,00)',
  },
  BTCBR: {
    id: 'BTCBR',
    label: 'Bitcoin B3 (BTCBR / BIT)',
    primarySymbol: 'BIT$',
    activeContract: 'BITX26',
    watermarkCaption: 'Bitcoin Futuro · B3',
    prefixes: ['BTCBR', 'BTC', 'BIT', 'WBRA', 'BITX'],
    pointValue: 0.1,
    tickSize: 20,
    decimals: 0,
    basePrice: 440000,
    staleTolerancePct: 0.15,
    renkoDefaults: [100, 200, 500],
    session: {
      open: '09:00',
      close: '18:30',
      weekdaysOnly: true,
      auctionMinutes: 10,
      settlementWindowMinutes: 30,
    },
    tradeDefaults: {
      boxPoints: 200,
      stopLossPoints: 200,
      takeProfitPoints: 400,
      partialPoints: 200,
      breakevenOffsetPoints: 20,
      trailingDistancePoints: 200,
      minDeltaThreshold: 10,
      contracts: 1,
      rangePoints: 400,
      stepperStep: 20,
      maxSL: 5000,
      maxTP: 10000,
    },
    status: 'ativo',
    contractNote: 'Futuro de Bitcoin B3 (BITX26 / BIT$) · Variação mínima de 20 pts',
  },
  BTC: {
    id: 'BTC',
    label: 'Bitcoin B3 (BIT / BTC)',
    primarySymbol: 'BIT$',
    activeContract: 'BITX26',
    watermarkCaption: 'Bitcoin Futuro · B3',
    prefixes: ['BTC', 'BIT', 'WBRA', 'BTCBR', 'BITX'],
    pointValue: 0.1,
    tickSize: 20,
    decimals: 0,
    basePrice: 440000,
    staleTolerancePct: 0.15,
    renkoDefaults: [100, 200, 500],
    session: {
      open: '09:00',
      close: '18:30',
      weekdaysOnly: true,
      auctionMinutes: 10,
      settlementWindowMinutes: 30,
    },
    tradeDefaults: {
      boxPoints: 200,
      stopLossPoints: 200,
      takeProfitPoints: 400,
      partialPoints: 200,
      breakevenOffsetPoints: 20,
      trailingDistancePoints: 200,
      minDeltaThreshold: 10,
      contracts: 1,
      rangePoints: 400,
      stepperStep: 20,
      maxSL: 5000,
      maxTP: 10000,
    },
    status: 'ativo',
    contractNote: 'Futuro de Bitcoin B3 (BITX26 / BIT$) · Variação mínima de 20 pts',
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

/**
 * PAPEL DE UM SÍMBOLO — a tela precisa dizer QUAL dos dois códigos é cada um, porque eles são
 * equivalentes (mesmo ativo, mesmos R$/ponto) mas servem a coisas diferentes:
 * - 'serie': contínua ('WIN$N') — emenda vencimentos, é a que presta para teste longo;
 * - 'vigente': o contrato do pregão de hoje ('WINZ26') — o que a corretora tem na conta;
 * - 'outro': um vencimento digitado à mão que não é o declarado no registro.
 */
export type SymbolRole = 'serie' | 'vigente' | 'outro';

export function symbolRole(asset: AssetSpec, symbol?: string | null): SymbolRole {
  const raw = (symbol || '').toUpperCase().trim();
  if (!raw || raw === asset.primarySymbol.toUpperCase()) return 'serie';
  if (asset.activeContract && raw === asset.activeContract.toUpperCase()) return 'vigente';
  return raw.includes('$') ? 'serie' : 'outro';
}

export const SYMBOL_ROLE_LABEL: Record<SymbolRole, string> = {
  serie: 'série',
  vigente: 'vigente',
  outro: 'venc.',
};

/**
 * CÓDIGO DO GRÁFICO — o terminal abre SEMPRE o contrato vigente (o papel que a corretora tem na
 * conta). A série contínua não desapareceu do produto: ela é o símbolo que o pedido de histórico
 * real usa para os testes longos, e por isso continua no registro — só não é mais escolha do
 * operador na tela. Sem vencimento confirmado (specs 'a_confirmar'), a contínua é o único código
 * honesto possível.
 */
export function chartSymbolFor(asset: AssetSpec): string {
  return asset.activeContract || asset.primarySymbol;
}

/**
 * O que a tela diz sobre o contrato aberto. Uma função só, lida pelo cabeçalho e pelo App, para
 * os dois lados nunca poderem discordar:
 * - `chart`: o código do gráfico (o vigente do registro; a contínua quando não há vencimento
 *   confirmado) — é o ÚNICO que o operador vê em condição normal;
 * - `live`: o símbolo que a ponte subscreve de verdade (o config manda);
 * - `offPattern` / `liveRole`: existem porque o config PODE estar noutro código — teste longo na
 *   contínua ou vencimento digitado à mão em Parâmetros. Aí a tela mostra o `live` com o papel
 *   dele e se marca em âmbar: o terminal nunca pode anunciar um contrato e desenhar outro.
 */
export function assetSymbols(asset: AssetSpec, configSymbol?: string | null): {
  live: string;
  liveRole: SymbolRole;
  chart: string;
  chartRole: SymbolRole;
  offPattern: boolean;
} {
  const chart = chartSymbolFor(asset);
  const live = (configSymbol || '').trim() || chart;
  return {
    live,
    liveRole: symbolRole(asset, live),
    chart,
    chartRole: symbolRole(asset, chart),
    offPattern: live.toUpperCase() !== chart.toUpperCase(),
  };
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

/** Leitura numérica do rótulo acima: quantos "R" tem um box de N pontos (WIN: 50 pts = 10). */
export function renkoRFromBoxPoints(boxPoints: number, asset: AssetSpec): number {
  const tick = asset.tickSize > 0 ? asset.tickSize : 1;
  return Math.max(1, Math.round(boxPoints / tick));
}

/**
 * R → pontos, já encaixado na variação mínima do ativo. O operador pensa em "R" (8R, 9R, 29R),
 * mas tudo no terminal é medido em PONTOS: esta é a única conversão de volta para a escala.
 */
export function boxPointsForR(r: number, asset: AssetSpec): number {
  const tick = asset.tickSize > 0 ? asset.tickSize : 1;
  return snapToTick(Math.max(1, Math.round(r)) * tick, asset);
}

/** Piso e teto da escala de Renko em R — 1R (um tick) até 60R, faixa de teste realista. */
export const RENKO_R_MIN = 1;
export const RENKO_R_MAX = 60;

/** R digitado/percorrido → R aplicável dentro da faixa (a caixa editável e o gráfico usam o mesmo corte). */
export function clampRenkoR(r: number): number {
  return Math.min(RENKO_R_MAX, Math.max(RENKO_R_MIN, Math.round(r)));
}

/**
 * Pontos digitados → pontos aplicáveis: presos na faixa de teste e encaixados na variação
 * mínima, porque um tijolo que não fecha no tick do ativo mentira na contagem do motor.
 */
export function clampBoxPoints(points: number, asset: AssetSpec): number {
  const tick = asset.tickSize > 0 ? asset.tickSize : 1;
  return snapToTick(Math.min(RENKO_R_MAX * tick, Math.max(tick, points)), asset);
}

/**
 * Escada de testes do box: os R que merecem chip de clique direto no gráfico, somados os
 * sugeridos pelo próprio ativo (`renkoDefaults`) e a medida atual — assim o controle nunca
 * "perde" um valor que já está em uso só porque ele não está na escada padrão.
 */
export function renkoRChoices(asset: AssetSpec, currentR: number): number[] {
  const ladder = [5, 8, 9, 10, 15, 20, 25, 29, 30];
  const fromDefaults = asset.renkoDefaults.map((pts) => renkoRFromBoxPoints(pts, asset));
  const set = new Set([...ladder, ...fromDefaults, currentR].filter((r) => r >= RENKO_R_MIN && r <= RENKO_R_MAX));
  return [...set].sort((a, b) => a - b);
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
