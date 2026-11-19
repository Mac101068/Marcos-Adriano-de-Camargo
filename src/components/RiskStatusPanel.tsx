import React from 'react';
import {
  Wifi,
  WifiOff,
  Activity,
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  Lock,
  Unlock,
  AlertTriangle,
} from 'lucide-react';
import { MT5ConnectionState } from '../types/trading';
import { AssetSpec } from '../assets/assetRegistry';

/**
 * RiskStatusPanel — Painel de Status de Risco e Conexão.
 *
 * Exibe, de forma compacta e profissional:
 * 1. Status da conexão WebSocket com a ponte (127.0.0.1:8765).
 * 2. Modo de operação (ORDERS_BLOCKED / bridgeOrdersBlocked).
 * 3. Regras de risco ativas (stop mínimo por ativo, hard cap, etc.).
 *
 * Regras de ouro do frontend:
 * - Zero lógica de backend: apenas consome mt5State e asset.
 * - Nunca exibe tokens ou chaves sensíveis.
 * - Cores de sinal: emerald (seguro/conectado), rose/amber (alerta/bloqueado).
 */
interface RiskStatusPanelProps {
  /** Estado da conexão MT5/ponte (vem do App.tsx). */
  mt5State: MT5ConnectionState;
  /** Spec do ativo em operação (para mostrar stop mínimo do ativo vigente). */
  asset?: AssetSpec | null;
  /** Callback opcional para destravar ordens (clique no badge de modo seguro). */
  onUnlockOrders?: () => void;
}

/** Blocos de regra de risco exibidos na lista compacta. */
interface RiskRule {
  label: string;
  value: string;
  active: boolean;
  ok: boolean;
}

