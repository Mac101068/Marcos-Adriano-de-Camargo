import React, { useRef, useState } from 'react';
import { Drawing, DrawingColor, DrawingTool, DRAWING_COLOR_HEX } from '../types/drawing';
import { Trash2, X } from 'lucide-react';

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

type HandleType = 'point_a' | 'point_b' | 'corner_a' | 'corner_b' | 'corner_c' | 'corner_d' | 'body';

interface DragState {
  mode: 'create' | 'move' | 'resize' | 'erase';
  tool?: DrawingTool;
  drawingId?: string;
  handle?: HandleType;
  start: { bar: number; price: number };
  last: { bar: number; price: number };
  moved: boolean;
  initialDrawing?: {
    barA: number;
    priceA: number;
    barB: number;
    priceB: number;
  };
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

  /** Detecta se o clique foi em alguma alça/canto de um objeto selecionado */
  const hitTestHandle = (x: number, y: number, d: Drawing): HandleType | null => {
    const p = drawingToPoints(d);
    if (!p) return null;
    const R = 10; // Raio de captura da alça em pixels
    if (d.kind === 'rect') {
      if (dist(x, y, p.ax, p.ay) <= R) return 'corner_a';
      if (dist(x, y, p.bx, p.by) <= R) return 'corner_b';
      if (dist(x, y, p.ax, p.by) <= R) return 'corner_c';
      if (dist(x, y, p.bx, p.ay) <= R) return 'corner_d';
    } else if (d.kind === 'trendline' || d.kind === 'arrow') {
      if (dist(x, y, p.ax, p.ay) <= R) return 'point_a';
      if (dist(x, y, p.bx, p.by) <= R) return 'point_b';
    } else if (d.kind === 'hline') {
      if (Math.abs(y - p.ay) <= R) return 'point_a';
    } else if (d.kind === 'vline') {
      if (Math.abs(x - p.ax) <= R) return 'point_a';
    }
    return null;
  };

