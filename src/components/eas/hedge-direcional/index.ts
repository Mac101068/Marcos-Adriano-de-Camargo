import { STRATEGY_EA_CATALOG, StrategyPairCatalogItem } from '../../../services/directionalRobotService';

export const HEDGE_DIRECIONAL_SPEC: StrategyPairCatalogItem = STRATEGY_EA_CATALOG.find(
  (s) => s.id === 'HEDGE_DIRECIONAL'
)!;

export const HEDGE_DIRECIONAL_PRESETS = [
  {
    label: 'Padrão (TP 50 / SL 100 / Trail +20→15)',
    patch: {
      takeProfitPoints: 50,
      stopLossPoints: 100,
      trailingStop: true,
      trailingActivationPoints: 20,
      trailingDistancePoints: 15,
      breakevenOffsetPoints: 5,
      maxOpenPositions: 3,
    },
  },
  {
    label: 'Scalper Curto (TP 35 / SL 70 / Trail +15→10)',
    patch: {
      takeProfitPoints: 35,
      stopLossPoints: 70,
      trailingStop: true,
      trailingActivationPoints: 15,
      trailingDistancePoints: 10,
      breakevenOffsetPoints: 5,
      maxOpenPositions: 2,
    },
  },
  {
    label: 'Surfe Médio (TP 80 / SL 100 / Trail +25→15)',
    patch: {
      takeProfitPoints: 80,
      stopLossPoints: 100,
      trailingStop: true,
      trailingActivationPoints: 25,
      trailingDistancePoints: 15,
      breakevenOffsetPoints: 5,
      maxOpenPositions: 3,
    },
  },
  {
    label: 'Alvo Longo (TP 120 / SL 100 / Trail +30→20)',
    patch: {
      takeProfitPoints: 120,
      stopLossPoints: 100,
      trailingStop: true,
      trailingActivationPoints: 30,
      trailingDistancePoints: 20,
      breakevenOffsetPoints: 10,
      maxOpenPositions: 3,
    },
  },
];

