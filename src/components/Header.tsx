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
  Settings,
} from 'lucide-react';
import { MT5ConnectionState } from '../types/trading';
import { UserProfile } from '../types/auth';
import { SubscriptionStatusBadge } from './SubscriptionStatusBadge';

type TabId = 'chart' | 'tape' | 'equity' | 'simulador' | 'comparativo' | 'stats' | 'audit' | 'python' | 'docs' | 'settings' | 'admin';

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
  currentUser: UserProfile;
  onUserChanged: (user: UserProfile) => void;
  onOpenRenewModal: () => void;
  eaProfileName?: string;
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
          groupActive ? 'bg-slate-800 text-slate-50 font-semibold' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
        }`}
      >
        {GroupIcon && <GroupIcon className={`w-3.5 h-3.5 ${groupActive ? 'text-emerald-400' : 'text-slate-500'}`} />}
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
  currentUser,
  onUserChanged,
  onOpenRenewModal,
  eaProfileName,
  onOpenPdfModal,
  dadosPanelOpen,
  onToggleDadosPanel,
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
    { tab: 'audit', label: 'Auditoria Intraday', icon: ShieldCheck, title: 'Livro de Auditoria de Ordens Intraday e Exportação CSV' },
  ];

  const systemItems: MenuItem[] = [
    { tab: 'python', label: 'Código Python MT5', icon: FileCode },
    { tab: 'docs', label: 'Guia MT5', icon: BookOpen },
    { tab: 'settings', label: 'Parâmetros', icon: Sliders },
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

        {/* Badge do Setup do EA Registrado */}
        <button
          onClick={() => setActiveTab('settings')}
          className="hidden xl:flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-900/90 border border-slate-800 hover:border-slate-600 hover:bg-slate-800 text-[11px] text-slate-300 transition-colors cursor-pointer"
          title="Clique para abrir e personalizar a configuração do EA"
        >
          <Sliders className="w-3 h-3 text-emerald-400" />
          <span className="text-slate-400">EA:</span>
          <span className="font-mono text-slate-200 font-medium truncate max-w-[130px]">
            {eaProfileName || '10R Institucional'}
          </span>
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
        </button>
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
              ? 'bg-emerald-500/15 text-emerald-300 font-semibold border border-emerald-500/40'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
          }`}
        >
          <AppWindow className="w-3.5 h-3.5" />
          Dados
          <span className={`w-1.5 h-1.5 rounded-full ${dadosPanelOpen ? 'bg-emerald-400' : 'bg-slate-600'}`} />
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
          title="Conectar com o MetaTrader 5 via WebSocket local"
        >
          {mt5State.status === 'CONNECTED' ? (
            <>
              <Wifi className="w-3.5 h-3.5 text-emerald-400" />
              <span className="hidden xl:inline">MT5: CONECTADO</span>
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

        {/* Toggle do Robô Automático */}
        <button
          onClick={() => setRobotActive(!robotActive)}
          className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-lg border transition-all whitespace-nowrap cursor-pointer ${
            robotActive
              ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/25'
              : 'bg-rose-500/10 border-rose-500/30 text-rose-300 hover:bg-rose-500/20'
          }`}
          title="Ativar/Pausar Envio Automático de Ordens"
        >
          <span className={`w-2 h-2 rounded-full ${robotActive ? 'bg-emerald-400' : 'bg-rose-400'}`} />
          <span className="hidden md:inline">{robotActive ? 'Robô: LIGADO' : 'Robô: PAUSADO'}</span>
        </button>

        {/* Toggle do Feed de Mercado */}
        <button
          onClick={() => setIsSimulating(!isSimulating)}
          className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-1 text-xs font-medium rounded-lg text-white transition-colors whitespace-nowrap cursor-pointer ${
            isSimulating ? 'bg-slate-800 hover:bg-slate-700 text-slate-200' : 'bg-emerald-600 hover:bg-emerald-500'
          }`}
        >
          {isSimulating ? (
            <>
              <Pause className="w-3.5 h-3.5" />
              <span className="hidden md:inline">Pausar</span>
            </>
          ) : (
            <>
              <Play className="w-3.5 h-3.5" />
              <span className="hidden md:inline">Iniciar</span>
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
