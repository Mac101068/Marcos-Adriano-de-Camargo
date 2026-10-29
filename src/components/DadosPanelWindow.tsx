import React, { useRef, useState } from 'react';
import { AppWindow, X } from 'lucide-react';

/**
 * Janela flutuante do painel de controles do Renko (atalho "Dados" no menu).
 * Arrastável pela barra de título, com posição limitada à área do gráfico,
 * duplo clique na barra devolve a janela ao canto superior esquerdo.
 */
interface DadosPanelWindowProps {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}

export const DadosPanelWindow: React.FC<DadosPanelWindowProps> = ({ title, onClose, children }) => {
  const frameRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ offX: number; offY: number } | null>(null);
  const [pos, setPos] = useState({ x: 10, y: 10 });

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const frame = frameRef.current;
    const parent = frame?.offsetParent as HTMLElement | null;
    if (!frame || !parent) return;
    const rect = parent.getBoundingClientRect();
    dragRef.current = {
      offX: e.clientX - rect.left - pos.x,
      offY: e.clientY - rect.top - pos.y,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    const frame = frameRef.current;
    const parent = frame?.offsetParent as HTMLElement | null;
    if (!frame || !parent) return;
    const rect = parent.getBoundingClientRect();
    const w = frame.offsetWidth;
    const h = frame.offsetHeight;
    setPos({
      x: Math.min(Math.max(0, e.clientX - rect.left - dragRef.current.offX), Math.max(0, rect.width - w)),
      y: Math.min(Math.max(0, e.clientY - rect.top - dragRef.current.offY), Math.max(0, rect.height - h)),
    });
  };

  const onPointerUp = () => {
    dragRef.current = null;
  };

  return (
    <div
      ref={frameRef}
      className="absolute z-30 w-[246px] max-h-[calc(100%-12px)] flex flex-col rounded-lg border border-slate-700/90 bg-slate-900/97 backdrop-blur-md shadow-2xl shadow-black/60 overflow-hidden"
      style={{ left: pos.x, top: pos.y }}
    >
      {/* Barra de título: arraste para mover */}
      <div
        className="flex items-center gap-1.5 h-7 shrink-0 px-2 bg-slate-950/90 border-b border-slate-800 cursor-move select-none touch-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onDoubleClick={() => setPos({ x: 10, y: 10 })}
        title="Arraste para mover a janela — duplo clique devolve ao canto"
      >
        <AppWindow className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
        <span className="text-[10px] uppercase tracking-wider text-slate-300 font-bold truncate">{title}</span>
        <button
          onClick={onClose}
          onPointerDown={(e) => e.stopPropagation()}
          className="ml-auto w-5 h-5 flex items-center justify-center rounded text-slate-400 hover:text-white hover:bg-rose-600/70 cursor-pointer shrink-0"
          title="Fechar janela (o botão Dados no menu reabre)"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Corpo da janela (a sidebar de controles vive aqui) */}
      <div className="flex-1 min-h-0 overflow-hidden flex flex-col">{children}</div>
    </div>
  );
};
