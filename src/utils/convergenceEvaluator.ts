import { RenkoBox, AutomationConfig } from '../types/trading';
import { SessionRegimeMeter } from './sessionRegime';

/**
 * Avaliador de convergência Preço x Fluxo compartilhado entre as três séries:
 * Pontos (Renko), Range e Tempo. Todas as barras chegam no formato RenkoBox,
 * então a mesma estratégia clássica mede a eficiência dos três gráficos.
 *
 * Extraído de forma fiel do RenkoFlowEngine (comportamento idêntico para o Renko,
 * usando as 3 barras fechadas anteriores na checagem de extremo de CVD).
 *
 * Limiar adaptativo de regime: com config.adaptiveThresholdEnabled, o Delta Mínimo
 * deixa de ser um número único para o dia inteiro e passa a ser
 * ±minDeltaThreshold × fator do momento (curva em U de volume + assimetria buy/sell).
 * Sem o medidor (meter) ou com o toggle desligado, o comportamento é o antigo.
 */

export interface ConvergenceResult {
  isConvergence: boolean;
  type?: 'BUY_CONVERGENCE' | 'SELL_CONVERGENCE' | 'DIVERGENCE';
  signal?: 'BUY' | 'SELL';
  reason?: string;
}

export interface ConvergenceSeriesLabels {
  /** Rótulo do painel de preço na mensagem de motivo (ex.: "Preço 10R" ou "Range 50pts") */
  priceLabel?: string;
  /** Ganho/prejuízo declarado de cada barra fechada (ex.: "+50 pts"); padrão usa config.boxPoints */
  gainLabelUp?: string;
  gainLabelDown?: string;
}

/**
 * Efficiency Ratio (Kaufman) das últimas `lookback` fechadas de barra (inclusa a atual):
 * |deslocamento líquido| ÷ Σ|passo a passo|. Próximo de 1 = tendência limpa; perto de 0 =
 * o mercado gira em círculo (acumulação/range curto). Adimensional — sem número físico
 * por ativo (regra dos limiares calculados). Sem janela completa (warm-up) devolve 1, para
 * NUNCA travar entrada no começo da série.
 */
function efficiencyRatio(previousBoxes: RenkoBox[], box: RenkoBox, lookback: number): number {
  const k = Math.max(2, Math.round(lookback) || 10);
  const series = [...previousBoxes.slice(-(k - 1)), box];
  if (series.length < k) return 1;
  let path = 0;
  for (let i = 1; i < series.length; i++) path += Math.abs(series[i].close - series[i - 1].close);
  if (path <= 0) return 1;
  const net = Math.abs(series[series.length - 1].close - series[0].close);
  return Math.min(1, net / path);
}

/**
 * Exaustão de fluxo: a agressão do box atual caiu a `ratio` (ou menos) da do último box
 * anterior DO MESMO LADO (não só o vizinho — evita travar num box isolado). Sem comparável
 * (primeiro do lado) devolve false: deixa o sinal passar.
 */
function isExhaustedFlow(previousBoxes: RenkoBox[], box: RenkoBox, ratio: number): boolean {
  const d = box.delta ?? 0;
  if (d === 0) return false;
  for (let i = previousBoxes.length - 1; i >= 0; i--) {
    const pd = previousBoxes[i].delta ?? 0;
    if (pd !== 0 && Math.sign(pd) === Math.sign(d)) {
      return Math.abs(d) <= Math.abs(pd) * ratio;
    }
  }
  return false;
}

