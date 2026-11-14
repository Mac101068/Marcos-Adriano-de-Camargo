import React, { useState, useMemo, useEffect } from 'react';
import {
  Play,
  Pause,
  Sliders,
  Activity,
  Shield,
  BarChart2,
  ListOrdered,
  RefreshCw,
  FolderOpen,
  Layers,
} from 'lucide-react';
import {
  type DirectionalRobotSnapshot,
  type DirectionalPosition,
  type DirectionalMagic,
  type StrategyFamily,
  STRATEGY_EA_CATALOG,
} from '../services/directionalRobotService';
import { getPresetsForStrategy } from './eas';
import { AssetSpec, chartSymbolFor } from '../assets/assetRegistry';
import { AutomationConfig } from '../types/trading';

export interface DirectionalEAsPanelProps {
  asset: AssetSpec;
  directionalSnapshots: {
    buy: DirectionalRobotSnapshot;
    sell: DirectionalRobotSnapshot;
  };
  /** Mapa completo de snapshots de todas as estratégias por Magic Number */
  allStrategySnapshots?: Record<number, DirectionalRobotSnapshot>;
  onToggleRobot: (magic: DirectionalMagic) => void;
  config: AutomationConfig;
  onUpdateDirectionalConfig?: (magic: DirectionalMagic, patch: Partial<AutomationConfig> & { maxOpenPositions?: number }) => void;
  onChangeExecutionMode?: (magic: DirectionalMagic, mode: 'PAPER' | 'LIVE') => void;
  onResetBook?: (magic?: DirectionalMagic) => void;
}

const SELECTED_STRATEGY_STORAGE_KEY = 'fluxo_quant_b3_selected_hedge_strategy_v1';

