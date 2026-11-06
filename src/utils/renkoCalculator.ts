import { Tick, RenkoBox, AutomationConfig, SessionGap } from '../types/trading';
import { evaluateBoxConvergence } from './convergenceEvaluator';
import { SessionRegimeMeter } from './sessionRegime';
import { ASSETS, AssetSpec, DEFAULT_ASSET_ID, renkoScaleLabel, snapToTick } from '../assets/assetRegistry';

/**
 * Calculador de Gráficos Atemporais:
 * 1. Renko na escala configurável (`boxPoints`; WIN 50 pts = 10R no Mini-Índice B3)
 * 2. Fluxo Atemporal (Delta de Agressão e CVD tick-a-tick)
 * 3. Detector de Convergência Preço vs Fluxo
 */
export class RenkoFlowEngine {
  private boxPoints: number;
  private boxes: RenkoBox[] = [];
  // Emendas de pregão da série (fechamento de um dia → abertura do dia seguinte).
  // O gap não vira box; fica aqui para o gráfico desenhar o salto entre as sessões.
  private sessionGaps: SessionGap[] = [];
  private currentBox: Partial<RenkoBox> | null = null;
  private currentCvd: number = 0;
  private lastPrice: number = 0;
  // Chave YYYY-MM-DD da sessão (dia local) em curso. Serve para detectar a virada de dia:
  // o gap entre o fechamento de ontem e a abertura de hoje NUNCA pode virar box Renko.
  private lastSessionKey?: string;
  // Medidor de regime desta série: o box fechado alimenta o medidor ANTES da avaliação de
  // convergência, então o limiar adaptativo julga o box com o fator com que ele fechou.
  private regimeMeter = new SessionRegimeMeter(20);
  /**
   * Ativo do motor. A estratégia continua operando em PONTOS; o spec só entra aqui para
   * normalizar o preço de âncora na variação mínima real do contrato (WIN 5 pts, WDO 0,5).
   */
  private asset: AssetSpec;

