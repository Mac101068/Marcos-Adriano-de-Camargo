import { STRATEGY_EA_CATALOG, StrategyPairCatalogItem } from '../../../services/directionalRobotService';

export const PIRAMIDE_10R_SPEC: StrategyPairCatalogItem = STRATEGY_EA_CATALOG.find(
  (s) => s.id === 'PIRAMIDE_10R'
)!;

export const PIRAMIDE_10R_PRESETS = [
  {
    label: 'Pirâmide 50p Clássica (TP 50 / SL 100 / Máx 6)',
    patch: {
      takeProfitPoints: 50,
      stopLossPoints: 100,
      trailingStop: true,
      trailingActivationPoints: 25,
      trailingDistancePoints: 15,
      breakevenOffsetPoints: 5,
      maxOpenPositions: 6,
      onCloseOpposite: true,
    },
  },
  {
    label: 'Pirâmide Curta 35p (TP 35 / SL 75 / Máx 4)',
    patch: {
      takeProfitPoints: 35,
      stopLossPoints: 75,
      trailingStop: true,
      trailingActivationPoints: 20,
      trailingDistancePoints: 10,
      breakevenOffsetPoints: 5,
      maxOpenPositions: 4,
      onCloseOpposite: true,
    },
  },
  {
    label: 'Pirâmide Surfe 100p (TP 100 / SL 100 / Máx 8)',
    patch: {
      takeProfitPoints: 100,
      stopLossPoints: 100,
      trailingStop: true,
      trailingActivationPoints: 30,
      trailingDistancePoints: 20,
      breakevenOffsetPoints: 10,
      maxOpenPositions: 8,
      onCloseOpposite: true,
    },
  },
];

