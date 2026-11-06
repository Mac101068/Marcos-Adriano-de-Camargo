import React from 'react';
import { AssetId, ASSETS } from '../assets/assetRegistry';
import { Activity, DollarSign, Bitcoin, CheckCircle2 } from 'lucide-react';

export interface AssetTabInfo {
  id: AssetId;
  symbol: string;
  label: string;
  price: number;
  decimals: number;
  openOrdersCount: number;
  connected: boolean;
}

interface AssetChartTabsProps {
  currentAssetId: AssetId;
  onSelectAsset: (id: AssetId) => void;
  assetStates?: Partial<Record<AssetId, {
    currentPrice: number;
    openOrdersCount?: number;
  }>>;
  isMt5Connected?: boolean;
}

const TAB_CONFIGS: Array<{
  id: AssetId;
  icon: React.ComponentType<{ className?: string }>;
  accentColor: string;
  activeBorder: string;
  badgeBg: string;
  badgeText: string;
}> = [
  {
    id: 'WIN',
    icon: Activity,
    accentColor: 'text-emerald-400',
    activeBorder: 'border-b-2 border-emerald-500 bg-zinc-900/90 text-zinc-100 shadow-[inset_0_-2px_0_0_#10b981]',
    badgeBg: 'bg-emerald-950/80 border-emerald-700/60 text-emerald-300',
    badgeText: 'WIN',
  },
  {
    id: 'WDO',
    icon: DollarSign,
    accentColor: 'text-amber-400',
    activeBorder: 'border-b-2 border-amber-500 bg-zinc-900/90 text-zinc-100 shadow-[inset_0_-2px_0_0_#f59e0b]',
    badgeBg: 'bg-amber-950/80 border-amber-700/60 text-amber-300',
    badgeText: 'WDO',
  },
  {
    id: 'BTCBR',
    icon: Bitcoin,
    accentColor: 'text-orange-400',
    activeBorder: 'border-b-2 border-orange-500 bg-zinc-900/90 text-zinc-100 shadow-[inset_0_-2px_0_0_#f97316]',
    badgeBg: 'bg-orange-950/80 border-orange-700/60 text-orange-300',
    badgeText: 'BIT',
  },
];

export const AssetChartTabs: React.FC<AssetChartTabsProps> = ({
  currentAssetId,
  onSelectAsset,
  assetStates = {},
  isMt5Connected = false,
}) => {
  return (
    <div className="flex items-center justify-between px-2 bg-zinc-950 border-b border-zinc-800/90 select-none shrink-0 h-9 font-mono overflow-x-auto no-scrollbar">
      {/* Abas dos Ativos */}
      <div className="flex items-center gap-1 min-w-0">
        {TAB_CONFIGS.map((tab) => {
          const spec = ASSETS[tab.id];
          if (!spec) return null;

          const isActive = currentAssetId === tab.id || (tab.id === 'BTCBR' && currentAssetId === 'BTC');
          const Icon = tab.icon;
          const liveContract = spec.activeContract || spec.primarySymbol;
          const stateData = assetStates[tab.id];
          const ordersCount = stateData?.openOrdersCount ?? 0;

          return (
            <button
              key={tab.id}
              onClick={() => onSelectAsset(tab.id)}
              className={`group relative flex items-center gap-2 px-3.5 h-8 rounded-t-md text-xs transition-all cursor-pointer ${
                isActive
                  ? `${tab.activeBorder} font-bold z-10`
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/50 border-b border-transparent'
              }`}
              title={`Alternar gráfico para ${spec.label} (${liveContract})`}
            >
              {/* Ícone temático do ativo */}
              <Icon
                className={`w-3.5 h-3.5 transition-transform group-hover:scale-110 ${
                  isActive ? tab.accentColor : 'text-zinc-500'
                }`}
              />

              {/* Símbolo do Contrato Vigente */}
              <span className={`font-semibold tracking-tight ${isActive ? 'text-zinc-100' : 'text-zinc-300'}`}>
                {liveContract}
              </span>

              {/* Nome amigável do contrato */}
              <span className="text-[10px] text-zinc-500 group-hover:text-zinc-400 hidden md:inline">
                {spec.label.split('(')[0].trim()}
              </span>

              {/* Ponto indicador de feed ativo se conectado */}
              {isMt5Connected && (
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    isActive ? 'bg-emerald-400 shadow-[0_0_6px_#10b981]' : 'bg-zinc-600'
                  }`}
                  title={isActive ? 'Gráfico em tempo real ativo' : 'Alimentando em segundo plano'}
                />
              )}

              {/* Badge de Ordens Vivas no Ativo */}
              {ordersCount > 0 && (
                <span
                  className="px-1.5 py-0.2 rounded-full text-[9.5px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40 animate-pulse"
                  title={`${ordersCount} posição(ões)/ordem(ns) aberta(s) neste ativo`}
                >
                  {ordersCount} {ordersCount === 1 ? 'pos' : 'pos'}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Rótulo de Status das Abas */}
      <div className="hidden sm:flex items-center gap-2 text-[10px] text-zinc-500 pr-2">
        <span className="flex items-center gap-1">
          <CheckCircle2 className="w-3 h-3 text-emerald-500" />
          <span>Multi-Ativos 100% Sincronizados</span>
        </span>
      </div>
    </div>
  );
};

