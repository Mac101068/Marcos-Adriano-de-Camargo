import { Tick } from '../types/trading';
import { ASSETS, AssetSpec, DEFAULT_ASSET_ID, sessionClock, snapToTick } from '../assets/assetRegistry';

const BROKERS = [
  'XP Investimentos',
  'BTG Pactual',
  'UBS Brasil',
  'Morgan Stanley',
  'Bradesco',
  'Itaú BBA',
  'Genial',
  'Santander',
  'Guide',
  'Terra',
  'Nova Futura',
];

/**
 * RNG determinística (mulberry32) — a mesma usada no Laboratório de Estratégias.
 * Serve para reproduzir EXATAMENTE o mesmo mercado sintético corrida após corrida.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Sorteia um seed de tela (0 é evitado para não colidir com o "sem seed" de chamadas antigas). */
export function randomReplaySeed(): number {
  return 1 + Math.floor(Math.random() * 999_999_999);
}

export class B3MarketSimulator {
  private currentPrice: number = ASSETS[DEFAULT_ASSET_ID].basePrice;
  private trend: number = 0; // neutro: sem deriva compradora embutida
  private volatility: number = 1.0;
  private tickCounter: number = 0;
  private asset: AssetSpec;

  /**
   * `initialPrice` omitted = preço de referência do ativo (WIN: 171.500). O passo de preço do
   * mercado sintético é a variação mínima do spec, então nenhum "5 pontos" fica soldado aqui.
   */
  constructor(initialPrice?: number, asset: AssetSpec = ASSETS[DEFAULT_ASSET_ID]) {
    this.asset = asset;
    this.currentPrice = initialPrice ?? asset.basePrice;
  }

  public setPrice(price: number) {
    this.currentPrice = price;
  }

  /**
   * Troca de ativo no simulador (seletor do Header, Fase 2): passo, horário do pregão sintético
   * e casas passam a ser os do spec novo. Quem chama costuma dar setPrice em seguida.
   */
  public setAsset(asset: AssetSpec) {
    this.asset = asset;
  }

  public getPrice(): number {
    return this.currentPrice;
  }

  /**
   * Gera o próximo tick do Times & Trades com distribuição realista de volume B3
   */
  public generateNextTick(): Tick {
    this.tickCounter++;
    const now = Date.now();

    // Probabilidade de mudança de tendência estocástica (centrada em 0: dias de alta e baixa simétricos)
    if (Math.random() < 0.04) {
      this.trend = (Math.random() - 0.5) * 1.5;
    }

    // Agressor baseado na tendência e ruído de mercado
    const buyProb = 0.5 + this.trend * 0.25;
    const isBuy = Math.random() < buyProb;
    const aggressor: 'BUY' | 'SELL' = isBuy ? 'BUY' : 'SELL';

    // Volume de contratos (distribuição pareto/potência típica de bolsa)
    // 65% trades pequenos (1 a 10 contratos)
    // 25% médios (15 a 50 contratos)
    // 10% institucionais grandes (75 a 450 contratos - "bancadas")
    let volume = 1;
    const volRoll = Math.random();
    if (volRoll < 0.65) {
      volume = Math.floor(Math.random() * 8) + 1; // 1-8
    } else if (volRoll < 0.90) {
      volume = (Math.floor(Math.random() * 7) + 2) * 5; // 10-45
    } else {
      volume = (Math.floor(Math.random() * 8) + 2) * 25; // 50-250
    }

    // Movimentação de preço do ativo (passo = variação mínima do spec)
    // Se o volume da agressão for forte, maior chance de deslocar a fila
    const moveChance = Math.min(0.85, 0.25 + (volume / 150));
    if (Math.random() < moveChance) {
      const step = this.asset.tickSize;
      if (aggressor === 'BUY') {
        this.currentPrice += step;
      } else {
        this.currentPrice -= step;
      }
    }

    const buyerBroker = BROKERS[Math.floor(Math.random() * BROKERS.length)];
    let sellerBroker = BROKERS[Math.floor(Math.random() * BROKERS.length)];
    while (sellerBroker === buyerBroker) {
      sellerBroker = BROKERS[Math.floor(Math.random() * BROKERS.length)];
    }

    const date = new Date(now);
    const timeStr = date.toTimeString().split(' ')[0] + '.' + String(date.getMilliseconds()).padStart(3, '0');

    return {
      id: `tick-${this.tickCounter}-${now}`,
      timestamp: now,
      timeStr,
      price: this.currentPrice,
      volume,
      aggressor,
      buyerBroker,
      sellerBroker,
    };
  }
}

/**
 * Gera histórico SINTÉTICO de N dias (sessões completas no horário do ativo),
 * com 1 tick a cada 2 segundos e perfil intradiário realista da B3:
 * - Pré-abertura/leilão e abertura (08:55–10:30): alta volatilidade e volume
 * - Meio da manhã: fluxo ainda forte
 * - Almoço (11:30–13:30): mercado lateral e quieto
 * - Tarde: mantém o viés do dia (alta/baixa/lateral sorteado no início da sessão)
 * - Fechamento (16:30–17:45): decruzação de D+1, movimento intenso
 *
 * Cada dia sorteia um tipo EQUILIBRADO (~40% alta / ~40% baixa / ~20% lateral), então a base
 * já traz dias de viés baixista — necessário para testar o limiar adaptativo sem o antigo
 * enviesamento comprador. Serve para testar a estratégia em horários diferentes sem esperar o pregão real.
 * Os ticks retornam em ordem cronológica, terminando no preço que o replay deve adotar.
 *
 * `seed`: com um número informado, todo o sorteio da geração usa uma RNG determinística e a
 * MESMA sequência de ticks sai igual em qualquer execução — inclusive em velocidades
 * diferentes (1x, 2x, 5x, 10x). Sem seed, o mercado é sorteado de novo a cada corrida.
 */
