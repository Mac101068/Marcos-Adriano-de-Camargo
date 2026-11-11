import { useCallback, useRef } from 'react';
import { RenkoFlowEngine } from '../utils/renkoCalculator';
import { resolveAsset } from '../assets/assetRegistry';
import { shadowRobotService } from '../services/shadowRobotService';

/**
 * Motor do Robô 2 (sombra): escala própria, CVD e medidor de regime próprios. Existe só
 * enquanto a sombra estiver ligada com uma estratégia válida.
 *
 * Movido de App.tsx sem mudança de comportamento: o ref e o ensureShadowEngine mantêm a
 * mesma lógica de criação/sincronização na escala efetiva (pts = R pedido × tick do ativo).
 */
export function useShadowRobot() {



  // MOTOR DO ROBÔ 2 (sombra): escala própria, CVD e medidor de regime próprios. Existe só

  // enquanto a sombra estiver ligada com uma estratégia válida.

  const shadowEngineRef = useRef<RenkoFlowEngine | null>(null);



  /** Motor da sombra criado/sincronizado na escala efetiva (pts = R pedido × tick do ativo). */

  const ensureShadowEngine = useCallback((): RenkoFlowEngine | null => {

    const eff = shadowRobotService.getEffectiveConfig();

    if (!eff) return null;

    const eng = shadowEngineRef.current;

    if (!eng) {

      const created = new RenkoFlowEngine(eff.boxPoints, resolveAsset(eff.symbol, eff.assetId));

      shadowEngineRef.current = created;

      shadowRobotService.registerRegimeMeter(created.getRegimeMeter());

      return created;

    }

    // Troca de ativo/escala: o config efetivo já vem com o spec atual, então o motor acompanha.

    // O initialize() da corrida (boot / reset / replay) é o que realinha o preço de partida.

    eng.setAsset(resolveAsset(eff.symbol, eff.assetId));

    eng.setBoxPoints(eff.boxPoints);

    return eng;

  }, []);

  return { shadowEngineRef, ensureShadowEngine };
}
