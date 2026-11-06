import { Tick, RenkoBox, AutomationConfig } from '../types/trading';
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
  /**
   * Teto de salto aceito em UM único tick, medido em boxes (adimensional — vale para qualquer
   * escala/ativo). Um print que varre mais que isso não é negócio real: é salto do leilão de
   * fechamento, cotação atrasada de outro vencimento ou buraco de dado. Nesse caso o motor
   * RE-ANCORA no preço real em vez de cospir dezenas de tijolos vazios (a explosão de fim de
   * pregão que bagunçava a formação dos blocos).
   */
  private static readonly MAX_JUMP_BOXES = 10;

  private boxPoints: number;
  private boxes: RenkoBox[] = [];
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
   * Processa um tick do Times & Trades.
   * Um único tick pode varrer VÁRIOS níveis de box (cascata de ticks reais, ou agressão que
   * varre o book no sintético calibrado): o laço fecha TODOS os boxes que o preço cobriu, na
   * ordem, até faltar menos de um box para o próximo nível — fim do atraso e dos gaps.
   * Retorna os boxes fechados (`closedBoxes`), o box "de cara" para os consumidores antigos
   * (`closedBox`, pareado com o último sinal) e o sinal de convergência, se houve.
   */
  public processTick(tick: Tick, config: AutomationConfig): {
    newBoxClosed: boolean;
    closedBox?: RenkoBox;
    closedBoxes: RenkoBox[];
    signal?: 'BUY' | 'SELL';
    signalReason?: string;
  } {
    // Guarda A (tick lixo): preço ausente/não-finito/não-positivo NÃO forma box nem polui o CVD —
    // é print órfão do leilão de fechamento, cotação zerada ou outro vencimento. Ignoramos o tick
    // inteiro (CVD e âncora continuam onde estavam).
    if (!Number.isFinite(tick.price) || tick.price <= 0) {
      return { newBoxClosed: false, closedBoxes: [] };
    }

    this.lastPrice = tick.price;
    // A janela do medidor segue a config (permite ajustar 10–50 boxes em Ajustes sem reiniciar o dia)
    this.regimeMeter.setLookbackBoxes(config.regimeLookbackBoxes ?? 20);

    if (!this.currentBox) {
      this.initialize(tick.price, tick.timestamp);
    }

    // VIRADA DE SESSÃO: descarta a caixa parcial do dia anterior (ela nunca fecha como
    // box-ponte do gap) e re-ancora a formação no preço real de abertura de hoje.
    // O CVD NÃO zera (mantém a série); apenas o âncora de preço é reiniciado.
    // O 1º box do dia nasce no preço de abertura, então o sinal pode sair dele em diante.
    const tickSession = this.sessionKey(tick.timestamp);
    if (this.lastSessionKey !== undefined && tickSession !== this.lastSessionKey) {
      this.lastSessionKey = tickSession;
      const basePrice = snapToTick(tick.price, this.asset);
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

    // Guarda B (anti-explosão de fim de pregão): um único tick que varre mais que
    // MAX_JUMP_BOXES não é negócio real — é salto do leilão, print atrasado de outro vencimento
    // ou buraco de dado. Em vez de cospir dezenas de tijolos vazios (o "tiro pra tudo quanto é
    // lado" que bagunçava os blocos), IGNORAMOS o tick por completo: sem box, sem CVD, sem mover a
    // referência de formação. Se o mercado realmente reanivar, ele o faz por vários ticks pequenos
    // (cada um abaixo do teto), que o laço clássico trata normalmente — a referência segue a fita.
    const refLast = this.boxes.length > 0 ? this.boxes[this.boxes.length - 1] : undefined;
    const refSame = !!refLast && this.sessionKey(refLast.timeEnd) === tickSession;
    const refPrice = refSame ? refLast!.close : (this.currentBox?.open ?? tick.price);
    if (Math.abs(tick.price - refPrice) > this.boxPoints * RenkoFlowEngine.MAX_JUMP_BOXES) {
      return { newBoxClosed: false, closedBoxes: [] };
    }

    // Acumula no CVD global (só depois das guardas: tick rejeitado não entra na fita)
    const tickDelta = tick.aggressor === 'BUY' ? tick.volume : tick.aggressor === 'SELL' ? -tick.volume : 0;
    this.currentCvd += tickDelta;

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
    const closedBoxes: RenkoBox[] = [];
    let signal: 'BUY' | 'SELL' | undefined;
    let signalReason: string | undefined;
    let signalBox: RenkoBox | undefined;

    // ------------------------------------------------------------------
    // Formação Renko clássica (com preenchimento): cada volta fecha UM box
    // e só para quando o preço já não cobre o nível seguinte. Antes, fechar
    // no máximo um box por tick fazia a coluna ATRASAR o preço e ABRIR GAPS:
    // se a virada vinha antes dos ticks "recuperarem" os níveis pulados,
    // eles nunca viravam caixa.
    // A acumulação pendiente (`curr`) pertence ao PRIMEIRO box da volta.
    // Os boxes seguintes são de PREENCHIMENTO: a fita não conta o caminho
    // percorrido, então nascem com fluxo zerado — nunca duplicando o tick.
    // ------------------------------------------------------------------
    for (let lap = 0; lap < 1000; lap++) {
      const last = this.boxes.length > 0 ? this.boxes[this.boxes.length - 1] : undefined;
      const lastDirection = last ? last.direction : 'UP';
      // Origem do último fechamento: só vale o fechamento do box anterior se ele for DO MESMO dia.
      // Na virada de sessão a referência passa a ser a abertura real de hoje — o gap não vira caixa.
      const sameSession = !!last && this.sessionKey(last.timeEnd) === tickSession;
      const lastClose = sameSession ? last!.close : curr.open!;

      let direction: 'UP' | 'DOWN' | undefined;
      let boxOpen = 0;
      let boxClose = 0;

      if (lastDirection === 'UP') {
        if (tick.price >= lastClose + this.boxPoints) {
          // Continuação de alta: subiu um box acima do fechamento anterior
          direction = 'UP';
          boxOpen = lastClose;
          boxClose = lastClose + this.boxPoints;
        } else if (tick.price <= lastClose - this.boxPoints * 2) {
          // Reversão para baixa: caiu 2x o tamanho do box a partir do fechamento
          direction = 'DOWN';
          boxOpen = sameSession ? last!.open : lastClose + this.boxPoints;
          boxClose = boxOpen - this.boxPoints;
        }
      } else {
        if (tick.price <= lastClose - this.boxPoints) {
          // Continuação de baixa: caiu um box abaixo do fechamento anterior
          direction = 'DOWN';
          boxOpen = lastClose;
          boxClose = lastClose - this.boxPoints;
        } else if (tick.price >= lastClose + this.boxPoints * 2) {
          // Reversão para alta: subiu 2x o tamanho do box a partir do fechamento
          direction = 'UP';
          boxOpen = sameSession ? last!.open : lastClose - this.boxPoints;
          boxClose = boxOpen + this.boxPoints;
        }
      }
      if (!direction) break;

      const top = Math.max(boxOpen, boxClose);
      const bottom = Math.min(boxOpen, boxClose);
      const firstBoxOfLap = closedBoxes.length === 0;

      const closedBox: RenkoBox = {
        index: this.boxes.length,
        direction,
        open: boxOpen,
        close: boxClose,
        high: Math.max(firstBoxOfLap ? curr.high || top : top, top),
        low: Math.min(firstBoxOfLap ? curr.low || bottom : bottom, bottom),
        timeStart: firstBoxOfLap ? curr.timeStart || tick.timestamp : tick.timestamp,
        timeEnd: tick.timestamp,
        ticksCount: firstBoxOfLap ? curr.ticksCount || 1 : 0,
        totalVolume: firstBoxOfLap ? curr.totalVolume || tick.volume : 0,
        buyVolume: firstBoxOfLap ? curr.buyVolume || 0 : 0,
        sellVolume: firstBoxOfLap ? curr.sellVolume || 0 : 0,
        delta: firstBoxOfLap ? curr.delta || 0 : 0,
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
        signalBox = closedBox;
        closedBox.orderDispatched = signal;
      }

      this.boxes.push(closedBox);
      closedBoxes.push(closedBox);
      newBoxClosed = true;
    }

    if (newBoxClosed) {
      const lastClosed = closedBoxes[closedBoxes.length - 1];
      // Box em formação: nasce no fechamento do último box fechado e já aponta para o
      // preço real do tick (o caminho que sobrou dentro do próximo nível).
      this.currentBox = {
        index: this.boxes.length,
        direction: lastClosed.direction,
        open: lastClosed.close,
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

    // `closedBox` (legado): o box que PAREIA com o sinal devolvido — o disparo do robô ancora
    // limite/leitura nesse box; sem sinal, é o último box fechado.
    const closedBox = signalBox ?? closedBoxes[closedBoxes.length - 1];

    return {
      newBoxClosed,
      closedBox,
      closedBoxes,
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
