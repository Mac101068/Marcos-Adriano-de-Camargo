import React, { useState } from 'react';
import { UserProfile } from '../types/auth';
import { AuthService } from '../services/authService';
import { ShieldCheck, Clock, UserCheck, AlertOctagon, ChevronDown, Sparkles, RefreshCw } from 'lucide-react';

interface SubscriptionStatusBadgeProps {
  currentUser: UserProfile;
  onUserChanged: (user: UserProfile) => void;
  onOpenAdminPanel?: () => void;
  onOpenRenewModal?: () => void;
}

export const SubscriptionStatusBadge: React.FC<SubscriptionStatusBadgeProps> = ({
  currentUser,
  onUserChanged,
  onOpenAdminPanel,
  onOpenRenewModal,
}) => {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const remainingDays = AuthService.getRemainingDays(currentUser.expiresAt);
  const isActive = AuthService.isSubscriptionActive(currentUser);
  const allUsers = AuthService.getAllUsers();

  const handleSelectUser = (user: UserProfile) => {
    AuthService.setCurrentUser(user);
    onUserChanged(user);
    setDropdownOpen(false);
  };

  const getStatusStyle = () => {
    if (currentUser.role === 'ADMIN' || currentUser.plan === 'VITALICIO') {
      return 'bg-purple-950/40 border-purple-500/35 text-purple-200 hover:border-purple-500/60 hover:bg-purple-950/60';
    }
    if (!isActive || currentUser.status === 'EXPIRED') {
      return 'bg-rose-950/50 border-rose-500/40 text-rose-300 hover:bg-rose-950/70 animate-pulse';
    }
    if (currentUser.status === 'TRIAL' || remainingDays <= 5) {
      return 'bg-amber-950/50 border-amber-500/40 text-amber-300 hover:bg-amber-950/70';
    }
    return 'bg-emerald-950/50 border-emerald-500/40 text-emerald-300 hover:bg-emerald-950/70';
  };

  return (
    <div className="relative shrink-0">
      <div className="flex items-center gap-1.5">
        {/* Tarja compacta e proporcional posicionada no canto superior direito */}
        <button
          onClick={() => setDropdownOpen(!dropdownOpen)}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs transition-all cursor-pointer whitespace-nowrap shadow-xs ${getStatusStyle()}`}
          title="Clique para gerenciar usuário ou ver detalhes da licença"
        >
          {currentUser.role === 'ADMIN' ? (
            <>
              <ShieldCheck className="w-3.5 h-3.5 text-purple-400 shrink-0" />
              <span className="font-semibold text-purple-200 text-[11px] tracking-tight">Admin Master</span>
              <span className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-pulse" />
              <ChevronDown className="w-3 h-3 text-purple-400/80 ml-0.5 shrink-0" />
            </>
          ) : (
            <>
              <span
                className={`w-2 h-2 rounded-full shrink-0 ${
                  !isActive ? 'bg-rose-400' : currentUser.status === 'TRIAL' ? 'bg-amber-400' : 'bg-emerald-400'
                }`}
              />
              <span className="font-medium text-slate-200 text-[11px] truncate max-w-[85px]">
                {currentUser.name.split(' ')[0]}
              </span>
              <span className="text-[10px] font-mono opacity-80 font-semibold">
                {!isActive ? 'Exp' : `${remainingDays}d`}
              </span>
              <ChevronDown className="w-3 h-3 opacity-60 ml-0.5 shrink-0" />
            </>
          )}
        </button>

        {/* Botão de Renovação Rápida para Assinantes com vencimento próximo ou vencidos */}
        {currentUser.role !== 'ADMIN' && (!isActive || remainingDays <= 7) && onOpenRenewModal && (
          <button
            onClick={onOpenRenewModal}
            className="flex items-center gap-1 px-2 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-semibold shadow-xs transition-all cursor-pointer"
          >
            <Sparkles className="w-3 h-3" />
            <span className="hidden sm:inline">Renovar</span>
          </button>
        )}
      </div>

      {/* Menu suspenso de detalhes e alternância de contas */}
      {dropdownOpen && (
        <div className="absolute right-0 top-full mt-1.5 w-76 bg-slate-900 border border-slate-700/80 rounded-xl shadow-2xl p-2.5 z-50 animate-in fade-in zoom-in-95 duration-150">
          {/* Card Resumo do Usuário Ativo */}
          {currentUser.role === 'ADMIN' ? (
            <div className="p-2.5 mb-2 rounded-lg bg-purple-950/40 border border-purple-500/30 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-bold text-purple-200 flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-purple-400" />
                  {currentUser.name}
                </span>
                <span className="text-[10px] bg-purple-500/30 text-purple-200 px-1.5 py-0.2 rounded font-mono font-bold">
                  MASTER
                </span>
              </div>
              <p className="text-[11px] text-purple-300/80 font-mono mt-0.5 truncate">{currentUser.email}</p>
              <div className="mt-1.5 pt-1.5 border-t border-purple-500/20 flex items-center justify-between text-[10px] text-slate-300">
                <span>Plano: <strong>Vitalício</strong></span>
                <span className="text-emerald-400 font-semibold">Acesso Irrestrito</span>
              </div>
            </div>
          ) : (
            <div className="p-2.5 mb-2 rounded-lg bg-slate-950 border border-slate-800 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-bold text-slate-100">{currentUser.name}</span>
                <span
                  className={`text-[10px] font-mono px-1.5 py-0.2 rounded font-semibold ${
                    !isActive
                      ? 'bg-rose-500/20 text-rose-300'
                      : currentUser.status === 'TRIAL'
                      ? 'bg-amber-500/20 text-amber-300'
                      : 'bg-emerald-500/20 text-emerald-300'
                  }`}
                >
                  {!isActive ? 'VENCIDO' : currentUser.status === 'TRIAL' ? 'DEGUSTAÇÃO' : currentUser.plan}
                </span>
              </div>
              <p className="text-[11px] text-slate-400 font-mono mt-0.5 truncate">{currentUser.email}</p>
              <p className="text-[10px] text-slate-400 mt-1">
                {!isActive ? 'Assinatura encerrada' : `${remainingDays} dias restantes de acesso`}
              </p>
            </div>
          )}

          <div className="px-2 py-1 border-b border-slate-800 text-[10px] font-semibold text-slate-400 uppercase tracking-wider flex items-center justify-between">
            <span>Alternar Usuário da Rede</span>
            <span className="text-[9px] text-slate-500 font-normal">Ambiente Protótipo</span>
          </div>

          <div className="my-1 space-y-1 max-h-52 overflow-y-auto pr-1">
            {allUsers.map((u) => {
              const uRemaining = AuthService.getRemainingDays(u.expiresAt);
              const isSelected = u.id === currentUser.id;
              const uActive = AuthService.isSubscriptionActive(u);

              return (
                <button
                  key={u.id}
                  onClick={() => handleSelectUser(u)}
                  className={`w-full text-left p-1.5 rounded-lg flex items-center justify-between text-xs transition-all cursor-pointer ${
                    isSelected
                      ? 'bg-slate-800 border border-slate-700 text-white'
                      : 'hover:bg-slate-800/60 text-slate-300'
                  }`}
                >
                  <div className="flex items-center gap-2 overflow-hidden">
                    <div
                      className={`w-2 h-2 rounded-full shrink-0 ${
                        u.role === 'ADMIN'
                          ? 'bg-purple-400 ring-2 ring-purple-500/20'
                          : !uActive
                          ? 'bg-rose-500'
                          : u.status === 'TRIAL'
                          ? 'bg-amber-400'
                          : 'bg-emerald-400'
                      }`}
                    />
                    <div className="truncate">
                      <p className="font-medium truncate leading-tight text-[11px]">{u.name}</p>
                      <p className="text-[9px] text-slate-500 truncate">{u.email}</p>
                    </div>
                  </div>

                  <div className="text-right shrink-0 ml-2">
                    <span
                      className={`text-[9px] font-mono px-1.5 py-0.5 rounded ${
                        u.role === 'ADMIN'
                          ? 'bg-purple-500/20 text-purple-300 font-bold'
                          : !uActive
                          ? 'bg-rose-500/20 text-rose-300'
                          : u.status === 'TRIAL'
                          ? 'bg-amber-500/20 text-amber-300'
                          : 'bg-emerald-500/20 text-emerald-300'
                      }`}
                    >
                      {u.role === 'ADMIN' ? 'Master' : !uActive ? 'Exp' : `${uRemaining}d`}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>

          <div className="pt-2 border-t border-slate-800/80 flex flex-col gap-1 text-xs">
            {currentUser.role === 'ADMIN' && onOpenAdminPanel && (
              <button
                onClick={() => {
                  setDropdownOpen(false);
                  onOpenAdminPanel();
                }}
                className="w-full py-1.5 px-2 rounded-lg bg-purple-950/50 hover:bg-purple-900/60 border border-purple-500/30 text-purple-300 text-left font-medium flex items-center gap-2 cursor-pointer text-xs"
              >
                <UserCheck className="w-3.5 h-3.5 text-purple-400" />
                Painel Master de Assinantes
              </button>
            )}

            <button
              onClick={() => {
                AuthService.resetToDefault();
                const resetUsers = AuthService.getAllUsers();
                onUserChanged(resetUsers[0]);
                setDropdownOpen(false);
              }}
              className="w-full py-1.5 px-2 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-slate-300 text-left flex items-center gap-2 text-[10px] cursor-pointer"
            >
              <RefreshCw className="w-3 h-3" />
              Restaurar dados padrão de teste
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
