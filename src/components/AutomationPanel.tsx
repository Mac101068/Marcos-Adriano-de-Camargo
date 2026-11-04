import React, { useState, useEffect, useRef } from 'react';
import { AutomationConfig, ConfigPreset } from '../types/trading';
import {
  chartSymbolFor,
  pointsToBRL,
  renkoScaleLabel,
  renkoRFromBoxPoints,
  boxPointsForR,
  clampBoxPoints,
  clampRenkoR,
  RENKO_R_MAX,
  RENKO_R_MIN,
  resolveAsset,
} from '../assets/assetRegistry';
import { EaConfigService } from '../services/eaConfigService';
import { ShadowRobotPanel } from './ShadowRobotPanel';
import { SHADOW_LABEL } from '../services/shadowRobotService';
import {
  Sliders,
  Shield,
  Zap,
  TrendingUp,
  SkipForward,
  RefreshCw,
  Layers,
  ArrowRightLeft,
  Target,
  Activity,
  Save,
  Download,
  Upload,
  RotateCcw,
  Clock,
  CheckCircle,
  Hash,
  BookmarkCheck,
  Plus,
  Trash2,
  FileText,
  SlidersHorizontal,
  DollarSign,
  AlertCircle,
  Cpu
} from 'lucide-react';
import { CollapsibleSection } from './CollapsibleSection';

interface AutomationPanelProps {
  config: AutomationConfig;
  setConfig: React.Dispatch<React.SetStateAction<AutomationConfig>>;
  /**
   * FASE A (banco de dados único): editar um parâmetro de estratégia escreve de volta na
   * biblioteca e devolve o config como visão materializada. Quando presente, TODOS os edits de
   * campo passam por aqui; sem ela, o painel cai no setConfig antigo (compat).
   */
  onPatchStrategy?: (patch: Partial<AutomationConfig>) => void;
  /**
   * Fase A (banco único): perfil 1-clique, restaurar padrões e importar JSON carregam um conjunto
   * inteiro de números. Isso não é um patch de campo — é um pacote que vira estratégia na biblioteca
   * (atualiza a homônima ou cria uma nova) e é ativado por ela. Sem a prop, o painel cai no caminho
   * antigo de config apenas, ainda com o Robô pausado.
   */
  onApplyConfigBundle?: (cfg: AutomationConfig, name?: string) => void;
  /**
   * Fase A (regra 8/13): nome da estratégia ativa resolvido pelo id no App. Este painel é o
   * EDITOR da estratégia ativa, então o cabeçalho mostra o nome autoritativo (não o `profileName`
   * que pode estar defasado). Sem ele, cai no `config.profileName` (compat).
   */
  activeStrategyName?: string | null;
  simulationSpeed: number;
  setSimulationSpeed: (speed: number) => void;
  onStepTick: () => void;
  onInjectLargeAggression: (type: 'BUY' | 'SELL') => void;
  onResetData: () => void;
  /**
   * Atalho vindo de outra tela (o chip da escala no gráfico): ao receber 'renkoBox' a página
   * rola até o campo do box e ele pisca. É um token de uso único — o painel consome e avisa.
   */
  focusParam?: 'renkoBox' | null;
  onFocusParamConsumed?: () => void;
}

/** Quantos tijolos cabem em N pontos (com o box editável, a conta nunca é mais "÷ 50"). */
function formatBoxes(points: number, boxPoints: number): string {
  const box = boxPoints > 0 ? boxPoints : 50;
  return String(Math.round((points / box) * 100) / 100);
}

/**
 * Linha de perfil rápido: mesmo formato das linhas do acordeão (título + resumo dos números numa
 * linha só). O clique aplica o perfil em 1-clique, como antes; a descrição completa fica no
 * tooltip. Era um card de 4 colunas — virou lista para não lotar a tela.
 */
const PresetRow: React.FC<{
  preset: ConfigPreset;
  isCurrent: boolean;
  accent: 'emerald' | 'neutral';
  onApply: () => void;
  onDelete?: () => void;
}> = ({ preset, isCurrent, accent, onApply, onDelete }) => {
  const c = preset.config;
  const entrada = c.entryTriggerType === 'PULLBACK_ENTRY' ? 'pullback' : 'a mercado';
  const summary = `SL ${c.stopLossPoints}p · TP ${c.takeProfitPoints}p · ${entrada} · ${c.contracts} ctros · Δ ${c.minDeltaThreshold}`;
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onApply}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onApply();
        }
      }}
      title={preset.description}
      className={`w-full flex items-center gap-2 px-3 py-2 rounded-xl border text-left cursor-pointer transition-colors ${
        isCurrent
          ? accent === 'emerald'
            ? 'bg-emerald-950/40 border-emerald-500/60 ring-1 ring-emerald-500/30'
            : 'bg-neutral-950/40 border-neutral-500/60 ring-1 ring-neutral-500/30'
          : 'bg-slate-900/50 border-slate-800 hover:border-slate-700 hover:bg-slate-900/80'
      }`}
    >
      <span
        className={`shrink-0 max-w-[92px] truncate text-[9px] font-mono px-1.5 py-0.5 rounded font-bold ${
          isCurrent
            ? accent === 'emerald'
              ? 'bg-emerald-500/20 text-emerald-300'
              : 'bg-neutral-500/20 text-neutral-300'
            : 'bg-slate-800 text-slate-400'
        }`}
      >
        {preset.badge}
      </span>
      <span className="flex-1 min-w-0">
        <span className="block text-xs font-semibold text-slate-200 truncate">{preset.name}</span>
        <span className="block text-[10px] font-mono text-slate-500 mt-0.5 truncate">{summary}</span>
      </span>
      {isCurrent && (
        <span
          className={`shrink-0 flex items-center gap-1 text-[10px] font-semibold ${
            accent === 'emerald' ? 'text-emerald-400' : 'text-neutral-400'
          }`}
        >
          <CheckCircle className="w-3 h-3" />
          ATIVO
        </span>
      )}
      {onDelete && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="shrink-0 text-slate-400 hover:text-rose-400 p-1 rounded hover:bg-rose-500/15 transition-colors cursor-pointer"
          title={`Excluir perfil "${preset.name}"`}
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
};

