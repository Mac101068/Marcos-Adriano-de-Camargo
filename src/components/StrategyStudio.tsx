import React, { useMemo, useRef, useState } from 'react';
import {
  Plus,
  Save,
  Play,
  Download,
  Upload,
  Copy,
  Trash2,
  X,
  Sparkles,
  Layers,
  Zap,
  ShieldCheck,
  Clock,
  Wifi,
} from 'lucide-react';
import { AutomationConfig } from '../types/trading';
import { SavedStrategy } from '../types/strategy';
import { StrategyLibraryService } from '../services/strategyLibraryService';
import { AssetSpec, formatPrice, renkoScaleLabel, resolveAsset } from '../assets/assetRegistry';

/**
 * Estúdio de Estratégias — tela dedicada para PROGRAMAR e SALVAR estratégias
 * completas (snapshot do AutomationConfig), sem mexer no painel de Ajustes.
 *
 * Regras de segurança:
 * - Salvar/editar aqui NUNCA altera o config ativo do terminal.
 * - "Ativar" aplica o snapshot e força o Robô PAUSADO (o operador liga sozinho).
 * - Nada nesta tela toca a ponte MT5.
 */

interface StrategyStudioProps {
  currentConfig: AutomationConfig;
  activeProfileName?: string;
  onActivate: (strategy: SavedStrategy) => void;
  /** Toda mudança na biblioteca (salvar, excluir, duplicar, importar) avisa o App para a caixinha ficar em sincronia. */
  onLibraryChanged?: () => void;
}

// ---------------------------------------------------------------------------
// Micropadres de formulário (chrome neutro, acento só nos ícones — padrão clean)
// ---------------------------------------------------------------------------
const inputCls =
  'bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs text-slate-100 focus:outline-none focus:border-slate-500 transition-colors';

const Section: React.FC<{ title: string; icon: React.ElementType; children: React.ReactNode; hint?: string }> = ({
  title,
  icon: Icon,
  children,
  hint,
}) => (
  <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-3">
    <div className="flex items-center gap-2 mb-2">
      <Icon className="w-3.5 h-3.5 text-slate-400" />
      <h3 className="text-xs font-semibold text-slate-200 uppercase tracking-wider">{title}</h3>
    </div>
    {hint && <p className="text-[10px] text-slate-500 leading-snug mb-2">{hint}</p>}
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5">{children}</div>
  </div>
);

const NumField: React.FC<{
  label: string;
  value: number;
  onChange: (n: number) => void;
  min?: number;
  max?: number;
  step?: number;
  hint?: string;
}> = ({ label, value, onChange, min, max, step, hint }) => (
  <label className="flex flex-col gap-1">
    <span className="text-[10px] text-slate-400">{label}</span>
    <input
      type="number"
      value={Number.isFinite(value) ? value : 0}
      min={min}
      max={max}
      step={step}
      onChange={(e) => {
        const n = Number(e.target.value);
        onChange(Number.isFinite(n) ? n : 0);
      }}
      className={inputCls}
    />
    {hint && <span className="text-[9px] text-slate-600 leading-tight">{hint}</span>}
  </label>
);

const TextField: React.FC<{ label: string; value: string; onChange: (v: string) => void; span?: boolean; hint?: string }> = ({
  label,
  value,
  onChange,
  span,
  hint,
}) => (
  <label className={`flex flex-col gap-1 ${span ? 'col-span-2 sm:col-span-3' : ''}`}>
    <span className="text-[10px] text-slate-400">{label}</span>
    <input type="text" value={value} onChange={(e) => onChange(e.target.value)} className={inputCls} />
    {hint && <span className="text-[9px] text-slate-600 leading-tight">{hint}</span>}
  </label>
);

