import React, { useSyncExternalStore, useMemo, useState } from 'react';
import { Download, FlaskConical, AlertTriangle, Activity } from 'lucide-react';
import { seriesCollectorService, SERIES_LABEL, CollectorSnapshot } from '../services/seriesCollectorService';
import { SeriesKey, PaperTrade } from '../utils/paperStrategyBot';
import type { SeriesRegimeReading } from '../services/seriesCollectorService';
import type { AutomationConfig } from '../types/trading';

/**
 * Avaliação Técnica — diagnose da base do Coletor de Eficiência
 * ------------------------------------------------------------------
 * Lê o MESMO snapshot em memória do coletor (stats + trades sombra de hoje) e
 * decompõe o resultado por motivo de saída, papel (MAIN x Pirâmide), direção e
 * faixa de horário de entrada — revelando, por exemplo, quanto do resultado é
 * liquidação forçada de fim de pregão ou pernada da abertura.
 *
 * 100% leitura: nada aqui dispara ordem, mexe no MT5 ou cria banco novo.
 * Fonte: localStorage do coletor (sessão do dia; trades além de ~1200 por série
 * continuam nos contadores consolidados, mas saem da lista recortável).
 */

const SERIES_KEYS: SeriesKey[] = ['renko', 'range', 'tempo', 'renko15r', 'renko20r', 'renko25r'];

const EXIT_REASON_LABEL: Record<string, string> = {
  TAKE_PROFIT: 'Alvo (take profit)',
  STOP_LOSS: 'Stop loss',
  BREAKEVEN: 'Breakeven',
  PARTIAL: 'Saída parcial',
  FLIP_REVERSAL: 'Virada de fluxo',
  PYRAMID_TP: 'Alvo da pirâmide',
  PYRAMID_SL: 'Stop da pirâmide',
  DAY_CLOSE: 'Fim de pregão',
};

