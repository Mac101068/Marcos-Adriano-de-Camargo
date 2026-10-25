import React from 'react';
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
} from 'lucide-react';
import { MT5ConnectionState } from '../types/trading';
import { UserProfile } from '../types/auth';
import { SubscriptionStatusBadge } from './SubscriptionStatusBadge';

interface HeaderProps {
  activeTab: 'chart' | 'tape' | 'equity' | 'stats' | 'audit' | 'python' | 'docs' | 'settings' | 'admin';
  setActiveTab: (tab: 'chart' | 'tape' | 'equity' | 'stats' | 'audit' | 'python' | 'docs' | 'settings' | 'admin') => void;
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
}

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
}) => {
  return (
    <header className="flex items-center justify-between gap-2 sm:gap-4 px-2.5 sm:px-4 md:px-6 py-2 sm:py-3 bg-slate-950 border-b border-slate-800/80 shrink-0">
      {/* Zone 1: Brand Title & EA Registered Status */}
      <div className="flex items-center gap-2 sm:gap-3 shrink-0">
        <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 font-bold text-xs sm:text-sm shadow-inner">
          10R
        </div>
        <div className="flex flex-col sm:flex-row sm:items-baseline sm:gap-2">
          <span className="text-sm sm:text-base font-bold tracking-tight text-slate-100 whitespace-nowrap">
            Fluxo & Renko
          </span>
          <span className="text-[10px] sm:text-xs text-emerald-400 font-mono tabular-nums font-semibold">
            {lastPrice > 0 ? lastPrice.toLocaleString('pt-BR') : '128.500'} pts
          </span>
        </div>

        {/* Badge do Setup do EA Registrado */}
        <button
          onClick={() => setActiveTab('settings')}
          className="hidden xl:flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-900/90 border border-slate-800 hover:border-emerald-500/50 hover:bg-slate-800 text-[11px] text-slate-300 transition-colors cursor-pointer"
          title="Clique para abrir e personalizar a configuração do EA"
        >
          <Sliders className="w-3 h-3 text-emerald-400" />
          <span className="text-slate-400">EA:</span>
          <span className="font-mono text-emerald-300 font-medium truncate max-w-[130px]">
            {eaProfileName || '10R Institucional'}
          </span>
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
        </button>
      </div>

      {/* Zone 2: Navigation Tabs */}
      <nav className="hidden lg:flex items-center gap-1 bg-slate-900/80 p-1 rounded-lg border border-slate-800 text-xs font-medium">
        <button
          onClick={() => setActiveTab('chart')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-colors whitespace-nowrap cursor-pointer ${
            activeTab === 'chart'
              ? 'bg-slate-800 text-emerald-400 font-semibold shadow-xs'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Activity className="w-3.5 h-3.5" />
          Terminal & Gráficos
        </button>
        <button
          onClick={() => setActiveTab('tape')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-colors whitespace-nowrap cursor-pointer ${
            activeTab === 'tape'
              ? 'bg-slate-800 text-emerald-400 font-semibold shadow-xs'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Terminal className="w-3.5 h-3.5" />
          Times & Trades
        </button>
        <button
          onClick={() => setActiveTab('equity')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-colors whitespace-nowrap cursor-pointer ${
            activeTab === 'equity'
              ? 'bg-slate-800 text-emerald-400 font-semibold shadow-xs'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <LineChart className="w-3.5 h-3.5" />
          Curva de Patrimônio
        </button>
        <button
          onClick={() => setActiveTab('stats')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-colors whitespace-nowrap cursor-pointer ${
            activeTab === 'stats'
              ? 'bg-slate-800 text-emerald-400 font-semibold shadow-xs'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <CheckCircle2 className="w-3.5 h-3.5" />
          Ordens & Performance
          {openOrdersCount > 0 && (
            <span className="ml-1 px-1.5 py-0.2 rounded-full bg-emerald-500/20 text-emerald-300 text-[10px] font-mono">
              {openOrdersCount}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveTab('audit')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-colors whitespace-nowrap cursor-pointer ${
            activeTab === 'audit'
              ? 'bg-slate-800 text-emerald-400 font-semibold shadow-xs'
              : 'text-slate-400 hover:text-slate-200'
          }`}
          title="Livro de Auditoria de Ordens Intraday e Exportação CSV"
        >
          <ShieldCheck className="w-3.5 h-3.5" />
          Auditoria Intraday
        </button>
        <button
          onClick={() => setActiveTab('python')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-colors whitespace-nowrap cursor-pointer ${
            activeTab === 'python'
              ? 'bg-slate-800 text-emerald-400 font-semibold shadow-xs'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <FileCode className="w-3.5 h-3.5" />
          Código Python MT5
        </button>
        <button
          onClick={() => setActiveTab('docs')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-colors whitespace-nowrap cursor-pointer ${
            activeTab === 'docs'
              ? 'bg-slate-800 text-emerald-400 font-semibold shadow-xs'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <BookOpen className="w-3.5 h-3.5" />
          Guia MT5
        </button>
        <button
          onClick={() => setActiveTab('settings')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-colors whitespace-nowrap cursor-pointer ${
            activeTab === 'settings'
              ? 'bg-slate-800 text-emerald-400 font-semibold shadow-xs'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Sliders className="w-3.5 h-3.5" />
          Parâmetros
        </button>

        {/* Tab exclusiva de Gestão de Rede para Administradores */}
        {currentUser.role === 'ADMIN' && (
          <button
            onClick={() => setActiveTab('admin')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-colors whitespace-nowrap cursor-pointer ${
              activeTab === 'admin'
                ? 'bg-purple-900/60 text-purple-300 font-semibold shadow-xs border border-purple-500/40'
                : 'text-purple-400 hover:text-purple-200 hover:bg-purple-950/40'
            }`}
          >
            <Users className="w-3.5 h-3.5 text-purple-400" />
            Rede de Assinantes
          </button>
        )}
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
            className="hidden xl:flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-lg bg-sky-950/70 border border-sky-500/40 text-sky-300 hover:bg-sky-900/60 hover:text-sky-200 transition-colors cursor-pointer"
            title="Visualizar e exportar o Dossiê Técnico do Projeto em PDF"
          >
            <FileText className="w-3.5 h-3.5 text-sky-400" />
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