  /** Dia local (YYYY-MM-DD) de um timestamp — âncora de sessão contra o gap de abertura. */
  private sessionKey(ts: number): string {
    const d = new Date(ts);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  constructor(boxPoints: number = 50, asset: AssetSpec = ASSETS[DEFAULT_ASSET_ID]) {
    this.boxPoints = boxPoints;
    this.asset = asset;
  }

  public setBoxPoints(points: number) {
    this.boxPoints = points;
  }

  /** Escala atual do motor (usada pelo Robô 2 para conferir se o motor acompanhou a escala). */
  public getBoxPoints(): number {
    return this.boxPoints;
  }

  /**
   * Troca de ativo sem jogar o motor fora (seletor do Header, Fase 2). A variação mínima
   * continua sendo a do spec antigo até o próximo initialize — quem chama é obrigado a
   * reiniciar em seguida, e é o que App.handleSelectAsset faz no handleResetData.
   */
  public setAsset(asset: AssetSpec) {
    this.asset = asset;
  }

  public getBoxes(): RenkoBox[] {
    return this.boxes;
  }

  public getCurrentBox(): Partial<RenkoBox> | null {
    return this.currentBox;
  }

  /** Gaps de abertura já atravessados pela série (um por virada de pregão). */
  public getSessionGaps(): SessionGap[] {
    return this.sessionGaps;
  }

  public getCvd(): number {
    return this.currentCvd;
  }

  public getRegimeMeter(): SessionRegimeMeter {
    return this.regimeMeter;
  }

  /**
   * Inicializa com um preço base
   */
  public initialize(startPrice: number, timestamp: number = Date.now()) {
    this.boxes = [];
    this.sessionGaps = [];
    this.currentCvd = 0;
    this.lastPrice = startPrice;
    this.lastSessionKey = this.sessionKey(timestamp);
    // Série reiniciada: o regime medido da série antiga não vale para a nova
    this.regimeMeter.reset();

    // Normaliza para a variação mínima do ativo (WIN: múltiplos de 5 pts)
    const basePrice = snapToTick(startPrice, this.asset);

    this.currentBox = {
      index: 0,
      direction: 'UP',
      open: basePrice,
      close: basePrice,
      high: basePrice,
      low: basePrice,
      timeStart: timestamp,
      timeEnd: timestamp,
      ticksCount: 0,
      totalVolume: 0,
      buyVolume: 0,
      sellVolume: 0,
      delta: 0,
      cvdAtClose: 0,
      isConvergence: false,
    };
  }

  /**
   * Processa um tick do Times & Trades
   * Retorna se um novo box fechou e se gerou sinal de convergência
   */
  public processTick(tick: Tick, config: AutomationConfig): {
    newBoxClosed: boolean;
    closedBox?: RenkoBox;
    signal?: 'BUY' | 'SELL';
    signalReason?: string;
  } {
    // Preço do tick ANTERIOR: na virada de pregão ele é o fechamento REAL da sessão que
    // acabou (o último box fechado é um nível redondo de Renko, não o preço de fechamento).
    const prevTickPrice = this.lastPrice;
    this.lastPrice = tick.price;
    // A janela do medidor segue a config (permite ajustar 10–50 boxes em Ajustes sem reiniciar o dia)
    this.regimeMeter.setLookbackBoxes(config.regimeLookbackBoxes ?? 20);

    // Acumula no CVD global
    const tickDelta = tick.aggressor === 'BUY' ? tick.volume : tick.aggressor === 'SELL' ? -tick.volume : 0;
    this.currentCvd += tickDelta;

    if (!this.currentBox) {
      this.initialize(tick.price, tick.timestamp);
    }

    // VIRADA DE SESSÃO: descarta a caixa parcial do dia anterior (ela nunca fecha como
    // box-ponte do gap) e re-ancora a formação no preço real de abertura de hoje.
    // O CVD NÃO zera (mantém a série); apenas o âncora de preço é reiniciado.
    // O 1º box do dia nasce no preço de abertura, então o sinal pode sair dele em diante.
    const tickSession = this.sessionKey(tick.timestamp);
    if (this.lastSessionKey !== undefined && tickSession !== this.lastSessionKey) {
      const basePrice = snapToTick(tick.price, this.asset);
      // Registra a emenda ANTES de re-ancorar: fechamento do último box do dia anterior
      // contra o preço de abertura de hoje. Gap nunca vira box Renko, mas é o número que
      // o operador quer ver na tela (+/- pontos entre os dois pregões).
      const prevClose =
        prevTickPrice > 0
          ? prevTickPrice
          : this.boxes.length > 0
          ? this.boxes[this.boxes.length - 1].close
          : this.currentBox?.close ?? basePrice;
      this.sessionGaps.push({
        fromDate: this.lastSessionKey,
        toDate: tickSession,
        fromPrice: prevClose,
        toPrice: basePrice,
        gapPoints: basePrice - prevClose,
        boxIndex: this.boxes.length,
        timestamp: tick.timestamp,
      });
      this.lastSessionKey = tickSession;
      this.currentBox = {
        index: this.boxes.length,
        direction: 'UP',
        open: basePrice,
        close: basePrice,
        high: basePrice,
        low: basePrice,
        timeStart: tick.timestamp,
        timeEnd: tick.timestamp,
        ticksCount: 0,
        totalVolume: 0,
        buyVolume: 0,
        sellVolume: 0,
        delta: 0,
        cvdAtClose: this.currentCvd,
        isConvergence: false,
      };
    }

    const curr = this.currentBox!;
    curr.ticksCount = (curr.ticksCount || 0) + 1;
    curr.totalVolume = (curr.totalVolume || 0) + tick.volume;
    if (tick.aggressor === 'BUY') {
      curr.buyVolume = (curr.buyVolume || 0) + tick.volume;
    } else if (tick.aggressor === 'SELL') {
      curr.sellVolume = (curr.sellVolume || 0) + tick.volume;
    }
    curr.delta = (curr.buyVolume || 0) - (curr.sellVolume || 0);
    curr.high = Math.max(curr.high || tick.price, tick.price);
    curr.low = Math.min(curr.low || tick.price, tick.price);
    curr.timeEnd = tick.timestamp;
    // Opção B: mantém o CVD do box em formação ao vivo (atualiza a cada tick,
    // sem esperar o box fechar), para o candle Heikin-Ashi intrabox não defasar do preço.
    curr.cvdAtClose = this.currentCvd;

    let newBoxClosed = false;
    let closedBox: RenkoBox | undefined;
    let signal: 'BUY' | 'SELL' | undefined;
    let signalReason: string | undefined;

    // Checagem de formação de Renko
    const lastDirection = this.boxes.length > 0 ? this.boxes[this.boxes.length - 1].direction : 'UP';
    // Origem do último fechamento: só vale o fechamento do box anterior se ele for DO MESMO dia.
    // Na virada de sessão a referência passa a ser a abertura real de hoje — o gap não vira caixa.
    const sameSession =
      this.boxes.length > 0 && this.sessionKey(this.boxes[this.boxes.length - 1].timeEnd) === tickSession;
    const lastClose = sameSession ? this.boxes[this.boxes.length - 1].close : curr.open!;

    if (lastDirection === 'UP') {
      // Continuação de alta: subiu 50 pontos acima do fechamento anterior
      if (tick.price >= lastClose + this.boxPoints) {
        const newBoxOpen = lastClose;
        const newBoxClose = lastClose + this.boxPoints;

        closedBox = {
          index: this.boxes.length,
          direction: 'UP',
          open: newBoxOpen,
          close: newBoxClose,
          high: Math.max(curr.high || newBoxClose, newBoxClose),
          low: Math.min(curr.low || newBoxOpen, newBoxOpen),
          timeStart: curr.timeStart || tick.timestamp,
          timeEnd: tick.timestamp,
          ticksCount: curr.ticksCount || 1,
          totalVolume: curr.totalVolume || tick.volume,
          buyVolume: curr.buyVolume || 0,
          sellVolume: curr.sellVolume || 0,
          delta: curr.delta || 0,
          cvdAtClose: this.currentCvd,
          isConvergence: false,
        };

        // Validação de convergência (com regime: mede, anota o fator e adapta o limiar)
        const convergenceCheck = this.checkClosedBox(closedBox, config);
        closedBox.isConvergence = convergenceCheck.isConvergence;
        closedBox.convergenceType = convergenceCheck.type;
        if (convergenceCheck.signal) {
          signal = convergenceCheck.signal;
          signalReason = convergenceCheck.reason;
          closedBox.orderDispatched = signal;
        }

        closedBox.sessionDate = tickSession;
        this.boxes.push(closedBox);
        newBoxClosed = true;

        // Inicia novo box
        this.currentBox = {
          index: this.boxes.length,
          direction: 'UP',
          open: newBoxClose,
          close: tick.price,
          high: tick.price,
          low: tick.price,
          timeStart: tick.timestamp,
          timeEnd: tick.timestamp,
          ticksCount: 0,
          totalVolume: 0,
          buyVolume: 0,
          sellVolume: 0,
          delta: 0,
          cvdAtClose: this.currentCvd,
          isConvergence: false,
        };
      }
      // Reversão para baixa: caiu 2x o tamanho (100 pontos) a partir do fechamento
      else if (tick.price <= lastClose - (this.boxPoints * 2)) {
        const prevOpen = sameSession ? this.boxes[this.boxes.length - 1].open : lastClose + this.boxPoints;
        const newBoxOpen = prevOpen;
        const newBoxClose = prevOpen - this.boxPoints;

        closedBox = {
          index: this.boxes.length,
          direction: 'DOWN',
          open: newBoxOpen,
          close: newBoxClose,
          high: Math.max(curr.high || newBoxOpen, newBoxOpen),
          low: Math.min(curr.low || newBoxClose, newBoxClose),
          timeStart: curr.timeStart || tick.timestamp,
          timeEnd: tick.timestamp,
          ticksCount: curr.ticksCount || 1,
          totalVolume: curr.totalVolume || tick.volume,
          buyVolume: curr.buyVolume || 0,
          sellVolume: curr.sellVolume || 0,
          delta: curr.delta || 0,
          cvdAtClose: this.currentCvd,
          isConvergence: false,
        };

        const convergenceCheck = this.checkClosedBox(closedBox, config);
        closedBox.isConvergence = convergenceCheck.isConvergence;
        closedBox.convergenceType = convergenceCheck.type;
        if (convergenceCheck.signal) {
          signal = convergenceCheck.signal;
          signalReason = convergenceCheck.reason;
          closedBox.orderDispatched = signal;
        }

        closedBox.sessionDate = tickSession;
        this.boxes.push(closedBox);
        newBoxClosed = true;

        this.currentBox = {
          index: this.boxes.length,
          direction: 'DOWN',
          open: newBoxClose,
          close: tick.price,
          high: tick.price,
          low: tick.price,
          timeStart: tick.timestamp,
          timeEnd: tick.timestamp,
          ticksCount: 0,
          totalVolume: 0,
          buyVolume: 0,
          sellVolume: 0,
          delta: 0,
          cvdAtClose: this.currentCvd,
          isConvergence: false,
        };
      }
    } else {
      // Direção anterior era DOWN
      // Continuação de baixa: caiu 50 pontos
      if (tick.price <= lastClose - this.boxPoints) {
        const newBoxOpen = lastClose;
        const newBoxClose = lastClose - this.boxPoints;

        closedBox = {
          index: this.boxes.length,
          direction: 'DOWN',
          open: newBoxOpen,
          close: newBoxClose,
          high: Math.max(curr.high || newBoxOpen, newBoxOpen),
          low: Math.min(curr.low || newBoxClose, newBoxClose),
          timeStart: curr.timeStart || tick.timestamp,
          timeEnd: tick.timestamp,
          ticksCount: curr.ticksCount || 1,
          totalVolume: curr.totalVolume || tick.volume,
          buyVolume: curr.buyVolume || 0,
          sellVolume: curr.sellVolume || 0,
          delta: curr.delta || 0,
          cvdAtClose: this.currentCvd,
          isConvergence: false,
        };

        const convergenceCheck = this.checkClosedBox(closedBox, config);
        closedBox.isConvergence = convergenceCheck.isConvergence;
        closedBox.convergenceType = convergenceCheck.type;
        if (convergenceCheck.signal) {
          signal = convergenceCheck.signal;
          signalReason = convergenceCheck.reason;
          closedBox.orderDispatched = signal;
        }

        closedBox.sessionDate = tickSession;
        this.boxes.push(closedBox);
        newBoxClosed = true;

        this.currentBox = {
          index: this.boxes.length,
          direction: 'DOWN',
          open: newBoxClose,
          close: tick.price,
          high: tick.price,
          low: tick.price,
          timeStart: tick.timestamp,
          timeEnd: tick.timestamp,
          ticksCount: 0,
          totalVolume: 0,
          buyVolume: 0,
          sellVolume: 0,
          delta: 0,
          cvdAtClose: this.currentCvd,
          isConvergence: false,
        };
      }
      // Reversão para alta: subiu 2x o tamanho (100 pontos) a partir do fechamento
      else if (tick.price >= lastClose + (this.boxPoints * 2)) {
        const prevOpen = sameSession ? this.boxes[this.boxes.length - 1].open : lastClose - this.boxPoints;
        const newBoxOpen = prevOpen;
        const newBoxClose = prevOpen + this.boxPoints;

        closedBox = {
          index: this.boxes.length,
          direction: 'UP',
          open: newBoxOpen,
          close: newBoxClose,
          high: Math.max(curr.high || newBoxClose, newBoxClose),
          low: Math.min(curr.low || newBoxOpen, newBoxOpen),
          timeStart: curr.timeStart || tick.timestamp,
          timeEnd: tick.timestamp,
          ticksCount: curr.ticksCount || 1,
          totalVolume: curr.totalVolume || tick.volume,
          buyVolume: curr.buyVolume || 0,
          sellVolume: curr.sellVolume || 0,
          delta: curr.delta || 0,
          cvdAtClose: this.currentCvd,
          isConvergence: false,
        };

        const convergenceCheck = this.checkClosedBox(closedBox, config);
        closedBox.isConvergence = convergenceCheck.isConvergence;
        closedBox.convergenceType = convergenceCheck.type;
        if (convergenceCheck.signal) {
          signal = convergenceCheck.signal;
          signalReason = convergenceCheck.reason;
          closedBox.orderDispatched = signal;
        }

        closedBox.sessionDate = tickSession;
        this.boxes.push(closedBox);
        newBoxClosed = true;

        this.currentBox = {
          index: this.boxes.length,
          direction: 'UP',
          open: newBoxClose,
          close: tick.price,
          high: tick.price,
          low: tick.price,
          timeStart: tick.timestamp,
          timeEnd: tick.timestamp,
          ticksCount: 0,
          totalVolume: 0,
          buyVolume: 0,
          sellVolume: 0,
          delta: 0,
          cvdAtClose: this.currentCvd,
          isConvergence: false,
        };
      }
    }

    return {
      newBoxClosed,
      closedBox,
      signal,
      signalReason,
    };
  }

  /**
   * Ciclo do box recém-fechado: alimenta o medidor de regime, anota o fator vigente
   * no box e AVALIA A CONVERGÊNCIA com o limiar adaptativo.
   * Lógica extraída para convergenceEvaluator.ts (compartilhada com Range e Tempo),
   * mantendo comportamento idêntico: this.boxes ainda não contém o box recém-fechado.
   */
  private checkClosedBox(
    box: RenkoBox,
    config: AutomationConfig
  ) {
    this.regimeMeter.feedClosedBox(box);
    box.regimeFactor = this.regimeMeter.getFactor();
    // O motivo do sinal denuncia a escala REAL do tijolo — nunca um "10R" herdado de quando
    // a escala era fixa (é o texto que aparece na auditoria de ordens).
    return evaluateBoxConvergence(
      box,
      config,
      this.boxes,
      { priceLabel: `Preço ${renkoScaleLabel(this.boxPoints, this.asset)}` },
      this.regimeMeter
    );
  }
}
