import React, { useState, useEffect } from 'react';
import {
  MousePointer2,
  TrendingUp,
  Minus,
  Square,
  MoveUpRight,
  Type,
  Eraser,
  Layers,
  Undo2,
  Trash2,
  Palette,
  ChevronLeft,
  Pencil,
  X,
} from 'lucide-react';
import { Drawing, DrawingColor, DrawingTool, DRAWING_COLOR_HEX } from '../types/drawing';

interface DrawingToolbarProps {
  activeTool: DrawingTool;
  onSelectTool: (tool: DrawingTool) => void;
  activeColor: DrawingColor;
  onSelectColor: (color: DrawingColor) => void;
  onUndo: () => void;
  onClearAll: () => void;
  hasDrawings: boolean;
  drawings?: Drawing[];
  selectedId?: string | null;
  onSelectDrawing?: (id: string | null) => void;
  onDeleteDrawing?: (id: string) => void;
  /** 'vertical' = barra flutuante sobre o canvas | 'inline' = embutida na barra lateral */
  layout?: 'vertical' | 'inline';
}

const TOOL_ITEMS: { tool: DrawingTool; icon: React.ElementType; label: string; shortcut: string }[] = [
  { tool: 'select', icon: MousePointer2, label: 'Cursor / Selecionar', shortcut: 'V' },
  { tool: 'eraser', icon: Eraser, label: 'Borracha (apagar estudo)', shortcut: 'E' },
  { tool: 'trendline', icon: TrendingUp, label: 'Linha de Tendência', shortcut: 'L' },
  { tool: 'hline', icon: Minus, label: 'Linha Horizontal (Suporte/Resistência)', shortcut: 'H' },
  { tool: 'rect', icon: Square, label: 'Retângulo / Região de Liquidez', shortcut: 'R' },
  { tool: 'arrow', icon: MoveUpRight, label: 'Seta de Direção de Fluxo', shortcut: 'A' },
  { tool: 'text', icon: Type, label: 'Texto / Anotação', shortcut: 'T' },
];

const COLOR_OPTIONS: { color: DrawingColor; dot: string; label: string }[] = [
  { color: 'white', dot: DRAWING_COLOR_HEX.white, label: 'Branco (neutro)' },
  { color: 'green', dot: DRAWING_COLOR_HEX.green, label: 'Verde (compra)' },
  { color: 'red', dot: DRAWING_COLOR_HEX.red, label: 'Vermelho (venda)' },
  { color: 'yellow', dot: DRAWING_COLOR_HEX.yellow, label: 'Amarelo (alerta)' },
  { color: 'blue', dot: DRAWING_COLOR_HEX.blue, label: 'Azul (institucional)' },
];

const STORAGE_KEY_DRAWING_BAR_COLLAPSED = 'fluxo_drawing_bar_collapsed_v1';

