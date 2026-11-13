import React, { useState, useMemo } from 'react';
import {
  Play,
  Pause,
  Sliders,
  DollarSign,
  TrendingUp,
  Activity,
  Shield,
  Layers,
  ArrowUpRight,
  ArrowDownRight,
  Clock,
  Radio,
  BarChart2,
  ListOrdered,
  FileText,
  AlertCircle,
  RefreshCw,
} from 'lucide-react';
import type { DirectionalRobotSnapshot, DirectionalPosition, DirectionalIntent } from '../services/directionalRobotService';
import { AssetSpec, pointsToBRL, chartSymbolFor } from '../assets/assetRegistry';
import { AutomationConfig } from '../types/trading';

export interface DirectionalEAsPanelProps {
  asset: AssetSpec;
  directionalSnapshots: {
    buy: DirectionalRobotSnapshot;
    sell: DirectionalRobotSnapshot;
  };
  onToggleRobot: (magic: 100001 | 100002) => void;
  config: AutomationConfig;
  onUpdateDirectionalConfig?: (magic: 100001 | 100002, patch: Partial<AutomationConfig> & { maxOpenPositions?: number }) => void;
  onChangeExecutionMode?: (magic: 100001 | 100002, mode: 'PAPER' | 'LIVE') => void;
  onResetBook?: (magic?: 100001 | 100002) => void;
}

