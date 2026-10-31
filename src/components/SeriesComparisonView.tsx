import React, { useSyncExternalStore, useMemo } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { Download, RotateCcw, Database, History } from 'lucide-react';
import { seriesCollectorService, SERIES_LABEL } from '../services/seriesCollectorService';
import { SeriesKey } from '../utils/paperStrategyBot';

/**
 * Comparativo de Eficiência — dois experimentos lado a lado:
 * 1. Séries de gráfico: Pontos (Renko 10R) x Range x Tempo
 * 2. Escalas Renko: 15R x 20R x 25R (motores extras só para medição)
 * Todos os robôs sombra rodam a MESMA estratégia/config do EA sobre o mesmo mercado.
 * Nenhum número aqui mexe nas ordens reais — é contabilidade paralela.
 */

const GROUPS: { title: string; subtitle: string; keys: SeriesKey[] }[] = [
  {
    title: 'Séries de gráfico',
    subtitle: 'Pontos (Renko 10R) x Range x Tempo — mesma estratégia, três leituras do mercado',
    keys: ['renko', 'range', 'tempo'],
  },
  {
    title: 'Escalas Renko',
    subtitle: '15R (75 pts) x 20R (100 pts) x 25R (125 pts) — qual tamanho de box rende melhor?',
    keys: ['renko15r', 'renko20r', 'renko25r'],
  },
];

const SERIES_COLORS: Record<SeriesKey, string> = {
  renko: '#10b981', // emerald
  range: '#38bdf8', // sky
  tempo: '#f59e0b', // amber
  renko15r: '#a78bfa', // violet
  renko20r: '#f472b6', // pink
  renko25r: '#fb923c', // orange
};