// Barra de ferramentas de desenho vertical limpa (estilo TradingView / Photoshop)
export const DrawingToolbar: React.FC<DrawingToolbarProps> = ({
  activeTool,
  onSelectTool,
  activeColor,
  onSelectColor,
  onUndo,
  onClearAll,
  hasDrawings,
  drawings = [],
  selectedId = null,
  onSelectDrawing,
  onDeleteDrawing,
  layout = 'vertical',
}) => {
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY_DRAWING_BAR_COLLAPSED) === '1';
    } catch {
      return false;
    }
  });

  const [colorMenuOpen, setColorMenuOpen] = useState(false);
  const [objectsPanelOpen, setObjectsPanelOpen] = useState(false);

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_KEY_DRAWING_BAR_COLLAPSED, next ? '1' : '0');
      } catch {}
      return next;
    });
  };

  const inline = layout === 'inline';

  // Se inline (dentro do painel lateral de controles)
  if (inline) {
    return (
      <div className="flex flex-wrap items-center gap-1">
        {TOOL_ITEMS.map(({ tool, icon: Icon, label, shortcut }) => (
          <button
            key={tool}
            onClick={() => onSelectTool(tool)}
            title={`${label} (tecla ${shortcut})`}
            className={`w-7 h-7 flex items-center justify-center rounded-md transition-colors cursor-pointer ${
              activeTool === tool
                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800'
            }`}
          >
            <Icon className="w-3.5 h-3.5" />
          </button>
        ))}
        <div className="w-[1px] h-5 bg-zinc-800 mx-1" />
        {COLOR_OPTIONS.map(({ color, dot, label }) => (
          <button
            key={color}
            onClick={() => onSelectColor(color)}
            title={label}
            className={`w-6 h-6 flex items-center justify-center rounded-md transition-colors cursor-pointer ${
              activeColor === color ? 'bg-zinc-800 ring-1 ring-zinc-500' : 'hover:bg-zinc-800/60'
            }`}
          >
            <span className="w-2.5 h-2.5 rounded-full border border-black/40" style={{ backgroundColor: dot }} />
          </button>
        ))}
        <div className="w-[1px] h-5 bg-zinc-800 mx-1" />
        <button
          onClick={onUndo}
          disabled={!hasDrawings}
          title="Desfazer (Ctrl+Z)"
          className={`w-7 h-7 flex items-center justify-center rounded-md transition-colors ${
            hasDrawings
              ? 'text-zinc-300 hover:text-white hover:bg-zinc-800 cursor-pointer'
              : 'text-zinc-600 cursor-not-allowed'
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
              ? 'text-zinc-300 hover:text-rose-300 hover:bg-zinc-800 cursor-pointer'
              : 'text-zinc-600 cursor-not-allowed'
          }`}
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    );
  }

  // Se vertical flutuante (encostada na lateral esquerda do painel, logo abaixo da caixa Controles)
  if (collapsed) {
    return (
      <div className="absolute top-1 left-0 z-30 select-none pointer-events-auto">
        <button
          onClick={toggleCollapsed}
          title="Abrir barra de desenho"
          className="w-7 h-7 flex items-center justify-center rounded-r-lg bg-zinc-950/90 backdrop-blur-md border border-l-0 border-zinc-800/90 text-zinc-400 hover:text-amber-300 hover:border-zinc-700 shadow-xl transition-all cursor-pointer group"
        >
          <Pencil className="w-3.5 h-3.5 group-hover:scale-110 transition-transform" />
        </button>
      </div>
    );
  }

  return (
    <div className="absolute top-1 left-0 z-30 select-none pointer-events-auto flex flex-col items-center gap-1 p-1 rounded-r-xl bg-zinc-950/92 backdrop-blur-md border border-l-0 border-zinc-800/90 shadow-2xl transition-all">
      {/* Botão de minimizar/recolher */}
      <button
        onClick={toggleCollapsed}
        title="Recolher barra de desenho"
        className="w-7 h-5 flex items-center justify-center rounded text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900 transition-colors cursor-pointer"
      >
        <ChevronLeft className="w-3 h-3" />
      </button>

      <div className="w-5 h-[1px] bg-zinc-800/80 my-0.5" />

      {/* Ferramentas de Desenho */}
      {TOOL_ITEMS.map(({ tool, icon: Icon, label, shortcut }) => {
        const isActive = activeTool === tool;
        return (
          <button
            key={tool}
            onClick={() => onSelectTool(tool)}
            title={`${label} (${shortcut})`}
            className={`w-7 h-7 flex items-center justify-center rounded-lg transition-all cursor-pointer relative group ${
              isActive
                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-sm'
                : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/80'
            }`}
          >
            <Icon className="w-3.5 h-3.5 transition-transform group-hover:scale-110" />
            {/* Tooltip flutuante lateral à direita */}
            <span className="pointer-events-none absolute left-full ml-2 px-2 py-0.5 rounded bg-zinc-900 border border-zinc-700 text-[10px] font-sans text-zinc-200 whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity z-50 shadow-lg">
              {label} <span className="text-amber-400 font-mono font-bold ml-1">{shortcut}</span>
            </span>
          </button>
        );
      })}

      <div className="w-5 h-[1px] bg-zinc-800/80 my-0.5" />

      {/* Seletor de Cores com Popover / Flyout lateral */}
      <div className="relative">
        <button
          onClick={() => setColorMenuOpen((v) => !v)}
          title="Selecionar cor do desenho"
          className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-zinc-800/80 transition-colors cursor-pointer relative group"
        >
          <span
            className="w-3 h-3 rounded-full border border-black/50 shadow-sm transition-transform group-hover:scale-110"
            style={{ backgroundColor: DRAWING_COLOR_HEX[activeColor] }}
          />
        </button>

        {/* Menu suspenso de cores para a direita */}
        {colorMenuOpen && (
          <div
            className="absolute left-full top-0 ml-2 p-1.5 rounded-lg bg-zinc-900/95 border border-zinc-700 shadow-2xl flex flex-col gap-1.5 z-50 backdrop-blur-md"
            onMouseLeave={() => setColorMenuOpen(false)}
          >
            {COLOR_OPTIONS.map(({ color, dot, label }) => (
              <button
                key={color}
                onClick={() => {
                  onSelectColor(color);
                  setColorMenuOpen(false);
                }}
                title={label}
                className={`w-6 h-6 flex items-center justify-center rounded-md transition-all cursor-pointer ${
                  activeColor === color ? 'bg-zinc-800 ring-1 ring-amber-400' : 'hover:bg-zinc-800/60'
                }`}
              >
                <span className="w-3 h-3 rounded-full border border-black/40" style={{ backgroundColor: dot }} />
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="w-5 h-[1px] bg-zinc-800/80 my-0.5" />

      {/* Ações: Desfazer */}
      <button
        onClick={onUndo}
        disabled={!hasDrawings}
        title="Desfazer último traço (Ctrl+Z)"
        className={`w-7 h-7 flex items-center justify-center rounded-lg transition-colors relative group ${
          hasDrawings
            ? 'text-zinc-400 hover:text-white hover:bg-zinc-800/80 cursor-pointer'
            : 'text-zinc-600 cursor-not-allowed opacity-50'
        }`}
      >
        <Undo2 className="w-3.5 h-3.5" />
        <span className="pointer-events-none absolute left-full ml-2 px-2 py-0.5 rounded bg-zinc-900 border border-zinc-700 text-[10px] font-sans text-zinc-200 whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity z-50 shadow-lg">
          Desfazer <span className="text-zinc-400 font-mono ml-1">Ctrl+Z</span>
        </span>
      </button>

      {/* Ações: Limpar Tudo */}
      <button
        onClick={onClearAll}
        disabled={!hasDrawings}
        title="Limpar todos os desenhos"
        className={`w-7 h-7 flex items-center justify-center rounded-lg transition-colors relative group ${
          hasDrawings
            ? 'text-zinc-400 hover:text-rose-400 hover:bg-zinc-800/80 cursor-pointer'
            : 'text-zinc-600 cursor-not-allowed opacity-50'
        }`}
      >
        <Trash2 className="w-3.5 h-3.5" />
        <span className="pointer-events-none absolute left-full ml-2 px-2 py-0.5 rounded bg-zinc-900 border border-zinc-700 text-[10px] font-sans text-rose-300 whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity z-50 shadow-lg">
          Limpar desenhos
        </span>
      </button>

      <div className="w-5 h-[1px] bg-zinc-800/80 my-0.5" />

      {/* Botão de Estudos Criados (Camadas / Seleção) */}
      <div className="relative">
        <button
          onClick={() => setObjectsPanelOpen((v) => !v)}
          title={`Estudos no gráfico (${drawings.length} criados) — clique para gerenciar o que deixar`}
          className={`w-7 h-7 flex items-center justify-center rounded-lg transition-colors relative cursor-pointer ${
            objectsPanelOpen
              ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
              : 'text-zinc-400 hover:text-white hover:bg-zinc-800/80'
          }`}
        >
          <Layers className="w-3.5 h-3.5" />
          {drawings.length > 0 && (
            <span className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-amber-500 text-[8.5px] font-bold text-zinc-950 flex items-center justify-center font-mono">
              {drawings.length}
            </span>
          )}
        </button>

        {/* Painel Flyout de Objetos Criados */}
        {objectsPanelOpen && (
          <div
            className="absolute left-full bottom-0 ml-2 w-64 max-h-72 overflow-y-auto rounded-xl bg-zinc-950/95 border border-zinc-700/80 p-2.5 shadow-2xl backdrop-blur-md flex flex-col gap-2 z-50 select-none font-mono"
            onMouseLeave={() => setObjectsPanelOpen(false)}
          >
            <div className="flex items-center justify-between pb-1.5 border-b border-zinc-800">
              <span className="text-xs font-bold text-slate-100 flex items-center gap-1.5 font-sans">
                <Layers className="w-3.5 h-3.5 text-amber-400" />
                Estudos Criados ({drawings.length})
              </span>
              <button
                onClick={() => setObjectsPanelOpen(false)}
                className="p-1 rounded text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 cursor-pointer"
              >
                <X className="w-3 h-3" />
              </button>
            </div>

            {drawings.length === 0 ? (
              <p className="text-[11px] text-zinc-500 italic py-2 text-center font-sans">
                Nenhum estudo traçado no gráfico ainda.
              </p>
            ) : (
              <div className="space-y-1 overflow-y-auto max-h-48 pr-1 no-scrollbar">
                {drawings.map((d) => {
                  const isSelected = d.id === selectedId;
                  const label =
                    d.kind === 'trendline'
                      ? 'Linha de Tendência'
                      : d.kind === 'hline'
                      ? `Suporte/Resistência ${d.priceA.toLocaleString('pt-BR')}`
                      : d.kind === 'rect'
                      ? 'Região de Liquidez'
                      : d.kind === 'arrow'
                      ? 'Seta de Fluxo'
                      : d.text
                      ? `Texto: "${d.text}"`
                      : 'Nota de Texto';

                  return (
                    <div
                      key={d.id}
                      onClick={() => onSelectDrawing && onSelectDrawing(d.id)}
                      className={`flex items-center justify-between p-1.5 rounded-lg border text-xs transition-colors cursor-pointer ${
                        isSelected
                          ? 'bg-amber-500/15 border-amber-500/50 text-amber-200'
                          : 'bg-zinc-900/60 border-zinc-800/80 text-zinc-300 hover:bg-zinc-800/60'
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <span
                          className="w-2.5 h-2.5 rounded-full shrink-0 border border-black/40"
                          style={{ backgroundColor: DRAWING_COLOR_HEX[d.color] }}
                        />
                        <span className="truncate text-[11px] font-sans">
                          {label}
                        </span>
                      </div>
                      {onDeleteDrawing && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onDeleteDrawing(d.id);
                          }}
                          className="p-1 rounded text-zinc-500 hover:text-rose-400 hover:bg-zinc-800 transition-colors ml-1 cursor-pointer shrink-0"
                          title="Excluir este estudo"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {drawings.length > 0 && (
              <div className="pt-1.5 border-t border-zinc-800 flex justify-end">
                <button
                  onClick={() => {
                    onClearAll();
                    setObjectsPanelOpen(false);
                  }}
                  className="px-2 py-0.5 rounded text-[10px] font-bold text-rose-400 hover:bg-rose-500/10 transition-colors cursor-pointer"
                >
                  Limpar todos
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
