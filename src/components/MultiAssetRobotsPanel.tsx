import React, { useState } from 'react';
import { Zap, Shield, Play, Power, AlertTriangle, ArrowUpCircle, ArrowDownCircle, Check, RefreshCw, Layers, ListOrdered, Trash2 } from 'lucide-react';
import { MULTI_ROBOTS, MultiRobotId, RobotExecutionMode, AssetSignalState, RobotRuntimeState, DEFAULT_VARAL_CONFIG, VaralItemConfig } from '../types/multiRobots';
import { PositionSummary } from './MultiAssetRobotsBar';

interface MultiAssetRobotsPanelProps {
  initialAssetId?: MultiRobotId;
  signals: Record<string, AssetSignalState>;
  positions: PositionSummary[];
  pendingOrders?: any[];
  varalConfig?: Record<string, any>;
  robotStates: Record<MultiRobotId, RobotRuntimeState>;
  dayStatsBySymbol?: Record<string, { netRealized: number; realizedProfit: number; realizedLoss: number; totalContractsToday: number }>;
  onChangeRobotState: (assetId: MultiRobotId, patch: Partial<RobotRuntimeState>) => void;
  onChangeVaralConfig?: (assetId: MultiRobotId, patch: Partial<VaralItemConfig>) => void;
  onClearVaral?: (assetId: MultiRobotId) => void;
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
  pendingOrders = [],
  varalConfig = DEFAULT_VARAL_CONFIG,
  robotStates,
  dayStatsBySymbol,
  onChangeRobotState,
  onChangeVaralConfig,
  onClearVaral,
  onExecuteSignal,
  onManualOrder,
  onClosePosition,
}) => {
  const [selectedAsset, setSelectedAsset] = useState<MultiRobotId>(initialAssetId);
  const [activeStrategyTab, setActiveStrategyTab] = useState<'MASTER' | 'VARAL'>('MASTER');

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

  const currentVaral: VaralItemConfig = (varalConfig && varalConfig[selectedAsset])
    ? { ...DEFAULT_VARAL_CONFIG[selectedAsset], ...varalConfig[selectedAsset] }
    : DEFAULT_VARAL_CONFIG[selectedAsset];

  const sig = signals[spec.symbol] || Object.values(signals).find((s) => s.assetKey === selectedAsset);
  
  // Posições do Robô Mestre (Magic 150x01)
  const masterPosList = positions.filter((p) => p.magic === spec.magic || (!p.magic && p.symbol.includes(selectedAsset)));
  // Posições do Varal (Magic 150x02)
  const varalPosList = positions.filter((p) => p.magic === currentVaral.magic);
  // Todas as posições deste ativo
  const allPosList = positions.filter((p) => p.magic === spec.magic || p.magic === currentVaral.magic || p.symbol.includes(selectedAsset));

  const totalProfit = allPosList.reduce((acc, p) => acc + p.profit, 0);
  const masterProfit = masterPosList.reduce((acc, p) => acc + p.profit, 0);
  const varalProfit = varalPosList.reduce((acc, p) => acc + p.profit, 0);

  // Ordens pendentes do Varal
  const varalPendingOrders = (pendingOrders || []).filter(
    (o) => o.magic === currentVaral.magic || (o.symbol && o.symbol.includes(selectedAsset) && o.comment && o.comment.includes('VARAL'))
  );

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
          const tabVaral = (varalConfig && varalConfig[id]) ? varalConfig[id] : DEFAULT_VARAL_CONFIG[id];
          const tabPos = positions.filter((p) => p.magic === tabSpec.magic || p.magic === tabVaral.magic || p.symbol.includes(id));
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

      {/* Sub-Abas: Estratégia 1 (Confluência Institucional) vs Estratégia 2 (Varal de Ordens Real) */}
      <div className="flex border-b border-slate-800/90 bg-slate-900/60 p-1 gap-1">
        <button
          onClick={() => setActiveStrategyTab('MASTER')}
          className={`flex-1 py-1 px-1.5 rounded text-[10px] font-bold flex items-center justify-center gap-1 transition-colors cursor-pointer ${
            activeStrategyTab === 'MASTER'
              ? 'bg-sky-600/90 text-white shadow-sm'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
          }`}
        >
          <Zap className="w-3 h-3 text-sky-300" />
          <span>Estratégia 1: Confluência MT5</span>
        </button>
        <button
          onClick={() => setActiveStrategyTab('VARAL')}
          className={`flex-1 py-1 px-1.5 rounded text-[10px] font-bold flex items-center justify-center gap-1 transition-colors cursor-pointer ${
            activeStrategyTab === 'VARAL'
              ? 'bg-purple-600/90 text-white shadow-sm'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
          }`}
        >
          <Layers className="w-3 h-3 text-purple-300" />
          <span>Estratégia 2: Varal MT5</span>
          {currentVaral.enabled && (
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse ml-0.5" />
          )}
        </button>
      </div>

      <div className="p-3 space-y-3">
        {/* Identificação e Magic */}
        <div className="flex items-center justify-between pb-2 border-b border-slate-800/80">
          <div>
            <h4 className="font-bold text-slate-100 text-[12px]">{spec.label}</h4>
            <span className="text-[9.5px] text-slate-400 font-mono">
              Símbolo: {spec.symbol} · Magic {activeStrategyTab === 'MASTER' ? `Mestre: ${spec.magic}` : `Varal: ${currentVaral.magic}`}
            </span>
          </div>
          <div className="text-right">
            <span className="text-[9px] text-slate-400 block">Renko Nativo</span>
            <span className="text-[11px] font-bold text-emerald-400 font-mono">
              {spec.scaleLabel} ({spec.boxPoints} pts)
            </span>
          </div>
        </div>

        {/* ============================================================== */}
        {/* CONTEÚDO DA ESTRATÉGIA 1: CONFLUÊNCIA INSTITUCIONAL (MESTRE)   */}
        {/* ============================================================== */}
        {activeStrategyTab === 'MASTER' && (
          <>
            {/* Seletor de Modo Operacional */}
            <div>
              <label className="text-[9.5px] font-bold uppercase tracking-wider text-slate-400 block mb-1">
                Modo Operacional (Robô Mestre)
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

            {/* Posições Abertas e PnL do Dia no MT5 (Robô Mestre) */}
            <div className="bg-slate-950/70 border border-slate-800 rounded p-2.5">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[9.5px] font-bold uppercase text-slate-400">Posições Robô Mestre (MT5)</span>
                <span
                  className={`font-mono font-bold text-[11px] ${
                    masterProfit >= 0 ? 'text-emerald-400' : 'text-rose-400'
                  }`}
                >
                  {masterProfit >= 0 ? '+' : ''}
                  {fmtBRL(masterProfit)}
                </span>
              </div>

              {masterPosList.length > 0 ? (
                <div className="space-y-1.5">
                  {masterPosList.map((pos) => (
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
                    Zerar Mestre em {selectedAsset}
                  </button>
                </div>
              ) : (
                <span className="text-slate-500 text-[10px] block text-center py-1">
                  Nenhuma posição aberta no Robô Mestre.
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
          </>
        )}

        {/* ============================================================== */}
        {/* CONTEÚDO DA ESTRATÉGIA 2: VARAL DE ORDENS (SOMBRA REAL NO MT5) */}
        {/* ============================================================== */}
        {activeStrategyTab === 'VARAL' && (
          <div className="space-y-3">
            {/* Header da Estratégia 2 */}
            <div className="bg-purple-950/40 border border-purple-800/60 rounded p-2.5">
              <div className="flex items-center justify-between">
                <div>
                  <span className="font-bold text-purple-300 text-[11px] block">
                    🧺 Robô 2: Varal de Ordens (Real MT5)
                  </span>
                  <span className="text-[9px] text-purple-400/80">
                    Magic: {currentVaral.magic} · Independente do robô mestre
                  </span>
                </div>
                {/* Switch Ligar / Desligar Varal */}
                <button
                  onClick={() => onChangeVaralConfig?.(selectedAsset, { enabled: !currentVaral.enabled })}
                  className={`px-2.5 py-1 rounded font-bold text-[10px] flex items-center gap-1 transition-colors cursor-pointer ${
                    currentVaral.enabled
                      ? 'bg-emerald-600 hover:bg-emerald-500 text-white'
                      : 'bg-slate-800 hover:bg-slate-700 text-slate-400'
                  }`}
                >
                  <Power className="w-3 h-3" />
                  <span>{currentVaral.enabled ? 'ATIVO' : 'PAUSADO'}</span>
                </button>
              </div>
              <p className="text-[9px] text-slate-400 mt-1.5 leading-snug">
                Ao fechar box de alta ('C'), pendura ordens de compra para frente. Ao fechar box de baixa ('V'), pendura ordens de venda para baixo.
              </p>
            </div>

            {/* Parâmetros Editáveis do Varal */}
            <div className="space-y-2.5 bg-slate-950/70 border border-slate-800 rounded p-2.5">
              <span className="text-[9.5px] font-bold uppercase text-slate-400 block">
                Configuração dos Degraus
              </span>

              {/* Seletor Tipo de Entrada no Fechamento do Bloco: A MERCADO vs ORDEM LIMITE */}
              <div className="bg-slate-900/90 border border-slate-800/80 rounded p-2">
                <label className="text-[9px] uppercase text-slate-300 block font-bold mb-1.5 flex items-center justify-between">
                  <span>Execução no Fechamento do Bloco</span>
                  <span className={`text-[8.5px] font-mono px-1 rounded ${
                    (currentVaral.execution_type || 'MARKET') === 'MARKET' ? 'bg-emerald-950 text-emerald-400' : 'bg-purple-950 text-purple-400'
                  }`}>
                    {(currentVaral.execution_type || 'MARKET') === 'MARKET' ? 'A MERCADO' : 'LIMITE'}
                  </span>
                </label>
                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    onClick={() => onChangeVaralConfig?.(selectedAsset, { execution_type: 'MARKET' })}
                    className={`py-1.5 px-2 rounded border text-[10px] font-bold cursor-pointer transition-colors flex items-center justify-center gap-1.5 ${
                      (currentVaral.execution_type || 'MARKET') === 'MARKET'
                        ? 'bg-emerald-600 border-emerald-400 text-white shadow-sm'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:bg-slate-800'
                    }`}
                  >
                    <Zap className="w-3.5 h-3.5" />
                    <span>A Mercado</span>
                  </button>
                  <button
                    onClick={() => onChangeVaralConfig?.(selectedAsset, { execution_type: 'LIMIT' })}
                    className={`py-1.5 px-2 rounded border text-[10px] font-bold cursor-pointer transition-colors flex items-center justify-center gap-1.5 ${
                      currentVaral.execution_type === 'LIMIT'
                        ? 'bg-purple-600 border-purple-400 text-white shadow-sm'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:bg-slate-800'
                    }`}
                  >
                    <ListOrdered className="w-3.5 h-3.5" />
                    <span>Ordem Limite</span>
                  </button>
                </div>
                <p className="text-[8.5px] text-slate-400 mt-1.5 leading-tight">
                  {(currentVaral.execution_type || 'MARKET') === 'MARKET'
                    ? '⚡ Abre posição a mercado no fechamento do box (C ou V) imediatamente — nenhuma ordem fica de fora.'
                    : '⏳ Pendura ordem no book à frente da cotação atual (conforme a distância do degrau).'}
                </p>
              </div>

              {/* Seletor Rápido de Degraus / Quantidade de Ordens (3, 4, 5 ordens) */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[9px] text-slate-400">Capacidade do Varal:</span>
                  <span className="text-[10px] font-bold text-purple-300 font-mono">
                    {currentVaral.max_orders} ordens à frente
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-1">
                  {[3, 4, 5].map((n) => (
                    <button
                      key={n}
                      onClick={() => onChangeVaralConfig?.(selectedAsset, { max_orders: n })}
                      className={`py-1 rounded border text-[10px] font-bold cursor-pointer transition-colors text-center ${
                        currentVaral.max_orders === n
                          ? 'bg-purple-600 border-purple-400 text-white shadow-sm'
                          : 'bg-slate-900 border-slate-800 text-slate-400 hover:bg-slate-800'
                      }`}
                    >
                      {n} Ordens
                    </button>
                  ))}
                </div>
              </div>

              {/* Grid de Inputs: TP (editável), Passo do Degrau (pts), SL (pts) e Contratos */}
              <div className="grid grid-cols-2 gap-2 pt-1 border-t border-slate-800/60">
                <div>
                  <span className="text-[9px] uppercase text-slate-400 block font-semibold">
                    🎯 Alvo (TP pts)
                  </span>
                  <input
                    type="number"
                    step={spec.tickSize}
                    value={currentVaral.tp_points}
                    onChange={(e) =>
                      onChangeVaralConfig?.(selectedAsset, { tp_points: Math.max(0, parseFloat(e.target.value) || 0) })
                    }
                    className="w-full h-6 rounded bg-slate-900 border border-slate-700 text-center font-mono font-bold text-emerald-400 text-[11px] focus:outline-none focus:border-purple-500"
                  />
                  <span className="text-[8px] text-slate-500 block text-center">Gain por ordem</span>
                </div>

                <div>
                  <span className="text-[9px] uppercase text-slate-400 block font-semibold">
                    📏 Degrau (Passo pts)
                  </span>
                  <input
                    type="number"
                    step={spec.tickSize}
                    value={currentVaral.step_points}
                    onChange={(e) =>
                      onChangeVaralConfig?.(selectedAsset, { step_points: Math.max(spec.tickSize, parseFloat(e.target.value) || spec.tickSize) })
                    }
                    className="w-full h-6 rounded bg-slate-900 border border-slate-700 text-center font-mono font-bold text-slate-100 text-[11px] focus:outline-none focus:border-purple-500"
                  />
                  <span className="text-[8px] text-slate-500 block text-center">Distância à frente</span>
                </div>

                <div>
                  <span className="text-[9px] uppercase text-slate-400 block font-semibold">
                    🛑 Stop Loss (SL pts)
                  </span>
                  <input
                    type="number"
                    step={spec.tickSize}
                    value={currentVaral.sl_points}
                    onChange={(e) =>
                      onChangeVaralConfig?.(selectedAsset, { sl_points: Math.max(0, parseFloat(e.target.value) || 0) })
                    }
                    className="w-full h-6 rounded bg-slate-900 border border-slate-700 text-center font-mono font-bold text-rose-400 text-[11px] focus:outline-none focus:border-purple-500"
                  />
                  <span className="text-[8px] text-slate-500 block text-center">0 = Sem SL</span>
                </div>

                <div>
                  <span className="text-[9px] uppercase text-slate-400 block font-semibold">
                    📦 Contratos / Ordem
                  </span>
                  <input
                    type="number"
                    min={1}
                    max={50}
                    value={currentVaral.contracts}
                    onChange={(e) =>
                      onChangeVaralConfig?.(selectedAsset, { contracts: Math.max(1, parseInt(e.target.value) || 1) })
                    }
                    className="w-full h-6 rounded bg-slate-900 border border-slate-700 text-center font-mono font-bold text-slate-100 text-[11px] focus:outline-none focus:border-purple-500"
                  />
                  <span className="text-[8px] text-slate-500 block text-center">Lote por degrau</span>
                </div>
              </div>
            </div>

            {/* Monitor de Ordens Pendentes e Posições do Varal no MT5 */}
            <div className="bg-slate-950/70 border border-slate-800 rounded p-2.5 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[9.5px] font-bold uppercase text-slate-400 flex items-center gap-1">
                  <ListOrdered className="w-3.5 h-3.5 text-purple-400" />
                  <span>Ordens no MT5 (#{currentVaral.magic})</span>
                </span>
                <span className="font-mono text-[9px] text-purple-300">
                  {varalPendingOrders.length} pendente(s) · {varalPosList.length} ativa(s)
                </span>
              </div>

              {/* Lista de Ordens Pendentes */}
              {varalPendingOrders.length > 0 ? (
                <div className="space-y-1 max-h-32 overflow-y-auto pr-1">
                  {varalPendingOrders.map((ord: any) => (
                    <div
                      key={ord.ticket}
                      className="flex items-center justify-between text-[9.5px] bg-slate-900/90 px-2 py-1 rounded border border-slate-800 font-mono"
                    >
                      <span className={ord.type.includes('BUY') ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold'}>
                        {ord.type} {ord.volume}ct
                      </span>
                      <span className="text-slate-300">@ {ord.price}</span>
                      <span className="text-slate-500">TP {ord.tp}</span>
                      <span className="text-[8.5px] text-slate-600">#{ord.ticket}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-1.5 text-slate-500 text-[9.5px]">
                  {currentVaral.enabled
                    ? 'Aguardando fechamento do próximo box (C ou V) para pendurar ordens...'
                    : 'Varal pausado no momento.'}
                </div>
              )}

              {/* Posições Ativas do Varal com PnL */}
              {varalPosList.length > 0 && (
                <div className="pt-1.5 border-t border-slate-800/80">
                  <div className="flex items-center justify-between text-[9.5px] mb-1">
                    <span className="text-slate-400 font-semibold">Executadas (Posições Varal):</span>
                    <span className={`font-mono font-bold ${varalProfit >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {varalProfit >= 0 ? '+' : ''}{fmtBRL(varalProfit)}
                    </span>
                  </div>
                  {varalPosList.map((p) => (
                    <div
                      key={p.symbol + p.openPrice}
                      className="flex items-center justify-between text-[9px] bg-purple-950/30 px-1.5 py-0.5 rounded border border-purple-900/40 font-mono"
                    >
                      <span className={p.type === 'BUY' ? 'text-emerald-400' : 'text-rose-400'}>
                        {p.type} {p.volume}ct @ {p.openPrice}
                      </span>
                      <span className={p.profit >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                        {fmtBRL(p.profit)}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {/* Botão Limpar Varal */}
              {(varalPendingOrders.length > 0 || varalPosList.length > 0) && (
                <button
                  onClick={() => onClearVaral?.(selectedAsset)}
                  className="w-full py-1 rounded bg-rose-950/80 hover:bg-rose-900 border border-rose-800/80 text-rose-300 font-bold text-[10px] flex items-center justify-center gap-1 transition-colors cursor-pointer"
                >
                  <Trash2 className="w-3 h-3" />
                  <span>Limpar Varal (Cancelar Pendentes & Zerar)</span>
                </button>
              )}
            </div>
          </div>
        )}

        {/* PnL Diário Consolidado do Ativo */}
        <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between text-[10px]">
          <span className="text-slate-400">Total Consolidado {selectedAsset}:</span>
          <span
            className={`font-mono font-bold text-[11px] ${
              totalDayPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'
            }`}
          >
            {totalDayPnl >= 0 ? '+' : ''}
            {fmtBRL(totalDayPnl)}
          </span>
        </div>
      </div>
    </div>
  );
};
