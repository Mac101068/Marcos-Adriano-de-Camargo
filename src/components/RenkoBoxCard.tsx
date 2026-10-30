import React, { useEffect, useRef, useState } from 'react';
import { Move, Pin, ChevronDown, ChevronUp } from 'lucide-react';
import { RenkoBox } from '../types/trading';

const STORAGE_KEY_HUD_POS = 'fluxo_renko_hud_pos_v1';

// Geometria do card flutuante: largura fixa e recuo da régua de preços
const CARD_W = 285;
const EDGE_GAP = 10;
const RIGHT_AXIS_GAP = 88;

interface HudPosition {
  x: number;
  y: number;
}

interface RenkoBoxCardProps {
  box: RenkoBox;
  haState: 'UP' | 'DOWN' | 'REVERSAL' | null;
  /** true quando o operador está inspecionando um box antigo com o mouse */
  isInspection: boolean;
  /** tamanho da área do canvas, usado para manter o card dentro da área visível */
  bounds: { w: number; h: number };
  variant?: 'floating' | 'mobile' | 'window';
  mobileOpen?: boolean;
  onToggleMobile?: (open: boolean) => void;
}

const readSavedPos = (): HudPosition | null => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_HUD_POS);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const x = Number(parsed.x);
    const y = Number(parsed.y);
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0) return null;
    return { x, y };
  } catch (e) {
    return null;
  }
};