export const DirectionalEAsPanel: React.FC<DirectionalEAsPanelProps> = ({
  asset,
  directionalSnapshots,
  onToggleRobot,
  config,
  onUpdateDirectionalConfig,
  onChangeExecutionMode,
  onResetBook,
}) => {
  const [selectedSubTab, setSelectedSubTab] = useState<'overview' | 'trades' | 'params'>('overview');
  const [filterMagic, setFilterMagic] = useState<'ALL' | 100001 | 100002>('ALL');

  const buySnap = directionalSnapshots.buy;
  const sellSnap = directionalSnapshots.sell;

  const buyExecutionMode = buySnap.executionMode || 'PAPER';
  const sellExecutionMode = sellSnap.executionMode || 'PAPER';

  // Parâmetros locais dedicados para cada robô (SL, TP, Lote, Trailing Stop, Breakeven, Limite de Ordens), inicializados a partir do snapshot persistido
  const [buyParams, setBuyParams] = useState({
    contracts: buySnap.customConfig?.contracts || config.contracts || 1,
    stopLossPoints: buySnap.customConfig?.stopLossPoints || 100,
    takeProfitPoints: buySnap.customConfig?.takeProfitPoints || 50,
    trailingStop: buySnap.customConfig?.trailingStop ?? true,
    trailingActivationPoints: buySnap.customConfig?.trailingActivationPoints || 20,
    trailingDistancePoints: buySnap.customConfig?.trailingDistancePoints || 15,
    breakevenOffsetPoints: buySnap.customConfig?.breakevenOffsetPoints ?? 5,
    maxOpenPositions: buySnap.customConfig?.maxOpenPositions || 3,
    onCloseOpposite: buySnap.customConfig?.onCloseOpposite ?? config.onCloseOpposite ?? false,
  });

  const [sellParams, setSellParams] = useState({
    contracts: sellSnap.customConfig?.contracts || config.contracts || 1,
    stopLossPoints: sellSnap.customConfig?.stopLossPoints || 100,
    takeProfitPoints: sellSnap.customConfig?.takeProfitPoints || 50,
    trailingStop: sellSnap.customConfig?.trailingStop ?? true,
    trailingActivationPoints: sellSnap.customConfig?.trailingActivationPoints || 20,
    trailingDistancePoints: sellSnap.customConfig?.trailingDistancePoints || 15,
    breakevenOffsetPoints: sellSnap.customConfig?.breakevenOffsetPoints ?? 5,
    maxOpenPositions: sellSnap.customConfig?.maxOpenPositions || 3,
    onCloseOpposite: sellSnap.customConfig?.onCloseOpposite ?? config.onCloseOpposite ?? false,
  });

  const updateBuyParam = (patch: Partial<typeof buyParams>) => {
    setBuyParams((prev) => ({ ...prev, ...patch }));
    onUpdateDirectionalConfig?.(100001, patch);
  };

  const updateSellParam = (patch: Partial<typeof sellParams>) => {
    setSellParams((prev) => ({ ...prev, ...patch }));
    onUpdateDirectionalConfig?.(100002, patch);
  };

  const applyPresetToBoth = (preset: Partial<typeof buyParams>) => {
    setBuyParams((prev) => ({ ...prev, ...preset }));
    setSellParams((prev) => ({ ...prev, ...preset }));
    onUpdateDirectionalConfig?.(100001, preset);
    onUpdateDirectionalConfig?.(100002, preset);
  };

  const mirrorParams = (sourceMagic: 100001 | 100002) => {
    if (sourceMagic === 100001) {
      setSellParams({ ...buyParams });
      onUpdateDirectionalConfig?.(100002, { ...buyParams });
    } else {
      setBuyParams({ ...sellParams });
      onUpdateDirectionalConfig?.(100001, { ...sellParams });
    }
  };

  // Estatísticas calculadas
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

  // Lista unificada ou filtrada de trades para a tabela
  const allPositions = useMemo(() => {
    let list: (DirectionalPosition & { robotName: string })[] = [];
    if (filterMagic === 'ALL' || filterMagic === 100001) {
      list = list.concat(buySnap.positions.map((p) => ({ ...p, robotName: 'RoboCompra' })));
    }
    if (filterMagic === 'ALL' || filterMagic === 100002) {
      list = list.concat(sellSnap.positions.map((p) => ({ ...p, robotName: 'RoboVenda' })));
    }
    return list.sort((a, b) => (b.openedAt || 0) - (a.openedAt || 0));
  }, [buySnap.positions, sellSnap.positions, filterMagic]);

  return (
    <div className="flex flex-col h-full w-full bg-slate-950 text-slate-100 overflow-y-auto">
      {/* Top Banner de Status Geral dos Robôs Hedge */}
      <div className="border-b border-slate-800 bg-slate-900/60 p-4 shrink-0">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
              <Activity className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base font-bold text-slate-100">Hedge EAs Direcionais</h1>
                <span className="px-2 py-0.5 rounded text-[10px] font-mono font-semibold bg-indigo-950/80 border border-indigo-800/80 text-indigo-300">
                  {chartSymbolFor(asset)}
                </span>
                <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-slate-800 text-slate-400">
                  Conta: 50534540 (XP-DEMO)
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Execução hedge com isolamento estrito de posições via Magic Numbers independentes
              </p>
            </div>
          </div>

          {/* Sub-navegação interna */}
          <div className="flex items-center gap-1 bg-slate-950/80 p-1 rounded-lg border border-slate-800">
            <button
              onClick={() => setSelectedSubTab('overview')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
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
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
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
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
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

        {/* Barra de KPIs Combinados */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mt-4">
          <div className="bg-slate-900/90 border border-slate-800 rounded-lg p-2.5">
            <span className="text-[10px] text-slate-400 font-medium">PnL Realizado</span>
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
            {/* Barra de Presets Rápidos de Teste para o Operador */}
            <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-3 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Sliders className="w-4 h-4 text-indigo-400" />
                <span className="text-xs font-bold text-slate-200">Ajuste Rápido de Teste (Aplicar em Compra & Venda):</span>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono">
                <button
                  onClick={() =>
                    applyPresetToBoth({
                      takeProfitPoints: 50,
                      stopLossPoints: 100,
                      trailingStop: true,
                      trailingActivationPoints: 20,
                      trailingDistancePoints: 15,
                      breakevenOffsetPoints: 5,
                      maxOpenPositions: 3,
                    })
                  }
                  className="px-2.5 py-1 rounded bg-indigo-950/90 hover:bg-indigo-900 text-indigo-200 border border-indigo-700/70 cursor-pointer transition-colors"
                >
                  Padrão (TP 50 / SL 100 / Trail +20→15)
                </button>
                <button
                  onClick={() =>
                    applyPresetToBoth({
                      takeProfitPoints: 35,
                      stopLossPoints: 70,
                      trailingStop: true,
                      trailingActivationPoints: 15,
                      trailingDistancePoints: 10,
                      breakevenOffsetPoints: 5,
                      maxOpenPositions: 2,
                    })
                  }
                  className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 cursor-pointer transition-colors"
                >
                  Scalper Curto (TP 35 / SL 70 / Trail +15→10)
                </button>
                <button
                  onClick={() =>
                    applyPresetToBoth({
                      takeProfitPoints: 80,
                      stopLossPoints: 100,
                      trailingStop: true,
                      trailingActivationPoints: 25,
                      trailingDistancePoints: 15,
                      breakevenOffsetPoints: 5,
                      maxOpenPositions: 3,
                    })
                  }
                  className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 cursor-pointer transition-colors"
                >
                  Surfe Médio (TP 80 / SL 100 / Trail +25→15)
                </button>
                <button
                  onClick={() =>
                    applyPresetToBoth({
                      takeProfitPoints: 120,
                      stopLossPoints: 100,
                      trailingStop: true,
                      trailingActivationPoints: 30,
                      trailingDistancePoints: 20,
                      breakevenOffsetPoints: 10,
                      maxOpenPositions: 3,
                    })
                  }
                  className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 cursor-pointer transition-colors"
                >
                  Alvo Longo (TP 120 / SL 100 / Trail +30→20)
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Card RoboCompra */}
              <div className="bg-slate-900/70 border border-emerald-950/60 rounded-xl p-4 flex flex-col justify-between shadow-lg relative overflow-hidden">
                <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-500/5 rounded-full blur-2xl pointer-events-none" />
                <div>
                  <div className="flex items-center justify-between pb-3 border-b border-slate-800/80">
                    <div className="flex items-center gap-2.5">
                      <span className={`w-2.5 h-2.5 rounded-full ${!buySnap.paused ? 'bg-emerald-400 animate-pulse shadow-[0_0_8px_#34d399]' : 'bg-slate-600'}`} />
                      <div>
                        <h2 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                          RoboCompra
                          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-950/80 text-emerald-400 border border-emerald-800/80">
                            Magic 100001
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
                          onClick={() => onChangeExecutionMode?.(100001, 'PAPER')}
                          className={`px-2 py-0.5 rounded transition-colors cursor-pointer ${buyExecutionMode === 'PAPER' ? 'bg-indigo-600 text-white font-bold' : 'text-slate-400'}`}
                        >
                          Paper
                        </button>
                        <button
                          onClick={() => onChangeExecutionMode?.(100001, 'LIVE')}
                          className={`px-2 py-0.5 rounded transition-colors cursor-pointer ${buyExecutionMode === 'LIVE' ? 'bg-emerald-600 text-white font-bold' : 'text-slate-400'}`}
                        >
                          MT5 Live
                        </button>
                      </div>

                      <button
                        onClick={() => onToggleRobot(100001)}
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
                        <Sliders className="w-3.5 h-3.5" /> Parâmetros Editáveis — Compra (100001)
                      </span>
                      <button
                        onClick={() => mirrorParams(100001)}
                        className="text-[10px] px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 cursor-pointer transition-colors"
                        title="Copia estes valores de TP, Stop e Trailing para o RoboVenda"
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
                      <span className="text-slate-400">Zerar compras se RoboVenda sinalizar (Sinal Oposto):</span>
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

                  {/* Lista ao vivo de Posições Abertas (com Entrada, Stop Loss / Trailing e Take Profit na tela) */}
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
                                COMPRA {pos.contracts}ct @ {pos.entryPrice}
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
                      onClick={() => onResetBook(100001)}
                      className="text-slate-400 hover:text-slate-200 flex items-center gap-1 cursor-pointer transition-colors"
                    >
                      <RefreshCw className="w-3 h-3" />
                      Resetar Livro
                    </button>
                  )}
                </div>
              </div>

              {/* Card RoboVenda */}
              <div className="bg-slate-900/70 border border-rose-950/60 rounded-xl p-4 flex flex-col justify-between shadow-lg relative overflow-hidden">
                <div className="absolute top-0 right-0 w-32 h-32 bg-rose-500/5 rounded-full blur-2xl pointer-events-none" />
                <div>
                  <div className="flex items-center justify-between pb-3 border-b border-slate-800/80">
                    <div className="flex items-center gap-2.5">
                      <span className={`w-2.5 h-2.5 rounded-full ${!sellSnap.paused ? 'bg-rose-400 animate-pulse shadow-[0_0_8px_#fb7185]' : 'bg-slate-600'}`} />
                      <div>
                        <h2 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                          RoboVenda
                          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-rose-950/80 text-rose-400 border border-rose-800/80">
                            Magic 100002
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
                          onClick={() => onChangeExecutionMode?.(100002, 'PAPER')}
                          className={`px-2 py-0.5 rounded transition-colors cursor-pointer ${sellExecutionMode === 'PAPER' ? 'bg-indigo-600 text-white font-bold' : 'text-slate-400'}`}
                        >
                          Paper
                        </button>
                        <button
                          onClick={() => onChangeExecutionMode?.(100002, 'LIVE')}
                          className={`px-2 py-0.5 rounded transition-colors cursor-pointer ${sellExecutionMode === 'LIVE' ? 'bg-emerald-600 text-white font-bold' : 'text-slate-400'}`}
                        >
                          MT5 Live
                        </button>
                      </div>

                      <button
                        onClick={() => onToggleRobot(100002)}
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
                        <Sliders className="w-3.5 h-3.5" /> Parâmetros Editáveis — Venda (100002)
                      </span>
                      <button
                        onClick={() => mirrorParams(100002)}
                        className="text-[10px] px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 cursor-pointer transition-colors"
                        title="Copia estes valores de TP, Stop e Trailing para o RoboCompra"
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
                      <span className="text-slate-400">Zerar vendas se RoboCompra sinalizar (Sinal Oposto):</span>
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

                  {/* Lista ao vivo de Posições Abertas (com Entrada, Stop Loss / Trailing e Take Profit na tela) */}
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
                                VENDA {pos.contracts}ct @ {pos.entryPrice}
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
                      onClick={() => onResetBook(100002)}
                      className="text-slate-400 hover:text-slate-200 flex items-center gap-1 cursor-pointer transition-colors"
                    >
                      <RefreshCw className="w-3 h-3" />
                      Resetar Livro
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
                <h3 className="text-xs font-bold text-slate-200 uppercase tracking-wider">Histórico de Posições dos Robôs</h3>
                <span className="text-[10px] bg-slate-800 px-2 py-0.5 rounded text-slate-400 font-mono">
                  {allPositions.length} registros
                </span>
              </div>
              <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800 text-[11px]">
                <button
                  onClick={() => setFilterMagic('ALL')}
                  className={`px-2 py-0.5 rounded ${filterMagic === 'ALL' ? 'bg-slate-800 text-white font-semibold' : 'text-slate-400'}`}
                >
                  Todos
                </button>
                <button
                  onClick={() => setFilterMagic(100001)}
                  className={`px-2 py-0.5 rounded ${filterMagic === 100001 ? 'bg-emerald-950/80 text-emerald-300 font-semibold' : 'text-slate-400'}`}
                >
                  RoboCompra (100001)
                </button>
                <button
                  onClick={() => setFilterMagic(100002)}
                  className={`px-2 py-0.5 rounded ${filterMagic === 100002 ? 'bg-rose-950/80 text-rose-300 font-semibold' : 'text-slate-400'}`}
                >
                  RoboVenda (100002)
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
                        Nenhuma posição gerada pelos robôs hedge no momento.
                      </td>
                    </tr>
                  ) : (
                    allPositions.map((pos) => {
                      const isBuy = pos.magic === 100001;
                      const saneSL = pos.stopLoss && pos.stopLoss > 0 ? pos.stopLoss : (pos.type === 'BUY' ? pos.entryPrice - 100 : pos.entryPrice + 100);
                      const saneTP = pos.takeProfit && pos.takeProfit > 0 ? pos.takeProfit : (pos.type === 'BUY' ? pos.entryPrice + 50 : pos.entryPrice - 50);
                      return (
                        <tr key={pos.id} className="hover:bg-slate-800/30 transition-colors">
                          <td className="py-2.5">
                            <span className={`font-semibold ${isBuy ? 'text-emerald-400' : 'text-rose-400'}`}>
                              {pos.robotName}
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
            {/* Parâmetros RoboCompra */}
            <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4">
              <h3 className="text-sm font-bold text-emerald-400 flex items-center gap-2 mb-3">
                <Sliders className="w-4 h-4" /> Parâmetros Exclusivos - RoboCompra (100001)
              </h3>
              <div className="space-y-3 text-xs">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-slate-400 block mb-1">Contratos por Ordem</label>
                    <input
                      type="number"
                      min={1}
                      value={buyParams.contracts}
                      onChange={(e) => {
                        const v = Math.max(1, Number(e.target.value));
                        setBuyParams({ ...buyParams, contracts: v });
                        onUpdateDirectionalConfig?.(100001, { contracts: v });
                      }}
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
                      onChange={(e) => {
                        const v = Math.max(1, Math.min(20, Number(e.target.value)));
                        setBuyParams({ ...buyParams, maxOpenPositions: v });
                        onUpdateDirectionalConfig?.(100001, { maxOpenPositions: v });
                      }}
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
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        setBuyParams({ ...buyParams, stopLossPoints: v });
                        onUpdateDirectionalConfig?.(100001, { stopLossPoints: v });
                      }}
                      className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 font-mono text-slate-200"
                    />
                  </div>
                  <div>
                    <label className="text-slate-400 block mb-1">Take Profit (pontos)</label>
                    <input
                      type="number"
                      value={buyParams.takeProfitPoints}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        setBuyParams({ ...buyParams, takeProfitPoints: v });
                        onUpdateDirectionalConfig?.(100001, { takeProfitPoints: v });
                      }}
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
                      onChange={(e) => {
                        const v = e.target.checked;
                        setBuyParams({ ...buyParams, trailingStop: v });
                        onUpdateDirectionalConfig?.(100001, { trailingStop: v });
                      }}
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
                        onChange={(e) => {
                          const v = Math.max(5, Number(e.target.value));
                          setBuyParams({ ...buyParams, trailingActivationPoints: v });
                          onUpdateDirectionalConfig?.(100001, { trailingActivationPoints: v });
                        }}
                        className="w-full bg-slate-900 border border-slate-800 rounded px-2 py-1 font-mono text-slate-200"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] text-slate-400 block mb-1">Distância Trail (pts)</label>
                      <input
                        type="number"
                        min={5}
                        value={buyParams.trailingDistancePoints}
                        onChange={(e) => {
                          const v = Math.max(5, Number(e.target.value));
                          setBuyParams({ ...buyParams, trailingDistancePoints: v });
                          onUpdateDirectionalConfig?.(100001, { trailingDistancePoints: v });
                        }}
                        className="w-full bg-slate-900 border border-slate-800 rounded px-2 py-1 font-mono text-slate-200"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] text-slate-400 block mb-1">Piso BE (+pts)</label>
                      <input
                        type="number"
                        min={0}
                        value={buyParams.breakevenOffsetPoints}
                        onChange={(e) => {
                          const v = Math.max(0, Number(e.target.value));
                          setBuyParams({ ...buyParams, breakevenOffsetPoints: v });
                          onUpdateDirectionalConfig?.(100001, { breakevenOffsetPoints: v });
                        }}
                        className="w-full bg-slate-900 border border-slate-800 rounded px-2 py-1 font-mono text-slate-200"
                      />
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between p-2.5 rounded bg-slate-950/60 border border-slate-800">
                  <span className="text-slate-300">Fechar Compra se Robô de Venda Sinalizar:</span>
                  <input
                    type="checkbox"
                    checked={buyParams.onCloseOpposite}
                    onChange={(e) => {
                      const v = e.target.checked;
                      setBuyParams({ ...buyParams, onCloseOpposite: v });
                      onUpdateDirectionalConfig?.(100001, { onCloseOpposite: v });
                    }}
                    className="rounded border-slate-700 text-emerald-500 focus:ring-0 w-4 h-4"
                  />
                </div>
              </div>
            </div>

            {/* Parâmetros RoboVenda */}
            <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4">
              <h3 className="text-sm font-bold text-rose-400 flex items-center gap-2 mb-3">
                <Sliders className="w-4 h-4" /> Parâmetros Exclusivos - RoboVenda (100002)
              </h3>
              <div className="space-y-3 text-xs">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-slate-400 block mb-1">Contratos por Ordem</label>
                    <input
                      type="number"
                      min={1}
                      value={sellParams.contracts}
                      onChange={(e) => {
                        const v = Math.max(1, Number(e.target.value));
                        setSellParams({ ...sellParams, contracts: v });
                        onUpdateDirectionalConfig?.(100002, { contracts: v });
                      }}
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
                      onChange={(e) => {
                        const v = Math.max(1, Math.min(20, Number(e.target.value)));
                        setSellParams({ ...sellParams, maxOpenPositions: v });
                        onUpdateDirectionalConfig?.(100002, { maxOpenPositions: v });
                      }}
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
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        setSellParams({ ...sellParams, stopLossPoints: v });
                        onUpdateDirectionalConfig?.(100002, { stopLossPoints: v });
                      }}
                      className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 font-mono text-slate-200"
                    />
                  </div>
                  <div>
                    <label className="text-slate-400 block mb-1">Take Profit (pontos)</label>
                    <input
                      type="number"
                      value={sellParams.takeProfitPoints}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        setSellParams({ ...sellParams, takeProfitPoints: v });
                        onUpdateDirectionalConfig?.(100002, { takeProfitPoints: v });
                      }}
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
                      onChange={(e) => {
                        const v = e.target.checked;
                        setSellParams({ ...sellParams, trailingStop: v });
                        onUpdateDirectionalConfig?.(100002, { trailingStop: v });
                      }}
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
                        onChange={(e) => {
                          const v = Math.max(5, Number(e.target.value));
                          setSellParams({ ...sellParams, trailingActivationPoints: v });
                          onUpdateDirectionalConfig?.(100002, { trailingActivationPoints: v });
                        }}
                        className="w-full bg-slate-900 border border-slate-800 rounded px-2 py-1 font-mono text-slate-200"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] text-slate-400 block mb-1">Distância Trail (pts)</label>
                      <input
                        type="number"
                        min={5}
                        value={sellParams.trailingDistancePoints}
                        onChange={(e) => {
                          const v = Math.max(5, Number(e.target.value));
                          setSellParams({ ...sellParams, trailingDistancePoints: v });
                          onUpdateDirectionalConfig?.(100002, { trailingDistancePoints: v });
                        }}
                        className="w-full bg-slate-900 border border-slate-800 rounded px-2 py-1 font-mono text-slate-200"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] text-slate-400 block mb-1">Piso BE (+pts)</label>
                      <input
                        type="number"
                        min={0}
                        value={sellParams.breakevenOffsetPoints}
                        onChange={(e) => {
                          const v = Math.max(0, Number(e.target.value));
                          setSellParams({ ...sellParams, breakevenOffsetPoints: v });
                          onUpdateDirectionalConfig?.(100002, { breakevenOffsetPoints: v });
                        }}
                        className="w-full bg-slate-900 border border-slate-800 rounded px-2 py-1 font-mono text-slate-200"
                      />
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between p-2.5 rounded bg-slate-950/60 border border-slate-800">
                  <span className="text-slate-300">Fechar Venda se Robô de Compra Sinalizar:</span>
                  <input
                    type="checkbox"
                    checked={sellParams.onCloseOpposite}
                    onChange={(e) => {
                      const v = e.target.checked;
                      setSellParams({ ...sellParams, onCloseOpposite: v });
                      onUpdateDirectionalConfig?.(100002, { onCloseOpposite: v });
                    }}
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

