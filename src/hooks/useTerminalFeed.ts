import { useEffect, useRef, useState } from 'react';
import { Tick } from '../types/trading';

/**
 * Feed da fita: ticks recebidos, o buffer completo da sessao, o buffer de atualizacao
 * visual agendado por requestAnimationFrame e o diagnostico do backfill.
 * 
 * Movido de App.tsx sem mudanca de comportamento. Quem alimenta estes buffers e o
 * handler do WebSocket, que continua chamando os setters devolvidos aqui.
 */
export function useTerminalFeed() {
  const [ticks, setTicks] = useState<Tick[]>([]);
  const [bfDiag, setBfDiag] = useState<string>('');
  // A faixa de diagnóstico é temporária: mostra o que a ponte entregou e sai da frente.
  useEffect(() => {
    if (!bfDiag) return;
    const t = window.setTimeout(() => setBfDiag(''), 5000);
    return () => window.clearTimeout(t);
  }, [bfDiag]);
  const allTicksRef = useRef<Tick[]>([]);
  const pendingUiUpdateRef = useRef<{
    scheduled: boolean;
    latestPrice: number;
    pendingTicks: Tick[];
    boxesChanged: boolean;
    rangeBoxesChanged: boolean;
    timeBoxesChanged: boolean;
  }>({
    scheduled: false,
    latestPrice: 0,
    pendingTicks: [],
    boxesChanged: false,
    rangeBoxesChanged: false,
    timeBoxesChanged: false,
  });

  return {
    ticks, setTicks,
    bfDiag, setBfDiag,
    allTicksRef,
    pendingUiUpdateRef,
  };
}
