import React, { useEffect, useRef, useState } from 'react';
import {
  Activity,
  Play,
  Pause,
  Terminal,
  Sliders,
  FileCode,
  CheckCircle2,
  Wifi,
  WifiOff,
  BookOpen,
  Users,
  LineChart,
  ShieldCheck,
  FileText,
  ChevronDown,
  BarChart3,
  BarChart2,
  Cpu,
  AppWindow,
  Box,
  Settings,
  ClipboardCheck,
  Palette,
  Layers,
} from 'lucide-react';
import { MT5ConnectionState } from '../types/trading';
import { UserProfile } from '../types/auth';
import { SubscriptionStatusBadge } from './SubscriptionStatusBadge';
import { ALLOW_UNCONFIRMED_PREVIEW, ASSETS, type AssetId, type AssetSpec } from '../assets/assetRegistry';

type TabId = 'chart' | 'tape' | 'equity' | 'simulador' | 'comparativo' | 'avaliacao' | 'stats' | 'audit' | 'python' | 'docs' | 'settings' | 'studio' | 'admin';

interface HeaderProps {
  activeTab: TabId;
  setActiveTab: (tab: TabId) => void;
  isSimulating: boolean;
  setIsSimulating: (sim: boolean) => void;
  robotActive: boolean;
  setRobotActive: (active: boolean) => void;
  lastPrice: number;
  openOrdersCount: number;
  mt5State: MT5ConnectionState;
  onToggleMT5Connect: () => void;
  /** Spec do ativo em operação (Fase 2) — os números vêm todos daqui, nunca soldado. */
  asset: AssetSpec;
  /** Id escolhido no seletor (pode diferir do spec resolvido do símbolo em config antigo). */
  assetId: AssetId;
  onSelectAsset: (id: AssetId) => void;
  /** MT5 conectado E o símbolo do script é o do ativo? false = ponto de atenção no seletor. */
  mt5SymbolOk?: boolean;
  currentUser: UserProfile;
  onUserChanged: (user: UserProfile) => void;
  onOpenRenewModal: () => void;
  boxWindowOpen: boolean;
  onToggleBoxWindow: () => void;
  onOpenPdfModal?: () => void;
  // Janela flutuante de controles do painel Renko (atalho "Dados")
  dadosPanelOpen: boolean;
  onToggleDadosPanel: () => void;
}

interface MenuItem {
  tab: TabId;
  label: string;
  icon: React.ElementType;
  badge?: number;
  title?: string;
}

interface MenuGroupProps {
  label: string;
  icon?: React.ElementType;
  items: MenuItem[];
  activeTab: TabId;
  onSelect: (tab: TabId) => void;
  rightAlign?: boolean;
}

