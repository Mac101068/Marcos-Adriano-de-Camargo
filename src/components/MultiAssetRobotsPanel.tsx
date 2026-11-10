import React, { useState } from 'react';
import { Zap, Shield, Play, Power, AlertTriangle, ArrowUpCircle, ArrowDownCircle, Check, RefreshCw } from 'lucide-react';
import { MULTI_ROBOTS, MultiRobotId, RobotExecutionMode, AssetSignalState, RobotRuntimeState } from '../types/multiRobots';
import { PositionSummary } from './MultiAssetRobotsBar';

interface MultiAssetRobotsPanelProps {
  initialAssetId?: MultiRobotId;
  signals: Record<string, AssetSignalState>;
  positions: PositionSummary[];
  robotStates: Record<MultiRobotId, RobotRuntimeState>;
  dayStatsBySymbol?: Record<string, { netRealized: number; realizedProfit: number; realizedLoss: number; totalContractsToday: number }>;
  onChangeRobotState: (assetId: MultiRobotId, patch: Partial<RobotRuntimeState>) => void;
  onExecuteSignal: (assetId: MultiRobotId, signal: 'BUY' | 'SELL') => void;
  onManualOrder: (assetId: MultiRobotId, type: 'BUY' | 'SELL') => void;
  onClosePosition: (assetId: MultiRobotId) => void;
}

