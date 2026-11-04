import React, { useSyncExternalStore } from 'react';
import {
  Activity,
  Cpu,
  Play,
  Pause,
  StepForward,
  Zap,
  ArrowUpRight,
  ArrowDownRight,
  History,
  BookOpen,
  Bot,
  Database,
  Radio,
  ClipboardList,
  Download,
  Trash2,
} from 'lucide-react';
import { AutomationConfig, MT5ConnectionState } from '../types/trading';
import { ChartSeries } from '../utils/barEngines';
import { SeriesKey } from '../utils/paperStrategyBot';
import { seriesCollectorService, SERIES_LABEL } from '../services/seriesCollectorService';
import { roundAuditService, ROUND_SOURCE_LABEL, type RoundRecord, type RoundAction } from '../services/roundAuditService';
import { CollapsibleSection } from './CollapsibleSection';
import { sessionCloseLockLabel } from '../utils/sessionRules';
import { ASSETS, AssetSpec, DEFAULT_ASSET_ID, formatPrice, renkoScaleLabel } from '../assets/assetRegistry';

/**
 * Aba SIMULADOR — Raio-X do sistema (pensada para quem está aprendendo).
 * Mostra em linguagem simples: o que gera os ticks, qual motor está ativo,
 * quantas barras cada série já fechou, o caminho do tick até a ordem,
 * e controles diretos (velocidade, pausar, 1 tick, agressão, replay).
 */

interface SimulatorViewProps {
  isSimulating: boolean;
  setIsSimulating: (v: boolean) => void;
  simulationSpeed: number;
  setSimulationSpeed: (v: number) => void;
  robotActive: boolean;
  onToggleRobot: () => void;
  currentPrice: number;
  mt5Status: MT5ConnectionState['status'];
  chartSeries: ChartSeries;
  rangePoints: number;
  timeframeSec: number;
  config: AutomationConfig;
  boxCounts: Record<SeriesKey, number>;
  tickBufferCount: number;
  ordersOpen: number;
  ordersClosed: number;
  onStepTick: () => void;
  onInjectAggression: (side: 'BUY' | 'SELL') => void;
  onReplayHistory: (days: number) => void;
  isReplaying: boolean;
  /** Ativo do simulador: horário de pregão, variação mínima e escala do Renko saem do spec. */
  asset?: AssetSpec;
  onRunRealBacktest?: (date: string, renkoR: number) => void;
  isBacktestingReal?: boolean;
  realBacktestResult?: any;
}

const seriesAccent: Record<SeriesKey, string> = {
  renko: '#10b981',
  range: '#38bdf8',
  tempo: '#f59e0b',
  renko15r: '#a78bfa',
  renko20r: '#f472b6',
  renko25r: '#fb923c',
};

const StatChip: React.FC<{ label: string; value: string; color?: string }> = ({ label, value, color }) => (
  <div className="flex flex-col rounded-md border border-slate-800 bg-slate-900/60 px-2.5 py-1.5 min-w-[92px]">
    <span className="text-[9px] uppercase tracking-wider text-slate-500">{label}</span>
    <span className={`text-sm font-bold tabular-nums ${color ?? 'text-slate-100'}`}>{value}</span>
  </div>
);

const EngineCard: React.FC<{
  k: SeriesKey;
  scale: string;
  role: string;
  boxes: number;
  activeSeries: boolean;
  feedsRealOrders: boolean;
}> = ({ k, scale, role, boxes, activeSeries, feedsRealOrders }) => (
  <div
    className={`rounded-lg border px-3 py-2.5 flex flex-col gap-1 ${
      activeSeries ? 'bg-slate-800/60' : 'bg-slate-900/40'
    }`}
    style={{ borderColor: activeSeries ? `${seriesAccent[k]}` : `${seriesAccent[k]}44` }}
  >
    <div className="flex items-center gap-2">
      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: seriesAccent[k] }} />
      <span className="text-xs sm:text-[13px] font-bold text-slate-100">{SERIES_LABEL[k]}</span>
      <span className="ml-auto font-mono text-[11px] text-slate-400">{scale}</span>
    </div>
    <span className="text-[10px] text-slate-500 leading-snug">{role}</span>
    <div className="flex items-center justify-between mt-0.5">
      <span className="text-[11px] text-slate-400">
        Barras fechadas: <b className="text-slate-100 tabular-nums">{boxes.toLocaleString('pt-BR')}</b>
      </span>
      {feedsRealOrders ? (
        <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
          Ordens reais aqui
        </span>
      ) : (
        <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-slate-800 text-slate-500 border border-slate-700">
          Só medição
        </span>
      )}
    </div>
  </div>
);

const PipelineStep: React.FC<{ n: number; title: string; desc: string; value: string; icon: React.ReactNode }> = ({
  n,
  title,
  desc,
  value,
  icon,
}) => (
  <div className="flex items-start gap-3 rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2.5">
    <div className="flex flex-col items-center gap-1 shrink-0">
      <div className="w-7 h-7 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-slate-300">
        {icon}
      </div>
      <span className="text-[9px] font-mono text-slate-600">ETAPA {n}</span>
    </div>
    <div className="flex-1 min-w-0">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-bold text-slate-100">{title}</span>
        <span className="text-[11px] font-mono text-emerald-300 tabular-nums shrink-0">{value}</span>
      </div>
      <p className="text-[10px] sm:text-[11px] text-slate-500 leading-snug mt-0.5">{desc}</p>
    </div>
  </div>
);

const GlossaryItem: React.FC<{ term: string; children: React.ReactNode }> = ({ term, children }) => (
  <details className="group rounded-md border border-slate-800 bg-slate-900/40 px-3 py-2">
    <summary className="text-[11px] sm:text-xs font-semibold text-slate-200 cursor-pointer list-none flex items-center justify-between">
      {term}
      <span className="text-slate-600 group-open:rotate-90 transition-transform text-xs">▸</span>
    </summary>
    <p className="text-[11px] text-slate-400 leading-relaxed mt-1.5">{children}</p>
  </details>
);

