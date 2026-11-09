import React, { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import type { AutomationConfig } from '../types/trading';
import type { FunnelMetricsSnapshot, SideFunnelMetric } from '../utils/funnelMetrics';

/**
 * FAIXA DO FUNIL — o limiar CALCULADO do pregão, exposto PARA AJUSTAR.
 *
 * Nascida como leitura ("gostaria de ter estes dados para avaliação"), virou bancada de
 * afinação: as alavancas do funil (Delta físico, Percentil, Piso e Divergência) são editáveis
 * aqui, no espaço livre abaixo do gráfico. Cada mudança passa pelo MESMO funil da boleta
 * (`patchActiveStrategy` → `updateStrategyConfig`), então persiste na estratégia ativa (regra 15:
 * `SavedStrategy` é o banco único) e o motor lê o config a cada box — vale já nos próximos boxes.
 *
 * Chrome neutro, cor só no acento e no sinal (regra 6): o verde/vermelho marca PASSOU/NÃO PASSOU
 * do box atual; o azul é só o estado AUTO ligado e as alavancas. Recolhe e guarda a preferência.
 *
 * Sem `onPatchConfig` (ex.: embutido fora do App), a faixa volta a ser só leitura — nunca edita a
 * seco sem destino.
 */

const STORAGE_KEY_OPEN = 'fluxo_funnel_band_open_v1';

const int = (v: number | null | undefined): string =>
  v == null || !Number.isFinite(v) ? '—' : Math.round(v).toLocaleString('pt-BR');

const pct = (frac: number | null | undefined): string =>
  frac == null || !Number.isFinite(frac) ? '—' : `${Math.round(frac * 100)}%`;

/** 1,3 vira "1,3" no padrão BR (sem colar vírgula onde falta decimal). */
const dec = (v: number, digits = 1): string =>
  v.toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits });

const sideTitle = (label: string, s: SideFunnelMetric, mode: 'auto' | 'fixo'): string => {
  if (mode === 'fixo') return `${label}: limiar físico ${int(s.limit)} ctros (adaptativo desligado).`;
  const origem =
    s.source === 'piso'
      ? `piso (${int(s.floorValue)}) venceu o percentil (${int(s.percentileValue)})`
      : s.source === 'percentil'
      ? `percentil (${int(s.percentileValue)}) venceu o piso (${int(s.floorValue)})`
      : `sem estatística ainda — caiu no físico (${int(s.limit)})`;
  return (
    `${label}: corte = ${int(s.limit)} ctros · ${origem}\n` +
    `média de agressão do lado no dia: ${int(s.dayMean)} ctros em ${s.dayCount} boxes\n` +
    `amostras na janela do percentil: ${s.samples}`
  );
};

interface FunnelMetricsPanelProps {
  metrics: FunnelMetricsSnapshot;
  /** Escrita pelo funil da estratégia ativa (App: `patchActiveStrategy`). Ausente = só leitura. */
  onPatchConfig?: (patch: Partial<AutomationConfig>) => void;
  /** Conteúdo extra na linha-resumo (ex.: seletor de indicadores do gráfico). */
  leading?: React.ReactNode;
}

