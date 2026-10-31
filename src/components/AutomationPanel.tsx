import React, { useState, useEffect, useRef } from 'react';
import { AutomationConfig, ConfigPreset } from '../types/trading';
import { pointsToBRL, renkoScaleLabel, resolveAsset } from '../assets/assetRegistry';
import { EaConfigService } from '../services/eaConfigService';
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
  AlertCircle
} from 'lucide-react';

interface AutomationPanelProps {
  config: AutomationConfig;
  setConfig: React.Dispatch<React.SetStateAction<AutomationConfig>>;
  simulationSpeed: number;
  setSimulationSpeed: (speed: number) => void;
  onStepTick: () => void;
  onInjectLargeAggression: (type: 'BUY' | 'SELL') => void;
  onResetData: () => void;
}

export const AutomationPanel: React.FC<AutomationPanelProps> = ({
  config,
  setConfig,
  simulationSpeed,
  setSimulationSpeed,
  onStepTick,
  onInjectLargeAggression,
  onResetData,
}) => {
  const [saveToast, setSaveToast] = useState<string | null>(null);
  const [customProfiles, setCustomProfiles] = useState<ConfigPreset[]>(() =>
    EaConfigService.getCustomProfiles()
  );
  const [showSaveProfileModal, setShowSaveProfileModal] = useState<boolean>(false);
  const [newProfileName, setNewProfileName] = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const builtInPresets = EaConfigService.getBuiltInPresets();

  // Função utilitária para aplicar alterações e persistir automaticamente
  const handleConfigChange = <K extends keyof AutomationConfig>(
    key: K,
    value: AutomationConfig[K]
  ) => {
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
      lastSavedTimestamp: Date.now(),
    };
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
    setConfig(def);
    setShowResetConfirmModal(false);
    showNotification('🔄 Configurações restauradas para o padrão institucional.');
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
        setConfig(imported);
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
              Perfil Ativo:{' '}
              <strong className="text-emerald-300 font-mono">
                {config.profileName || '10R Institucional'}
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
                Deseja restaurar todas as configurações para a parametrização institucional recomendada (10R, Pullback na Abertura, Parcial +50 pts com Breakeven +5 pts, SL 100 pts e TP 150 pts)?
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

      {/* SELEÇÃO DE PERFIS ESTRATÉGICOS PRONTOS */}
      <div className="space-y-2.5">
        <div className="flex items-center justify-between text-xs text-slate-400">
          <span className="font-semibold text-slate-300 flex items-center gap-1.5">
            <SlidersHorizontal className="w-3.5 h-3.5 text-emerald-400" />
            Perfis de Configuração Rápida (1-Clique)
          </span>
          <span className="text-[11px] text-slate-500">
            A qualquer momento você pode alternar ou customizar cada parâmetro abaixo
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          {builtInPresets.map((p) => {
            const isCurrent = config.profileName === p.name;
            return (
              <div
                key={p.id}
                onClick={() => handleApplyPreset(p)}
                className={`p-3 rounded-lg border text-left cursor-pointer transition-all ${
                  isCurrent
                    ? 'bg-emerald-950/40 border-emerald-500/60 shadow-md ring-1 ring-emerald-500/40'
                    : 'bg-slate-900/60 border-slate-800 hover:border-slate-700 hover:bg-slate-900'
                }`}
              >
                <div className="flex items-center justify-between mb-1.5">
                  <span
                    className={`text-[9px] font-mono px-1.5 py-0.5 rounded font-bold ${
                      isCurrent
                        ? 'bg-emerald-500/20 text-emerald-300'
                        : 'bg-slate-800 text-slate-400'
                    }`}
                  >
                    {p.badge}
                  </span>
                  {isCurrent && (
                    <span className="flex items-center gap-1 text-[10px] text-emerald-400 font-semibold">
                      <CheckCircle className="w-3 h-3" />
                      ATIVO
                    </span>
                  )}
                </div>
                <h4 className="text-xs font-bold text-slate-100">{p.name}</h4>
                <p className="text-[11px] text-slate-400 mt-1 line-clamp-2 leading-tight">
                  {p.description}
                </p>
                <div className="mt-2 pt-2 border-t border-slate-800/80 flex items-center justify-between text-[10px] font-mono text-slate-400">
                  <span>SL: {p.config.stopLossPoints} pts</span>
                  <span>TP: {p.config.takeProfitPoints} pts</span>
                  <span>
                    {p.config.entryTriggerType === 'PULLBACK_ENTRY' ? 'Pullback' : 'A Mercado'}
                  </span>
                </div>
              </div>
            );
          })}

          {/* Perfis Salvos pelo Usuário */}
          {customProfiles.map((cp) => {
            const isCurrent = config.profileName === cp.name;
            return (
              <div
                key={cp.id}
                onClick={() => handleApplyPreset(cp)}
                className={`p-3 rounded-lg border text-left cursor-pointer transition-all relative group ${
                  isCurrent
                    ? 'bg-neutral-950/40 border-neutral-500/60 shadow-md ring-1 ring-neutral-500/40'
                    : 'bg-slate-900/60 border-slate-800 hover:border-slate-700 hover:bg-slate-900'
                }`}
              >
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-neutral-500/20 text-neutral-300 font-bold">
                    OPERADOR
                  </span>
                  <div className="flex items-center gap-1">
                    {isCurrent && (
                      <span className="flex items-center gap-1 text-[10px] text-neutral-400 font-semibold mr-1">
                        <CheckCircle className="w-3 h-3" />
                        ATIVO
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setProfileToDelete({ id: cp.id, name: cp.name });
                      }}
                      className="text-slate-400 hover:text-rose-400 p-1 rounded hover:bg-rose-500/15 transition-colors cursor-pointer"
                      title={`Excluir perfil "${cp.name}"`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
                <h4 className="text-xs font-bold text-slate-100 truncate">{cp.name}</h4>
                <p className="text-[11px] text-slate-400 mt-1 line-clamp-2 leading-tight">
                  {cp.description}
                </p>
                <div className="mt-2 pt-2 border-t border-slate-800/80 flex items-center justify-between text-[10px] font-mono text-slate-400">
                  <span>SL: {cp.config.stopLossPoints} pts</span>
                  <span>TP: {cp.config.takeProfitPoints} pts</span>
                  <span>{cp.config.contracts} ctro(s)</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

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
        <div className="bg-slate-900/90 border border-emerald-500/40 p-4 rounded-xl space-y-3.5 shadow-lg">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800 pb-2.5">
            <h3 className="text-xs font-bold text-emerald-300 uppercase tracking-wider flex items-center gap-2">
              <Layers className="w-4 h-4" />
              Parâmetros da Pirâmide Ativa
            </h3>
            <span className="text-[10px] font-mono text-slate-400 self-start sm:self-auto">
              ENTRADA: {config.pyramidEntryType === 'BOX_50_LIMIT'
                ? 'LIMIT A 50% DO BOX'
                : config.pyramidEntryType === 'BOX_OPEN_LIMIT'
                ? 'LIMIT NA ENTRADA DO BOX'
                : 'MERCADO NO FECHAMENTO DO BLOCO'}{' '}
              · MÁX 10 NÍVEIS{config.moveMainToBreakevenOnPyramidTp ? ' · MÃE NO BREAKEVEN' : ''}
              {config.trailingStop ? ' · MÃE NO TRAILING' : ''}
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
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
                      <div className="flex items-center gap-1.5">
                        <input
                          type="number"
                          min="0"
                          max="50"
                          step="5"
                          value={config.breakevenOffsetPoints ?? 5}
                          onChange={(e) =>
                            handleConfigChange('breakevenOffsetPoints', Math.min(50, Math.max(0, Number(e.target.value) || 0)))
                          }
                          className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-slate-100 font-mono focus:border-emerald-500 focus:outline-hidden"
                        />
                        <span className="text-[11px] font-mono text-emerald-400 font-bold shrink-0">pts</span>
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
        </div>
      )}

      {/* GRADE PRINCIPAL DE CONTROLE DETERMINADA PELO OPERADOR */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* BLOCO 1: ATIVO, IDENTIFICAÇÃO DO EA & MAGIC NUMBER */}
        <div className="bg-slate-900/70 p-4 rounded-xl border border-slate-800 space-y-4 shadow-sm">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-200 border-b border-slate-800 pb-2">
            <span className="flex items-center gap-1.5">
              <Layers className="w-4 h-4 text-emerald-400" />
              1. Identificação do EA & Ativo MT5
            </span>
            <span className="text-[10px] font-mono text-slate-500">B3 WIN$</span>
          </div>

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
                Ex: WIN$N, WINFUT, WINZ24, WING25
              </span>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-slate-400">Tamanho do Renko</label>
                <span className="font-mono text-emerald-400 font-semibold">
                  {config.boxPoints} pts ({renkoScaleLabel(config.boxPoints, asset)})
                </span>
              </div>
              <input
                type="range"
                min="25"
                max="150"
                step="25"
                value={config.boxPoints}
                onChange={(e) => handleConfigChange('boxPoints', Number(e.target.value))}
                className="w-full accent-emerald-500"
              />
              <div className="flex justify-between text-[10px] text-slate-500">
                <span>5R (25 pts)</span>
                <span className="font-semibold text-emerald-400">10R (50 pts - Padrão)</span>
                <span>20R (100 pts)</span>
              </div>
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
        </div>

        {/* BLOCO 2: GATILHO DE DISPARO & MODO DE ENTRADA (PULLBACK OU MERCADO) */}
        <div className="bg-slate-900/70 p-4 rounded-xl border border-slate-800 space-y-4 shadow-sm">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-200 border-b border-slate-800 pb-2">
            <span className="flex items-center gap-1.5">
              <Zap className="w-4 h-4 text-emerald-400" />
              2. Gatilho de Disparo & Tipo de Entrada
            </span>
            <span className="text-[10px] font-mono text-emerald-400">FLUXO ATEMPORAL</span>
          </div>

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
          </div>
        </div>

        {/* BLOCO 3: STOP LOSS, TAKE PROFIT E LIMITES FINANCEIROS */}
        <div className="bg-slate-900/70 p-4 rounded-xl border border-slate-800 space-y-4 shadow-sm">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-200 border-b border-slate-800 pb-2">
            <span className="flex items-center gap-1.5">
              <Shield className="w-4 h-4 text-emerald-400" />
              3. Stop Loss, Take Profit & Metas
            </span>
            <span className="text-[10px] font-mono text-slate-500">RISK / REWARD</span>
          </div>

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
              <input
                type="range"
                min="50"
                max="450"
                step="25"
                value={config.takeProfitPoints}
                onChange={(e) => handleConfigChange('takeProfitPoints', Number(e.target.value))}
                className="w-full accent-emerald-500"
              />
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
        </div>
      </div>

      {/* BLOCO 4: GESTÃO AVANÇADA (REALIZAÇÃO PARCIAL, BREAKEVEN & TRAILING STOP) — EXCLUSIVO DA ESTRATÉGIA RETESTE */}
      {config.strategyMode === 'PULLBACK_RETEST' && (
      <div className="bg-slate-900/70 p-4 sm:p-5 rounded-xl border border-neutral-500/30 space-y-4 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <Target className="w-4 h-4 text-neutral-400" />
            <h3 className="text-sm font-bold text-slate-100">
              4. Ordem Parcial, Breakeven Automático & Trailing Stop Móvel
            </h3>
          </div>
          <span className="px-2 py-0.5 rounded bg-neutral-500/10 text-neutral-300 border border-neutral-500/30 text-[10px] font-mono font-semibold self-start sm:self-auto">
            CONTROLE AVANÇADO DE EXECUÇÃO
          </span>
        </div>

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
                    Recomendado: 50 pontos = 1 Box 10R a favor.
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-3">
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

                  <div>
                    <label className="block text-slate-400 mb-1">Offset Breakeven (Taxas B3)</label>
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        min="0"
                        max="25"
                        step="5"
                        value={config.breakevenOffsetPoints}
                        onChange={(e) =>
                          handleConfigChange('breakevenOffsetPoints', Number(e.target.value))
                        }
                        className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-slate-100 font-mono focus:border-neutral-500 focus:outline-hidden"
                      />
                      <span className="text-slate-400 text-[11px]">pts</span>
                    </div>
                  </div>
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
                      {config.trailingDistancePoints} pts ({config.trailingDistancePoints / 50} box 10R)
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
      </div>
      )}

      {/* BLOCO 5: JANELA DE HORÁRIOS DAY TRADE & CONTA HEDGE MT5 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Janela de Horários (B3) */}
        <div className="bg-slate-900/70 p-4 rounded-xl border border-slate-800 space-y-3.5 shadow-sm">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-200 border-b border-slate-800 pb-2">
            <span className="flex items-center gap-1.5">
              <Clock className="w-4 h-4 text-emerald-400" />
              5. Janela de Horários de Negociação (Day Trade B3)
            </span>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={config.tradingHoursEnabled}
                onChange={(e) => handleConfigChange('tradingHoursEnabled', e.target.checked)}
                className="w-3.5 h-3.5 rounded accent-emerald-500"
              />
              <span className="text-[10px] text-slate-300">Habilitar</span>
            </label>
          </div>

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
        </div>

        {/* Conta Hedge e Preenchimento */}
        <div className="bg-slate-900/70 p-4 rounded-xl border border-slate-800 space-y-3.5 shadow-sm">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-200 border-b border-slate-800 pb-2">
            <span className="flex items-center gap-1.5">
              <ArrowRightLeft className="w-4 h-4 text-emerald-400" />
              6. Modo de Conta MT5 & Execução B3
            </span>
            <span className="px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-300 text-[10px] font-mono">
              {config.accountMode}
            </span>
          </div>

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
        </div>
      </div>

      {/* BLOCO 6: CONTROLE DO SIMULADOR E TESTES DE AGRESSÃO */}
      <div className="bg-slate-900/40 p-4 rounded-xl border border-slate-800 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-200">
            <TrendingUp className="w-4 h-4 text-neutral-400" />
            Controles do Simulador de Mercado B3 & Teste Manual de Ordens
          </div>

          <div className="flex items-center gap-1.5">
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
        </div>

        <div className="flex flex-wrap items-center gap-2.5 pt-1 text-xs">
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
      </div>
    </div>
  );
};