// ==============================================================================================
// RODADAS — auditoria por corrida de replay (ledger persistente do roundAuditService).
// ==============================================================================================

const money = (v: number) => `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pnlClass = (v: number) => (v > 0 ? 'text-emerald-400' : v < 0 ? 'text-rose-400' : 'text-slate-400');
const volumeTag = (v?: string) =>
  v === 'TICK' ? 'volume do tick' : v === 'M1_RATE' ? 'volume M1' : v === 'NONE' ? 'SEM volume' : undefined;

/** Uma linha da timeline: cada ação que uma automação produziu naquela rodada. */
const ActionRow: React.FC<{ a: RoundAction }> = ({ a }) => {
  const seriesLabel = a.series && a.series !== 'shadow' ? SERIES_LABEL[a.series as SeriesKey] : undefined;
  return (
    <div className="flex items-start gap-2 text-[11px] border-b border-slate-800/60 py-1.5 last:border-0">
      <span className="font-mono text-slate-500 shrink-0 w-[80px]" title={a.clock === 'wall' ? 'relógio da tela (ordem real)' : 'hora da barra simulada (papel)'}>
        {a.timeStr} <span className="text-slate-600 text-[9px]">{a.clock === 'wall' ? 'tela' : 'barra'}</span>
      </span>
      <span className="shrink-0 rounded bg-slate-800 border border-slate-700 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-slate-300">
        {ROUND_SOURCE_LABEL[a.source]}
      </span>
      <span className="flex-1 min-w-0">
        <span className="flex items-center gap-1.5 flex-wrap">
          {a.side && (
            <span className={`font-bold ${a.side === 'BUY' ? 'text-emerald-400' : 'text-rose-400'}`}>
              {a.side === 'BUY' ? '▲' : '▼'} {a.side === 'BUY' ? 'COMPRA' : 'VENDA'}
            </span>
          )}
          {seriesLabel && <span className="text-slate-500">· {seriesLabel}</span>}
          {a.contracts ? <span className="text-slate-500">· {a.contracts} ctros</span> : null}
          {a.pnl !== undefined && (
            <span className={`ml-auto font-mono shrink-0 ${pnlClass(a.pnl)}`}>
              {a.pnl >= 0 ? '+' : ''}
              {money(a.pnl)}
            </span>
          )}
        </span>
        <span className="block text-slate-400 leading-snug mt-0.5">{a.detail}</span>
      </span>
    </div>
  );
};

const MetaRow: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <>
    <span>{label}</span>
    <b className="text-slate-100 text-right">{value}</b>
  </>
);

const SourceLine: React.FC<{ name: string; count: number; note?: string }> = ({ name, count, note }) => (
  <div className="flex items-center justify-between gap-2 text-[11px] py-0.5">
    <span className="text-slate-300">{name}</span>
    <span className="font-mono text-slate-100">
      {count}
      {note && <span className="text-slate-500"> {note}</span>}
    </span>
  </div>
);

const RoundsAudit: React.FC<{ rounds: RoundRecord[] }> = ({ rounds }) => {
  const header = (
    <h3 className="text-xs sm:text-sm font-bold text-slate-100 uppercase tracking-wide flex items-center gap-1.5">
      <ClipboardList className="w-4 h-4 text-slate-400" /> Rodadas — auditoria por corrida de replay
    </h3>
  );

  if (rounds.length === 0) {
    return (
      <section>
        {header}
        <div className="mt-2 rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-3 text-[11px] text-slate-400 leading-snug">
          Nenhuma rodada registrada ainda. Rode um replay (botões <b className="text-slate-200">1d / 3d / 5d</b> acima) e
          a corrida aparece aqui com <b className="text-slate-200">todas as automações</b> que participaram — Robô 1, boleta
          manual, MT5, Robô 2 (sombra) e Coletor — pronta para auditar e exportar. O registro fica salvo mesmo depois de
          recarregar a página. <b className="text-slate-200">Nada aqui envia ordens reais.</b>
        </div>
      </section>
    );
  }

  return (
    <section>
      <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
        {header}
        <span className="text-[10px] uppercase tracking-wider text-slate-500 ml-1">{rounds.length} rodada(s)</span>
        <div className="flex items-center gap-1.5 ml-auto">
          <button
            onClick={() => roundAuditService.exportAllCSV()}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] font-semibold bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 transition-colors cursor-pointer"
            title="Exporta todas as rodadas em CSV padrão BR (UTF-8 com BOM, separador ;)"
          >
            <Download className="w-3.5 h-3.5" /> Exportar tudo
          </button>
          <button
            onClick={() => {
              if (window.confirm(`Apagar as ${rounds.length} rodada(s) registradas? O replay e o coletor não são afetados.`)) {
                roundAuditService.clear();
              }
            }}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] font-semibold bg-slate-800/60 hover:bg-rose-500/15 border border-slate-700 hover:border-rose-500/40 text-slate-300 transition-colors cursor-pointer"
            title="Zera o histórico de rodadas (só o ledger do Raio-X; nada da corretora)"
          >
            <Trash2 className="w-3.5 h-3.5" /> Zerar
          </button>
        </div>
      </div>

      <div className="space-y-2">
        {rounds.map((r, i) => (
          <CollapsibleSection
            key={r.id}
            icon={ClipboardList}
            iconClass={r.aborted ? 'text-amber-400' : 'text-emerald-400'}
            defaultOpen={i === 0}
            title={`${r.dateLabel} ${r.timeLabel} · ${r.days}d · ${r.speed}x · ${r.operated ? 'OPERA' : 'silencioso'}`}
            summary={`#${r.seed} · ${r.source === 'REAL' ? 'REAL (MT5)' : 'sintético'} · ${r.counts.total} ação(ões): Robô ${r.counts.robot} · Sombra ${r.counts.shadow} · Coletor ${r.counts.collector}`}
            trailing={
              <span className={`font-mono text-[11px] shrink-0 ${pnlClass(r.book.pnl)}`}>
                {r.book.pnl >= 0 ? '+' : ''}
                {money(r.book.pnl)}
              </span>
            }
          >
            {/* Metadados da corrida */}
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-slate-400">
              <MetaRow label="Origem" value={r.source === 'REAL' ? `HISTÓRICO REAL (MT5)${volumeTag(r.volumeSource) ? ` · ${volumeTag(r.volumeSource)}` : ''}` : `SINTÉTICO · seed #${r.seed}`}
              />
              <MetaRow label="Modo" value={r.operated ? 'OPERA (operou a estratégia)' : 'silencioso (só mede)'} />
              <MetaRow label="Ticks" value={r.tickCount.toLocaleString('pt-BR')} />
              <MetaRow label="Interrompida?" value={r.aborted ? <span className="text-amber-400">sim, no meio</span> : 'não'} />
              <MetaRow label="Ativo" value={`${r.assetSymbol} · ${r.boxLabel}`} />
              <MetaRow label="Estratégia" value={r.strategyName ? `${r.strategyName}${r.strategyId ? ` #${r.strategyId.slice(0, 4)}` : ''}` : '—'} />
            </div>

            {/* Contabilidade por automação — a integração com TODAS as automações */}
            <div className="rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2">
              <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-1">Ações por automação</p>
              <SourceLine name="Robô 1 (EA)" count={r.counts.robot} />
              <SourceLine name="Boleta manual" count={r.counts.manual} />
              <SourceLine name="MT5 real" count={r.counts.mt5} />
              <SourceLine name="Robô 2 (sombra)" count={r.counts.shadow} />
              <SourceLine name="Coletor (6 séries)" count={r.counts.collector} />
              <div className="mt-2 pt-2 border-t border-slate-800/70 grid grid-cols-1 sm:grid-cols-3 gap-1 text-[11px]">
                <div>
                  <span className="text-slate-500" title="Só entram no livro real as posições ABERTAS nesta corrida">Livro real</span>{' '}
                  <b className="text-slate-100">{r.book.trades}t</b>{' '}
                  <span className="text-emerald-400">{r.book.wins}W</span>/<span className="text-rose-400">{r.book.losses}L</span>
                  {r.book.breakeven > 0 && <span className="text-slate-400">/{r.book.breakeven}BE</span>}
                  {r.book.openCount > 0 && <span className="text-slate-500"> · {r.book.openCount} aberta(s)</span>}
                  <span className={`ml-1 font-mono ${pnlClass(r.book.pnl)}`}>{money(r.book.pnl)}</span>
                </div>
                <div>
                  <span className="text-slate-500">Sombra</span> <b className="text-slate-100">{r.shadow.trades}t</b>
                  <span className={`ml-1 font-mono ${pnlClass(r.shadow.pnl)}`}>{money(r.shadow.pnl)}</span>
                </div>
                <div>
                  <span className="text-slate-500">Coletor</span> <b className="text-slate-100">{r.collector.trades}t</b>
                  <span className={`ml-1 font-mono ${pnlClass(r.collector.pnl)}`}>{money(r.collector.pnl)}</span>
                </div>
              </div>
            </div>

            {/* Timeline auditável */}
            {r.liveMix && (
              <p className="text-[10px] text-amber-400/90 leading-snug mb-2">
                ⚠ Rodada gravada com o <b>MT5 conectado</b>: os ticks AO VIVO também alimentam sombra e
                coletor, então essas duas linhas podem misturar atividade real da sessão com a do replay.
                Só o livro real é separado por relógio.
              </p>
            )}
            <div>
              <div className="flex items-center justify-between mb-1">
                <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
                  Linha do tempo ({r.actions.length} ação(ões){r.actionsTruncated > 0 ? ` · ${r.actionsTruncated} fora do teto` : ''})
                </p>
                <button
                  onClick={() => roundAuditService.exportRoundCSV(r)}
                  className="flex items-center gap-1 text-[10px] font-semibold text-slate-400 hover:text-slate-200 cursor-pointer"
                  title="Exporta só esta rodada em CSV"
                >
                  <Download className="w-3 h-3" /> CSV
                </button>
              </div>
              <p className="text-[9px] text-slate-600 leading-snug mb-1">
                As ordens reais (relógio da tela) vêm primeiro; sombra e coletor depois, pela hora da
                barra simulada — os dois relógios não são o mesmo tempo.
              </p>
              {r.actions.length === 0 ? (
                <p className="text-[11px] text-slate-500 py-1">Rodada silenciosa: nenhum trade fechou (sombra e coletor sem liquidação nesta corrida).</p>
              ) : (
                <div className="max-h-72 overflow-y-auto pr-1">
                  {r.actions.slice(0, 40).map((a) => (
                    <ActionRow key={a.id} a={a} />
                  ))}
                  {r.actions.length > 40 && (
                    <p className="text-[10px] text-slate-500 py-1">… e mais {r.actions.length - 40} ação(ões) — o CSV traz as primeiras 500.</p>
                  )}
                </div>
              )}
            </div>
          </CollapsibleSection>
        ))}
      </div>
    </section>
  );
};


