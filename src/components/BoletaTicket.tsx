import React, { useEffect, useState } from 'react';
import { ArrowUp, ArrowDown, ChevronDown, ChevronUp, Pin, PinOff } from 'lucide-react';
import { TradeOrder } from '../types/trading';
import { ASSETS, AssetSpec, DEFAULT_ASSET_ID, formatPrice, pointsToBRL } from '../assets/assetRegistry';

/**
 * BOLETA — ordem rápida do operador, numa caixa única com recolhimento automático.
 *
 * Antes Existiam duas cópias que se anulavam: a barra grande sobre o gráfico (`lg:hidden`) e a
 * seção "Ordem rápida" da barra lateral (`hidden lg:flex`). Conforme o zoom da janela, uma das
 * duas sumia e a boleta desaparecia da tela. Esta caixa vive sobre o canvas, sempre presente,
 * e some de vista sozinha (recolhe) para não brigar com o gráfico.
 */

// v1: abre expandida na primeira vez; depois obedece a última escolha do operador
const STORAGE_KEY_OPEN = 'fluxo_boleta_open_v1';
// Recolhe sozinho depois desse tempo (não fecha enquanto o mouse estiver em cima, nem se fixado)
const AUTO_COLLAPSE_MS = 9000;

interface BoletaTicketProps {
  currentPrice: number;
  contracts: number;
  stopLossPoints: number;
  takeProfitPoints: number;
  /** Modo da estratégia: na Pirâmide a Ordem Mãe não tem SL/TP fixo — a boleta diz isso, não inventa número. */
  strategyMode?: 'PULLBACK_RETEST' | 'PYRAMID_FLOW_CONFLUENCE';
  openOrders: TradeOrder[];
  /** PnL flutuante já calculado pelo gráfico (pontos + R$ + quantidade de posições). */
  pnl: { points: number; financial: number; openCount: number };
  isRealMT5Connected?: boolean;
  asset?: AssetSpec;
  /**
   * Recuo da borda direita, em px: a boleta nunca pode cobrir a régua de preços do eixo Y
   * (46px no mobile, 64px no desktop — quem passa o valor é o gráfico, que já sabe a largura).
   */
  rightOffset?: number;
  onManualOrder?: (type: 'BUY' | 'SELL') => void;
  onClosePositions?: () => void;
}

const readOpenPref = (): boolean => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_OPEN);
    if (raw === null) return true;
    return raw === 'true';
  } catch {
    return true;
  }
};

const Row: React.FC<{ label: string; value: string; tone?: 'neutral' | 'emerald' | 'rose' | 'sky' }> = ({
  label,
  value,
  tone = 'neutral',
}) => {
  const toneClass =
    tone === 'emerald'
      ? 'text-emerald-300'
      : tone === 'rose'
      ? 'text-rose-300'
      : tone === 'sky'
      ? 'text-sky-300'
      : 'text-zinc-100';
  return (
    <div className="flex items-baseline justify-between gap-2 leading-tight">
      <span className="text-[9.5px] uppercase tracking-wide text-zinc-500 shrink-0">{label}</span>
      <span className={`text-[11px] font-semibold tabular-nums truncate ${toneClass}`}>{value}</span>
    </div>
  );
};