export const AutomationPanel: React.FC<AutomationPanelProps> = ({
  config,
  setConfig,
  onPatchStrategy,
  onApplyConfigBundle,
  activeStrategyName,
  simulationSpeed,
  setSimulationSpeed,
  onStepTick,
  onInjectLargeAggression,
  onResetData,
  focusParam,
  onFocusParamConsumed,
}) => {
  const [saveToast, setSaveToast] = useState<string | null>(null);
  const [customProfiles, setCustomProfiles] = useState<ConfigPreset[]>(() =>
    EaConfigService.getCustomProfiles()
  );
  const [showSaveProfileModal, setShowSaveProfileModal] = useState<boolean>(false);
  const [newProfileName, setNewProfileName] = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Escala do box: caixa editável (o slider de 25 em 25 pts não alcançava 8R/9R/29R) ──
  // R em curso no teclado (null = refletir a config). A derivação dos dois campos vive logo após
  // o `asset`, porque é a variação mínima dele que encaixa o valor digitado.
  const [boxRDraft, setBoxRDraft] = useState<string | null>(null);
  const [boxPtsDraft, setBoxPtsDraft] = useState<string | null>(null);

  // ── Atalho do gráfico (focusParam === 'renkoBox') ──
  const renkoFieldRef = useRef<HTMLDivElement>(null);
  const [renkoFlash, setRenkoFlash] = useState<boolean>(false);
  useEffect(() => {
    if (focusParam !== 'renkoBox') return;
    // Consome ANTES de qualquer outra coisa: o token some do estado do App no mesmo commit, senão
    // cada tick do feed re-renderizaria o painel e religaria o efeito (rolagem brigando com o usuário).
    onFocusParamConsumed?.();
    const el = renkoFieldRef.current;
    if (!el) return;
    // Um frame de espera: o painel acabou de montar com a troca de aba, o layout ainda não fechou.
    const raf = window.requestAnimationFrame(() => {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setRenkoFlash(true);
    });
    const timer = window.setTimeout(() => setRenkoFlash(false), 1800);
    return () => {
      window.cancelAnimationFrame(raf);
      window.clearTimeout(timer);
    };
  }, [focusParam, onFocusParamConsumed]);

  const builtInPresets = EaConfigService.getBuiltInPresets();

  // Função utilitária para aplicar alterações e persistir automaticamente
  const handleConfigChange = <K extends keyof AutomationConfig>(
    key: K,
    value: AutomationConfig[K]
  ) => {
    // Fase A: roteia pelo funil da estratégia ativa (write-through na biblioteca + materialização).
    if (onPatchStrategy) {
      onPatchStrategy({ [key]: value } as Partial<AutomationConfig>);
      return;
    }
    setConfig((prev) => {
      const updated: AutomationConfig = {
        ...prev,
        [key]: value,
        lastSavedTimestamp: Date.now(),
      };
      EaConfigService.saveConfig(updated);
      return updated;
    });
  };

  const showNotification = (msg: string) => {
    setSaveToast(msg);
    setTimeout(() => {
      setSaveToast(null);
    }, 3500);
  };

  const handleManualSave = () => {
    const res = EaConfigService.saveConfig(config);
    if (res.success) {
      showNotification('✅ Configuração do EA registrada e salva na memória local!');
    }
  };

  const handleApplyPreset = (preset: ConfigPreset) => {
    const updated: AutomationConfig = {
      ...preset.config,
      profileName: preset.name,
      // Aplicar um perfil carrega números, não liga o mercado: o boot permanece parado (regra do
      // projeto) e quem quiser operar usa o On do header.
      active: false,
      lastSavedTimestamp: Date.now(),
    };
    if (onApplyConfigBundle) {
      // Banco único: o perfil entra como estratégia da biblioteca e o config vira a visão dela.
      onApplyConfigBundle(updated, preset.name);
      showNotification(`⚡ Perfil "${preset.name}" virou estratégia ativa na biblioteca (Robô pausado).`);
      return;
    }
    setConfig(updated);
    EaConfigService.saveConfig(updated);
    showNotification(`⚡ Perfil "${preset.name}" carregado e registrado no EA!`);
  };
  const handleCreateCustomProfile = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProfileName.trim()) return;

    const created = EaConfigService.saveCustomProfile(newProfileName.trim(), config);
    setCustomProfiles(EaConfigService.getCustomProfiles());
    handleConfigChange('profileName', created.name);
    setNewProfileName('');
    setShowSaveProfileModal(false);
    showNotification(`⭐ Perfil do Operador "${created.name}" salvo com sucesso!`);
  };

  const [profileToDelete, setProfileToDelete] = useState<{ id: string; name: string } | null>(null);
  const [showResetConfirmModal, setShowResetConfirmModal] = useState<boolean>(false);

  const confirmDeleteCustomProfile = () => {
    if (!profileToDelete) return;
    const { id, name } = profileToDelete;
    EaConfigService.deleteCustomProfile(id);
    const updated = EaConfigService.getCustomProfiles();
    setCustomProfiles(updated);
    if (config.profileName === name) {
      const fallbackPreset = builtInPresets[0];
      handleApplyPreset(fallbackPreset);
    }
    setProfileToDelete(null);
    showNotification(`🗑️ Perfil "${name}" excluído com sucesso!`);
  };

  const confirmResetToDefaults = () => {
    const def = EaConfigService.resetToDefault();
    // O que a fábrica entrega hoje é a Pirâmide & Confluência sem SL/TP fixos (ver DEFAULT_EA_CONFIG),
    // então a estratégia criada no banco tem nome que diz isso — não colide com os cards de perfil.
    const name = 'Padrão de Fábrica (Pirâmide 10R)';
    if (onApplyConfigBundle) {
      // O padrão NÃO apaga a sua estratégia: ele entra como a estratégia homônima do banco e é
      // ativado. A que estava em uso continua inteira no Estúdio, com os seus números.
      onApplyConfigBundle({ ...def, profileName: name, active: false }, name);
      setShowResetConfirmModal(false);
      showNotification(`🔄 Padrão de fábrica carregado como estratégia "${name}" (Robô pausado).`);
      return;
    }
    const paused = { ...def, profileName: name, active: false };
    setConfig(paused);
    EaConfigService.saveConfig(paused); // persiste pausado: o resetToDefault() de cima gravou active:true
    setShowResetConfirmModal(false);
    showNotification('🔄 Configurações restauradas para o padrão de fábrica (Robô pausado).');
  };

  const handleExportJson = () => {
    const jsonStr = EaConfigService.exportConfigAsJson(config);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `config_ea_renko10r_${config.symbol}_${Date.now()}.json`;
    link.click();
    URL.revokeObjectURL(url);
    showNotification('⬇️ Arquivo JSON de configuração exportado!');
  };

  const handleImportJson = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const content = event.target?.result as string;
        const imported = EaConfigService.importConfigFromJson(content);
        const name = imported.profileName || 'Configuração Importada';
        if (onApplyConfigBundle) {
          // O JSON importado é um conjunto fechado de números: vira estratégia no banco (reusa a
          // homônima, senão cria) em vez de só por cima do config.
          onApplyConfigBundle({ ...imported, active: false }, name);
          showNotification(`⬆️ "${name}" importada para a biblioteca e ativada (Robô pausado).`);
          return;
        }
        setConfig({ ...imported, active: false });
        EaConfigService.saveConfig({ ...imported, active: false }); // o import gravou com o default active:true
        showNotification('⬆️ Configuração importada e registrada com sucesso!');
      } catch (err) {
        showNotification('❌ Erro ao importar arquivo JSON: formato inválido.');
      }
    };
    reader.readAsText(file);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // Números do ativo da estratégia (R$/ponto e tick). Só converte e rotula: nenhum parâmetro,
  // campo ou ordem desta tela muda por causa disso.
  const asset = resolveAsset(config.symbol, config.assetId);
  const slFinancial = pointsToBRL(config.stopLossPoints, config.contracts, asset).toFixed(2);
  const tpFinancial = pointsToBRL(config.takeProfitPoints, config.contracts, asset).toFixed(2);

  // O operador digita em R (a língua dele) ou nos pontos (a unidade do motor); a config guarda
  // sempre pontos, encaixados na variação mínima do ativo. Os dois campos se acompanham.
  const currentRenkoR = renkoRFromBoxPoints(config.boxPoints, asset);
  const tick = asset.tickSize > 0 ? asset.tickSize : 1;
  const pendingR = (() => {
    if (boxRDraft === null || boxRDraft.trim() === '') return null;
    const n = Number(boxRDraft);
    if (!Number.isFinite(n) || n <= 0) return null;
    return clampRenkoR(n);
  })();
  const pendingPts = (() => {
    if (boxPtsDraft === null || boxPtsDraft.trim() === '') return null;
    const n = Number(boxPtsDraft);
    if (!Number.isFinite(n) || n <= 0) return null;
    return clampBoxPoints(n, asset);
  })();
  // enquanto um dos campos está sendo digitado, o outro mostra o resultado que vai sair
  const targetPts = pendingPts ?? (pendingR !== null ? boxPointsForR(pendingR, asset) : null);
  const displayedR = boxRDraft ?? String(targetPts !== null ? renkoRFromBoxPoints(targetPts, asset) : currentRenkoR);
  const displayedPts = boxPtsDraft ?? String(targetPts !== null ? targetPts : config.boxPoints);
  const hasPendingBox = targetPts !== null && targetPts !== config.boxPoints;

  const applyRenkoBox = (fromR: boolean) => {
    if (fromR && pendingR !== null) handleConfigChange('boxPoints', boxPointsForR(pendingR, asset));
    if (!fromR && pendingPts !== null) handleConfigChange('boxPoints', pendingPts);
    setBoxRDraft(null);
    setBoxPtsDraft(null);
  };

  const formattedSavedDate = config.lastSavedTimestamp
    ? new Date(config.lastSavedTimestamp).toLocaleString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })
    : 'Registrado Agora';

  return (
    <div className="flex flex-col h-full bg-slate-950 border border-slate-800/80 rounded-lg p-3 sm:p-5 overflow-y-auto space-y-6">
      {/* Toast de Confirmação de Registro */}
      {saveToast && (
        <div className="fixed top-16 right-4 z-50 flex items-center gap-2.5 bg-emerald-950/95 border border-emerald-500/60 text-emerald-200 px-4 py-2.5 rounded-lg shadow-xl text-xs font-semibold animate-in fade-in slide-in-from-top-2 duration-200">
          <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{saveToast}</span>
        </div>
      )}

      {/* CABEÇALHO DO PAINEL & STATUS DA MEMÓRIA DO EA */}
      <div className="bg-slate-900/90 border border-slate-800 p-4 rounded-xl flex flex-col lg:flex-row lg:items-center justify-between gap-4 shadow-sm">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-bold text-slate-100 flex items-center gap-2">
              <Sliders className="w-4 h-4 text-emerald-400" />
              Painel de Configuração do EA & Memória Operacional
            </h2>
            <span className="px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 font-mono text-[10px] font-semibold flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              CONFIGURAÇÃO REGISTRADA
            </span>
          </div>
          <p className="text-xs text-slate-400 flex flex-wrap items-center gap-3">
            <span>
              Estratégia ativa:{' '}
              <strong className="text-emerald-300 font-mono">
                {activeStrategyName || config.profileName || '10R Institucional'}
              </strong>
            </span>
            <span className="text-slate-600 hidden sm:inline">•</span>
            <span className="flex items-center gap-1 text-slate-400">
              <Clock className="w-3.5 h-3.5 text-slate-500" />
              Último Registro: <span className="font-mono text-slate-300">{formattedSavedDate}</span>
            </span>
          </p>
        </div>

        {/* Botões de Ação do Operador */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={handleManualSave}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-emerald-300 bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/40 rounded-lg transition-colors cursor-pointer"
            title="Registrar e persistir parâmetros atuais"
          >
            <Save className="w-3.5 h-3.5" />
            Registrar Agora
          </button>

          <button
            onClick={() => setShowSaveProfileModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-neutral-300 bg-neutral-500/15 hover:bg-neutral-500/25 border border-neutral-500/40 rounded-lg transition-colors cursor-pointer"
            title="Salvar configuração atual como um novo perfil"
          >
            <Plus className="w-3.5 h-3.5" />
            Salvar Perfil
          </button>

          <button
            onClick={handleExportJson}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-slate-300 bg-slate-900 hover:bg-slate-800 border border-slate-700 rounded-lg transition-colors cursor-pointer"
            title="Exportar configuração em JSON"
          >
            <Download className="w-3.5 h-3.5 text-slate-400" />
            <span className="hidden sm:inline">Exportar</span>
          </button>

          <label
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-slate-300 bg-slate-900 hover:bg-slate-800 border border-slate-700 rounded-lg transition-colors cursor-pointer"
            title="Importar configuração de arquivo JSON"
          >
            <Upload className="w-3.5 h-3.5 text-slate-400" />
            <span className="hidden sm:inline">Importar</span>
            <input
              type="file"
              ref={fileInputRef}
              accept=".json"
              onChange={handleImportJson}
              className="hidden"
            />
          </label>

          <button
            onClick={() => setShowResetConfirmModal(true)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-slate-400 hover:text-slate-200 bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded-lg transition-colors cursor-pointer"
            title="Restaurar parâmetros recomendados"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span className="hidden md:inline">Padrões</span>
          </button>
        </div>
      </div>

      {/* MODAL / CARD DE NOVO PERFIL DO OPERADOR */}
      {showSaveProfileModal && (
        <form
          onSubmit={handleCreateCustomProfile}
          className="bg-slate-900 border border-neutral-500/40 p-4 rounded-xl space-y-3 animate-in fade-in slide-in-from-top-2"
        >
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold text-neutral-300 flex items-center gap-1.5">
              <BookmarkCheck className="w-4 h-4 text-neutral-400" />
              Salvar Configuração Atual como Perfil do Operador
            </h3>
            <button
              type="button"
              onClick={() => setShowSaveProfileModal(false)}
              className="text-slate-400 hover:text-slate-200 text-xs cursor-pointer"
            >
              Cancelar
            </button>
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="Ex: Setup 10R Marcos Scalper ou Trend Agressivo"
              value={newProfileName}
              onChange={(e) => setNewProfileName(e.target.value)}
              className="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-100 focus:border-neutral-500 focus:outline-hidden"
              autoFocus
            />
            <button
              type="submit"
              disabled={!newProfileName.trim()}
              className="px-4 py-1.5 bg-neutral-600 hover:bg-neutral-500 disabled:opacity-50 text-white text-xs font-semibold rounded-lg transition-colors cursor-pointer"
            >
              Salvar Perfil
            </button>
          </div>
        </form>
      )}

      {/* MODAL DE CONFIRMAÇÃO DE EXCLUSÃO DE PERFIL */}
      {profileToDelete && (
        <div className="bg-rose-950/40 border border-rose-500/50 p-4 rounded-xl space-y-3 animate-in fade-in slide-in-from-top-2">
          <div className="flex items-start gap-3">
            <div className="p-2 bg-rose-500/20 rounded-lg text-rose-400 shrink-0">
              <Trash2 className="w-5 h-5" />
            </div>
            <div className="space-y-1 flex-1">
              <h3 className="text-xs font-bold text-rose-300">
                Confirmar Exclusão de Perfil Salvo
              </h3>
              <p className="text-xs text-slate-300">
                Tem certeza que deseja excluir o perfil{' '}
                <strong className="text-rose-200">"{profileToDelete.name}"</strong>? Esta ação removerá as definições da memória local do EA.
              </p>
            </div>
          </div>
          <div className="flex items-center justify-end gap-2 pt-2 border-t border-rose-500/20">
            <button
              type="button"
              onClick={() => setProfileToDelete(null)}
              className="px-3 py-1.5 rounded-lg border border-slate-700 bg-slate-900 hover:bg-slate-800 text-xs text-slate-300 transition-colors cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={confirmDeleteCustomProfile}
              className="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-xs font-bold text-white transition-colors cursor-pointer flex items-center gap-1.5"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Sim, Excluir Perfil
            </button>
          </div>
        </div>
      )}

      {/* MODAL DE CONFIRMAÇÃO DE RESTAURAÇÃO PARA PADRÕES */}
      {showResetConfirmModal && (
        <div className="bg-amber-950/40 border border-amber-500/50 p-4 rounded-xl space-y-3 animate-in fade-in slide-in-from-top-2">
          <div className="flex items-start gap-3">
            <div className="p-2 bg-amber-500/20 rounded-lg text-amber-400 shrink-0">
              <RotateCcw className="w-5 h-5" />
            </div>
            <div className="space-y-1 flex-1">
              <h3 className="text-xs font-bold text-amber-300">
                Restaurar Padrões de Fábrica do EA?
              </h3>
              <p className="text-xs text-slate-300">
                Carrega a parametrização de fábrica (Pirâmide &amp; Confluência, entrada no fechamento do
                bloco, sem SL/TP fixos na mãe). Ela entra como a estratégia
                <b> "Padrão de Fábrica (Pirâmide 10R)"</b> na biblioteca e passa a ser a ativa — a
                estratégia que está em uso <b>não é apagada</b>: continua no Estúdio com os seus números.
                O Robô fica <b>pausado</b>.
              </p>
            </div>
          </div>
          <div className="flex items-center justify-end gap-2 pt-2 border-t border-amber-500/20">
            <button
              type="button"
              onClick={() => setShowResetConfirmModal(false)}
              className="px-3 py-1.5 rounded-lg border border-slate-700 bg-slate-900 hover:bg-slate-800 text-xs text-slate-300 transition-colors cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={confirmResetToDefaults}
              className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-xs font-bold text-slate-950 transition-colors cursor-pointer flex items-center gap-1.5"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Restaurar Padrões
            </button>
          </div>
        </div>
      )}

      {/* SELEÇÃO DE PERFIS ESTRATÉGICOS PRONTOS — uma linha por perfil, fechada por padrão */}
      <CollapsibleSection
        title="Perfis de Configuração Rápida (1-clique)"
        icon={SlidersHorizontal}
        trailing={
          <span className="text-[10px] font-mono text-slate-500 shrink-0">
            {builtInPresets.length + customProfiles.length} perfis
          </span>
        }
        summary={`em uso: ${config.profileName || '—'} · abrir e tocar num perfil aplica na hora`}
      >
        <div className="flex flex-col gap-1.5">
          {builtInPresets.map((p) => (
            <PresetRow
              key={p.id}
              preset={p}
              accent="emerald"
              isCurrent={config.profileName === p.name}
              onApply={() => handleApplyPreset(p)}
            />
          ))}

          {/* Perfis Salvos pelo Usuário */}
          {customProfiles.map((cp) => (
            <PresetRow
              key={cp.id}
              preset={cp}
              accent="neutral"
              isCurrent={config.profileName === cp.name}
              onApply={() => handleApplyPreset(cp)}
              onDelete={() => setProfileToDelete({ id: cp.id, name: cp.name })}
            />
          ))}
        </div>
      </CollapsibleSection>

      {/* ========================================================================= */}
      {/* SELETOR PRINCIPAL DA MODALIDADE DE ESTRATÉGIA QUANTITATIVA                */}
      {/* ========================================================================= */}
      <div className="bg-slate-900/90 border border-emerald-500/30 p-4 rounded-xl space-y-3.5 shadow-lg">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800 pb-2.5">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-emerald-500/20 text-emerald-400">
              <Zap className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-xs font-bold text-slate-100 uppercase tracking-wider">
                Modalidade de Estratégia Quantitativa Ativa
              </h3>
              <p className="text-[11px] text-slate-400">
                Selecione como o robô deve orquestrar as ordens no fechamento de cada tijolo Renko
              </p>
            </div>
          </div>
          <span className="text-[10px] font-mono px-2 py-0.5 rounded font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 self-start sm:self-auto">
            {config.strategyMode === 'PYRAMID_FLOW_CONFLUENCE'
              ? '🚀 PIRÂMIDE FLUXO & RENKO (TP 50P + SURFE)'
              : '🎯 RETESTE / PULLBACK CLÁSSICO'}
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {/* Opção 1: Pirâmide com Confluência de Fluxo */}
          <div
            onClick={() => handleConfigChange('strategyMode', 'PYRAMID_FLOW_CONFLUENCE')}
            className={`p-3.5 rounded-lg border text-left cursor-pointer transition-all ${
              config.strategyMode === 'PYRAMID_FLOW_CONFLUENCE'
                ? 'bg-emerald-950/40 border-emerald-500 ring-1 ring-emerald-500/50 shadow-md'
                : 'bg-slate-950/60 border-slate-800 hover:border-slate-700 hover:bg-slate-900'
            }`}
          >
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] font-bold font-mono px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300">
                ESTRATÉGIA SOLICITADA
              </span>
              {config.strategyMode === 'PYRAMID_FLOW_CONFLUENCE' && (
                <span className="flex items-center gap-1 text-[11px] font-bold text-emerald-400">
                  <CheckCircle className="w-3.5 h-3.5" />
                  EM EXECUÇÃO
                </span>
              )}
            </div>
            <h4 className="text-xs font-bold text-slate-100 flex items-center gap-1.5">
              <span>🚀 Pirâmide com Confluência de Fluxo & Renko 10R</span>
            </h4>
            <p className="text-[11px] text-slate-300 mt-1 leading-relaxed">
              Compra a cada bloco verde fechado (+50 pts TP na pirâmide), mantendo a entrada principal aberta surfando a tendência até a virada de fluxo. Zeragem total por inversão sem SL fixo.
            </p>
            <div className="mt-2.5 pt-2 border-t border-slate-800 text-[10px] font-mono text-emerald-400/90 flex flex-wrap gap-x-3 gap-y-1">
              <span>✓ TP Pirâmide: +50 pts</span>
              <span>✓ Principal: Surfe Contínuo</span>
              <span>✓ Saída: Inversão de Fluxo</span>
            </div>
          </div>

          {/* Opção 2: Pullback / Reteste Tradicional */}
          <div
            onClick={() => handleConfigChange('strategyMode', 'PULLBACK_RETEST')}
            className={`p-3.5 rounded-lg border text-left cursor-pointer transition-all ${
              config.strategyMode === 'PULLBACK_RETEST'
                ? 'bg-neutral-950/40 border-neutral-500 ring-1 ring-neutral-500/50 shadow-md'
                : 'bg-slate-950/60 border-slate-800 hover:border-slate-700 hover:bg-slate-900'
            }`}
          >
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] font-bold font-mono px-1.5 py-0.5 rounded bg-neutral-500/20 text-neutral-300">
                CLÁSSICO
              </span>
              {config.strategyMode === 'PULLBACK_RETEST' && (
                <span className="flex items-center gap-1 text-[11px] font-bold text-neutral-400">
                  <CheckCircle className="w-3.5 h-3.5" />
                  EM EXECUÇÃO
                </span>
              )}
            </div>
            <h4 className="text-xs font-bold text-slate-100">
              🎯 Reteste na Abertura do Box (Pullback Limite)
            </h4>
            <p className="text-[11px] text-slate-300 mt-1 leading-relaxed">
              Posiciona ordem limitada na abertura do bloco (50 pts de retorno). Saída parcial em +50 pts com Breakeven protegido e SL fixo de 100 pts.
            </p>
            <div className="mt-2.5 pt-2 border-t border-slate-800 text-[10px] font-mono text-neutral-400/90 flex flex-wrap gap-x-3 gap-y-1">
              <span>✓ Ordem Limitada</span>
              <span>✓ SL: 100 pts</span>
              <span>✓ Parcial + Breakeven</span>
            </div>
          </div>
        </div>

        {/* Parâmetros específicos removidos daqui — vivem no bloco dedicado da estratégia ativa abaixo */}
      </div>

      {/* ========================================================================= */}
      {/* BLOCO DEDICADO: PARÂMETROS DA ESTRATÉGIA PIRÂMIDE ATIVA (tudo num só lugar) */}
      {/* ========================================================================= */}
      {config.strategyMode === 'PYRAMID_FLOW_CONFLUENCE' && (
        <CollapsibleSection
          title="Parâmetros da Pirâmide Ativa"
          icon={Layers}
          iconClass="text-emerald-400"
          trailing={<span className="text-[10px] font-mono text-slate-500 shrink-0">PIRÂMIDE</span>}
          summary={`ENTRADA: ${config.pyramidEntryType === 'BOX_50_LIMIT'
            ? 'LIMIT A 50% DO BOX'
            : config.pyramidEntryType === 'BOX_OPEN_LIMIT'
            ? 'LIMIT NA ENTRADA DO BOX'
            : 'MERCADO NO FECHAMENTO DO BLOCO'} · MÁX 10 NÍVEIS${config.moveMainToBreakevenOnPyramidTp ? ' · MÃE NO BREAKEVEN' : ''}${config.trailingStop ? ' · MÃE NO TRAILING' : ''}`}
        >

          <div className="flex flex-col gap-3 text-xs">
            {/* Card 1: ORDEM MÃE (SURFE) */}
            <div className="bg-slate-950/70 p-3.5 rounded-lg border border-slate-800 space-y-2.5">
              <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider block">🏄 Ordem Mãe (Surfe)</span>
              <div>
                <label className="block text-slate-400 mb-1">Contratos da Ordem Mãe</label>
                <input
                  type="number"
                  min="1"
                  max="100"
                  value={config.contracts}
                  onChange={(e) => handleConfigChange('contracts', Math.max(1, Number(e.target.value)))}
                  className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-slate-100 font-mono focus:border-emerald-500 focus:outline-hidden"
                />
                <span className="text-[10px] text-slate-500 mt-0.5 block">
                  Aberta no 1º bloco do sinal e mantida até a virada do fluxo
                  {config.moveMainToBreakevenOnPyramidTp
                    ? ` (protegida no breakeven +${config.breakevenOffsetPoints ?? 5} pts quando uma pirâmide bate o TP).`
                    : config.trailingStop
                    ? ` (protegida pelo gatilho de +${config.trailingActivationPoints ?? 60} pts).`
                    : ' (sem TP/SL fixos).'}
                  {config.trailingStop
                    ? ` Depois do gatilho, o stop ainda acompanha a perna a ${config.trailingDistancePoints ?? 50} pts.`
                    : ''}
                </span>
              </div>
              <label className="flex items-start gap-2 text-slate-300 cursor-pointer pt-1">
                <input
                  type="checkbox"
                  checked={config.holdMainUntilFlip !== false}
                  onChange={(e) => handleConfigChange('holdMainUntilFlip', e.target.checked)}
                  className="w-3.5 h-3.5 rounded accent-emerald-500 cursor-pointer mt-0.5"
                />
                <span>Surfar até inversão do fluxo</span>
              </label>
            </div>

            {/* Card 2: ORDENS DA PIRÂMIDE (contratos + TP obrigatório + stop opcional) */}
            <div className="bg-slate-950/70 p-3.5 rounded-lg border border-emerald-500/30 space-y-2.5">
              <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider block">🔺 Ordens da Pirâmide</span>
              <div>
                <label className="block text-slate-400 mb-1">Contratos por Pirâmide</label>
                <input
                  type="number"
                  min="1"
                  max="20"
                  value={config.pyramidContracts || 1}
                  onChange={(e) => handleConfigChange('pyramidContracts', Math.max(1, Number(e.target.value)))}
                  className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-slate-100 font-mono focus:border-emerald-500 focus:outline-hidden"
                />
              </div>
              <div>
                <label className="block text-slate-400 mb-1">Alvo TP da Pirâmide</label>
                <div className="flex items-center gap-1.5">
                  <input
                    type="number"
                    min="25"
                    max="150"
                    step="25"
                    value={config.pyramidTpPoints || 50}
                    onChange={(e) => handleConfigChange('pyramidTpPoints', Math.max(25, Number(e.target.value) || 25))}
                    className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-slate-100 font-mono focus:border-emerald-500 focus:outline-hidden"
                  />
                  <span className="text-[11px] font-mono text-emerald-400 font-bold shrink-0">pts</span>
                </div>
                <span className="text-[10px] text-emerald-400/80 mt-0.5 block">
                  Obrigatório: zero não é válido — mínimo 25 pts (50 pts = 1 box a favor).
                </span>
              </div>
              <div>
                <label className="block text-slate-400 mb-1">Stop da Pirâmide (opcional)</label>
                <div className="flex items-center gap-1.5">
                  <input
                    type="number"
                    min="0"
                    max="150"
                    step="25"
                    value={config.pyramidSlPoints ?? 0}
                    onChange={(e) => {
                      const raw = Number(e.target.value) || 0;
                      // 0 = sem stop fixo; valores entre 1 e 24 não são válidos → sobem para 25
                      handleConfigChange('pyramidSlPoints', raw <= 0 ? 0 : Math.max(25, raw));
                    }}
                    className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-slate-100 font-mono focus:border-rose-500 focus:outline-hidden"
                  />
                  <span className="text-[11px] font-mono text-rose-400 font-bold shrink-0">pts</span>
                </div>
                <span className={`text-[10px] mt-0.5 block ${(config.pyramidSlPoints ?? 0) === 0 ? 'text-slate-500' : 'text-rose-300/90'}`}>
                  {(config.pyramidSlPoints ?? 0) === 0
                    ? '0 = sem stop fixo: saída só pela inversão do fluxo (regra clássica).'
                    : `Proteção extra: cada pirâmide será liquidada se perder ${config.pyramidSlPoints} pts.`}
                </span>
              </div>
              <div>
                <label className="block text-slate-400 mb-1">Tipo de Entrada (Mãe e Pirâmide)</label>
                <select
                  value={config.pyramidEntryType || 'MARKET_ON_CLOSE'}
                  onChange={(e) =>
                    handleConfigChange(
                      'pyramidEntryType',
                      e.target.value as 'MARKET_ON_CLOSE' | 'BOX_50_LIMIT' | 'BOX_OPEN_LIMIT'
                    )
                  }
                  className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-slate-100 font-mono text-[11px] focus:border-emerald-500 focus:outline-hidden font-semibold"
                >
                  <option value="MARKET_ON_CLOSE">⚡ Fechamento a Mercado</option>
                  <option value="BOX_50_LIMIT">🎯 50% do Box (Limit)</option>
                  <option value="BOX_OPEN_LIMIT">🚪 Entrada do Box (Limit)</option>
                </select>
                <span className="block text-[10px] text-slate-500 mt-0.5">
                  {config.pyramidEntryType === 'BOX_50_LIMIT'
                    ? 'Limit na metade do box que fechou (renko, range ou pontos): só executa se o preço recuar.'
                    : config.pyramidEntryType === 'BOX_OPEN_LIMIT'
                    ? 'Limit na abertura do box que fechou (recuo de 100%): entrada mais barata, risco de não ser executada.'
                    : 'Executa a mercado no preço de fechamento do bloco.'}
                </span>
              </div>
              {config.pyramidEntryType !== 'MARKET_ON_CLOSE' && (
                <div>
                  <label className="block text-slate-400 mb-1">Validade da Limit (boxes)</label>
                  <input
                    type="number"
                    min="1"
                    max="10"
                    value={config.pullbackMaxBoxesWait ?? 2}
                    onChange={(e) =>
                      handleConfigChange('pullbackMaxBoxesWait', Math.min(10, Math.max(1, Number(e.target.value) || 1)))
                    }
                    className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-slate-100 font-mono focus:border-emerald-500 focus:outline-hidden"
                  />
                  <span className="block text-[10px] text-slate-500 mt-0.5">
                    Se o preço não recuar até a Limit em {config.pullbackMaxBoxesWait ?? 2} box(es), a ordem é cancelada.
                  </span>
                </div>
              )}
            </div>

            {/* Card 3: REGRAS DE SAÍDA */}
            <div className="bg-slate-950/70 p-3.5 rounded-lg border border-slate-800 space-y-2.5">
              <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider block">🔄 Regras de Saída</span>
              <label className="flex items-start gap-2 text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={config.closeAllOnFlowFlip !== false}
                  onChange={(e) => handleConfigChange('closeAllOnFlowFlip', e.target.checked)}
                  className="w-3.5 h-3.5 rounded accent-emerald-500 cursor-pointer mt-0.5"
                />
                <span>Zerar TUDO na inversão do fluxo (mãe + pirâmides)</span>
              </label>

              {/* Proteção da Ordem Mãe: breakeven no TP da pirâmide + gatilho e acompanhamento */}
              <div className="space-y-2.5 pt-2 border-t border-slate-800">
                <span className="text-[10px] font-bold text-emerald-400/90 uppercase tracking-wider block">
                  🛡️ Proteção da Ordem Mãe
                </span>

                <label className="flex items-start gap-2 text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={config.moveMainToBreakevenOnPyramidTp === true}
                    onChange={(e) => handleConfigChange('moveMainToBreakevenOnPyramidTp', e.target.checked)}
                    className="w-3.5 h-3.5 rounded accent-emerald-500 cursor-pointer mt-0.5"
                  />
                  <span>Breakeven na mãe ao bater TP de pirâmide</span>
                </label>

                <label className="flex items-start gap-2 text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={config.trailingStop === true}
                    onChange={(e) => handleConfigChange('trailingStop', e.target.checked)}
                    className="w-3.5 h-3.5 rounded accent-emerald-500 cursor-pointer mt-0.5"
                  />
                  <span>Proteção móvel da mãe (gatilho + acompanhamento)</span>
                </label>

                {(config.moveMainToBreakevenOnPyramidTp || config.trailingStop) && (
                  <div className="ml-5 space-y-2.5">
                    {config.trailingStop && (
                      <div>
                        <label className="block text-slate-400 mb-1">Gatilho de ativação</label>
                        <div className="flex items-center gap-1.5">
                          <input
                            type="number"
                            min="25"
                            max="500"
                            step="25"
                            value={config.trailingActivationPoints ?? 60}
                            onChange={(e) =>
                              handleConfigChange('trailingActivationPoints', Math.max(25, Number(e.target.value) || 25))
                            }
                            className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-slate-100 font-mono focus:border-emerald-500 focus:outline-hidden"
                          />
                          <span className="text-[11px] font-mono text-emerald-400 font-bold shrink-0">pts a favor</span>
                        </div>
                        <span className="block text-[10px] text-slate-500 mt-0.5">
                          Nada de stop antes disso: a mãe surfa os primeiros {config.trailingActivationPoints ?? 60} pts livre.
                        </span>
                      </div>
                    )}

                    {config.trailingStop && (
                      <div>
                        <label className="block text-slate-400 mb-1">Distância do acompanhamento</label>
                        <div className="flex items-center gap-1.5">
                          <input
                            type="number"
                            min="25"
                            max="300"
                            step="25"
                            value={config.trailingDistancePoints ?? 50}
                            onChange={(e) =>
                              handleConfigChange('trailingDistancePoints', Math.max(25, Number(e.target.value) || 25))
                            }
                            className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-slate-100 font-mono focus:border-emerald-500 focus:outline-hidden"
                          />
                          <span className="text-[11px] font-mono text-emerald-400 font-bold shrink-0">pts</span>
                        </div>
                        <span className="block text-[10px] text-slate-500 mt-0.5">
                          Depois do gatilho o stop segue a máxima (compra) ou a mínima (venda) sempre a{' '}
                          {config.trailingDistancePoints ?? 50} pts do extremo da perna.
                        </span>
                      </div>
                    )}

                    <div>
                      <label className="block text-slate-400 mb-1">Piso de proteção (taxas B3)</label>
                      {/* O editor migrou para a boleta do gráfico — fonte única dos valores-base das
                          estratégias. Aqui só leitura, para o painel continuar explicando a gestão. */}
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-emerald-400 font-bold">{config.breakevenOffsetPoints ?? 5} pts</span>
                        <span className="text-[10px] text-slate-500">edite na Boleta do gráfico</span>
                      </div>
                      <span className="block text-[10px] text-slate-500 mt-0.5">
                        Mínimo que o stop garante: entrada + {config.breakevenOffsetPoints ?? 5} pts. Vale para o breakeven
                        do TP da pirâmide e como piso do gatilho.
                      </span>
                    </div>

                    {config.trailingStop && (
                      <div className="p-2 rounded bg-emerald-500/10 border border-emerald-500/20 text-[10px] text-emerald-300 leading-relaxed">
                        🛡️ A mãe corre +{config.trailingActivationPoints ?? 60} pts → o stop vai para a entrada
                        +{config.breakevenOffsetPoints ?? 5} pts → depois acompanha o preço sempre a{' '}
                        {config.trailingDistancePoints ?? 50} pts do extremo. Só anda a favor e as pirâmides seguem
                        saindo no próprio TP.
                      </div>
                    )}
                  </div>
                )}
              </div>
              <div className="p-2 rounded bg-emerald-500/10 border border-emerald-500/20 text-[10px] text-emerald-300 leading-relaxed">
                🛡️ Saídas da Pirâmide: TP próprio (+{config.pyramidTpPoints || 50} pts)
                {(config.pyramidSlPoints ?? 0) > 0 ? ` · Stop opcional (−${config.pyramidSlPoints} pts)` : ' · sem stop fixo'} · inversão zera o resto
                {config.moveMainToBreakevenOnPyramidTp
                  ? ` · Mãe protegida no breakeven (+${config.breakevenOffsetPoints ?? 5} pts) a cada TP batido.`
                  : '.'}
              </div>
              <p className="text-[10px] text-slate-500 leading-relaxed">
                Parcial e o bloco de Trailing Stop da estratégia <b>Reteste</b> não participam da Pirâmide. Na Pirâmide a
                mãe é protegida pelo gatilho + acompanhamento acima, liberados pelo lucro do TP da pirâmide.
              </p>
            </div>
          </div>
        </CollapsibleSection>
      )}

      {/* LISTA DE GRUPOS (acordeão): cada bloco é uma linha com o resumo dos dados; o clique
          abre os campos logo abaixo, um grupo após o outro. Era uma grade de 3 colunas sempre
          abertas — muita informação na tela de uma vez. */}
      <div className="flex flex-col gap-2.5">
        {/* BLOCO 1: ATIVO, IDENTIFICAÇÃO DO EA & MAGIC NUMBER */}
        <CollapsibleSection
          title="1. Identificação do EA & Ativo MT5"
          icon={Layers}
          trailing={<span className="text-[10px] font-mono text-slate-500 shrink-0">B3 WIN$</span>}
          summary={`${config.symbol} · box ${config.boxPoints} pts · ${config.contracts} ctros · magic ${config.magicNumber}`}
        >

          <div className="space-y-3 text-xs">
            <div>
              <label className="block text-slate-400 mb-1">Código do Ativo (B3)</label>
              <input
                type="text"
                value={config.symbol}
                onChange={(e) => handleConfigChange('symbol', e.target.value.toUpperCase())}
                className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-slate-100 font-mono focus:border-emerald-500 focus:outline-hidden"
              />
              <span className="text-[10px] text-slate-500 mt-0.5 block">
                O gráfico opera o vigente ({chartSymbolFor(asset)}) — vire o vencimento aqui quando ele
                rolar. A série contínua ({asset.primarySymbol}) é código de teste de histórico, não de operação.
              </span>
            </div>

            <div
              ref={renkoFieldRef}
              id="ea-param-renko-box"
              // O brilho é só o aviso visual de "é aqui" — sai sozinho depois do piscar
              className={`rounded-lg transition-shadow duration-300 ${
                renkoFlash ? 'ring-2 ring-emerald-400/70 bg-emerald-400/5 -mx-2 px-2 py-1' : ''
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <label className="text-slate-400">Tamanho do Renko (box)</label>
                <span className="font-mono text-emerald-400 font-semibold">
                  {config.boxPoints} pts ({renkoScaleLabel(config.boxPoints, asset)})
                </span>
              </div>
              {/* CAIXA EDITÁVEL: R (a língua do operador) e pts (a unidade do motor) lado a lado.
                  O slider antigo andava de 25 em 25 pts e era matematicamente incapaz de chegar em
                  8R (40), 9R (45) ou 29R (145) — por isso saiu. */}
              <div className="grid grid-cols-2 gap-2">
                <div className="relative">
                  <input
                    type="number"
                    inputMode="numeric"
                    min={RENKO_R_MIN}
                    max={RENKO_R_MAX}
                    step={1}
                    value={displayedR}
                    onChange={(e) => {
                      setBoxRDraft(e.target.value);
                      setBoxPtsDraft(null);
                    }}
                    onBlur={() => applyRenkoBox(true)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') applyRenkoBox(true);
                    }}
                    className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 pr-8 text-slate-100 font-mono focus:border-emerald-500 focus:outline-hidden [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    title={`Box em R. 1R = ${tick} pts; faixa de ${RENKO_R_MIN}R a ${RENKO_R_MAX}R.`}
                  />
                  <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-slate-500 pointer-events-none">
                    R
                  </span>
                </div>
                <div className="relative">
                  <input
                    type="number"
                    inputMode="numeric"
                    min={tick}
                    max={RENKO_R_MAX * tick}
                    step={tick}
                    value={displayedPts}
                    onChange={(e) => {
                      setBoxPtsDraft(e.target.value);
                      setBoxRDraft(null);
                    }}
                    onBlur={() => applyRenkoBox(false)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') applyRenkoBox(false);
                    }}
                    className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 pr-11 text-slate-100 font-mono focus:border-emerald-500 focus:outline-hidden [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    title={`Box em pontos (o que o motor mede), encaixado em múltiplos de ${tick} pts.`}
                  />
                  <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-slate-500 pointer-events-none">
                    pts
                  </span>
                </div>
              </div>
              <span
                className={`text-[10px] mt-1 block ${hasPendingBox ? 'text-amber-400' : 'text-slate-500'}`}
              >
                {hasPendingBox && targetPts !== null
                  ? `Pendente: ${renkoScaleLabel(targetPts, asset)} = ${targetPts} pts — Enter (ou sair do campo) aplica`
                  : `1R = ${tick} pts no ${asset.label} · faixa de ${RENKO_R_MIN}R a ${RENKO_R_MAX}R. Aplicar redesenha todo o histórico na escala nova.`}
              </span>
            </div>

            <div>
              <label className="block text-slate-400 mb-1 flex items-center gap-1">
                <Hash className="w-3 h-3 text-emerald-400" />
                Magic Number
              </label>
              <input
                type="number"
                value={config.magicNumber || 102030}
                onChange={(e) => handleConfigChange('magicNumber', Number(e.target.value))}
                className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-slate-100 font-mono focus:border-emerald-500 focus:outline-hidden"
              />
              <span className="text-[10px] text-slate-500 mt-0.5 block">
                Os LOTES vivem apenas dentro do bloco da estratégia ativa — nada duplicado aqui.
              </span>
              <span className="text-[10px] text-slate-500 mt-0.5 block">
                Placa do Robô 1 no MT5: a ponte carimba cada entrada com este número e as saídas
                automáticas (inversão, zeragem de horário) só fecham posições com a mesma placa —
                ordens da Boleta manual (placa 999999) nunca são tocadas pelo robô. Mude aqui e
                baixe o script .py de novo.
              </span>
            </div>

            <div>
              <label className="block text-slate-400 mb-1">Comentário das Ordens (Tag MT5)</label>
              <input
                type="text"
                maxLength={30}
                value={config.orderComment || 'Renko10R_Flow'}
                onChange={(e) => handleConfigChange('orderComment', e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-slate-100 font-mono focus:border-emerald-500 focus:outline-hidden"
              />
            </div>
          </div>
        </CollapsibleSection>

        {/* BLOCO 1.5: ROBÔ 2 (SOMBRA) — segundo robô em papel, ao lado do box Renko, para quem
            procura a configuração no lugar de sempre. Só leitura + escolha: nada daqui dispara ordem. */}
        <CollapsibleSection
          title={SHADOW_LABEL}
          icon={Cpu}
          trailing={<span className="text-[10px] font-mono text-slate-500 shrink-0">PAPEL · SEM ORDEM REAL</span>}
          summary={
            config.shadowRobot?.enabled
              ? `ligado · escala ${config.shadowRobot?.scaleR}R`
              : 'desligado'
          }
        >
          <ShadowRobotPanel onPatchConfig={(patch) => handleConfigChange('shadowRobot', patch.shadowRobot)} variant="page" />
        </CollapsibleSection>

        {/* BLOCO 2: GATILHO DE DISPARO & MODO DE ENTRADA (PULLBACK OU MERCADO) */}
        <CollapsibleSection
          title="2. Gatilho de Disparo & Tipo de Entrada"
          icon={Zap}
          trailing={<span className="text-[10px] font-mono text-emerald-400 shrink-0">FLUXO ATEMPORAL</span>}
          summary={`Δ ${config.minDeltaThreshold}${config.adaptiveThresholdEnabled ? ' · adaptativo' : ' · fixo'}${config.consolidationFilterEnabled ? ' · anti-acumulação' : ''} · ${config.confirmationMode === 'BOX_CLOSE' ? 'fechamento do box' : 'rompimento no tick'}`}
        >

          <div className="space-y-3 text-xs">
            {config.strategyMode === 'PULLBACK_RETEST' ? (
              <div className="space-y-3">
                <div>
                  <label className="block text-slate-400 mb-1">Contratos da Entrada (Ordem Mãe)</label>
                  <input
                    type="number"
                    min="1"
                    max="100"
                    value={config.contracts}
                    onChange={(e) =>
                      handleConfigChange('contracts', Math.min(100, Math.max(1, Number(e.target.value) || 1)))
                    }
                    className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-slate-100 font-mono focus:border-emerald-500 focus:outline-hidden font-semibold"
                  />
                  <span className="block text-[10px] text-slate-500 mt-0.5">
                    Lote inicial da estratégia Reteste. A Pirâmide tem seus próprios lotes no bloco verde acima.
                  </span>
                </div>

                <div>
                  <label className="block text-slate-400 mb-1">Tipo de Entrada da Ordem</label>
                  <select
                    value={config.entryTriggerType}
                    onChange={(e) =>
                      handleConfigChange('entryTriggerType', e.target.value as 'MARKET_ON_CLOSE' | 'PULLBACK_ENTRY')
                    }
                    className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-slate-100 font-mono focus:border-emerald-500 focus:outline-hidden font-semibold"
                  >
                    <option value="PULLBACK_ENTRY">🎯 No Reteste / Pullback (Ordem Limitada)</option>
                    <option value="MARKET_ON_CLOSE">⚡ A Mercado no Fechamento do Box</option>
                  </select>
                  <span className="block text-[11px] text-slate-500 mt-1">
                    {config.entryTriggerType === 'PULLBACK_ENTRY'
                      ? 'Posiciona ordem limitada na abertura: só aciona se o preço recuar para testar o nível.'
                      : 'Executa imediatamente a mercado no preço de fechamento do tijolo.'}
                  </span>
                </div>

            {config.entryTriggerType === 'PULLBACK_ENTRY' && (
              <div className="p-3 bg-emerald-500/5 rounded-lg border border-emerald-500/20 space-y-2.5">
                <div>
                  <label className="block text-slate-300 text-[11px] mb-1 font-semibold">
                    Nível do Reteste / Recuo da Ordem
                  </label>
                  <select
                    value={config.pullbackTarget}
                    onChange={(e) =>
                      handleConfigChange(
                        'pullbackTarget',
                        e.target.value as 'BOX_OPEN' | 'BOX_50_PCT' | 'CUSTOM_POINTS'
                      )
                    }
                    className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1 text-slate-100 font-mono text-[11px]"
                  >
                    <option value="BOX_OPEN">Abertura do Box (100% de recuo · 50 pts)</option>
                    <option value="BOX_50_PCT">50% do Box (Metade do tijolo · 25 pts)</option>
                    <option value="CUSTOM_POINTS">Personalizado em Pontos</option>
                  </select>
                </div>

                {config.pullbackTarget === 'CUSTOM_POINTS' && (
                  <div>
                    <div className="flex justify-between text-[11px] text-slate-400 mb-0.5">
                      <span>Recuo em Pontos:</span>
                      <span className="font-mono text-emerald-300">{config.pullbackCustomPoints} pts</span>
                    </div>
                    <input
                      type="range"
                      min="5"
                      max="50"
                      step="5"
                      value={config.pullbackCustomPoints}
                      onChange={(e) => handleConfigChange('pullbackCustomPoints', Number(e.target.value))}
                      className="w-full accent-emerald-500"
                    />
                  </div>
                )}

                <div className="flex items-center justify-between text-[11px] text-slate-400 pt-0.5">
                  <span>Cancelar se afastar sem voltar:</span>
                  <span className="font-mono text-slate-200">{config.pullbackMaxBoxesWait} boxes</span>
                </div>
              </div>
            )}
              </div>
            ) : (
              <div className="p-3 bg-emerald-500/5 rounded-lg border border-emerald-500/20 text-[11px] text-slate-300 space-y-1">
                <p className="font-semibold text-emerald-300">🧱 Pirâmide & Confluência: entrada definida no bloco verde</p>
                <p className="text-slate-400">
                  Por padrão entra a mercado no fechamento do bloco, mas o Tipo de Entrada do bloco verde
                  “Parâmetros da Pirâmide Ativa” também permite Limit a 50% do box ou Limit na entrada do box — vale para
                  renko, range e pontos.
                </p>
              </div>
            )}

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-slate-400">Delta Mínimo de Agressão</label>
                <span className="font-mono text-emerald-400 font-semibold">
                  ±{config.minDeltaThreshold} ctros
                </span>
              </div>
              <input
                type="range"
                min="50"
                max="600"
                step="25"
                value={config.minDeltaThreshold}
                onChange={(e) => handleConfigChange('minDeltaThreshold', Number(e.target.value))}
                className="w-full accent-emerald-500"
              />
            </div>

            <div className="flex items-center justify-between pt-1">
              <label className="flex items-center gap-2 text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={config.requireCvdNewExtreme}
                  onChange={(e) => handleConfigChange('requireCvdNewExtreme', e.target.checked)}
                  className="w-3.5 h-3.5 rounded accent-emerald-500 cursor-pointer"
                />
                <span>Exigir CVD em Nova Máxima/Mínima</span>
              </label>
            </div>

            {/* Regime do Mercado — limiar adaptativo (vale para as DUAS estratégias: é gate de fluxo) */}
            <div className="pt-2 mt-1 border-t border-slate-800 space-y-2">
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-2 text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={config.adaptiveThresholdEnabled}
                    onChange={(e) => handleConfigChange('adaptiveThresholdEnabled', e.target.checked)}
                    className="w-3.5 h-3.5 rounded accent-emerald-500 cursor-pointer"
                  />
                  <span className="font-semibold">Limiar Adaptativo de Regime</span>
                </label>
                <span className="text-[10px] font-mono text-slate-500 uppercase tracking-wider">Assimetria Intradia</span>
              </div>
              {config.adaptiveThresholdEnabled && (
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-slate-400">Janela do Medidor</label>
                    <span className="font-mono text-emerald-400 font-semibold">{config.regimeLookbackBoxes} boxes</span>
                  </div>
                  <input
                    type="range"
                    min="10"
                    max="50"
                    step="5"
                    value={config.regimeLookbackBoxes}
                    onChange={(e) => handleConfigChange('regimeLookbackBoxes', Number(e.target.value))}
                    className="w-full accent-emerald-500"
                  />
                </div>
              )}
              <p className="text-[10px] text-slate-500 leading-snug">
                O mercado é assimétrico dentro do dia (abertura forte, almoço fraco). Ligado, o Delta Mínimo deixa
                de ser fixo e vira ±{config.minDeltaThreshold} × fator do momento (volume dos últimos{' '}
                {config.regimeLookbackBoxes} boxes ÷ média do dia, entre 0,5x e 3x) — na Pirâmide, blocos com
                agressão abaixo do limiar do momento não sinalizam. A medição roda sempre (desligado só volta
                ao comportamento antigo); o histórico do fator está na aba Avaliação Técnica.
              </p>
            </div>

            {/* Filtros de regime (F2) sobre ENTRADAS: acumulação/range curto + exaustão. Vale para as DUAS estratégias. */}
            <div className="pt-2 mt-1 border-t border-slate-800 space-y-2">
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-2 text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={config.consolidationFilterEnabled}
                    onChange={(e) => handleConfigChange('consolidationFilterEnabled', e.target.checked)}
                    className="w-3.5 h-3.5 rounded accent-emerald-500 cursor-pointer"
                  />
                  <span className="font-semibold">Filtro de Acumulação (range curto)</span>
                </label>
                <span className="text-[10px] font-mono text-slate-500 uppercase tracking-wider">Anti-serra</span>
              </div>
              {config.consolidationFilterEnabled && (
                <div className="space-y-2">
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-slate-400">Janela da Direcionalidade</label>
                      <span className="font-mono text-emerald-400 font-semibold">{config.consolidationLookbackBoxes} boxes</span>
                    </div>
                    <input
                      type="range"
                      min="4"
                      max="30"
                      step="1"
                      value={config.consolidationLookbackBoxes}
                      onChange={(e) => handleConfigChange('consolidationLookbackBoxes', Number(e.target.value))}
                      className="w-full accent-emerald-500"
                    />
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-slate-400">Corte de Eficiência (ER)</label>
                      <span className="font-mono text-emerald-400 font-semibold">{config.consolidationErMax.toFixed(2)}</span>
                    </div>
                    <input
                      type="range"
                      min="0.05"
                      max="0.60"
                      step="0.05"
                      value={config.consolidationErMax}
                      onChange={(e) => handleConfigChange('consolidationErMax', Number(e.target.value))}
                      className="w-full accent-emerald-500"
                    />
                  </div>
                </div>
              )}
              <label className="flex items-center gap-2 text-slate-300 cursor-pointer pt-1">
                <input
                  type="checkbox"
                  checked={config.exhaustionFilterEnabled}
                  onChange={(e) => handleConfigChange('exhaustionFilterEnabled', e.target.checked)}
                  className="w-3.5 h-3.5 rounded accent-emerald-500 cursor-pointer"
                />
                <span className="font-semibold">Filtro de Exaustão</span>
              </label>
              {config.exhaustionFilterEnabled && (
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-slate-400">Força mínima vs box anterior</label>
                    <span className="font-mono text-emerald-400 font-semibold">{Math.round(config.exhaustionDeltaRatio * 100)}%</span>
                  </div>
                  <input
                    type="range"
                    min="0.3"
                    max="0.9"
                    step="0.05"
                    value={config.exhaustionDeltaRatio}
                    onChange={(e) => handleConfigChange('exhaustionDeltaRatio', Number(e.target.value))}
                    className="w-full accent-emerald-500"
                  />
                </div>
              )}
              <p className="text-[10px] text-slate-500 leading-snug">
                Na acumulação os blocos alternam verde/vermelho com volume e o Robô entra dos dois lados,
                comendo stop atrás de stop. Ligado, o sinal só vale se o mercado estiver <b className="text-slate-400">direcional</b>:
                a Efficiency Ratio (deslocamento líquido ÷ caminho percorrido) dos últimos{' '}
                {config.consolidationLookbackBoxes} boxes abaixo de {config.consolidationErMax.toFixed(2)} = range curto, e o
                bloco não sinaliza (nem abre, nem vira). A Exaustão corta entradas quando a agressão do box caiu a{' '}
                {Math.round(config.exhaustionDeltaRatio * 100)}% da do anterior do mesmo lado. Desligado = comportamento antigo.
              </p>
            </div>
          </div>
        </CollapsibleSection>

        {/* BLOCO 3: STOP LOSS, TAKE PROFIT E LIMITES FINANCEIROS */}
        <CollapsibleSection
          title="3. Stop Loss, Take Profit & Metas"
          icon={Shield}
          trailing={<span className="text-[10px] font-mono text-slate-500 shrink-0">RISK / REWARD</span>}
          summary={`SL ${config.stopLossPoints}p · TP ${config.takeProfitPoints}p · trava R$ ${config.maxDailyLoss} · meta R$ ${config.maxDailyProfit}`}
        >

          <div className="space-y-3 text-xs">
            {config.strategyMode === 'PULLBACK_RETEST' ? (
              <div className="space-y-3">
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-slate-400">Stop Loss Base</label>
                <span className="font-mono text-rose-400 font-semibold">
                  {config.stopLossPoints} pts (R$ {slFinancial})
                </span>
              </div>
              <input
                type="range"
                min="50"
                max="300"
                step="25"
                value={config.stopLossPoints}
                onChange={(e) => handleConfigChange('stopLossPoints', Number(e.target.value))}
                className="w-full accent-rose-500"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-slate-400">Take Profit (Alvo Final)</label>
                <span className="font-mono text-emerald-400 font-semibold">
                  {config.takeProfitPoints} pts (R$ {tpFinancial})
                </span>
              </div>
              {/* O slider foi eliminado: o Alvo variável é definido na boleta do gráfico — a base
                  que Robô, script Python e ordens manuais buscam. Aqui só leitura. */}
              <span className="block text-[10px] text-slate-500">
                edite na Boleta do gráfico (linha “Alvo”)
              </span>
            </div>
              </div>
            ) : (
              <div className="p-3 bg-slate-950/70 rounded-lg border border-slate-800 text-[11px] text-slate-400 space-y-1">
                <p>
                  🧱 Na <strong className="text-emerald-300">Pirâmide &amp; Confluência</strong> não existem Stop Loss e Take
                  Profit globais:
                </p>
                <p>
                  · TP de cada pirâmide e stop opcional → bloco verde “Parâmetros da Pirâmide Ativa”.<br />
                  · Ordem mãe e proteções → inversão do fluxo (zeragem automática) + breakeven opcional da mãe.
                </p>
                <p className="text-slate-500">As metas e travas abaixo continuam valendo para as duas estratégias.</p>
              </div>
            )}

            <div className="grid grid-cols-2 gap-2 pt-1">
              <div>
                <label className="block text-slate-400 mb-1">Perda Diária Máx.</label>
                <div className="flex items-center gap-1 bg-slate-950 border border-slate-800 rounded px-2 py-1">
                  <span className="text-slate-500">R$</span>
                  <input
                    type="number"
                    value={config.maxDailyLoss}
                    onChange={(e) => handleConfigChange('maxDailyLoss', Number(e.target.value))}
                    className="w-full bg-transparent text-slate-100 font-mono text-xs focus:outline-hidden"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Meta Diária</label>
                <div className="flex items-center gap-1 bg-slate-950 border border-slate-800 rounded px-2 py-1">
                  <span className="text-slate-500">R$</span>
                  <input
                    type="number"
                    value={config.maxDailyProfit}
                    onChange={(e) => handleConfigChange('maxDailyProfit', Number(e.target.value))}
                    className="w-full bg-transparent text-slate-100 font-mono text-xs focus:outline-hidden"
                  />
                </div>
              </div>
            </div>

            <div>
              <label className="block text-slate-400 mb-1">Trava de Trades no Dia</label>
              <input
                type="number"
                min="1"
                max="50"
                value={config.maxDailyTrades || 10}
                onChange={(e) => handleConfigChange('maxDailyTrades', Number(e.target.value))}
                className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-slate-100 font-mono focus:border-emerald-500 focus:outline-hidden"
              />
              <span className="text-[10px] text-slate-500 mt-0.5 block">
                O EA bloqueia novas ordens após atingir esse limite na sessão.
              </span>
            </div>
          </div>
        </CollapsibleSection>
      </div>

      {/* BLOCO 4: GESTÃO AVANÇADA (REALIZAÇÃO PARCIAL, BREAKEVEN & TRAILING STOP) — EXCLUSIVO DA ESTRATÉGIA RETESTE */}
      {config.strategyMode === 'PULLBACK_RETEST' && (
      <CollapsibleSection
        title="4. Ordem Parcial, Breakeven Automático & Trailing Stop Móvel"
        icon={Target}
        iconClass="text-neutral-400"
        trailing={<span className="text-[10px] font-mono text-slate-500 shrink-0">EXECUÇÃO</span>}
        summary={`parcial ${config.enablePartialExit ? `${config.partialContracts} ctros @ ${config.partialPoints}p` : 'off'} · breakeven ${config.moveStopToBreakevenOnPartial ? `+${config.breakevenOffsetPoints ?? 5}p` : 'off'} · trailing ${config.trailingStop ? `+${config.trailingActivationPoints}p / ${config.trailingDistancePoints}p` : 'off'}`}
      >

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-xs">
          {/* Realização Parcial & Breakeven */}
          <div className="space-y-3.5 bg-slate-950/70 p-4 rounded-lg border border-slate-800">
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 font-semibold text-slate-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={config.enablePartialExit}
                  onChange={(e) => handleConfigChange('enablePartialExit', e.target.checked)}
                  className="w-4 h-4 rounded accent-neutral-500 cursor-pointer"
                />
                <span>Habilitar Realização Parcial</span>
              </label>
              <span
                className={`font-mono text-[10px] px-1.5 py-0.5 rounded ${
                  config.enablePartialExit ? 'text-neutral-300 bg-neutral-500/20' : 'text-slate-500 bg-slate-900'
                }`}
              >
                {config.enablePartialExit ? 'ATIVADA' : 'DESATIVADA'}
              </span>
            </div>

            {config.enablePartialExit && (
              <div className="space-y-3 pt-1">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-slate-400">Alvo da Parcial:</span>
                    <span className="font-mono text-neutral-400 font-semibold">
                      +{config.partialPoints} pts (R${' '}
                      {pointsToBRL(config.partialPoints, config.partialContracts, asset).toFixed(2)})
                    </span>
                  </div>
                  <input
                    type="range"
                    min="25"
                    max="150"
                    step="25"
                    value={config.partialPoints}
                    onChange={(e) => handleConfigChange('partialPoints', Number(e.target.value))}
                    className="w-full accent-neutral-500"
                  />
                  <span className="text-[10px] text-slate-500">
                    Recomendado: {config.boxPoints} pontos = 1 Box {renkoScaleLabel(config.boxPoints, asset)} a favor.
                  </span>
                </div>

                <div>
                  <label className="block text-slate-400 mb-1">Lote Parcial (Contratos)</label>
                  <input
                    type="number"
                    min="1"
                    max={Math.max(1, config.contracts - 1)}
                    value={config.partialContracts}
                    onChange={(e) =>
                      handleConfigChange('partialContracts', Math.max(1, Number(e.target.value)))
                    }
                    className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-slate-100 font-mono focus:border-neutral-500 focus:outline-hidden"
                  />
                </div>

                <div className="pt-1">
                  <label className="flex items-center gap-2 text-slate-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={config.moveStopToBreakevenOnPartial}
                      onChange={(e) => handleConfigChange('moveStopToBreakevenOnPartial', e.target.checked)}
                      className="w-3.5 h-3.5 rounded accent-neutral-500 cursor-pointer"
                    />
                    <span>
                      Mover Stop Loss para Breakeven (+{config.breakevenOffsetPoints} pts) ao bater parcial
                    </span>
                  </label>
                  <p className="text-[10px] text-slate-500 mt-0.5 ml-5">
                    Elimina o risco da operação assim que a primeira parcial for executada.
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Trailing Stop Móvel */}
          <div className="space-y-3.5 bg-slate-950/70 p-4 rounded-lg border border-slate-800">
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 font-semibold text-slate-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={config.trailingStop}
                  onChange={(e) => handleConfigChange('trailingStop', e.target.checked)}
                  className="w-4 h-4 rounded accent-amber-500 cursor-pointer"
                />
                <span className="flex items-center gap-1.5">
                  <Activity className="w-3.5 h-3.5 text-amber-400" />
                  Trailing Stop Dinâmico
                </span>
              </label>
              <span
                className={`font-mono text-[10px] px-1.5 py-0.5 rounded ${
                  config.trailingStop ? 'text-amber-300 bg-amber-500/20' : 'text-slate-500 bg-slate-900'
                }`}
              >
                {config.trailingStop ? 'ATIVO' : 'DESATIVADO'}
              </span>
            </div>

            {config.trailingStop && (
              <div className="space-y-3 pt-1">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-slate-400">Gatilho de Ativação do Trailing:</span>
                    <span className="font-mono text-amber-400 font-semibold">
                      +{config.trailingActivationPoints} pts a favor
                    </span>
                  </div>
                  <input
                    type="range"
                    min="50"
                    max="200"
                    step="10"
                    value={config.trailingActivationPoints}
                    onChange={(e) => handleConfigChange('trailingActivationPoints', Number(e.target.value))}
                    className="w-full accent-amber-500"
                  />
                  <span className="text-[10px] text-slate-500">
                    O robô começa a arrastar o Stop Loss assim que o trade alcançar esta pontuação.
                  </span>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-slate-400">Distância de Proteção (Dist. da Máxima):</span>
                    <span className="font-mono text-amber-400 font-semibold">
                      {config.trailingDistancePoints} pts ({formatBoxes(config.trailingDistancePoints, config.boxPoints)} box {renkoScaleLabel(config.boxPoints, asset)})
                    </span>
                  </div>
                  <input
                    type="range"
                    min="25"
                    max="150"
                    step="25"
                    value={config.trailingDistancePoints}
                    onChange={(e) => handleConfigChange('trailingDistancePoints', Number(e.target.value))}
                    className="w-full accent-amber-500"
                  />
                  <span className="text-[10px] text-slate-500">
                    O Stop Loss acompanha o preço ficando sempre a {config.trailingDistancePoints} pts
                    do topo ou fundo mais alto alcançado.
                  </span>
                </div>

                <div className="p-2 rounded bg-amber-500/10 border border-amber-500/20 text-[10px] text-amber-300">
                  🛡️ <strong>Trailing Móvel MT5</strong>: O stop só caminha no sentido favorável, travando lucros crescentes conforme os blocos avançam.
                </div>
              </div>
            )}
          </div>
        </div>
      </CollapsibleSection>
      )}

      {/* BLOCO 5: JANELA DE HORÁRIOS DAY TRADE & CONTA HEDGE MT5 */}
      <div className="flex flex-col gap-2.5">
        {/* Janela de Horários (B3) */}
        <CollapsibleSection
          title="5. Janela de Horários de Negociação (Day Trade B3)"
          icon={Clock}
          trailing={
            <span className="text-[10px] font-mono text-slate-500 shrink-0">
              {config.tradingHoursEnabled ? 'ATIVA' : 'DESATIVADA'}
            </span>
          }
          summary={
            config.tradingHoursEnabled
              ? `${config.tradingStartTime || '09:05'}→${config.tradingStopEntriesTime || '17:00'} · zeragem ${config.tradingCloseAllTime || '17:45'}`
              : 'horário livre (filtro desativado)'
          }
        >
          {/* o checkbox ficava no cabeçalho do bloco; no acordeão o cabeçalho é um botão, então ele
              desce para o corpo, como primeira linha do grupo. */}
          <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
            <input
              type="checkbox"
              checked={config.tradingHoursEnabled}
              onChange={(e) => handleConfigChange('tradingHoursEnabled', e.target.checked)}
              className="w-3.5 h-3.5 rounded accent-emerald-500"
            />
            <span>Habilitar filtro de horário</span>
          </label>

          <div className="grid grid-cols-3 gap-2.5 text-xs">
            <div>
              <label className="block text-slate-400 text-[11px] mb-1">Início</label>
              <input
                type="time"
                disabled={!config.tradingHoursEnabled}
                value={config.tradingStartTime || '09:05'}
                onChange={(e) => handleConfigChange('tradingStartTime', e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1.5 text-slate-100 font-mono text-xs focus:border-emerald-500 disabled:opacity-40"
              />
              <span className="text-[9px] text-slate-500 mt-0.5 block">Pós-Leilão</span>
            </div>

            <div>
              <label className="block text-slate-400 text-[11px] mb-1">Fim Novas Entradas</label>
              <input
                type="time"
                disabled={!config.tradingHoursEnabled}
                value={config.tradingStopEntriesTime || '17:00'}
                onChange={(e) => handleConfigChange('tradingStopEntriesTime', e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1.5 text-slate-100 font-mono text-xs focus:border-emerald-500 disabled:opacity-40"
              />
              <span className="text-[9px] text-slate-500 mt-0.5 block">Bloqueia Sinais</span>
            </div>

            <div>
              <label className="block text-slate-400 text-[11px] mb-1">Zeragem Compulsória</label>
              <input
                type="time"
                disabled={!config.tradingHoursEnabled}
                value={config.tradingCloseAllTime || '17:45'}
                onChange={(e) => handleConfigChange('tradingCloseAllTime', e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1.5 text-slate-100 font-mono text-xs focus:border-emerald-500 disabled:opacity-40"
              />
              <span className="text-[9px] text-slate-500 mt-0.5 block">Fecha Aberto</span>
            </div>
          </div>
          <p className="text-[11px] text-slate-500">
            {config.tradingHoursEnabled
              ? `O robô só abre posições entre ${config.tradingStartTime} e ${config.tradingStopEntriesTime}. Às ${config.tradingCloseAllTime}, todas as ordens em aberto são encerradas a mercado.`
              : 'Filtro desativado: O robô operará em qualquer horário que receber ticks do mercado.'}
          </p>
        </CollapsibleSection>

        {/* Conta Hedge e Preenchimento */}
        <CollapsibleSection
          title="6. Modo de Conta MT5 & Execução B3"
          icon={ArrowRightLeft}
          trailing={<span className="text-[10px] font-mono text-slate-500 shrink-0">{config.accountMode}</span>}
          summary={`${config.accountMode} · ${config.maxSimultaneousPositions} posição(ões) · ${
            config.hedgeOppositeAction === 'ALLOW_SIMULTANEOUS'
              ? 'hedge simultâneo'
              : config.hedgeOppositeAction === 'CLOSE_OPPOSITE'
                ? 'fecha a oposta'
                : 'ignora o novo'
          }`}
        >
          <div className="space-y-2.5 text-xs">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-slate-400 text-[11px] mb-1">Modo de Conta</label>
                <select
                  value={config.accountMode}
                  onChange={(e) =>
                    handleConfigChange('accountMode', e.target.value as 'HEDGE' | 'NETTING')
                  }
                  className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1.5 text-slate-100 font-mono text-xs focus:border-emerald-500"
                >
                  <option value="HEDGE">Conta Hedge</option>
                  <option value="NETTING">Conta Netting</option>
                </select>
              </div>

              <div>
                <label className="block text-slate-400 text-[11px] mb-1">Máx. Posições</label>
                <input
                  type="number"
                  min="1"
                  max="8"
                  value={config.maxSimultaneousPositions}
                  onChange={(e) =>
                    handleConfigChange('maxSimultaneousPositions', Math.max(1, Number(e.target.value)))
                  }
                  className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1.5 text-slate-100 font-mono text-xs focus:border-emerald-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-slate-400 text-[11px] mb-1">Comportamento em Sinal Oposto</label>
              <select
                value={config.hedgeOppositeAction}
                onChange={(e) =>
                  handleConfigChange(
                    'hedgeOppositeAction',
                    e.target.value as 'ALLOW_SIMULTANEOUS' | 'CLOSE_OPPOSITE' | 'IGNORE_NEW'
                  )
                }
                className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1.5 text-slate-100 font-mono text-xs focus:border-emerald-500"
              >
                <option value="ALLOW_SIMULTANEOUS">Permitir Compra & Venda Simultâneas (Hedge)</option>
                <option value="CLOSE_OPPOSITE">Fechar Posição Oposta antes de abrir nova</option>
                <option value="IGNORE_NEW">Ignorar novo sinal se já houver posição oposta</option>
              </select>
            </div>
          </div>
        </CollapsibleSection>
      </div>

      {/* BLOCO 7: CONTROLE DO SIMULADOR E TESTES DE AGRESSÃO */}
      <CollapsibleSection
        title="Controles do Simulador de Mercado B3 & Teste Manual de Ordens"
        icon={TrendingUp}
        iconClass="text-neutral-400"
        trailing={<span className="text-[10px] font-mono text-slate-500 shrink-0">{simulationSpeed}x</span>}
        summary="velocidade do replay · 1 tick manual · agressão ±350 ctros · limpar fita & gráfico"
      >
        {/* os botões de velocidade ficavam no cabeçalho do bloco; como o cabeçalho do acordeão é um
            botão, eles descem para o corpo, na primeira linha. */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-xs text-slate-400 mr-1">Velocidade:</span>
          {[1, 5, 15, 30].map((s) => (
            <button
              key={s}
              onClick={() => setSimulationSpeed(s)}
              className={`px-2.5 py-1 text-xs font-mono rounded transition-colors cursor-pointer ${
                simulationSpeed === s
                  ? 'bg-neutral-500/20 text-neutral-300 font-bold border border-neutral-500/40'
                  : 'bg-slate-900 text-slate-400 hover:text-slate-200'
              }`}
            >
              {s}x
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2.5 text-xs">
          <button
            onClick={onStepTick}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg border border-slate-700 transition-colors cursor-pointer"
          >
            <SkipForward className="w-3.5 h-3.5" />
            Avançar 1 Tick Manual
          </button>

          <button
            onClick={() => onInjectLargeAggression('BUY')}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 rounded-lg border border-emerald-500/40 transition-colors cursor-pointer"
          >
            <Zap className="w-3.5 h-3.5" />
            Simular Convergência de COMPRA (+350 ctros)
          </button>

          <button
            onClick={() => onInjectLargeAggression('SELL')}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 rounded-lg border border-rose-500/40 transition-colors cursor-pointer"
          >
            <Zap className="w-3.5 h-3.5" />
            Simular Convergência de VENDA (-350 ctros)
          </button>

          <button
            onClick={onResetData}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-slate-400 hover:text-slate-200 bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded-lg transition-colors cursor-pointer ml-auto"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Limpar Fita & Gráfico
          </button>
        </div>
      </CollapsibleSection>
    </div>
  );
};
