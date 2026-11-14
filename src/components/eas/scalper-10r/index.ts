import { STRATEGY_EA_CATALOG, StrategyPairCatalogItem } from '../../../services/directionalRobotService';

export const SCALPER_10R_SPEC: StrategyPairCatalogItem = STRATEGY_EA_CATALOG.find(
  (s) => s.id === 'SCALPER_10R'
)!;

export const SCALPER_10R_PRESETS = [
  {
    label: 'Scalper 75p Oficial (TP 75 / SL 75 / Trail +35→20)',
    patch: {
      takeProfitPoints: 75,
      stopLossPoints: 75,
      trailingStop: true,
      trailingActivationPoints: 35,
      trailingDistancePoints: 20,
      breakevenOffsetPoints: 5,
      maxOpenPositions: 2,
      onCloseOpposite: false,
    },
  },
  {
    label: 'Scalper Ultra-Curto (TP 45 / SL 60 / Trail +20→10)',
    patch: {
      takeProfitPoints: 45,
      stopLossPoints: 60,
      trailingStop: true,
      trailingActivationPoints: 20,
      trailingDistancePoints: 10,
      breakevenOffsetPoints: 5,
      maxOpenPositions: 2,
      onCloseOpposite: false,
    },
  },
];