// Linhas de leitura do box: OHLC + fluxo + volume, reutilizadas nas duas variantes
const BoxRows: React.FC<{ box: RenkoBox; haState: RenkoBoxCardProps['haState']; small?: boolean }> = ({
  box,
  haState,
  small,
}) => (
  <>
    <div
      className={`grid grid-cols-2 gap-x-2 gap-y-1 py-1.5 ${small ? 'text-[10px]' : 'text-[11px]'} font-mono border-b border-slate-800/80`}
    >
      <div>
        <span className="text-slate-500 mr-1">Aber:</span>
        <span className="text-slate-200">{box.open.toLocaleString('pt-BR')}</span>
      </div>
      <div>
        <span className="text-slate-500 mr-1">Fech:</span>
        <span className="text-slate-100 font-semibold">{box.close.toLocaleString('pt-BR')}</span>
      </div>
      <div>
        <span className="text-slate-500 mr-1">Máx:</span>
        <span className="text-slate-300">{box.high.toLocaleString('pt-BR')}</span>
      </div>
      <div>
        <span className="text-slate-500 mr-1">Mín:</span>
        <span className="text-slate-300">{box.low.toLocaleString('pt-BR')}</span>
      </div>
    </div>

    <div className={`py-1.5 space-y-1 ${small ? 'text-[10px] py-1' : 'text-[11px]'} font-mono border-b border-slate-800/80`}>
      <div className="flex items-center justify-between">
        <span className="text-slate-400">Fluxo Heikin-Ashi:</span>
        <span
          className={`font-bold flex items-center gap-1 ${
            haState === 'UP' ? 'text-emerald-400' : haState === 'DOWN' ? 'text-rose-400' : 'text-slate-300'
          }`}
        >
          {haState === 'UP'
            ? '▲ SUBIDA (VERDE)'
            : haState === 'DOWN'
            ? '▼ DESCIDA (VERMELHO)'
            : '⚡ REVERSÃO (CINZA)'}
        </span>
      </div>

      <div className="flex items-center justify-between">
        <span className="text-slate-400">Saldo CVD:</span>
        <span className="text-sky-400 font-semibold">{box.cvdAtClose.toLocaleString('pt-BR')} ctros</span>
      </div>
      <div className="flex items-center justify-between">
        <span className="text-slate-400">Delta do Box:</span>
        <span className={`font-bold ${box.delta >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
          {box.delta > 0 ? '+' : ''}
          {box.delta} ctros
        </span>
      </div>
      <div className="flex items-center justify-between text-[10px] text-slate-500">
        <span>
          C: {box.buyVolume} | V: {box.sellVolume}
        </span>
        <span>{box.ticksCount} ticks</span>
      </div>
    </div>
  </>
);

const ConvergenceTag: React.FC<{ box: RenkoBox }> = ({ box }) => {
  if (box.convergenceType === 'BUY_CONVERGENCE') {
    return (
      <div className="text-[10px] font-bold text-emerald-300 bg-emerald-500/15 border border-emerald-500/30 rounded px-2 py-0.5 text-center">
        ▲ CONVERGÊNCIA COMPRA DISPARADA
      </div>
    );
  }
  if (box.convergenceType === 'SELL_CONVERGENCE') {
    return (
      <div className="text-[10px] font-bold text-rose-300 bg-rose-500/15 border border-rose-500/30 rounded px-2 py-0.5 text-center">
        ▼ CONVERGÊNCIA VENDA DISPARADA
      </div>
    );
  }
  if (box.convergenceType === 'DIVERGENCE') {
    return (
      <div className="text-[10px] font-bold text-amber-300 bg-amber-500/15 border border-amber-500/30 rounded px-2 py-0.5 text-center">
        ⚡ DIVERGÊNCIA DE FLUXO (ABSORÇÃO)
      </div>
    );
  }
  return (
    <div className="text-[10px] text-slate-500 bg-slate-900/60 rounded px-2 py-0.5 text-center">
      Fluxo Regular / Neutro
    </div>
  );
};

export const RenkoBoxCard: React.FC<RenkoBoxCardProps> = ({
  box,
  haState,
  isInspection,
  bounds,
  variant = 'floating',
  mobileOpen = false,
  onToggleMobile,
}) => {
  const cardRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ dx: number; dy: number } | null>(null);
  const [pos, setPos] = useState<HudPosition | null>(() => readSavedPos());
  const [dragging, setDragging] = useState<boolean>(false);
  const [collapsed, setCollapsed] = useState<boolean>(false);

  // Mantém o card dentro da área visível quando o canvas é redimensionado
  useEffect(() => {
    if (variant !== 'floating' || !pos || bounds.w === 0 || bounds.h === 0) return;
    const el = cardRef.current;
    const w = el?.offsetWidth ?? CARD_W;
    const h = el?.offsetHeight ?? 220;
    const maxX = Math.max(EDGE_GAP, bounds.w - w - RIGHT_AXIS_GAP);
    const maxY = Math.max(EDGE_GAP, bounds.h - h - EDGE_GAP);
    if (pos.x > maxX || pos.y > maxY) {
      setPos({ x: Math.min(Math.max(EDGE_GAP, pos.x), maxX), y: Math.min(Math.max(EDGE_GAP, pos.y), maxY) });
    }
  }, [bounds.w, bounds.h, pos, variant]);

  // Persiste a posição escolhida pelo operador
  useEffect(() => {
    if (variant !== 'floating' || !pos) return;
    try {
      localStorage.setItem(STORAGE_KEY_HUD_POS, JSON.stringify({ x: Math.round(pos.x), y: Math.round(pos.y) }));
    } catch (e) {
      // Ignora erro de storage
    }
  }, [pos, variant]);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (variant !== 'floating') return;
    const el = cardRef.current;
    const parent = el?.parentElement;
    if (!el || !parent) return;

    const cardRect = el.getBoundingClientRect();
    dragRef.current = { dx: e.clientX - cardRect.left, dy: e.clientY - cardRect.top };
    setDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (variant !== 'floating' || !dragRef.current) return;
    const el = cardRef.current;
    const parent = el?.parentElement;
    if (!el || !parent) return;

    const parentRect = parent.getBoundingClientRect();
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const rawX = e.clientX - parentRect.left - dragRef.current.dx;
    const rawY = e.clientY - parentRect.top - dragRef.current.dy;
    const maxX = Math.max(EDGE_GAP, parentRect.width - w - RIGHT_AXIS_GAP);
    const maxY = Math.max(EDGE_GAP, parentRect.height - h - EDGE_GAP);
    setPos({
      x: Math.min(Math.max(EDGE_GAP, rawX), maxX),
      y: Math.min(Math.max(EDGE_GAP, rawY), maxY),
    });
  };

  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (variant !== 'floating' || !dragRef.current) return;
    dragRef.current = null;
    setDragging(false);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const directionBadge =
    box.direction === 'UP' ? (
      <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
        ALTA +50
      </span>
    ) : (
      <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-rose-500/20 text-rose-400 border border-rose-500/30">
        BAIXA -50
      </span>
    );

  if (variant === 'window') {
    // Variante dentro da janela flutuante "Box Renko": conteúdo estático, a barra de título da janela já arrasta/fecha
    return (
      <div className="w-full h-full overflow-y-auto p-2.5 font-sans text-xs">
        <div className="flex items-center justify-between pb-1.5 border-b border-slate-800">
          <span className="font-bold text-slate-100">Box Renko 10R #{box.index}</span>
          <div className="flex items-center gap-1.5">
            {directionBadge}
            <span
              className={`text-[9px] font-mono px-1 rounded ${
                isInspection ? 'text-sky-400 bg-sky-500/10' : 'text-emerald-400 bg-emerald-500/10'
              }`}
            >
              {isInspection ? 'INSPEÇÃO' : 'AO VIVO'}
            </span>
          </div>
        </div>

        <BoxRows box={box} haState={haState} />

        <div className="pt-1.5">
          <ConvergenceTag box={box} />
        </div>
      </div>
    );
  }

  if (variant === 'mobile') {
    if (!mobileOpen) {
      return (
        <div
          onClick={() => onToggleMobile?.(true)}
          className="bg-slate-900/90 backdrop-blur-md border border-slate-800 rounded-lg px-2.5 py-1 text-[11px] font-mono flex items-center justify-between shadow-lg cursor-pointer active:scale-98"
        >
          <div className="flex items-center gap-1.5">
            <span className={`w-2 h-2 rounded-full ${box.direction === 'UP' ? 'bg-emerald-400' : 'bg-rose-400'}`} />
            <span className="font-bold text-slate-200">10R #{box.index}</span>
            <span className={`font-bold ${box.delta >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
              Δ{box.delta > 0 ? '+' : ''}
              {box.delta}
            </span>
          </div>
          <div className="flex items-center gap-1 text-[10px] text-sky-400">
            <span>Detalhes</span>
            <ChevronUp className="w-3 h-3" />
          </div>
        </div>
      );
    }

    return (
      <div className="bg-slate-950/95 backdrop-blur-md border border-slate-700 rounded-lg p-2.5 shadow-2xl animate-in slide-in-from-bottom duration-200">
        <div className="flex items-center justify-between pb-1 border-b border-slate-800">
          <span className="font-bold text-slate-100 text-xs">Box Renko 10R #{box.index}</span>
          <button
            onClick={() => onToggleMobile?.(false)}
            className="p-1 text-slate-400 hover:text-slate-100 text-xs flex items-center gap-0.5 cursor-pointer"
          >
            <span>Ocultar</span>
            <ChevronDown className="w-3.5 h-3.5" />
          </button>
        </div>
        <BoxRows box={box} haState={haState} small />
      </div>
    );
  }

  // Variante flutuante: arrastável pelo cabeçalho, com posição persistida
  const positionedStyle: React.CSSProperties | undefined = pos === null ? undefined : { left: pos.x, top: pos.y };

  if (collapsed) {
    return (
      <div
        ref={cardRef}
        style={positionedStyle}
        className={`hidden sm:block absolute ${pos === null ? 'bottom-3 right-[88px]' : ''} z-30 pointer-events-auto select-none`}
      >
        <div
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          className={`flex items-center gap-1.5 px-2 py-1 rounded-lg bg-slate-950/95 backdrop-blur-md border border-slate-700/80 shadow-2xl text-[11px] font-mono ${
            dragging ? 'cursor-grabbing' : 'cursor-grab'
          }`}
          title="Arraste para reposicionar o box card"
        >
          <Move className="w-3 h-3 text-slate-500" />
          <span className="font-bold text-slate-200">10R #{box.index}</span>
          <span className={`font-bold ${box.delta >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
            Δ{box.delta > 0 ? '+' : ''}
            {box.delta}
          </span>
          <button
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => setCollapsed(false)}
            className="ml-1 p-0.5 text-slate-400 hover:text-slate-100 cursor-pointer"
            title="Expandir detalhes do box"
          >
            <ChevronUp className="w-3 h-3" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={cardRef}
      style={{ ...positionedStyle, width: CARD_W }}
      className={`hidden sm:block absolute ${
        pos === null ? 'bottom-3 right-[88px]' : ''
      } z-30 bg-slate-950/95 backdrop-blur-md border border-slate-700/80 rounded-lg p-2.5 shadow-2xl shadow-black/40 pointer-events-auto select-none font-sans text-xs`}
    >
      <div
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        className={`flex items-center justify-between pb-1.5 border-b border-slate-800 ${
          dragging ? 'cursor-grabbing' : 'cursor-grab'
        }`}
        title="Arraste para reposicionar o box card"
      >
        <div className="flex items-center gap-1.5 font-bold text-slate-100">
          <Move className="w-3 h-3 text-slate-500" />
          <Pin className="w-3 h-3 text-sky-400 rotate-45" />
          <span>Box Renko 10R #{box.index}</span>
        </div>
        <div className="flex items-center gap-1.5">
          {directionBadge}
          <span
            className={`text-[9px] font-mono px-1 rounded ${
              isInspection ? 'text-sky-400 bg-sky-500/10' : 'text-emerald-400 bg-emerald-500/10'
            }`}
          >
            {isInspection ? 'INSPEÇÃO' : 'AO VIVO'}
          </span>
          <button
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => setCollapsed(true)}
            className="p-0.5 text-slate-400 hover:text-slate-100 cursor-pointer"
            title="Recolher box card"
          >
            <ChevronDown className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <BoxRows box={box} haState={haState} />

      <div className="pt-1.5">
        <ConvergenceTag box={box} />
      </div>
    </div>
  );
};
