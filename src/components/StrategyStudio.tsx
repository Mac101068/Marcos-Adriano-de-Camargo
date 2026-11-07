import React, { useMemo, useRef, useState } from 'react';
import {
  Plus,
  Download,
  Upload,
  Copy,
  Trash2,
  Play,
  Sparkles,
  Layers,
  Zap,
  ShieldCheck,
  Clock,
  Wifi,
  CheckCircle2,
  Sliders,
  Save,
  Pencil,
} from 'lucide-react';
import { AutomationConfig } from '../types/trading';
import { SavedStrategy } from '../types/strategy';
import { StrategyLibraryService } from '../services/strategyLibraryService';
import { CollapsibleSection } from './CollapsibleSection';
import { AssetSpec, formatPrice, renkoScaleLabel, resolveAsset } from '../assets/assetRegistry';

/**
 * Estúdio de Estratégias — a CASA ÚNICA para acessar e gerir estratégias (Fase A, banco de dados
 * único). Aqui você LISTA, CRIA, ATIVA, DUPLICA, RENOMEIA, EXCLUI, IMPORTA e SINCRONIZA.
 *
 * A edição de parâmetros NÃO acontece mais aqui: ela vive num único lugar — a aba **Parâmetros**,
 * que é o editor da estratégia ATIVA (com write-through para a biblioteca). Foi assim que a
 * duplicação "Estúdio × Parâmetros" acabou: um lugar para cuidar das estratégias, um editor só.
 *
 * Regras de segurança:
 * - "Ativar" aponta o terminal para aquela estratégia e força o Robô PAUSADO (o operador liga sozinho).
 * - Nada nesta tela toca a ponte MT5.
 */

interface StrategyStudioProps {
  currentConfig: AutomationConfig;
  /** Nome autoritativo da ativa (memo único no App). Comparação real é por `activeStrategyId`. */
  activeProfileName?: string;
  activeStrategyId?: string | null;
  onActivate: (strategy: SavedStrategy) => void;
  /** Toda mudança na biblioteca (criar, excluir, duplicar, renomear, importar) avisa o App. */
  onLibraryChanged?: () => void;
  /**
   * Sincronização de terminal (Ciclo 12): aplica o config ativo que veio do arquivo do OUTRO
   * navegador. O App aplica com Robô PAUSADO.
   */
  onApplyConfig?: (config: AutomationConfig) => void;
  /** Id da estratégia que o Robô 2 (sombra) roda — o modal de exclusão usa para avisar. */
  shadowStrategyId?: string | null;
  /** Abre a aba Parâmetros (o único editor) — usado em "Editar" e depois de criar/ativar. */
  onOpenEditor?: () => void;
}

// ---------------------------------------------------------------------------
// Rótulos e chips de resumo
// ---------------------------------------------------------------------------
const MODE_LABEL: Record<AutomationConfig['strategyMode'], string> = {
  PULLBACK_RETEST: 'Reteste (Pullback)',
  PYRAMID_FLOW_CONFLUENCE: 'Pirâmide & Confluência',
  SIGNAL_STACK: 'Acumulação por Sinal (C/V)',
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
  `Δ ${c.minDeltaThreshold}${c.adaptiveThresholdEnabled ? ' · adaptativo' : ' · fixo'}${c.consolidationFilterEnabled ? ' · anti-acumulação' : ''}`;

const fmtDate = (ts: number) =>
  new Date(ts).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' }) +
  ' ' +
  new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

const yn = (b: boolean) => (b ? 'sim' : 'não');

/** Linha de resumo (rótulo miúdo + valor mono) no painel de detalhe somente-leitura. */
const Row: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <div className="flex items-baseline justify-between gap-2 border-b border-slate-800/60 py-1">
    <span className="text-[10px] text-slate-500 shrink-0">{label}</span>
    <span className="text-[11px] font-mono text-slate-200 text-right">{value}</span>
  </div>
);