export const BoletaTicket: React.FC<BoletaTicketProps> = ({
  currentPrice,
  contracts,
  stopLossPoints,
  takeProfitPoints,
  strategyMode = 'PULLBACK_RETEST',
  openOrders,
  pnl,
  isRealMT5Connected = false,
  asset = ASSETS[DEFAULT_ASSET_ID],
  rightOffset = 96,
  onManualOrder,
  onClosePositions,
}) => {
  const [open, setOpen] = useState<boolean>(readOpenPref);
  const [pinned, setPinned] = useState<boolean>(false);
  const [hovered, setHovered] = useState<boolean>(false);

  // Persiste só a escolha de aberto/fechado (o resto é transitório)
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_OPEN, String(open));
    } catch {
      // Ignora erro de storage
    }
  }, [open]);

  // Recolhimento automático: roda de novo a cada mudança de estado e não interfere com o mouse
  // em cima da caixa, nem quando o operador fixou a boleta aberta.
  useEffect(() => {
    if (!open || pinned || hovered) return;
    const t = setTimeout(() => setOpen(false), AUTO_COLLAPSE_MS);
    return () => clearTimeout(t);
  }, [open, pinned, hovered]);

  const isPyramid = strategyMode === 'PYRAMID_FLOW_CONFLUENCE';
  // R$ em risco na operação: a perda se o stop for batido (só faz sentido com SL fixo do modo Reteste)
  const riskBRL = isPyramid || stopLossPoints <= 0 ? 0 : pointsToBRL(stopLossPoints, contracts, asset);

  // Chip fechado: um toque abre de novo (e a posição oposta do tijolo fica livre)
  if (!open) {
    return (
      <div className="absolute top-2 z-30 pointer-events-auto select-none" style={{ right: rightOffset }}>
        <button
          onClick={() => setOpen(true)}
          className="flex items-center gap-1.5 px-2 h-[26px] rounded-md bg-zinc-950/92 backdrop-blur-md border border-zinc-700/80 shadow-xl text-[11px] font-mono text-zinc-200 hover:text-white hover:border-zinc-600 cursor-pointer transition-colors"
          title="Abrir a boleta (ordem rápida)"
        >
          <span className="text-[9px] font-sans font-bold uppercase tracking-wider text-zinc-500">Boleta</span>
          <span className="font-semibold text-emerald-300 tabular-nums">{formatPrice(currentPrice, asset)}</span>
          {openOrders.length > 0 && (
            <span className="text-[9.5px] font-sans font-bold px-1 rounded bg-zinc-800 text-zinc-300">
              {openOrders.length}
            </span>
          )}
          <ChevronUp className="w-3 h-3 text-zinc-500" />
        </button>
      </div>
    );
  }

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ right: rightOffset }}
      className="absolute top-2 z-30 w-[196px] rounded-lg bg-zinc-950/94 backdrop-blur-md border border-zinc-700/80 shadow-2xl pointer-events-auto select-none"
    >
      {/* Cabeçalho: título + estado do feed + fixar + recolher */}
      <div className="flex items-center gap-1.5 px-2 h-7 border-b border-zinc-800/80">
        <span className="text-[9px] font-sans font-bold uppercase tracking-wider text-zinc-500">Boleta</span>
        <span
          className={`text-[8.5px] font-sans uppercase tracking-wide px-1 py-0.2 rounded border ${
            isRealMT5Connected
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
              : 'bg-zinc-900 border-zinc-700/80 text-zinc-400'
          }`}
          title={isRealMT5Connected ? 'Ordens saem pela ponte do MT5' : 'Ordens de teste: nada vai à corretora'}
        >
          {isRealMT5Connected ? 'MT5' : 'SIM'}
        </span>
        <button
          onClick={() => setPinned((p) => !p)}
          className={`ml-auto p-0.5 cursor-pointer transition-colors ${
            pinned ? 'text-sky-300' : 'text-zinc-500 hover:text-zinc-200'
          }`}
          title={pinned ? 'Desfixar (volta a recolher sozinho)' : 'Fixar aberta (não recolhe sozinha)'}
          aria-label={pinned ? 'Desfixar boleta' : 'Fixar boleta'}
        >
          {pinned ? <PinOff className="w-3 h-3" /> : <Pin className="w-3 h-3" />}
        </button>
        <button
          onClick={() => setOpen(false)}
          className="p-0.5 text-zinc-500 hover:text-zinc-100 cursor-pointer"
          title="Recolher a boleta"
          aria-label="Recolher boleta"
        >
          <ChevronDown className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Dados básicos da ordem */}
      <div className="px-2 py-1.5 space-y-0.5 font-mono">
        <Row label="Preço" value={`${formatPrice(currentPrice, asset)} pts`} tone="emerald" />
        <Row label="Contratos" value={`${contracts} ctro${contracts === 1 ? '' : 's'}`} />
        {isPyramid ? (
          <Row label="Alvo / Stop" value="Surfe (sem fixo)" />
        ) : (
          <>
            <Row
              label="Stop"
              value={`${formatPrice(currentPrice - stopLossPoints, asset)} (−${stopLossPoints}p)`}
              tone="rose"
            />
            <Row
              label="Alvo"
              value={`${formatPrice(currentPrice + takeProfitPoints, asset)} (+${takeProfitPoints}p)`}
              tone="sky"
            />
          </>
        )}
        {riskBRL > 0 && (
          <Row
            label="Risco"
            value={`−${riskBRL.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`}
            tone="rose"
          />
        )}
        <Row
          label="Abertas"
          value={
            openOrders.length > 0
              ? `${openOrders.length} · ${pnl.points > 0 ? '+' : ''}${pnl.points} pts`
              : 'nenhuma'
          }
          tone={openOrders.length === 0 ? 'neutral' : pnl.financial >= 0 ? 'emerald' : 'rose'}
        />
      </div>

      {/* Ações */}
      <div className="px-2 pb-2 flex items-center gap-1.5">
        <button
          onClick={() => onManualOrder?.('BUY')}
          disabled={!onManualOrder}
          className="flex-1 h-[30px] rounded bg-emerald-600 hover:bg-emerald-500 active:scale-95 disabled:opacity-40 text-white text-[11px] font-bold flex items-center justify-center gap-1 transition-all cursor-pointer"
          title={`Enviar COMPRA a mercado (${contracts} ctros a ${formatPrice(currentPrice, asset)} pts)`}
        >
          <ArrowUp className="w-3 h-3 stroke-[2.5]" />
          <span>COMPRA</span>
        </button>
        <button
          onClick={() => onManualOrder?.('SELL')}
          disabled={!onManualOrder}
          className="flex-1 h-[30px] rounded bg-rose-600 hover:bg-rose-500 active:scale-95 disabled:opacity-40 text-white text-[11px] font-bold flex items-center justify-center gap-1 transition-all cursor-pointer"
          title={`Enviar VENDA a mercado (${contracts} ctros a ${formatPrice(currentPrice, asset)} pts)`}
        >
          <ArrowDown className="w-3 h-3 stroke-[2.5]" />
          <span>VENDA</span>
        </button>
      </div>
      {openOrders.length > 0 && onClosePositions && (
        <div className="px-2 pb-2">
          <button
            onClick={onClosePositions}
            className="w-full h-[26px] rounded text-[11px] font-bold bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 active:scale-95 transition-all cursor-pointer flex items-center justify-center gap-1.5"
            title="Zerar todas as ordens e posições abertas imediatamente"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
            <span>ZERAR ({openOrders.length})</span>
          </button>
        </div>
      )}
    </div>
  );
};