export function generateHistoricalTicks(
  days: number,
  startPrice: number = ASSETS[DEFAULT_ASSET_ID].basePrice,
  seed?: number,
  asset: AssetSpec = ASSETS[DEFAULT_ASSET_ID]
): Tick[] {
  const TICK_STEP_MS = 2000;

  // A geração inteira sorteia em Math.random; com seed, trocamos o Math.random por uma RNG
  // determinística SÓ dentro desta função e restauramos no fim (mesma técnica do laboratório).
  const realRandom = Math.random;
  if (typeof seed === 'number' && Number.isFinite(seed)) {
    Math.random = mulberry32(seed);
  }
  try {
    return buildHistoricalTicks(days, startPrice, TICK_STEP_MS, asset);
  } finally {
    Math.random = realRandom;
  }
}

function buildHistoricalTicks(days: number, startPrice: number, TICK_STEP_MS: number, asset: AssetSpec): Tick[] {
  const clock = sessionClock(asset);
  // Dias terminando hoje; sáb/dom só são pulados se o pregão do ativo for de dias úteis
  const sessionDays: Date[] = [];
  const cursor = new Date();
  while (sessionDays.length < Math.max(1, Math.min(10, days))) {
    const dow = cursor.getDay();
    if (!asset.session.weekdaysOnly || (dow !== 0 && dow !== 6)) {
      sessionDays.unshift(new Date(cursor));
    }
    cursor.setDate(cursor.getDate() - 1);
  }

  const ticks: Tick[] = [];
  let price = startPrice;
  let counter = 0;

  for (const day of sessionDays) {
    // Gap de abertura do dia
    price += (Math.random() - 0.5) * 80;
    price = snapToTick(price, asset);

    // Tipo de dia EQUILIBRADO (a base precisa ter dias baixistas para testar o limiar adaptativo):
    // ~40% dia de ALTA, ~40% dia de BAIXA, ~20% LATERAL. O viés do dia vale a sessão inteira
    // (não só a tarde), com peso reduzido no almoço — que é lateral por natureza.
    const dayRoll = Math.random();
    const dayBias =
      dayRoll < 0.4 ? 0.4 + Math.random() * 0.5
      : dayRoll < 0.8 ? -(0.4 + Math.random() * 0.5)
      : (Math.random() - 0.5) * 0.2; // lateral, quase sem direção
    let trend = (Math.random() - 0.5) * 0.6; // ruído intradiário (neutro)

    // Abertura do pregão do ativo: é o início da janela de entradas do EA (trava de horário) — o
    // leilão de abertura aparece na tela e o 1º candle já pode ser operado.
    const open = new Date(day); open.setHours(clock.openHour, clock.openMinute, 0, 0);
    const close = new Date(day); close.setHours(clock.closeHour, clock.closeMinute, 0, 0);

    for (let ts = open.getTime(); ts <= close.getTime(); ts += TICK_STEP_MS) {
      const d = new Date(ts);
      const minutes = d.getHours() * 60 + d.getMinutes();

      // Intensidade por horário (volume e chance de mover)
      let activity = 1.0;
      if (minutes < 10 * 60 + 30) activity = 1.7; // abertura
      else if (minutes < 11 * 60 + 30) activity = 1.2;
      else if (minutes < 13 * 60 + 30) activity = 0.45; // almoço
      else if (minutes < 16 * 60 + 30) activity = 1.0;
      else activity = 1.5; // fechamento / decruzação D+1

      // Mudanças de regime de tendência (mais frequentes fora do almoço) — neutras, sem deriva comprador
      if (Math.random() < 0.04 * activity) {
        trend = (Math.random() - 0.5) * 1.5;
      }
      // O viés do dia (dayBias) permeia a sessão toda; no almoço perde força (mercado quieto/lateral)
      const lunchDamp = minutes >= 11 * 60 + 30 && minutes < 13 * 60 + 30 ? 0.35 : 1.0;
      const effectiveTrend = trend + dayBias * 0.55 * lunchDamp;

      const buyProb = 0.5 + effectiveTrend * 0.25;
      const isBuy = Math.random() < buyProb;
      const aggressor: 'BUY' | 'SELL' = isBuy ? 'BUY' : 'SELL';

      let volume = 1;
      const volRoll = Math.random();
      if (volRoll < 0.65) {
        volume = Math.floor(Math.random() * 8 * activity) + 1;
      } else if (volRoll < 0.9) {
        volume = (Math.floor(Math.random() * 7 * activity) + 2) * 5;
      } else {
        volume = (Math.floor(Math.random() * 8 * activity) + 2) * 25; // bancada
      }

      const moveChance = Math.min(0.9, (0.25 + volume / 150) * activity);
      if (Math.random() < moveChance) {
        // Nos picos de atividade o mercado salta 2 variações mínimas em vez de 1
        const step = activity > 1.2 && Math.random() < 0.3 ? asset.tickSize * 2 : asset.tickSize;
        price += aggressor === 'BUY' ? step : -step;
      }

      const buyerBroker = BROKERS[Math.floor(Math.random() * BROKERS.length)];
      let sellerBroker = BROKERS[Math.floor(Math.random() * BROKERS.length)];
      while (sellerBroker === buyerBroker) {
        sellerBroker = BROKERS[Math.floor(Math.random() * BROKERS.length)];
      }

      counter++;
      ticks.push({
        id: `hist-${counter}`,
        timestamp: ts,
        timeStr: d.toTimeString().split(' ')[0],
        price,
        volume,
        aggressor,
        buyerBroker,
        sellerBroker,
      });
    }
  }

  return ticks;
}
