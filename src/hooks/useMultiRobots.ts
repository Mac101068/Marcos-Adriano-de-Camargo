import { useEffect, useState } from 'react';
import { MULTI_ROBOTS, MultiRobotId, RobotRuntimeState, AssetSignalState } from '../types/multiRobots';

/**
 * Multi-robôs (WIN, WDO, BIT): estado de execução por ativo, sinais publicados pelos
 * serviços e o ativo em foco na tela.
 *
 * Movido de App.tsx sem mudança de comportamento, incluindo a persistência em
 * `fluxo_multi_robot_states_v1` e os defaults COPILOT por ativo. Os sinais ficam
 * expostos via setMultiRobotSignals porque quem os escreve é o handler do WebSocket.
 */
export function useMultiRobots() {
  const [multiRobotSignals, setMultiRobotSignals] = useState<Record<string, AssetSignalState>>({});
  const [focusedRobotAsset, setFocusedRobotAsset] = useState<MultiRobotId>('WIN');
  const [multiRobotStates, setMultiRobotStates] = useState<Record<MultiRobotId, RobotRuntimeState>>(() => {
    try {
      const saved = localStorage.getItem('fluxo_multi_robot_states_v1');
      if (saved) return JSON.parse(saved);
    } catch {}
    return {
      WIN: { id: 'WIN', mode: 'COPILOT', contracts: MULTI_ROBOTS.WIN.defaultContracts, slPoints: MULTI_ROBOTS.WIN.defaultSlPoints, tpPoints: MULTI_ROBOTS.WIN.defaultTpPoints },
      WDO: { id: 'WDO', mode: 'COPILOT', contracts: MULTI_ROBOTS.WDO.defaultContracts, slPoints: MULTI_ROBOTS.WDO.defaultSlPoints, tpPoints: MULTI_ROBOTS.WDO.defaultTpPoints },
      BIT: { id: 'BIT', mode: 'COPILOT', contracts: MULTI_ROBOTS.BIT.defaultContracts, slPoints: MULTI_ROBOTS.BIT.defaultSlPoints, tpPoints: MULTI_ROBOTS.BIT.defaultTpPoints },
    };
  });

  useEffect(() => {
    try {
      localStorage.setItem('fluxo_multi_robot_states_v1', JSON.stringify(multiRobotStates));
    } catch {}
  }, [multiRobotStates]);

  return {
    multiRobotSignals, setMultiRobotSignals,
    focusedRobotAsset, setFocusedRobotAsset,
    multiRobotStates, setMultiRobotStates,
  };
}