const getConnectionStatus = (status: MT5ConnectionState['status']) => {
  switch (status) {
    case 'CONNECTED':
      return { label: 'Conectado', color: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/30', dot: 'bg-emerald-400', icon: Wifi };
    case 'CONNECTING':
      return { label: 'Conectando...', color: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/30', dot: 'bg-amber-400', icon: Activity };
    case 'ERROR':
      return { label: 'Erro', color: 'text-rose-400', bg: 'bg-rose-500/10', border: 'border-rose-500/30', dot: 'bg-rose-400', icon: AlertCircle };
    case 'DISCONNECTED':
    default:
      return { label: 'Desconectado', color: 'text-rose-400', bg: 'bg-rose-500/10', border: 'border-rose-500/30', dot: 'bg-rose-400', icon: WifiOff };
  }
};

export const RiskStatusPanel: React.FC<RiskStatusPanelProps> = ({
  mt5State,
  asset,
  onUnlockOrders,
}) => {
  const conn = getConnectionStatus(mt5State.status ?? 'DISCONNECTED');
  const ConnIcon = conn.icon; // JSX exige nome de componente com letra maiúscula
  const isConnected = mt5State.status === 'CONNECTED';
  const rawOrdersBlocked = !!mt5State.bridgeOrdersBlocked;
  const envLock = !!mt5State.bridgeEnvLock;
  const replayMode = !!mt5State.bridgeReplayMode;

  // REGRA DE SEGURANÇA: se não está conectado, ordens estão sempre bloqueadas
  // independentemente do que bridgeOrdersBlocked diga.
  const ordersBlocked = !isConnected || rawOrdersBlocked;

  // Contradição: desconectado mas bridgeOrdersBlocked diz false (liberada)
  const contradiction = !isConnected && !rawOrdersBlocked && !envLock && !replayMode;

  const rules: RiskRule[] = [];

  if (asset) {
    rules.push({
      label: `${asset.activeContract ?? asset.label} — Stop Mínimo`,
      value: `${asset.tradeDefaults.stopLossPoints} pts`,
      active: true,
      ok: true,
    });
  }

  rules.push({
    label: 'Execução de Ordens (Ponte)',
    value: ordersBlocked ? 'BLOQUEADA' : 'LIBERADA',
    active: true,
    ok: !ordersBlocked,
  });

  if (envLock) {
    rules.push({
      label: 'Trava de Ambiente (ORDERS_BLOCKED)',
      value: 'ATIVA — imutável pelo app',
      active: true,
      ok: false,
    });
  }

  if (replayMode) {
    rules.push({
      label: 'Modo Replay / Ensaio',
      value: 'ATIVO — nenhuma ordem sai',
      active: true,
      ok: false,
    });
  }

  // Abreviação inteligente para não truncar: tooltip com valor completo
  rules.push({
    label: 'Hard Cap por Magic',
    value: 'ATIVO',
    active: true,
    ok: true,
  });

  return (
    <section
      className="flex flex-col gap-1.5 px-3 sm:px-4 md:px-5 py-2 bg-slate-950 border-b border-slate-800/80 shrink-0"
      aria-label="Painel de status de risco e conexão"
    >
      <div className="flex items-center justify-between gap-2 sm:gap-3 min-w-0">
        {/* Ícone de conexão (JSX exige componente com letra maiúscula) */}
        <div
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-[10px] sm:text-xs font-medium leading-none transition-colors ${conn.bg} ${conn.border} ${conn.color}`}
          title={`WebSocket 127.0.0.1:8765 — ${conn.label}`}
        >
          <ConnIcon className={`w-3 h-3 shrink-0 ${conn.color}`} />
          <span className={`shrink-0 font-semibold ${conn.color}`}>{conn.label}</span>
          <span className={`w-1.5 h-1.5 rounded-full ${conn.color}`} />
        </div>

        <button
          onClick={onUnlockOrders}
          disabled={!ordersBlocked && !envLock}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-[10px] sm:text-xs font-bold leading-none transition-all cursor-pointer whitespace-nowrap ${
            ordersBlocked
              ? 'bg-rose-950/60 border-rose-500/50 text-rose-200 hover:bg-rose-950/80 hover:border-rose-400/70 shadow-[0_0_12px_rgba(239,68,68,0.25)]'
              : 'bg-emerald-950/60 border-emerald-500/40 text-emerald-200 hover:bg-emerald-950/80 hover:border-emerald-400/50'
          }`}
          title={
            !isConnected
              ? 'SEM CONEXÃO: a ponte está desconectada. Nenhuma ordem de entrada sai para o MT5. Modo forçado a SEGURO.'
              : ordersBlocked
                ? 'MODO SEGURO: a ponte está travada (ORDERS_BLOCKED). Nenhuma ordem de entrada sai para o MT5.'
                : 'MODO OPERACIONAL: ordens de entrada estão liberadas.'
          }
        >
          {!isConnected ? (
            <>
              <Lock className="w-3 h-3 text-rose-400 shrink-0" />
              <span className="text-rose-200">MODO SEGURO</span>
              <span className="text-rose-400/90 text-[9px] font-mono">SEM CONEXÃO</span>
            </>
          ) : ordersBlocked ? (
            <>
              <Lock className="w-3 h-3 text-rose-400 shrink-0" />
              <span className="text-rose-200">MODO SEGURO</span>
              <span className="text-rose-400/90 text-[9px] font-mono">ORDENS BLOQUEADAS</span>
            </>
          ) : (
            <>
              <Unlock className="w-3 h-3 text-emerald-400 shrink-0" />
              <span className="text-emerald-200">MODO OPERACIONAL</span>
            </>
          )}
        </button>

        {/* Alerta vermelho pulsante: contradição (desconectado + ordens liberadas) */}
        {contradiction && (
          <div className="flex items-center gap-1 px-2 py-1 rounded-md border-rose-500/50 bg-rose-900/40 animate-pulse">
            <AlertTriangle className="w-3 h-3 text-rose-400 shrink-0" />
            <span className="text-[10px] font-bold text-rose-300">PONTE DESCONECTADA MAS ORDENS LIBERADAS</span>
          </div>
        )}
      </div>

      <div className="flex items-center gap-1 sm:gap-1.5 min-w-0 overflow-x-auto no-scrollbar pb-0.5">
        {rules.map((rule, i) => {
          const showTooltip = rule.label === 'Hard Cap por Magic';
          return (
            <div
              key={i}
              className="flex items-center gap-1 px-2 py-1 rounded-md border text-[9px] sm:text-xs leading-none shrink-0 whitespace-nowrap transition-colors"
              style={{
                backgroundColor: rule.ok
                  ? 'rgba(16, 185, 129, 0.10)'
                  : 'rgba(239, 68, 68, 0.10)',
                borderColor: rule.ok
                  ? 'rgba(16, 185, 129, 0.35)'
                  : 'rgba(239, 68, 68, 0.35)',
              }}
              title={
                showTooltip
                  ? 'Hard Cap por Magic: limite máximo de exposição por magic number, monitorado pela ponte.'
                  : rule.label
              }
            >
              <span
                className={`shrink-0 ${rule.ok ? 'text-emerald-400' : 'text-rose-400'}`}
              >
                {rule.ok ? <CheckCircle2 className="w-3 h-3" /> : <AlertCircle className="w-3 h-3" />}
              </span>
              <span className={`font-medium shrink-0 text-slate-200 ${rule.ok ? 'text-emerald-100' : 'text-rose-200'}`}>
                {rule.label}
              </span>
              <span
                className={`font-mono font-bold shrink-0 ${rule.ok ? 'text-emerald-200' : 'text-rose-300'}`}
              >
                {rule.value}
              </span>
              {i < rules.length - 1 && (
                <ChevronRight className="w-3 h-3 text-slate-600 shrink-0" />
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
};