/** Grupo do retrato: linha de lista que concentra os dados e abre embaixo ao clicar. */
const DetailSection: React.FC<{
  title: string;
  icon: React.ElementType;
  summary?: React.ReactNode;
  children: React.ReactNode;
}> = ({ title, icon, summary, children }) => (
  <CollapsibleSection title={title} icon={icon} iconClass="text-slate-400" summary={summary}>
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4">{children}</div>
  </CollapsibleSection>
);

const btnCls =
  'flex items-center justify-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold rounded-lg border border-slate-700 bg-slate-900 text-slate-200 hover:border-slate-600 transition-colors cursor-pointer';
const inputCls =
  'bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs text-slate-100 focus:outline-none focus:border-slate-500 transition-colors';

export const StrategyStudio: React.FC<StrategyStudioProps> = ({
  currentConfig,
  activeProfileName,
  activeStrategyId,
  onActivate,
  onLibraryChanged,
  onApplyConfig,
  shadowStrategyId,
  onOpenEditor,
}) => {
  const [library, setLibrary] = useState<SavedStrategy[]>(() => StrategyLibraryService.list());
  const [selectedId, setSelectedId] = useState<string | null>(
    () => (activeStrategyId && StrategyLibraryService.list().some((s) => s.id === activeStrategyId) ? activeStrategyId : null)
  );
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Criação e renomeação só precisam de um nome — a edição de parâmetros é na aba Parâmetros.
  const [nameModal, setNameModal] = useState<{ mode: 'create' | 'rename'; id?: string; value: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const fileRefAll = useRef<HTMLInputElement>(null);

  const refresh = () => {
    setLibrary(StrategyLibraryService.list());
    onLibraryChanged?.();
  };

  const flash = (msg: string) => {
    setNotice(msg);
    window.setTimeout(() => setNotice((n) => (n === msg ? null : n)), 2600);
  };

  const isActive = (s: SavedStrategy) =>
    activeStrategyId ? s.id === activeStrategyId : !!activeProfileName && s.name === activeProfileName;

  const selected = useMemo(() => library.find((s) => s.id === selectedId) ?? null, [library, selectedId]);

  // ── criar: nomea, tira retrato do config atual, salva na biblioteca, ativa e abre o editor ──
  const confirmCreate = () => {
    if (!nameModal) return;
    const name = nameModal.value.trim() || `Estratégia ${library.length + 1}`;
    const saved = StrategyLibraryService.save(StrategyLibraryService.newFromConfig(currentConfig, name));
    refresh();
    setSelectedId(saved.id);
    setNameModal(null);
    onActivate(saved);
    flash(`Estratégia "${saved.name}" criada a partir do config atual e ativada. Ajuste nos Parâmetros.`);
    onOpenEditor?.();
  };

  // ── renomear a estratégia selecionada (nome + profileName do retrato ficam juntos) ──
  const confirmRename = () => {
    if (!nameModal || !nameModal.id) return;
    const target = library.find((s) => s.id === nameModal.id);
    if (!target) return;
    const name = nameModal.value.trim() || target.name;
    const saved = StrategyLibraryService.save({ ...target, name, config: { ...target.config, profileName: name } });
    refresh();
    setNameModal(null);
    flash(`Estratégia renomeada para "${saved.name}".`);
    if (isActive(target)) onActivate(saved);
  };

  const exportOne = (strategy: SavedStrategy) => {
    const blob = new Blob([StrategyLibraryService.exportJson(strategy)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(strategy.name || 'estrategia').replace(/[^\w-]+/g, '_')}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importStrategyText = async (text: string) => {
    try {
      const s = StrategyLibraryService.importJson(text);
      const saved = StrategyLibraryService.save(s);
      refresh();
      setSelectedId(saved.id);
      flash(`Estratégia "${saved.name}" importada.`);
    } catch (err) {
      flash(`Falha ao importar JSON: ${err instanceof Error ? err.message : 'arquivo inválido'}`);
    }
  };

  const importFile = async (file: File) => importStrategyText(await file.text());

  // =========================================================================
  // SINCRONIZAÇÃO DE TERMINAL (Ciclo 12): o navegador interno da IDE e o externo
  // NÃO compartilham localStorage — cada um tem config e biblioteca próprios. Este
  // pacote único (config ativo + biblioteca inteira) viaja de um para o outro em
  // um clique de cada lado. Importar não apaga nada local: estratégias de mesmo id
  // são substituídas pelas do arquivo; as demais ficam.
  // =========================================================================
  const SYNC_TIPO = 'fluxo_terminal_sync';

  const exportAll = () => {
    const payload = {
      tipo: SYNC_TIPO,
      versao: 1,
      exportedAt: Date.now(),
      origem: navigator.userAgent.includes('Electron') || window.self !== window.top ? 'navegador interno' : 'navegador externo',
      activeConfig: currentConfig,
      library: StrategyLibraryService.list(),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `fluxo-terminal-sync-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    flash(`Pacote sincronizado exportado: config ativo + ${payload.library.length} estratégia(s).`);
  };

  const applySyncPayload = (parsed: { library?: unknown; activeConfig?: unknown }) => {
    const list = Array.isArray(parsed.library) ? (parsed.library as Partial<SavedStrategy>[]) : [];
    let applied = 0;
    for (const s of list) {
      if (!s || typeof s.name !== 'string' || !s.config) continue;
      StrategyLibraryService.save({
        id: typeof s.id === 'string' ? s.id : `strategy-${Date.now()}-${applied}`,
        name: s.name,
        description: typeof s.description === 'string' ? s.description : undefined,
        createdAt: Number(s.createdAt) || Date.now(),
        updatedAt: Number(s.updatedAt) || Date.now(),
        config: s.config as AutomationConfig,
      });
      applied += 1;
    }
    refresh();
    const cfg = parsed.activeConfig as AutomationConfig | undefined;
    const hasCfg = !!cfg && typeof cfg.strategyMode === 'string';
    if (hasCfg && onApplyConfig) onApplyConfig(cfg);
    flash(
      `Terminal sincronizado: ${applied} estratégia(s) na biblioteca` +
        (hasCfg && onApplyConfig ? ' + config ativo aplicado (Robô PAUSADO por segurança).' : '. Config não aplicado (este Estúdio não recebe o config).')
    );
  };

  const onPickSyncFile = async (file: File) => {
    const text = await file.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      flash('Falha ao sincronizar: arquivo não é um JSON válido.');
      return;
    }
    const p = parsed as { tipo?: string; config?: unknown; library?: unknown; activeConfig?: unknown };
    if (p && p.tipo === SYNC_TIPO) applySyncPayload(p);
    else if (p && p.config) void importStrategyText(text); // arquivo de estratégia única também serve
    else flash('Falha ao sincronizar: JSON sem "tipo" de pacote nem campo "config".');
  };

  const confirmTarget = useMemo(
    () => (confirmDeleteId ? library.find((s) => s.id === confirmDeleteId) : null),
    [confirmDeleteId, library]
  );

  const c = selected?.config;
  const cAsset = resolveAsset(c?.symbol, c?.assetId);

  return (
    <div className="h-full w-full flex flex-col lg:flex-row gap-3 overflow-hidden">
      {/* ================= COLUNA 1: BIBLIOTECA ================= */}
      <aside className="lg:w-[320px] shrink-0 flex flex-col gap-2 min-h-0 max-h-[42vh] lg:max-h-none">
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setNameModal({ mode: 'create', value: `Estratégia ${library.length + 1}` })}
            className={btnCls + ' flex-1'}
            title="Criar uma estratégia nova a partir do config ativo de agora (inclusive os valores da boleta), ativá-la e editá-la nos Parâmetros"
          >
            <Plus className="w-3.5 h-3.5 text-emerald-400" />
            Nova do config atual
          </button>
          <button
            onClick={() => fileRef.current?.click()}
            className={btnCls + ' px-2'}
            title="Importar uma estratégia de um arquivo .json"
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

        {/* Sincronização de terminal (Ciclo 12) */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={exportAll}
            className="flex-1 flex items-center justify-center gap-1.5 px-2 py-1 text-[10px] font-semibold rounded-lg border border-amber-600/40 bg-amber-950/30 text-amber-300 hover:border-amber-500 transition-colors cursor-pointer"
            title="Baixar UM arquivo .json com o config ativo + a biblioteca inteira. Abra no OUTRO navegador (interno ↔ externo) ao lado."
          >
            <Download className="w-3.5 h-3.5" />
            Exportar tudo
          </button>
          <button
            onClick={() => fileRefAll.current?.click()}
            className="flex-1 flex items-center justify-center gap-1.5 px-2 py-1 text-[10px] font-semibold rounded-lg border border-amber-600/40 bg-amber-950/30 text-amber-300 hover:border-amber-500 transition-colors cursor-pointer"
            title="Aplicar o pacote do outro navegador: repõe a biblioteca inteira e o config ativo. O Robô termina PAUSADO por segurança."
          >
            <Upload className="w-3.5 h-3.5" />
            Importar tudo
          </button>
          <input
            ref={fileRefAll}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onPickSyncFile(f);
              e.target.value = '';
            }}
          />
        </div>

        <div className="flex-1 overflow-y-auto space-y-2 pr-1">
          {library.length === 0 && (
            <div className="rounded-lg border border-dashed border-slate-700 p-4 text-center">
              <Sparkles className="w-5 h-5 text-slate-600 mx-auto mb-2" />
              <p className="text-[11px] text-slate-400 leading-snug">
                Nenhuma estratégia salva ainda.
                <br />
                Clique em <span className="text-slate-300">Nova do config atual</span> para começar.
              </p>
            </div>
          )}
          {library.map((s) => {
            const active = isActive(s);
            const isSel = selected?.id === s.id;
            return (
              <div
                key={s.id}
                onClick={() => setSelectedId(s.id)}
                className={`rounded-lg border p-2.5 cursor-pointer transition-colors ${
                  isSel ? 'border-slate-500 bg-slate-800/70' : 'border-slate-800 bg-slate-900/60 hover:border-slate-700'
                }`}
              >
                <div className="flex items-center gap-1.5">
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${active ? 'bg-emerald-400' : 'bg-slate-600'}`} />
                  <span className="text-xs font-semibold text-slate-100 truncate flex-1">{s.name}</span>
                  {active && (
                    <span className="shrink-0 px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 text-[8px] font-bold uppercase tracking-wider">
                      AO VIVO
                    </span>
                  )}
                  <span className="text-[9px] text-slate-500 shrink-0">{fmtDate(s.updatedAt)}</span>
                </div>
                {s.description && <p className="text-[10px] text-slate-500 mt-1 line-clamp-2">{s.description}</p>}
                <div className="flex flex-wrap gap-1 mt-1.5">
                  <span className="px-1.5 py-0.5 rounded bg-slate-800 text-[9px] font-mono text-slate-400">{MODE_LABEL[s.config.strategyMode]}</span>
                  <span className="px-1.5 py-0.5 rounded bg-slate-800 text-[9px] font-mono text-slate-400">{scaleLabel(s.config.boxPoints, resolveAsset(s.config.symbol, s.config.assetId))}</span>
                  <span className="px-1.5 py-0.5 rounded bg-slate-800 text-[9px] font-mono text-slate-400">{thresholdLabel(s.config)}</span>
                </div>
                <div className="flex items-center gap-1 mt-2" onClick={(e) => e.stopPropagation()}>
                  {active ? (
                    <span
                      className="flex-1 flex items-center justify-center gap-1 px-2 py-1 rounded border border-emerald-600/40 bg-emerald-950/30 text-[10px] font-semibold text-emerald-300"
                      title="É esta estratégia que o Robô 1 roda agora. Editar nos Parâmetros ou na Boleta grava nela (banco único)."
                    >
                      <CheckCircle2 className="w-3 h-3" />
                      Rodando no Robô 1
                    </span>
                  ) : (
                    <button
                      onClick={() => {
                        onActivate(s);
                        flash(`Estratégia "${s.name}" ativada (Robô PAUSADO por segurança).`);
                      }}
                      className="flex items-center gap-1 px-2 py-1 rounded border border-slate-700 bg-slate-900 text-[10px] font-semibold text-slate-200 hover:border-slate-600 transition-colors cursor-pointer"
                      title="Aplicar no terminal (o Robô fica PAUSADO por segurança)"
                    >
                      <Play className="w-3 h-3 text-emerald-400" />
                      Ativar
                    </button>
                  )}
                  <button
                    onClick={() => {
                      const dup = StrategyLibraryService.duplicate(s.id);
                      refresh();
                      if (dup) setSelectedId(dup.id);
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

      {/* ================= COLUNA 2: DETALHE (somente-leitura) ================= */}
      <section className="flex-1 min-w-0 rounded-lg border border-slate-800 bg-slate-950/60 flex flex-col overflow-hidden">
        {!selected || !c ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center p-6">
            <Layers className="w-8 h-8 text-slate-700 mb-3" />
            <h2 className="text-sm font-semibold text-slate-300">Estúdio de Estratégias</h2>
            <p className="text-[11px] text-slate-500 mt-1.5 max-w-[440px] leading-snug">
              Selecione uma estratégia à esquerda para ver o retrato completo dos parâmetros dela.
              Para <span className="text-slate-300">programar</span>, use a aba{' '}
              <span className="text-slate-300">Parâmetros</span> — ela é o editor da estratégia ativa e
              grava direto na biblioteca (banco único), espelhando a boleta do gráfico.
            </p>
            <button onClick={() => setNameModal({ mode: 'create', value: `Estratégia ${library.length + 1}` })} className={btnCls + ' mt-4'}>
              <Plus className="w-3.5 h-3.5 text-emerald-400" />
              Nova estratégia
            </button>
          </div>
        ) : (
          <>
            {/* Cabeçalho do detalhe: identidade + ações */}
            <div className="shrink-0 border-b border-slate-800 p-3 space-y-2 bg-slate-900/40">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`w-2 h-2 rounded-full shrink-0 ${isActive(selected) ? 'bg-emerald-400' : 'bg-slate-600'}`} />
                <h2 className="text-sm font-semibold text-slate-100 truncate">{selected.name}</h2>
                {isActive(selected) && (
                  <span className="px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 text-[8px] font-bold uppercase tracking-wider shrink-0">
                    AO VIVO
                  </span>
                )}
                <span className="text-[9px] text-slate-500 font-mono shrink-0 ml-auto">#{selected.id.replace(/^strategy-/, '').slice(-4)} · {fmtDate(selected.updatedAt)}</span>
              </div>
              {selected.description && <p className="text-[11px] text-slate-400 leading-snug">{selected.description}</p>}
              <div className="flex flex-wrap items-center gap-1.5">
                {isActive(selected) ? (
                  <button
                    onClick={() => onOpenEditor?.()}
                    className="flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-emerald-600/50 bg-emerald-500/15 text-emerald-200 hover:bg-emerald-500/25 transition-colors cursor-pointer"
                    title="Editar os parâmetros desta estratégia ativa na aba Parâmetros"
                  >
                    <Sliders className="w-3.5 h-3.5" />
                    Editar nos Parâmetros
                  </button>
                ) : (
                  <button
                    onClick={() => {
                      onActivate(selected);
                      flash(`Estratégia "${selected.name}" ativada (Robô PAUSADO).`);
                      onOpenEditor?.();
                    }}
                    className="flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-700 bg-slate-900 text-slate-200 hover:border-slate-600 transition-colors cursor-pointer"
                    title="Ativar no terminal (Robô PAUSADO) e abrir nos Parâmetros para editar"
                  >
                    <Play className="w-3.5 h-3.5 text-emerald-400" />
                    Ativar e editar
                  </button>
                )}
                <button
                  onClick={() => setNameModal({ mode: 'rename', id: selected.id, value: selected.name })}
                  className={btnCls}
                  title="Renomear esta estratégia"
                >
                  <Pencil className="w-3.5 h-3.5 text-slate-400" />
                  Renomear
                </button>
                <button
                  onClick={() => {
                    const dup = StrategyLibraryService.duplicate(selected.id);
                    refresh();
                    if (dup) setSelectedId(dup.id);
                  }}
                  className={btnCls}
                  title="Duplicar"
                >
                  <Copy className="w-3.5 h-3.5 text-slate-400" />
                  Duplicar
                </button>
                <button onClick={() => exportOne(selected)} className={btnCls} title="Exportar esta estratégia em .json">
                  <Download className="w-3.5 h-3.5 text-slate-400" />
                  Exportar
                </button>
                <button
                  onClick={() => setConfirmDeleteId(selected.id)}
                  className="flex items-center justify-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold rounded-lg border border-rose-500/40 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20 transition-colors cursor-pointer"
                  title="Excluir"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Excluir
                </button>
              </div>
              {!isActive(selected) && (
                <p className="text-[10px] text-slate-500 leading-snug">
                  Esta estratégia não é a ativa. Para mexer nos números, ative-a primeiro (o Robô volta
                  PAUSADO) — a edição acontece sempre na estratégia ativa, o único editor do banco.
                </p>
              )}
            </div>

            {/* Corpo: retrato somente-leitura dos parâmetros */}
            <div className="flex-1 overflow-y-auto p-3 space-y-3">
              <DetailSection
                title="Núcleo"
                icon={Layers}
                summary={`${MODE_LABEL[c.strategyMode]} · ${scaleLabel(c.boxPoints, cAsset)} · ${c.contracts} ctro${c.contracts > 1 ? 's' : ''}`}
              >
                <Row label="Modo" value={MODE_LABEL[c.strategyMode]} />
                <Row label="Ativo" value={`${cAsset.label} · ${c.symbol}`} />
                <Row label="Escala do box" value={scaleLabel(c.boxPoints, cAsset)} />
                <Row label="Contratos (mãe)" value={c.contracts} />
              </DetailSection>

              <DetailSection title="Fluxo & Regime" icon={Zap} summary={`${thresholdLabel(c)} · ${c.confirmationMode === 'BOX_CLOSE' ? 'fechamento do box' : 'rompimento no tick'}`}>
                <Row label="Δ mínimo (base)" value={c.minDeltaThreshold} />
                <Row label="Limiar adaptativo" value={yn(c.adaptiveThresholdEnabled)} />
                {c.adaptiveThresholdEnabled && <Row label="Janela (boxes)" value={c.regimeLookbackBoxes} />}
                <Row label="Filtro de acumulação" value={yn(c.consolidationFilterEnabled)} />
                {c.consolidationFilterEnabled && (
                  <>
                    <Row label="Janela ER (boxes)" value={c.consolidationLookbackBoxes} />
                    <Row label="Corte ER" value={c.consolidationErMax.toFixed(2)} />
                  </>
                )}
                <Row label="Filtro de exaustão" value={yn(c.exhaustionFilterEnabled)} />
                {c.exhaustionFilterEnabled && <Row label="Força mín. (razão)" value={c.exhaustionDeltaRatio.toFixed(2)} />}
                <Row label="Exigir CVD novo extremo" value={yn(c.requireCvdNewExtreme)} />
                <Row label="Confirmação" value={c.confirmationMode === 'BOX_CLOSE' ? 'Fechamento do box' : 'Rompimento no tick'} />
              </DetailSection>

              <DetailSection title="Entrada" icon={Play} summary={entryLabel(c)}>
                {c.strategyMode === 'PYRAMID_FLOW_CONFLUENCE' ? (
                  <>
                    <Row label="Entrada das pirâmides" value={entryLabel(c)} />
                    <Row label="TP pirâmide (pts)" value={c.pyramidTpPoints} />
                    <Row label="Stop pirâmide (pts)" value={c.pyramidSlPoints} />
                    <Row label="Ctros por pirâmide" value={c.pyramidContracts} />
                  </>
                ) : (
                  <>
                    <Row label="Gatilho" value={entryLabel(c)} />
                    {c.entryTriggerType === 'PULLBACK_ENTRY' && (
                      <>
                        <Row label="Nível do reteste" value={c.pullbackTarget} />
                        {c.pullbackTarget === 'CUSTOM_POINTS' && <Row label="Recuo (pts)" value={c.pullbackCustomPoints} />}
                        <Row label="Validade (boxes)" value={c.pullbackMaxBoxesWait} />
                      </>
                    )}
                  </>
                )}
              </DetailSection>

              <DetailSection
                title="Gestão & Proteções"
                icon={ShieldCheck}
                summary={
                  c.strategyMode === 'PULLBACK_RETEST'
                    ? `SL ${c.stopLossPoints}p · TP ${c.takeProfitPoints}p · parcial ${c.enablePartialExit ? `${c.partialPoints}p` : 'off'}`
                    : `trailing ${c.trailingStop ? `${c.trailingDistancePoints}p` : 'off'} · BE ${c.breakevenOffsetPoints}p`
                }
              >
                {c.strategyMode === 'PULLBACK_RETEST' && (
                  <>
                    <Row label="Stop Loss (pts)" value={c.stopLossPoints} />
                    <Row label="Take Profit (pts)" value={c.takeProfitPoints} />
                    <Row label="Saída parcial" value={c.enablePartialExit ? `${c.partialPoints} pts · ${c.partialContracts} ctros` : 'não'} />
                  </>
                )}
                <Row label="Piso do breakeven (pts)" value={c.breakevenOffsetPoints} />
                <Row label="Trailing" value={c.trailingStop ? `${c.trailingActivationPoints}p a favor · ${c.trailingDistancePoints}p` : 'não'} />
                {c.strategyMode === 'PYRAMID_FLOW_CONFLUENCE' && (
                  <>
                    <Row label="Mãe surfa até virada" value={yn(c.holdMainUntilFlip)} />
                    <Row label="Zerar na virada (FLIP)" value={yn(c.closeAllOnFlowFlip)} />
                    <Row label="Sem stop fixo" value={yn(c.noFixedStopLoss)} />
                  </>
                )}
              </DetailSection>

              <DetailSection
                title="Janela & Limites"
                icon={Clock}
                summary={
                  c.tradingHoursEnabled
                    ? `${c.tradingStartTime}–${c.tradingStopEntriesTime} · zeragem ${c.tradingCloseAllTime}`
                    : 'horário livre'
                }
              >
                <Row label="Filtro de horários" value={yn(c.tradingHoursEnabled)} />
                {c.tradingHoursEnabled && (
                  <>
                    <Row label="Início entradas" value={c.tradingStartTime} />
                    <Row label="Fim entradas" value={c.tradingStopEntriesTime} />
                    <Row label="Zeragem" value={c.tradingCloseAllTime} />
                  </>
                )}
                <Row label="Trava perda diária (R$)" value={c.maxDailyLoss} />
                <Row label="Meta diária (R$)" value={c.maxDailyProfit} />
                <Row label="Máx. trades/dia" value={c.maxDailyTrades} />
                <Row label="Zerar ao bater trava" value={yn(c.closeAllOnFinancialLock)} />
              </DetailSection>

              <DetailSection title="Execução MT5" icon={Wifi} summary={`${c.accountMode} · magic ${c.magicNumber} · ${c.maxSimultaneousPositions} posição(ões)`}>
                <Row label="Modo de conta" value={c.accountMode} />
                <Row label="Sinal oposto" value={c.hedgeOppositeAction} />
                <Row label="Máx. posições" value={c.maxSimultaneousPositions} />
                <Row label="Filling" value={c.orderFillingMode} />
                <Row label="Magic number" value={c.magicNumber} />
                <Row label="Comentário" value={c.orderComment || '—'} />
                <Row label="Teto ctros/ordem" value={c.mt5MaxContractsPerOrder} />
                <Row label="Teto ordens/min" value={c.mt5MaxOrdersPerMinute} />
              </DetailSection>
            </div>
          </>
        )}
      </section>

      {/* Modal de nome (criar / renomear) — nunca window.prompt */}
      {nameModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setNameModal(null)}>
          <div className="w-full max-w-sm rounded-xl border border-slate-700 bg-slate-900 p-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-semibold text-slate-100">
              {nameModal.mode === 'create' ? 'Nova estratégia' : 'Renomear estratégia'}
            </h3>
            <p className="text-[11px] text-slate-400 mt-1 leading-snug">
              {nameModal.mode === 'create'
                ? 'Ela nasce do config ativo de agora (inclusive os valores da boleta) e já é ativada — o Robô volta PAUSADO. Ajuste os números nos Parâmetros.'
                : 'O nome fica junto do retrato (profileName), então o selo e a tira acompanham.'}
            </p>
            <input
              autoFocus
              type="text"
              value={nameModal.value}
              onChange={(e) => setNameModal({ ...nameModal, value: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (nameModal.mode === 'create' ? confirmCreate : confirmRename)();
                if (e.key === 'Escape') setNameModal(null);
              }}
              placeholder="Nome da estratégia"
              className={`${inputCls} w-full mt-3`}
            />
            <div className="flex gap-2 mt-4 justify-end">
              <button onClick={() => setNameModal(null)} className="px-3 py-1.5 text-xs rounded-lg border border-slate-700 text-slate-300 hover:border-slate-600 cursor-pointer">
                Cancelar
              </button>
              <button
                onClick={() => (nameModal.mode === 'create' ? confirmCreate() : confirmRename())}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-emerald-600/50 bg-emerald-500/15 text-emerald-200 hover:bg-emerald-500/25 cursor-pointer"
              >
                <Save className="w-3.5 h-3.5" />
                {nameModal.mode === 'create' ? 'Criar e editar' : 'Salvar nome'}
              </button>
            </div>
          </div>
        </div>
      )}

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
              <span className="text-slate-200 font-medium">{confirmTarget.name}</span> será removida da biblioteca.
              {activeStrategyId
                ? activeStrategyId === confirmTarget.id
                  ? ' Ela é a estratégia ATIVA do Robô 1: ao apagar, o vínculo pelo id é limpo na caixinha e o último config materializado continua valendo, solto da biblioteca.'
                  : ' O config atual do terminal não é afetado.'
                : confirmTarget.name && activeProfileName === confirmTarget.name
                  ? ' Ela é o perfil ATIVO do Robô 1: ao apagar, o config atual continua valendo, mas a referência ao nome é limpa na caixinha.'
                  : ' O config atual do terminal não é afetado.'}
              {shadowStrategyId === confirmTarget.id
                ? ' O Robô 2 (sombra) roda exatamente ela: será desligado e ficará em "— escolher —" até você reescolher.'
                : ''}
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
                  if (selectedId === confirmTarget.id) setSelectedId(null);
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
