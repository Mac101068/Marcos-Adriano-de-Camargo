import React from 'react';
import { Zap, ChevronRight, CheckCircle2, ShieldAlert } from 'lucide-react';
import { MULTI_ROBOTS, MultiRobotId, AssetSignalState, RobotRuntimeState } from '../types/multiRobots';

export interface PositionSummary {
  symbol: string;
  magic: number;
  type: 'BUY' | 'SELL';
  volume: number;
  profit: number;
  openPrice: number;
}

interface MultiAssetRobotsBarProps {
  signals: Record<string, AssetSignalState>;
  positions: PositionSummary[];
  robotStates: Record<MultiRobotId, RobotRuntimeState>;
  dayStatsBySymbol?: Record<string, { netRealized: number; realizedProfit: number; realizedLoss: number; totalContractsToday: number }>;
  onExecuteSignal: (assetId: MultiRobotId, signal: 'BUY' | 'SELL') => void;
  onOpenRobotWindow: (assetId: MultiRobotId) => void;
}

const fmtBRL = (v: number) =>
  `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const MultiAssetRobotsBar: React.FC<MultiAssetRobotsBarProps> = ({
  signals,
  positions,
  robotStates,
  dayStatsBySymbol,
  onExecuteSignal,
  onOpenRobotWindow,
}) => {
  const assetIds: MultiRobotId[] = ['WIN', 'WDO', 'BIT'];

  return (
    <div className="flex items-center gap-1.5 shrink-0 overflow-x-auto no-scrollbar">
      {assetIds.map((id) => {
        const spec = MULTI_ROBOTS[id];
        const state = robotStates[id] || { mode: 'COPILOT', contracts: spec.defaultContracts };
        const sig = signals[spec.symbol] || Object.values(signals).find((s) => s.assetKey === id);
        
        // Posição correspondente a este robô pelo magic number ou símbolo
        const posList = positions.filter((p) => p.magic === spec.magic || p.symbol.includes(id));
        const totalProfit = posList.reduce((acc, p) => acc + p.profit, 0);
        const hasPosition = posList.length > 0;
        const posType = hasPosition ? posList[0].type : null;

        // PnL diário consolidado do robô (Fechado + Flutuante Aberto)
        const stat = dayStatsBySymbol ? dayStatsBySymbol[id] : undefined;
        const netRealized = stat ? stat.netRealized : 0;
        const dayPnl = netRealized + totalProfit;
        const hasHistoryOrPos = (stat && stat.totalContractsToday > 0) || hasPosition;

        // Sinal aguardando operador no modo Copiloto (disponível para novas entradas, pirâmide ou reversão)
        const hasPendingSignal = Boolean(sig && sig.signal && state.mode === 'COPILOT');

        const modeBadgeColor =
          state.mode === 'AUTO'
            ? 'bg-emerald-950/80 text-emerald-400 border-emerald-800/60'
            : state.mode === 'COPILOT'
            ? 'bg-sky-950/80 text-sky-400 border-sky-800/60'
            : state.mode === 'SHADOW'
            ? 'bg-purple-950/80 text-purple-400 border-purple-800/60'
            : 'bg-slate-900 text-slate-500 border-slate-800';

        return (
          <div
            key={id}
            className="flex items-center gap-1 bg-slate-950/90 border border-slate-800/90 hover:border-slate-700/80 rounded px-1.5 h-[22px] text-[10px] transition-colors shrink-0"
          >
            {/* LED Status */}
            <span
              className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                hasPosition
                  ? posType === 'BUY'
                    ? 'bg-emerald-400 animate-pulse'
                    : 'bg-rose-400 animate-pulse'
                  : hasPendingSignal
                  ? 'bg-amber-400 animate-ping'
                  : 'bg-slate-600'
              }`}
            />

            {/* Nome do Ativo & Botão para abrir detalhes */}
            <button
              onClick={() => onOpenRobotWindow(id)}
              className="flex items-center gap-1 font-bold text-slate-200 hover:text-white cursor-pointer"
              title={`Clique para configurar o Robô do ${spec.label} (${spec.scaleLabel})`}
            >
              <span>{id}</span>
              <span className={`text-[8.5px] px-1 py-0.2 rounded border font-mono uppercase ${modeBadgeColor}`}>
                {state.mode === 'COPILOT' ? 'COP' : state.mode === 'AUTO' ? 'AUT' : state.mode === 'SHADOW' ? 'SOM' : 'OFF'}
              </span>
            </button>

            {/* PnL do Dia do Robô (Consolidado: Fechado + Aberto) */}
            {hasHistoryOrPos && (
              <span
                className={`font-mono font-semibold tabular-nums ml-0.5 ${
                  dayPnl > 0 ? 'text-emerald-400' : dayPnl < 0 ? 'text-rose-400' : 'text-slate-400'
                }`}
                title={`Robô ${id} - PnL do Dia: ${fmtBRL(dayPnl)} (Realizado: ${fmtBRL(netRealized)} | Flutuante: ${fmtBRL(totalProfit)})${hasPosition ? ` | Posição aberta: ${posType} ${posList[0].volume}ct` : ''}`}
              >
                {dayPnl > 0 ? '+' : ''}
                {fmtBRL(dayPnl)}
              </span>
            )}

            {/* Gatilho Rápido do Copiloto (quando sinal gerado pelo EA) */}
            {hasPendingSignal && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onExecuteSignal(id, sig.signal!);
                }}
                className={`flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9.5px] font-bold text-white shadow-sm cursor-pointer transition-transform active:scale-95 animate-pulse ${
                  sig.signal === 'BUY'
                    ? 'bg-emerald-600 hover:bg-emerald-500'
                    : 'bg-rose-600 hover:bg-rose-500'
                }`}
                title={`Executar sinal ${sig.signal} do Copiloto no ${spec.label} (${sig.reason})`}
              >
                <Zap className="w-2.5 h-2.5 fill-current" />
                <span>{sig.signal}</span>
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
};