function SelectField<T extends string>(props: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  span?: boolean;
}) {
  return (
    <label className={`flex flex-col gap-1 ${props.span ? 'col-span-2' : ''}`}>
      <span className="text-[10px] text-slate-400">{props.label}</span>
      <select
        value={props.value}
        onChange={(e) => props.onChange(e.target.value as T)}
        className={`${inputCls} cursor-pointer`}
      >
        {props.options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

const ToggleField: React.FC<{ label: string; value: boolean; onChange: (v: boolean) => void }> = ({
  label,
  value,
  onChange,
}) => (
  <label className="flex items-center gap-2 col-span-2 sm:col-span-2 cursor-pointer select-none py-1">
    <input
      type="checkbox"
      checked={value}
      onChange={(e) => onChange(e.target.checked)}
      className="w-3.5 h-3.5 rounded accent-emerald-500 cursor-pointer"
    />
    <span className="text-[11px] text-slate-300">{label}</span>
  </label>
);

// ---------------------------------------------------------------------------
// Rótulos e chips de resumo
// ---------------------------------------------------------------------------
const MODE_LABEL: Record<AutomationConfig['strategyMode'], string> = {
  PULLBACK_RETEST: 'Reteste (Pullback)',
  PYRAMID_FLOW_CONFLUENCE: 'Pirâmide & Confluência',
};

const scaleLabel = (pts: number, asset: AssetSpec) =>
  `${renkoScaleLabel(pts, asset)} (${formatPrice(pts, asset)}pts)`;

const entryLabel = (c: AutomationConfig) =>
  c.strategyMode === 'PYRAMID_FLOW_CONFLUENCE'
    ? c.pyramidEntryType === 'MARKET_ON_CLOSE'
      ? 'Pirâmide a mercado'
      : c.pyramidEntryType === 'BOX_50_LIMIT'
      ? 'Pirâmide Limit 50%'
      : 'Pirâmide Limit abertura'
    : c.entryTriggerType === 'MARKET_ON_CLOSE'
    ? 'Entrada a mercado'
    : c.pullbackTarget === 'BOX_OPEN'
    ? 'Limit abertura do box'
    : c.pullbackTarget === 'BOX_50_PCT'
    ? 'Limit 50% do box'
    : `Limit custom ${c.pullbackCustomPoints} pts`;

const thresholdLabel = (c: AutomationConfig) =>
  `Δ ${c.minDeltaThreshold}${c.adaptiveThresholdEnabled ? ' · adaptativo' : ' · fixo'}`;

const fmtDate = (ts: number) =>
  new Date(ts).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' }) +
  ' ' +
  new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

// ---------------------------------------------------------------------------
// Componente
// ---------------------------------------------------------------------------
export const StrategyStudio: React.FC<StrategyStudioProps> = ({ currentConfig, activeProfileName, onActivate, onLibraryChanged }) => {
  const [library, setLibrary] = useState<SavedStrategy[]>(() => StrategyLibraryService.list());
  const [draft, setDraft] = useState<SavedStrategy | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = () => {
    setLibrary(StrategyLibraryService.list());
    onLibraryChanged?.();
  };

  const flash = (msg: string) => {
    setNotice(msg);
    window.setTimeout(() => setNotice((n) => (n === msg ? null : n)), 2600);
  };

  const setCfg = (patch: Partial<AutomationConfig>) =>
    setDraft((d) => (d ? { ...d, config: { ...d.config, ...patch } } : d));

  const startFromCurrent = () => {
    const base = StrategyLibraryService.newFromConfig(currentConfig, `Estratégia ${library.length + 1}`);
    setDraft({ ...base, name: '' });
  };

  const saveDraft = (activate: boolean): SavedStrategy | null => {
    if (!draft) return null;
    if (!draft.name.trim()) {
      flash('Dê um nome à estratégia antes de salvar.');
      return null;
    }
    const saved = StrategyLibraryService.save({
      ...draft,
      config: { ...draft.config, profileName: draft.name.trim() },
    });
    setDraft(saved);
    refresh();
    flash(activate ? `Estratégia "${saved.name}" salva e ativada (Robô pausado por segurança).` : `Estratégia "${saved.name}" salva na biblioteca.`);
    if (activate) onActivate(saved);
    return saved;
  };

  const exportDraft = () => {
    if (!draft) return;
    const blob = new Blob([StrategyLibraryService.exportJson(draft)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(draft.name || 'estrategia').replace(/[^\w-]+/g, '_')}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importFile = async (file: File) => {
    try {
      const s = StrategyLibraryService.importJson(await file.text());
      const saved = StrategyLibraryService.save(s);
      refresh();
      setDraft(saved);
      flash(`Estratégia "${saved.name}" importada.`);
    } catch (err) {
      flash(`Falha ao importar JSON: ${err instanceof Error ? err.message : 'arquivo inválido'}`);
    }
  };

  const confirmTarget = useMemo(
    () => (confirmDeleteId ? library.find((s) => s.id === confirmDeleteId) : null),
    [confirmDeleteId, library]
  );

  const c = draft?.config;
  /** Spec do ativo da estratégia: é ele que diz quantos pontos valem um "R". O `assetId` grava
   *  junto com o símbolo digitado abaixo, então os dois nunca discordam; estratégia antiga sem o
   *  campo resolve pelo prefixo do símbolo, exatamente como antes da Fase 2. */
  const cAsset = resolveAsset(c?.symbol, c?.assetId);

  return (
    <div className="h-full w-full flex flex-col lg:flex-row gap-3 overflow-hidden">
      {/* ================= COLUNA 1: BIBLIOTECA ================= */}
      <aside className="lg:w-[300px] shrink-0 flex flex-col gap-2 min-h-0 max-h-[38vh] lg:max-h-none">
        <div className="flex items-center gap-1.5">
          <button
            onClick={startFromCurrent}
            className="flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 text-xs font-semibold rounded-lg border border-slate-700 bg-slate-900 text-slate-200 hover:border-slate-600 transition-colors cursor-pointer"
            title="Abrir um novo rascunho com todos os parâmetros do config ativo de agora"
          >
            <Plus className="w-3.5 h-3.5 text-emerald-400" />
            Nova do config atual
          </button>
          <button
            onClick={() => fileRef.current?.click()}
            className="flex items-center gap-1 px-2 py-1.5 text-xs rounded-lg border border-slate-700 bg-slate-900 text-slate-300 hover:border-slate-600 transition-colors cursor-pointer"
            title="Importar estratégia de um arquivo .json"
          >
            <Upload className="w-3.5 h-3.5" />
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void importFile(f);
              e.target.value = '';
            }}
          />
        </div>

        <div className="flex-1 overflow-y-auto space-y-2 pr-1">
          {library.length === 0 && (
            <div className="rounded-lg border border-dashed border-slate-700 p-4 text-center">
              <Sparkles className="w-5 h-5 text-slate-600 mx-auto mb-2" />
              <p className="text-[11px] text-slate-500 leading-snug">
                Nenhuma estratégia salva ainda.
                <br />
                Clique em <span className="text-slate-300">Nova do config atual</span> para começar.
              </p>
            </div>
          )}
          {library.map((s) => {
            const isActive = !!activeProfileName && s.name === activeProfileName;
            const isEditing = draft?.id === s.id;
            return (
              <div
                key={s.id}
                onClick={() => setDraft({ ...s, config: { ...s.config } })}
                className={`rounded-lg border p-2.5 cursor-pointer transition-colors ${
                  isEditing ? 'border-slate-500 bg-slate-800/70' : 'border-slate-800 bg-slate-900/60 hover:border-slate-700'
                }`}
              >
                <div className="flex items-center gap-1.5">
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${isActive ? 'bg-emerald-400' : 'bg-slate-600'}`} />
                  <span className="text-xs font-semibold text-slate-100 truncate flex-1">{s.name}</span>
                  <span className="text-[9px] text-slate-500 shrink-0">{fmtDate(s.updatedAt)}</span>
                </div>
                {s.description && <p className="text-[10px] text-slate-500 mt-1 line-clamp-2">{s.description}</p>}
                <div className="flex flex-wrap gap-1 mt-1.5">
                  <span className="px-1.5 py-0.5 rounded bg-slate-800 text-[9px] font-mono text-slate-400">{MODE_LABEL[s.config.strategyMode]}</span>
                  <span className="px-1.5 py-0.5 rounded bg-slate-800 text-[9px] font-mono text-slate-400">{scaleLabel(s.config.boxPoints, resolveAsset(s.config.symbol, s.config.assetId))}</span>
                  <span className="px-1.5 py-0.5 rounded bg-slate-800 text-[9px] font-mono text-slate-400">{thresholdLabel(s.config)}</span>
                </div>
                <div className="flex items-center gap-1 mt-2" onClick={(e) => e.stopPropagation()}>
                  <button
                    onClick={() => onActivate(s)}
                    className="flex items-center gap-1 px-2 py-1 rounded border border-slate-700 bg-slate-900 text-[10px] font-semibold text-slate-200 hover:border-slate-600 transition-colors cursor-pointer"
                    title="Aplicar no terminal (o Robô fica PAUSADO por segurança)"
                  >
                    <Play className="w-3 h-3 text-emerald-400" />
                    Ativar
                  </button>
                  <button
                    onClick={() => {
                      const dup = StrategyLibraryService.duplicate(s.id);
                      refresh();
                      if (dup) setDraft(dup);
                    }}
                    className="p-1 rounded border border-slate-700 bg-slate-900 text-slate-400 hover:text-slate-200 cursor-pointer"
                    title="Duplicar"
                  >
                    <Copy className="w-3 h-3" />
                  </button>
                  <button
                    onClick={() => setConfirmDeleteId(s.id)}
                    className="p-1 rounded border border-slate-700 bg-slate-900 text-slate-400 hover:text-rose-300 cursor-pointer ml-auto"
                    title="Excluir"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </aside>

      {/* ================= COLUNA 2: EDITOR ================= */}
      <section className="flex-1 min-w-0 rounded-lg border border-slate-800 bg-slate-950/60 flex flex-col overflow-hidden">
        {!draft || !c ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center p-6">
            <Layers className="w-8 h-8 text-slate-700 mb-3" />
            <h2 className="text-sm font-semibold text-slate-300">Estúdio de Estratégias</h2>
            <p className="text-[11px] text-slate-500 mt-1.5 max-w-[420px] leading-snug">
              Selecione uma estratégia à esquerda para editar, ou clique em{' '}
              <span className="text-slate-300">Nova do config atual</span> para programar a partir do que está rodando agora.
              Cada estratégia é um retrato completo dos parâmetros: estratégia, fluxo, entradas, gestão, limites e execução.
            </p>
            <button
              onClick={startFromCurrent}
              className="mt-4 flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-700 bg-slate-900 text-slate-200 hover:border-slate-600 transition-colors cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5 text-emerald-400" />
              Programar nova estratégia
            </button>
          </div>
        ) : (
          <>
            {/* Cabeçalho do editor: nome + descrição + ações */}
            <div className="shrink-0 border-b border-slate-800 p-3 space-y-2 bg-slate-900/40">
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  placeholder="Nome da estratégia (obrigatório para salvar)"
                  className={`${inputCls} flex-1 min-w-[200px] font-semibold`}
                />
                <button
                  onClick={() => saveDraft(false)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-700 bg-slate-900 text-slate-200 hover:border-slate-600 transition-colors cursor-pointer"
                  title="Salvar na biblioteca sem alterar o terminal"
                >
                  <Save className="w-3.5 h-3.5 text-sky-400" />
                  Salvar
                </button>
                <button
                  onClick={() => saveDraft(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-700 bg-slate-900 text-slate-200 hover:border-slate-600 transition-colors cursor-pointer"
                  title="Salvar e aplicar agora (o Robô é pausado por segurança)"
                >
                  <Play className="w-3.5 h-3.5 text-emerald-400" />
                  Salvar e Ativar
                </button>
                <button
                  onClick={exportDraft}
                  className="p-1.5 rounded-lg border border-slate-700 bg-slate-900 text-slate-400 hover:text-slate-200 cursor-pointer"
                  title="Exportar esta estratégia em .json"
                >
                  <Download className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => setDraft(null)}
                  className="p-1.5 rounded-lg border border-slate-700 bg-slate-900 text-slate-400 hover:text-slate-200 cursor-pointer"
                  title="Fechar editor"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
              <input
                type="text"
                value={draft.description ?? ''}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                placeholder="Descrição / racional (ex: Pirâmide 15R adaptativa, campeã do laboratório)"
                className={`${inputCls} w-full`}
              />
            </div>

            {/* Corpo: seções de parâmetros */}
            <div className="flex-1 overflow-y-auto p-3 space-y-3">
              <Section title="Núcleo" icon={Layers}>
                <SelectField
                  label="Estratégia"
                  span
                  value={c.strategyMode}
                  onChange={(v) => setCfg({ strategyMode: v })}
                  options={[
                    { value: 'PYRAMID_FLOW_CONFLUENCE', label: MODE_LABEL.PYRAMID_FLOW_CONFLUENCE },
                    { value: 'PULLBACK_RETEST', label: MODE_LABEL.PULLBACK_RETEST },
                  ]}
                />
                <TextField label="Símbolo" value={c.symbol} onChange={(v) => setCfg({ symbol: v, assetId: resolveAsset(v).id })} hint={`${cAsset.label} · ${cAsset.contractNote}`} />
                <NumField label="Box (pontos)" value={c.boxPoints} min={5} max={500} step={5} onChange={(n) => setCfg({ boxPoints: n })} hint={scaleLabel(c.boxPoints, cAsset)} />
                <NumField label="Contratos (mãe)" value={c.contracts} min={1} max={c.mt5MaxContractsPerOrder} onChange={(n) => setCfg({ contracts: n })} hint={`teto da ponte: ${c.mt5MaxContractsPerOrder}`} />
              </Section>

              <Section title="Fluxo & Regime (o gate de agressão)" icon={Zap} hint="Vale para as duas estratégias. Com o limiar adaptativo ligado, o Δ exigido é ±base × fator do momento (abertura forte, almoço fraco).">
                <NumField label="Delta mínimo (base)" value={c.minDeltaThreshold} min={10} max={5000} step={10} onChange={(n) => setCfg({ minDeltaThreshold: n })} />
                <ToggleField label="Limiar adaptativo de regime" value={c.adaptiveThresholdEnabled} onChange={(v) => setCfg({ adaptiveThresholdEnabled: v })} />
                {c.adaptiveThresholdEnabled && (
                  <NumField label="Janela do medidor (boxes)" value={c.regimeLookbackBoxes} min={10} max={50} step={5} onChange={(n) => setCfg({ regimeLookbackBoxes: n })} />
                )}
                <ToggleField label="Exigir CVD em novo extremo" value={c.requireCvdNewExtreme} onChange={(v) => setCfg({ requireCvdNewExtreme: v })} />
                <SelectField
                  label="Confirmação"
                  value={c.confirmationMode}
                  onChange={(v) => setCfg({ confirmationMode: v })}
                  options={[
                    { value: 'BOX_CLOSE', label: 'Fechamento do box' },
                    { value: 'TICK_BREAKOUT', label: 'Rompimento no tick' },
                  ]}
                />
              </Section>

              <Section title="Entrada" icon={Play} hint={c.strategyMode === 'PYRAMID_FLOW_CONFLUENCE' ? 'Na Pirâmide, a cada box com fluxo acima do limiar entra uma pirâmide; a mãe nasce na virada.' : 'Reteste a mercado ou ordem limitada no recuo, com validade em boxes.'}>
                {c.strategyMode === 'PYRAMID_FLOW_CONFLUENCE' ? (
                  <>
                    <SelectField
                      label="Entrada das pirâmides"
                      span
                      value={c.pyramidEntryType}
                      onChange={(v) => setCfg({ pyramidEntryType: v })}
                      options={[
                        { value: 'MARKET_ON_CLOSE', label: 'A mercado no fechamento' },
                        { value: 'BOX_50_LIMIT', label: 'Limit a 50% do box' },
                        { value: 'BOX_OPEN_LIMIT', label: 'Limit na abertura do box' },
                      ]}
                    />
                    <NumField label="TP da pirâmide (pts)" value={c.pyramidTpPoints} min={5} max={500} step={5} onChange={(n) => setCfg({ pyramidTpPoints: n })} />
                    <NumField label="Stop da pirâmide (0 = só inversão)" value={c.pyramidSlPoints} min={0} max={500} step={5} onChange={(n) => setCfg({ pyramidSlPoints: n })} />
                    <NumField label="Contratos por pirâmide" value={c.pyramidContracts} min={1} max={c.mt5MaxContractsPerOrder} onChange={(n) => setCfg({ pyramidContracts: n })} />
                  </>
                ) : (
                  <>
                    <SelectField
                      label="Gatilho de entrada"
                      span
                      value={c.entryTriggerType}
                      onChange={(v) => setCfg({ entryTriggerType: v })}
                      options={[
                        { value: 'MARKET_ON_CLOSE', label: 'A mercado no fechamento do box' },
                        { value: 'PULLBACK_ENTRY', label: 'Ordem limitada no reteste' },
                      ]}
                    />
                    {c.entryTriggerType === 'PULLBACK_ENTRY' && (
                      <>
                        <SelectField
                          label="Nível do reteste"
                          value={c.pullbackTarget}
                          onChange={(v) => setCfg({ pullbackTarget: v })}
                          options={[
                            { value: 'BOX_OPEN', label: 'Abertura do box (100%)' },
                            { value: 'BOX_50_PCT', label: '50% do box' },
                            { value: 'CUSTOM_POINTS', label: 'Pontos personalizados' },
                          ]}
                        />
                        {c.pullbackTarget === 'CUSTOM_POINTS' && (
                          <NumField label="Recuo (pts)" value={c.pullbackCustomPoints} min={5} max={500} step={5} onChange={(n) => setCfg({ pullbackCustomPoints: n })} />
                        )}
                        <NumField label="Validade da limitada (boxes)" value={c.pullbackMaxBoxesWait} min={1} max={10} onChange={(n) => setCfg({ pullbackMaxBoxesWait: n })} hint="vence sem preencher = EXPIRED_PULLBACK" />
                      </>
                    )}
                  </>
                )}
              </Section>

              <Section title="Gestão & Proteções" icon={ShieldCheck} hint={c.strategyMode === 'PYRAMID_FLOW_CONFLUENCE' ? 'A mãe surfa sem TP: gatilho → piso de taxas → acompanhamento. As pirâmides morrem no próprio TP.' : 'SL/TP fixos com parcial → breakeven → trailing.'}>
                {c.strategyMode === 'PULLBACK_RETEST' && (
                  <>
                    <NumField label="Stop Loss (pts)" value={c.stopLossPoints} min={0} max={1000} step={5} onChange={(n) => setCfg({ stopLossPoints: n })} />
                    <NumField label="Take Profit (pts)" value={c.takeProfitPoints} min={0} max={2000} step={5} onChange={(n) => setCfg({ takeProfitPoints: n })} />
                    <ToggleField label="Saída parcial" value={c.enablePartialExit} onChange={(v) => setCfg({ enablePartialExit: v })} />
                    {c.enablePartialExit && (
                      <>
                        <NumField label="Parcial em (pts)" value={c.partialPoints} min={5} max={1000} step={5} onChange={(n) => setCfg({ partialPoints: n })} />
                        <NumField label="Contratos na parcial" value={c.partialContracts} min={1} max={Math.max(1, c.contracts)} onChange={(n) => setCfg({ partialContracts: n })} />
                        <ToggleField label="Stop no breakeven após parcial" value={c.moveStopToBreakevenOnPartial} onChange={(v) => setCfg({ moveStopToBreakevenOnPartial: v })} />
                      </>
                    )}
                  </>
                )}
                <NumField label="Piso do breakeven (pts)" value={c.breakevenOffsetPoints} min={0} max={50} step={1} onChange={(n) => setCfg({ breakevenOffsetPoints: n })} hint="folga de taxas sobre a entrada" />
                <ToggleField label="Trailing / proteção da mãe" value={c.trailingStop} onChange={(v) => setCfg({ trailingStop: v })} />
                {c.trailingStop && (
                  <>
                    <NumField label="Gatilho do trailing (pts a favor)" value={c.trailingActivationPoints} min={25} max={500} step={25} onChange={(n) => setCfg({ trailingActivationPoints: n })} />
                    <NumField label="Distância do trailing (pts)" value={c.trailingDistancePoints} min={25} max={300} step={25} onChange={(n) => setCfg({ trailingDistancePoints: n })} />
                  </>
                )}
                {c.strategyMode === 'PYRAMID_FLOW_CONFLUENCE' && (
                  <>
                    <ToggleField label="Mãe ao breakeven a cada TP de pirâmide" value={c.moveMainToBreakevenOnPyramidTp} onChange={(v) => setCfg({ moveMainToBreakevenOnPyramidTp: v })} />
                    <ToggleField label="Mãe surfe até a virada de fluxo" value={c.holdMainUntilFlip} onChange={(v) => setCfg({ holdMainUntilFlip: v })} />
                    <ToggleField label="Zerar tudo na virada (FLIP_REVERSAL)" value={c.closeAllOnFlowFlip} onChange={(v) => setCfg({ closeAllOnFlowFlip: v })} />
                    <ToggleField label="Sem stop fixo (saídas 100% por inversão)" value={c.noFixedStopLoss} onChange={(v) => setCfg({ noFixedStopLoss: v })} />
                  </>
                )}
              </Section>

              <Section title="Janela & Limites" icon={Clock} hint="Trava financeira é por sessão e julga o resultado REALIZADO (o mesmo PnL da tela): bateu meta ou perda, o Robô para de abrir e um chip vermelho avisa o motivo. 0 = livre. A trava de horário bloqueia entradas de 17:30 até 08:55 e é obedecida pelo terminal E pela ponte Python gerada — no simulador vale a hora da barra simulada, não o relógio da sala.">
                <ToggleField label="Filtro de horários (day trade)" value={c.tradingHoursEnabled} onChange={(v) => setCfg({ tradingHoursEnabled: v })} />
                {c.tradingHoursEnabled && (
                  <>
                    <TextField label="Início das entradas" value={c.tradingStartTime} onChange={(v) => setCfg({ tradingStartTime: v })} hint="HH:MM · padrão 08:55 (leilão e 1º candle liberados)" />
                    <TextField label="Fim de entradas" value={c.tradingStopEntriesTime} onChange={(v) => setCfg({ tradingStopEntriesTime: v })} hint="HH:MM · padrão 17:30 (depois disso nenhuma entrada nova, até o início)" />
                    <TextField label="Zeragem compulsória" value={c.tradingCloseAllTime} onChange={(v) => setCfg({ tradingCloseAllTime: v })} hint="HH:MM · padrão 17:30: liquida tudo e cancela as limitadas" />
                  </>
                )}
                <NumField label="Trava de perda diária (R$ · 0 = livre)" value={c.maxDailyLoss} min={0} max={100000} step={50} onChange={(n) => setCfg({ maxDailyLoss: n })} />
                <NumField label="Meta diária de ganho (R$ · 0 = livre)" value={c.maxDailyProfit} min={0} max={100000} step={50} onChange={(n) => setCfg({ maxDailyProfit: n })} />
                <NumField label="Máx. trades no dia (0 = livre)" value={c.maxDailyTrades} min={0} max={500} onChange={(n) => setCfg({ maxDailyTrades: n })} />
                <ToggleField label="Zerar posições ao bater a trava" value={c.closeAllOnFinancialLock} onChange={(v) => setCfg({ closeAllOnFinancialLock: v })} />
              </Section>

              <Section title="Execução MT5" icon={Wifi} hint="Modo de conta e tetos aceitos pela ponte. O token da ponte NÃO faz parte da estratégia (de propósito).">
                <SelectField
                  label="Modo de conta"
                  value={c.accountMode}
                  onChange={(v) => setCfg({ accountMode: v })}
                  options={[
                    { value: 'HEDGE', label: 'HEDGE (posições simultâneas)' },
                    { value: 'NETTING', label: 'NETTING (posição única)' },
                  ]}
                />
                <SelectField
                  label="Sinal oposto"
                  value={c.hedgeOppositeAction}
                  onChange={(v) => setCfg({ hedgeOppositeAction: v })}
                  options={[
                    { value: 'CLOSE_OPPOSITE', label: 'Zerar oposto' },
                    { value: 'ALLOW_SIMULTANEOUS', label: 'Permitir os dois lados' },
                    { value: 'IGNORE_NEW', label: 'Ignorar nova' },
                  ]}
                />
                <NumField label="Máx. posições" value={c.maxSimultaneousPositions} min={1} max={30} onChange={(n) => setCfg({ maxSimultaneousPositions: n })} />
                <SelectField
                  label="Filling"
                  value={c.orderFillingMode}
                  onChange={(v) => setCfg({ orderFillingMode: v })}
                  options={[
                    { value: 'ORDER_FILLING_RETURN', label: 'RETURN' },
                    { value: 'ORDER_FILLING_IOC', label: 'IOC' },
                    { value: 'ORDER_FILLING_FOK', label: 'FOK' },
                  ]}
                />
                <NumField label="Magic number" value={c.magicNumber} min={1} onChange={(n) => setCfg({ magicNumber: n })} />
                <TextField label="Comentário da ordem" value={c.orderComment} onChange={(v) => setCfg({ orderComment: v })} />
                <NumField label="Teto ctros/ordem (ponte)" value={c.mt5MaxContractsPerOrder} min={1} max={10} onChange={(n) => setCfg({ mt5MaxContractsPerOrder: n })} />
                <NumField label="Teto ordens/min (ponte)" value={c.mt5MaxOrdersPerMinute} min={1} max={60} onChange={(n) => setCfg({ mt5MaxOrdersPerMinute: n })} />
              </Section>
            </div>

            {/* Rodapé do editor: resumo em chips */}
            <div className="shrink-0 border-t border-slate-800 px-3 py-2 flex items-center gap-2 flex-wrap bg-slate-900/40">
              <span className="text-[10px] text-slate-500">Resumo:</span>
              <span className="px-2 py-0.5 rounded bg-slate-800 text-[10px] font-mono text-slate-300">{MODE_LABEL[c.strategyMode]}</span>
              <span className="px-2 py-0.5 rounded bg-slate-800 text-[10px] font-mono text-slate-300">{scaleLabel(c.boxPoints, cAsset)}</span>
              <span className="px-2 py-0.5 rounded bg-slate-800 text-[10px] font-mono text-slate-300">{entryLabel(c)}</span>
              <span className="px-2 py-0.5 rounded bg-slate-800 text-[10px] font-mono text-slate-300">{thresholdLabel(c)}</span>
              <span className="px-2 py-0.5 rounded bg-slate-800 text-[10px] font-mono text-slate-300">
                {c.contracts} ctro{c.contracts > 1 ? 's' : ''}
                {c.enablePartialExit && c.strategyMode === 'PULLBACK_RETEST' ? ` · parcial ${c.partialPoints}p` : ''}
              </span>
            </div>
          </>
        )}
      </section>

      {/* Aviso flutuante discreto */}
      {notice && (
        <div className="fixed bottom-20 lg:bottom-6 left-1/2 -translate-x-1/2 z-50 px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-600 text-[11px] text-slate-100 shadow-xl max-w-[90vw]">
          {notice}
        </div>
      )}

      {/* Confirmação de exclusão (modal in-app — nunca window.confirm) */}
      {confirmTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setConfirmDeleteId(null)}>
          <div className="w-full max-w-sm rounded-xl border border-slate-700 bg-slate-900 p-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-semibold text-slate-100">Excluir estratégia?</h3>
            <p className="text-xs text-slate-400 mt-1.5 leading-snug">
              <span className="text-slate-200 font-medium">{confirmTarget.name}</span> será removida da biblioteca. O terminal não é
              afetado — mas se ela for a ativa, o config atual continua em uso até você trocar.
            </p>
            <div className="flex gap-2 mt-4 justify-end">
              <button
                onClick={() => setConfirmDeleteId(null)}
                className="px-3 py-1.5 text-xs rounded-lg border border-slate-700 text-slate-300 hover:border-slate-600 cursor-pointer"
              >
                Cancelar
              </button>
              <button
                onClick={() => {
                  StrategyLibraryService.remove(confirmTarget.id);
                  if (draft?.id === confirmTarget.id) setDraft(null);
                  refresh();
                  setConfirmDeleteId(null);
                  flash(`Estratégia "${confirmTarget.name}" excluída.`);
                }}
                className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-rose-500/40 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20 cursor-pointer"
              >
                Excluir
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
