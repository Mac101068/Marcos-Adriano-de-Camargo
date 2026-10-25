import React, { useState, useMemo } from 'react';
import { Tick } from '../types/trading';
import { Filter, ArrowUpRight, ArrowDownRight, Zap } from 'lucide-react';

interface TimesAndTradesProps {
  ticks: Tick[];
  cvd: number;
}

export const TimesAndTrades: React.FC<TimesAndTradesProps> = ({ ticks, cvd }) => {
  const [minVolumeFilter, setMinVolumeFilter] = useState<number>(1);
  const [onlyInstitutional, setOnlyInstitutional] = useState<boolean>(false);

  // Estatísticas da fita
  const stats = useMemo(() => {
    let buyVol = 0;
    let sellVol = 0;
    ticks.forEach((t) => {
      if (t.aggressor === 'BUY') buyVol += t.volume;
      else if (t.aggressor === 'SELL') sellVol += t.volume;
    });
    const total = buyVol + sellVol || 1;
    const buyPct = Math.round((buyVol / total) * 100);
    const sellPct = 100 - buyPct;
    return { buyVol, sellVol, total, buyPct, sellPct };
  }, [ticks]);

  // Filtra ticks
  const filteredTicks = useMemo(() => {
    return ticks
      .filter((t) => {
        if (onlyInstitutional) return t.volume >= 40;
        return t.volume >= minVolumeFilter;
      })
      .slice(0, 80); // Mostra os 80 mais recentes
  }, [ticks, minVolumeFilter, onlyInstitutional]);

  return (
    <div className="flex flex-col h-full bg-slate-950 border border-slate-800/80 rounded-lg overflow-hidden">
      {/* Cabeçalho de Controle e Filtros */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 bg-slate-900 border-b border-slate-800 text-xs">
        <div className="flex items-center gap-2">
          <Zap className="w-4 h-4 text-emerald-400" />
          <span className="font-semibold text-slate-100">Times & Trades MT5 (Tick-a-Tick)</span>
          <span className="text-slate-400 font-mono text-[11px]">· {ticks.length} negócios capturados</span>
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
                setMinVolumeFilter(10);
                setOnlyInstitutional(false);
              }}
              className={`px-2 py-0.5 rounded text-[11px] font-mono transition-colors ${
                minVolumeFilter === 10 && !onlyInstitutional
                  ? 'bg-emerald-500/20 text-emerald-300 font-semibold'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              ≥ 10
            </button>
            <button
              onClick={() => {
                setMinVolumeFilter(25);
                setOnlyInstitutional(false);
              }}
              className={`px-2 py-0.5 rounded text-[11px] font-mono transition-colors ${
                minVolumeFilter === 25 && !onlyInstitutional
                  ? 'bg-emerald-500/20 text-emerald-300 font-semibold'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              ≥ 25
            </button>
            <button
              onClick={() => setOnlyInstitutional(!onlyInstitutional)}
              className={`px-2 py-0.5 rounded text-[11px] font-mono transition-colors ${
                onlyInstitutional
                  ? 'bg-amber-500/20 text-amber-300 font-semibold border border-amber-500/40'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              🏛️ Grandes Lotes (≥ 40)
            </button>
          </div>
        </div>
      </div>

      {/* Barra de Pressão de Agressão (Termômetro do Fluxo) */}
      <div className="px-4 py-2 bg-slate-900/50 border-b border-slate-800/80">
        <div className="flex items-center justify-between text-xs font-mono mb-1">
          <div className="flex items-center gap-1.5 text-emerald-400 font-semibold">
            <ArrowUpRight className="w-3.5 h-3.5" />
            <span>Compra: {stats.buyVol.toLocaleString('pt-BR')} ctros ({stats.buyPct}%)</span>
          </div>
          <div className="text-slate-300 font-bold">
            Saldo CVD:{' '}
            <span className={cvd >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
              {cvd > 0 ? '+' : ''}
              {cvd.toLocaleString('pt-BR')}
            </span>
          </div>
          <div className="flex items-center gap-1.5 text-rose-400 font-semibold">
            <span>Venda: {stats.sellVol.toLocaleString('pt-BR')} ctros ({stats.sellPct}%)</span>
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
              <th className="hidden sm:table-cell py-1.5 px-3">Compradora</th>
              <th className="hidden sm:table-cell py-1.5 px-3">Vendedora</th>
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
                const isBigLot = tick.volume >= 40;
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
                      {tick.price.toLocaleString('pt-BR')}
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
                    <td className="hidden sm:table-cell py-1 px-3 text-slate-300 text-[11px] truncate max-w-[130px]">
                      {tick.buyerBroker || '-'}
                    </td>
                    <td className="hidden sm:table-cell py-1 px-3 text-slate-300 text-[11px] truncate max-w-[130px]">
                      {tick.sellerBroker || '-'}
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
