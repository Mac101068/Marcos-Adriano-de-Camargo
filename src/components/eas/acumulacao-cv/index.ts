import { STRATEGY_EA_CATALOG, StrategyPairCatalogItem } from '../../../services/directionalRobotService';

export const ACUMULACAO_CV_SPEC: StrategyPairCatalogItem = STRATEGY_EA_CATALOG.find(
  (s) => s.id === 'ACUMULACAO_CV'
)!;

export const ACUMULACAO_CV_PRESETS = [
  {
    label: 'C/V Índice WIN (TP 100 / SL 100 / Máx 8 / Zera Oposto)',
    patch: {
      takeProfitPoints: 100,
      stopLossPoints: 100,
      trailingStop: false,
      trailingActivationPoints: 30,
      trailingDistancePoints: 20,
      breakevenOffsetPoints: 5,
      maxOpenPositions: 8,
      onCloseOpposite: true,
    },
  },
  {
    label: 'C/V Protegido c/ Trail (TP 120 / SL 100 / Trail +30→20)',
    patch: {
      takeProfitPoints: 120,
      stopLossPoints: 100,
      trailingStop: true,
      trailingActivationPoints: 30,
      trailingDistancePoints: 20,
      breakevenOffsetPoints: 5,
      maxOpenPositions: 6,
      onCloseOpposite: true,
    },
  },
];