export const FunnelMetricsPanel: React.FC<FunnelMetricsPanelProps> = ({ metrics, onPatchConfig, leading }) => {
  const [open, setOpen] = useState<boolean>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_OPEN);
      return raw === null ? true : raw === 'true';
    } catch {
      return true;
    }
  });
  const toggle = () => {
    const next = !open;
    setOpen(next);
    try {
      localStorage.setItem(STORAGE_KEY_OPEN, String(next));
    } catch {
      /* ignora storage */
    }
  };

  const cur = metrics.current;
  const auto = metrics.mode === 'auto';
  const passes = cur ? cur.passesDelta && cur.passesDivergence : null;
  const canPatch = !!onPatchConfig;
  const isPyramid = metrics.strategy === 'PYRAMID';

  const chip = 'inline-flex items-center gap-1 rounded px-1.5 h-[18px] border text-[10px] font-mono tabular-nums';

  return (
    <div className="shrink-0 bg-zinc-900/95 border-t border-zinc-800 font-mono">
      {/* Linha-resumo: sempre visível. */}
      <div className="flex items-center gap-2 px-2.5 sm:px-4 h-7 text-[10px] text-zinc-400 overflow-x-auto">
        <button
          onClick={toggle}
          className="flex items-center gap-1 shrink-0 cursor-pointer text-zinc-300 hover:text-white"
          title={open ? 'Recolher o retrato e as alavancas do funil' : 'Expandir retrato e alavancas do funil'}
          aria-expanded={open}
        >
          <span className="text-[9px] font-sans font-bold uppercase tracking-wider text-zinc-400">Funil</span>
          {open ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />}
        </button>

        {leading}

        {/* Modo: AUTO é o estado "ligado" (acentos azul); FIXO some no chrome. */}
        <span
          className={`${chip} shrink-0 ${
            auto
              ? 'bg-sky-500/15 border-sky-500/40 text-sky-300'
              : 'bg-zinc-950/60 border-zinc-700/70 text-zinc-400'
          }`}
          title={
            auto
              ? `Limiar AUTO-CALIBRADO do pregão: maior entre o percentil P${Math.round(
                  metrics.percentile * 100
                )} da janela e o piso ${dec(metrics.floorMultiple)}× a média do dia. Zera na virada de pregão.`
              : 'Limiar FÍSICO fixo (adaptativo desligado): ' + int(metrics.baseThreshold) + ' ctros.'
          }
        >
          {auto ? 'AUTO-CALIBRADO' : 'FIXO'}
        </span>

        <span className="shrink-0 text-zinc-500">{isPyramid ? 'Pirâmide' : 'Reteste'}</span>

        {/* Corte de cada lado. */}
        <span className={`${chip} shrink-0 text-emerald-300`} title={sideTitle('Compra', metrics.buy, metrics.mode)}>
          C ≥{int(metrics.buy.limit)}
          {auto && (
            <span className="text-emerald-400/70">
              ·{metrics.buy.source === 'piso' ? 'piso' : metrics.buy.source === 'percentil' ? 'P' + Math.round(metrics.percentile * 100) : 'fís'}
            </span>
          )}
        </span>
        <span className={`${chip} shrink-0 text-rose-300`} title={sideTitle('Venda', metrics.sell, metrics.mode)}>
          V ≥{int(metrics.sell.limit)}
          {auto && (
            <span className="text-rose-400/70">
              ·{metrics.sell.source === 'piso' ? 'piso' : metrics.sell.source === 'percentil' ? 'P' + Math.round(metrics.percentile * 100) : 'fís'}
            </span>
          )}
        </span>

        {metrics.divergenceMin !== undefined && (
          <span
            className={`${chip} shrink-0 text-zinc-300`}
            title={`Divergência de fluxo mínima: só vale box com |Δ| ≥ ${pct(metrics.divergenceMin)} do volume do tijolo (escala-free).`}
          >
            div ≥{pct(metrics.divergenceMin)}
          </span>
        )}

        <span className="ml-auto shrink-0 flex items-center gap-2">
          <span className="text-zinc-500" title={`Boxes no pregão: ${metrics.boxesToday} | Janela de cálculo móvel: últimos ${metrics.lookbackBoxes ?? 20} boxes fechados.`}>
            {metrics.boxesToday} boxes (janela {metrics.lookbackBoxes ?? 20}b){!metrics.warmed ? ' · aquecendo' : ''}
          </span>
          {cur ? (
            <span
              className={`${chip} ${
                passes
                  ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                  : 'bg-rose-500/15 border-rose-500/40 text-rose-300'
              }`}
              title={
                `Último box fechado #${cur.index} (${cur.direction === 'UP' ? 'alta ▲' : 'baixa ▼'})\n` +
                `Δ ${cur.delta > 0 ? '+' : ''}${int(cur.delta)} ctros vs. corte ${int(cur.limit)} → ${cur.passesDelta ? 'PASSA no Δ' : 'FALHA no Δ'}\n` +
                `divergência ${pct(cur.divergence)}${cur.divergenceMin != null ? ` (mín ${pct(cur.divergenceMin)}) → ${cur.passesDivergence ? 'PASSA' : 'FALHA'}` : ' (filtro desligado)'}\n` +
                `volume do box ${int(cur.totalVolume)} ctros`
              }
            >
              <span>{cur.direction === 'UP' ? '▲' : '▼'}</span>
              <span>#{cur.index}</span>
              <span>Δ{cur.delta > 0 ? '+' : ''}{int(cur.delta)}</span>
              <span className="font-bold">{passes ? '✓' : '✕'}</span>
            </span>
          ) : (
            <span className={`${chip} text-zinc-500`}>sem box fechado</span>
          )}
        </span>
      </div>

      {/* Detalhe expandido: ALAVANCAS + retrato de onde veio cada corte. */}
      {open && (
        <div className="px-2.5 sm:px-4 pb-2.5">
          {/* Interruptor AUTO/FIXO + alavancas. */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 py-1.5 border-b border-zinc-800/70">
            <label
              className="flex items-center gap-1.5 cursor-pointer select-none shrink-0"
              title={
                canPatch
                  ? 'AUTO = o corte é calculado do próprio pregão (percentil + piso). FIXO = usa só o Delta físico.'
                  : 'Só leitura nesta tela.'
              }
            >
              <input
                type="checkbox"
                className="accent-sky-400 w-3.5 h-3.5"
                checked={auto}
                disabled={!canPatch}
                onChange={(e) => onPatchConfig?.({ adaptiveThresholdEnabled: e.target.checked })}
              />
              <span className={`text-[10px] font-sans uppercase tracking-wide ${auto ? 'text-sky-300' : 'text-zinc-500'}`}>
                Auto-calibrado
              </span>
            </label>

            <FunnelSlider
              label="Delta físico"
              value={metrics.baseThreshold}
              display={`${int(metrics.baseThreshold)} ct`}
              min={0}
              max={500}
              step={10}
              unit="Δ"
              disabled={!canPatch}
              onChange={(v) => onPatchConfig?.({ minDeltaThreshold: v })}
              hint="Piso físico do corte e limiar quando AUTO está desligado. Também aquece os primeiros boxes (antes de haver estatística do dia). Subir = mais seletivo; descer = mais sinais."
            />

            <FunnelSlider
              label="Percentil"
              value={Math.round(metrics.percentile * 100)}
              display={`P${Math.round(metrics.percentile * 100)}`}
              min={50}
              max={90}
              step={5}
              unit="P"
              disabled={!canPatch || !auto}
              onChange={(v) => onPatchConfig?.({ adaptiveThresholdPercentile: v / 100 })}
              hint="P da agressão do próprio dia. P60 = os 40% boxes mais agressivos deste lado sinalizam. Subir (P70/P80) deixa só as viradas fortes passarem: menos trades, PF maior."
            />

            <FunnelSlider
              label="Piso"
              value={Math.round(metrics.floorMultiple * 10)}
              display={`${dec(metrics.floorMultiple)}× média`}
              min={10}
              max={25}
              step={1}
              unit="×"
              disabled={!canPatch || !auto}
              onChange={(v) => onPatchConfig?.({ adaptiveFloorMultiple: v / 10 })}
              hint="Multiplicador da média de agressão do DIA (piso relativo). Dia morto não afrouxa o funil: sobe o piso e o box lateral para de sinalizar. Subir = mais exigente."
            />

            <FunnelSlider
              label="Janela"
              value={metrics.lookbackBoxes ?? 20}
              display={`${metrics.lookbackBoxes ?? 20} boxes`}
              min={5}
              max={60}
              step={5}
              unit="bx"
              disabled={!canPatch || !auto}
              onChange={(v) => onPatchConfig?.({ regimeLookbackBoxes: v })}
              hint="Número de boxes recentes da janela rolante. A cada bloco fechado o limiar recalcula automaticamente com base nesta quantidade de blocos."
            />

            {isPyramid && (
              <FunnelSlider
                label="Divergência"
                value={Math.round((metrics.divergenceMin ?? 0) * 100)}
                display={`${pct(metrics.divergenceMin ?? 0)}`}
                min={0}
                max={60}
                step={5}
                unit="div"
                disabled={!canPatch}
                onChange={(v) => onPatchConfig?.({ flowDivergenceMin: v / 100 })}
                hint="Fração mínima do volume que precisa ser agressão LÍQUIDA (|Δ| ÷ volume). Escala-free: sobrevive a mudança de volatilidade. 0 desliga; 40% exige convicção no box."
              />
            )}
          </div>

          {/* Como ler: direciona o iniciante sem esconder o trade-off honesto. */}
          <p className="text-[9.5px] text-zinc-500 leading-tight py-1.5">
            {canPatch ? (
              <>
                <span className="text-zinc-400 font-semibold">Ajuste ao vivo</span> — vale já nos próximos boxes e fica salvo na estratégia ativa.{' '}
                <span className="text-emerald-400/80">↑ Percentil / Piso / Divergência = mais seletivo</span> (menos trades, PF maior);{' '}
                <span className="text-rose-400/80">↓ = mais sinais</span>. A afinação definitiva é no bench headless, mas aqui você sente o corte mudar.
              </>
            ) : (
              <>Só leitura nesta tela (sem destino de escrita configurado).</>
            )}
          </p>

          {/* Retrato: de onde veio cada corte (recalcula assim que você mexe nas alavancas). */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-0.5 pt-1 text-[10px] leading-tight">
            <DetailRow label="COMPRA" s={metrics.buy} auto={auto} pct={metrics.percentile} tone="text-emerald-300" />
            <DetailRow label="VENDA" s={metrics.sell} auto={auto} pct={metrics.percentile} tone="text-rose-300" />
          </div>
        </div>
      )}
    </div>
  );
};

/**
 * Alavanca da faixa: rótulo + botões (−/+) + slider + valor atual. `value` é a grandeza do SLIDER (inteiro ou
 * escalado); `onChange` recebe o mesmo número do slider — quem converte de volta é o chamador.
 */
const FunnelSlider: React.FC<{
  label: string;
  value: number;
  display: string;
  min: number;
  max: number;
  step: number;
  unit: string;
  onChange: (v: number) => void;
  disabled?: boolean;
  hint: string;
}> = ({ label, value, display, min, max, step, disabled, onChange, hint }) => {
  const handleDec = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!disabled) {
      onChange(Math.max(min, Number((value - step).toFixed(2))));
    }
  };

  const handleInc = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!disabled) {
      onChange(Math.min(max, Number((value + step).toFixed(2))));
    }
  };

  return (
    <div
      className={`flex items-center gap-1 select-none ${disabled ? 'opacity-40' : ''}`}
      title={hint}
    >
      <span className="text-[9px] font-sans uppercase tracking-wide text-zinc-500 shrink-0">{label}</span>
      <button
        type="button"
        disabled={disabled || value <= min}
        onClick={handleDec}
        className="w-4 h-4 flex items-center justify-center rounded bg-zinc-800 text-[10px] font-bold text-zinc-300 hover:bg-zinc-700 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer transition-colors"
        title={`Diminuir ${label}`}
      >
        −
      </button>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-14 sm:w-16 h-1 accent-sky-400 cursor-pointer disabled:cursor-default"
      />
      <button
        type="button"
        disabled={disabled || value >= max}
        onClick={handleInc}
        className="w-4 h-4 flex items-center justify-center rounded bg-zinc-800 text-[10px] font-bold text-zinc-300 hover:bg-zinc-700 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer transition-colors"
        title={`Aumentar ${label}`}
      >
        +
      </button>
      <span className="text-[10px] font-semibold text-zinc-200 tabular-nums shrink-0 min-w-[56px] text-right">{display}</span>
    </div>
  );
};

const DetailRow: React.FC<{
  label: string;
  s: SideFunnelMetric;
  auto: boolean;
  pct: number;
  tone: string;
}> = ({ label, s, auto, pct: percentile, tone }) => {
  const cell = 'text-zinc-500';
  const val = 'text-zinc-200';
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
      <span className={`font-bold uppercase tracking-wide ${tone}`}>{label}</span>
      <span className={cell}>corte</span>
      <span className={`${val} font-semibold`}>{int(s.limit)}</span>
      {auto ? (
        <>
          <span className={cell}>· P{Math.round(percentile * 100)}</span>
          <span className={val}>{int(s.percentileValue)}</span>
          <span className={cell}>· piso {int(s.floorValue)}</span>
          <span className={cell}>← média dia {int(s.dayMean)} × {s.source === 'piso' ? 'venceu' : 'não'}</span>
          <span className={cell}>(dia {s.dayCount} · janela {s.samples})</span>
        </>
      ) : (
        <span className={cell}>· físico (adaptativo OFF)</span>
      )}
    </div>
  );
};
