import React from 'react';
import {
  MousePointer2,
  TrendingUp,
  Minus,
  Square,
  MoveUpRight,
  Type,
  Undo2,
  Trash2,
} from 'lucide-react';
import { DrawingColor, DrawingTool } from '../types/drawing';

interface DrawingToolbarProps {
  activeTool: DrawingTool;
  onSelectTool: (tool: DrawingTool) => void;
  activeColor: DrawingColor;
  onSelectColor: (color: DrawingColor) => void;
  onUndo: () => void;
  onClearAll: () => void;
  hasDrawings: boolean;
  /** 'vertical' = barra flutuante sobre o canvas | 'inline' = embutida na barra lateral */
  layout?: 'vertical' | 'inline';
}

const TOOL_ITEMS: { tool: DrawingTool; icon: React.ElementType; label: string }[] = [
  { tool: 'select', icon: MousePointer2, label: 'Selecionar / Mover (tecla V) — clique num desenho para apagar com Delete' },
  { tool: 'trendline', icon: TrendingUp, label: 'Linha de Tendência — arraste entre dois tijolos' },
  { tool: 'hline', icon: Minus, label: 'Linha Horizontal — suporte/resistência (tecla H)' },
  { tool: 'rect', icon: Square, label: 'Retângulo / Zona — arraste para marcar região (tecla R)' },
  { tool: 'arrow', icon: MoveUpRight, label: 'Seta — aponte um movimento (tecla A)' },
  { tool: 'text', icon: Type, label: 'Texto — clique e digite a anotação (tecla T)' },
];

const COLOR_ITEMS: { color: DrawingColor; dot: string; label: string }[] = [
  { color: 'white', dot: '#e5e5e5', label: 'Cor neutra (padrão)' },
  { color: 'green', dot: '#10b981', label: 'Sinal de compra (verde)' },
  { color: 'red', dot: '#ef4444', label: 'Sinal de venda (vermelho)' },
];

// Barra de ferramentas de desenho: vertical flutuante (TradingView-like) ou inline na barra lateral
export const DrawingToolbar: React.FC<DrawingToolbarProps> = ({
  activeTool,
  onSelectTool,
  activeColor,
  onSelectColor,
  onUndo,
  onClearAll,
  hasDrawings,
  layout = 'vertical',
}) => {
  const inline = layout === 'inline';
  const toolBtn = (active: boolean) =>
    `w-7 h-7 flex items-center justify-center rounded-md transition-colors cursor-pointer ${
      active ? 'bg-slate-700 text-slate-50 shadow-inner' : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800'
    }`;

  return (
    <div
      className={
        inline
          ? 'flex flex-wrap items-center gap-0.5'
          : 'flex flex-col gap-0.5 p-1 rounded-lg bg-slate-900/90 backdrop-blur-md border border-slate-700/80 shadow-2xl pointer-events-auto select-none'
      }
    >
      {TOOL_ITEMS.map(({ tool, icon: Icon, label }) => (
        <button key={tool} onClick={() => onSelectTool(tool)} title={label} className={toolBtn(activeTool === tool)}>
          <Icon className="w-3.5 h-3.5" />
        </button>
      ))}

      <div className={inline ? 'w-[1px] h-5 bg-slate-800 mx-1' : 'h-[1px] bg-slate-700/70 my-0.5'} />

      {/* Seletor de cor: neutra + cores de sinal */}
      {COLOR_ITEMS.map(({ color, dot, label }) => (
        <button
          key={color}
          onClick={() => onSelectColor(color)}
          title={label}
          className={`w-7 h-5 flex items-center justify-center rounded-md transition-colors cursor-pointer ${
            activeColor === color ? 'bg-slate-700 ring-1 ring-slate-500' : 'hover:bg-slate-800'
          }`}
        >
          <span className="w-2.5 h-2.5 rounded-full border border-black/40" style={{ backgroundColor: dot }} />
        </button>
      ))}

      <div className={inline ? 'w-[1px] h-5 bg-slate-800 mx-1' : 'h-[1px] bg-slate-700/70 my-0.5'} />

      <button
        onClick={onUndo}
        disabled={!hasDrawings}
        title="Desfazer último desenho (Ctrl+Z)"
        className={`w-7 h-7 flex items-center justify-center rounded-md transition-colors ${
          hasDrawings
            ? 'text-slate-300 hover:text-slate-50 hover:bg-slate-800 cursor-pointer'
            : 'text-slate-600 cursor-not-allowed'
        }`}
      >
        <Undo2 className="w-3.5 h-3.5" />
      </button>
      <button
        onClick={onClearAll}
        disabled={!hasDrawings}
        title="Limpar todos os desenhos"
        className={`w-7 h-7 flex items-center justify-center rounded-md transition-colors ${
          hasDrawings
            ? 'text-slate-300 hover:text-rose-300 hover:bg-slate-800 cursor-pointer'
            : 'text-slate-600 cursor-not-allowed'
        }`}
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  );
};
