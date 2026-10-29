import { RenkoBox, AutomationConfig } from '../types/trading';

/**
 * Avaliador de convergência Preço x Fluxo compartilhado entre as três séries:
 * Pontos (Renko 10R), Range e Tempo. Todas as barras chegam no formato RenkoBox,
 * então a mesma estratégia clássica mede a eficiência dos três gráficos.
 *
 * Extraído de forma fiel do RenkoFlowEngine (comportamento idêntico para o Renko,
 * usando as 3 barras fechadas anteriores na checagem de extremo de CVD).
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
  labels: ConvergenceSeriesLabels = {}
): ConvergenceResult {
  const priceLabel = labels.priceLabel ?? 'Preço 10R';
  const gainUp = labels.gainLabelUp ?? `+${config.boxPoints} pts`;
  const gainDown = labels.gainLabelDown ?? `-${config.boxPoints} pts`;

  // SE A ESTRATÉGIA ATIVA FOR: PIRÂMIDE DE CONFLUÊNCIA FLUXO & RENKO 10R
  if (config.strategyMode === 'PYRAMID_FLOW_CONFLUENCE') {
    if (box.direction === 'UP') {
      // Bloco verde fechado: gera compra na pirâmide incondicionalmente
      return {
        isConvergence: true,
        type: 'BUY_CONVERGENCE',
        signal: 'BUY',
        reason: `Pirâmide Confluência Alta: Bloco Verde #${box.index} (${gainUp}) | Δ: ${box.delta}`,
      };
    } else if (box.direction === 'DOWN') {
      // Bloco vermelho fechado: gera venda na pirâmide incondicionalmente
      return {
        isConvergence: true,
        type: 'SELL_CONVERGENCE',
        signal: 'SELL',
        reason: `Pirâmide Confluência Baixa: Bloco Vermelho #${box.index} (${gainDown}) | Δ: ${box.delta}`,
      };
    }
    return { isConvergence: false };
  }

  const minThreshold = config.minDeltaThreshold; // Ex: 200 contratos

  // CONVERGÊNCIA COMPRADORA (MODO CLÁSSICO RETESTE / BREAKOUT):
  // 1. Box de alta fechado
  // 2. Delta líquido do box fortemente positivo (agressores compradores dominando)
  // 3. CVD fez máxima recente (se configurado)
  if (box.direction === 'UP') {
    if (box.delta >= minThreshold) {
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
          reason: `Convergência Compradora: ${priceLabel} Alta (${gainUp}) + Delta Agressão +${box.delta} ctros`,
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
    if (box.delta <= -minThreshold) {
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
          reason: `Convergência Vendedora: ${priceLabel} Baixa (${gainDown}) + Delta Agressão ${box.delta} ctros`,
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
