import React, { useRef, useState } from 'react';
import { Drawing, DrawingColor, DrawingTool, DRAWING_COLOR_HEX } from '../types/drawing';

// =========================================================================
// LAYOUT DO PAINEL DE PREÇO: publicado pelo canvas do RenkoFlowChart a cada
// renderização, permitindo converter (índice do tijolo, preço) <-> (x, y px).
// =========================================================================
export interface ChartLayout {
  /** Altura total do canvas em CSS pixels */
  height: number;
  /** Altura do painel de preço (topo) em CSS pixels */
  pricePaneHeight: number;
  /** Conversão preço -> Y no painel de preço */
  priceToY: (price: number) => number;
  /** Conversão Y -> preço no painel de preço */
  yToPrice: (y: number) => number;
  /** X do centro do tijolo de índice absoluto k (companheiro do eixo do canvas) */
  indexToX: (k: number) => number;
  /** Índice do tijolo (fracionário) correspondente ao X informado */
  xToIndex: (x: number) => number;
}

interface DrawingOverlayProps {
  width: number;
  layout: ChartLayout | null;
  drawings: Drawing[];
  activeTool: DrawingTool;
  activeColor: DrawingColor;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onCreate: (drawing: Drawing) => void;
  onUpdate: (id: string, patch: Partial<Drawing>) => void;
  onDelete: (id: string) => void;
}

interface DragState {
  mode: 'create' | 'move';
  tool?: DrawingTool;
  drawingId?: string;
  start: { bar: number; price: number };
  last: { bar: number; price: number };
  moved: boolean;
  grabOffset?: { dBar: number; dPrice: number };
}

