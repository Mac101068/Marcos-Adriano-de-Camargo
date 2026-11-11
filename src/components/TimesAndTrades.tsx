import React, { useState, useMemo } from 'react';
import { Tick } from '../types/trading';
import { AssetSpec, formatPrice } from '../assets/assetRegistry';
import { Filter, ArrowUpRight, ArrowDownRight, Zap } from 'lucide-react';

interface TimesAndTradesProps {
  ticks: Tick[];
  cvd: number;
  asset?: AssetSpec;
}

export const TimesAndTrades: React.FC<TimesAndTradesProps> = ({ ticks, cvd, asset }) => {
  const [minVolumeFilter, setMinVolumeFilter] = useState<number>(1);
  const [onlyInstitutional, setOnlyInstitutional] = useState<boolean>(false);

  const instLimit = asset?.id === 'WDO' ? 20 : (asset?.id === 'BTCBR' ? 5 : 40);

  // Estatísticas da fita com volume financeiro em R$
  const stats = useMemo(() => {
    let buyVol = 0;
    let sellVol = 0;
    let buyFin = 0;
    let sellFin = 0;
    const pv = asset ? asset.pointValue : 0.2;
    ticks.forEach((t) => {
      const p = t.price || 0;
      const v = t.volume || 0;
      const fin = p * pv * v;
      if (t.aggressor === 'BUY') {
        buyVol += v;
        buyFin += fin;
      } else if (t.aggressor === 'SELL') {
        sellVol += v;
        sellFin += fin;
      }
    });
    const total = buyVol + sellVol || 1;
    const totalFin = buyFin + sellFin;
    const deltaFin = buyFin - sellFin;
    const buyPct = Math.round((buyVol / total) * 100);
    const sellPct = 100 - buyPct;
    return { buyVol, sellVol, total, buyPct, sellPct, buyFin, sellFin, totalFin, deltaFin };
  }, [ticks, asset]);

  // Formatação de Volume Financeiro em R$
  const getFinancialVolume = (price: number, volume: number) => {
    const pv = asset ? asset.pointValue : 0.2;
    const total = price * pv * volume;
    if (!Number.isFinite(total) || total <= 0) return '-';
    if (total >= 1_000_000) return `R$ ${(total / 1_000_000).toFixed(2)}M`;
    if (total >= 1_000) return `R$ ${(total / 1_000).toFixed(0)}k`;
    return `R$ ${total.toFixed(0)}`;
  };

  // Classificação do Lote (Perfil do Player)
  const getLotBadge = (volume: number) => {
    if (volume >= instLimit) {
      return (
        <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-400/20 text-amber-300 border border-amber-400/30">
          🏛️ INSTITUCIONAL
        </span>
      );
    }
    const midLimit = Math.max(3, Math.floor(instLimit / 3));
    if (volume >= midLimit) {
      return (
        <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-sky-500/15 text-sky-300 border border-sky-500/20">
          MÉDIO
        </span>
      );
    }
    return (
      <span className="px-1.5 py-0.5 rounded text-[10px] text-slate-500 font-normal">
        VAREJO
      </span>
    );
  };

  // Filtra ticks
  const filteredTicks = useMemo(() => {
    return ticks
      .filter((t) => {
        if (onlyInstitutional) return t.volume >= instLimit;
        return t.volume >= minVolumeFilter;
      })
      .slice(0, 100); // Mostra os 100 mais recentes
  }, [ticks, minVolumeFilter, onlyInstitutional, instLimit]);

  return (
    <div className="flex flex-col h-full bg-slate-950 border border-slate-800/80 rounded-lg overflow-hidden">
      {/* Cabeçalho de Controle e Filtros */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 bg-slate-900 border-b border-slate-800 text-xs">
        <div className="flex flex-wrap items-center gap-2.5">
          <Zap className="w-4 h-4 text-emerald-400" />
          <span className="font-semibold text-slate-100">
            Times & Trades {asset ? `· ${asset.label}` : 'MT5'}
          </span>
          <span className="text-slate-400 font-mono text-[11px]">· {ticks.length} negócios</span>

          {/* Volume Financeiro Total em Tempo Real */}
          <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-slate-950 border border-slate-800 font-mono text-[11px] shadow-xs">
            <span className="text-slate-400">Vol Fin:</span>
            <span className="font-bold text-emerald-400">
              {stats.totalFin >= 1_000_000
                ? `R$ ${(stats.totalFin / 1_000_000).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}M`
                : stats.totalFin >= 1_000
                ? `R$ ${(stats.totalFin / 1_000).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}k`
                : `R$ ${stats.totalFin.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
            </span>
          </div>

          {/* Saldo Financeiro Líquido (Delta) */}
          <div className="hidden sm:flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-slate-950 border border-slate-800 font-mono text-[11px] shadow-xs">
            <span className="text-slate-400">Delta Fin:</span>
            <span className={`font-bold ${stats.deltaFin >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
              {stats.deltaFin > 0 ? '+' : ''}
              {Math.abs(stats.deltaFin) >= 1_000_000
                ? `R$ ${(stats.deltaFin / 1_000_000).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}M`
                : Math.abs(stats.deltaFin) >= 1_000
                ? `R$ ${(stats.deltaFin / 1_000).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}k`
                : `R$ ${stats.deltaFin.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
            </span>
          </div>
        </div>

        {/* Filtros de Tamanho de Lote */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-md border border-slate-800">
            <span className="text-slate-400 text-[11px] px-1.5 flex items-center gap-1">
              <Filter className="w-3 h-3" /> Lote mín:
            </span>
            <button
              onClick={() => {
                setMinVolumeFilter(1);
                setOnlyInstitutional(false);
              }}
              className={`px-2 py-0.5 rounded text-[11px] font-mono transition-colors ${
                minVolumeFilter === 1 && !onlyInstitutional
                  ? 'bg-emerald-500/20 text-emerald-300 font-semibold'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Todos
            </button>
            <button
              onClick={() => {
                setMinVolumeFilter(asset?.id === 'WDO' ? 5 : 10);
                setOnlyInstitutional(false);
              }}
              className={`px-2 py-0.5 rounded text-[11px] font-mono transition-colors ${
                minVolumeFilter === (asset?.id === 'WDO' ? 5 : 10) && !onlyInstitutional
                  ? 'bg-emerald-500/20 text-emerald-300 font-semibold'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              ≥ {asset?.id === 'WDO' ? 5 : 10}
            </button>
            <button
              onClick={() => {
                setMinVolumeFilter(asset?.id === 'WDO' ? 10 : 25);
                setOnlyInstitutional(false);
              }}
              className={`px-2 py-0.5 rounded text-[11px] font-mono transition-colors ${
                minVolumeFilter === (asset?.id === 'WDO' ? 10 : 25) && !onlyInstitutional
                  ? 'bg-emerald-500/20 text-emerald-300 font-semibold'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              ≥ {asset?.id === 'WDO' ? 10 : 25}
            </button>
            <button
              onClick={() => setOnlyInstitutional(!onlyInstitutional)}
              className={`px-2 py-0.5 rounded text-[11px] font-mono transition-colors ${
                onlyInstitutional
                  ? 'bg-amber-500/20 text-amber-300 font-semibold border border-amber-500/40'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              🏛️ Institucional (≥ {instLimit})
            </button>
          </div>
        </div>
      </div>

      {/* Barra de Pressão de Agressão (Termômetro do Fluxo) */}
      <div className="px-4 py-2 bg-slate-900/50 border-b border-slate-800/80">
        <div className="flex items-center justify-between text-xs font-mono mb-1">
          <div className="flex items-center gap-1.5 text-emerald-400 font-semibold">
            <ArrowUpRight className="w-3.5 h-3.5" />
            <span>
              Compra: {stats.buyVol.toLocaleString('pt-BR')} ctros ({stats.buyPct}%)
              <span className="text-emerald-400/80 font-normal ml-1 hidden md:inline">
                · {stats.buyFin >= 1_000_000 ? `R$ ${(stats.buyFin / 1_000_000).toFixed(2)}M` : `R$ ${(stats.buyFin / 1_000).toFixed(0)}k`}
              </span>
            </span>
          </div>
          <div className="text-slate-300 font-bold">
            Saldo CVD:{' '}
            <span className={cvd >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
              {cvd > 0 ? '+' : ''}
              {cvd.toLocaleString('pt-BR')}
            </span>
          </div>
          <div className="flex items-center gap-1.5 text-rose-400 font-semibold">
            <span>
              <span className="text-rose-400/80 font-normal mr-1 hidden md:inline">
                {stats.sellFin >= 1_000_000 ? `R$ ${(stats.sellFin / 1_000_000).toFixed(2)}M` : `R$ ${(stats.sellFin / 1_000).toFixed(0)}k`} ·
              </span>
              Venda: {stats.sellVol.toLocaleString('pt-BR')} ctros ({stats.sellPct}%)
            </span>
            <ArrowDownRight className="w-3.5 h-3.5" />
          </div>
        </div>

        {/* Barra de visualização de agressão */}
        <div className="w-full h-2 rounded-full bg-slate-800 overflow-hidden flex">
          <div
            className="h-full bg-emerald-500 transition-all duration-200"
            style={{ width: `${stats.buyPct}%` }}
          />
          <div
            className="h-full bg-rose-500 transition-all duration-200"
            style={{ width: `${stats.sellPct}%` }}
          />
        </div>
      </div>

      {/* Tabela de Negócios Tick-a-Tick */}
      <div className="flex-1 overflow-y-auto">
        <table className="w-full text-left text-xs font-mono">
          <thead className="sticky top-0 bg-slate-900/95 backdrop-blur-xs text-slate-400 border-b border-slate-800 text-[11px]">
            <tr>
              <th className="py-1.5 px-3">Horário</th>
              <th className="py-1.5 px-3">Preço</th>
              <th className="py-1.5 px-3 text-right">Qtd</th>
              <th className="py-1.5 px-3 text-center">Agressor</th>
              <th className="py-1.5 px-3 text-center">Perfil</th>
              <th className="hidden sm:table-cell py-1.5 px-3 text-right">Vol Fin (R$)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/40">
            {filteredTicks.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-8 text-center text-slate-500">
                  Nenhum tick correspondente ao filtro no momento.
                </td>
              </tr>
            ) : (
              filteredTicks.map((tick) => {
                const isBuy = tick.aggressor === 'BUY';
                const isBigLot = tick.volume >= instLimit;
                return (
                  <tr
                    key={tick.id}
                    className={`hover:bg-slate-800/40 transition-colors ${
                      isBigLot ? 'bg-amber-500/5' : ''
                    }`}
                  >
                    <td className="py-1 px-3 text-slate-400 text-[11px]">{tick.timeStr}</td>
                    <td
                      className={`py-1 px-3 font-semibold ${
                        isBuy ? 'text-emerald-400' : 'text-rose-400'
                      }`}
                    >
                      {asset ? formatPrice(tick.price, asset) : tick.price.toLocaleString('pt-BR')}
                    </td>
                    <td className="py-1 px-3 text-right">
                      <span
                        className={`inline-block px-1.5 py-0.2 rounded font-bold ${
                          isBigLot
                            ? 'bg-amber-400/20 text-amber-300 border border-amber-400/40'
                            : isBuy
                            ? 'text-emerald-300'
                            : 'text-rose-300'
                        }`}
                      >
                        {tick.volume}
                      </span>
                    </td>
                    <td className="py-1 px-3 text-center">
                      <span
                        className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                          isBuy
                            ? 'bg-emerald-500/10 text-emerald-400'
                            : 'bg-rose-500/10 text-rose-400'
                        }`}
                      >
                        {isBuy ? 'COMPRA' : 'VENDA'}
                      </span>
                    </td>
                    <td className="py-1 px-3 text-center">
                      {getLotBadge(tick.volume)}
                    </td>
                    <td className="hidden sm:table-cell py-1 px-3 text-slate-300 text-[11px] text-right font-mono">
                      {getFinancialVolume(tick.price, tick.volume)}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
