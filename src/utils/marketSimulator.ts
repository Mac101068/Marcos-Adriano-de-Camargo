import { Tick } from '../types/trading';

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

export class B3MarketSimulator {
  private currentPrice: number = 128500;
  private trend: number = 0.15; // ligeiro viés inicial
  private volatility: number = 1.0;
  private tickCounter: number = 0;

  constructor(initialPrice: number = 128500) {
    this.currentPrice = initialPrice;
  }

  public setPrice(price: number) {
    this.currentPrice = price;
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

    // Probabilidade de mudança de tendência estocástica
    if (Math.random() < 0.04) {
      this.trend = (Math.random() - 0.48) * 1.5;
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

    // Movimentação de preço do Mini-Índice (passo de 5 pontos)
    // Se o volume da agressão for forte, maior chance de deslocar a fila
    const moveChance = Math.min(0.85, 0.25 + (volume / 150));
    if (Math.random() < moveChance) {
      const step = 5;
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
 * Gera histórico SINTÉTICO de N dias úteis (sessões completas 09:05–17:45),
 * com 1 tick a cada 2 segundos e perfil intradiário realista da B3:
 * - Abertura (09:05–10:30): alta volatilidade e volume
 * - Meio da manhã: fluxo ainda forte
 * - Almoço (11:30–13:30): mercado lateral e quieto
 * - Tarde: com probabilidade de dia tendência direcional
 * - Fechamento (16:30–17:45): decruzação de D+1, movimento intenso
 *
 * Serve para testar a estratégia em horários diferentes sem esperar o pregão real.
 * Os ticks retornam em ordem cronológica, terminando no preço que o replay deve adotar.
 */
export function generateHistoricalTicks(days: number, startPrice: number = 128500): Tick[] {
  const TICK_STEP_MS = 2000;

  // Dias úteis terminando hoje (sáb/dom são pulados)
  const sessionDays: Date[] = [];
  const cursor = new Date();
  while (sessionDays.length < Math.max(1, Math.min(10, days))) {
    const dow = cursor.getDay();
    if (dow !== 0 && dow !== 6) {
      sessionDays.unshift(new Date(cursor));
    }
    cursor.setDate(cursor.getDate() - 1);
  }

  const ticks: Tick[] = [];
  let price = startPrice;
  let counter = 0;

  for (const day of sessionDays) {
    // Gap de abertura do dia (0 a 40 pts)
    price += (Math.random() - 0.5) * 80;
    price = Math.round(price / 5) * 5;

    // Viés direcional do dia: 40% de chance de ser "dia tendência" na parte da tarde
    const trendDay = Math.random() < 0.4 ? (Math.random() < 0.5 ? -1 : 1) * (0.4 + Math.random() * 0.5) : 0;
    let trend = (Math.random() - 0.5) * 0.6;

    const open = new Date(day); open.setHours(9, 5, 0, 0);
    const close = new Date(day); close.setHours(17, 45, 0, 0);

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

      // Mudanças de regime de tendência (mais frequentes fora do almoço)
      if (Math.random() < 0.04 * activity) {
        trend = (Math.random() - 0.48) * 1.5;
      }
      const effectiveTrend = minutes >= 13 * 60 + 30 && minutes < 16 * 60 ? trend + trendDay * 0.55 : trend;

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
        const step = activity > 1.2 && Math.random() < 0.3 ? 10 : 5;
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
