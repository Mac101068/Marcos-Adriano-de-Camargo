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
