import { STRATEGY_EA_CATALOG, StrategyPairCatalogItem } from '../../../services/directionalRobotService';

export const JANELA_FLUXO_SPEC: StrategyPairCatalogItem = STRATEGY_EA_CATALOG.find(
  (s) => s.id === 'JANELA_FLUXO'
)!;

export const JANELA_FLUXO_PRESETS = [
  {
    label: 'Janela Oficial (TP 200 / SL 80 / Trail +80→40)',
    patch: {
      takeProfitPoints: 200,
      stopLossPoints: 80,
      trailingStop: true,
      trailingActivationPoints: 80,
      trailingDistancePoints: 40,
      breakevenOffsetPoints: 5,
      maxOpenPositions: 5,
      onCloseOpposite: true,
    },
  },
  {
    label: 'Janela Rápida (TP 120 / SL 70 / Trail +50→25)',
    patch: {
      takeProfitPoints: 120,
      stopLossPoints: 70,
      trailingStop: true,
      trailingActivationPoints: 50,
      trailingDistancePoints: 25,
      breakevenOffsetPoints: 5,
      maxOpenPositions: 4,
      onCloseOpposite: true,
    },
  },
];