  // ------------------------------------------------------------------
  // HIT-TESTING (modo seleção ou borracha): qual desenho está sob o cursor
  // ------------------------------------------------------------------
  const hitTest = (x: number, y: number): Drawing | null => {
    if (!layout) return null;
    let best: Drawing | null = null;
    let bestDist = 14;
    for (const d of drawings) {
      const p = drawingToPoints(d);
      if (!p) continue;
      let dd = Infinity;
      if (d.kind === 'text') {
        const w = Math.max(48, (d.text || 'Texto').length * 8 + 20);
        dd = x >= p.ax - w / 2 && x <= p.ax + w / 2 && y >= p.ay - 14 && y <= p.ay + 14 ? 0 : dist(x, y, p.ax, p.ay);
      } else if (d.kind === 'hline') {
        const endX = Math.max(0, width - 80);
        if (x >= 0 && x <= endX) {
          dd = Math.abs(y - p.ay);
        } else {
          dd = dist(x, y, 0, p.ay);
        }
      } else if (d.kind === 'vline') {
        const paneH = layout.pricePaneHeight;
        if (y >= 0 && y <= paneH) {
          dd = Math.abs(x - p.ax);
        } else {
          dd = dist(x, y, p.ax, 0);
        }
      } else if (d.kind === 'rect') {
        const edges = [
          [p.ax, p.ay, p.bx, p.ay],
          [p.bx, p.ay, p.bx, p.by],
          [p.bx, p.by, p.ax, p.by],
          [p.ax, p.by, p.ax, p.ay],
        ];
        dd = Math.min(...edges.map(([x1, y1, x2, y2]) => pointSegDist(x, y, x1, y1, x2, y2)));
        const inside = x >= Math.min(p.ax, p.bx) - 4 && x <= Math.max(p.ax, p.bx) + 4 && y >= Math.min(p.ay, p.by) - 4 && y <= Math.max(p.ay, p.by) + 4;
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

    // Ferramenta Borracha: apaga qualquer desenho clicado
    if (activeTool === 'eraser') {
      const hit = hitTest(pt.px.x, pt.px.y);
      if (hit) {
        onDelete(hit.id);
        if (selectedId === hit.id) onSelect(null);
      }
      setDrag({ mode: 'erase', tool: 'eraser', start: { bar: pt.bar, price: pt.price }, last: { bar: pt.bar, price: pt.price }, moved: false });
      return;
    }

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
      if (activeTool === 'vline') {
        const d: Drawing = {
          id: newDrawingId(),
          kind: 'vline',
          barA: pt.bar,
          priceA: pt.price,
          barB: pt.bar,
          priceB: pt.price,
          color: activeColor,
        };
        onCreate(d);
        onSelect(d.id);
        return;
      }
      setDrag({ mode: 'create', tool: activeTool, start: { bar: pt.bar, price: pt.price }, last: { bar: pt.bar, price: pt.price }, moved: false });
      setPreview({ a: pt.px, b: pt.px });
      return;
    }

    // Modo seleção: verifica primeiro se clicou em uma alça do objeto atualmente selecionado
    if (selectedId) {
      const selDrawing = drawings.find((d) => d.id === selectedId);
      if (selDrawing) {
        const handle = hitTestHandle(pt.px.x, pt.px.y, selDrawing);
        if (handle) {
          setDrag({
            mode: 'resize',
            drawingId: selDrawing.id,
            handle,
            start: { bar: pt.bar, price: pt.price },
            last: { bar: pt.bar, price: pt.price },
            moved: false,
            initialDrawing: {
              barA: selDrawing.barA,
              priceA: selDrawing.priceA,
              barB: selDrawing.barB,
              priceB: selDrawing.priceB,
            },
          });
          return;
        }
      }
    }

    // Se não clicou em uma alça, verifica se clicou no corpo de algum desenho
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
        handle: 'body',
        start: { bar: pt.bar, price: pt.price },
        last: { bar: pt.bar, price: pt.price },
        moved: false,
        initialDrawing: {
          barA: hit.barA,
          priceA: hit.priceA,
          barB: hit.barB,
          priceB: hit.priceB,
        },
      });
    } else {
      onSelect(null);
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!drag || !layout) return;
    const pt = toChartPoint(e);
    if (!pt) return;

    // Borracha arrastada sobre desenhos
    if (drag.mode === 'erase') {
      const hit = hitTest(pt.px.x, pt.px.y);
      if (hit) {
        onDelete(hit.id);
        if (selectedId === hit.id) onSelect(null);
      }
      return;
    }

    const startPx = layout ? { x: layout.indexToX(drag.start.bar), y: layout.priceToY(drag.start.price) } : pt.px;
    const moved = drag.moved || dist(pt.px.x, pt.px.y, startPx.x, startPx.y) > 3;

    if (drag.mode === 'create') {
      setPreview({ a: startPx, b: pt.px });
      setDrag({ ...drag, last: { bar: pt.bar, price: pt.price }, moved });
    } else if (drag.mode === 'move' && drag.drawingId && drag.initialDrawing) {
      // Movimentação do objeto inteiro (translação suave e sem distorção)
      const init = drag.initialDrawing;
      const dBar = pt.bar - drag.start.bar;
      const dPrice = pt.price - drag.start.price;
      const target = drawings.find((d) => d.id === drag.drawingId);
      if (target) {
        if (target.kind === 'hline') {
          onUpdate(drag.drawingId, { priceA: init.priceA + dPrice, priceB: init.priceA + dPrice });
        } else if (target.kind === 'vline') {
          onUpdate(drag.drawingId, { barA: init.barA + dBar, barB: init.barA + dBar });
        } else {
          onUpdate(drag.drawingId, {
            barA: init.barA + dBar,
            priceA: init.priceA + dPrice,
            barB: init.barB + dBar,
            priceB: init.priceB + dPrice,
          });
        }
      }
      setDrag({ ...drag, last: { bar: pt.bar, price: pt.price }, moved });
    } else if (drag.mode === 'resize' && drag.drawingId && drag.initialDrawing && drag.handle) {
      // Redimensionamento interativo pelos cantos ou pontas das linhas
      const init = drag.initialDrawing;
      const dBar = pt.bar - drag.start.bar;
      const dPrice = pt.price - drag.start.price;

      if (drag.handle === 'point_a') {
        onUpdate(drag.drawingId, { barA: init.barA + dBar, priceA: init.priceA + dPrice });
      } else if (drag.handle === 'point_b') {
        onUpdate(drag.drawingId, { barB: init.barB + dBar, priceB: init.priceB + dPrice });
      } else if (drag.handle === 'corner_a') {
        onUpdate(drag.drawingId, { barA: init.barA + dBar, priceA: init.priceA + dPrice });
      } else if (drag.handle === 'corner_b') {
        onUpdate(drag.drawingId, { barB: init.barB + dBar, priceB: init.priceB + dPrice });
      } else if (drag.handle === 'corner_c') {
        onUpdate(drag.drawingId, { barA: init.barA + dBar, priceB: init.priceB + dPrice });
      } else if (drag.handle === 'corner_d') {
        onUpdate(drag.drawingId, { barB: init.barB + dBar, priceA: init.priceA + dPrice });
      }
      setDrag({ ...drag, last: { bar: pt.bar, price: pt.price }, moved });
    }
  };

  const handleMouseUp = () => {
    if (!drag || !layout) return;
    if (drag.mode === 'create' && drag.tool) {
      const kind = drag.tool as Exclude<DrawingTool, 'select' | 'eraser'>;
      let d: Drawing;
      // Passo de preço baseado em ~30px na tela
      const priceDelta = Math.max(5, Math.abs(layout.yToPrice(drag.start.price) - layout.yToPrice(drag.start.price - 30)) || 10);

      if (!drag.moved) {
        // CRIAÇÃO COM APENAS 1 CLIQUE (sem necessidade de arrastar)
        if (kind === 'rect') {
          d = {
            id: newDrawingId(),
            kind: 'rect',
            barA: drag.start.bar - 2,
            priceA: drag.start.price + priceDelta * 1.5,
            barB: drag.start.bar + 10,
            priceB: drag.start.price - priceDelta * 1.5,
            color: activeColor,
          };
        } else if (kind === 'trendline') {
          d = {
            id: newDrawingId(),
            kind: 'trendline',
            barA: drag.start.bar,
            priceA: drag.start.price,
            barB: drag.start.bar + 12,
            priceB: drag.start.price + priceDelta,
            color: activeColor,
          };
        } else if (kind === 'arrow') {
          d = {
            id: newDrawingId(),
            kind: 'arrow',
            barA: drag.start.bar,
            priceA: drag.start.price,
            barB: drag.start.bar + 8,
            priceB: drag.start.price + priceDelta,
            color: activeColor,
          };
        } else {
          d = {
            id: newDrawingId(),
            kind,
            barA: drag.start.bar,
            priceA: drag.start.price,
            barB: drag.start.bar,
            priceB: drag.start.price,
            color: activeColor,
          };
        }
      } else {
        // Criado por arrasto manual
        d = {
          id: newDrawingId(),
          kind,
          barA: drag.start.bar,
          priceA: drag.start.price,
          barB: kind === 'hline' || kind === 'vline' ? drag.start.bar : drag.last.bar,
          priceB: kind === 'hline' || kind === 'vline' ? drag.start.price : drag.last.price,
          color: activeColor,
        };
      }
      onCreate(d);
      onSelect(d.id);
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

    const handleObjectClick = (e: React.MouseEvent) => {
      e.stopPropagation();
      if (activeTool === 'eraser') {
        onDelete(d.id);
        if (selectedId === d.id) onSelect(null);
      } else {
        onSelect(d.id);
      }
    };

    switch (d.kind) {
      case 'trendline':
        return (
          <g key={d.id} data-drawing-id={d.id} style={{ pointerEvents: 'all' }} onClick={handleObjectClick}>
            {/* Hitbox transparente larga */}
            <line x1={p.ax} y1={p.ay} x2={p.bx} y2={p.by} stroke="transparent" strokeWidth={16} strokeLinecap="round" style={{ cursor: selected ? 'move' : 'pointer' }} />
            <line x1={p.ax} y1={p.ay} x2={p.bx} y2={p.by} stroke={hex} strokeLinecap="round" {...selAttr} style={{ cursor: selected ? 'move' : 'pointer' }} />
            {selected && (
              <>
                <circle cx={p.ax} cy={p.ay} r={5} fill="#ffffff" stroke="#f59e0b" strokeWidth={2} style={{ cursor: 'crosshair' }} />
                <circle cx={p.bx} cy={p.by} r={5} fill="#ffffff" stroke="#f59e0b" strokeWidth={2} style={{ cursor: 'crosshair' }} />
              </>
            )}
          </g>
        );
      case 'hline': {
        const endX = Math.max(0, width - 80);
        const tagX = 53; // 38px (barra de desenho) + 15px (respiro)
        return (
          <g key={d.id} data-drawing-id={d.id} style={{ pointerEvents: 'all' }} onClick={handleObjectClick}>
            {/* Hitbox transparente larga */}
            <line x1={0} y1={p.ay} x2={endX} y2={p.ay} stroke="transparent" strokeWidth={16} style={{ cursor: selected ? 'ns-resize' : 'pointer' }} />
            <line x1={0} y1={p.ay} x2={endX} y2={p.ay} stroke={hex} strokeDasharray={selected ? '5 3' : '2 4'} strokeWidth={selected ? 2.5 : 1.4} style={{ cursor: selected ? 'ns-resize' : 'pointer' }} />
            <rect x={tagX} y={p.ay - 8} width={62} height={15} rx={3} fill="#171717" stroke={selected ? '#f59e0b' : '#404040'} strokeWidth={selected ? 1.5 : 0.8} />
            <text x={tagX + 31} y={p.ay + 3} textAnchor="middle" fontSize={9.5} fontFamily="'JetBrains Mono', monospace" fill={hex}>
              {d.priceA.toLocaleString('pt-BR')}
            </text>
            {selected && <circle cx={tagX + 31} cy={p.ay} r={5} fill="#ffffff" stroke="#f59e0b" strokeWidth={2} style={{ cursor: 'ns-resize' }} />}
          </g>
        );
      }
      case 'vline': {
        const paneH = layout?.pricePaneHeight ?? 500;
        return (
          <g key={d.id} data-drawing-id={d.id} style={{ pointerEvents: 'all' }} onClick={handleObjectClick}>
            {/* Hitbox transparente larga */}
            <line x1={p.ax} y1={0} x2={p.ax} y2={paneH} stroke="transparent" strokeWidth={16} style={{ cursor: selected ? 'ew-resize' : 'pointer' }} />
            <line x1={p.ax} y1={0} x2={p.ax} y2={paneH} stroke={hex} strokeDasharray={selected ? '5 3' : '3 3'} strokeWidth={selected ? 2.5 : 1.4} style={{ cursor: selected ? 'ew-resize' : 'pointer' }} />
            <rect x={p.ax - 22} y={6} width={44} height={14} rx={3} fill="#171717" stroke={selected ? '#f59e0b' : '#404040'} strokeWidth={selected ? 1.5 : 0.8} />
            <text x={p.ax} y={16} textAnchor="middle" fontSize={8.5} fontFamily="'JetBrains Mono', monospace" fill={hex}>
              #{d.barA}
            </text>
            {selected && (
              <>
                <circle cx={p.ax} cy={13} r={5} fill="#ffffff" stroke="#f59e0b" strokeWidth={2} style={{ cursor: 'ew-resize' }} />
                <circle cx={p.ax} cy={paneH - 12} r={5} fill="#ffffff" stroke="#f59e0b" strokeWidth={2} style={{ cursor: 'ew-resize' }} />
              </>
            )}
          </g>
        );
      }
      case 'rect': {
        const xMin = Math.min(p.ax, p.bx);
        const xMax = Math.max(p.ax, p.bx);
        const yMin = Math.min(p.ay, p.by);
        const yMax = Math.max(p.ay, p.by);
        const rw = Math.max(2, xMax - xMin);
        const rh = Math.max(2, yMax - yMin);
        return (
          <g key={d.id} data-drawing-id={d.id} style={{ pointerEvents: 'all' }} onClick={handleObjectClick}>
            {/* Hitbox transparente na borda e fundo */}
            <rect
              x={xMin - 4}
              y={yMin - 4}
              width={rw + 8}
              height={rh + 8}
              fill="transparent"
              stroke="transparent"
              style={{ cursor: selected ? 'move' : 'pointer' }}
            />
            <rect
              x={xMin}
              y={yMin}
              width={rw}
              height={rh}
              fill={hex}
              fillOpacity={0.10}
              stroke={hex}
              strokeOpacity={0.85}
              {...selAttr}
              style={{ cursor: selected ? 'move' : 'pointer' }}
            />
            {selected && (
              <>
                {/* 4 cantos com alças e cursores interativos de redimensionamento */}
                <circle cx={p.ax} cy={p.ay} r={5} fill="#ffffff" stroke="#f59e0b" strokeWidth={2} style={{ cursor: 'nwse-resize' }} />
                <circle cx={p.bx} cy={p.by} r={5} fill="#ffffff" stroke="#f59e0b" strokeWidth={2} style={{ cursor: 'nwse-resize' }} />
                <circle cx={p.ax} cy={p.by} r={5} fill="#ffffff" stroke="#f59e0b" strokeWidth={2} style={{ cursor: 'nesw-resize' }} />
                <circle cx={p.bx} cy={p.ay} r={5} fill="#ffffff" stroke="#f59e0b" strokeWidth={2} style={{ cursor: 'nesw-resize' }} />
              </>
            )}
          </g>
        );
      }
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
          <g key={d.id} data-drawing-id={d.id} style={{ pointerEvents: 'all' }} onClick={handleObjectClick}>
            {/* Hitbox transparente larga */}
            <line x1={p.ax} y1={p.ay} x2={p.bx} y2={p.by} stroke="transparent" strokeWidth={16} strokeLinecap="round" style={{ cursor: selected ? 'move' : 'pointer' }} />
            <line x1={p.ax} y1={p.ay} x2={x2} y2={y2} stroke={hex} strokeLinecap="round" {...selAttr} style={{ cursor: selected ? 'move' : 'pointer' }} />
            <polygon points={pts} fill={hex} stroke="none" style={{ cursor: selected ? 'move' : 'pointer' }} />
            {selected && (
              <>
                <circle cx={p.ax} cy={p.ay} r={5} fill="#ffffff" stroke="#f59e0b" strokeWidth={2} style={{ cursor: 'crosshair' }} />
                <circle cx={p.bx} cy={p.by} r={5} fill="#ffffff" stroke="#f59e0b" strokeWidth={2} style={{ cursor: 'crosshair' }} />
              </>
            )}
          </g>
        );
      }
      case 'text':
        return (
          <g key={d.id} data-drawing-id={d.id} style={{ pointerEvents: 'all' }} onClick={handleObjectClick}>
            <rect
              x={p.ax - Math.max(24, (d.text || '').length * 3.9 + 8)}
              y={p.ay - 11}
              width={Math.max(48, (d.text || '').length * 7.8 + 16)}
              height={22}
              rx={4}
              fill="#171717"
              fillOpacity={0.85}
              stroke={selected ? '#f59e0b' : '#404040'}
              strokeWidth={selected ? 1.6 : 0.8}
              className="cursor-pointer"
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
            {selected && <circle cx={p.ax} cy={p.ay} r={4.5} fill="#ffffff" stroke="#f59e0b" strokeWidth={2} />}
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
      case 'vline':
        return <line x1={preview.b.x} y1={0} x2={preview.b.x} y2={layout?.pricePaneHeight ?? 500} stroke={hex} strokeDasharray="2 4" {...op} />;
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

      {/* Barra de ações rápida sobre o estudo selecionado */}
      {(() => {
        if (!selectedId || editing) return null;
        const sel = drawings.find((d) => d.id === selectedId);
        if (!sel) return null;
        const p = drawingToPoints(sel);
        if (!p) return null;
        const posX = Math.max(10, Math.min(width - 190, sel.kind === 'hline' ? 140 : sel.kind === 'vline' ? p.ax - 65 : (p.ax + p.bx) / 2 - 80));
        const posY = Math.max(10, (sel.kind === 'hline' ? p.ay : sel.kind === 'vline' ? 26 : Math.min(p.ay, p.by)) - 40);

        return (
          <foreignObject x={posX} y={posY} width={180} height={34} style={{ overflow: 'visible', pointerEvents: 'all' }}>
            <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-zinc-950/95 border border-zinc-700/80 shadow-2xl backdrop-blur-md">
              {(['white', 'green', 'red', 'yellow', 'blue'] as DrawingColor[]).map((c) => (
                <button
                  key={c}
                  onClick={(e) => {
                    e.stopPropagation();
                    onUpdate(sel.id, { color: c });
                  }}
                  className={`w-3.5 h-3.5 rounded-full transition-transform hover:scale-125 cursor-pointer ${
                    sel.color === c ? 'ring-2 ring-amber-400 scale-110' : ''
                  }`}
                  style={{ backgroundColor: DRAWING_COLOR_HEX[c] }}
                  title={`Mudar cor para ${c}`}
                />
              ))}
              <div className="w-[1px] h-3.5 bg-zinc-800 mx-0.5" />
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(sel.id);
                  onSelect(null);
                }}
                className="p-1 rounded text-zinc-400 hover:text-rose-400 hover:bg-zinc-800 transition-colors cursor-pointer"
                title="Excluir estudo selecionado (Delete)"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onSelect(null);
                }}
                className="p-1 rounded text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 transition-colors cursor-pointer"
                title="Desmarcar seleção (Esc)"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          </foreignObject>
        );
      })()}
    </svg>
  );
};
