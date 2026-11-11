export type MultiRobotId = 'WIN' | 'WDO' | 'BIT';
export type RobotExecutionMode = 'COPILOT' | 'AUTO' | 'SHADOW' | 'OFF';

export interface MultiRobotSpec {
  id: MultiRobotId;
  label: string;
  symbol: string;
  magic: number;
  boxPoints: number;
  scaleLabel: string;
  defaultContracts: number;
  defaultSlPoints: number;
  defaultTpPoints: number;
  tickSize: number;
  pointValue: number;
}

export const MULTI_ROBOTS: Record<MultiRobotId, MultiRobotSpec> = {
  WIN: {
    id: 'WIN',
    label: 'Mini-Índice',
    symbol: 'WINZ26',
    magic: 150101,
    boxPoints: 50,
    scaleLabel: '10R',
    defaultContracts: 1,
    defaultSlPoints: 50,
    defaultTpPoints: 100,
    tickSize: 5,
    pointValue: 0.2,
  },
  WDO: {
    id: 'WDO',
    label: 'Mini-Dólar',
    symbol: 'WDOZ26',
    magic: 150201,
    boxPoints: 2.5,
    scaleLabel: '2.5R',
    defaultContracts: 1,
    defaultSlPoints: 2.5,
    defaultTpPoints: 5.0,
    tickSize: 0.5,
    pointValue: 10.0,
  },
  BIT: {
    id: 'BIT',
    label: 'Bitcoin B3',
    symbol: 'BITX26',
    magic: 150301,
    boxPoints: 100,
    scaleLabel: '100R',
    defaultContracts: 1,
    defaultSlPoints: 200,
    defaultTpPoints: 400,
    tickSize: 20,
    pointValue: 0.01,
  },
};

export interface AssetSignalState {
  symbol: string;
  assetKey: MultiRobotId;
  signal: 'BUY' | 'SELL' | null;
  reason: string;
  price: number;
  timestamp: number;
  boxIndex: number;
}

export interface RobotRuntimeState {
  id: MultiRobotId;
  mode: RobotExecutionMode;
  contracts: number;
  slPoints: number;
  tpPoints: number;
}

export interface VaralItemConfig {
  enabled: boolean;
  magic: number;
  execution_type: 'MARKET' | 'LIMIT';
  step_points: number;
  max_orders: number;
  contracts: number;
  tp_points: number;
  sl_points: number;
}

export type VaralConfigMap = Record<MultiRobotId, VaralItemConfig>;

export const DEFAULT_VARAL_CONFIG: VaralConfigMap = {
  WIN: {
    enabled: false,
    magic: 150102,
    execution_type: 'MARKET',
    step_points: 50.0,
    max_orders: 3,
    contracts: 1,
    tp_points: 50.0,
    sl_points: 50.0,
  },
  WDO: {
    enabled: false,
    magic: 150202,
    execution_type: 'MARKET',
    step_points: 2.5,
    max_orders: 3,
    contracts: 1,
    tp_points: 2.5,
    sl_points: 2.5,
  },
  BIT: {
    enabled: false,
    magic: 150302,
    execution_type: 'MARKET',
    step_points: 100.0,
    max_orders: 3,
    contracts: 1,
    tp_points: 100.0,
    sl_points: 100.0,
  },
};