const fmtR$ = (v: number) =>
  `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const MetricRow: React.FC<{ label: string; value: string; accent?: string }> = ({
  label,
  value,
  accent,
}) => (
  <div className="flex items-center justify-between text-[11px] sm:text-xs py-1 border-b border-slate-800/60 last:border-0">
    <span className="text-slate-400">{label}</span>
    <span className={`font-bold tabular-nums ${accent ?? 'text-slate-100'}`}>{value}</span>
  </div>
);

const SeriesCard: React.FC<{ k: SeriesKey; snap: ReturnType<typeof seriesCollectorService.getSnapshot> }> = ({
  k,
  snap,
}) => {
  const s = snap.series[k].stats;
  return (
    <div className="rounded-lg border bg-slate-900/50 px-3 py-2.5" style={{ borderColor: `${SERIES_COLORS[k]}55` }}>
      <div className="flex items-center gap-2 mb-1.5">
        <span className="w-2.5 h-2.5 rounded-full" style={{ background: SERIES_COLORS[k] }} />
        <span className="text-xs sm:text-sm font-bold text-slate-100">{SERIES_LABEL[k]}</span>
        <span className="ml-auto text-[10px] text-slate-500 font-mono">
          {s.trades > 0 ? `${s.trades} trades` : s.openCount > 0 ? `${s.openCount} sombra abertas` : 'aguardando'}
        </span>
      </div>
      <MetricRow
        label="Agora (c/ aberto)"
        value={fmtR$(s.liveEquity)}
        accent={s.liveEquity > 0 ? 'text-emerald-400' : s.liveEquity < 0 ? 'text-rose-400' : 'text-slate-100'}
      />
      <MetricRow
        label="Resultado realizado"
        value={fmtR$(s.totalFinancial)}
        accent={s.totalFinancial > 0 ? 'text-emerald-400' : s.totalFinancial < 0 ? 'text-rose-400' : 'text-slate-100'}
      />
      <MetricRow
        label="Pontos líquidos"
        value={`${s.totalPoints > 0 ? '+' : ''}${s.totalPoints.toFixed(0)} pts`}
        accent={s.totalPoints > 0 ? 'text-emerald-400' : s.totalPoints < 0 ? 'text-rose-400' : 'text-slate-100'}
      />
      <MetricRow label="Win rate" value={s.settled > 0 ? `${s.winRate.toFixed(1)}% (${s.wins}/${s.settled})` : '—'} />
      <MetricRow label="Fator de lucro" value={s.settled > 0 ? (Number.isFinite(s.profitFactor) ? s.profitFactor.toFixed(2) : '∞') : '—'} />
      <MetricRow
        label="Máx. rebaixamento"
        value={s.maxDrawdown > 0 ? fmtR$(s.maxDrawdown) : '—'}
        accent={s.maxDrawdown > 0 ? 'text-amber-400' : 'text-slate-100'}
      />
      <MetricRow
        label="Ganho bruto"
        value={s.grossProfit > 0 ? fmtR$(s.grossProfit) : '—'}
        accent={s.grossProfit > 0 ? 'text-emerald-400' : 'text-slate-100'}
      />
      <MetricRow
        label="Perda bruta"
        value={s.grossLossVal > 0 ? fmtR$(s.grossLossVal) : '—'}
        accent={s.grossLossVal > 0 ? 'text-rose-400' : 'text-slate-100'}
      />
      <MetricRow
        label="Média ganhador"
        value={s.avgWin > 0 ? fmtR$(s.avgWin) : '—'}
        accent={s.avgWin > 0 ? 'text-emerald-400/80' : 'text-slate-100'}
      />
      <MetricRow
        label="Média perdedor"
        value={s.avgLoss < 0 ? fmtR$(s.avgLoss) : '—'}
        accent={s.avgLoss < 0 ? 'text-rose-400/80' : 'text-slate-100'}
      />
      <MetricRow
        label="Expectativa/trade"
        value={s.settled > 0 ? `${s.expectancy > 0 ? '+' : ''}${fmtR$(s.expectancy)}` : '—'}
        accent={s.expectancy > 0 ? 'text-emerald-400' : s.expectancy < 0 ? 'text-rose-400' : 'text-slate-100'}
      />
      <MetricRow
        label="Maior gain / loss"
        value={s.settled > 0 ? `${fmtR$(s.largestWin)} / ${fmtR$(s.largestLoss)}` : '—'}
      />
    </div>
  );
};

const GroupChart: React.FC<{ keys: SeriesKey[]; data: Record<string, number | undefined>[] }> = ({
  keys,
  data,
}) => {
  // Filtra apenas as séries DESTE grupo e apenas pontos com valor próprio
  // (curva compartilhada entre grupos criaria buracos e linhas cortando o gráfico)
  const rows = data
    .map((d) => {
      const vals = keys.filter((k) => d[k] !== undefined);
      if (vals.length === 0) return null;
      const row: Record<string, number> = { t: d.t as number };
      vals.forEach((k) => (row[k] = d[k] as number));
      return row;
    })
    .filter((r): r is Record<string, number> => r !== null);

  // Eixo adaptativo: histórico de vários dias mostra dd/mm; sessão única mostra hh:mm
  const multiDay = rows.length > 1 && (rows[rows.length - 1].t - rows[0].t) > 30 * 3600 * 1000;

  return (
    <div className="h-44 sm:h-48 rounded-lg border border-slate-800 bg-slate-900/40 p-2">
      {rows.length === 0 ? (
        <div className="h-full flex items-center justify-center text-[11px] text-slate-500">
          Aguardando os primeiros trades sombra deste grupo...
        </div>
      ) : (
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 6, right: 10, bottom: 2, left: -8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
            <XAxis
              dataKey="t"
              type="number"
              domain={['dataMin', 'dataMax']}
              tickFormatter={(t: number) =>
                multiDay
                  ? new Date(t).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
                  : new Date(t).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
              }
              stroke="#64748b"
              fontSize={10}
              tickCount={6}
            />
          <YAxis stroke="#64748b" fontSize={10} tickFormatter={(v: number) => `R$${v.toFixed(0)}`} width={60} />
          <Tooltip
            contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 8, fontSize: 11 }}
            labelFormatter={(t) =>
              multiDay
                ? new Date(Number(t)).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
                : new Date(Number(t)).toLocaleTimeString('pt-BR')
            }
            formatter={(value, name) => [fmtR$(Number(value)), SERIES_LABEL[String(name) as SeriesKey] ?? String(name)]}
          />
          <Legend
            formatter={(value: string) => (
              <span style={{ color: '#94a3b8', fontSize: 11 }}>{SERIES_LABEL[value as SeriesKey] ?? value}</span>
            )}
          />
          {keys.map((k) => (
            <Line
              key={k}
              type="stepAfter"
              dataKey={k}
              stroke={SERIES_COLORS[k]}
              strokeWidth={2}
              dot={false}
              connectNulls
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    )}
    </div>
  );
};

export const SeriesComparisonView: React.FC<{
  onReplayHistory?: (days: number) => void;
  isReplaying?: boolean;
}> = ({ onReplayHistory, isReplaying }) => {
  // Re-render a cada barra fechada ingerida pelo coletor
  useSyncExternalStore(seriesCollectorService.subscribe, seriesCollectorService.getVersion);
  const snap = seriesCollectorService.getSnapshot();

  // Uma única linha do tempo com todas as séries (cada gráfico filtra suas linhas)
  const chartData = useMemo(() => {
    const map = new Map<number, Record<string, number>>();
    for (const group of GROUPS) {
      for (const k of group.keys) {
        for (const p of snap.series[k].equityCurve) {
          map.set(p.t, { ...map.get(p.t), [k]: p.v });
        }
      }
    }
    return [...map.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([t, v]) => ({ t, ...v }));
  }, [snap.updatedAt]);

  const allKeys = GROUPS.flatMap((g) => g.keys);
  const totalTrades = allKeys.reduce((a, k) => a + snap.series[k].stats.trades, 0);

  return (
    <div className="h-full w-full rounded-lg border border-slate-800 bg-slate-950 flex flex-col overflow-hidden">
      {/* Cabeçalho */}
      <div className="flex items-center justify-between gap-2 px-3 sm:px-4 py-2.5 border-b border-slate-800 bg-slate-900/60 shrink-0 flex-wrap">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="p-1.5 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 shrink-0">
            <Database className="w-4 h-4" />
          </div>
          <div className="flex flex-col min-w-0">
            <span className="text-sm font-bold text-slate-100 leading-tight">
              Coletor de Eficiência — Séries x Escalas Renko
            </span>
            <span className="text-[10px] sm:text-[11px] text-slate-400 leading-tight truncate">
              Mesma estratégia do EA em 6 contadores sombra paralelos | Sessão {snap.date} |{' '}
              {totalTrades} trades registrados
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          {/* Replay de histórico sintético (testar a estratégia em horários diferentes) */}
          {onReplayHistory && (
            <div className="flex items-center gap-1 rounded-lg border border-violet-500/40 bg-violet-500/10 px-1.5 py-1">
              <History className="w-3.5 h-3.5 text-violet-400 shrink-0" />
              <span className="text-[10px] font-bold uppercase tracking-wider text-violet-300 hidden sm:inline">
                {isReplaying ? 'Gerando histórico...' : 'Histórico'}
              </span>
              {[1, 3, 5].map((d) => (
                <button
                  key={d}
                  disabled={isReplaying}
                  onClick={() => onReplayHistory(d)}
                  className={`px-2 py-1 rounded text-xs font-bold transition-colors cursor-pointer ${
                    isReplaying
                      ? 'bg-violet-500/20 text-violet-400/50 cursor-wait'
                      : 'bg-violet-600/60 hover:bg-violet-500 text-white'
                  }`}
                  title={`Gera ${d} dia(s) útil(eis) sintético(s) — sessões 08:55–17:45 com 1 tick a cada 2s — e reproduz nos 6 contadores. Zera o coletor atual. Ordens reais NÃO são afetadas.`}
                >
                  {d}d
                </button>
              ))}
            </div>
          )}
          <button
            onClick={() => seriesCollectorService.exportCsv()}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-emerald-600/90 hover:bg-emerald-500 text-white text-[11px] font-semibold transition-colors cursor-pointer"
            title="Exportar todos os trades sombra e o resumo em CSV (abre no Excel/Numbers)"
          >
            <Download className="w-3.5 h-3.5" />
            Exportar CSV
          </button>
          <button
            onClick={() => {
              if (window.confirm('Zerar o coletor? Os trades sombra de hoje serão apagados da contabilidade paralela (as ordens reais não são tocadas).')) {
                seriesCollectorService.reset();
              }
            }}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-[11px] font-semibold transition-colors cursor-pointer"
            title="Zerar a contabilidade sombra do dia"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Zerar
          </button>
        </div>
      </div>

      {/* Grupos de experimentos (roláveis) */}
      <div className="flex-1 min-h-0 overflow-y-auto px-3 sm:px-4 py-3 space-y-4">
        {GROUPS.map((group) => (
          <section key={group.title}>
            <div className="mb-2">
              <h3 className="text-xs sm:text-sm font-bold text-slate-100 uppercase tracking-wide">{group.title}</h3>
              <p className="text-[10px] sm:text-[11px] text-slate-500">{group.subtitle}</p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5 mb-2.5">
              {group.keys.map((k) => (
                <SeriesCard key={k} k={k} snap={snap} />
              ))}
            </div>
            <GroupChart keys={group.keys} data={chartData} />
          </section>
        ))}
      </div>

      {/* Rodapé explicativo */}
      <div className="px-3 sm:px-4 py-2 border-t border-slate-800/60 shrink-0">
        <p className="text-[10px] text-slate-500 leading-snug">
          Contabilidade 100% interna (paper): entradas no fechamento de cada barra com os mesmos
          parâmetros do EA atual. As escalas 15R/20R/25R são motores de medição paralelos — quem
          dispara ordens reais continua sendo apenas a série ativa no gráfico. O botão
          "Histórico" gera dias úteis sintéticos (08:55–17:45) para testar a estratégia em
          horários diferentes sem esperar o pregão real.
        </p>
      </div>
    </div>
  );
};