const newDrawingId = () => `drw_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

const dist = (x1: number, y1: number, x2: number, y2: number) => Math.hypot(x2 - x1, y2 - y1);

// Distância do ponto (px,py) até o segmento (x1,y1)-(x2,y2)
const pointSegDist = (px: number, py: number, x1: number, y1: number, x2: number, y2: number) => {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return dist(px, py, x1, y1);
  let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return dist(px, py, x1 + t * dx, y1 + t * dy);
};

// Camada SVG sobre o canvas. Só captura o mouse quando uma ferramenta
// de desenho está ativa; no modo "selecionar" deixa passar pan/zoom do gráfico.
export const DrawingOverlay: React.FC<DrawingOverlayProps> = ({
  width,
  layout,
  drawings,
  activeTool,
  activeColor,
  selectedId,
  onSelect,
  onCreate,
  onUpdate,
  onDelete,
}) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [preview, setPreview] = useState<{ a: { x: number; y: number }; b: { x: number; y: number } } | null>(null);
  const [editing, setEditing] = useState<{ id: string; value: string; x: number; y: number } | null>(null);

  const capture = activeTool !== 'select';

  const toChartPoint = (e: React.MouseEvent) => {
    if (!layout || !svgRef.current) return null;
    const rect = svgRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    return {
      bar: Math.round(layout.xToIndex(x)),
      price: Math.round(layout.yToPrice(y) * 10) / 10,
      px: { x, y },
    };
  };

  const drawingToPoints = (d: Drawing) => {
    if (!layout) return null;
    const ax = layout.indexToX(d.barA);
    const ay = layout.priceToY(d.priceA);
    const bx = layout.indexToX(d.barB);
    const by = layout.priceToY(d.priceB);
    return { ax, ay, bx, by };
  };

  // ------------------------------------------------------------------
  // HIT-TESTING (modo seleção): qual desenho está sob o cursor
  // ------------------------------------------------------------------
  const hitTest = (x: number, y: number): Drawing | null => {
    if (!layout) return null;
    let best: Drawing | null = null;
    let bestDist = 8;
    for (const d of drawings) {
      const p = drawingToPoints(d);
      if (!p) continue;
      let dd = Infinity;
      if (d.kind === 'text') {
        const w = Math.max(40, (d.text || 'Texto').length * 7.5 + 16);
        dd = x >= p.ax - w / 2 && x <= p.ax + w / 2 && y >= p.ay - 12 && y <= p.ay + 12 ? 0 : dist(x, y, p.ax, p.ay);
      } else if (d.kind === 'hline') {
        dd = dist(x, y, p.ax, p.ay);
      } else if (d.kind === 'rect') {
        const edges = [
          [p.ax, p.ay, p.bx, p.ay],
          [p.bx, p.ay, p.bx, p.by],
          [p.bx, p.by, p.ax, p.by],
          [p.ax, p.by, p.ax, p.ay],
        ];
        dd = Math.min(...edges.map(([x1, y1, x2, y2]) => pointSegDist(x, y, x1, y1, x2, y2)));
        const inside = x >= Math.min(p.ax, p.bx) - 3 && x <= Math.max(p.ax, p.bx) + 3 && y >= Math.min(p.ay, p.by) - 3 && y <= Math.max(p.ay, p.by) + 3;
        if (inside) dd = 0;
      } else {
        dd = pointSegDist(x, y, p.ax, p.ay, p.bx, p.by);
      }
      if (dd < bestDist) {
        bestDist = dd;
        best = d;
      }
    }
    return best;
  };

  // ------------------------------------------------------------------
  // INTERAÇÃO COM O MOUSE
  // ------------------------------------------------------------------
  const handleMouseDown = (e: React.MouseEvent) => {
    if (!layout || editing) return;
    const pt = toChartPoint(e);
    if (!pt) return;

    if (capture) {
      if (activeTool === 'text') {
        const d: Drawing = {
          id: newDrawingId(),
          kind: 'text',
          barA: pt.bar,
          priceA: pt.price,
          barB: pt.bar,
          priceB: pt.price,
          text: '',
          color: activeColor,
        };
        onCreate(d);
        setEditing({ id: d.id, value: '', x: pt.px.x, y: pt.px.y });
        return;
      }
      setDrag({ mode: 'create', tool: activeTool, start: { bar: pt.bar, price: pt.price }, last: { bar: pt.bar, price: pt.price }, moved: false });
      setPreview({ a: pt.px, b: pt.px });
      return;
    }

    // Modo seleção: captura desenhos para mover (pointer-events none no SVG
    // deixa o pan do gráfico acontecer normalmente nos espaços vazios)
    const hit = hitTest(pt.px.x, pt.px.y);
    if (hit) {
      onSelect(hit.id);
      if (hit.kind === 'text') {
        const p = drawingToPoints(hit)!;
        setEditing({ id: hit.id, value: hit.text || '', x: p.ax, y: p.ay });
        return;
      }
      setDrag({
        mode: 'move',
        drawingId: hit.id,
        start: { bar: pt.bar, price: pt.price },
        last: { bar: pt.bar, price: pt.price },
        moved: false,
        grabOffset: { dBar: hit.barA - pt.bar, dPrice: hit.priceA - pt.price },
      });
    } else {
      onSelect(null);
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!drag || !layout) return;
    const pt = toChartPoint(e);
    if (!pt) return;
    const startPx = layout ? { x: layout.indexToX(drag.start.bar), y: layout.priceToY(drag.start.price) } : pt.px;
    const moved = drag.moved || dist(pt.px.x, pt.px.y, startPx.x, startPx.y) > 3;

    if (drag.mode === 'create') {
      setPreview({ a: startPx, b: pt.px });
      setDrag({ ...drag, last: { bar: pt.bar, price: pt.price }, moved });
    } else if (drag.drawingId) {
      const off = drag.grabOffset!;
      onUpdate(drag.drawingId, { barA: pt.bar + off.dBar, priceA: pt.price + off.dPrice });
      setDrag({ ...drag, last: { bar: pt.bar, price: pt.price }, moved });
    }
  };

  const handleMouseUp = () => {
    if (!drag || !layout) return;
    if (drag.mode === 'create' && drag.tool && drag.moved) {
      const kind = drag.tool as Exclude<DrawingTool, 'select'>;
      const d: Drawing = {
        id: newDrawingId(),
        kind,
        barA: drag.start.bar,
        priceA: drag.start.price,
        barB: kind === 'hline' ? drag.start.bar : drag.last.bar,
        priceB: kind === 'hline' ? drag.start.price : drag.last.price,
        color: activeColor,
      };
      onCreate(d);
    }
    setDrag(null);
    setPreview(null);
  };

  // ------------------------------------------------------------------
  // EDIÇÃO DE TEXTO
  // ------------------------------------------------------------------
  const commitTextEdit = () => {
    if (!editing) return;
    const value = editing.value.trim();
    if (value) {
      onUpdate(editing.id, { text: value });
    } else {
      onDelete(editing.id);
    }
    setEditing(null);
  };

  const startEdit = (d: Drawing) => {
    if (!layout) return;
    setEditing({ id: d.id, value: d.text || '', x: layout.indexToX(d.barA), y: layout.priceToY(d.priceA) });
  };

  const renderDrawing = (d: Drawing) => {
    const p = drawingToPoints(d);
    if (!p) return null;
    const hex = DRAWING_COLOR_HEX[d.color];
    const selected = d.id === selectedId;
    const selAttr = selected ? { strokeDasharray: '5 3', strokeWidth: 2.5 } : { strokeWidth: 1.8 };

    switch (d.kind) {
      case 'trendline':
        return (
          <g key={d.id} data-drawing-id={d.id}>
            <line x1={p.ax} y1={p.ay} x2={p.bx} y2={p.by} stroke={hex} strokeLinecap="round" {...selAttr} />
          </g>
        );
      case 'hline': {
        const endX = Math.max(0, width - 80);
        return (
          <g key={d.id} data-drawing-id={d.id}>
            <line x1={0} y1={p.ay} x2={endX} y2={p.ay} stroke={hex} strokeDasharray={selected ? '5 3' : '2 4'} strokeWidth={selected ? 2.5 : 1.4} />
            <rect x={4} y={p.ay - 8} width={62} height={15} rx={3} fill="#171717" stroke="#404040" strokeWidth={0.8} />
            <text x={35} y={p.ay + 3} textAnchor="middle" fontSize={9.5} fontFamily="'JetBrains Mono', monospace" fill={hex}>
              {d.priceA.toLocaleString('pt-BR')}
            </text>
          </g>
        );
      }
      case 'rect':
        return (
          <g key={d.id} data-drawing-id={d.id}>
            <rect
              x={Math.min(p.ax, p.bx)}
              y={Math.min(p.ay, p.by)}
              width={Math.abs(p.bx - p.ax)}
              height={Math.abs(p.by - p.ay)}
              fill={hex}
              fillOpacity={0.08}
              stroke={hex}
              strokeOpacity={0.8}
              {...selAttr}
            />
          </g>
        );
      case 'arrow': {
        const angle = Math.atan2(p.by - p.ay, p.bx - p.ax);
        const headLen = 9;
        const x2 = p.bx - Math.cos(angle) * headLen * 0.6;
        const y2 = p.by - Math.sin(angle) * headLen * 0.6;
        const pts = [
          `${p.bx},${p.by}`,
          `${p.bx - headLen * Math.cos(angle - Math.PI / 7)},${p.by - headLen * Math.sin(angle - Math.PI / 7)}`,
          `${p.bx - headLen * Math.cos(angle + Math.PI / 7)},${p.by - headLen * Math.sin(angle + Math.PI / 7)}`,
        ].join(' ');
        return (
          <g key={d.id} data-drawing-id={d.id}>
            <line x1={p.ax} y1={p.ay} x2={x2} y2={y2} stroke={hex} strokeLinecap="round" {...selAttr} />
            <polygon points={pts} fill={hex} stroke="none" />
          </g>
        );
      }
      case 'text':
        return (
          <g key={d.id} data-drawing-id={d.id}>
            <rect
              x={p.ax - Math.max(24, (d.text || '').length * 3.9 + 8)}
              y={p.ay - 11}
              width={Math.max(48, (d.text || '').length * 7.8 + 16)}
              height={22}
              rx={4}
              fill="#171717"
              fillOpacity={0.85}
              stroke={selected ? hex : '#404040'}
              strokeWidth={selected ? 1.6 : 0.8}
            />
            <text
              x={p.ax}
              y={p.ay + 4}
              textAnchor="middle"
              fontSize={11.5}
              fontWeight={600}
              fontFamily="'Plus Jakarta Sans', sans-serif"
              fill={hex}
              onDoubleClick={(e) => {
                e.stopPropagation();
                startEdit(d);
              }}
            >
              {d.text || '…'}
            </text>
          </g>
        );
      default:
        return null;
    }
  };

  const previewEl = (() => {
    if (!drag || drag.mode !== 'create' || !preview) return null;
    const hex = DRAWING_COLOR_HEX[activeColor];
    const op = { strokeOpacity: 0.65, fillOpacity: 0.06, strokeWidth: 1.5 };
    switch (drag.tool) {
      case 'trendline':
      case 'arrow':
        return <line x1={preview.a.x} y1={preview.a.y} x2={preview.b.x} y2={preview.b.y} stroke={hex} {...op} />;
      case 'hline':
        return <line x1={0} y1={preview.a.y} x2={preview.b.x} y2={preview.a.y} stroke={hex} strokeDasharray="2 4" {...op} />;
      case 'rect':
        return (
          <rect
            x={Math.min(preview.a.x, preview.b.x)}
            y={Math.min(preview.a.y, preview.b.y)}
            width={Math.abs(preview.b.x - preview.a.x)}
            height={Math.abs(preview.b.y - preview.a.y)}
            stroke={hex}
            fill={hex}
            {...op}
          />
        );
      default:
        return null;
    }
  })();

  return (
    <svg
      ref={svgRef}
      width={width}
      height={layout ? layout.height : '100%'}
      className="absolute top-0 left-0 z-20"
      style={{
        pointerEvents: capture ? 'all' : 'none',
        cursor: capture ? 'crosshair' : 'default',
      }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      {drawings.map(renderDrawing)}
      {previewEl}

      {editing && (
        <foreignObject x={Math.max(4, editing.x - 90)} y={editing.y - 14} width={180} height={28}>
          <input
            autoFocus
            value={editing.value}
            onChange={(e) => setEditing({ ...editing, value: e.target.value })}
            onBlur={commitTextEdit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitTextEdit();
              if (e.key === 'Escape') setEditing(null);
              e.stopPropagation();
            }}
            placeholder="Digite a anotação..."
            className="w-full h-full px-2 text-[11px] font-semibold rounded border border-slate-600 bg-slate-900 text-slate-100 outline-none placeholder:text-slate-500"
          />
        </foreignObject>
      )}
    </svg>
  );
};