export const SimulatorView: React.FC<SimulatorViewProps> = ({
  isSimulating,
  setIsSimulating,
  simulationSpeed,
  setSimulationSpeed,
  robotActive,
  onToggleRobot,
  currentPrice,
  mt5Status,
  chartSeries,
  rangePoints,
  timeframeSec,
  config,
  boxCounts,
  tickBufferCount,
  ordersOpen,
  ordersClosed,
  onStepTick,
  onInjectAggression,
  onReplayHistory,
  isReplaying,
  asset = ASSETS[DEFAULT_ASSET_ID],
  onRunRealBacktest,
  isBacktestingReal = false,
  realBacktestResult,
}) => {

  const [backtestSourceType, setBacktestSourceType] = React.useState<'CSV' | 'MT5'>('CSV');
  const [selectedBacktestDate, setSelectedBacktestDate] = React.useState<string>('data/winz26_ticks.csv');
  const [selectedBacktestR, setSelectedBacktestR] = React.useState<number>(10);

  // Seleciona automaticamente o dataset CSV padrão quando o ativo muda
  React.useEffect(() => {
    const sym = asset?.id || 'WIN';
    if (sym === 'WDO') {
      setSelectedBacktestDate('data/wdoz26_ticks.csv');
      setSelectedBacktestR(10);
    } else if (sym === 'BTC' || sym === 'BTCBR') {
      setSelectedBacktestDate('data/bitx26_ticks.csv');
      setSelectedBacktestR(10);
    } else {
      setSelectedBacktestDate('data/winz26_ticks.csv');
      setSelectedBacktestR(10);
    }
  }, [asset?.id]);

  // Opções dinâmicas de Renko por ativo
  const renkoOptions = React.useMemo(() => {
    const sym = asset?.id || 'WIN';
    if (sym === 'WDO') {
      return [
        { r: 5, label: '5R (2.5 pts)' },
        { r: 10, label: '10R (5.0 pts)' },
        { r: 15, label: '15R (7.5 pts)' },
        { r: 20, label: '20R (10.0 pts)' },
      ];
    } else if (sym === 'BTC' || sym === 'BTCBR') {
      return [
        { r: 10, label: '10R (200 pts)' },
        { r: 25, label: '25R (500 pts)' },
        { r: 50, label: '50R (1.000 pts)' },
        { r: 100, label: '100R (2.000 pts)' },
      ];
    }
    return [
      { r: 7, label: '7R (35 pts)' },
      { r: 10, label: '10R (50 pts)' },
      { r: 15, label: '15R (75 pts)' },
      { r: 20, label: '20R (100 pts)' },
      { r: 25, label: '25R (125 pts)' },
    ];
  }, [asset?.id]);  useSyncExternalStore(seriesCollectorService.subscribe, seriesCollectorService.getVersion);
  const snap = seriesCollectorService.getSnapshot();
  // Ledger de rodadas: a página se atualiza sozinha quando uma corrida é registrada no fim do replay.
  useSyncExternalStore(roundAuditService.subscribe, roundAuditService.getVersion);
  const rounds = roundAuditService.list();

  const mt5Live = mt5Status === 'CONNECTED';
  const intervalMs = Math.max(50, Math.floor(2000 / simulationSpeed));
  const paceLabel = `${(intervalMs / 1000).toFixed(1).replace('.', ',')}s por tick`;
  const renkoScale = renkoScaleLabel(config.boxPoints, asset);
  const tickLabel = `${formatPrice(asset.tickSize, asset)} pts`;
  const sessionLabel = `${asset.session.open}–${asset.session.close}`;
  const collectorFresh = Date.now() - snap.updatedAt < 6000;

  const feedLabel = mt5Live
    ? 'MT5 AO VIVO'
    : isSimulating
    ? 'SIMULADOR RODANDO'
    : 'PAUSADO';
  const feedColor = mt5Live ? 'text-emerald-300' : isSimulating ? 'text-emerald-300' : 'text-rose-300';

  const activeSeriesKey: SeriesKey = chartSeries === 'renko' ? 'renko' : 'range';
  const shadowTrades = (Object.keys(snap.series) as SeriesKey[]).reduce((a, k) => a + snap.series[k].stats.trades, 0);
  const shadowOpen = (Object.keys(snap.series) as SeriesKey[]).reduce((a, k) => a + snap.series[k].stats.openCount, 0);

  return (
    <div className="h-full w-full rounded-lg border border-slate-800 bg-slate-950 flex flex-col overflow-hidden">
      {/* Faixa de status ao vivo */}
      <div className="flex items-center gap-2.5 px-3 sm:px-4 py-2.5 border-b border-slate-800 bg-slate-900/60 shrink-0 flex-wrap">
        <div className="p-1.5 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 shrink-0">
          <Cpu className="w-4 h-4" />
        </div>
        <div className="flex flex-col min-w-0 mr-2">
          <span className="text-sm font-bold text-slate-100 leading-tight">Simulador — Raio-X do Sistema</span>
          <span className="text-[10px] sm:text-[11px] text-slate-400 leading-tight">
            Tudo que está rodando neste exato momento, sem mistério
          </span>
        </div>
        <div
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-[11px] font-bold uppercase tracking-wider ${
            isSimulating || mt5Live
              ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-300'
              : 'bg-rose-500/10 border-rose-500/30 text-rose-300'
          }`}
        >
          <Radio className={`w-3 h-3 ${isSimulating || mt5Live ? 'animate-pulse' : ''}`} />
          {feedLabel}
        </div>
        <StatChip label="Preço" value={`${currentPrice.toLocaleString('pt-BR')} pts`} color="text-emerald-300" />
        <StatChip label="Ritmo" value={mt5Live ? 'tempo real' : `≈ ${paceLabel}`} />
        <StatChip label="Buffer de ticks" value={tickBufferCount.toLocaleString('pt-BR')} />
        <StatChip label="Robô" value={robotActive ? 'LIGADO' : 'PAUSADO'} color={robotActive ? 'text-emerald-300' : 'text-rose-300'} />
      </div>

      {/* Corpo rolável */}
      <div className="flex-1 min-h-0 overflow-y-auto px-3 sm:px-4 py-3 space-y-4">
        {/* Controles diretos */}
        <section>
          <h3 className="text-xs sm:text-sm font-bold text-slate-100 uppercase tracking-wide mb-2">Controles do mercado</h3>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => setIsSimulating(!isSimulating)}
              disabled={mt5Live}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold text-white transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                isSimulating ? 'bg-slate-700 hover:bg-slate-600' : 'bg-emerald-600 hover:bg-emerald-500'
              }`}
              title={mt5Live ? 'Com o MT5 conectado, o feed vem da corretora' : 'Ligar/desligar a geração de ticks do simulador'}
            >
              {isSimulating ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
              {isSimulating ? 'Pausar mercado' : 'Iniciar mercado'}
            </button>
            <button
              onClick={onStepTick}
              disabled={mt5Live}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              title="Avançar exatamente 1 tick (bom para estudar o gráfico degrau a degrau)"
            >
              <StepForward className="w-3.5 h-3.5" />
              1 tick
            </button>
            <button
              onClick={onToggleRobot}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold border transition-colors cursor-pointer ${
                robotActive
                  ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/25'
                  : 'bg-rose-500/10 border-rose-500/30 text-rose-300 hover:bg-rose-500/20'
              }`}
              title="Ligar/desligar o disparo automático de ordens (vale para simulador e MT5)"
            >
              <Bot className="w-3.5 h-3.5" />
              Robô: {robotActive ? 'LIGADO' : 'PAUSADO'}
            </button>
            <div className="flex items-center gap-1">
              <button
                onClick={() => onInjectAggression('BUY')}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-[11px] font-bold bg-emerald-600/70 hover:bg-emerald-500 text-white transition-colors cursor-pointer"
                title="Injeta uma agressão de compra grande (testa o fluxo comprador no gráfico)"
              >
                <ArrowUpRight className="w-3.5 h-3.5" /> Agressão compra
              </button>
              <button
                onClick={() => onInjectAggression('SELL')}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-[11px] font-bold bg-rose-600/70 hover:bg-rose-500 text-white transition-colors cursor-pointer"
                title="Injeta uma agressão de venda grande (teste defensivo da estratégia)"
              >
                <ArrowDownRight className="w-3.5 h-3.5" /> Agressão venda
              </button>
            </div>
            {/* Velocidade — comanda o feed ao vivo E a reprodução do replay (mesma da tira de status) */}
            <div
              className="flex items-center gap-2 ml-auto rounded-lg border border-slate-800 bg-slate-900/60 px-2.5 py-1.5"
              title="Compasso do simulador: vale para o feed ao vivo e para a reprodução do replay. 1x = bem lento (o dia inteiro leva ~1min45 no replay); 2x ~55s, 5x ~15s e 10x = modo apresentação (~5s)."
            >
              <Activity className="w-3.5 h-3.5 text-slate-400" />
              <span className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Velocidade</span>
              <input
                type="range"
                min={1}
                max={10}
                step={1}
                value={simulationSpeed}
                onChange={(e) => setSimulationSpeed(Number(e.target.value))}
                className="w-28 accent-emerald-500 cursor-pointer"
              />
              <span className="text-xs font-mono text-slate-200 w-6 text-right">{simulationSpeed}</span>
            </div>
          </div>
          {mt5Live && (
            <p className="text-[10px] sm:text-[11px] text-emerald-300/80 mt-1.5">
              MT5 conectado: os ticks agora vêm da corretora (o simulador está desligado automaticamente).
            </p>
          )}
        </section>

        {/* Motores de barra */}
        <section>
          <h3 className="text-xs sm:text-sm font-bold text-slate-100 uppercase tracking-wide mb-2">
            Quem está calculando agora — 6 motores em paralelo
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
            <EngineCard
              k="renko"
              scale={`${renkoScale} · ${config.boxPoints} pts`}
              role={
                chartSeries === 'renko'
                  ? 'SÉRIE ATIVA no gráfico — é esta que o robô usa para as ordens reais'
                  : `Motor clássico de blocos de pontos (1R = ${tickLabel})`
              }
              boxes={boxCounts.renko}
              activeSeries={chartSeries === 'renko'}
              feedsRealOrders={chartSeries === 'renko'}
            />
            <EngineCard
              k="range"
              scale={`${rangePoints} pts`}
              role={
                chartSeries === 'range'
                  ? 'SÉRIE ATIVA no gráfico — é esta que o robô usa para as ordens reais'
                  : 'Bloco fecha quando o preço percorre a metragem, ignore o tempo'
              }
              boxes={boxCounts.range}
              activeSeries={chartSeries === 'range'}
              feedsRealOrders={chartSeries === 'range'}
            />
            <EngineCard
              k="tempo"
              scale={`${timeframeSec < 60 ? `${timeframeSec}s` : `${Math.round(timeframeSec / 60)}min`}`}
              role='Saiu do gráfico (coisa do passado): roda escondido e só mostra o que já foi registrado no Coletor'
              boxes={boxCounts.tempo}
              activeSeries={false}
              feedsRealOrders={false}
            />
            <EngineCard
              k="renko15r"
              scale="75 pts"
              role="Renko grande de teste — roda escondido só para o coletor medir"
              boxes={boxCounts.renko15r}
              activeSeries={false}
              feedsRealOrders={false}
            />
            <EngineCard
              k="renko20r"
              scale="100 pts"
              role="Renko grande de teste — roda escondido só para o coletor medir"
              boxes={boxCounts.renko20r}
              activeSeries={false}
              feedsRealOrders={false}
            />
            <EngineCard
              k="renko25r"
              scale="125 pts"
              role="Renko grande de teste — roda escondido só para o coletor medir"
              boxes={boxCounts.renko25r}
              activeSeries={false}
              feedsRealOrders={false}
            />
          </div>
        </section>

        {/* Pipeline do tick até a ordem */}
        <section>
          <h3 className="text-xs sm:text-sm font-bold text-slate-100 uppercase tracking-wide mb-2">
            O caminho de 1 tick até virar ordem
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5">
            <PipelineStep
              n={1}
              icon={<Radio className="w-3.5 h-3.5" />}
              title="Mercado"
              desc="Simulador (ou MT5) gera ticks com preço, volume e agressor."
              value={`${tickBufferCount.toLocaleString('pt-BR')} ticks`}
            />
            <PipelineStep
              n={2}
              icon={<Cpu className="w-3.5 h-3.5" />}
              title="6 motores de barra"
              desc="Cada tick alimenta Renko, Range, Tempo e 15R/20R/25R ao mesmo tempo."
              value={`${Object.values(boxCounts).reduce((a, b) => a + b, 0).toLocaleString('pt-BR')} barras`}
            />
            <PipelineStep
              n={3}
              icon={<Zap className="w-3.5 h-3.5" />}
              title="Convergência"
              desc={`Estratégia ${config.strategyMode === 'PYRAMID_FLOW_CONFLUENCE' ? 'Pirâmide de Confluência' : 'Reteste (Pullback)'} avalia CADA barra que fecha.`}
              value={`série: ${SERIES_LABEL[activeSeriesKey]}`}
            />
            <PipelineStep
              n={4}
              icon={<Bot className="w-3.5 h-3.5" />}
              title="Robô real"
              desc="Só a SÉRIE ATIVA do gráfico dispara ordens (demo ou MT5)."
              value={`${ordersOpen} abertas / ${ordersClosed} fechadas`}
            />
            <PipelineStep
              n={5}
              icon={<Database className="w-3.5 h-3.5" />}
              title="Coletor sombra"
              desc="6 robôs de papel copiam as 6 séries para comparar eficiência."
              value={collectorFresh ? `${shadowTrades} trades • recebendo` : `${shadowTrades} trades`}
            />
          </div>
        </section>

        {/* Números da sessão + replay */}
        <section>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-2.5">
            <div className="rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2.5">
              <h3 className="text-xs sm:text-sm font-bold text-slate-100 uppercase tracking-wide mb-2">Números da sessão</h3>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] sm:text-xs text-slate-400">
                <span>Início da sessão</span>
                <b className="text-slate-100 text-right">{new Date(snap.sessionStarted).toLocaleTimeString('pt-BR')}</b>
                <span>Trades sombra (6 séries)</span>
                <b className="text-slate-100 text-right">{shadowTrades.toLocaleString('pt-BR')}</b>
                <span>Posições sombra abertas</span>
                <b className="text-slate-100 text-right">{shadowOpen}</b>
                <span>Ordens reais abertas</span>
                <b className="text-slate-100 text-right">{ordersOpen}</b>
                <span>Modo do EA</span>
                <b className="text-slate-100 text-right">
                  {config.strategyMode === 'PYRAMID_FLOW_CONFLUENCE' ? 'Pirâmide' : 'Reteste'}
                </b>
              </div>
            </div>
            {/* NOVO: BACKTEST COM TICKS REAIS B3 (XP MT5) */}
            <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/5 px-3 py-3 mb-3 shadow-lg">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                <div className="flex items-center gap-2">
                  <span className="flex h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                  <h3 className="text-xs sm:text-sm font-bold text-emerald-300 uppercase tracking-wide">
                    Backtest com Ticks Reais B3 (XP MT5)
                  </h3>
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                    Fluxo Negócio por Negócio (45M+ ticks)
                  </span>
                </div>
              </div>
              <p className="text-[11px] text-slate-300 leading-snug mb-3">
                Simule a estratégia exata com os <b className="text-emerald-300">milhões de ticks reais da B3</b> gravados pelo MT5. Escolha qualquer pregão disponível e o tamanho do bloco Renko:
              </p>
              <div className="flex flex-wrap items-center gap-2.5 bg-slate-900/80 p-2.5 rounded-md border border-slate-800">
                {/* Seletor de Modo da Fonte */}
                <div className="flex items-center rounded bg-slate-950 border border-slate-700 p-0.5">
                  <button
                    type="button"
                    onClick={() => {
                      setBacktestSourceType('CSV');
                      const sym = asset?.id || 'WIN';
                      if (sym === 'WDO') setSelectedBacktestDate('data/wdoz26_ticks.csv');
                      else if (sym === 'BTC' || sym === 'BTCBR') setSelectedBacktestDate('data/bitx26_ticks.csv');
                      else setSelectedBacktestDate('data/winz26_ticks.csv');
                    }}
                    className={`px-2 py-1 text-[11px] font-bold rounded transition-colors ${
                      backtestSourceType === 'CSV'
                        ? 'bg-emerald-600 text-white shadow'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    📂 Dataset CSV
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setBacktestSourceType('MT5');
                      setSelectedBacktestDate('2026-11-04');
                    }}
                    className={`px-2 py-1 text-[11px] font-bold rounded transition-colors ${
                      backtestSourceType === 'MT5'
                        ? 'bg-emerald-600 text-white shadow'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    🟢 MT5 Live
                  </button>
                </div>

                {/* Seleção do Arquivo CSV ou Data do MT5 */}
                <div className="flex items-center gap-1.5 flex-1 min-w-[200px]">
                  <span className="text-[11px] text-slate-400 font-medium">
                    {backtestSourceType === 'CSV' ? 'Arquivo:' : 'Pregão:'}
                  </span>
                  {backtestSourceType === 'CSV' ? (
                    <select
                      value={selectedBacktestDate}
                      onChange={(e) => setSelectedBacktestDate(e.target.value)}
                      disabled={isBacktestingReal}
                      className="h-7 w-full rounded bg-slate-950 border border-slate-700 text-slate-200 text-xs px-2 cursor-pointer font-mono focus:outline-none focus:border-emerald-500"
                    >
                      <option value="data/winz26_ticks.csv">winz26_ticks.csv (Mini-Índice · 1,08M ticks)</option>
                      <option value="data/wdoz26_ticks.csv">wdoz26_ticks.csv (Mini-Dólar · 987k ticks)</option>
                      <option value="data/bitx26_ticks.csv">bitx26_ticks.csv (Bitcoin B3 Vigente · 507k ticks)</option>
                      <option value="data/bit_cont_ticks.csv">bit_cont_ticks.csv (Bitcoin Série Contínua · 988k ticks)</option>
                    </select>
                  ) : (
                    <select
                      value={selectedBacktestDate}
                      onChange={(e) => setSelectedBacktestDate(e.target.value)}
                      disabled={isBacktestingReal}
                      className="h-7 w-full rounded bg-slate-950 border border-slate-700 text-slate-200 text-xs px-2 cursor-pointer font-mono focus:outline-none focus:border-emerald-500"
                    >
                      <option value="2026-11-04">04/11/2026 (Hoje - Qua)</option>
                      <option value="2026-11-03">03/11/2026 (Ontem - Ter)</option>
                      <option value="2026-10-30">30/10/2026 (Sexta)</option>
                      <option value="2026-10-29">29/10/2026 (Quinta)</option>
                      <option value="2026-10-28">28/10/2026 (Quarta)</option>
                      <option value="2026-10-27">27/10/2026 (Terça)</option>
                      <option value="2026-10-26">26/10/2026 (Segunda)</option>
                      <option value="2026-10-23">23/10/2026 (Sexta)</option>
                      <option value="2026-10-22">22/10/2026 (Quinta)</option>
                      <option value="2026-10-21">21/10/2026 (Quarta)</option>
                      <option value="2026-10-20">20/10/2026 (Terça)</option>
                      <option value="2026-10-19">19/10/2026 (Segunda)</option>
                      <option value="2026-10-16">16/10/2026 (Sexta)</option>
                      <option value="2026-10-15">15/10/2026 (Quinta)</option>
                      <option value="2026-10-14">14/10/2026 (Quarta)</option>
                    </select>
                  )}
                </div>

                {/* Seletor Dinâmico de Renko */}
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] text-slate-400 font-medium">Renko:</span>
                  <select
                    value={selectedBacktestR}
                    onChange={(e) => setSelectedBacktestR(Number(e.target.value))}
                    disabled={isBacktestingReal}
                    className="h-7 rounded bg-slate-950 border border-slate-700 text-slate-200 text-xs px-2 cursor-pointer font-mono focus:outline-none focus:border-emerald-500"
                  >
                    {renkoOptions.map((opt) => (
                      <option key={opt.r} value={opt.r}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>

                <button
                  type="button"
                  onClick={() => onRunRealBacktest?.(selectedBacktestDate, selectedBacktestR)}
                  disabled={isBacktestingReal}
                  className={`h-7 px-4 rounded text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 shadow-md ${
                    isBacktestingReal
                      ? "bg-emerald-500/30 text-emerald-300/50 cursor-wait"
                      : "bg-emerald-500 hover:bg-emerald-400 text-slate-950"
                  }`}
                >
                  <Zap className="w-3.5 h-3.5" />
                  {isBacktestingReal ? "Processando Ticks..." : "Rodar Backtest Tick-a-Tick"}
                </button>
              </div>

              {/* RESULTADO CONSOLIDADO DO BACKTEST REAL */}
              {realBacktestResult && (
                <div className="mt-3 bg-slate-950/80 border border-slate-800 rounded-lg p-3">
                  <div className="flex items-center justify-between border-b border-slate-800/80 pb-2 mb-2">
                    <span className="text-xs font-bold text-slate-200">
                      Resultado do Pregão {realBacktestResult.date} ({realBacktestResult.renko_r}R)
                    </span>
                    <span className="text-[11px] text-slate-400 font-mono">
                      {realBacktestResult.ticks?.toLocaleString()} ticks reais · {realBacktestResult.boxes} boxes
                    </span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
                    <div className="bg-slate-900/60 p-2 rounded border border-slate-800/60">
                      <div className="text-[10px] uppercase text-slate-400 font-medium">PnL Líquido</div>
                      <div className={`text-base font-bold font-mono mt-0.5 ${realBacktestResult.pnl >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                        {realBacktestResult.pnl >= 0 ? "+" : ""}R$ {realBacktestResult.pnl?.toFixed(2)}
                      </div>
                    </div>
                    <div className="bg-slate-900/60 p-2 rounded border border-slate-800/60">
                      <div className="text-[10px] uppercase text-slate-400 font-medium">Taxa de Acerto</div>
                      <div className="text-base font-bold font-mono mt-0.5 text-slate-200">
                        {realBacktestResult.win_rate}%
                      </div>
                    </div>
                    <div className="bg-slate-900/60 p-2 rounded border border-slate-800/60">
                      <div className="text-[10px] uppercase text-slate-400 font-medium">Operações</div>
                      <div className="text-base font-bold font-mono mt-0.5 text-slate-300">
                        {realBacktestResult.total_ops} <span className="text-xs font-normal text-slate-500">({realBacktestResult.wins}W / {realBacktestResult.losses}L)</span>
                      </div>
                    </div>
                    <div className="bg-slate-900/60 p-2 rounded border border-slate-800/60">
                      <div className="text-[10px] uppercase text-slate-400 font-medium">Fator de Lucro</div>
                      <div className="text-base font-bold font-mono mt-0.5 text-emerald-400">
                        {realBacktestResult.profit_factor}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="rounded-lg border border-violet-500/30 bg-violet-500/5 px-3 py-2.5">
              <h3 className="text-xs sm:text-sm font-bold text-slate-100 uppercase tracking-wide mb-1">
                Histórico sintético (replay)
              </h3>
              <p className="text-[11px] text-slate-400 leading-snug mb-2">
                Gera {asset.session.weekdaysOnly ? 'dias úteis' : 'dias'} falsos ({sessionLabel}, com leilão/almoço/fechamento realistas) e reproduz nos
                6 motores e no coletor. <b className="text-slate-200">Nada aqui envia ordens reais.</b> Atenção: o
                replay zera a contabilidade atual do coletor <b className="text-slate-200">e também as ordens
                abertas, o livro de auditoria e o PnL da sessão</b> (começa um pregão limpo). Com o MT5
                conectado nada é apagado.
                <span className="text-slate-300"> A corrida agora é <b className="text-slate-200">progressiva</b>: começa
                na primeira barra e desenha o período todo (mínimo 1 dia) no compasso da velocidade acima — 1x leva ~1min45,
                2x ~55s, 5x ~15s e 10x roda em ~5s. A plataforma <b className="text-slate-200">acorda parada e vazia</b> —
                o replay nunca roda sozinho na abertura (regra do Ciclo 12), só pelo clique aqui ou na seta da tira de
                status logo abaixo do menu, então não precisa sair desta aba para escolher o dia.</span>
                <span className="text-slate-300"> No chip <b className="text-slate-200">OPERA</b> da tira de status o
                replay também <b className="text-slate-200">opera a estratégia de verdade</b>: abre MAE e pirâmides,
                enche a auditoria e move o PnL enquanto o dia passa (precisa do Robô LIGADO). Desligado, ele fica
                silencioso e só alimenta o coletor. Nos dois casos nada é enviado à corretora — com o MT5 conectado o
                modo OPERA é bloqueado por segurança.</span>
                <span className="text-slate-300"> Trava de horário: {config.tradingHoursEnabled ? <b className="text-slate-200">liberado das {config.tradingStartTime} (leilão à vista e o 1º candle já é operável) e bloqueado das {config.tradingStopEntriesTime} até as {config.tradingStartTime}</b> : <b className="text-slate-200">filtro de entradas desligado — o robô pode abrir em qualquer hora do pregão</b>} — a janela é medida na hora da barra simulada, nunca no relógio da sala. Ao chegar na zeragem das <b className="text-slate-200">{sessionCloseLockLabel(config.tradingCloseAllTime)}</b> (hora da estratégia) o robô liquida todas as posições a mercado, cancela
                as limitadas pendentes e para de abrir operações até o próximo pregão — assim nenhum dia termina
                pendurado com ordem aberta. Com o MT5 conectado a trava não age, para jamais fechar posição real sem
                você mandar.</span>
              </p>
              <div className="flex items-center gap-2">
                {[1, 3, 5].map((d) => (
                  <button
                    key={d}
                    onClick={() => onReplayHistory(d)}
                    disabled={isReplaying}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold transition-colors cursor-pointer ${
                      isReplaying
                        ? 'bg-violet-500/20 text-violet-300/50 cursor-wait'
                        : 'bg-violet-600/60 hover:bg-violet-500 text-white'
                    }`}
                  >
                    <History className="w-3.5 h-3.5" /> {isReplaying ? 'Rodando...' : `${d} dia${d > 1 ? 's' : ''}`}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Rodadas — auditoria por corrida (todas as automações, persistente) */}
        <RoundsAudit rounds={rounds} />

        {/* Glossário */}
        <section>
          <h3 className="text-xs sm:text-sm font-bold text-slate-100 uppercase tracking-wide mb-2 flex items-center gap-1.5">
            <BookOpen className="w-4 h-4 text-slate-400" /> O que é cada coisa? (clique para abrir)
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <GlossaryItem term="1R e o gráfico de Pontos (Renko)">
              1R = 1 bloco de {tickLabel} do {asset.label}. O gráfico de Pontos só desenha bloco quando o preço
              percorre a escala configurada (ex.: {renkoScale} = {config.boxPoints} pts, como está agora). Tempo não importa, só movimento.
            </GlossaryItem>
            <GlossaryItem term="Gráfico de Range">
              Bloco fecha quando o preço percorre a metragem escolhida (ex.: 50 pts entre mínima e máxima),
              não importa quanto tempo leve. Ótimo para ver a "briga" entre compra e venda.
            </GlossaryItem>
            <GlossaryItem term="Gráfico de Tempo">
              Candle por relógio (ex.: 30 segundos), desenhado como bloco sólido estilo Renko. É o gráfico
              tradicional, mas com a nossa pintura.
            </GlossaryItem>
            <GlossaryItem term="Robô sombra e Coletor">
              Seis contadores invisíveis que copiam a estratégia do EA em cada série/escala ao mesmo tempo e
              guardam o resultado em R$ na tela "Comparativo". Pura contabilidade — não envia ordem nenhuma.
            </GlossaryItem>
            <GlossaryItem term="Agressão de compra/venda (bancada)">
              Os botões injetam um bloco de ordens agressoras de ~100 contratos no preço. Serve para ver o
              indicador de fluxo e os motores reagindo a um choque de demanda/oferta.
            </GlossaryItem>
            <GlossaryItem term="Por que 15R/20R/25R fecham tão devagar?">
              Blocos de 75–125 pontos precisam percorrer 15–25x um R minúsculo. No simulador (que ladoia),
              isso leva minutos de tela — rode um replay 3d ou 5d para vê-los operar de verdade.
            </GlossaryItem>
          </div>
        </section>
      </div>

      {/* Rodapé */}
      <div className="px-3 sm:px-4 py-2 border-t border-slate-800/60 shrink-0">
        <p className="text-[10px] text-slate-500 leading-snug">
          Regra de ouro do sistema: <b className="text-slate-300">o robô real só obedece à série ativa no gráfico</b>
          ({SERIES_LABEL[activeSeriesKey]}). Todo o resto (15R/20R/25R e as outras 2 séries) roda em paralelo apenas
          para medir eficiência no coletor.
        </p>
      </div>
    </div>
  );
};
