import { useEffect, useRef, useState } from 'react';

/**
 * Simulacao e replay: liga/desliga do simulador, velocidade, quantos dias o replay corre,
 * o seed do pregao sintetico, o modo "replay opera" e o espelho isReplayingRef,
 * que e o guard lido pelo handler de tick.
 * 
 * Movido de App.tsx sem mudanca de comportamento: mesmas chaves de localStorage,
 * mesmos defaults e os mesmos efeitos de sincronizacao.
 */
export function useSimulation() {
  const [isSimulating, setIsSimulating] = useState<boolean>(false);

  const [simulationSpeed, setSimulationSpeed] = useState<number>(() => {

    // Aceita fração: 0,25x e 0,5x existem porque na série Renko o pregão inteiro vira poucas
    // centenas de blocos — em 1x ele acaba antes de dar para acompanhar a formação.
    const saved = Number(localStorage.getItem('fluxo_sim_speed_v1'));

    const validos = [0.25, 0.5, 1, 2, 3, 5, 10];

    return validos.includes(saved) ? saved : 1;

  });

  // Replay de histórico: quantos dias a setinha amarela da tira de status vai rodar.

  // MÍNIMO ABSOLUTO DE 1 DIA — a plataforma acorda parada (regra do Ciclo 12), então o replay

  // só anda pelo clique na seta; não existe mais "bootReplay" disparando na abertura.

  const [replayDays, setReplayDays] = useState<number>(() => {

    const saved = Number(localStorage.getItem('fluxo_replay_days_v1'));

    return saved >= 1 ? Math.min(10, Math.round(saved)) : 1;

  });

  const [isReplaying, setIsReplaying] = useState<boolean>(false);
  const isReplayingRef = useRef<boolean>(false);
  useEffect(() => {
    isReplayingRef.current = isReplaying;
  }, [isReplaying]);
  const [replayOperates, setReplayOperates] = useState<boolean>(() => {

    try {

      return localStorage.getItem('fluxo_replay_operate_v1') !== '0';

    } catch {

      return true;

    }

  });

  useEffect(() => {

    try {

      localStorage.setItem('fluxo_replay_operate_v1', replayOperates ? '1' : '0');

    } catch {

      // Ignora erro de storage

    }

  }, [replayOperates]);
  useEffect(() => {

    try {

      localStorage.setItem('fluxo_replay_days_v1', String(replayDays));

    } catch {

      // Ignora erro de storage

    }

  }, [replayDays]);
  const [replaySeed, setReplaySeed] = useState<number | null>(() => {

    const raw = localStorage.getItem('fluxo_replay_seed_v1');

    if (!raw) return null;

    const n = Number(raw);

    return Number.isFinite(n) && n > 0 ? n : null;

  });

  useEffect(() => {

    try {

      if (replaySeed === null) localStorage.removeItem('fluxo_replay_seed_v1');

      else localStorage.setItem('fluxo_replay_seed_v1', String(replaySeed));

    } catch {

      // Ignora erro de storage

    }

  }, [replaySeed]);
  useEffect(() => {

    try {

      localStorage.setItem('fluxo_sim_speed_v1', String(simulationSpeed));

    } catch {

      // Ignora erro de storage

    }

  }, [simulationSpeed]);

  /**

   * Espelho da velocidade para quem precisa LER o valor sem reimplementar a corrida. O replay usa

   * este ref a cada passo, então mexer na caixa "Nx" no meio da reprodução muda o compasso na hora

   * (com estado puro, o valor ficaria congelado no closure do início da corrida).

   */

  const simulationSpeedRef = useRef<number>(simulationSpeed);

  useEffect(() => {

    simulationSpeedRef.current = simulationSpeed;

  }, [simulationSpeed]);

  return {
    isSimulating, setIsSimulating,
    simulationSpeed, setSimulationSpeed, simulationSpeedRef,
    replayDays, setReplayDays,
    isReplaying, setIsReplaying, isReplayingRef,
    replayOperates, setReplayOperates,
    replaySeed, setReplaySeed,
  };
}