// Dropdown profissional de grupo de abas: fecha por click-outside e tecla Esc
const MenuGroup: React.FC<MenuGroupProps> = ({ label, icon: GroupIcon, items, activeTab, onSelect, rightAlign }) => {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const groupActive = items.some((it) => it.tab === activeTab);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap cursor-pointer ${
          groupActive ? 'bg-slate-800/70 text-slate-300 font-semibold' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
        }`}
      >
        {GroupIcon && <GroupIcon className={`w-3.5 h-3.5 ${groupActive ? 'text-slate-300' : 'text-slate-500'}`} />}
        {label}
        <ChevronDown className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div
          className={`absolute top-full mt-1.5 z-50 min-w-[220px] py-1 rounded-lg bg-slate-900 border border-slate-700/80 shadow-2xl shadow-black/50 ${
            rightAlign ? 'right-0' : 'left-0'
          }`}
        >
          {items.map((it) => {
            const Icon = it.icon;
            const isActive = activeTab === it.tab;
            return (
              <button
                key={it.tab}
                onClick={() => {
                  onSelect(it.tab);
                  setOpen(false);
                }}
                title={it.title}
                className={`w-full flex items-center gap-2.5 px-3 py-2 text-xs transition-colors text-left cursor-pointer ${
                  isActive
                    ? 'bg-slate-800 text-slate-50 font-semibold'
                    : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800/60'
                }`}
              >
                <Icon className={`w-3.5 h-3.5 shrink-0 ${isActive ? 'text-slate-100' : 'text-slate-500'}`} />
                <span className="flex-1">{it.label}</span>
                {typeof it.badge === 'number' && it.badge > 0 && (
                  <span className="px-1.5 py-0.2 rounded-full bg-emerald-500/20 text-emerald-300 text-[10px] font-mono">
                    {it.badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

interface AssetSelectorProps {
  asset: AssetSpec;
  assetId: AssetId;
  onSelect: (id: AssetId) => void;
  mt5SymbolOk?: boolean;
}

/**
 * Seletor de ativo (Fase 2). Fica na Zona 1, ao lado do título, e não dentro da barra de menus:
 * a Zona 2 só existe a partir de `lg`, e trocar de ativo é controle primário — precisa existir no
 * celular. Moldura neutra como o resto do chrome: a ÚNICA cor aqui é o ponto de status
 * (esmeralda = spec homologado; âmbar = spec 'a_confirmar' ou símbolo do script diferente).
 *
 * WDO e BTC aparecem na lista marcados A CONFIRMAR. Clicar neles NÃO troca de ativo: abre a
 * folha de ensaio, que exige um "Ensaiar" explícito, porque um R$/ponto errado contamina PnL e
 * trava financeira em dinheiro de verdade. Homologar é mudar `status` no registro.
 */
const AssetSelector: React.FC<AssetSelectorProps> = ({ asset, assetId, onSelect, mt5SymbolOk }) => {
  const [open, setOpen] = useState(false);
  // Spec 'a_confirmar' escolhido aguardando a confirmação explícita do operador.
  const [previewFor, setPreviewFor] = useState<AssetId | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
        setPreviewFor(null);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        setPreviewFor(null);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const ids = Object.keys(ASSETS) as AssetId[];
  const previewSpec = previewFor ? ASSETS[previewFor] : null;

  const pick = (id: AssetId) => {
    if (id === assetId) {
      setOpen(false);
      setPreviewFor(null);
      return;
    }
    const spec = ASSETS[id];
    if (spec.status === 'ativo') {
      onSelect(id);
      setOpen(false);
      setPreviewFor(null);
      return;
    }
    // Não homologado: o dropdown continua aberto e mostra a folha de ensaio.
    if (ALLOW_UNCONFIRMED_PREVIEW) setPreviewFor(id);
  };

  const money = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        onClick={() => setOpen((v) => !v)}
        title={`Ativo em operação: ${asset.label} — ${asset.contractNote}`}
        className="flex items-center gap-1.5 px-2 py-0.5 sm:px-2.5 sm:py-1 rounded-lg border border-slate-700 bg-slate-900 hover:border-slate-600 transition-colors cursor-pointer"
      >
        <Layers className="w-3.5 h-3.5 text-slate-400 shrink-0" />
        <span className="flex flex-col items-start leading-tight">
          <span className="text-xs font-semibold text-slate-100">{asset.id}</span>
          <span className="hidden sm:block text-[9px] font-mono text-slate-500">{asset.primarySymbol}</span>
        </span>
        <span
          className={`w-2 h-2 rounded-full shrink-0 ${
            asset.status === 'a_confirmar' ? 'bg-amber-400' : mt5SymbolOk === false ? 'bg-amber-400' : 'bg-emerald-400'
          }`}
        />
        <ChevronDown className={`w-3 h-3 text-slate-500 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1.5 z-50 w-[248px] py-1 rounded-lg bg-slate-900 border border-slate-700/80 shadow-2xl shadow-black/50">
          <p className="px-3 py-1 text-[10px] uppercase tracking-wider text-slate-500">Ativo em operação</p>
          {ids.map((id) => {
            const spec = ASSETS[id];
            const isActive = id === assetId;
            const locked = spec.status === 'a_confirmar' && !ALLOW_UNCONFIRMED_PREVIEW;
            return (
              <button
                key={id}
                onClick={() => pick(id)}
                disabled={locked}
                title={
                  locked
                    ? `${spec.contractNote} — homologue em src/assets/assetRegistry.ts para habilitar`
                    : spec.status === 'a_confirmar'
                    ? `${spec.contractNote} — clicável para ENSAIAR com o Robô bloqueado`
                    : spec.contractNote
                }
                className={`w-full flex items-center gap-2 px-3 py-2 text-xs text-left transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-40 ${
                  isActive ? 'bg-slate-800 text-slate-50 font-semibold' : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800/60'
                }`}
              >
                <span className="flex-1">
                  <span className="block">{spec.label}</span>
                  <span className="block text-[9px] font-mono text-slate-500">{spec.primarySymbol}</span>
                </span>
                {spec.status === 'a_confirmar' && (
                  <span className="px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 text-[9px] font-semibold whitespace-nowrap">
                    A CONFIRMAR
                  </span>
                )}
              </button>
            );
          })}

          {mt5SymbolOk === false && (
            <p className="mx-2 mt-1 px-2 py-1.5 rounded bg-amber-500/10 text-amber-300/90 text-[10px] leading-snug">
              O MT5 está conectado rodando OUTRO símbolo. Baixe o script de novo (aba Código Python) depois de
              trocar de ativo.
            </p>
          )}

          {previewSpec && (
            <div className="mx-2 mt-2 mb-1 p-2.5 rounded-lg bg-slate-950/80 border border-amber-500/30">
              <p className="text-[11px] font-semibold text-slate-100">Ensaiar {previewSpec.label}?</p>
              <p className="mt-1 text-[10px] text-slate-400 leading-snug">
                Estes três números ainda não foram confirmados na corretora e são deles que dependem PnL em
                R$ e trava financeira:
              </p>
              <ul className="mt-1.5 space-y-0.5 text-[10px] font-mono text-slate-300">
                <li>R$ {money(previewSpec.pointValue)} por ponto</li>
                <li>variação mínima: {previewSpec.tickSize} pts</li>
                <li>{previewSpec.decimals} casa(s) decimal(is)</li>
              </ul>
              <p className="mt-1.5 text-[10px] text-amber-300/90 leading-snug">
                Em ensaio o Robô vai para OFF e a ponte fica EM SEGURO: nenhuma ordem de entrada sai.
              </p>
              <div className="mt-2 flex items-center gap-1.5">
                <button
                  onClick={() => {
                    onSelect(previewSpec.id);
                    setOpen(false);
                    setPreviewFor(null);
                  }}
                  className="flex-1 px-2 py-1 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-100 text-[11px] font-semibold transition-colors cursor-pointer"
                >
                  Ensaiar
                </button>
                <button
                  onClick={() => setPreviewFor(null)}
                  className="px-2 py-1 rounded-md text-slate-400 hover:text-slate-200 text-[11px] transition-colors cursor-pointer"
                >
                  Cancelar
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export const Header: React.FC<HeaderProps> = ({
  activeTab,
  setActiveTab,
  isSimulating,
  setIsSimulating,
  robotActive,
  setRobotActive,
  lastPrice,
  openOrdersCount,
  mt5State,
  onToggleMT5Connect,
  asset,
  assetId,
  onSelectAsset,
  mt5SymbolOk,
  currentUser,
  onUserChanged,
  onOpenRenewModal,
  onOpenPdfModal,
  dadosPanelOpen,
  onToggleDadosPanel,
  boxWindowOpen,
  onToggleBoxWindow,
}) => {
  const chartItems: MenuItem[] = [
    { tab: 'chart', label: 'Terminal & Gráficos', icon: Activity },
    { tab: 'tape', label: 'Times & Trades', icon: Terminal },
    { tab: 'equity', label: 'Curva de Patrimônio', icon: LineChart },
    { tab: 'simulador', label: 'Simulador (Raio-X)', icon: Cpu, title: 'Tudo que está rodando: motores de barra, velocidade, controles e o caminho do tick até a ordem' },
  ];

  const analysisItems: MenuItem[] = [
    { tab: 'stats', label: 'Ordens & Performance', icon: CheckCircle2, badge: openOrdersCount, title: 'Ordens abertas e estatísticas de performance' },
    { tab: 'comparativo', label: 'Comparativo 3 Séries', icon: BarChart3, title: 'Coletor de eficiência: Pontos x Range x Tempo na mesma estratégia (contabilidade interna)' },
    { tab: 'avaliacao', label: 'Avaliação Técnica', icon: ClipboardCheck, title: 'Diagnóstico da base do coletor: win rate, fator de lucro, expectativa e recortes por motivo de saída, papel, direção e horário de entrada' },
    { tab: 'audit', label: 'Auditoria Intraday', icon: ShieldCheck, title: 'Livro de Auditoria de Ordens Intraday e Exportação CSV' },
  ];

  const systemItems: MenuItem[] = [
    { tab: 'python', label: 'Código Python MT5', icon: FileCode },
    { tab: 'docs', label: 'Guia MT5', icon: BookOpen },
    { tab: 'settings', label: 'Parâmetros', icon: Sliders },
    { tab: 'studio', label: 'Estúdio de Estratégias', icon: Palette, title: 'Programar, salvar e gerenciar estratégias completas — sem mexer no painel de Parâmetros' },
    ...(currentUser.role === 'ADMIN'
      ? [{ tab: 'admin' as TabId, label: 'Rede de Assinantes', icon: Users, title: 'Gestão da rede de assinantes (somente administrador)' }]
      : []),
  ];

  return (
    <header className="flex items-center justify-between gap-2 sm:gap-4 px-2.5 sm:px-4 md:px-6 py-2 sm:py-3 bg-slate-950 border-b border-slate-800/80 shrink-0">
      {/* Zone 1: Brand Title & EA Registered Status */}
      <div className="flex items-center gap-2 sm:gap-3 shrink-0">
        <span className="text-sm sm:text-base font-bold tracking-tight text-slate-100 whitespace-nowrap">
          Flow Quant MT5
        </span>
        <AssetSelector asset={asset} assetId={assetId} onSelect={onSelectAsset} mt5SymbolOk={mt5SymbolOk} />
      </div>

      {/* Zone 2: Menu superior agrupado — encostado no título, ocupando a linha livre */}
      <nav className="hidden lg:flex items-center gap-1 bg-slate-900/80 p-1 rounded-lg border border-slate-800 flex-1 justify-start ml-1">
        <MenuGroup label="Gráficos" icon={LineChart} items={chartItems} activeTab={activeTab} onSelect={setActiveTab} />
        <MenuGroup label="Análise" icon={BarChart2} items={analysisItems} activeTab={activeTab} onSelect={setActiveTab} />
        <MenuGroup label="Sistema" icon={Settings} items={systemItems} activeTab={activeTab} onSelect={setActiveTab} rightAlign />

        {/* Atalho da janela "Dados" — controles do painel Renko em janela flutuante */}
        <button
          onClick={onToggleDadosPanel}
          title="Abrir/fechar a janela de controles do painel Renko (Sinal, Exibição, Escalas, Desenho, Ordem rápida)"
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap cursor-pointer ${
            dadosPanelOpen
              ? 'bg-slate-800/70 text-slate-300 font-semibold'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
          }`}
        >
          <AppWindow className="w-3.5 h-3.5" />
          Dados
          <span className={`w-1.5 h-1.5 rounded-full ${dadosPanelOpen ? 'bg-emerald-400' : 'bg-slate-600'}`} />
        </button>

        {/* Atalho da janela "Box" — card do Box Renko em janela flutuante mostrável/ocultável */}
        <button
          onClick={onToggleBoxWindow}
          title="Abrir/fechar a janela do Box Renko (OHLC, fluxo Heikin-Ashi, CVD e convergência do box ativo)"
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap cursor-pointer ${
            boxWindowOpen
              ? 'bg-slate-800/70 text-slate-300 font-semibold'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
          }`}
        >
          <Box className="w-3.5 h-3.5" />
          Box Renko
          <span className={`w-1.5 h-1.5 rounded-full ${boxWindowOpen ? 'bg-emerald-400' : 'bg-slate-600'}`} />
        </button>
      </nav>

      {/* Zone 3: Primary Actions and Subscription Status Badge (Far Right) */}
      <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
        {/* Botão de Conexão MT5 Live Bridge */}
        <button
          onClick={onToggleMT5Connect}
          className={`hidden sm:flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-lg border transition-all whitespace-nowrap cursor-pointer ${
            mt5State.status === 'CONNECTED'
              ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/25'
              : mt5State.status === 'CONNECTING'
              ? 'bg-amber-500/15 border-amber-500/40 text-amber-300'
              : 'bg-slate-900 border-slate-700 text-slate-300 hover:border-slate-600'
          }`}
          title={
            mt5State.status !== 'CONNECTED'
              ? 'Conectar com o MetaTrader 5 via WebSocket local'
              : mt5State.bridgeLegacy
              ? 'Ponte antiga (sem token): aceita ordem de qualquer aparelho da rede. Baixe o script novo em Ajustes > Segurança da Ponte.'
              : mt5State.bridgeArmed === false
              ? 'Ponte autenticada e EM SEGURO: com o Robô desligado ela recusa ordens de entrada (saídas e zeragem seguem liberadas).'
              : 'Ponte autenticada e ARMADA: ordens de entrada liberadas, dentro dos tetos de contrato e de ordens por minuto.'
          }
        >
          {mt5State.status === 'CONNECTED' ? (
            <>
              <Wifi className="w-3.5 h-3.5 text-emerald-400" />
              <span className="hidden xl:inline">
                MT5: CONECTADO
                {mt5State.bridgeArmed === false ? ' · SEGURO' : mt5State.bridgeArmed ? ' · ARMADO' : ''}
              </span>
            </>
          ) : mt5State.status === 'CONNECTING' ? (
            <>
              <Wifi className="w-3.5 h-3.5 text-amber-400 animate-pulse" />
              <span className="hidden xl:inline">Conectando...</span>
            </>
          ) : (
            <>
              <WifiOff className="w-3.5 h-3.5 text-slate-400" />
              <span className="hidden xl:inline">Conectar MT5</span>
            </>
          )}
        </button>

        {/* Toggle do Robô Automático — clean: chrome neutro, cor só no ponto de status */}
        <button
          onClick={() => setRobotActive(!robotActive)}
          className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-lg border border-slate-700 bg-slate-900 text-slate-200 hover:border-slate-600 transition-all whitespace-nowrap cursor-pointer"
          title="Ativar/Pausar Envio Automático de Ordens"
        >
          <span className={`w-2 h-2 rounded-full ${robotActive ? 'bg-emerald-400' : 'bg-rose-400'}`} />
          <span className="hidden md:inline">{robotActive ? 'On' : 'Off'}</span>
        </button>

        {/* Toggle do Feed de Mercado — clean: chrome neutro, cor só no ícone de ação */}
        <button
          onClick={() => setIsSimulating(!isSimulating)}
          title="Ligar/desligar apenas o feed de ticks ao vivo. O período de histórico roda no replay da tira de status."
          className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1 text-xs font-medium rounded-lg border border-slate-700 bg-slate-900 text-slate-200 hover:border-slate-600 transition-colors whitespace-nowrap cursor-pointer"
        >
          {isSimulating ? (
            <>
              <Pause className="w-3.5 h-3.5 text-slate-300" />
              <span className="hidden md:inline">Pausar</span>
            </>
          ) : (
            <>
              <Play className="w-3.5 h-3.5 text-emerald-400" />
              <span className="hidden md:inline">Rodar</span>
            </>
          )}
        </button>

        {onOpenPdfModal && (
          <button
            onClick={onOpenPdfModal}
            className="hidden xl:flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-lg bg-slate-900 border border-slate-700 text-slate-200 hover:bg-slate-800 transition-colors cursor-pointer"
            title="Visualizar e exportar o Dossiê Técnico do Projeto em PDF"
          >
            <FileText className="w-3.5 h-3.5 text-slate-400" />
            <span>PDF Dossiê</span>
          </button>
        )}

        <div className="h-4 w-[1px] bg-slate-800 hidden sm:block mx-0.5" />

        {/* Tarja compacta e proporcional no canto superior direito */}
        <SubscriptionStatusBadge
          currentUser={currentUser}
          onUserChanged={onUserChanged}
          onOpenAdminPanel={() => setActiveTab('admin')}
          onOpenRenewModal={onOpenRenewModal}
        />
      </div>
    </header>
  );
};