export function evaluateBoxConvergence(
  box: RenkoBox,
  config: AutomationConfig,
  previousBoxes: RenkoBox[],
  labels: ConvergenceSeriesLabels = {},
  meter?: SessionRegimeMeter
): ConvergenceResult {
  // Fallback apenas para chamadores sem rótulo definido: os motores sempre passam a escala
  // derivada do box configurado, então o motivo nunca anuncia um R fixo de época antiga.
  const priceLabel = labels.priceLabel ?? `Preço ${config.boxPoints} pts`;
  const gainUp = labels.gainLabelUp ?? `+${config.boxPoints} pts`;
  const gainDown = labels.gainLabelDown ?? `-${config.boxPoints} pts`;

  // Corte do momento (Ciclo 12): com o filtro adaptativo LIGADO o limiar é CALCULADO do
  // pregão — percentil P60 das agressões do próprio lado nas últimas janelas de boxes.
  // `minDeltaThreshold` físico vira apenas o fallback de warm-up (menos de 10 boxes) e o
  // valor usado quando o adaptativo está DESLIGADO. Assim o Robô cobra força ACIMA da
  // média deste mercado, não acima de um número de contratos congelado na config.
  const adaptive = config.adaptiveThresholdEnabled === true && meter !== undefined;
  const SESSION_PERCENTILE = 0.6;
  const limitBuy = adaptive ? meter!.getPercentileLimit('BUY', SESSION_PERCENTILE, config.minDeltaThreshold) : config.minDeltaThreshold;
  const limitSell = adaptive ? meter!.getPercentileLimit('SELL', SESSION_PERCENTILE, config.minDeltaThreshold) : config.minDeltaThreshold;
  const factorLabel = adaptive ? ' | limiar = P60 do pregão' : '';

  // ── Filtros de regime (F2): ACUMULAÇÃO (range curto) e EXAUSTÃO ─────────────
  // Silenciam ENTRADAS quando o mercado está só serrando (deslocamento líquido baixo frente
  // ao caminho) ou o movimento perdeu força. Só rodam com o respectivo toggle LIGADO (padrão:
  // desligado) e valem para QUALQUER sinal — entrada nova, piramidação e flip, pois todos
  // nascem daqui. É a correção dos "vários stops em região de acumulação".
  const consolidating =
    config.consolidationFilterEnabled === true &&
    efficiencyRatio(previousBoxes, box, config.consolidationLookbackBoxes ?? 10) <
      (config.consolidationErMax ?? 0.3);
  const exhausting =
    config.exhaustionFilterEnabled === true &&
    isExhaustedFlow(previousBoxes, box, config.exhaustionDeltaRatio ?? 0.7);
  const regimeBlock = consolidating || exhausting;

  // SE A ESTRATÉGIA ATIVA FOR: PIRÂMIDE DE CONFLUÊNCIA FLUXO & RENKO 10R
  if (config.strategyMode === 'PYRAMID_FLOW_CONFLUENCE') {
    if (box.direction === 'UP') {
      // Bloco verde fechado: gera compra na pirâmide (com adaptativo ligado, exige
      // agressão compradora acima do limiar do momento — blocos fracos não sinalizam)
      if (adaptive && box.delta < limitBuy) {
        return { isConvergence: false };
      }
      if (regimeBlock) {
        return { isConvergence: false }; // acumulação/exaustão: não sinaliza compra
      }
      return {
        isConvergence: true,
        type: 'BUY_CONVERGENCE',
        signal: 'BUY',
        reason: `Pirâmide Confluência Alta: Bloco Verde #${box.index} (${gainUp}) | Δ: ${box.delta}${adaptive ? ` vs ≥${limitBuy}${factorLabel}` : ''}`,
      };
    } else if (box.direction === 'DOWN') {
      // Bloco vermelho fechado: gera venda na pirâmide (mesmo gate adaptativo, lado vendedor)
      if (adaptive && box.delta > -limitSell) {
        return { isConvergence: false };
      }
      if (regimeBlock) {
        return { isConvergence: false }; // acumulação/exaustão: não sinaliza venda
      }
      return {
        isConvergence: true,
        type: 'SELL_CONVERGENCE',
        signal: 'SELL',
        reason: `Pirâmide Confluência Baixa: Bloco Vermelho #${box.index} (${gainDown}) | Δ: ${box.delta}${adaptive ? ` vs ≤-${limitSell}${factorLabel}` : ''}`,
      };
    }
    return { isConvergence: false };
  }

  const minThreshold = config.minDeltaThreshold; // Ex: 200 contratos (base do recorte fixo do gráfico)

  // CONVERGÊNCIA COMPRADORA (MODO CLÁSSICO RETESTE / BREAKOUT):
  // 1. Box de alta fechado
  // 2. Delta líquido do box fortemente positivo (agressores compradores dominando)
  // 3. CVD fez máxima recente (se configurado)
  if (box.direction === 'UP') {
    if (box.delta >= limitBuy) {
      // Validação adicional de CVD se requerida
      let cvdOk = true;
      if (config.requireCvdNewExtreme && previousBoxes.length >= 3) {
        const recentBoxes = previousBoxes.slice(-3);
        const maxPrevCvd = Math.max(...recentBoxes.map((b) => b.cvdAtClose));
        cvdOk = box.cvdAtClose >= maxPrevCvd;
      }

      if (cvdOk && !regimeBlock) {
        return {
          isConvergence: true,
          type: 'BUY_CONVERGENCE',
          signal: 'BUY',
          reason: `Convergência Compradora: ${priceLabel} Alta (${gainUp}) + Delta Agressão +${box.delta} ctros${adaptive ? ` (limiar ${limitBuy}${factorLabel})` : ''}`,
        };
      }
    } else if (box.delta < 0) {
      // Divergência: preço subiu mas delta foi negativo (exaustão/absorção passiva de venda)
      return {
        isConvergence: false,
        type: 'DIVERGENCE',
      };
    }
  }

  // CONVERGÊNCIA VENDEDORA:
  // 1. Box de baixa fechado
  // 2. Delta líquido do box fortemente negativo (agressores vendedores dominando)
  // 3. CVD fez mínima recente
  if (box.direction === 'DOWN') {
    if (box.delta <= -limitSell) {
      let cvdOk = true;
      if (config.requireCvdNewExtreme && previousBoxes.length >= 3) {
        const recentBoxes = previousBoxes.slice(-3);
        const minPrevCvd = Math.min(...recentBoxes.map((b) => b.cvdAtClose));
        cvdOk = box.cvdAtClose <= minPrevCvd;
      }

      if (cvdOk && !regimeBlock) {
        return {
          isConvergence: true,
          type: 'SELL_CONVERGENCE',
          signal: 'SELL',
          reason: `Convergência Vendedora: ${priceLabel} Baixa (${gainDown}) + Delta Agressão ${box.delta} ctros${adaptive ? ` (limiar -${limitSell}${factorLabel})` : ''}`,
        };
      }
    } else if (box.delta > 0) {
      // Divergência: preço caiu mas delta foi positivo (absorção compradora)
      return {
        isConvergence: false,
        type: 'DIVERGENCE',
      };
    }
  }

  return { isConvergence: false };
}
