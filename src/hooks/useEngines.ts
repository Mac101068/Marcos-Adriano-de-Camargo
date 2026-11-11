import { useRef } from 'react';
import { RangeBarEngine, TimeBarEngine } from '../utils/barEngines';
import { RenkoFlowEngine } from '../utils/renkoCalculator';
import { AssetSpec } from '../assets/assetRegistry';

/**
 * Motores de serie: Renko principal, Range, Tempo e os tres extras (15R/20R/25R)
 * do coletor. Cada um guarda estado proprio entre renders, por isso sao refs.
 * 
 * Movido de App.tsx sem mudanca de comportamento. Recebe o `asset` porque a
 * construcao dos motores usa a escala e o contrato do ativo em tela.
 */
export function useEngines(asset: AssetSpec) {
const engineRef = useRef<RenkoFlowEngine>(new RenkoFlowEngine(50, asset));
  const rangeEngineRef = useRef<RangeBarEngine>(new RangeBarEngine(100));
  const timeEngineRef = useRef<TimeBarEngine>(new TimeBarEngine(30000));



  // Motores Renko extras (15R/20R/25R) rodando em paralelo só para o coletor

  const altEnginesRef = useRef<Record<'renko15r' | 'renko20r' | 'renko25r', RenkoFlowEngine>>({

    renko15r: new RenkoFlowEngine(75, asset),

    renko20r: new RenkoFlowEngine(100, asset),

    renko25r: new RenkoFlowEngine(125, asset),

  });

  return { engineRef, rangeEngineRef, timeEngineRef, altEnginesRef };
}
