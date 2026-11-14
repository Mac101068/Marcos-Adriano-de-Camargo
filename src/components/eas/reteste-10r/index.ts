import { STRATEGY_EA_CATALOG, StrategyPairCatalogItem } from '../../../services/directionalRobotService';

export const RETESTE_10R_SPEC: StrategyPairCatalogItem = STRATEGY_EA_CATALOG.find(
  (s) => s.id === 'RETESTE_10R'
)!;

export const RETESTE_10R_PRESETS = [
  {
    label: 'Institucional Reteste (TP 150 / SL 100 / Trail +60→50)',
    patch: {
      takeProfitPoints: 150,
      stopLossPoints: 100,
      trailingStop: true,
      trailingActivationPoints: 60,
      trailingDistancePoints: 50,
      breakevenOffsetPoints: 5,
      maxOpenPositions: 3,
      onCloseOpposite: false,
    },
  },
  {
    label: 'Reteste Curto (TP 100 / SL 80 / Trail +40→25)',
    patch: {
      takeProfitPoints: 100,
      stopLossPoints: 80,
      trailingStop: true,
      trailingActivationPoints: 40,
      trailingDistancePoints: 25,
      breakevenOffsetPoints: 5,
      maxOpenPositions: 2,
      onCloseOpposite: false,
    },
  },
];