const fmtR$ = (v: number) =>
  `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const fmtSignedR$ = (v: number) => `${v > 0 ? '+' : ''}${fmtR$(v)}`;

const fmtPF = (pf: number) => (Number.isFinite(pf) ? pf.toFixed(2) : '∞');

interface Agg {
  count: number;
  wins: number;
  losses: number;
  net: number;
  grossWin: number;
  grossLoss: number;
  winRate: number; // % sobre liquidados com resultado ≠ 0
  pf: number;
  expectancy: number; // R$/trade
}

/** Consolida um conjunto de trades fechados em uma linha de métricas. */
function aggregate(trades: PaperTrade[]): Agg {
  const settled = trades.filter((t) => t.exitReason && t.financial !== undefined);
  let wins = 0;
  let losses = 0;
  let net = 0;
  let grossWin = 0;
  let grossLoss = 0;
  for (const t of settled) {
    const f = t.financial ?? 0;
    net += f;
    if (f > 0) {
      wins++;
      grossWin += f;
    } else if (f < 0) {
      losses++;
      grossLoss += -f;
    }
  }
  const decided = wins + losses;
  return {
    count: settled.length,
    wins,
    losses,
    net,
    grossWin,
    grossLoss,
    winRate: decided > 0 ? (wins / decided) * 100 : 0,
    pf: grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Number.POSITIVE_INFINITY : 0,
    expectancy: decided > 0 ? net / decided : 0,
  };
}

function groupBy<T>(items: T[], keyFn: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const it of items) {
    const k = keyFn(it);
    const list = map.get(k);
    if (list) list.push(it);
    else map.set(k, [it]);
  }
  return map;
}

/** Balde de horário de entrada a partir do timestamp do trade. */
function hourBucket(t: PaperTrade): string {
  const h = new Date(t.entryTime).getHours();
  if (h < 9) return 'Antes das 09h';
  if (h === 9) return '09h (abertura)';
  if (h < 12) return `${String(h).padStart(2, '0')}h`;
  if (h < 14) return '12h–13h (almoço)';
  if (h < 16) return `${String(h).padStart(2, '0')}h`;
  if (h === 16) return '16h';
  return '17h+ (fechamento)';
}

// ------------------------------------------------------------------
// Blocos de UI
// ------------------------------------------------------------------

const SectionCard: React.FC<{ title: string; subtitle?: string; children: React.ReactNode }> = ({
  title,
  subtitle,
  children,
}) => (
  <section className="rounded-lg border border-slate-800 bg-slate-900/50 p-3">
    <h3 className="text-xs sm:text-sm font-bold text-slate-100 uppercase tracking-wide">{title}</h3>
    {subtitle && <p className="text-[10px] sm:text-[11px] text-slate-500 mb-2">{subtitle}</p>}
    {children}
  </section>
);

const StatChip: React.FC<{ label: string; value: string; accent?: string }> = ({ label, value, accent }) => (
  <div className="rounded-md border border-slate-800 bg-slate-950/60 px-2.5 py-1.5">
    <div className="text-[9px] uppercase tracking-wider text-slate-500">{label}</div>
    <div className={`text-sm font-bold tabular-nums ${accent ?? 'text-slate-100'}`}>{value}</div>
  </div>
);

const moneyAccent = (v: number) => (v > 0 ? 'text-emerald-400' : v < 0 ? 'text-rose-400' : 'text-slate-100');

interface BreakRow {
  label: string;
  agg: Agg;
}

/** Tabela de recorte (motivo de saída, papel, direção ou horário de entrada). */
const BreakdownTable: React.FC<{ rows: BreakRow[]; empty: string }> = ({ rows, empty }) => {
  if (rows.length === 0) {
    return <p className="text-[11px] text-slate-500 py-2">{empty}</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[11px] sm:text-xs">
        <thead>
          <tr className="text-left text-slate-500 border-b border-slate-800">
            <th className="py-1.5 pr-2 font-semibold">Recorte</th>
            <th className="py-1.5 pr-2 font-semibold text-right">Trades</th>
            <th className="py-1.5 pr-2 font-semibold text-right">Win rate</th>
            <th className="py-1.5 pr-2 font-semibold text-right">Fator lucro</th>
            <th className="py-1.5 pr-2 font-semibold text-right">Líquido</th>
            <th className="py-1.5 font-semibold text-right">Expectativa</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label} className="border-b border-slate-800/50 last:border-0">
              <td className="py-1.5 pr-2 text-slate-300">{r.label}</td>
              <td className="py-1.5 pr-2 text-right tabular-nums text-slate-200">{r.agg.count}</td>
              <td className="py-1.5 pr-2 text-right tabular-nums text-slate-200">
                {r.agg.count > 0 ? `${r.agg.winRate.toFixed(1)}% (${r.agg.wins}/${r.agg.wins + r.agg.losses})` : '—'}
              </td>
              <td className="py-1.5 pr-2 text-right tabular-nums text-slate-200">
                {r.agg.count > 0 ? fmtPF(r.agg.pf) : '—'}
              </td>
              <td className={`py-1.5 pr-2 text-right tabular-nums font-bold ${moneyAccent(r.agg.net)}`}>
                {fmtSignedR$(r.agg.net)}
              </td>
              <td className={`py-1.5 text-right tabular-nums ${moneyAccent(r.agg.expectancy)}`}>
                {r.agg.count > 0 ? fmtSignedR$(r.agg.expectancy) : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

// ------------------------------------------------------------------
// Tela
// ------------------------------------------------------------------

export const TechnicalEvaluationView: React.FC<{
  onReplayHistory?: (days: number) => void;
  isReplaying?: boolean;
  config?: AutomationConfig;
}> = ({ onReplayHistory, isReplaying, config }) => {
  // Re-render a cada barra ingerida pelo coletor (mesma fonte da tela Comparativo)
  useSyncExternalStore(seriesCollectorService.subscribe, seriesCollectorService.getVersion);
  const snap: CollectorSnapshot = seriesCollectorService.getSnapshot();

  // Escopo: 'todas' consolida as 6 séries; senão filtra a série escolhida
  const [scope, setScope] = useState<'todas' | SeriesKey>('todas');

  const trades = useMemo(() => {
    const all =
      scope === 'todas'
        ? SERIES_KEYS.flatMap((k) => snap.series[k].trades.map((t) => ({ ...t, series: k })))
        : snap.series[scope].trades;
    return all.filter((t) => t.exitReason && t.financial !== undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snap.updatedAt, scope]);

  const overall = useMemo(() => aggregate(trades), [trades]);

  // Recortes fixos (saída/papel/direção): ordenação por rótulo canônico
  const byExit = useMemo(() => {
    const g = groupBy(trades, (t) => t.exitReason ?? 'OUTRO');
    const order = Object.keys(EXIT_REASON_LABEL);
    const rows: BreakRow[] = [...g.entries()]
      .sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]))
      .map(([k, list]) => ({ label: EXIT_REASON_LABEL[k] ?? k, agg: aggregate(list) }));
    return rows;
  }, [trades]);

  const byRole = useMemo(() => {
    const g = groupBy(trades, (t) => t.role);
    return [...g.entries()].map(([k, list]) => ({
      label: k === 'MAIN' ? 'Ordem mãe (MAIN)' : 'Pirâmide (PYRAMID)',
      agg: aggregate(list),
    }));
  }, [trades]);

  const byDirection = useMemo(() => {
    const g = groupBy(trades, (t) => t.direction);
    return [...g.entries()].map(([k, list]) => ({
      label: k === 'BUY' ? 'Compra (BUY)' : 'Venda (SELL)',
      agg: aggregate(list),
    }));
  }, [trades]);

  const byHour = useMemo(() => {
    const g = groupBy(trades, (t) => hourBucket(t));
    const order = ['Antes das 09h', '09h (abertura)', '10h', '11h', '12h–13h (almoço)', '14h', '15h', '16h', '17h+ (fechamento)'];
    const rows: BreakRow[] = [...g.entries()]
      .sort((a, b) => {
        const ia = order.indexOf(a[0]);
        const ib = order.indexOf(b[0]);
        return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
      })
      .map(([k, list]) => ({ label: k, agg: aggregate(list) }));
    return rows;
  }, [trades]);

  // ------------------------------------------------------------------
  // Sinais de alerta (diagnóstico honesto da base coletada)
  // ------------------------------------------------------------------
  const alerts = useMemo(() => {
    const list: { tone: 'bad' | 'warn' | 'info'; text: string }[] = [];
    if (overall.count === 0) return list;

    // 1) Fator de lucro EXCLUINDO a liquidação forçada de fim de pregão
    const withoutDayClose = aggregate(trades.filter((t) => t.exitReason !== 'DAY_CLOSE'));
    if (withoutDayClose.count > 0 && withoutDayClose.pf < 1) {
      list.push({
        tone: 'bad',
        text: `Sem as liquidações de fim de pregão, o fator de lucro cai para ${fmtPF(withoutDayClose.pf)} (< 1.00): a estratégia perde dinheiro no próprio jogo.`,
      });
    } else if (withoutDayClose.count > 0) {
      list.push({
        tone: 'info',
        text: `Fator de lucro excluindo "fim de pregão": ${fmtPF(withoutDayClose.pf)} (líquido ${fmtSignedR$(withoutDayClose.net)} em ${withoutDayClose.count} trades).`,
      });
    }

    // 2) Concentração de perdas na abertura (09h)
    const lossesTotal = overall.grossLoss;
    const openingLosses = aggregate(trades.filter((t) => new Date(t.entryTime).getHours() === 9)).grossLoss;
    if (lossesTotal > 0 && openingLosses / lossesTotal >= 0.3) {
      list.push({
        tone: 'bad',
        text: `${((openingLosses / lossesTotal) * 100).toFixed(0)}% de toda a perda bruta vem de entradas no 1º horário (09h) — suspeite de sinal disparado em cima do gap/pernada de abertura.`,
      });
    }

    // 3) Participação do DAY_CLOSE no resultado
    const dayCloseNet = aggregate(trades.filter((t) => t.exitReason === 'DAY_CLOSE')).net;
    if (Math.abs(dayCloseNet) > 0 && overall.net !== 0 && Math.abs(dayCloseNet) >= Math.abs(overall.net) * 0.5) {
      list.push({
        tone: 'warn',
        text: `As saídas forçadas de fim de pregão movimentaram ${fmtSignedR$(dayCloseNet)} — mais da metade do resultado líquido da base.`,
      });
    }

    // 4) Séries com win rate baixo (mínimo de 10 trades liquidados para não falar de ruído)
    SERIES_KEYS.forEach((k) => {
      const s = snap.series[k].stats;
      if (s.settled >= 10 && s.winRate < 40) {
        list.push({
          tone: 'warn',
          text: `${SERIES_LABEL[k]}: win rate de ${s.winRate.toFixed(1)}% em ${s.settled} trades liquidados — abaixo de 40%.`,
        });
      }
    });

    if (list.length === 0) {
      list.push({ tone: 'info', text: 'Nenhum sinal de alerta crítico na base atual. Continue coletando para aumentar a amostra.' });
    }
    return list;
  }, [trades, overall, snap.updatedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  const allTradesCount = SERIES_KEYS.reduce((a, k) => a + snap.series[k].stats.trades, 0);

  // Regime do mercado: leitura do medidor da série em foco ('todas' mostra Renko, a série viva clássica)
  const regimeSeries: SeriesKey = scope === 'todas' ? 'renko' : scope;
  const regime: SeriesRegimeReading | null = useMemo(
    () => seriesCollectorService.getRegimeReading(regimeSeries, config?.minDeltaThreshold ?? 100),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [regimeSeries, snap.updatedAt, config?.minDeltaThreshold]
  );

  return (
    <div className="h-full w-full rounded-lg border border-slate-800 bg-slate-950 flex flex-col overflow-hidden">
      {/* Cabeçalho */}
      <div className="flex items-center justify-between gap-2 px-3 sm:px-4 py-2.5 border-b border-slate-800 bg-slate-900/60 shrink-0 flex-wrap">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="p-1.5 rounded-lg bg-sky-500/15 border border-sky-500/30 text-sky-400 shrink-0">
            <FlaskConical className="w-4 h-4" />
          </div>
          <div className="flex flex-col min-w-0">
            <span className="text-sm font-bold text-slate-100 leading-tight">Avaliação Técnica do Coletor</span>
            <span className="text-[10px] sm:text-[11px] text-slate-400 leading-tight truncate">
              Diagnóstico da base sombra de {snap.date} | {allTradesCount} trades registrados nas 6 séries
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          {onReplayHistory && (
            <div className="flex items-center gap-1 rounded-lg border border-violet-500/40 bg-violet-500/10 px-1.5 py-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-violet-300 hidden sm:inline">
                {isReplaying ? 'Gerando histórico...' : 'Regerar base'}
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
                  title={`Roda ${d} dia(s) (+1 dia anterior de contexto) nos 6 contadores sombra e reconstrói esta base do zero. Zera o coletor atual. Ordens reais NÃO são afetadas.`}
                >
                  {d}d
                </button>
              ))}
            </div>
          )}
          <button
            onClick={() => seriesCollectorService.exportCsv()}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-emerald-600/90 hover:bg-emerald-500 text-white text-[11px] font-semibold transition-colors cursor-pointer"
            title="Exportar todos os trades sombra e o resumo em CSV no padrão B3 (UTF-8 com BOM, separador ';')"
          >
            <Download className="w-3.5 h-3.5" />
            Exportar CSV
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-3 sm:px-4 py-3 space-y-3">
        {/* Seletor de escopo: consolidado ou série única */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {(['todas', ...SERIES_KEYS] as const).map((k) => (
            <button
              key={k}
              onClick={() => setScope(k)}
              className={`px-2.5 py-1 rounded-md text-[11px] font-semibold border transition-colors cursor-pointer ${
                scope === k
                  ? 'border-sky-500/60 bg-sky-500/15 text-sky-300'
                  : 'border-slate-800 bg-slate-900/60 text-slate-400 hover:text-slate-200'
              }`}
            >
              {k === 'todas' ? 'Todas as séries' : SERIES_LABEL[k]}
            </button>
          ))}
        </div>

        {/* Visão geral consolidada */}
        <SectionCard
          title="Visão Geral"
          subtitle={
            scope === 'todas'
              ? 'Consolidado das 6 séries sombra (recortes calculados sobre a lista de trades de hoje)'
              : `Recorte apenas sobre a série ${SERIES_LABEL[scope as SeriesKey]}`
          }
        >
          {overall.count === 0 ? (
            <p className="text-[11px] text-slate-500 py-2">
              Nenhum trade fechado nesta base ainda. Rode um replay (botão acima) ou aguarde o coletor registrar liquidações.
            </p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2">
              <StatChip label="Trades fechados" value={String(overall.count)} />
              <StatChip label="Win rate" value={`${overall.winRate.toFixed(1)}%`} />
              <StatChip label="Fator de lucro" value={fmtPF(overall.pf)} accent={overall.pf >= 1 ? 'text-emerald-400' : 'text-rose-400'} />
              <StatChip label="Expectativa" value={fmtSignedR$(overall.expectancy)} accent={moneyAccent(overall.expectancy)} />
              <StatChip label="Líquido" value={fmtSignedR$(overall.net)} accent={moneyAccent(overall.net)} />
              <StatChip label="Maior ganho / perda" value={`${fmtR$(Math.max(...trades.map((t) => t.financial ?? 0), 0))} / ${fmtR$(Math.min(...trades.map((t) => t.financial ?? 0), 0))}`} />
            </div>
          )}
        </SectionCard>

        {/* Por série: usa os contadores consolidados (não truncam com o limite da lista) */}
        <SectionCard title="Por Série" subtitle="Contadores contínuos do coletor (incluem liquidações antigas da sessão)">
          <div className="overflow-x-auto">
            <table className="w-full text-[11px] sm:text-xs">
              <thead>
                <tr className="text-left text-slate-500 border-b border-slate-800">
                  <th className="py-1.5 pr-2 font-semibold">Série</th>
                  <th className="py-1.5 pr-2 font-semibold text-right">Liquidados</th>
                  <th className="py-1.5 pr-2 font-semibold text-right">Win rate</th>
                  <th className="py-1.5 pr-2 font-semibold text-right">Fator lucro</th>
                  <th className="py-1.5 pr-2 font-semibold text-right">Expectativa</th>
                  <th className="py-1.5 pr-2 font-semibold text-right">Líquido</th>
                  <th className="py-1.5 font-semibold text-right">Máx. rebaixamento</th>
                </tr>
              </thead>
              <tbody>
                {SERIES_KEYS.map((k) => {
                  const s = snap.series[k].stats;
                  return (
                    <tr key={k} className="border-b border-slate-800/50 last:border-0">
                      <td className="py-1.5 pr-2 text-slate-300">{SERIES_LABEL[k]}</td>
                      <td className="py-1.5 pr-2 text-right tabular-nums text-slate-200">{s.trades}</td>
                      <td className="py-1.5 pr-2 text-right tabular-nums text-slate-200">
                        {s.settled > 0 ? `${s.winRate.toFixed(1)}%` : '—'}
                      </td>
                      <td className="py-1.5 pr-2 text-right tabular-nums text-slate-200">
                        {s.settled > 0 ? fmtPF(s.profitFactor) : '—'}
                      </td>
                      <td className={`py-1.5 pr-2 text-right tabular-nums ${moneyAccent(s.expectancy)}`}>
                        {s.settled > 0 ? fmtSignedR$(s.expectancy) : '—'}
                      </td>
                      <td className={`py-1.5 pr-2 text-right tabular-nums font-bold ${moneyAccent(s.totalFinancial)}`}>
                        {fmtSignedR$(s.totalFinancial)}
                      </td>
                      <td className={`py-1.5 text-right tabular-nums ${s.maxDrawdown > 0 ? 'text-amber-400' : 'text-slate-400'}`}>
                        {s.maxDrawdown > 0 ? fmtR$(s.maxDrawdown) : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </SectionCard>

        {/* Recortes */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <SectionCard
            title="Por Motivo de Saída"
            subtitle="Quanto do resultado vem de alvo, stop, breakeven... ou liquidação forçada de fim de pregão"
          >
            <BreakdownTable rows={byExit} empty="Sem trades fechados neste escopo." />
          </SectionCard>
          <SectionCard title="Por Faixa de Horário de Entrada" subtitle="Destaca o peso dos primeiros minutos após a abertura (gap/pernada)">
            <BreakdownTable rows={byHour} empty="Sem trades fechados neste escopo." />
          </SectionCard>
          <SectionCard title="Por Papel" subtitle="Ordem mãe (MAIN) x pirâmide (PYRAMID)">
            <BreakdownTable rows={byRole} empty="Sem trades fechados neste escopo." />
          </SectionCard>
          <SectionCard title="Por Direção" subtitle="Compra x venda na mesma base">
            <BreakdownTable rows={byDirection} empty="Sem trades fechados neste escopo." />
          </SectionCard>
        </div>

        {/* Regime do Mercado — a prova da assimetria intradiária (medição sempre ativa) */}
        <SectionCard
          title="Regime do Mercado"
          subtitle={`Medidor da série ${SERIES_LABEL[regimeSeries]}: fator = volume dos últimos ${config?.regimeLookbackBoxes ?? 20} boxes ÷ média do dia (0,5x–3x)${
            config && !config.adaptiveThresholdEnabled ? ' — gate adaptativo DESLIGADO: medindo sem filtrar sinais' : ''
          }`}
        >
          {!regime || regime.hourStats.length === 0 ? (
            <p className="text-[11px] text-slate-500 py-2">
              O medidor ainda não fechou boxes nesta sessão nesta série. Rode um replay para popular.
            </p>
          ) : (
            <div className="space-y-3">
              {/* Fator médio por hora — a curva em U */}
              <div className="grid grid-cols-4 sm:grid-cols-8 gap-1.5">
                {regime.hourStats.map((h) => {
                  const hot = h.meanFactor >= 1.4;
                  const cold = h.meanFactor <= 0.75;
                  return (
                    <div
                      key={h.hour}
                      className={`rounded-md border px-1.5 py-1.5 text-center ${
                        hot
                          ? 'border-rose-500/40 bg-rose-500/10'
                          : cold
                          ? 'border-sky-500/40 bg-sky-500/10'
                          : 'border-slate-800 bg-slate-950/60'
                      }`}
                      title={`${h.boxes} boxes fechados nesta hora`}
                    >
                      <div className="text-[9px] uppercase tracking-wider text-slate-500">{String(h.hour).padStart(2, '0')}h</div>
                      <div className={`text-sm font-bold tabular-nums ${hot ? 'text-rose-300' : cold ? 'text-sky-300' : 'text-slate-200'}`}>
                        {h.meanFactor.toFixed(2)}x
                      </div>
                      <div className="text-[9px] text-slate-500 tabular-nums">{h.boxes} boxes</div>
                    </div>
                  );
                })}
              </div>

              {/* Fixo x Adaptativo por hora + assimetria direcional */}
              <div className="overflow-x-auto">
                <table className="w-full text-[11px] sm:text-xs">
                  <thead>
                    <tr className="text-left text-slate-500 border-b border-slate-800">
                      <th className="py-1.5 pr-2 font-semibold">Hora</th>
                      <th className="py-1.5 pr-2 font-semibold text-right">Fator médio</th>
                      <th className="py-1.5 pr-2 font-semibold text-right">Passariam no FIXO</th>
                      <th className="py-1.5 pr-2 font-semibold text-right">Passariam no ADAPTATIVO</th>
                      <th className="py-1.5 pr-2 font-semibold text-right">Δ médio compra</th>
                      <th className="py-1.5 font-semibold text-right">Δ médio venda</th>
                    </tr>
                  </thead>
                  <tbody>
                    {regime.hourStats.map((h) => (
                      <tr key={h.hour} className="border-b border-slate-800/50 last:border-0">
                        <td className="py-1.5 pr-2 text-slate-300">{String(h.hour).padStart(2, '0')}h</td>
                        <td className="py-1.5 pr-2 text-right tabular-nums text-slate-200">{h.meanFactor.toFixed(2)}x</td>
                        <td className="py-1.5 pr-2 text-right tabular-nums text-slate-200">
                          {h.strongFixed}/{h.boxes}
                        </td>
                        <td
                          className={`py-1.5 pr-2 text-right tabular-nums font-bold ${
                            h.strongAdaptive < h.strongFixed ? 'text-amber-400' : 'text-slate-200'
                          }`}
                        >
                          {h.strongAdaptive}/{h.boxes}
                        </td>
                        <td className="py-1.5 pr-2 text-right tabular-nums text-emerald-400/80">
                          {h.posDeltaMean > 0 ? h.posDeltaMean.toFixed(0) : '—'}
                        </td>
                        <td className="py-1.5 text-right tabular-nums text-rose-400/80">
                          {h.negDeltaMean > 0 ? h.negDeltaMean.toFixed(0) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Fatores correntes */}
              <div className="flex items-center gap-1.5 flex-wrap text-[11px] text-slate-400">
                <Activity className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                <span>
                  Agora: volume{' '}
                  <b className="text-slate-200 tabular-nums">{regime.currentFactor.toFixed(2)}x</b> · pressão compra{' '}
                  <b className="text-emerald-400 tabular-nums">{regime.directional.buy.toFixed(2)}x</b> · pressão venda{' '}
                  <b className="text-rose-400 tabular-nums">{regime.directional.sell.toFixed(2)}x</b>
                  {!regime.warmedUp && <span className="text-amber-400"> (medidor em aquecimento — limiar fixo até 20 boxes)</span>}
                </span>
              </div>
              <p className="text-[10px] text-slate-500 leading-snug">
                Leitura: nas horas quentes o limiar efetivo sobe (exige agressão proporcional ao momento); nas
                horas frias, desce — o jogo fica simétrico em relação à assimetria natural do pregão.
                &quot;Passariam&quot; compara quantos boxes de cada hora superariam o Delta Mínimo fixo ({config?.minDeltaThreshold ?? 100})
                contra o fixo × fator da hora.
              </p>
            </div>
          )}
        </SectionCard>

        {/* Sinais de alerta */}
        <SectionCard title="Sinais de Alerta" subtitle="Leitura honesta da base — o que merece atenção antes de confiar nos números">
          <ul className="space-y-1.5">
            {alerts.map((a, i) => (
              <li
                key={i}
                className={`flex items-start gap-2 text-[11px] sm:text-xs rounded-md px-2.5 py-1.5 border ${
                  a.tone === 'bad'
                    ? 'border-rose-500/40 bg-rose-500/10 text-rose-300'
                    : a.tone === 'warn'
                    ? 'border-amber-500/40 bg-amber-500/10 text-amber-300'
                    : 'border-slate-700 bg-slate-800/40 text-slate-300'
                }`}
              >
                <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                <span>{a.text}</span>
              </li>
            ))}
          </ul>
        </SectionCard>
      </div>

      {/* Rodapé explicativo */}
      <div className="px-3 sm:px-4 py-2 border-t border-slate-800/60 shrink-0">
        <p className="text-[10px] text-slate-500 leading-snug">
          Base: contabilidade sombra do dia em curso (localStorage do coletor — a lista de trades
          recortável guarda as últimas ~1200 liquidações por série; os contadores da tabela
          "Por Série" são contínuos). Enquanto o feed for sintético, estes números medem o
          simulador, não o mercado real — use-os para validar regras (gap, horários, motivos de
          saída), não como previsão. Nada nesta aba envia ordens.
        </p>
      </div>
    </div>
  );
};
