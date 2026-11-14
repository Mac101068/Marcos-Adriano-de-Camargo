import { STRATEGY_EA_CATALOG, StrategyPairCatalogItem } from '../../../services/directionalRobotService';

export const TREND_10R_SPEC: StrategyPairCatalogItem = STRATEGY_EA_CATALOG.find(
  (s) => s.id === 'TREND_10R'
)!;

export const TREND_10R_PRESETS = [
  {
    label: 'Trend 250p Oficial (TP 250 / SL 150 / Trail +100→75)',
    patch: {
      takeProfitPoints: 250,
      stopLossPoints: 150,
      trailingStop: true,
      trailingActivationPoints: 100,
      trailingDistancePoints: 75,
      breakevenOffsetPoints: 10,
      maxOpenPositions: 3,
      onCloseOpposite: false,
    },
  },
  {
    label: 'Trend Moderado (TP 180 / SL 120 / Trail +70→45)',
    patch: {
      takeProfitPoints: 180,
      stopLossPoints: 120,
      trailingStop: true,
      trailingActivationPoints: 70,
      trailingDistancePoints: 45,
      breakevenOffsetPoints: 10,
      maxOpenPositions: 3,
      onCloseOpposite: false,
    },
  },
];

