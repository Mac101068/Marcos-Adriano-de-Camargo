import { RenkoBox, AutomationConfig } from '../types/trading';
import { SessionRegimeMeter } from './sessionRegime';

/**
 * Avaliador de convergência Preço x Fluxo compartilhado entre as três séries:
 * Pontos (Renko 10R), Range e Tempo. Todas as barras chegam no formato RenkoBox,
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

export function evaluateBoxConvergence(
  box: RenkoBox,
  config: AutomationConfig,
  previousBoxes: RenkoBox[],
  labels: ConvergenceSeriesLabels = {},
  meter?: SessionRegimeMeter
): ConvergenceResult {
  const priceLabel = labels.priceLabel ?? 'Preço 10R';
  const gainUp = labels.gainLabelUp ?? `+${config.boxPoints} pts`;
  const gainDown = labels.gainLabelDown ?? `-${config.boxPoints} pts`;

  // Limiar efetivo do momento: fixo × fator de volume × fator direcional do lado.
  const adaptive = config.adaptiveThresholdEnabled === true && meter !== undefined;
  const limitBuy = adaptive ? meter!.getAdaptiveLimit(config.minDeltaThreshold, 'BUY', box.delta) : config.minDeltaThreshold;
  const limitSell = adaptive ? meter!.getAdaptiveLimit(config.minDeltaThreshold, 'SELL', box.delta) : config.minDeltaThreshold;
  const factorLabel = adaptive ? ` | fator ${box.regimeFactor?.toFixed?.(2) ?? meter!.getFactor().toFixed(2)}x` : '';

  // SE A ESTRATÉGIA ATIVA FOR: PIRÂMIDE DE CONFLUÊNCIA FLUXO & RENKO 10R
  if (config.strategyMode === 'PYRAMID_FLOW_CONFLUENCE') {
    if (box.direction === 'UP') {
      // Bloco verde fechado: gera compra na pirâmide (com adaptativo ligado, exige
      // agressão compradora acima do limiar do momento — blocos fracos não sinalizam)
      if (adaptive && box.delta < limitBuy) {
        return { isConvergence: false };
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

      if (cvdOk) {
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

      if (cvdOk) {
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
