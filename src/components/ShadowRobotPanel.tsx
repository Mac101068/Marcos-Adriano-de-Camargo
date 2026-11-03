import React, { useRef, useSyncExternalStore } from 'react';
import { Download, RotateCcw } from 'lucide-react';
import type { AutomationConfig, ShadowRobotConfig, ShadowScaleR } from '../types/trading';
import { SHADOW_SCALE_CHOICES } from '../services/eaConfigService';
import { shadowRobotService, SHADOW_LABEL } from '../services/shadowRobotService';
import { StrategyLibraryService } from '../services/strategyLibraryService';

/**
 * ROBÔ 2 (SOMBRA) — painel de corrida.
 * Mora na janela flutuante do gráfico e no bloco de Parâmetros (mesma grade, mesmo conteúdo).
 *
 * É leitura + escolha: as métricas vêm do `shadowRobotService` e as escolhas viram um patch do
 * `config.shadowRobot`, que o App persiste. O painel NÃO tem qualquer caminho para ordem real —
 * ligar/desligar aqui liga/desliga um robô de papel. A ponte já separa robôs por magic
 * (Fase 2 multi-robô), mas a sombra segue sem placa própria DE PROPÓSITO: virar real é decisão
 * explícita do operador, não um refactor.
 */

interface ShadowRobotPanelProps {
  /** Patch no config do EA (o App persiste via EaConfigService). Ausente = painel só leitura. */
  onPatchConfig?: (patch: Partial<AutomationConfig>) => void;
  /** 'window' = janela flutuante do gráfico (estreita); 'page' = bloco dos Parâmetros. */
  variant?: 'window' | 'page';
}