const fmtBRL = (v: number) =>
  `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const MultiAssetRobotsPanel: React.FC<MultiAssetRobotsPanelProps> = ({
  initialAssetId = 'WIN',
  signals,
  positions,
  robotStates,
  dayStatsBySymbol,
  onChangeRobotState,
  onExecuteSignal,
  onManualOrder,
  onClosePosition,
}) => {
  const [selectedAsset, setSelectedAsset] = useState<MultiRobotId>(initialAssetId);

  React.useEffect(() => {
    if (initialAssetId) {
      setSelectedAsset(initialAssetId);
    }
  }, [initialAssetId]);

  const spec = MULTI_ROBOTS[selectedAsset];
  const state = robotStates[selectedAsset] || {
    id: selectedAsset,
    mode: 'COPILOT',
    contracts: spec.defaultContracts,
    slPoints: spec.defaultSlPoints,
    tpPoints: spec.defaultTpPoints,
  };

  const sig = signals[spec.symbol] || Object.values(signals).find((s) => s.assetKey === selectedAsset);
  const posList = positions.filter((p) => p.magic === spec.magic || p.symbol.includes(selectedAsset));
  const totalProfit = posList.reduce((acc, p) => acc + p.profit, 0);
  const hasPos = posList.length > 0;

  const curStat = dayStatsBySymbol ? dayStatsBySymbol[selectedAsset] : undefined;
  const curNetRealized = curStat ? curStat.netRealized : 0;
  const totalDayPnl = curNetRealized + totalProfit;

  const assetTabs: MultiRobotId[] = ['WIN', 'WDO', 'BIT'];

  return (
    <div className="flex flex-col text-[11px] text-slate-200">
      {/* Abas Superiores dos 3 Ativos */}
      <div className="flex border-b border-slate-800 bg-slate-950/80">
        {assetTabs.map((id) => {
          const tabSpec = MULTI_ROBOTS[id];
          const isSelected = selectedAsset === id;
          const tabPos = positions.filter((p) => p.magic === tabSpec.magic || p.symbol.includes(id));
          const tabProfit = tabPos.reduce((acc, p) => acc + p.profit, 0);
          const tabStat = dayStatsBySymbol ? dayStatsBySymbol[id] : undefined;
          const tabNet = tabStat ? tabStat.netRealized : 0;
          const tabDayPnl = tabNet + tabProfit;
          const hasActivity = (tabStat && tabStat.totalContractsToday > 0) || tabPos.length > 0;

          return (
            <button
              key={id}
              onClick={() => setSelectedAsset(id)}
              className={`flex-1 py-1.5 px-2 text-center font-bold text-[10px] transition-all cursor-pointer border-b-2 flex items-center justify-center gap-1.5 ${
                isSelected
                  ? 'border-emerald-500 bg-slate-900 text-white'
                  : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-900/40'
              }`}
            >
              <span>{id}</span>
              <span className="text-[9px] text-slate-500 font-mono">({tabSpec.scaleLabel})</span>
              {hasActivity && (
                <span
                  className={`text-[8.5px] font-mono px-1 rounded ${
                    tabDayPnl >= 0 ? 'bg-emerald-950 text-emerald-400' : 'bg-rose-950 text-rose-400'
                  }`}
                >
                  {tabDayPnl >= 0 ? '+' : ''}
                  {tabDayPnl.toFixed(0)}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="p-3 space-y-3">
        {/* Identificação e Magic */}
        <div className="flex items-center justify-between pb-2 border-b border-slate-800/80">
          <div>
            <h4 className="font-bold text-slate-100 text-[12px]">{spec.label}</h4>
            <span className="text-[9.5px] text-slate-400 font-mono">
              Símbolo: {spec.symbol} · Magic: {spec.magic}
            </span>
          </div>
          <div className="text-right">
            <span className="text-[9px] text-slate-400 block">Renko Nativo</span>
            <span className="text-[11px] font-bold text-emerald-400 font-mono">
              {spec.scaleLabel} ({spec.boxPoints} pts)
            </span>
          </div>
        </div>

        {/* Seletor de Modo Operacional */}
        <div>
          <label className="text-[9.5px] font-bold uppercase tracking-wider text-slate-400 block mb-1">
            Modo Operacional
          </label>
          <div className="grid grid-cols-3 gap-1">
            {(['COPILOT', 'AUTO', 'SHADOW'] as RobotExecutionMode[]).map((m) => {
              const active = state.mode === m;
              return (
                <button
                  key={m}
                  onClick={() => onChangeRobotState(selectedAsset, { mode: m })}
                  className={`py-1.5 px-1 rounded border text-[10px] font-bold cursor-pointer transition-colors text-center ${
                    active
                      ? m === 'COPILOT'
                        ? 'bg-sky-600 border-sky-400 text-white'
                        : m === 'AUTO'
                        ? 'bg-emerald-600 border-emerald-400 text-white'
                        : 'bg-purple-600 border-purple-400 text-white'
                      : 'bg-slate-900 border-slate-800 text-slate-400 hover:bg-slate-800'
                  }`}
                >
                  {m === 'COPILOT' ? 'Copiloto' : m === 'AUTO' ? 'Automático' : 'Sombra'}
                </button>
              );
            })}
          </div>
          <p className="text-[9px] text-slate-500 mt-1 leading-tight">
            {state.mode === 'COPILOT' &&
              '💡 O EA analisa o fluxo e gera o sinal na tela. Você clica para confirmar o envio da ordem.'}
            {state.mode === 'AUTO' &&
              '⚡ O robô executa a mercado automaticamente assim que a confluência fecha o box.'}
            {state.mode === 'SHADOW' &&
              '📝 Execução simulada em papel: testa a assertividade sem arriscar capital na conta.'}
          </p>
        </div>

        {/* Leitura de Sinal do EA Principal */}
        <div className="bg-slate-950/70 border border-slate-800 rounded p-2.5">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[9.5px] font-bold uppercase text-slate-400">Último Sinal do Motor EA</span>
            {sig && (
              <span className="text-[9px] font-mono text-slate-500">
                Box #{sig.boxIndex} · {new Date(sig.timestamp).toLocaleTimeString('pt-BR')}
              </span>
            )}
          </div>

          {sig && sig.signal ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  {sig.signal === 'BUY' ? (
                    <ArrowUpCircle className="w-4 h-4 text-emerald-400" />
                  ) : (
                    <ArrowDownCircle className="w-4 h-4 text-rose-400" />
                  )}
                  <span
                    className={`font-bold text-[12px] ${
                      sig.signal === 'BUY' ? 'text-emerald-400' : 'text-rose-400'
                    }`}
                  >
                    SINAL {sig.signal}
                  </span>
                </div>
                <span className="font-mono text-[11px] text-slate-200">@ {sig.price} pts</span>
              </div>
              <p className="text-[9.5px] text-slate-300 leading-snug">{sig.reason}</p>

              {/* Botão de Disparo do Copiloto */}
              <button
                onClick={() => onExecuteSignal(selectedAsset, sig.signal!)}
                className={`w-full py-1.5 rounded font-bold text-[11px] text-white flex items-center justify-center gap-1.5 cursor-pointer shadow-md transition-transform active:scale-98 ${
                  sig.signal === 'BUY'
                    ? 'bg-emerald-600 hover:bg-emerald-500 shadow-emerald-900/30'
                    : 'bg-rose-600 hover:bg-rose-500 shadow-rose-900/30'
                }`}
              >
                <Zap className="w-3.5 h-3.5 fill-current" />
                <span>Confirmar Entrada ({sig.signal})</span>
              </button>
            </div>
          ) : (
            <div className="py-2 text-center text-slate-500 text-[10px]">
              Aguardando formação de confluência institucional de fluxo no {spec.label}...
            </div>
          )}
        </div>

        {/* Posições Abertas e PnL do Dia no MT5 */}
        <div className="bg-slate-950/70 border border-slate-800 rounded p-2.5">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[9.5px] font-bold uppercase text-slate-400">Desempenho no MT5 (Hoje)</span>
            <div className="flex items-center gap-1.5">
              <span
                className={`font-mono font-bold text-[11px] ${
                  totalDayPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'
                }`}
                title={`PnL Consolidado: Realizado ${fmtBRL(curNetRealized)} + Flutuante ${fmtBRL(totalProfit)}`}
              >
                {totalDayPnl >= 0 ? '+' : ''}
                {fmtBRL(totalDayPnl)}
              </span>
              <span className="text-[8.5px] text-zinc-500 font-mono">
                ({fmtBRL(curNetRealized)} fechado{hasPos ? ` · ${fmtBRL(totalProfit)} aberto` : ''})
              </span>
            </div>
          </div>

          {hasPos ? (
            <div className="space-y-1.5">
              {posList.map((pos) => (
                <div
                  key={pos.symbol + pos.openPrice}
                  className="flex items-center justify-between text-[10px] bg-slate-900/80 p-1.5 rounded border border-slate-800"
                >
                  <span
                    className={`font-bold ${pos.type === 'BUY' ? 'text-emerald-400' : 'text-rose-400'}`}
                  >
                    {pos.type} {pos.volume}ct
                  </span>
                  <span className="font-mono text-slate-300">@ {pos.openPrice}</span>
                  <span
                    className={`font-mono font-bold ${
                      pos.profit >= 0 ? 'text-emerald-400' : 'text-rose-400'
                    }`}
                  >
                    {pos.profit >= 0 ? '+' : ''}
                    {fmtBRL(pos.profit)}
                  </span>
                </div>
              ))}
              <button
                onClick={() => onClosePosition(selectedAsset)}
                className="w-full mt-1.5 py-1 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-rose-300 font-bold text-[10px] transition-colors cursor-pointer"
              >
                Zerar Posição em {selectedAsset}
              </button>
            </div>
          ) : (
            <span className="text-slate-500 text-[10px] block text-center py-1">
              Nenhuma posição aberta no momento.
            </span>
          )}
        </div>

        {/* Controles de Risco & Parâmetros do Ativo */}
        <div className="space-y-2 pt-1 border-t border-slate-800/80">
          <div className="grid grid-cols-3 gap-2">
            <div>
              <span className="text-[9px] uppercase text-slate-500 block">Contratos</span>
              <input
                type="number"
                min={1}
                max={100}
                value={state.contracts}
                onChange={(e) =>
                  onChangeRobotState(selectedAsset, { contracts: Math.max(1, parseInt(e.target.value) || 1) })
                }
                className="w-full h-6 rounded bg-slate-950 border border-slate-700 text-center font-mono font-bold text-slate-100 text-[11px] focus:outline-none focus:border-emerald-500"
              />
            </div>
            <div>
              <span className="text-[9px] uppercase text-slate-500 block">Alvo (TP pts)</span>
              <input
                type="number"
                value={state.tpPoints}
                onChange={(e) =>
                  onChangeRobotState(selectedAsset, { tpPoints: parseFloat(e.target.value) || 0 })
                }
                className="w-full h-6 rounded bg-slate-950 border border-slate-700 text-center font-mono font-bold text-slate-100 text-[11px] focus:outline-none focus:border-emerald-500"
              />
            </div>
            <div>
              <span className="text-[9px] uppercase text-slate-500 block">Stop (SL pts)</span>
              <input
                type="number"
                value={state.slPoints}
                onChange={(e) =>
                  onChangeRobotState(selectedAsset, { slPoints: parseFloat(e.target.value) || 0 })
                }
                className="w-full h-6 rounded bg-slate-950 border border-slate-700 text-center font-mono font-bold text-slate-100 text-[11px] focus:outline-none focus:border-emerald-500"
              />
            </div>
          </div>

          {/* Botões de Ordem Manual Rápida */}
          <div className="flex gap-2 pt-1">
            <button
              onClick={() => onManualOrder(selectedAsset, 'BUY')}
              className="flex-1 py-1 rounded bg-emerald-700/80 hover:bg-emerald-600 text-white font-bold text-[10px] cursor-pointer"
            >
              Comprar {selectedAsset}
            </button>
            <button
              onClick={() => onManualOrder(selectedAsset, 'SELL')}
              className="flex-1 py-1 rounded bg-rose-700/80 hover:bg-rose-600 text-white font-bold text-[10px] cursor-pointer"
            >
              Vender {selectedAsset}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