export const DirectionalEAsPanel: React.FC<DirectionalEAsPanelProps> = ({
  asset,
  directionalSnapshots,
  allStrategySnapshots,
  onToggleRobot,
  config,
  onUpdateDirectionalConfig,
  onChangeExecutionMode,
  onResetBook,
}) => {
  const [selectedFamily, setSelectedFamily] = useState<StrategyFamily>(() => {
    try {
      const saved = localStorage.getItem(SELECTED_STRATEGY_STORAGE_KEY);
      if (saved && STRATEGY_EA_CATALOG.some((s) => s.id === saved)) return saved;
    } catch {}
    return 'HEDGE_DIRECIONAL';
  });

  const handleSelectFamily = (fam: StrategyFamily) => {
    setSelectedFamily(fam);
    setFilterMagic('ALL');
    try {
      localStorage.setItem(SELECTED_STRATEGY_STORAGE_KEY, fam);
    } catch {}
  };

  const activeSpec = useMemo(
    () => STRATEGY_EA_CATALOG.find((s) => s.id === selectedFamily) || STRATEGY_EA_CATALOG[0],
    [selectedFamily]
  );

  const buyMagic = activeSpec.buyMagic;
  const sellMagic = activeSpec.sellMagic;

  const [selectedSubTab, setSelectedSubTab] = useState<'overview' | 'trades' | 'params'>('overview');
  const [filterMagic, setFilterMagic] = useState<'ALL' | DirectionalMagic>('ALL');

  const buySnap = (allStrategySnapshots && allStrategySnapshots[buyMagic]) || directionalSnapshots.buy;
  const sellSnap = (allStrategySnapshots && allStrategySnapshots[sellMagic]) || directionalSnapshots.sell;

  const buyExecutionMode = buySnap.executionMode || 'PAPER';
  const sellExecutionMode = sellSnap.executionMode || 'PAPER';

  // Parâmetros locais dedicados para o par (Compra / Venda) da estratégia ativa
  const [buyParams, setBuyParams] = useState({
    contracts: buySnap.customConfig?.contracts || activeSpec.defaults.contracts || 1,
    stopLossPoints: buySnap.customConfig?.stopLossPoints || activeSpec.defaults.stopLossPoints || 100,
    takeProfitPoints: buySnap.customConfig?.takeProfitPoints || activeSpec.defaults.takeProfitPoints || 50,
    trailingStop: buySnap.customConfig?.trailingStop ?? activeSpec.defaults.trailingStop ?? true,
    trailingActivationPoints: buySnap.customConfig?.trailingActivationPoints || activeSpec.defaults.trailingActivationPoints || 20,
    trailingDistancePoints: buySnap.customConfig?.trailingDistancePoints || activeSpec.defaults.trailingDistancePoints || 15,
    breakevenOffsetPoints: buySnap.customConfig?.breakevenOffsetPoints ?? activeSpec.defaults.breakevenOffsetPoints ?? 5,
    maxOpenPositions: buySnap.customConfig?.maxOpenPositions || activeSpec.defaults.maxOpenPositions || 3,
    onCloseOpposite: buySnap.customConfig?.onCloseOpposite ?? activeSpec.defaults.onCloseOpposite ?? false,
  });

  const [sellParams, setSellParams] = useState({
    contracts: sellSnap.customConfig?.contracts || activeSpec.defaults.contracts || 1,
    stopLossPoints: sellSnap.customConfig?.stopLossPoints || activeSpec.defaults.stopLossPoints || 100,
    takeProfitPoints: sellSnap.customConfig?.takeProfitPoints || activeSpec.defaults.takeProfitPoints || 50,
    trailingStop: sellSnap.customConfig?.trailingStop ?? activeSpec.defaults.trailingStop ?? true,
    trailingActivationPoints: sellSnap.customConfig?.trailingActivationPoints || activeSpec.defaults.trailingActivationPoints || 20,
    trailingDistancePoints: sellSnap.customConfig?.trailingDistancePoints || activeSpec.defaults.trailingDistancePoints || 15,
    breakevenOffsetPoints: sellSnap.customConfig?.breakevenOffsetPoints ?? activeSpec.defaults.breakevenOffsetPoints ?? 5,
    maxOpenPositions: sellSnap.customConfig?.maxOpenPositions || activeSpec.defaults.maxOpenPositions || 3,
    onCloseOpposite: sellSnap.customConfig?.onCloseOpposite ?? activeSpec.defaults.onCloseOpposite ?? false,
  });

  // Sincroniza os inputs quando o operador troca de sub-pasta de estratégia ou quando o snapshot atualiza
  useEffect(() => {
    setBuyParams({
      contracts: buySnap.customConfig?.contracts || activeSpec.defaults.contracts || 1,
      stopLossPoints: buySnap.customConfig?.stopLossPoints || activeSpec.defaults.stopLossPoints || 100,
      takeProfitPoints: buySnap.customConfig?.takeProfitPoints || activeSpec.defaults.takeProfitPoints || 50,
      trailingStop: buySnap.customConfig?.trailingStop ?? activeSpec.defaults.trailingStop ?? true,
      trailingActivationPoints: buySnap.customConfig?.trailingActivationPoints || activeSpec.defaults.trailingActivationPoints || 20,
      trailingDistancePoints: buySnap.customConfig?.trailingDistancePoints || activeSpec.defaults.trailingDistancePoints || 15,
      breakevenOffsetPoints: buySnap.customConfig?.breakevenOffsetPoints ?? activeSpec.defaults.breakevenOffsetPoints ?? 5,
      maxOpenPositions: buySnap.customConfig?.maxOpenPositions || activeSpec.defaults.maxOpenPositions || 3,
      onCloseOpposite: buySnap.customConfig?.onCloseOpposite ?? activeSpec.defaults.onCloseOpposite ?? false,
    });
    setSellParams({
      contracts: sellSnap.customConfig?.contracts || activeSpec.defaults.contracts || 1,
      stopLossPoints: sellSnap.customConfig?.stopLossPoints || activeSpec.defaults.stopLossPoints || 100,
      takeProfitPoints: sellSnap.customConfig?.takeProfitPoints || activeSpec.defaults.takeProfitPoints || 50,
      trailingStop: sellSnap.customConfig?.trailingStop ?? activeSpec.defaults.trailingStop ?? true,
      trailingActivationPoints: sellSnap.customConfig?.trailingActivationPoints || activeSpec.defaults.trailingActivationPoints || 20,
      trailingDistancePoints: sellSnap.customConfig?.trailingDistancePoints || activeSpec.defaults.trailingDistancePoints || 15,
      breakevenOffsetPoints: sellSnap.customConfig?.breakevenOffsetPoints ?? activeSpec.defaults.breakevenOffsetPoints ?? 5,
      maxOpenPositions: sellSnap.customConfig?.maxOpenPositions || activeSpec.defaults.maxOpenPositions || 3,
      onCloseOpposite: sellSnap.customConfig?.onCloseOpposite ?? activeSpec.defaults.onCloseOpposite ?? false,
    });
  }, [
    buyMagic,
    sellMagic,
    buySnap.customConfig?.contracts,
    buySnap.customConfig?.stopLossPoints,
    buySnap.customConfig?.takeProfitPoints,
    buySnap.customConfig?.trailingStop,
    buySnap.customConfig?.trailingActivationPoints,
    buySnap.customConfig?.trailingDistancePoints,
    buySnap.customConfig?.breakevenOffsetPoints,
    buySnap.customConfig?.maxOpenPositions,
    buySnap.customConfig?.onCloseOpposite,
    sellSnap.customConfig?.contracts,
    sellSnap.customConfig?.stopLossPoints,
    sellSnap.customConfig?.takeProfitPoints,
    sellSnap.customConfig?.trailingStop,
    sellSnap.customConfig?.trailingActivationPoints,
    sellSnap.customConfig?.trailingDistancePoints,
    sellSnap.customConfig?.breakevenOffsetPoints,
    sellSnap.customConfig?.maxOpenPositions,
    sellSnap.customConfig?.onCloseOpposite,
    activeSpec,
  ]);

  const updateBuyParam = (patch: Partial<typeof buyParams>) => {
    setBuyParams((prev) => ({ ...prev, ...patch }));
    onUpdateDirectionalConfig?.(buyMagic, patch);
  };

  const updateSellParam = (patch: Partial<typeof sellParams>) => {
    setSellParams((prev) => ({ ...prev, ...patch }));
    onUpdateDirectionalConfig?.(sellMagic, patch);
  };

  const applyPresetToBoth = (preset: Partial<typeof buyParams>) => {
    setBuyParams((prev) => ({ ...prev, ...preset }));
    setSellParams((prev) => ({ ...prev, ...preset }));
    onUpdateDirectionalConfig?.(buyMagic, preset);
    onUpdateDirectionalConfig?.(sellMagic, preset);
  };

  const mirrorParams = (sourceMagic: DirectionalMagic) => {
    if (sourceMagic === buyMagic) {
      setSellParams({ ...buyParams });
      onUpdateDirectionalConfig?.(sellMagic, { ...buyParams });
    } else {
      setBuyParams({ ...sellParams });
      onUpdateDirectionalConfig?.(buyMagic, { ...sellParams });
    }
  };

  // Estatísticas calculadas do par selecionado
  const buyClosed = useMemo(() => buySnap.positions.filter((p) => p.status !== 'OPEN'), [buySnap.positions]);
  const sellClosed = useMemo(() => sellSnap.positions.filter((p) => p.status !== 'OPEN'), [sellSnap.positions]);

  const buyWins = buyClosed.filter((p) => (p.financialResult || 0) > 0).length;
  const sellWins = sellClosed.filter((p) => (p.financialResult || 0) > 0).length;

  const buyWinRate = buyClosed.length > 0 ? (buyWins / buyClosed.length) * 100 : 0;
  const sellWinRate = sellClosed.length > 0 ? (sellWins / sellClosed.length) * 100 : 0;

  const netPnlFinancial = buySnap.pnlFinancial + sellSnap.pnlFinancial;
  const netFloatingFinancial = (buySnap.floatingPnlFinancial || 0) + (sellSnap.floatingPnlFinancial || 0);
  const totalOpenContracts =
    buySnap.openPositions.reduce((acc, p) => acc + p.contracts, 0) +
    sellSnap.openPositions.reduce((acc, p) => acc + p.contracts, 0);

  // Lista unificada ou filtrada de trades para a tabela da estratégia selecionada
  const allPositions = useMemo(() => {
    let list: (DirectionalPosition & { robotName: string })[] = [];
    if (filterMagic === 'ALL' || filterMagic === buyMagic) {
      list = list.concat(buySnap.positions.map((p) => ({ ...p, robotName: activeSpec.buyName })));
    }
    if (filterMagic === 'ALL' || filterMagic === sellMagic) {
      list = list.concat(sellSnap.positions.map((p) => ({ ...p, robotName: activeSpec.sellName })));
    }
    return list.sort((a, b) => (b.openedAt || 0) - (a.openedAt || 0));
  }, [buySnap.positions, sellSnap.positions, filterMagic, buyMagic, sellMagic, activeSpec]);

  const strategyPresets = useMemo(() => getPresetsForStrategy(activeSpec.id), [activeSpec.id]);

  return (
    <div className="flex flex-col h-full w-full bg-slate-950 text-slate-100 overflow-y-auto">
      {/* Barra de Sub-pastas das Estratégias (Cada estratégia com seu EA de Compra + EA de Venda independente) */}
      <div className="border-b border-slate-800 bg-slate-950/90 px-4 pt-3 pb-2 shrink-0">
        <div className="flex items-center justify-between gap-2 mb-2">
          <div className="flex items-center gap-2 text-xs font-bold text-slate-300">
            <FolderOpen className="w-4 h-4 text-indigo-400" />
            <span>Sub-pastas de Estratégias (Modelo Hedge — EA Compra + EA Venda Independentes):</span>
          </div>
          <span className="text-[10px] font-mono text-slate-400">
            Pasta ativa: <span className="text-indigo-300 font-semibold">src/components/{activeSpec.folder}/</span>
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-1.5">
          {STRATEGY_EA_CATALOG.map((item) => {
            const isSelected = item.id === activeSpec.id;
            const bSnap = allStrategySnapshots?.[item.buyMagic];
            const sSnap = allStrategySnapshots?.[item.sellMagic];
            const isAnyActive = Boolean((bSnap && !bSnap.paused) || (sSnap && !sSnap.paused));
            const openCount = (bSnap?.openPositions.length || 0) + (sSnap?.openPositions.length || 0);

            return (
              <button
                key={item.id}
                onClick={() => handleSelectFamily(item.id)}
                className={`flex flex-col justify-between p-2 rounded-lg border text-left transition-all cursor-pointer ${
                  isSelected
                    ? 'bg-indigo-950/70 border-indigo-500/80 text-white shadow-md shadow-indigo-950/40'
                    : 'bg-slate-900/70 border-slate-800/90 text-slate-300 hover:bg-slate-900 hover:border-slate-700'
                }`}
              >
                <div className="flex items-center justify-between gap-1 w-full">
                  <span className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded bg-slate-950/80 text-indigo-300 border border-slate-800 truncate">
                    {item.badge}
                  </span>
                  <span className="flex items-center gap-1">
                    {openCount > 0 && (
                      <span className="px-1 py-0.2 rounded bg-amber-500/20 text-amber-300 font-mono text-[9px] font-bold">
                        {openCount} ab
                      </span>
                    )}
                    <span
                      className={`w-2 h-2 rounded-full ${
                        isAnyActive ? 'bg-emerald-400 animate-pulse shadow-[0_0_6px_#34d399]' : 'bg-slate-600'
                      }`}
                      title={isAnyActive ? 'Robô Ativo nesta estratégia' : 'Pausado'}
                    />
                  </span>
                </div>
                <div className="mt-1.5">
                  <div className="text-xs font-bold truncate">{item.shortName}</div>
                  <div className="text-[9px] font-mono text-slate-400 mt-0.5">
                    C: {item.buyMagic} · V: {item.sellMagic}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Top Banner de Status da Estratégia Selecionada */}
      <div className="border-b border-slate-800 bg-slate-900/60 p-4 shrink-0">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
              <Activity className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-base font-bold text-slate-100">{activeSpec.name}</h1>
                <span className="px-2 py-0.5 rounded text-[10px] font-mono font-semibold bg-indigo-950/80 border border-indigo-800/80 text-indigo-300">
                  {chartSymbolFor(asset)}
                </span>
                <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-emerald-950/70 border border-emerald-800/60 text-emerald-300">
                  Compra: {buyMagic} ({activeSpec.buyCommentPrefix})
                </span>
                <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-rose-950/70 border border-rose-800/60 text-rose-300">
                  Venda: {sellMagic} ({activeSpec.sellCommentPrefix})
                </span>
                <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-slate-800 text-slate-400">
                  Conta: 50534540 (XP-DEMO)
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">{activeSpec.description}</p>
            </div>
          </div>

          {/* Sub-navegação interna */}
          <div className="flex items-center gap-1 bg-slate-950/80 p-1 rounded-lg border border-slate-800">
            <button
              onClick={() => setSelectedSubTab('overview')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer ${
                selectedSubTab === 'overview'
                  ? 'bg-slate-800 text-slate-100 shadow-xs'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <BarChart2 className="w-3.5 h-3.5" />
              Visão Geral
            </button>
            <button
              onClick={() => setSelectedSubTab('trades')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer ${
                selectedSubTab === 'trades'
                  ? 'bg-slate-800 text-slate-100 shadow-xs'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <ListOrdered className="w-3.5 h-3.5" />
              Ordens & Posições ({allPositions.length})
            </button>
            <button
              onClick={() => setSelectedSubTab('params')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer ${
                selectedSubTab === 'params'
                  ? 'bg-slate-800 text-slate-100 shadow-xs'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Sliders className="w-3.5 h-3.5" />
              Parâmetros dos EAs
            </button>
          </div>
        </div>

        {/* Barra de KPIs Combinados da Estratégia Ativa */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mt-4">
          <div className="bg-slate-900/90 border border-slate-800 rounded-lg p-2.5">
            <span className="text-[10px] text-slate-400 font-medium">PnL Realizado ({activeSpec.shortName})</span>
            <div className={`text-base font-bold font-mono mt-0.5 ${netPnlFinancial >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
              {netPnlFinancial >= 0 ? '+' : ''}R$ {netPnlFinancial.toFixed(2)}
            </div>
          </div>
          <div className="bg-slate-900/90 border border-slate-800 rounded-lg p-2.5">
            <span className="text-[10px] text-slate-400 font-medium">PnL Flutuante (Aberto)</span>
            <div className={`text-base font-bold font-mono mt-0.5 ${netFloatingFinancial >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
              {netFloatingFinancial >= 0 ? '+' : ''}R$ {netFloatingFinancial.toFixed(2)}
            </div>
          </div>
          <div className="bg-slate-900/90 border border-slate-800 rounded-lg p-2.5">
            <span className="text-[10px] text-slate-400 font-medium">Posições Abertas Hedge</span>
            <div className="text-base font-bold font-mono text-slate-100 mt-0.5">
              {buySnap.openPositions.length}C / {sellSnap.openPositions.length}V
              <span className="text-xs text-slate-400 font-normal ml-1">({totalOpenContracts} ct)</span>
            </div>
          </div>
          <div className="bg-slate-900/90 border border-slate-800 rounded-lg p-2.5">
            <span className="text-[10px] text-slate-400 font-medium">Total de Saídas Fechadas</span>
            <div className="text-base font-bold font-mono text-indigo-400 mt-0.5">
              {buySnap.totalCloses + sellSnap.totalCloses}
            </div>
          </div>
          <div className="bg-slate-900/90 border border-slate-800 rounded-lg p-2.5">
            <span className="text-[10px] text-slate-400 font-medium">Status Operacional</span>
            <div className="flex items-center gap-2 mt-0.5">
              <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold ${!buySnap.paused ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-800 text-slate-400'}`}>
                COMPRA: {!buySnap.paused ? 'ON' : 'OFF'}
              </span>
              <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold ${!sellSnap.paused ? 'bg-rose-500/20 text-rose-400' : 'bg-slate-800 text-slate-400'}`}>
                VENDA: {!sellSnap.paused ? 'ON' : 'OFF'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Conteúdo Dinâmico por Sub-aba */}
      <div className="p-4 flex-1">
        {selectedSubTab === 'overview' && (
          <div className="space-y-4">
            {/* Barra de Presets Rápidos da Estratégia Selecionada */}
            <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-3 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Layers className="w-4 h-4 text-indigo-400" />
                <span className="text-xs font-bold text-slate-200">
                  Presets de 1-Clique — {activeSpec.shortName} (Aplica em {buyMagic} & {sellMagic}):
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono">
                {strategyPresets.map((p, idx) => (
                  <button
                    key={idx}
                    onClick={() => applyPresetToBoth(p.patch)}
                    className={`px-2.5 py-1 rounded border cursor-pointer transition-colors ${
                      idx === 0
                        ? 'bg-indigo-950/90 hover:bg-indigo-900 text-indigo-200 border-indigo-700/70'
                        : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700'
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Card EA de Compra */}
              <div className="bg-slate-900/70 border border-emerald-950/60 rounded-xl p-4 flex flex-col justify-between shadow-lg relative overflow-hidden">
                <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-500/5 rounded-full blur-2xl pointer-events-none" />
                <div>
                  <div className="flex items-center justify-between pb-3 border-b border-slate-800/80">
                    <div className="flex items-center gap-2.5">
                      <span className={`w-2.5 h-2.5 rounded-full ${!buySnap.paused ? 'bg-emerald-400 animate-pulse shadow-[0_0_8px_#34d399]' : 'bg-slate-600'}`} />
                      <div>
                        <h2 className="text-sm font-bold text-slate-100 flex items-center gap-2 flex-wrap">
                          {activeSpec.buyName}
                          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-950/80 text-emerald-400 border border-emerald-800/80">
                            Magic {buyMagic}
                          </span>
                          <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-slate-800/90 text-slate-300 border border-slate-700/80 flex items-center gap-1" title="Estado e posições salvos automaticamente no navegador (resiste ao F5)">
                            <Shield className="w-2.5 h-2.5 text-emerald-400" /> Persistente (F5)
                          </span>
                        </h2>
                        <span className="text-[10px] text-slate-400 font-mono">
                          Alvo: +{buyParams.takeProfitPoints}p · Stop: -{buyParams.stopLossPoints}p · Trail: {buyParams.trailingStop ? `ON (+${buyParams.trailingActivationPoints}p → BE +${buyParams.breakevenOffsetPoints}p / Dist ${buyParams.trailingDistancePoints}p)` : 'OFF'} · Máx: {buyParams.maxOpenPositions} ord
                        </span>
                      </div>
                    </div>

                    {/* Comutador de Modo Paper / Live */}
                    <div className="flex items-center gap-2">
                      <div className="flex items-center bg-slate-950 p-0.5 rounded border border-slate-800 text-[10px]">
                        <button
                          onClick={() => onChangeExecutionMode?.(buyMagic, 'PAPER')}
                          className={`px-2 py-0.5 rounded transition-colors cursor-pointer ${buyExecutionMode === 'PAPER' ? 'bg-indigo-600 text-white font-bold' : 'text-slate-400'}`}
                        >
                          Paper
                        </button>
                        <button
                          onClick={() => onChangeExecutionMode?.(buyMagic, 'LIVE')}
                          className={`px-2 py-0.5 rounded transition-colors cursor-pointer ${buyExecutionMode === 'LIVE' ? 'bg-emerald-600 text-white font-bold' : 'text-slate-400'}`}
                        >
                          MT5 Live
                        </button>
                      </div>

                      <button
                        onClick={() => onToggleRobot(buyMagic)}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                          buySnap.paused
                            ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-900/30 shadow-md'
                            : 'bg-amber-600 hover:bg-amber-500 text-white shadow-amber-900/30 shadow-md'
                        }`}
                      >
                        {buySnap.paused ? <Play className="w-3.5 h-3.5 fill-current" /> : <Pause className="w-3.5 h-3.5 fill-current" />}
                        {buySnap.paused ? 'Ativar Robô' : 'Pausar Robô'}
                      </button>
                    </div>
                  </div>

                  {/* Métricas do Robô de Compra */}
                  <div className="grid grid-cols-4 gap-2.5 my-3">
                    <div className="bg-slate-950/60 p-2.5 rounded-lg border border-slate-800/60">
                      <span className="text-[10px] text-slate-400">PnL Realizado</span>
                      <div className={`text-sm font-bold font-mono mt-0.5 ${buySnap.pnlFinancial >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {buySnap.pnlFinancial >= 0 ? '+' : ''}R$ {buySnap.pnlFinancial.toFixed(2)}
                      </div>
                    </div>
                    <div className="bg-slate-950/60 p-2.5 rounded-lg border border-slate-800/60">
                      <span className="text-[10px] text-slate-400">PnL Flutuante</span>
                      <div className={`text-sm font-bold font-mono mt-0.5 ${(buySnap.floatingPnlFinancial || 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {(buySnap.floatingPnlFinancial || 0) >= 0 ? '+' : ''}R$ {(buySnap.floatingPnlFinancial || 0).toFixed(2)}
                      </div>
                    </div>
                    <div className="bg-slate-950/60 p-2.5 rounded-lg border border-slate-800/60">
                      <span className="text-[10px] text-slate-400">Win Rate</span>
                      <div className="text-sm font-bold font-mono text-slate-200 mt-0.5">
                        {buyWinRate.toFixed(1)}% <span className="text-[10px] text-slate-500 font-normal">({buyWins}/{buyClosed.length})</span>
                      </div>
                    </div>
                    <div className="bg-slate-950/60 p-2.5 rounded-lg border border-slate-800/60">
                      <span className="text-[10px] text-slate-400">Posições Abertas</span>
                      <div className="text-sm font-bold font-mono text-emerald-400 mt-0.5">
                        {buySnap.openPositions.length}/{buyParams.maxOpenPositions} ({buySnap.openPositions.reduce((acc, p) => acc + p.contracts, 0)} ct)
                      </div>
                    </div>
                  </div>

                  {/* PAINEL EDITÁVEL DIRETO NO CARD: TP, SL, TRAILING STOP E LIMITE */}
                  <div className="bg-slate-950/80 border border-emerald-900/50 rounded-lg p-3 mb-2.5 space-y-2.5">
                    <div className="flex items-center justify-between border-b border-slate-800/80 pb-1.5">
                      <span className="text-[11px] font-bold text-emerald-300 flex items-center gap-1.5">
                        <Sliders className="w-3.5 h-3.5" /> Parâmetros Editáveis — {activeSpec.buyName} ({buyMagic})
                      </span>
                      <button
                        onClick={() => mirrorParams(buyMagic)}
                        className="text-[10px] px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 cursor-pointer transition-colors"
                        title="Copia estes valores de TP, Stop e Trailing para o EA de Venda desta estratégia"
                      >
                        Espelhar p/ Venda →
                      </button>
                    </div>

                    <div className="grid grid-cols-4 gap-2 text-[11px]">
                      <div>
                        <label className="text-[10px] text-emerald-400 font-semibold block mb-0.5">Take Profit (pts)</label>
                        <input
                          type="number"
                          step={5}
                          min={5}
                          value={buyParams.takeProfitPoints}
                          onChange={(e) => updateBuyParam({ takeProfitPoints: Math.max(5, Number(e.target.value)) })}
                          className="w-full bg-slate-900 border border-emerald-800/70 rounded px-2 py-1 font-mono font-bold text-emerald-300 focus:outline-none focus:border-emerald-400"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] text-rose-400 font-semibold block mb-0.5">Stop Loss (pts)</label>
                        <input
                          type="number"
                          step={5}
                          min={5}
                          value={buyParams.stopLossPoints}
                          onChange={(e) => updateBuyParam({ stopLossPoints: Math.max(5, Number(e.target.value)) })}
                          className="w-full bg-slate-900 border border-rose-800/70 rounded px-2 py-1 font-mono font-bold text-rose-300 focus:outline-none focus:border-rose-400"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] text-slate-400 font-semibold block mb-0.5">Contratos (Lote)</label>
                        <input
                          type="number"
                          step={1}
                          min={1}
                          value={buyParams.contracts}
                          onChange={(e) => updateBuyParam({ contracts: Math.max(1, Number(e.target.value)) })}
                          className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 font-mono font-bold text-slate-200 focus:outline-none focus:border-emerald-400"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] text-slate-400 font-semibold block mb-0.5">Máx. Ordens</label>
                        <input
                          type="number"
                          step={1}
                          min={1}
                          max={20}
                          value={buyParams.maxOpenPositions}
                          onChange={(e) => updateBuyParam({ maxOpenPositions: Math.max(1, Math.min(20, Number(e.target.value))) })}
                          className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 font-mono font-bold text-slate-200 focus:outline-none focus:border-emerald-400"
                        />
                      </div>
                    </div>

                    {/* Linha de Variáveis do Trailing Stop Editáveis */}
                    <div className="grid grid-cols-4 gap-2 text-[11px] pt-1 border-t border-slate-800/60 items-end">
                      <div>
                        <label className="text-[10px] text-amber-300 font-semibold block mb-0.5">Trailing Stop</label>
                        <button
                          onClick={() => updateBuyParam({ trailingStop: !buyParams.trailingStop })}
                          className={`w-full py-1 px-2 rounded font-mono font-bold text-[11px] border cursor-pointer transition-colors ${
                            buyParams.trailingStop
                              ? 'bg-amber-500/20 border-amber-500/50 text-amber-300'
                              : 'bg-slate-900 border-slate-800 text-slate-500'
                          }`}
                        >
                          {buyParams.trailingStop ? 'ATIVO (ON)' : 'DESATIVADO'}
                        </button>
                      </div>
                      <div>
                        <label className="text-[10px] text-amber-300/90 block mb-0.5" title="Quantos pontos de ganho disparam a proteção de Trailing/Breakeven">
                          Gatilho Trail (+pts)
                        </label>
                        <input
                          type="number"
                          step={5}
                          min={5}
                          disabled={!buyParams.trailingStop}
                          value={buyParams.trailingActivationPoints}
                          onChange={(e) => updateBuyParam({ trailingActivationPoints: Math.max(5, Number(e.target.value)) })}
                          className="w-full bg-slate-900 border border-amber-800/60 rounded px-2 py-1 font-mono font-bold text-amber-200 disabled:opacity-40 focus:outline-none focus:border-amber-400"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] text-amber-300/90 block mb-0.5" title="Distância em pontos que o Stop Loss segue atrás do topo da operação">
                          Distância Trail (pts)
                        </label>
                        <input
                          type="number"
                          step={5}
                          min={5}
                          disabled={!buyParams.trailingStop}
                          value={buyParams.trailingDistancePoints}
                          onChange={(e) => updateBuyParam({ trailingDistancePoints: Math.max(5, Number(e.target.value)) })}
                          className="w-full bg-slate-900 border border-amber-800/60 rounded px-2 py-1 font-mono font-bold text-amber-200 disabled:opacity-40 focus:outline-none focus:border-amber-400"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] text-amber-300/90 block mb-0.5" title="Ganho mínimo garantido acima da entrada assim que o gatilho é atingido">
                          Piso Breakeven (+pts)
                        </label>
                        <input
                          type="number"
                          step={5}
                          min={0}
                          disabled={!buyParams.trailingStop}
                          value={buyParams.breakevenOffsetPoints}
                          onChange={(e) => updateBuyParam({ breakevenOffsetPoints: Math.max(0, Number(e.target.value)) })}
                          className="w-full bg-slate-900 border border-amber-800/60 rounded px-2 py-1 font-mono font-bold text-amber-200 disabled:opacity-40 focus:outline-none focus:border-amber-400"
                        />
                      </div>
                    </div>

                    <div className="flex items-center justify-between pt-1 border-t border-slate-800/60 text-[11px]">
                      <span className="text-slate-400">Zerar compras se {activeSpec.sellName} sinalizar (Sinal Oposto):</span>
                      <input
                        type="checkbox"
                        checked={buyParams.onCloseOpposite}
                        onChange={(e) => updateBuyParam({ onCloseOpposite: e.target.checked })}
                        className="rounded border-slate-700 text-emerald-500 focus:ring-0 w-3.5 h-3.5 cursor-pointer"
                      />
                    </div>
                  </div>

                  {/* Último Sinal */}
                  <div className="bg-slate-950/40 p-2 rounded-lg border border-slate-800/60 text-xs flex items-center justify-between">
                    <span className="text-slate-400 text-[11px]">Último Gatilho:</span>
                    {buySnap.lastSignal ? (
                      <span className="font-mono text-emerald-300 font-semibold text-[11px]">
                        BOX #{buySnap.lastSignal.boxIndex} @ {buySnap.lastSignal.price} pts
                      </span>
                    ) : (
                      <span className="text-slate-500 italic text-[11px]">Nenhum sinal emitido</span>
                    )}
                  </div>

                  {/* Lista ao vivo de Posições Abertas */}
                  <div className="mt-2.5 bg-slate-950/60 rounded-lg border border-slate-800/70 p-2">
                    <div className="flex items-center justify-between text-[10px] text-slate-400 font-semibold uppercase mb-1.5">
                      <span>Ordens Abertas (SL / TP Ativos na Tela)</span>
                      <span className="font-mono text-emerald-400">{buySnap.openPositions.length} ativa(s)</span>
                    </div>
                    {buySnap.openPositions.length === 0 ? (
                      <div className="text-[11px] text-slate-500 italic py-1 text-center">
                        Nenhuma compra aberta no momento
                      </div>
                    ) : (
                      <div className="space-y-1 max-h-36 overflow-y-auto pr-1">
                        {buySnap.openPositions.map((pos) => {
                          const slVal = pos.stopLoss && pos.stopLoss > 0 ? pos.stopLoss : pos.entryPrice - (buyParams.stopLossPoints || 100);
                          const tpVal = pos.takeProfit && pos.takeProfit > 0 ? pos.takeProfit : pos.entryPrice + (buyParams.takeProfitPoints || 50);
                          return (
                            <div key={pos.id} className="flex items-center justify-between text-[11px] font-mono bg-slate-900/90 px-2 py-1 rounded border border-slate-800">
                              <span className="text-emerald-300 font-semibold">
                                COMPRA {pos.contracts}ct @ {pos.entryPrice} {pos.pyramidLevel ? `(P#${pos.pyramidLevel})` : ''}
                              </span>
                              <div className="flex items-center gap-2">
                                <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${pos.isBreakevenActive ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40' : 'bg-rose-950/70 text-rose-300'}`}>
                                  {pos.isBreakevenActive ? `SL TRAIL: ${slVal}` : `SL: ${slVal}`}
                                </span>
                                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-950/70 text-emerald-300">
                                  TP: {tpVal}
                                </span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>

                {/* Botão de Reset Book */}
                <div className="pt-3 mt-3 border-t border-slate-800/60 flex items-center justify-between text-[11px]">
                  <span className="text-slate-400">Total de Intenções: {buySnap.totalIntents}</span>
                  {onResetBook && (
                    <button
                      onClick={() => onResetBook(buyMagic)}
                      className="text-slate-400 hover:text-slate-200 flex items-center gap-1 cursor-pointer transition-colors"
                    >
                      <RefreshCw className="w-3 h-3" />
                      Resetar Livro ({buyMagic})
                    </button>
                  )}
                </div>
              </div>

              {/* Card EA de Venda */}
              <div className="bg-slate-900/70 border border-rose-950/60 rounded-xl p-4 flex flex-col justify-between shadow-lg relative overflow-hidden">
                <div className="absolute top-0 right-0 w-32 h-32 bg-rose-500/5 rounded-full blur-2xl pointer-events-none" />
                <div>
                  <div className="flex items-center justify-between pb-3 border-b border-slate-800/80">
                    <div className="flex items-center gap-2.5">
                      <span className={`w-2.5 h-2.5 rounded-full ${!sellSnap.paused ? 'bg-rose-400 animate-pulse shadow-[0_0_8px_#fb7185]' : 'bg-slate-600'}`} />
                      <div>
                        <h2 className="text-sm font-bold text-slate-100 flex items-center gap-2 flex-wrap">
                          {activeSpec.sellName}
                          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-rose-950/80 text-rose-400 border border-rose-800/80">
                            Magic {sellMagic}
                          </span>
                          <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-slate-800/90 text-slate-300 border border-slate-700/80 flex items-center gap-1" title="Estado e posições salvos automaticamente no navegador (resiste ao F5)">
                            <Shield className="w-2.5 h-2.5 text-rose-400" /> Persistente (F5)
                          </span>
                        </h2>
                        <span className="text-[10px] text-slate-400 font-mono">
                          Alvo: +{sellParams.takeProfitPoints}p · Stop: -{sellParams.stopLossPoints}p · Trail: {sellParams.trailingStop ? `ON (+${sellParams.trailingActivationPoints}p → BE +${sellParams.breakevenOffsetPoints}p / Dist ${sellParams.trailingDistancePoints}p)` : 'OFF'} · Máx: {sellParams.maxOpenPositions} ord
                        </span>
                      </div>
                    </div>

                    {/* Comutador de Modo Paper / Live */}
                    <div className="flex items-center gap-2">
                      <div className="flex items-center bg-slate-950 p-0.5 rounded border border-slate-800 text-[10px]">
                        <button
                          onClick={() => onChangeExecutionMode?.(sellMagic, 'PAPER')}
                          className={`px-2 py-0.5 rounded transition-colors cursor-pointer ${sellExecutionMode === 'PAPER' ? 'bg-indigo-600 text-white font-bold' : 'text-slate-400'}`}
                        >
                          Paper
                        </button>
                        <button
                          onClick={() => onChangeExecutionMode?.(sellMagic, 'LIVE')}
                          className={`px-2 py-0.5 rounded transition-colors cursor-pointer ${sellExecutionMode === 'LIVE' ? 'bg-emerald-600 text-white font-bold' : 'text-slate-400'}`}
                        >
                          MT5 Live
                        </button>
                      </div>

                      <button
                        onClick={() => onToggleRobot(sellMagic)}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                          sellSnap.paused
                            ? 'bg-rose-600 hover:bg-rose-500 text-white shadow-rose-900/30 shadow-md'
                            : 'bg-amber-600 hover:bg-amber-500 text-white shadow-amber-900/30 shadow-md'
                        }`}
                      >
                        {sellSnap.paused ? <Play className="w-3.5 h-3.5 fill-current" /> : <Pause className="w-3.5 h-3.5 fill-current" />}
                        {sellSnap.paused ? 'Ativar Robô' : 'Pausar Robô'}
                      </button>
                    </div>
                  </div>

                  {/* Métricas do Robô de Venda */}
                  <div className="grid grid-cols-4 gap-2.5 my-3">
                    <div className="bg-slate-950/60 p-2.5 rounded-lg border border-slate-800/60">
                      <span className="text-[10px] text-slate-400">PnL Realizado</span>
                      <div className={`text-sm font-bold font-mono mt-0.5 ${sellSnap.pnlFinancial >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {sellSnap.pnlFinancial >= 0 ? '+' : ''}R$ {sellSnap.pnlFinancial.toFixed(2)}
                      </div>
                    </div>
                    <div className="bg-slate-950/60 p-2.5 rounded-lg border border-slate-800/60">
                      <span className="text-[10px] text-slate-400">PnL Flutuante</span>
                      <div className={`text-sm font-bold font-mono mt-0.5 ${(sellSnap.floatingPnlFinancial || 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {(sellSnap.floatingPnlFinancial || 0) >= 0 ? '+' : ''}R$ {(sellSnap.floatingPnlFinancial || 0).toFixed(2)}
                      </div>
                    </div>
                    <div className="bg-slate-950/60 p-2.5 rounded-lg border border-slate-800/60">
                      <span className="text-[10px] text-slate-400">Win Rate</span>
                      <div className="text-sm font-bold font-mono text-slate-200 mt-0.5">
                        {sellWinRate.toFixed(1)}% <span className="text-[10px] text-slate-500 font-normal">({sellWins}/{sellClosed.length})</span>
                      </div>
                    </div>
                    <div className="bg-slate-950/60 p-2.5 rounded-lg border border-slate-800/60">
                      <span className="text-[10px] text-slate-400">Posições Abertas</span>
                      <div className="text-sm font-bold font-mono text-rose-400 mt-0.5">
                        {sellSnap.openPositions.length}/{sellParams.maxOpenPositions} ({sellSnap.openPositions.reduce((acc, p) => acc + p.contracts, 0)} ct)
                      </div>
                    </div>
                  </div>

                  {/* PAINEL EDITÁVEL DIRETO NO CARD: TP, SL, TRAILING STOP E LIMITE */}
                  <div className="bg-slate-950/80 border border-rose-900/50 rounded-lg p-3 mb-2.5 space-y-2.5">
                    <div className="flex items-center justify-between border-b border-slate-800/80 pb-1.5">
                      <span className="text-[11px] font-bold text-rose-300 flex items-center gap-1.5">
                        <Sliders className="w-3.5 h-3.5" /> Parâmetros Editáveis — {activeSpec.sellName} ({sellMagic})
                      </span>
                      <button
                        onClick={() => mirrorParams(sellMagic)}
                        className="text-[10px] px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 cursor-pointer transition-colors"
                        title="Copia estes valores de TP, Stop e Trailing para o EA de Compra desta estratégia"
                      >
                        ← Espelhar p/ Compra
                      </button>
                    </div>

                    <div className="grid grid-cols-4 gap-2 text-[11px]">
                      <div>
                        <label className="text-[10px] text-emerald-400 font-semibold block mb-0.5">Take Profit (pts)</label>
                        <input
                          type="number"
                          step={5}
                          min={5}
                          value={sellParams.takeProfitPoints}
                          onChange={(e) => updateSellParam({ takeProfitPoints: Math.max(5, Number(e.target.value)) })}
                          className="w-full bg-slate-900 border border-emerald-800/70 rounded px-2 py-1 font-mono font-bold text-emerald-300 focus:outline-none focus:border-emerald-400"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] text-rose-400 font-semibold block mb-0.5">Stop Loss (pts)</label>
                        <input
                          type="number"
                          step={5}
                          min={5}
                          value={sellParams.stopLossPoints}
                          onChange={(e) => updateSellParam({ stopLossPoints: Math.max(5, Number(e.target.value)) })}
                          className="w-full bg-slate-900 border border-rose-800/70 rounded px-2 py-1 font-mono font-bold text-rose-300 focus:outline-none focus:border-rose-400"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] text-slate-400 font-semibold block mb-0.5">Contratos (Lote)</label>
                        <input
                          type="number"
                          step={1}
                          min={1}
                          value={sellParams.contracts}
                          onChange={(e) => updateSellParam({ contracts: Math.max(1, Number(e.target.value)) })}
                          className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 font-mono font-bold text-slate-200 focus:outline-none focus:border-rose-400"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] text-slate-400 font-semibold block mb-0.5">Máx. Ordens</label>
                        <input
                          type="number"
                          step={1}
                          min={1}
                          max={20}
                          value={sellParams.maxOpenPositions}
                          onChange={(e) => updateSellParam({ maxOpenPositions: Math.max(1, Math.min(20, Number(e.target.value))) })}
                          className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 font-mono font-bold text-slate-200 focus:outline-none focus:border-rose-400"
                        />
                      </div>
                    </div>

                    {/* Linha de Variáveis do Trailing Stop Editáveis */}
                    <div className="grid grid-cols-4 gap-2 text-[11px] pt-1 border-t border-slate-800/60 items-end">
                      <div>
                        <label className="text-[10px] text-amber-300 font-semibold block mb-0.5">Trailing Stop</label>
                        <button
                          onClick={() => updateSellParam({ trailingStop: !sellParams.trailingStop })}
                          className={`w-full py-1 px-2 rounded font-mono font-bold text-[11px] border cursor-pointer transition-colors ${
                            sellParams.trailingStop
                              ? 'bg-amber-500/20 border-amber-500/50 text-amber-300'
                              : 'bg-slate-900 border-slate-800 text-slate-500'
                          }`}
                        >
                          {sellParams.trailingStop ? 'ATIVO (ON)' : 'DESATIVADO'}
                        </button>
                      </div>
                      <div>
                        <label className="text-[10px] text-amber-300/90 block mb-0.5" title="Quantos pontos de ganho disparam a proteção de Trailing/Breakeven">
                          Gatilho Trail (+pts)
                        </label>
                        <input
                          type="number"
                          step={5}
                          min={5}
                          disabled={!sellParams.trailingStop}
                          value={sellParams.trailingActivationPoints}
                          onChange={(e) => updateSellParam({ trailingActivationPoints: Math.max(5, Number(e.target.value)) })}
                          className="w-full bg-slate-900 border border-amber-800/60 rounded px-2 py-1 font-mono font-bold text-amber-200 disabled:opacity-40 focus:outline-none focus:border-amber-400"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] text-amber-300/90 block mb-0.5" title="Distância em pontos que o Stop Loss segue atrás do fundo da operação">
                          Distância Trail (pts)
                        </label>
                        <input
                          type="number"
                          step={5}
                          min={5}
                          disabled={!sellParams.trailingStop}
                          value={sellParams.trailingDistancePoints}
                          onChange={(e) => updateSellParam({ trailingDistancePoints: Math.max(5, Number(e.target.value)) })}
                          className="w-full bg-slate-900 border border-amber-800/60 rounded px-2 py-1 font-mono font-bold text-amber-200 disabled:opacity-40 focus:outline-none focus:border-amber-400"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] text-amber-300/90 block mb-0.5" title="Ganho mínimo garantido abaixo da entrada assim que o gatilho é atingido">
                          Piso Breakeven (+pts)
                        </label>
                        <input
                          type="number"
                          step={5}
                          min={0}
                          disabled={!sellParams.trailingStop}
                          value={sellParams.breakevenOffsetPoints}
                          onChange={(e) => updateSellParam({ breakevenOffsetPoints: Math.max(0, Number(e.target.value)) })}
                          className="w-full bg-slate-900 border border-amber-800/60 rounded px-2 py-1 font-mono font-bold text-amber-200 disabled:opacity-40 focus:outline-none focus:border-amber-400"
                        />
                      </div>
                    </div>

                    <div className="flex items-center justify-between pt-1 border-t border-slate-800/60 text-[11px]">
                      <span className="text-slate-400">Zerar vendas se {activeSpec.buyName} sinalizar (Sinal Oposto):</span>
                      <input
                        type="checkbox"
                        checked={sellParams.onCloseOpposite}
                        onChange={(e) => updateSellParam({ onCloseOpposite: e.target.checked })}
                        className="rounded border-slate-700 text-rose-500 focus:ring-0 w-3.5 h-3.5 cursor-pointer"
                      />
                    </div>
                  </div>

                  {/* Último Sinal */}
                  <div className="bg-slate-950/40 p-2 rounded-lg border border-slate-800/60 text-xs flex items-center justify-between">
                    <span className="text-slate-400 text-[11px]">Último Gatilho:</span>
                    {sellSnap.lastSignal ? (
                      <span className="font-mono text-rose-300 font-semibold text-[11px]">
                        BOX #{sellSnap.lastSignal.boxIndex} @ {sellSnap.lastSignal.price} pts
                      </span>
                    ) : (
                      <span className="text-slate-500 italic text-[11px]">Nenhum sinal emitido</span>
                    )}
                  </div>

                  {/* Lista ao vivo de Posições Abertas */}
                  <div className="mt-2.5 bg-slate-950/60 rounded-lg border border-slate-800/70 p-2">
                    <div className="flex items-center justify-between text-[10px] text-slate-400 font-semibold uppercase mb-1.5">
                      <span>Ordens Abertas (SL / TP Ativos na Tela)</span>
                      <span className="font-mono text-rose-400">{sellSnap.openPositions.length} ativa(s)</span>
                    </div>
                    {sellSnap.openPositions.length === 0 ? (
                      <div className="text-[11px] text-slate-500 italic py-1 text-center">
                        Nenhuma venda aberta no momento
                      </div>
                    ) : (
                      <div className="space-y-1 max-h-36 overflow-y-auto pr-1">
                        {sellSnap.openPositions.map((pos) => {
                          const slVal = pos.stopLoss && pos.stopLoss > 0 ? pos.stopLoss : pos.entryPrice + (sellParams.stopLossPoints || 100);
                          const tpVal = pos.takeProfit && pos.takeProfit > 0 ? pos.takeProfit : pos.entryPrice - (sellParams.takeProfitPoints || 50);
                          return (
                            <div key={pos.id} className="flex items-center justify-between text-[11px] font-mono bg-slate-900/90 px-2 py-1 rounded border border-slate-800">
                              <span className="text-rose-300 font-semibold">
                                VENDA {pos.contracts}ct @ {pos.entryPrice} {pos.pyramidLevel ? `(P#${pos.pyramidLevel})` : ''}
                              </span>
                              <div className="flex items-center gap-2">
                                <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${pos.isBreakevenActive ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40' : 'bg-rose-950/70 text-rose-300'}`}>
                                  {pos.isBreakevenActive ? `SL TRAIL: ${slVal}` : `SL: ${slVal}`}
                                </span>
                                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-950/70 text-emerald-300">
                                  TP: {tpVal}
                                </span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>

                {/* Botão de Reset Book */}
                <div className="pt-3 mt-3 border-t border-slate-800/60 flex items-center justify-between text-[11px]">
                  <span className="text-slate-400">Total de Intenções: {sellSnap.totalIntents}</span>
                  {onResetBook && (
                    <button
                      onClick={() => onResetBook(sellMagic)}
                      className="text-slate-400 hover:text-slate-200 flex items-center gap-1 cursor-pointer transition-colors"
                    >
                      <RefreshCw className="w-3 h-3" />
                      Resetar Livro ({sellMagic})
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Tabela de Ordens e Posições */}
        {selectedSubTab === 'trades' && (
          <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 flex flex-col h-full">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <h3 className="text-xs font-bold text-slate-200 uppercase tracking-wider">
                  Histórico de Posições — {activeSpec.name}
                </h3>
                <span className="text-[10px] bg-slate-800 px-2 py-0.5 rounded text-slate-400 font-mono">
                  {allPositions.length} registros
                </span>
              </div>
              <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800 text-[11px]">
                <button
                  onClick={() => setFilterMagic('ALL')}
                  className={`px-2 py-0.5 rounded cursor-pointer ${filterMagic === 'ALL' ? 'bg-slate-800 text-white font-semibold' : 'text-slate-400'}`}
                >
                  Todos
                </button>
                <button
                  onClick={() => setFilterMagic(buyMagic)}
                  className={`px-2 py-0.5 rounded cursor-pointer ${filterMagic === buyMagic ? 'bg-emerald-950/80 text-emerald-300 font-semibold' : 'text-slate-400'}`}
                >
                  {activeSpec.buyName} ({buyMagic})
                </button>
                <button
                  onClick={() => setFilterMagic(sellMagic)}
                  className={`px-2 py-0.5 rounded cursor-pointer ${filterMagic === sellMagic ? 'bg-rose-950/80 text-rose-300 font-semibold' : 'text-slate-400'}`}
                >
                  {activeSpec.sellName} ({sellMagic})
                </button>
              </div>
            </div>

            <div className="overflow-x-auto mt-3">
              <table className="w-full text-left text-xs font-mono">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400 text-[10px] uppercase">
                    <th className="pb-2">Robô / ID</th>
                    <th className="pb-2">Lado</th>
                    <th className="pb-2">Entrada</th>
                    <th className="pb-2">Stop Loss / Take Profit</th>
                    <th className="pb-2">Saída</th>
                    <th className="pb-2">Resultado Pts</th>
                    <th className="pb-2">Resultado (R$)</th>
                    <th className="pb-2">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/40">
                  {allPositions.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-8 text-center text-slate-500 italic">
                        Nenhuma posição gerada por {activeSpec.buyName} ({buyMagic}) ou {activeSpec.sellName} ({sellMagic}) no momento.
                      </td>
                    </tr>
                  ) : (
                    allPositions.map((pos) => {
                      const isBuy = pos.magic === buyMagic;
                      const saneSL = pos.stopLoss && pos.stopLoss > 0 ? pos.stopLoss : (pos.type === 'BUY' ? pos.entryPrice - 100 : pos.entryPrice + 100);
                      const saneTP = pos.takeProfit && pos.takeProfit > 0 ? pos.takeProfit : (pos.type === 'BUY' ? pos.entryPrice + 50 : pos.entryPrice - 50);
                      return (
                        <tr key={pos.id} className="hover:bg-slate-800/30 transition-colors">
                          <td className="py-2.5">
                            <span className={`font-semibold ${isBuy ? 'text-emerald-400' : 'text-rose-400'}`}>
                              {pos.robotName} ({pos.magic})
                            </span>
                            <div className="text-[10px] text-slate-500">{pos.comment}</div>
                          </td>
                          <td className="py-2.5">
                            <span
                              className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                pos.type === 'BUY'
                                  ? 'bg-emerald-500/20 text-emerald-400'
                                  : 'bg-rose-500/20 text-rose-400'
                              }`}
                            >
                              {pos.type}
                            </span>
                          </td>
                          <td className="py-2.5 text-slate-200">
                            {pos.entryPrice} <span className="text-[10px] text-slate-500">({pos.contracts}ct)</span>
                          </td>
                          <td className="py-2.5 text-[11px]">
                            <span className={pos.isBreakevenActive ? 'text-amber-300 font-bold' : 'text-rose-400'}>
                              SL: {saneSL} {pos.isBreakevenActive ? '(TRAIL/BE)' : ''}
                            </span>
                            <span className="text-slate-600 mx-1.5">|</span>
                            <span className="text-emerald-400">TP: {saneTP}</span>
                          </td>
                          <td className="py-2.5 text-slate-200">{pos.exitPrice || '-'}</td>
                          <td className="py-2.5">
                            {pos.pointsResult !== undefined ? (
                              <span className={pos.pointsResult >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                                {pos.pointsResult >= 0 ? '+' : ''}
                                {pos.pointsResult} pts
                              </span>
                            ) : (
                              <span className="text-slate-500">-</span>
                            )}
                          </td>
                          <td className="py-2.5 font-bold">
                            {pos.financialResult !== undefined ? (
                              <span className={pos.financialResult >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                                {pos.financialResult >= 0 ? '+' : ''}R$ {pos.financialResult.toFixed(2)}
                              </span>
                            ) : (
                              <span className="text-slate-500">-</span>
                            )}
                          </td>
                          <td className="py-2.5">
                            <span
                              className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                                pos.status === 'OPEN'
                                  ? 'bg-amber-500/20 text-amber-300'
                                  : pos.status === 'CLOSED_PROFIT'
                                  ? 'bg-emerald-500/20 text-emerald-400'
                                  : 'bg-rose-500/20 text-rose-400'
                              }`}
                            >
                              {pos.status}
                            </span>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Sub-aba de Parâmetros Individuais */}
        {selectedSubTab === 'params' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Parâmetros EA Compra */}
            <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4">
              <h3 className="text-sm font-bold text-emerald-400 flex items-center gap-2 mb-3">
                <Sliders className="w-4 h-4" /> Parâmetros Exclusivos — {activeSpec.buyName} ({buyMagic})
              </h3>
              <div className="space-y-3 text-xs">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-slate-400 block mb-1">Contratos por Ordem</label>
                    <input
                      type="number"
                      min={1}
                      value={buyParams.contracts}
                      onChange={(e) => updateBuyParam({ contracts: Math.max(1, Number(e.target.value)) })}
                      className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 font-mono text-slate-200"
                    />
                  </div>
                  <div>
                    <label className="text-slate-400 block mb-1">Máx. Ordens Abertas (Anti-Acúmulo)</label>
                    <input
                      type="number"
                      min={1}
                      max={20}
                      value={buyParams.maxOpenPositions}
                      onChange={(e) => updateBuyParam({ maxOpenPositions: Math.max(1, Math.min(20, Number(e.target.value))) })}
                      className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 font-mono text-emerald-300 font-bold"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-slate-400 block mb-1">Stop Loss Inicial (pontos)</label>
                    <input
                      type="number"
                      value={buyParams.stopLossPoints}
                      onChange={(e) => updateBuyParam({ stopLossPoints: Number(e.target.value) })}
                      className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 font-mono text-slate-200"
                    />
                  </div>
                  <div>
                    <label className="text-slate-400 block mb-1">Take Profit (pontos)</label>
                    <input
                      type="number"
                      value={buyParams.takeProfitPoints}
                      onChange={(e) => updateBuyParam({ takeProfitPoints: Number(e.target.value) })}
                      className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 font-mono text-slate-200"
                    />
                  </div>
                </div>

                {/* Bloco de Trailing Stop e Proteção de Ordem Vencedora */}
                <div className="p-3 rounded-lg bg-slate-950/80 border border-emerald-900/50 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-emerald-300 font-bold block">Trailing Stop & Proteção de Ganho</span>
                      <span className="text-[10px] text-slate-400">Impede que uma ordem vencedora volte e dê prejuízo</span>
                    </div>
                    <input
                      type="checkbox"
                      checked={buyParams.trailingStop}
                      onChange={(e) => updateBuyParam({ trailingStop: e.target.checked })}
                      className="rounded border-slate-700 text-emerald-500 focus:ring-0 w-4 h-4"
                    />
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label className="text-[10px] text-slate-400 block mb-1">Gatilho (+pts)</label>
                      <input
                        type="number"
                        min={5}
                        value={buyParams.trailingActivationPoints}
                        onChange={(e) => updateBuyParam({ trailingActivationPoints: Math.max(5, Number(e.target.value)) })}
                        className="w-full bg-slate-900 border border-slate-800 rounded px-2 py-1 font-mono text-slate-200"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] text-slate-400 block mb-1">Distância Trail (pts)</label>
                      <input
                        type="number"
                        min={5}
                        value={buyParams.trailingDistancePoints}
                        onChange={(e) => updateBuyParam({ trailingDistancePoints: Math.max(5, Number(e.target.value)) })}
                        className="w-full bg-slate-900 border border-slate-800 rounded px-2 py-1 font-mono text-slate-200"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] text-slate-400 block mb-1">Piso BE (+pts)</label>
                      <input
                        type="number"
                        min={0}
                        value={buyParams.breakevenOffsetPoints}
                        onChange={(e) => updateBuyParam({ breakevenOffsetPoints: Math.max(0, Number(e.target.value)) })}
                        className="w-full bg-slate-900 border border-slate-800 rounded px-2 py-1 font-mono text-slate-200"
                      />
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between p-2.5 rounded bg-slate-950/60 border border-slate-800">
                  <span className="text-slate-300">Fechar Compra se {activeSpec.sellName} Sinalizar:</span>
                  <input
                    type="checkbox"
                    checked={buyParams.onCloseOpposite}
                    onChange={(e) => updateBuyParam({ onCloseOpposite: e.target.checked })}
                    className="rounded border-slate-700 text-emerald-500 focus:ring-0 w-4 h-4"
                  />
                </div>
              </div>
            </div>

            {/* Parâmetros EA Venda */}
            <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4">
              <h3 className="text-sm font-bold text-rose-400 flex items-center gap-2 mb-3">
                <Sliders className="w-4 h-4" /> Parâmetros Exclusivos — {activeSpec.sellName} ({sellMagic})
              </h3>
              <div className="space-y-3 text-xs">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-slate-400 block mb-1">Contratos por Ordem</label>
                    <input
                      type="number"
                      min={1}
                      value={sellParams.contracts}
                      onChange={(e) => updateSellParam({ contracts: Math.max(1, Number(e.target.value)) })}
                      className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 font-mono text-slate-200"
                    />
                  </div>
                  <div>
                    <label className="text-slate-400 block mb-1">Máx. Ordens Abertas (Anti-Acúmulo)</label>
                    <input
                      type="number"
                      min={1}
                      max={20}
                      value={sellParams.maxOpenPositions}
                      onChange={(e) => updateSellParam({ maxOpenPositions: Math.max(1, Math.min(20, Number(e.target.value))) })}
                      className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 font-mono text-rose-300 font-bold"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-slate-400 block mb-1">Stop Loss Inicial (pontos)</label>
                    <input
                      type="number"
                      value={sellParams.stopLossPoints}
                      onChange={(e) => updateSellParam({ stopLossPoints: Number(e.target.value) })}
                      className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 font-mono text-slate-200"
                    />
                  </div>
                  <div>
                    <label className="text-slate-400 block mb-1">Take Profit (pontos)</label>
                    <input
                      type="number"
                      value={sellParams.takeProfitPoints}
                      onChange={(e) => updateSellParam({ takeProfitPoints: Number(e.target.value) })}
                      className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 font-mono text-slate-200"
                    />
                  </div>
                </div>

                {/* Bloco de Trailing Stop e Proteção de Ordem Vencedora */}
                <div className="p-3 rounded-lg bg-slate-950/80 border border-rose-900/50 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-rose-300 font-bold block">Trailing Stop & Proteção de Ganho</span>
                      <span className="text-[10px] text-slate-400">Impede que uma ordem vencedora volte e dê prejuízo</span>
                    </div>
                    <input
                      type="checkbox"
                      checked={sellParams.trailingStop}
                      onChange={(e) => updateSellParam({ trailingStop: e.target.checked })}
                      className="rounded border-slate-700 text-rose-500 focus:ring-0 w-4 h-4"
                    />
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label className="text-[10px] text-slate-400 block mb-1">Gatilho (+pts)</label>
                      <input
                        type="number"
                        min={5}
                        value={sellParams.trailingActivationPoints}
                        onChange={(e) => updateSellParam({ trailingActivationPoints: Math.max(5, Number(e.target.value)) })}
                        className="w-full bg-slate-900 border border-slate-800 rounded px-2 py-1 font-mono text-slate-200"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] text-slate-400 block mb-1">Distância Trail (pts)</label>
                      <input
                        type="number"
                        min={5}
                        value={sellParams.trailingDistancePoints}
                        onChange={(e) => updateSellParam({ trailingDistancePoints: Math.max(5, Number(e.target.value)) })}
                        className="w-full bg-slate-900 border border-slate-800 rounded px-2 py-1 font-mono text-slate-200"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] text-slate-400 block mb-1">Piso BE (+pts)</label>
                      <input
                        type="number"
                        min={0}
                        value={sellParams.breakevenOffsetPoints}
                        onChange={(e) => updateSellParam({ breakevenOffsetPoints: Math.max(0, Number(e.target.value)) })}
                        className="w-full bg-slate-900 border border-slate-800 rounded px-2 py-1 font-mono text-slate-200"
                      />
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between p-2.5 rounded bg-slate-950/60 border border-slate-800">
                  <span className="text-slate-300">Fechar Venda se {activeSpec.buyName} Sinalizar:</span>
                  <input
                    type="checkbox"
                    checked={sellParams.onCloseOpposite}
                    onChange={(e) => updateSellParam({ onCloseOpposite: e.target.checked })}
                    className="rounded border-slate-700 text-rose-500 focus:ring-0 w-4 h-4"
                  />
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