const fmtBRL = (v: number) =>
  `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const pnlColor = (v: number) => (v > 0 ? 'text-emerald-400' : v < 0 ? 'text-rose-400' : 'text-slate-100');

const Line: React.FC<{ label: string; value: string; accent?: string }> = ({ label, value, accent }) => (
  <div className="flex items-center justify-between gap-2 py-[3px] border-b border-slate-800/60 last:border-0">
    <span className="text-slate-400">{label}</span>
    <span className={`font-bold tabular-nums ${accent ?? 'text-slate-100'}`}>{value}</span>
  </div>
);

export const ShadowRobotPanel: React.FC<ShadowRobotPanelProps> = ({ onPatchConfig, variant = 'window' }) => {
  // Padrão do coletor: o número da versão é o snapshot estável; a leitura viva sai do service
  const version = useSyncExternalStore(shadowRobotService.subscribe, shadowRobotService.getVersion);
  const cacheRef = useRef<{ v: number; snap: ReturnType<typeof shadowRobotService.getSnapshot> } | null>(null);
  if (!cacheRef.current || cacheRef.current.v !== version) {
    cacheRef.current = { v: version, snap: shadowRobotService.getSnapshot() };
  }
  const snap = cacheRef.current.snap;
  const strategies = StrategyLibraryService.list();
  const { run, stats } = snap;
  // Conflito estruturado (Ciclo 12): estratégia apagada da biblioteca enquanto a sombra ainda
  // aponta para ela. Em vez de nome "fixado" e select mudo, o painel assume o estado órfão:
  // linha Estratégia marca "(removida)", a caixinha mostra a opção fantasma e Ligar não reusa
  // id quebrado — cai na última salva válida.
  const staleStrategyId = !!run.strategyId && !strategies.some((s) => s.id === run.strategyId);
  const patch = (p: Partial<ShadowRobotConfig>) => {
    if (!onPatchConfig) return;
    const current: ShadowRobotConfig = {
      enabled: run.enabled,
      strategyId: run.strategyId,
      scaleR: run.scaleR,
      ...p,
    };
    onPatchConfig({ shadowRobot: current });
  };

  return (
    <div className={`flex-1 min-h-0 overflow-y-auto ${variant === 'window' ? 'px-2.5 py-2 text-[11px]' : 'text-xs'}`}>
      {/* Identidade da corrida */}
      <div className="flex items-center gap-1.5 mb-1.5">
        <span className={`w-2 h-2 rounded-full shrink-0 ${run.enabled ? 'bg-emerald-400' : 'bg-slate-600'}`} />
        <span className="font-bold text-slate-100 uppercase tracking-wider text-[10px]">{SHADOW_LABEL}</span>
        <span className="ml-auto font-mono text-[10px] text-slate-500">
          {run.scaleR}R{run.boxPoints > 0 ? ` · ${run.boxPoints} pts` : ''} · {run.assetId}
        </span>
      </div>

      {run.warning && (
        <p className="text-[10px] text-amber-400/90 leading-snug mb-1.5">{run.warning}</p>
      )}

      <Line
        label="Estratégia"
        value={staleStrategyId ? `${run.strategyName || 'sem nome'} (removida)` : run.strategyName || '—'}
        accent={staleStrategyId ? 'text-amber-400' : undefined}
      />
      <Line label="Agora (c/ aberto)" value={fmtBRL(stats.liveEquity)} accent={pnlColor(stats.liveEquity)} />
      <Line label="Resultado realizado" value={fmtBRL(stats.totalFinancial)} accent={pnlColor(stats.totalFinancial)} />
      <Line
        label="Posições abertas"
        value={stats.openCount > 0 ? `${stats.openCount} (${fmtBRL(stats.unrealized)})` : '—'}
      />
      <Line
        label="Trades / win / loss"
        value={stats.trades > 0 ? `${stats.trades} · ${stats.wins}W / ${stats.losses}L` : 'aguardando'}
      />
      <Line label="Win rate" value={stats.settled > 0 ? `${stats.winRate.toFixed(1)}%` : '—'} />
      <Line
        label="Fator de lucro"
        value={stats.settled > 0 ? (Number.isFinite(stats.profitFactor) ? stats.profitFactor.toFixed(2) : '∞') : '—'}
      />
      <Line
        label="Máx. rebaixamento"
        value={stats.maxDrawdown > 0 ? fmtBRL(stats.maxDrawdown) : '—'}
        accent={stats.maxDrawdown > 0 ? 'text-amber-400' : undefined}
      />
      <Line
        label="Expectativa/trade"
        value={stats.settled > 0 ? `${stats.expectancy > 0 ? '+' : ''}${fmtBRL(stats.expectancy)}` : '—'}
        accent={pnlColor(stats.expectancy)}
      />
      <Line label="Dia da coleta" value={snap.date} />

      {/* Controles da corrida */}
      <div className="mt-2.5 space-y-2">
        <button
          onClick={() => {
            if (run.enabled) {
              patch({ enabled: false });
              return;
            }
            // Ligar sem estratégia escolhida: usa a última salva da biblioteca. Id órfão
            // (estratégia apagada) NUNCA é reusado — senão o "Ligar" renasce morto.
            const lastSaved = [...strategies].sort((a, b) => b.updatedAt - a.updatedAt)[0];
            patch({ enabled: true, strategyId: (run.strategyId && !staleStrategyId ? run.strategyId : null) || lastSaved?.id || null });
          }}
          className={`w-full flex items-center justify-center gap-1.5 h-7 rounded border text-[11px] font-bold transition-colors cursor-pointer ${
            run.enabled
              ? 'bg-slate-800 hover:bg-slate-700 border-slate-600/70 text-slate-200'
              : 'bg-emerald-600/90 hover:bg-emerald-500 border-emerald-500/60 text-white'
          }`}
          title={
            run.enabled
              ? 'Desligar o Robô 2 (a contabilidade fica guardada até o fim do dia)'
              : strategies.length > 0
                ? 'Ligar o Robô 2 na estratégia escolhida (roda só em papel)'
                : 'Ligar o Robô 2 — salve uma estratégia no Estúdio de Estratégias primeiro'
          }
        >
          {run.enabled ? 'Desligar Robô 2' : 'Ligar Robô 2'}
        </button>

        <label className="block">
          <span className="text-[10px] uppercase tracking-wider text-slate-500">Estratégia da biblioteca</span>
          <select
            value={run.strategyId || ''}
            disabled={!onPatchConfig}
            onChange={(e) => patch({ strategyId: e.target.value || null, enabled: true })}
            className="w-full h-7 mt-0.5 rounded bg-slate-950 border border-slate-700 text-slate-100 text-[11px] px-1.5 focus:outline-none focus:border-emerald-500 disabled:opacity-50"
            title="O Robô 2 roda o snapshot salvo desta estratégia, só que na escala escolhida aqui"
          >
            <option value="">{strategies.length === 0 ? '— biblioteca vazia — salve no Estúdio' : '— escolher —'}</option>
            {/* Estado órfão honesto: a estratégia apontada não está mais na biblioteca */}
            {staleStrategyId && run.strategyId && (
              <option value={run.strategyId} disabled>
                {run.strategyName || 'sem nome'} (removida da biblioteca)
              </option>
            )}
            {strategies.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>

        <div>
          <span className="text-[10px] uppercase tracking-wider text-slate-500">Escala Renko</span>
          <div className="flex items-center gap-1 mt-0.5">
            {SHADOW_SCALE_CHOICES.map((r) => (
              <button
                key={r}
                disabled={!onPatchConfig}
                onClick={() => patch({ scaleR: r as ShadowScaleR })}
                className={`flex-1 h-6 rounded border text-[11px] font-bold transition-colors cursor-pointer disabled:opacity-50 ${
                  run.scaleR === r
                    ? 'bg-emerald-600/80 border-emerald-500/70 text-white'
                    : 'bg-slate-800/70 border-slate-700 text-slate-300 hover:bg-slate-700'
                }`}
                title={`${r}R = ${r} × variação mínima do ativo${run.assetId ? ` (${run.assetId})` : ''}. Trocar de escala reinicia o livro da sombra.`}
              >
                {r}R
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={() => shadowRobotService.exportCsv()}
            className="flex-1 flex items-center justify-center gap-1 h-6 rounded bg-emerald-600/90 hover:bg-emerald-500 text-white text-[10px] font-semibold transition-colors cursor-pointer"
            title="Exportar o livro do Robô 2 em CSV (abre no Excel/Numbers)"
          >
            <Download className="w-3 h-3" />
            CSV
          </button>
          <button
            onClick={() => {
              if (window.confirm('Zerar o livro do Robô 2? Os trades sombra de hoje saem da contabilidade (nada de real é tocado).')) {
                shadowRobotService.reset();
              }
            }}
            className="flex-1 flex items-center justify-center gap-1 h-6 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-[10px] font-semibold transition-colors cursor-pointer"
            title="Zerar o livro e a escolha da sombra"
          >
            <RotateCcw className="w-3 h-3" />
            Zerar
          </button>
        </div>
      </div>

      <p className="mt-2 text-[9.5px] text-slate-500 leading-snug">
        Robô de papel: roda com o principal desligado, ignora as travas financeiras dele e jamais
        envia ordem à corretora.
      </p>
    </div>
  );
};
