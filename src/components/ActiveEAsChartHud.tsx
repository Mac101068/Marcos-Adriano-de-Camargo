import React, { useState } from 'react';
import { Bot, ChevronDown, ChevronUp, Play, Pause, ExternalLink, ShieldCheck, Activity } from 'lucide-react';
import {
  STRATEGY_EA_CATALOG,
  DirectionalMagic,
  DirectionalRobotSnapshot,
} from '../services/directionalRobotService';

const STORAGE_KEY_HUD_OPEN = 'fluxo_chart_active_eas_hud_open_v1';

interface ActiveEAsChartHudProps {
  allStrategySnapshots: Record<DirectionalMagic, DirectionalRobotSnapshot>;
  onToggleRobot: (magic: DirectionalMagic) => void;
  onOpenEAsTab: () => void;
  mainRobotActive?: boolean;
  mainStrategyName?: string | null;
  mainRobotMagic?: number;
}

export const ActiveEAsChartHud: React.FC<ActiveEAsChartHudProps> = ({
  allStrategySnapshots,
  onToggleRobot,
  onOpenEAsTab,
  mainRobotActive,
  mainStrategyName,
  mainRobotMagic,
}) => {
  const [isOpen, setIsOpen] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_HUD_OPEN);
      return saved === null ? true : saved === '1';
    } catch {
      return true;
    }
  });

  const toggleOpen = () => {
    setIsOpen((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_KEY_HUD_OPEN, next ? '1' : '0');
      } catch {}
      return next;
    });
  };

  // Monta a lista de todos os 14 EAs (7 Compra + 7 Venda) e filtra os ativos ou com posição aberta
  const eaEntries = STRATEGY_EA_CATALOG.flatMap((strat) => {
    const buySnap = allStrategySnapshots[strat.buyMagic];
    const sellSnap = allStrategySnapshots[strat.sellMagic];
    const list: {
      strategyId: string;
      strategyShort: string;
      badgeText: string;
      side: 'BUY' | 'SELL';
      magic: DirectionalMagic;
      snap: DirectionalRobotSnapshot;
    }[] = [];

    if (buySnap) {
      list.push({
        strategyId: strat.id,
        strategyShort: strat.shortName,
        badgeText: strat.badge,
        side: 'BUY',
        magic: strat.buyMagic,
        snap: buySnap,
      });
    }
    if (sellSnap) {
      list.push({
        strategyId: strat.id,
        strategyShort: strat.shortName,
        badgeText: strat.badge,
        side: 'SELL',
        magic: strat.sellMagic,
        snap: sellSnap,
      });
    }
    return list;
  });

  const activeEAs = eaEntries.filter((e) => !e.snap.paused);
  const pausedWithOpenPos = eaEntries.filter((e) => e.snap.paused && e.snap.openPositions.length > 0);
  const visibleEAs = [...activeEAs, ...pausedWithOpenPos];

  const totalBuyOpen = eaEntries
    .filter((e) => e.side === 'BUY')
    .reduce((acc, e) => acc + e.snap.openPositions.length, 0);
  const totalSellOpen = eaEntries
    .filter((e) => e.side === 'SELL')
    .reduce((acc, e) => acc + e.snap.openPositions.length, 0);

  const anyActive = activeEAs.length > 0 || Boolean(mainRobotActive);

  return (
    <div className="absolute top-9 left-[44px] z-30 select-none pointer-events-auto max-w-[310px] sm:max-w-[340px]">
      {/* Barra/Cabeçalho Recolhível */}
      <div
        className={`flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg border backdrop-blur-md shadow-xl transition-all ${
          anyActive
            ? 'bg-slate-950/92 border-emerald-500/40 text-slate-100'
            : 'bg-slate-950/88 border-slate-800/90 text-slate-300'
        }`}
      >
        <button
          type="button"
          onClick={toggleOpen}
          className="flex items-center gap-2 text-left cursor-pointer flex-1 min-w-0"
          title={isOpen ? 'Recolher janela de EAs ativos no gráfico' : 'Expandir janela de EAs ativos no gráfico'}
        >
          <span
            className={`w-2 h-2 rounded-full shrink-0 ${
              anyActive ? 'bg-emerald-400 shadow-[0_0_8px_#34d399] animate-pulse' : 'bg-slate-600'
            }`}
          />
          <Bot className={`w-3.5 h-3.5 shrink-0 ${anyActive ? 'text-indigo-400' : 'text-slate-500'}`} />
          <span className="text-[11px] font-bold tracking-tight truncate">
            EAs no Gráfico
          </span>

          {/* Contador de EAs ativos */}
          <span
            className={`text-[9.5px] font-mono font-bold px-1.5 py-0.5 rounded border shrink-0 ${
              activeEAs.length > 0
                ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                : 'bg-slate-900 text-slate-400 border-slate-800'
            }`}
          >
            {activeEAs.length} {activeEAs.length === 1 ? 'ATIVO' : 'ATIVOS'}
          </span>

          {/* Contador de posições abertas se houver */}
          {(totalBuyOpen > 0 || totalSellOpen > 0) && (
            <span className="text-[9.5px] font-mono font-bold px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 shrink-0">
              {totalBuyOpen}C/{totalSellOpen}V
            </span>
          )}
        </button>

        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={onOpenEAsTab}
            title="Abrir aba Hedge EAs para configurar todas as estratégias"
            className="p-1 rounded text-indigo-400 hover:text-indigo-200 hover:bg-indigo-950/60 transition-colors cursor-pointer"
          >
            <ExternalLink className="w-3 h-3" />
          </button>
          <button
            type="button"
            onClick={toggleOpen}
            title={isOpen ? 'Recolher painel' : 'Expandir painel'}
            className="p-1 rounded text-slate-400 hover:text-slate-100 hover:bg-slate-800/80 transition-colors cursor-pointer"
          >
            {isOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* Corpo Expandido */}
      {isOpen && (
        <div className="mt-1 rounded-lg bg-slate-950/94 backdrop-blur-md border border-slate-800/90 p-2.5 shadow-2xl space-y-2 max-h-[340px] overflow-y-auto">
          {/* ESCOPO 1 — robô principal do terminal: aparece SEMPRE, ligado ou não, porque é ele
              que a caixa “Principal #magic” do gráfico troca. Antes só existia com o robô ligado e
              sumia quando pausado, dando a impressão de que os EAs eram tudo que havia. */}
          <div
            className={`flex items-center justify-between gap-2 px-2 py-1.5 rounded-md border text-[10px] ${
              mainRobotActive
                ? 'bg-emerald-950/30 border-emerald-500/30'
                : 'bg-slate-900/70 border-slate-700/70'
            }`}
            title="Robô principal do terminal (não é um EA). A estratégia dele é trocada no gráfico, na caixa “Principal”"
          >
            <div className="flex items-center gap-1.5 min-w-0">
              <Activity
                className={`w-3 h-3 shrink-0 ${mainRobotActive ? 'text-emerald-400' : 'text-slate-500'}`}
              />
              <span className="truncate">
                <span className="font-bold text-slate-200">Principal #{mainRobotMagic ?? 102030}</span>
                <span className="text-slate-400"> · {mainStrategyName || 'sem estratégia'}</span>
              </span>
            </div>
            <span
              className={`text-[9px] font-mono font-bold px-1.5 py-0.5 rounded shrink-0 ${
                mainRobotActive
                  ? 'bg-emerald-500/20 text-emerald-300'
                  : 'bg-slate-800 text-slate-400 border border-slate-700'
              }`}
            >
              {mainRobotActive ? 'ON' : 'PAUSADO'}
            </span>
          </div>

          {/* ESCOPO 2 — os EAs direcionais, que são o que a aba EAs controla. */}
          <div className="flex items-center justify-between px-0.5">
            <span className="text-[9px] font-bold uppercase tracking-wider text-slate-500">
              EAs direcionais · 100001 / 100002
            </span>
          </div>

          {/* Lista de EAs Direcionais Ativos (ou gerenciando posição aberta) */}
          {visibleEAs.length === 0 ? (
            <div className="py-2.5 px-2 text-center space-y-1.5">
              <p className="text-[10px] text-slate-400 font-medium">
                Nenhum EA Direcional ativo neste momento.
              </p>
              <button
                type="button"
                onClick={onOpenEAsTab}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-bold bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/30 transition-colors cursor-pointer"
              >
                <Bot className="w-3 h-3" />
                Ativar Estratégias em Hedge EAs
              </button>
            </div>
          ) : (
            <div className="space-y-1.5">
              {visibleEAs.map(({ strategyShort, side, magic, snap }) => {
                const isBuy = side === 'BUY';
                const isPaused = snap.paused;
                const cfg = snap.customConfig;
                const openCount = snap.openPositions.length;

                return (
                  <div
                    key={magic}
                    className={`p-2 rounded-md border transition-all ${
                      isPaused
                        ? 'bg-slate-900/70 border-amber-500/30'
                        : isBuy
                        ? 'bg-emerald-950/25 border-emerald-500/35'
                        : 'bg-rose-950/25 border-rose-500/35'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1.5">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span
                          className={`text-[9px] font-mono font-bold px-1.5 py-0.5 rounded shrink-0 ${
                            isBuy
                              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                              : 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                          }`}
                        >
                          {isBuy ? 'COMPRA' : 'VENDA'}
                        </span>
                        <span className="text-[11px] font-bold text-slate-100 truncate">
                          {strategyShort}
                        </span>
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        <span
                          className={`text-[8.5px] font-mono font-bold px-1 py-0.5 rounded border ${
                            snap.executionMode === 'LIVE'
                              ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                              : 'bg-slate-800 text-slate-400 border-slate-700'
                          }`}
                          title={
                            snap.executionMode === 'LIVE'
                              ? 'Enviando ordens reais via ponte MT5'
                              : 'Operando em modo Simulação'
                          }
                        >
                          {snap.executionMode === 'LIVE' ? 'MT5' : 'SIM'}
                        </span>

                        <button
                          type="button"
                          onClick={() => onToggleRobot(magic)}
                          title={isPaused ? `Ativar EA #${magic}` : `Pausar EA #${magic}`}
                          className={`px-1.5 py-0.5 rounded text-[9px] font-bold flex items-center gap-0.5 border cursor-pointer transition-colors ${
                            isPaused
                              ? 'bg-slate-800 hover:bg-slate-700 text-amber-300 border-amber-500/40'
                              : isBuy
                              ? 'bg-emerald-600/30 hover:bg-emerald-600/50 text-emerald-200 border-emerald-500/40'
                              : 'bg-rose-600/30 hover:bg-rose-600/50 text-rose-200 border-rose-500/40'
                          }`}
                        >
                          {isPaused ? (
                            <>
                              <Play className="w-2.5 h-2.5" />
                              <span>PAUSADO</span>
                            </>
                          ) : (
                            <>
                              <Pause className="w-2.5 h-2.5" />
                              <span>ATIVO</span>
                            </>
                          )}
                        </button>
                      </div>
                    </div>

                    {/* Linha 2: Magic + Parâmetros + Posições abertas */}
                    <div className="mt-1 flex items-center justify-between gap-2 text-[9.5px] font-mono text-slate-400">
                      <span>
                        #{magic} · TP {cfg.takeProfitPoints}p · SL {cfg.stopLossPoints}p · {cfg.contracts}ct
                      </span>
                      <span
                        className={`font-bold ${
                          openCount > 0
                            ? isBuy
                              ? 'text-emerald-300'
                              : 'text-rose-300'
                            : 'text-slate-500'
                        }`}
                      >
                        {openCount > 0 ? `${openCount}/${cfg.maxOpenPositions} pos` : '0 pos'}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Rodapé de confirmação rápida */}
          <div className="pt-1.5 border-t border-slate-800/80 flex items-center justify-between text-[9.5px] text-slate-500">
            <span className="flex items-center gap-1">
              <ShieldCheck className="w-3 h-3 text-emerald-400/80" />
              <span>Confirmação em tempo real</span>
            </span>
            <button
              type="button"
              onClick={onOpenEAsTab}
              className="text-indigo-400 hover:text-indigo-300 font-semibold cursor-pointer"
            >
              Gerenciar EAs →
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

