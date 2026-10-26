import React, { useRef, useEffect, useState, useMemo } from 'react';
import { RenkoBox, TradeOrder } from '../types/trading';
import {
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Sparkles,
  Pin,
  ChevronUp,
  ChevronDown,
  Target,
  Move,
  Maximize2,
  Sliders,
  ChevronRight,
  ArrowUp,
  ArrowDown,
  Activity,
  BarChart2,
  Layers,
} from 'lucide-react';

const STORAGE_KEY_SCALES = 'fluxo_renko_chart_scales_v2';
const STORAGE_KEY_FLOW_MODE = 'fluxo_renko_flow_mode_v1';

interface RenkoFlowChartProps {
  boxes: RenkoBox[];
  currentBox: Partial<RenkoBox> | null;
  currentPrice: number;
  openOrders: TradeOrder[];
  minDeltaThreshold: number;
  onManualOrder?: (type: 'BUY' | 'SELL') => void;
  onClosePositions?: () => void;
  contracts?: number;
  stopLossPoints?: number;
  takeProfitPoints?: number;
  isRealMT5Connected?: boolean;
  enablePartialExit?: boolean;
  partialPoints?: number;
  partialContracts?: number;
  trailingStop?: boolean;
  onExecutePyramidDemo?: () => void;
}

interface FlowHeikinAshi {
  open: number;
  close: number;
  high: number;
  low: number;
  state: 'UP' | 'DOWN' | 'REVERSAL';
  colorFill: string;
  colorStroke: string;
}

export const RenkoFlowChart: React.FC<RenkoFlowChartProps> = ({
  boxes,
  currentBox,
  currentPrice,
  openOrders,
  minDeltaThreshold,
  onManualOrder,
  onClosePositions,
  contracts = 2,
  stopLossPoints = 100,
  takeProfitPoints = 150,
  isRealMT5Connected = false,
  enablePartialExit = true,
  partialPoints = 50,
  partialContracts = 1,
  trailingStop = true,
  onExecutePyramidDemo,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Armazena posições dos boxes para hit-testing sem causar re-render cíclico
  const boxPositionsRef = useRef<{ x: number; box: RenkoBox; index: number; haState?: 'UP' | 'DOWN' | 'REVERSAL' }[]>([]);

  // Referência para gestos de touch em celulares
  const touchStartRef = useRef<{
    x: number;
    y: number;
    distX?: number;
    distY?: number;
    dist?: number;
    scroll: number;
    panY: number;
  }>({ x: 0, y: 0, scroll: 0, panY: 0 });

  // Carrega escalas salvas pelo operador (se existirem)
  const initialScales = useMemo(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_SCALES);
      if (saved) {
        const parsed = JSON.parse(saved);
        return {
          scaleX: Math.max(0.5, Math.min(3.5, Number(parsed.scaleX) || 1.0)),
          scaleY: Math.max(0.3, Math.min(4.0, Number(parsed.scaleY) || 1.0)),
          scaleFlow: Math.max(0.3, Math.min(4.0, Number(parsed.scaleFlow) || 1.0)),
          flowPaneRatio: Math.max(0.2, Math.min(0.5, Number(parsed.flowPaneRatio) || 0.33)),
          flowPanOffset: Number(parsed.flowPanOffset) || 0,
        };
      }
    } catch (e) {
      // Ignora erro de storage
    }
    return { scaleX: 1.0, scaleY: 1.0, scaleFlow: 1.0, flowPaneRatio: 0.33, flowPanOffset: 0 };
  }, []);

  // =========================================================================
  // CONTROLES DE ESCALAS AJUSTÁVEIS: PREÇO (Y), TEMPO/BOXES (X) E FLUXO (Y & PAINEL)
  // =========================================================================
  const [scaleY, setScaleY] = useState<number>(initialScales.scaleY); // Zoom vertical preço (0.25x a 4.0x)
  const [pricePanOffset, setPricePanOffset] = useState<number>(0); // Deslocamento vertical preço em pontos
  const [scaleX, setScaleX] = useState<number>(initialScales.scaleX); // Zoom horizontal (0.35x a 3.5x)
  const [scaleFlow, setScaleFlow] = useState<number>(initialScales.scaleFlow); // Zoom vertical do fluxo (0.25x a 4.0x)
  const [flowPanOffset, setFlowPanOffset] = useState<number>(initialScales.flowPanOffset || 0); // Deslocamento vertical do fluxo
  const [flowPaneRatio, setFlowPaneRatio] = useState<number>(initialScales.flowPaneRatio || 0.33); // Divisor: % de altura da janela de fluxo (0.18 a 0.55)

  const [visibleCount, setVisibleCount] = useState<number>(() =>
    typeof window !== 'undefined' && window.innerWidth < 640 ? 26 : 40
  );
  const [scrollOffset, setScrollOffset] = useState<number>(0);

  // Modo de exibição do painel de fluxo: Heikin-Ashi (solicitado), Histograma Delta tradicional ou Híbrido
  const [flowViewMode, setFlowViewMode] = useState<'heikin_ashi' | 'histogram' | 'hybrid'>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_FLOW_MODE);
      if (saved === 'histogram' || saved === 'hybrid' || saved === 'heikin_ashi') {
        return saved;
      }
    } catch (e) {
      // Ignora
    }
    return 'heikin_ashi'; // Padrão Heikin-Ashi solicitado
  });

  // Estados de interação e arrasto
  const [mousePos, setMousePos] = useState<{ x: number; y: number } | null>(null);
  const [hoveredBox, setHoveredBox] = useState<RenkoBox | null>(null);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [dragMode, setDragMode] = useState<'CHART' | 'Y_AXIS' | 'X_AXIS' | 'FLOW_AXIS' | 'DIVIDER' | null>(null);
  const [dragStartX, setDragStartX] = useState<number>(0);
  const [dragStartY, setDragStartY] = useState<number>(0);
  const [dragStartScroll, setDragStartScroll] = useState<number>(0);
  const [dragStartScaleY, setDragStartScaleY] = useState<number>(1.0);
  const [dragStartPanOffset, setDragStartPanOffset] = useState<number>(0);
  const [dragStartScaleX, setDragStartScaleX] = useState<number>(1.0);
  const [dragStartScaleFlow, setDragStartScaleFlow] = useState<number>(1.0);
  const [dragStartFlowPanOffset, setDragStartFlowPanOffset] = useState<number>(0);
  const [dragStartFlowRatio, setDragStartFlowRatio] = useState<number>(0.33);

  // Controle do card flutuante em celulares
  const [isMobileDetailsOpen, setIsMobileDetailsOpen] = useState<boolean>(false);

  // Preferências visuais
  const [showOrderLines, setShowOrderLines] = useState<boolean>(true);
  const [boxThickness, setBoxThickness] = useState<'thin' | 'ultrathin' | 'medium'>('thin');
  const [spacingMode, setSpacingMode] = useState<'dynamic' | 'fixed'>('dynamic');
  const [rightMargin, setRightMargin] = useState<number>(() =>
    typeof window !== 'undefined' && window.innerWidth < 640 ? 50 : 90
  );

  // Salva no localStorage para persistir a escolha de escalas e layout do operador
  useEffect(() => {
    try {
      localStorage.setItem(
        STORAGE_KEY_SCALES,
        JSON.stringify({
          scaleX: Number(scaleX.toFixed(2)),
          scaleY: Number(scaleY.toFixed(2)),
          scaleFlow: Number(scaleFlow.toFixed(2)),
          flowPaneRatio: Number(flowPaneRatio.toFixed(3)),
          flowPanOffset: Number(flowPanOffset.toFixed(1)),
        })
      );
    } catch (e) {
      // Ignora
    }
  }, [scaleX, scaleY, scaleFlow, flowPaneRatio, flowPanOffset]);

  // Salva preferência do modo de fluxo
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_FLOW_MODE, flowViewMode);
    } catch (e) {
      // Ignora
    }
  }, [flowViewMode]);

  // Lista unificada incluindo o box em formação se houver
  const allBoxes = useMemo(() => {
    if (!currentBox || currentBox.open === undefined || currentBox.close === undefined) {
      return boxes;
    }
    const formingBox: RenkoBox = {
      index: boxes.length,
      direction: currentPrice >= currentBox.open ? 'UP' : 'DOWN',
      open: currentBox.open,
      close: currentPrice,
      high: Math.max(currentBox.high || currentPrice, currentPrice),
      low: Math.min(currentBox.low || currentPrice, currentPrice),
      timeStart: currentBox.timeStart || Date.now(),
      timeEnd: Date.now(),
      ticksCount: currentBox.ticksCount || 0,
      totalVolume: currentBox.totalVolume || 0,
      buyVolume: currentBox.buyVolume || 0,
      sellVolume: currentBox.sellVolume || 0,
      delta: (currentBox.buyVolume || 0) - (currentBox.sellVolume || 0),
      cvdAtClose: currentBox.cvdAtClose || 0,
      isConvergence: false,
    };
    return [...boxes, formingBox];
  }, [boxes, currentBox, currentPrice]);

  // Box ativo exibido no quadro fixo
  const activeBox = hoveredBox || (allBoxes.length > 0 ? allBoxes[allBoxes.length - 1] : null);

  // Identifica o status do Heikin-Ashi do activeBox para mostrar no HUD
  const activeBoxHaState = useMemo(() => {
    if (!activeBox || allBoxes.length === 0) return null;
    const idx = allBoxes.findIndex((b) => b.index === activeBox.index);
    if (idx < 0) return null;

    // Calcula de forma rápida o estado desse box
    const prevCvd = idx > 0 ? allBoxes[idx - 1].cvdAtClose : activeBox.cvdAtClose - activeBox.delta;
    const rawOpen = prevCvd;
    const rawClose = activeBox.cvdAtClose;
    const rawHigh = Math.max(rawOpen, rawClose);
    const rawLow = Math.min(rawOpen, rawClose);
    const haClose = (rawOpen + rawHigh + rawLow + rawClose) / 4;
    const haOpen = idx === 0 ? (rawOpen + rawClose) / 2 : (prevCvd + rawClose) / 2;

    const isCurrentUp = haClose >= haOpen;
    if (idx > 0) {
      const prevPrevCvd = idx > 1 ? allBoxes[idx - 2].cvdAtClose : allBoxes[0].cvdAtClose - allBoxes[0].delta;
      const prevHaClose = (prevPrevCvd + allBoxes[idx - 1].cvdAtClose * 2) / 3;
      const prevHaOpen = prevPrevCvd;
      const isPrevUp = prevHaClose >= prevHaOpen;
      if (isCurrentUp !== isPrevUp) {
        return 'REVERSAL';
      }
    }
    return isCurrentUp ? 'UP' : 'DOWN';
  }, [activeBox, allBoxes]);

  // =========================================================================
  // RENDERIZAÇÃO DO CANVAS: RENKO 10R & FLUXO HEIKIN-ASHI
  // =========================================================================
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Resolução DPI
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const width = rect.width;
    const height = rect.height;
    const isMobile = width < 640;

    // Layout dos painéis: Preço (topo) e Janela de Fluxo (base com divisor ajustável)
    const clampedFlowRatio = Math.max(0.18, Math.min(0.55, flowPaneRatio));
    const flowPaneHeight = height * clampedFlowRatio;
    const pricePaneHeight = height - flowPaneHeight;
    const rightAxisWidth = isMobile ? 54 : 80;
    const chartWidth = width - rightAxisWidth;
    const effectiveRightMargin = isMobile ? Math.min(rightMargin, 50) : rightMargin;

    // Fundo escuro profissional
    ctx.fillStyle = '#050811';
    ctx.fillRect(0, 0, width, height);

    // Divisor interativo de painel (arrastável)
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, pricePaneHeight);
    ctx.lineTo(width, pricePaneHeight);
    ctx.stroke();

    // Marcador central no divisor indicando que é redimensionável por arrasto
    const handleW = isMobile ? 32 : 44;
    const handleH = 4;
    const handleX = chartWidth / 2 - handleW / 2;
    const handleY = pricePaneHeight - handleH / 2;
    ctx.fillStyle = '#1e293b';
    ctx.beginPath();
    ctx.roundRect(handleX, handleY, handleW, handleH, 2);
    ctx.fill();
    ctx.strokeStyle = '#475569';
    ctx.lineWidth = 1;
    ctx.stroke();

    // 3 pontos no puxador
    ctx.fillStyle = '#94a3b8';
    for (let d = -1; d <= 1; d++) {
      ctx.beginPath();
      ctx.arc(chartWidth / 2 + d * (isMobile ? 6 : 8), pricePaneHeight, 1, 0, Math.PI * 2);
      ctx.fill();
    }

    // Eixo de preços lateral
    ctx.fillStyle = '#080d1a';
    ctx.fillRect(chartWidth, 0, rightAxisWidth, height);
    ctx.beginPath();
    ctx.moveTo(chartWidth, 0);
    ctx.lineTo(chartWidth, height);
    ctx.stroke();

    if (allBoxes.length === 0) {
      ctx.fillStyle = '#64748b';
      ctx.font = isMobile ? '11px "Plus Jakarta Sans", sans-serif' : '13px "Plus Jakarta Sans", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Aguardando ticks para formar Renko 10R...', width / 2, height / 2);
      return;
    }

    // Slice de dados baseado no visibleCount e escala X
    const effectiveVisibleCount = Math.max(10, Math.round(visibleCount / Math.sqrt(scaleX)));
    const totalCount = allBoxes.length;
    const startIdx = Math.max(0, totalCount - effectiveVisibleCount);
    const displayedBoxes = allBoxes.slice(startIdx);

    if (displayedBoxes.length === 0) return;

    // Largura do bloco proporcional à escala X
    const baseBoxWidth =
      boxThickness === 'ultrathin'
        ? 6
        : boxThickness === 'thin'
        ? isMobile
          ? 8
          : 10
        : isMobile
        ? 12
        : 14;
    const boxWidth = Math.max(5, Math.min(28, Math.round(baseBoxWidth * Math.sqrt(scaleX))));

    // Posicionamento X com ancoragem à direita e preenchimento harmônico do viewport
    const baseSpacingStep = isMobile ? 18 : 22;
    // Garante que o scrollOffset nunca seja negativo (o que jogaria os blocos para a esquerda, deixando o lado direito vazio)
    const effectiveScroll = Math.max(0, scrollOffset);

    // Auto-fit adaptativo para preencher o canvas harmoniosamente quando há poucos blocos
    const availableWidth = Math.max(100, chartWidth - effectiveRightMargin - (isMobile ? 16 : 30));
    const autoFitStep =
      displayedBoxes.length > 1
        ? Math.min(isMobile ? 32 : 46, Math.max(baseSpacingStep, availableWidth / (displayedBoxes.length + 1)))
        : baseSpacingStep;

    const dynamicStep =
      spacingMode === 'dynamic'
        ? autoFitStep
        : Math.max(16, availableWidth / Math.max(1, displayedBoxes.length));
    const stepX = dynamicStep * scaleX;

    const lastBoxX = chartWidth - effectiveRightMargin + effectiveScroll * stepX;
    const xs: number[] = new Array(displayedBoxes.length);
    let currX = lastBoxX;

    for (let i = displayedBoxes.length - 1; i >= 0; i--) {
      xs[i] = currX;
      if (i > 0) {
        currX -= stepX;
      }
    }

    // =======================================================================
    // CÁLCULO DA SÉRIE HEIKIN-ASHI DE FLUXO (CVD & DELTA)
    // =======================================================================
    const flowHaData: FlowHeikinAshi[] = [];
    let prevHa: FlowHeikinAshi | null = null;

    displayedBoxes.forEach((b, i) => {
      const prevCvd = i > 0 ? displayedBoxes[i - 1].cvdAtClose : b.cvdAtClose - b.delta;
      const rawOpen = prevCvd;
      const rawClose = b.cvdAtClose;
      const extraBuy = Math.max(0, b.buyVolume - b.sellVolume) * 0.35;
      const extraSell = Math.max(0, b.sellVolume - b.buyVolume) * 0.35;
      const rawHigh = Math.max(rawOpen, rawClose) + extraBuy;
      const rawLow = Math.min(rawOpen, rawClose) - extraSell;

      let haOpen: number;
      const haClose = (rawOpen + rawHigh + rawLow + rawClose) / 4;
      if (prevHa === null) {
        haOpen = (rawOpen + rawClose) / 2;
      } else {
        haOpen = (prevHa.open + prevHa.close) / 2;
      }
      const haHigh = Math.max(rawHigh, haOpen, haClose);
      const haLow = Math.min(rawLow, haOpen, haClose);

      const isCurrentUp = haClose >= haOpen;
      const isPrevUp = prevHa ? prevHa.close >= prevHa.open : isCurrentUp;
      const isDirectionFlip = prevHa !== null && isCurrentUp !== isPrevUp;
      const candleBody = Math.abs(haClose - haOpen);
      const candleRange = Math.max(1, haHigh - haLow);
      const isDoji = candleBody / candleRange < 0.16;

      // Classificação solicitada:
      // Verde na subida, Vermelho na descida e na Reversão Cinza!
      let state: 'UP' | 'DOWN' | 'REVERSAL';
      if (isDirectionFlip || isDoji) {
        state = 'REVERSAL'; // Reversão / Transição de Fluxo -> CINZA
      } else if (isCurrentUp) {
        state = 'UP'; // Subida -> VERDE
      } else {
        state = 'DOWN'; // Descida -> VERMELHO
      }

      const colorFill = state === 'REVERSAL' ? '#94a3b8' : state === 'UP' ? '#10b981' : '#ef4444';
      const colorStroke = state === 'REVERSAL' ? '#64748b' : state === 'UP' ? '#059669' : '#dc2626';

      const haObj: FlowHeikinAshi = {
        open: haOpen,
        close: haClose,
        high: haHigh,
        low: haLow,
        state,
        colorFill,
        colorStroke,
      };

      flowHaData.push(haObj);
      prevHa = haObj;
    });

    // =======================================================================
    // ESCALA VERTICAL DO PREÇO (PAINEL SUPERIOR)
    // =======================================================================
    const visibleBoxes = displayedBoxes.filter((_, i) => xs[i] >= -40 && xs[i] <= chartWidth + 40);
    const boxesForScale = visibleBoxes.length > 0 ? visibleBoxes : displayedBoxes;

    let boxMin = Infinity;
    let boxMax = -Infinity;
    boxesForScale.forEach((b) => {
      boxMin = Math.min(boxMin, b.low, b.open, b.close);
      boxMax = Math.max(boxMax, b.high, b.open, b.close);
    });

    if (!isFinite(boxMin) || !isFinite(boxMax) || boxMin >= boxMax) {
      const fallbackCenter = currentPrice > 0 ? currentPrice : 128500;
      boxMin = fallbackCenter - 100;
      boxMax = fallbackCenter + 100;
    }

    let minPrice = boxMin;
    let maxPrice = boxMax;

    // Apenas expande a escala para ordens abertas se estiverem a até 350 pontos do preço atual,
    // evitando que ordens antigas ou distantes esmaguem os boxes visíveis no canto do gráfico
    const maxAllowedOrderDist = 350;
    openOrders.forEach((o) => {
      const isPending = o.status === 'PENDING_LIMIT';
      const effPrice = isPending && o.limitPrice ? o.limitPrice : o.entryPrice;
      if (effPrice > 0 && Math.abs(effPrice - currentPrice) <= maxAllowedOrderDist) {
        minPrice = Math.min(minPrice, effPrice);
        maxPrice = Math.max(maxPrice, effPrice);
      }
      if (o.stopLoss > 0 && Math.abs(o.stopLoss - currentPrice) <= maxAllowedOrderDist) {
        minPrice = Math.min(minPrice, o.stopLoss);
      }
      if (o.takeProfit > 0 && Math.abs(o.takeProfit - currentPrice) <= maxAllowedOrderDist) {
        maxPrice = Math.max(maxPrice, o.takeProfit);
      }
      if (enablePartialExit && o.role !== 'MAIN' && o.role !== 'PYRAMID' && !o.partialExecuted && o.contracts > 1 && !isPending && effPrice > 0) {
        const pTarget = o.type === 'BUY' ? effPrice + partialPoints : effPrice - partialPoints;
        if (pTarget > 0 && Math.abs(pTarget - currentPrice) <= maxAllowedOrderDist) {
          minPrice = Math.min(minPrice, pTarget);
          maxPrice = Math.max(maxPrice, pTarget);
        }
      }
    });

    const priceRange = Math.max(50, maxPrice - minPrice);
    const pricePadding = scaleY === 1.0 ? Math.max(10, priceRange * 0.04) : Math.max(30, priceRange * 0.12);
    minPrice -= pricePadding;
    maxPrice += pricePadding;

    const baseMidPrice = (maxPrice + minPrice) / 2;
    const basePriceRange = Math.max(10, maxPrice - minPrice);

    const effectivePriceRange = basePriceRange / Math.max(0.2, scaleY);
    const centerPrice = baseMidPrice + pricePanOffset;
    const effectiveMinPrice = centerPrice - effectivePriceRange / 2;
    const effectiveMaxPrice = centerPrice + effectivePriceRange / 2;

    const priceTopMargin = 12;
    const priceBottomMargin = 16;
    const usablePriceHeight = Math.max(50, pricePaneHeight - priceTopMargin - priceBottomMargin);

    const priceToY = (price: number) => {
      return (
        pricePaneHeight -
        priceBottomMargin -
        ((price - effectiveMinPrice) / effectivePriceRange) * usablePriceHeight
      );
    };

    const yToPrice = (y: number) => {
      const pct = (pricePaneHeight - priceBottomMargin - y) / usablePriceHeight;
      return effectiveMinPrice + pct * effectivePriceRange;
    };

    // =======================================================================
    // ESCALA VERTICAL DO PAINEL DE FLUXO (DELTA & HEIKIN-ASHI)
    // =======================================================================
    let maxAbsDelta = 50;
    let minCvd = Infinity;
    let maxCvd = -Infinity;
    boxesForScale.forEach((b) => {
      maxAbsDelta = Math.max(maxAbsDelta, Math.abs(b.delta));
      minCvd = Math.min(minCvd, b.cvdAtClose);
      maxCvd = Math.max(maxCvd, b.cvdAtClose);
    });
    maxAbsDelta = Math.max(maxAbsDelta, minDeltaThreshold * 1.25);
    const effectiveMaxAbsDelta = maxAbsDelta / Math.max(0.2, scaleFlow);

    const deltaToY = (delta: number) => {
      const centerY = pricePaneHeight + flowPaneHeight / 2 + flowPanOffset * 0.1;
      const usableHeight = (flowPaneHeight - 28) / 2;
      return centerY - (delta / effectiveMaxAbsDelta) * usableHeight;
    };
    const deltaZeroY = deltaToY(0);

    const cvdPadding = Math.max(100, (maxCvd - minCvd) * 0.1);
    const baseCvdRange = Math.max(20, maxCvd - minCvd + cvdPadding * 2);
    const effectiveCvdRange = baseCvdRange / Math.max(0.2, scaleFlow);
    const midCvd = (maxCvd + minCvd) / 2 + flowPanOffset;
    const effMinCvd = midCvd - effectiveCvdRange / 2;

    const cvdToY = (cvd: number) => {
      const top = pricePaneHeight + 14;
      const h = flowPaneHeight - 28;
      return top + h - ((cvd - effMinCvd) / effectiveCvdRange) * h;
    };

    // Escala dinâmica para os candles Heikin-Ashi de fluxo (baseada nos visíveis na tela)
    let minFlowHa = Infinity;
    let maxFlowHa = -Infinity;
    flowHaData.forEach((ha, i) => {
      if (xs[i] >= -40 && xs[i] <= chartWidth + 40) {
        minFlowHa = Math.min(minFlowHa, ha.low);
        maxFlowHa = Math.max(maxFlowHa, ha.high);
      }
    });
    if (!isFinite(minFlowHa)) {
      flowHaData.forEach((ha) => {
        minFlowHa = Math.min(minFlowHa, ha.low);
        maxFlowHa = Math.max(maxFlowHa, ha.high);
      });
      if (!isFinite(minFlowHa)) {
        minFlowHa = -200;
        maxFlowHa = 200;
      }
    }

    const baseHaSpan = Math.max(40, maxFlowHa - minFlowHa);
    const haPadding = scaleFlow === 1.0 ? Math.max(4, baseHaSpan * 0.015) : Math.max(15, baseHaSpan * 0.1);
    const paddedMinHa = minFlowHa - haPadding;
    const paddedMaxHa = maxFlowHa + haPadding;
    const baseHaRange = paddedMaxHa - paddedMinHa;

    // Escala efetiva do Heikin-Ashi ajustada por zoom vertical do fluxo e pan
    const effectiveHaRange = baseHaRange / Math.max(0.2, scaleFlow);
    const midHa = (paddedMaxHa + paddedMinHa) / 2 + flowPanOffset;
    const effectiveMinFlowHa = midHa - effectiveHaRange / 2;
    const effectiveMaxFlowHa = midHa + effectiveHaRange / 2;

    const flowTopMargin = pricePaneHeight + 12;
    const flowBottomMargin = 16;
    const usableFlowHeight = Math.max(40, flowPaneHeight - (flowTopMargin - pricePaneHeight) - flowBottomMargin);

    const flowHaToY = (val: number) => {
      return flowTopMargin + usableFlowHeight - ((val - effectiveMinFlowHa) / effectiveHaRange) * usableFlowHeight;
    };

    // =======================================================================
    // GRADE DINÂMICA DE PREÇOS (EIXO Y ADAPTATIVO)
    // =======================================================================
    const pxPer50Pts = Math.abs(priceToY(centerPrice + 50) - priceToY(centerPrice));
    let gridStep = pxPer50Pts < 18 ? 100 : pxPer50Pts > 55 ? 25 : 50;
    while ((effectiveMaxPrice - effectiveMinPrice) / gridStep > 20) {
      gridStep *= 2;
    }

    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 1;
    ctx.fillStyle = '#64748b';
    ctx.font = isMobile ? '8.5px "JetBrains Mono", monospace' : '10px "JetBrains Mono", monospace';
    ctx.textAlign = 'left';

    const startGridPrice = Math.ceil(effectiveMinPrice / gridStep) * gridStep;
    for (let p = startGridPrice; p <= effectiveMaxPrice; p += gridStep) {
      const y = priceToY(p);
      if (y >= 10 && y <= pricePaneHeight - 10) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(chartWidth, y);
        ctx.stroke();
        ctx.fillText(p.toLocaleString('pt-BR'), chartWidth + (isMobile ? 3 : 6), y + 3.5);
      }
    }

    // =======================================================================
    // ESCALA E NÍVEIS DA JANELA DE FLUXO (EIXO LATERAL & GRADE ADAPTATIVA)
    // =======================================================================
    if (flowViewMode === 'heikin_ashi' || flowViewMode === 'hybrid') {
      const lastHa = flowHaData[flowHaData.length - 1];
      const lastHaY = lastHa ? flowHaToY(lastHa.close) : null;

      // Calcula haStep dinamicamente para garantir no máximo 1 linha a cada 24px de altura utilizável
      const maxHaTicks = Math.max(2, Math.floor(usableFlowHeight / 24));
      const rawHaStep = Math.max(50, effectiveHaRange / maxHaTicks);

      // Arredonda para um passo limpo (50, 100, 250, 500, 1000, 2500, 5000, 10000, etc.)
      const pow10 = Math.pow(10, Math.floor(Math.log10(rawHaStep)));
      const rel = rawHaStep / pow10;
      let stepFactor = 1;
      if (rel > 5) stepFactor = 10;
      else if (rel > 2.2) stepFactor = 5;
      else if (rel > 1.2) stepFactor = 2.5;
      const haStep = Math.max(50, Math.round(stepFactor * pow10));

      const startHaVal = Math.ceil(effectiveMinFlowHa / haStep) * haStep;
      ctx.font = isMobile ? '7.5px "JetBrains Mono", monospace' : '8.5px "JetBrains Mono", monospace';

      let lastDrawnFlowY = -999;
      for (let v = startHaVal; v <= effectiveMaxFlowHa; v += haStep) {
        const y = flowHaToY(v);
        if (y >= pricePaneHeight + 14 && y <= height - 16) {
          // Evita colisão vertical com rótulo anterior ou com o badge do último valor
          if (Math.abs(y - lastDrawnFlowY) < 18) continue;
          if (lastHaY !== null && Math.abs(y - lastHaY) < 14) continue;

          const isZero = Math.abs(v) < 1;
          ctx.strokeStyle = isZero ? '#334155' : 'rgba(30, 41, 59, 0.55)';
          ctx.setLineDash(isZero ? [4, 4] : [1, 4]);
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(chartWidth, y);
          ctx.stroke();
          ctx.setLineDash([]);

          ctx.fillStyle = isZero ? '#94a3b8' : '#64748b';
          ctx.textAlign = 'left';
          const sign = v > 0 ? '+' : '';
          const formatted = Math.abs(v) >= 1000 ? `${sign}${(v / 1000).toFixed(1)}k` : `${sign}${v}`;
          ctx.fillText(formatted, chartWidth + (isMobile ? 3 : 6), y + 3);
          lastDrawnFlowY = y;
        }
      }

      // Badge com o valor do último candle Heikin-Ashi na régua lateral
      if (lastHa && lastHaY !== null) {
        if (lastHaY >= pricePaneHeight + 8 && lastHaY <= height - 12) {
          const badgeFill =
            lastHa.state === 'UP' ? '#059669' : lastHa.state === 'DOWN' ? '#dc2626' : '#475569';
          ctx.fillStyle = badgeFill;
          ctx.beginPath();
          ctx.roundRect(chartWidth + 1, lastHaY - 7, rightAxisWidth - 2, 14, 2);
          ctx.fill();
          ctx.fillStyle = '#ffffff';
          ctx.font = isMobile
            ? 'bold 7.5px "JetBrains Mono", monospace'
            : 'bold 8.5px "JetBrains Mono", monospace';
          ctx.textAlign = 'center';
          const valStr =
            Math.abs(lastHa.close) >= 1000
              ? `${lastHa.close > 0 ? '+' : ''}${(lastHa.close / 1000).toFixed(1)}k`
              : `${lastHa.close > 0 ? '+' : ''}${Math.round(lastHa.close)}`;
          ctx.fillText(valStr, chartWidth + rightAxisWidth / 2, lastHaY + 3.5);
        }
      }
    }

    if (flowViewMode === 'histogram' || flowViewMode === 'hybrid') {
      const zeroY = deltaToY(0);
      if (zeroY >= pricePaneHeight + 10 && zeroY <= height - 14) {
        ctx.strokeStyle = '#1e293b';
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(0, zeroY);
        ctx.lineTo(chartWidth, zeroY);
        ctx.stroke();
        ctx.setLineDash([]);
        if (flowViewMode === 'histogram') {
          ctx.fillStyle = '#94a3b8';
          ctx.font = isMobile ? '8px "JetBrains Mono"' : '9px "JetBrains Mono"';
          ctx.textAlign = 'left';
          ctx.fillText('0Δ', chartWidth + (isMobile ? 3 : 6), zeroY + 3);
        }
      }

      const upperThresholdY = deltaToY(minDeltaThreshold);
      const lowerThresholdY = deltaToY(-minDeltaThreshold);

      if (upperThresholdY >= pricePaneHeight + 10) {
        ctx.strokeStyle = 'rgba(16, 185, 129, 0.35)';
        ctx.setLineDash([2, 4]);
        ctx.beginPath();
        ctx.moveTo(0, upperThresholdY);
        ctx.lineTo(chartWidth, upperThresholdY);
        ctx.stroke();
        ctx.setLineDash([]);
        if (flowViewMode === 'histogram') {
          ctx.fillStyle = '#10b981';
          ctx.font = isMobile ? '8px "JetBrains Mono"' : '9px "JetBrains Mono"';
          ctx.textAlign = 'left';
          ctx.fillText(`+${minDeltaThreshold}Δ`, chartWidth + (isMobile ? 3 : 6), upperThresholdY + 3);
        }
      }

      if (lowerThresholdY <= height - 14) {
        ctx.strokeStyle = 'rgba(239, 68, 68, 0.35)';
        ctx.setLineDash([2, 4]);
        ctx.beginPath();
        ctx.moveTo(0, lowerThresholdY);
        ctx.lineTo(chartWidth, lowerThresholdY);
        ctx.stroke();
        ctx.setLineDash([]);
        if (flowViewMode === 'histogram') {
          ctx.fillStyle = '#ef4444';
          ctx.font = isMobile ? '8px "JetBrains Mono"' : '9px "JetBrains Mono"';
          ctx.textAlign = 'left';
          ctx.fillText(`-${minDeltaThreshold}Δ`, chartWidth + (isMobile ? 3 : 6), lowerThresholdY + 3);
        }
      }

      if (flowViewMode === 'histogram') {
        const lastBox = displayedBoxes[displayedBoxes.length - 1];
        if (lastBox) {
          const lastDeltaY = deltaToY(lastBox.delta);
          if (lastDeltaY >= pricePaneHeight + 8 && lastDeltaY <= height - 12) {
            ctx.fillStyle = lastBox.delta >= 0 ? '#059669' : '#dc2626';
            ctx.beginPath();
            ctx.roundRect(chartWidth + 1, lastDeltaY - 7, rightAxisWidth - 2, 14, 2);
            ctx.fill();
            ctx.fillStyle = '#ffffff';
            ctx.font = isMobile ? 'bold 7.5px "JetBrains Mono"' : 'bold 8.5px "JetBrains Mono"';
            ctx.textAlign = 'center';
            ctx.fillText(
              `${lastBox.delta > 0 ? '+' : ''}${lastBox.delta}Δ`,
              chartWidth + rightAxisWidth / 2,
              lastDeltaY + 3.5
            );
          }
        }
      }
    }

    // Título dos painéis
    // Salva posições dos boxes para hit-testing
    const boxPositions: { x: number; box: RenkoBox; index: number; haState?: 'UP' | 'DOWN' | 'REVERSAL' }[] = [];

    // Linha CVD (desenhada sutilmente em todos os modos)
    ctx.strokeStyle = flowViewMode === 'heikin_ashi' ? 'rgba(56, 189, 248, 0.45)' : '#38bdf8';
    ctx.lineWidth = flowViewMode === 'heikin_ashi' ? 1.0 : 1.5;
    ctx.beginPath();
    let hasStartedCvd = false;
    displayedBoxes.forEach((b, i) => {
      const x = xs[i];
      if (x < -20 || x > chartWidth + 20) return;
      const cy = cvdToY(b.cvdAtClose);
      if (!hasStartedCvd) {
        ctx.moveTo(x, cy);
        hasStartedCvd = true;
      } else {
        ctx.lineTo(x, cy);
      }
    });
    ctx.stroke();

    // =======================================================================
    // DESENHO DOS TIJOLOS RENKO 10R (PAINEL SUPERIOR)
    // =======================================================================
    let lastBuySignalX = -999;
    let lastSellSignalX = -999;

    displayedBoxes.forEach((b, i) => {
      const centerX = xs[i];
      if (centerX < -30 || centerX > chartWidth + 30) return;

      const left = centerX - boxWidth / 2;
      const haState = flowHaData[i]?.state;
      boxPositions.push({ x: centerX, box: b, index: startIdx + i, haState });

      const isUp = b.direction === 'UP';
      const isForming = i === displayedBoxes.length - 1 && currentBox !== null;

      const openY = priceToY(b.open);
      const closeY = priceToY(b.close);
      const topY = Math.min(openY, closeY);
      const boxH = Math.max(3, Math.abs(closeY - openY));

      const highY = priceToY(b.high);
      const lowY = priceToY(b.low);

      // Pavio
      ctx.strokeStyle = isUp ? '#059669' : '#dc2626';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(centerX, highY);
      ctx.lineTo(centerX, lowY);
      ctx.stroke();

      if (isForming) {
        const targetClosePrice = isUp ? b.open + 50 : b.open - 50;
        const targetCloseY = priceToY(targetClosePrice);
        const ghostTopY = Math.min(openY, targetCloseY);
        const ghostH = Math.max(3, Math.abs(targetCloseY - openY));

        ctx.fillStyle = isUp ? 'rgba(16, 185, 129, 0.12)' : 'rgba(239, 68, 68, 0.12)';
        ctx.strokeStyle = isUp ? 'rgba(16, 185, 129, 0.4)' : 'rgba(239, 68, 68, 0.4)';
        ctx.setLineDash([2, 2]);
        ctx.beginPath();
        ctx.roundRect(left, ghostTopY, boxWidth, ghostH, 1);
        ctx.fill();
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.fillStyle = isUp ? 'rgba(16, 185, 129, 0.45)' : 'rgba(239, 68, 68, 0.45)';
        ctx.strokeStyle = isUp ? '#34d399' : '#f87171';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(left, topY, boxWidth, boxH, 1);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = isUp ? '#34d399' : '#f87171';
        ctx.beginPath();
        ctx.arc(centerX, closeY, isMobile ? 2.5 : 3, 0, Math.PI * 2);
        ctx.fill();

        if (!isMobile) {
          const ptsRemaining = isUp ? targetClosePrice - currentPrice : currentPrice - targetClosePrice;
          ctx.fillStyle = '#38bdf8';
          ctx.font = '9px "JetBrains Mono", monospace';
          ctx.textAlign = 'center';
          ctx.fillText(`+${b.ticksCount}t`, centerX, highY - 14);
          ctx.fillStyle = isUp ? '#34d399' : '#f87171';
          ctx.fillText(
            `${ptsRemaining > 0 ? `faltam ${ptsRemaining}p` : 'fechando'}`,
            centerX,
            highY - 4
          );
        }
      } else {
        ctx.fillStyle = isUp ? '#10b981' : '#ef4444';
        ctx.strokeStyle = isUp ? '#059669' : '#dc2626';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(left, topY, boxWidth, boxH, 1);
        ctx.fill();
        ctx.stroke();
      }

      // Sinais de Entrada e Convergência no Gráfico de Preço (sem poluição visual repetitiva)
      const prevBox = i > 0 ? displayedBoxes[i - 1] : null;
      const isFirstBuyConvergence =
        b.convergenceType === 'BUY_CONVERGENCE' &&
        (!prevBox || prevBox.convergenceType !== 'BUY_CONVERGENCE');
      const isFirstSellConvergence =
        b.convergenceType === 'SELL_CONVERGENCE' &&
        (!prevBox || prevBox.convergenceType !== 'SELL_CONVERGENCE');

      const shouldDrawBuy =
        b.orderDispatched === 'BUY' ||
        isFirstBuyConvergence ||
        (b.convergenceType === 'BUY_CONVERGENCE' && centerX - lastBuySignalX >= 65);

      const shouldDrawSell =
        b.orderDispatched === 'SELL' ||
        isFirstSellConvergence ||
        (b.convergenceType === 'SELL_CONVERGENCE' && centerX - lastSellSignalX >= 65);

      if (shouldDrawBuy) {
        ctx.fillStyle = '#10b981';
        ctx.font = isMobile ? 'bold 8.5px "Plus Jakarta Sans"' : 'bold 10px "Plus Jakarta Sans"';
        ctx.textAlign = 'center';
        const label = isMobile ? '▲ C' : b.orderDispatched === 'BUY' ? '▲ MÃE' : '▲ COMPRA';
        ctx.fillText(label, centerX, lowY + (isMobile ? 12 : 16));
        lastBuySignalX = centerX;
      } else if (b.convergenceType === 'BUY_CONVERGENCE' && !isMobile && centerX - lastBuySignalX >= 22) {
        ctx.fillStyle = '#059669';
        ctx.font = '8px "Plus Jakarta Sans"';
        ctx.textAlign = 'center';
        ctx.fillText('▲', centerX, lowY + 11);
      }

      if (shouldDrawSell) {
        ctx.fillStyle = '#ef4444';
        ctx.font = isMobile ? 'bold 8.5px "Plus Jakarta Sans"' : 'bold 10px "Plus Jakarta Sans"';
        ctx.textAlign = 'center';
        const label = isMobile ? '▼ V' : b.orderDispatched === 'SELL' ? '▼ MÃE' : '▼ VENDA';
        ctx.fillText(label, centerX, highY - (isMobile ? 6 : 10));
        lastSellSignalX = centerX;
      } else if (b.convergenceType === 'SELL_CONVERGENCE' && !isMobile && centerX - lastSellSignalX >= 22) {
        ctx.fillStyle = '#dc2626';
        ctx.font = '8px "Plus Jakarta Sans"';
        ctx.textAlign = 'center';
        ctx.fillText('▼', centerX, highY - 5);
      }

      // =======================================================================
      // DESENHO DO PAINEL INFERIOR: HEIKIN-ASHI E/OU HISTOGRAMA DE DELTA
      // =======================================================================
      // 1. Histograma de Delta (desenhado em modo 'histogram' ou 'hybrid')
      if (flowViewMode === 'histogram' || flowViewMode === 'hybrid') {
        const deltaY = deltaToY(b.delta);
        const isPositiveDelta = b.delta >= 0;
        const barTop = Math.min(deltaZeroY, deltaY);
        const barHeight = Math.max(2, Math.abs(deltaY - deltaZeroY));

        const strongFlow = Math.abs(b.delta) >= minDeltaThreshold;
        const opacity = flowViewMode === 'hybrid' ? '0.35' : '1.0';

        ctx.fillStyle = isPositiveDelta
          ? strongFlow
            ? `rgba(16, 185, 129, ${opacity})`
            : `rgba(5, 150, 105, ${opacity})`
          : strongFlow
          ? `rgba(239, 68, 68, ${opacity})`
          : `rgba(220, 38, 38, ${opacity})`;

        ctx.beginPath();
        ctx.roundRect(left, barTop, boxWidth, barHeight, 1);
        ctx.fill();
      }

      // 2. Gráfico Heikin-Ashi de Fluxo (desenhado em modo 'heikin_ashi' ou 'hybrid')
      // Mostrando VERDE na subida, VERMELHO na descida e CINZA na reversão!
      if (flowViewMode === 'heikin_ashi' || flowViewMode === 'hybrid') {
        const ha = flowHaData[i];
        if (ha) {
          const openY = flowHaToY(ha.open);
          const closeY = flowHaToY(ha.close);
          const highY = flowHaToY(ha.high);
          const lowY = flowHaToY(ha.low);
          const topY = Math.min(openY, closeY);
          const candleH = Math.max(3, Math.abs(closeY - openY));

          // Pavio Heikin-Ashi
          ctx.strokeStyle = ha.colorStroke;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(centerX, highY);
          ctx.lineTo(centerX, lowY);
          ctx.stroke();

          // Corpo Heikin-Ashi 100% preenchido
          ctx.fillStyle = ha.colorFill;
          ctx.strokeStyle = ha.colorStroke;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.roundRect(left, topY, boxWidth, candleH, 1.5);
          ctx.fill();
          ctx.stroke();

          // Destaque visual no centro se for candle de REVERSÃO (CINZA)
          if (ha.state === 'REVERSAL') {
            ctx.fillStyle = '#f8fafc';
            ctx.beginPath();
            ctx.arc(centerX, (highY + lowY) / 2, isMobile ? 1.5 : 2, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
    });

    boxPositionsRef.current = boxPositions;

    // =======================================================================
    // RÉGUA HORIZONTAL DE TEMPO (EIXO X)
    // =======================================================================
    const timeAxisY = height - 14;
    ctx.fillStyle = '#475569';
    ctx.font = isMobile ? '8px "JetBrains Mono"' : '9px "JetBrains Mono"';
    ctx.textAlign = 'center';

    let lastLabelX = -100;
    const minLabelSpacing = isMobile ? 55 : 70;
    displayedBoxes.forEach((b, i) => {
      const x = xs[i];
      if (x >= 20 && x <= chartWidth - 20 && x - lastLabelX >= minLabelSpacing) {
        const timeStr = new Date(b.timeEnd || b.timeStart).toLocaleTimeString('pt-BR', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        });
        ctx.fillText(timeStr, x, timeAxisY + 9);
        lastLabelX = x;
      }
    });

    // =======================================================================
    // LINHA DO PREÇO ATUAL E ORDENS ABERTAS (MTM)
    // =======================================================================
    const currentPriceY = priceToY(currentPrice);
    if (currentPriceY >= 0 && currentPriceY <= pricePaneHeight) {
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(0, currentPriceY);
      ctx.lineTo(chartWidth, currentPriceY);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = '#0284c7';
      ctx.beginPath();
      ctx.roundRect(chartWidth + 1, currentPriceY - 9, rightAxisWidth - 2, 18, 2);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.font = isMobile ? 'bold 8.5px "JetBrains Mono", monospace' : 'bold 11px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillText(
        currentPrice.toLocaleString('pt-BR'),
        chartWidth + rightAxisWidth / 2,
        currentPriceY + 3.5
      );
    }

    // Linhas de Posições (Entrada, Reteste, Parcial, Trailing SL e TP)
    if (showOrderLines && openOrders.length > 0) {
      openOrders.forEach((o) => {
        const isPending = o.status === 'PENDING_LIMIT';
        const targetPrice = isPending && o.limitPrice ? o.limitPrice : o.entryPrice;
        const entryY = priceToY(targetPrice);

        // 1. Linha de Entrada / Reteste Limitado
        if (entryY >= 0 && entryY <= pricePaneHeight) {
          ctx.strokeStyle = isPending ? '#f59e0b' : o.type === 'BUY' ? '#10b981' : '#ef4444';
          ctx.lineWidth = 1.75;
          ctx.setLineDash(isPending ? [6, 4] : [4, 2]);
          ctx.beginPath();
          ctx.moveTo(0, entryY);
          ctx.lineTo(chartWidth, entryY);
          ctx.stroke();
          ctx.setLineDash([]);

          // Tag no início da linha (esquerda do gráfico)
          const leftTagText = isPending
            ? `⏳ RETESTE ${o.contracts}ct @ ${targetPrice.toLocaleString('pt-BR')}`
            : o.role === 'MAIN'
            ? `${o.type === 'BUY' ? '🟢 COMPRA MÃE (SURFE)' : '🔴 VENDA MÃE (SURFE)'} ${o.contracts}ct @ ${targetPrice.toLocaleString('pt-BR')}`
            : o.role === 'PYRAMID'
            ? `🔺 PIRÂMIDE #${o.pyramidLevel || 1} ${o.type} ${o.contracts}ct @ ${targetPrice.toLocaleString('pt-BR')} (ALVO +50p)`
            : `${o.type === 'BUY' ? '🟢 COMPRA' : '🔴 VENDA'} ${o.contracts}ct @ ${targetPrice.toLocaleString('pt-BR')}`;
          ctx.font = isMobile ? 'bold 7.5px "JetBrains Mono"' : 'bold 9px "JetBrains Mono"';
          const leftTagWidth = ctx.measureText(leftTagText).width + 12;

          ctx.fillStyle = isPending
            ? 'rgba(245, 158, 11, 0.92)'
            : o.role === 'MAIN'
            ? o.type === 'BUY'
              ? 'rgba(5, 150, 105, 0.95)'
              : 'rgba(220, 38, 38, 0.95)'
            : o.role === 'PYRAMID'
            ? 'rgba(14, 165, 233, 0.95)'
            : o.type === 'BUY'
            ? 'rgba(5, 150, 105, 0.92)'
            : 'rgba(220, 38, 38, 0.92)';
          const tagLeftX = entryY <= 56 ? 245 : 8;
          ctx.beginPath();
          ctx.roundRect(tagLeftX, entryY - 8.5, leftTagWidth, 17, 3);
          ctx.fill();
          ctx.fillStyle = '#ffffff';
          ctx.textAlign = 'left';
          ctx.fillText(leftTagText, tagLeftX + 6, entryY + 3.5);

          // Badge no eixo Y lateral direito
          ctx.fillStyle = isPending
            ? '#f59e0b'
            : o.role === 'PYRAMID'
            ? '#0284c7'
            : o.type === 'BUY'
            ? '#059669'
            : '#dc2626';
          ctx.beginPath();
          ctx.roundRect(chartWidth + 1, entryY - 8.5, rightAxisWidth - 2, 17, 2);
          ctx.fill();
          ctx.fillStyle = '#ffffff';
          ctx.font = isMobile ? 'bold 8px "JetBrains Mono"' : 'bold 9px "JetBrains Mono"';
          ctx.textAlign = 'center';
          ctx.fillText(
            isPending
              ? `LIM ${targetPrice}`
              : o.role === 'MAIN'
              ? `MÃE ${targetPrice}`
              : o.role === 'PYRAMID'
              ? `P${o.pyramidLevel || 1} ${targetPrice}`
              : `${o.type} ${targetPrice}`,
            chartWidth + rightAxisWidth / 2,
            entryY + 3.5
          );
        }

        // 2. Linha de Saída Parcial (+50 pts, apenas em estratégias clássicas, nunca na ordem mãe da pirâmide)
        if (enablePartialExit && o.role !== 'MAIN' && o.role !== 'PYRAMID' && !o.partialExecuted && o.contracts > 1 && !isPending) {
          const partialTarget =
            o.type === 'BUY' ? o.entryPrice + partialPoints : o.entryPrice - partialPoints;
          const partialY = priceToY(partialTarget);

          if (partialY >= 0 && partialY <= pricePaneHeight) {
            ctx.strokeStyle = '#06b6d4';
            ctx.lineWidth = 1.5;
            ctx.setLineDash([4, 4]);
            ctx.beginPath();
            ctx.moveTo(0, partialY);
            ctx.lineTo(chartWidth, partialY);
            ctx.stroke();
            ctx.setLineDash([]);

            // Tag à esquerda
            const parcTagText = `🎯 PARCIAL (+${partialPoints}p) @ ${partialTarget.toLocaleString('pt-BR')}`;
            ctx.font = isMobile ? 'bold 7.5px "JetBrains Mono"' : 'bold 8.5px "JetBrains Mono"';
            const parcTagWidth = ctx.measureText(parcTagText).width + 12;

            const parcTagX = partialY <= 56 ? 245 : 8;
            ctx.fillStyle = 'rgba(6, 182, 212, 0.92)';
            ctx.beginPath();
            ctx.roundRect(parcTagX, partialY - 8.5, parcTagWidth, 17, 3);
            ctx.fill();
            ctx.fillStyle = '#083344';
            ctx.textAlign = 'left';
            ctx.fillText(parcTagText, parcTagX + 6, partialY + 3.5);

            // Badge no eixo Y
            ctx.fillStyle = '#0891b2';
            ctx.beginPath();
            ctx.roundRect(chartWidth + 1, partialY - 8.5, rightAxisWidth - 2, 17, 2);
            ctx.fill();
            ctx.fillStyle = '#ffffff';
            ctx.font = isMobile ? 'bold 8px "JetBrains Mono"' : 'bold 9px "JetBrains Mono"';
            ctx.textAlign = 'center';
            ctx.fillText(`PARC ${partialTarget}`, chartWidth + rightAxisWidth / 2, partialY + 3.5);
          }
        }

        // 3. Stop Loss e Trailing Stop / Breakeven (apenas se configurado > 0)
        if (o.stopLoss > 0) {
          const isProtected = o.isBreakevenActive || (o.highestPriceSinceEntry && trailingStop);
          const slY = priceToY(o.stopLoss);

          if (slY >= 0 && slY <= pricePaneHeight) {
            ctx.strokeStyle = isProtected ? '#f59e0b' : '#ef4444';
            ctx.lineWidth = 1.5;
            ctx.setLineDash([4, 4]);
            ctx.beginPath();
            ctx.moveTo(0, slY);
            ctx.lineTo(chartWidth, slY);
            ctx.stroke();
            ctx.setLineDash([]);

            // Tag à esquerda
            const slTagText = isProtected
              ? `🛡️ SL BREAKEVEN (+5p) @ ${o.stopLoss.toLocaleString('pt-BR')}`
              : `🛑 STOP LOSS (-${Math.abs(o.entryPrice - o.stopLoss)}p) @ ${o.stopLoss.toLocaleString('pt-BR')}`;
            ctx.font = isMobile ? 'bold 7.5px "JetBrains Mono"' : 'bold 8.5px "JetBrains Mono"';
            const slTagWidth = ctx.measureText(slTagText).width + 12;
            const slTagX = slY <= 56 ? 245 : 8;

            ctx.fillStyle = isProtected ? 'rgba(217, 119, 6, 0.92)' : 'rgba(220, 38, 38, 0.92)';
            ctx.beginPath();
            ctx.roundRect(slTagX, slY - 8.5, slTagWidth, 17, 3);
            ctx.fill();
            ctx.fillStyle = '#ffffff';
            ctx.textAlign = 'left';
            ctx.fillText(slTagText, slTagX + 6, slY + 3.5);

            // Badge no eixo Y
            ctx.fillStyle = isProtected ? '#d97706' : '#dc2626';
            ctx.beginPath();
            ctx.roundRect(chartWidth + 1, slY - 8.5, rightAxisWidth - 2, 17, 2);
            ctx.fill();
            ctx.fillStyle = '#ffffff';
            ctx.font = isMobile ? 'bold 8px "JetBrains Mono"' : 'bold 9px "JetBrains Mono"';
            ctx.textAlign = 'center';
            ctx.fillText(
              isProtected ? `SL(BE) ${o.stopLoss}` : `SL ${o.stopLoss}`,
              chartWidth + rightAxisWidth / 2,
              slY + 3.5
            );
          } else if (slY > pricePaneHeight) {
            // Indicador fixado na borda inferior do painel se o SL estiver fora da tela
            ctx.fillStyle = 'rgba(220, 38, 38, 0.85)';
            ctx.beginPath();
            ctx.roundRect(chartWidth + 1, pricePaneHeight - 17, rightAxisWidth - 2, 16, 2);
            ctx.fill();
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 8px "JetBrains Mono"';
            ctx.textAlign = 'center';
            ctx.fillText(`▼ SL ${o.stopLoss}`, chartWidth + rightAxisWidth / 2, pricePaneHeight - 5.5);
          }
        }

        // 4. Take Profit (apenas se configurado > 0)
        if (o.takeProfit > 0) {
          const tpY = priceToY(o.takeProfit);
          if (tpY >= 0 && tpY <= pricePaneHeight) {
            ctx.strokeStyle = '#10b981';
            ctx.lineWidth = 1.5;
            ctx.setLineDash([4, 4]);
            ctx.beginPath();
            ctx.moveTo(0, tpY);
            ctx.lineTo(chartWidth, tpY);
            ctx.stroke();
            ctx.setLineDash([]);

            // Tag à esquerda
            const tpTagText = o.role === 'PYRAMID'
              ? `🎯 ALVO PIRÂMIDE #${o.pyramidLevel || 1} (+50p TP) @ ${o.takeProfit.toLocaleString('pt-BR')}`
              : `🏁 TAKE PROFIT (+${Math.abs(o.takeProfit - o.entryPrice)}p) @ ${o.takeProfit.toLocaleString('pt-BR')}`;
            ctx.font = isMobile ? 'bold 7.5px "JetBrains Mono"' : 'bold 8.5px "JetBrains Mono"';
            const tpTagWidth = ctx.measureText(tpTagText).width + 12;
            const tpTagX = tpY <= 56 ? 245 : 8;

            ctx.fillStyle = o.role === 'PYRAMID' ? 'rgba(14, 165, 233, 0.95)' : 'rgba(5, 150, 105, 0.92)';
            ctx.beginPath();
            ctx.roundRect(tpTagX, tpY - 8.5, tpTagWidth, 17, 3);
            ctx.fill();
            ctx.fillStyle = '#ffffff';
            ctx.textAlign = 'left';
            ctx.fillText(tpTagText, tpTagX + 6, tpY + 3.5);

            // Badge no eixo Y
            ctx.fillStyle = o.role === 'PYRAMID' ? '#0284c7' : '#059669';
            ctx.beginPath();
            ctx.roundRect(chartWidth + 1, tpY - 8.5, rightAxisWidth - 2, 17, 2);
            ctx.fill();
            ctx.fillStyle = '#ffffff';
            ctx.font = isMobile ? 'bold 8px "JetBrains Mono"' : 'bold 9px "JetBrains Mono"';
            ctx.textAlign = 'center';
            ctx.fillText(
              o.role === 'PYRAMID' ? `ALVO +50p ${o.takeProfit}` : `TP ${o.takeProfit}`,
              chartWidth + rightAxisWidth / 2,
              tpY + 3.5
            );
          } else if (tpY < 0) {
            // Indicador fixado na borda superior se o TP estiver acima do campo visível
            ctx.fillStyle = o.role === 'PYRAMID' ? 'rgba(14, 165, 233, 0.9)' : 'rgba(5, 150, 105, 0.85)';
            ctx.beginPath();
            ctx.roundRect(chartWidth + 1, 2, rightAxisWidth - 2, 16, 2);
            ctx.fill();
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 8px "JetBrains Mono"';
            ctx.textAlign = 'center';
            ctx.fillText(
              o.role === 'PYRAMID' ? `▲ ALVO P${o.pyramidLevel || 1}` : `▲ TP ${o.takeProfit}`,
              chartWidth + rightAxisWidth / 2,
              13.5
            );
          }
        }
      });
    }

    // =======================================================================
    // CROSSHAIR INTERATIVO & LEITURA DIRETA DO PREÇO NO EIXO Y
    // =======================================================================
    if (mousePos && mousePos.x < chartWidth) {
      const hoverItem = boxPositions.reduce((prev, curr) => {
        return Math.abs(curr.x - mousePos.x) < Math.abs(prev.x - mousePos.x) ? curr : prev;
      }, boxPositions[0]);

      if (hoverItem) {
        ctx.strokeStyle = 'rgba(148, 163, 184, 0.35)';
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(hoverItem.x, 0);
        ctx.lineTo(hoverItem.x, height);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(0, mousePos.y);
        ctx.lineTo(chartWidth, mousePos.y);
        ctx.stroke();
        ctx.setLineDash([]);

        // Badge de preço flutuante na régua do eixo Y
        if (mousePos.y <= pricePaneHeight) {
          const hoveredPrice = Math.round(yToPrice(mousePos.y) / 5) * 5;
          ctx.fillStyle = '#1e293b';
          ctx.fillRect(chartWidth + 1, mousePos.y - 8, rightAxisWidth - 2, 16);
          ctx.strokeStyle = '#64748b';
          ctx.strokeRect(chartWidth + 1, mousePos.y - 8, rightAxisWidth - 2, 16);
          ctx.fillStyle = '#f8fafc';
          ctx.font = isMobile ? 'bold 8.5px "JetBrains Mono"' : 'bold 9.5px "JetBrains Mono"';
          ctx.textAlign = 'center';
          ctx.fillText(
            hoveredPrice.toLocaleString('pt-BR'),
            chartWidth + rightAxisWidth / 2,
            mousePos.y + 3.5
          );
        } else {
          // Leitura flutuante na régua lateral da Janela de Fluxo
          ctx.fillStyle = '#1e293b';
          ctx.fillRect(chartWidth + 1, mousePos.y - 8, rightAxisWidth - 2, 16);
          ctx.strokeStyle = '#64748b';
          ctx.strokeRect(chartWidth + 1, mousePos.y - 8, rightAxisWidth - 2, 16);
          ctx.fillStyle = '#f8fafc';
          ctx.font = isMobile ? 'bold 7.5px "JetBrains Mono"' : 'bold 8.5px "JetBrains Mono"';
          ctx.textAlign = 'center';

          if (flowViewMode === 'heikin_ashi' || flowViewMode === 'hybrid') {
            const pct = (height - 14 - mousePos.y) / (flowPaneHeight - 28);
            const hoveredFlow = Math.round(effectiveMinFlowHa + pct * effectiveHaRange);
            const sign = hoveredFlow > 0 ? '+' : '';
            const txt =
              Math.abs(hoveredFlow) >= 1000
                ? `${sign}${(hoveredFlow / 1000).toFixed(1)}k`
                : `${sign}${hoveredFlow}`;
            ctx.fillText(txt, chartWidth + rightAxisWidth / 2, mousePos.y + 3.5);
          } else {
            const centerY = deltaToY(0);
            const usableH = (flowPaneHeight - 28) / 2;
            const hoveredDelta = Math.round(-((mousePos.y - centerY) / usableH) * effectiveMaxAbsDelta);
            ctx.fillText(
              `${hoveredDelta > 0 ? '+' : ''}${hoveredDelta}Δ`,
              chartWidth + rightAxisWidth / 2,
              mousePos.y + 3.5
            );
          }
        }
      }
    }
  }, [
    allBoxes,
    currentPrice,
    visibleCount,
    scrollOffset,
    scaleX,
    scaleY,
    scaleFlow,
    flowPaneRatio,
    flowPanOffset,
    pricePanOffset,
    flowViewMode,
    mousePos,
    minDeltaThreshold,
    openOrders,
    showOrderLines,
    boxThickness,
    spacingMode,
    rightMargin,
    currentBox,
    enablePartialExit,
    partialPoints,
    partialContracts,
    trailingStop,
  ]);

  // =========================================================================
  // MANIPULAÇÃO DE MOUSE: DIVISOR, ESCALAS E EIXOS (PREÇO, TEMPO E FLUXO)
  // =========================================================================
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const isMobile = rect.width < 640;
    const rightAxisWidth = isMobile ? 54 : 80;
    const chartW = rect.width - rightAxisWidth;
    const clampedRatio = Math.max(0.18, Math.min(0.55, flowPaneRatio));
    const flowPaneH = rect.height * clampedRatio;
    const pricePaneH = rect.height - flowPaneH;

    // 1. Clique no divisor entre o gráfico de preço e a janela de fluxo
    if (Math.abs(y - pricePaneH) <= 8 && x < chartW) {
      setDragMode('DIVIDER');
      setDragStartY(e.clientY);
      setDragStartFlowRatio(flowPaneRatio);
      setIsDragging(true);
      return;
    }

    if (x >= chartW) {
      if (y > pricePaneH) {
        // 2. Clique na régua lateral da janela de fluxo: arrasta escala do Fluxo (Heikin-Ashi/Delta)
        setDragMode('FLOW_AXIS');
        setDragStartY(e.clientY);
        setDragStartScaleFlow(scaleFlow);
        setDragStartFlowPanOffset(flowPanOffset);
        setIsDragging(true);
      } else {
        // 3. Clique na régua lateral de preços: arrasta escala Y do Renko
        setDragMode('Y_AXIS');
        setDragStartY(e.clientY);
        setDragStartScaleY(scaleY);
        setDragStartPanOffset(pricePanOffset);
        setIsDragging(true);
      }
    } else if (y >= rect.height - 24) {
      // 4. Clique no rodapé: arrasta a escala do Eixo X
      setDragMode('X_AXIS');
      setDragStartX(e.clientX);
      setDragStartScaleX(scaleX);
      setDragStartScroll(scrollOffset);
      setIsDragging(true);
    } else {
      // 5. Clique no corpo do gráfico: Pan horizontal ou vertical (com Shift)
      setDragMode('CHART');
      setIsDragging(true);
      setDragStartX(e.clientX);
      setDragStartY(e.clientY);
      setDragStartScroll(scrollOffset);
      setDragStartPanOffset(pricePanOffset);
      setDragStartFlowPanOffset(flowPanOffset);
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    setMousePos({ x, y });

    if (boxPositionsRef.current.length > 0) {
      const hoverItem = boxPositionsRef.current.reduce((prev, curr) => {
        return Math.abs(curr.x - x) < Math.abs(prev.x - x) ? curr : prev;
      }, boxPositionsRef.current[0]);

      if (hoverItem && Math.abs(hoverItem.x - x) < 30) {
        setHoveredBox(hoverItem.box);
      } else {
        setHoveredBox(null);
      }
    }

    if (isDragging) {
      if (dragMode === 'DIVIDER') {
        const deltaY = e.clientY - dragStartY;
        // Arrastar para cima aumenta a altura do fluxo; arrastar para baixo reduz
        const newRatio = Math.max(0.18, Math.min(0.55, dragStartFlowRatio - deltaY / rect.height));
        setFlowPaneRatio(Number(newRatio.toFixed(3)));
      } else if (dragMode === 'FLOW_AXIS') {
        const deltaY = e.clientY - dragStartY;
        if (e.shiftKey) {
          // Deslocamento vertical do fluxo (Pan)
          setFlowPanOffset(dragStartFlowPanOffset + deltaY * 4);
        } else {
          // Zoom vertical do fluxo
          const factor = Math.exp(-deltaY * 0.009);
          const newScaleFlow = Math.max(0.25, Math.min(4.0, dragStartScaleFlow * factor));
          setScaleFlow(Number(newScaleFlow.toFixed(2)));
        }
      } else if (dragMode === 'Y_AXIS') {
        const deltaY = e.clientY - dragStartY;
        if (e.shiftKey) {
          // Deslocamento vertical puro
          setPricePanOffset(dragStartPanOffset + deltaY * 1.5);
        } else {
          // Estica ou comprime a escala Y proporcionalmente
          const factor = Math.exp(-deltaY * 0.008);
          const newScaleY = Math.max(0.25, Math.min(4.0, dragStartScaleY * factor));
          setScaleY(newScaleY);
        }
      } else if (dragMode === 'X_AXIS') {
        const deltaX = e.clientX - dragStartX;
        const factor = Math.exp(deltaX * 0.006);
        const newScaleX = Math.max(0.5, Math.min(3.5, dragStartScaleX * factor));
        setScaleX(newScaleX);
      } else if (dragMode === 'CHART') {
        const deltaX = e.clientX - dragStartX;
        const offsetDelta = deltaX / (22 * scaleX);
        const maxScroll = Math.max(0, allBoxes.length - 2);
        setScrollOffset(Math.max(0, Math.min(maxScroll, dragStartScroll + offsetDelta)));

        if (e.shiftKey) {
          const deltaY = e.clientY - dragStartY;
          setPricePanOffset(dragStartPanOffset + deltaY * 1.2);
          setFlowPanOffset(dragStartFlowPanOffset + deltaY * 3);
        }
      }
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
    setDragMode(null);
  };

  const handleMouseLeave = () => {
    setMousePos(null);
    setIsDragging(false);
    setDragMode(null);
    setHoveredBox(null);
  };

  const handleDoubleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const isMobile = rect.width < 640;
    const rightAxisWidth = isMobile ? 54 : 80;
    const chartW = rect.width - rightAxisWidth;
    const clampedRatio = Math.max(0.18, Math.min(0.55, flowPaneRatio));
    const flowPaneH = rect.height * clampedRatio;
    const pricePaneH = rect.height - flowPaneH;

    if (Math.abs(y - pricePaneH) <= 8 && x < chartW) {
      // Duplo clique no divisor: reseta para altura padrão de 33%
      setFlowPaneRatio(0.33);
    } else if (x >= chartW) {
      if (y > pricePaneH) {
        // Duplo clique na régua da janela de fluxo: reseta escala e pan do fluxo!
        setScaleFlow(1.0);
        setFlowPanOffset(0);
      } else {
        // Duplo clique na régua Y: reseta auto-escala vertical!
        setScaleY(1.0);
        setPricePanOffset(0);
      }
    } else if (y >= rect.height - 24) {
      // Duplo clique na régua X: reseta escala horizontal!
      setScaleX(1.0);
      setScrollOffset(0);
    } else {
      // Duplo clique geral no gráfico: auto-escala total!
      handleResetAllScales();
    }
  };

  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const isMobile = rect.width < 640;
    const rightAxisWidth = isMobile ? 54 : 80;
    const chartW = rect.width - rightAxisWidth;
    const clampedRatio = Math.max(0.18, Math.min(0.55, flowPaneRatio));
    const flowPaneH = rect.height * clampedRatio;
    const pricePaneH = rect.height - flowPaneH;

    if (x >= chartW) {
      if (y > pricePaneH) {
        // Roda na régua de fluxo: zoom vertical do fluxo!
        const zoomFactor = e.deltaY < 0 ? 1.08 : 0.92;
        setScaleFlow((prev) => Math.max(0.25, Math.min(4.0, Number((prev * zoomFactor).toFixed(2)))));
      } else {
        // Roda na régua de preços: zoom vertical de preços!
        const zoomFactor = e.deltaY < 0 ? 1.08 : 0.92;
        setScaleY((prev) => Math.max(0.25, Math.min(4.0, prev * zoomFactor)));
      }
    } else if (e.altKey) {
      // Alt + roda no gráfico: se cursor estiver no painel de fluxo, ajusta fluxo; senão preço
      const zoomFactor = e.deltaY < 0 ? 1.08 : 0.92;
      if (y > pricePaneH) {
        setScaleFlow((prev) => Math.max(0.25, Math.min(4.0, Number((prev * zoomFactor).toFixed(2)))));
      } else {
        setScaleY((prev) => Math.max(0.25, Math.min(4.0, prev * zoomFactor)));
      }
    } else if (e.shiftKey) {
      // Shift + roda: pan horizontal
      setScrollOffset((prev) => Math.max(0, prev - (e.deltaY > 0 ? 2 : -2)));
    } else if (e.ctrlKey) {
      // Ctrl + roda: zoom fino na escala X
      const zoomFactor = e.deltaY < 0 ? 1.08 : 0.92;
      setScaleX((prev) => Math.max(0.5, Math.min(3.5, prev * zoomFactor)));
    } else {
      // Roda normal no gráfico: ajusta zoom horizontal e densidade dos blocos
      if (e.deltaY < 0) {
        setScaleX((prev) => Math.min(3.5, prev * 1.05));
        setVisibleCount((prev) => Math.max(14, prev - 2));
      } else {
        setScaleX((prev) => Math.max(0.5, prev * 0.95));
        setVisibleCount((prev) => Math.min(100, prev + 2));
      }
    }
  };

  // =========================================================================
  // GESTOS DE TOUCH (CELULARES & TABLETS): PINCH MULTI-EIXO
  // =========================================================================
  const handleTouchStart = (e: React.TouchEvent<HTMLCanvasElement>) => {
    if (e.touches.length === 1) {
      const touch = e.touches[0];
      const rect = e.currentTarget.getBoundingClientRect();
      const x = touch.clientX - rect.left;
      const y = touch.clientY - rect.top;
      setMousePos({ x, y });
      touchStartRef.current = {
        x: touch.clientX,
        y: touch.clientY,
        scroll: scrollOffset,
        panY: pricePanOffset,
      };

      if (boxPositionsRef.current.length > 0) {
        const hoverItem = boxPositionsRef.current.reduce((prev, curr) => {
          return Math.abs(curr.x - x) < Math.abs(prev.x - x) ? curr : prev;
        }, boxPositionsRef.current[0]);
        if (hoverItem && Math.abs(hoverItem.x - x) < 35) {
          setHoveredBox(hoverItem.box);
        }
      }
    } else if (e.touches.length === 2) {
      const dx = Math.abs(e.touches[0].clientX - e.touches[1].clientX);
      const dy = Math.abs(e.touches[0].clientY - e.touches[1].clientY);
      const dist = Math.sqrt(dx * dx + dy * dy);
      touchStartRef.current = {
        ...touchStartRef.current,
        distX: dx,
        distY: dy,
        dist,
      };
    }
  };

  const handleTouchMove = (e: React.TouchEvent<HTMLCanvasElement>) => {
    if (e.touches.length === 1) {
      const touch = e.touches[0];
      const deltaX = touch.clientX - touchStartRef.current.x;
      const offsetDelta = deltaX / (20 * scaleX);
      const maxScroll = Math.max(0, allBoxes.length - 2);
      setScrollOffset(Math.max(0, Math.min(maxScroll, touchStartRef.current.scroll + offsetDelta)));

      const rect = e.currentTarget.getBoundingClientRect();
      const x = touch.clientX - rect.left;
      const y = touch.clientY - rect.top;
      setMousePos({ x, y });

      if (boxPositionsRef.current.length > 0) {
        const hoverItem = boxPositionsRef.current.reduce((prev, curr) => {
          return Math.abs(curr.x - x) < Math.abs(prev.x - x) ? curr : prev;
        }, boxPositionsRef.current[0]);
        if (hoverItem && Math.abs(hoverItem.x - x) < 35) {
          setHoveredBox(hoverItem.box);
        }
      }
    } else if (e.touches.length === 2) {
      const dx = Math.abs(e.touches[0].clientX - e.touches[1].clientX);
      const dy = Math.abs(e.touches[0].clientY - e.touches[1].clientY);

      // Pinch vertical no celular ajusta escala Y; pinch horizontal ajusta escala X
      if (dy > dx * 1.3 && touchStartRef.current.distY) {
        const diffY = dy - touchStartRef.current.distY;
        if (Math.abs(diffY) > 6) {
          setScaleY((prev) => Math.max(0.25, Math.min(4.0, prev * (diffY > 0 ? 1.04 : 0.96))));
          touchStartRef.current.distY = dy;
        }
      } else if (touchStartRef.current.distX) {
        const diffX = dx - touchStartRef.current.distX;
        if (Math.abs(diffX) > 6) {
          setScaleX((prev) => Math.max(0.35, Math.min(3.5, prev * (diffX > 0 ? 1.04 : 0.96))));
          touchStartRef.current.distX = dx;
        }
      }
    }
  };

  const handleResetAllScales = () => {
    setScaleY(1.0);
    setPricePanOffset(0);
    setScaleX(1.0);
    setScrollOffset(0);
    setScaleFlow(1.0);
    setFlowPanOffset(0);
    setFlowPaneRatio(0.33);
    setVisibleCount(typeof window !== 'undefined' && window.innerWidth < 640 ? 26 : 40);
  };

  const isCustomScaled =
    scaleY !== 1.0 ||
    pricePanOffset !== 0 ||
    scaleX !== 1.0 ||
    scaleFlow !== 1.0 ||
    flowPanOffset !== 0 ||
    Math.abs(flowPaneRatio - 0.33) > 0.02;

  // Determina classe de cursor baseada na área
  const getCursorClass = () => {
    if (dragMode === 'DIVIDER') return 'cursor-row-resize';
    if (dragMode === 'FLOW_AXIS' || dragMode === 'Y_AXIS') return 'cursor-ns-resize';
    if (dragMode === 'X_AXIS') return 'cursor-ew-resize';
    if (dragMode === 'CHART') return 'cursor-grabbing';
    if (mousePos && canvasRef.current) {
      const isMobile = canvasRef.current.clientWidth < 640;
      const rightAxisWidth = isMobile ? 54 : 80;
      const chartW = canvasRef.current.clientWidth - rightAxisWidth;
      const canvasH = canvasRef.current.clientHeight;
      const clampedRatio = Math.max(0.18, Math.min(0.55, flowPaneRatio));
      const flowPaneH = canvasH * clampedRatio;
      const pricePaneH = canvasH - flowPaneH;

      if (Math.abs(mousePos.y - pricePaneH) <= 7 && mousePos.x < chartW) {
        return 'cursor-row-resize';
      }
      if (mousePos.x >= chartW) return 'cursor-ns-resize';
      if (mousePos.y >= canvasH - 24) return 'cursor-ew-resize';
    }
    return isDragging ? 'cursor-grabbing' : 'cursor-crosshair';
  };

  // Cálculo do PnL em tempo real das ordens abertas para exibição na boleta compacta
  const openPnL = useMemo(() => {
    if (!openOrders || openOrders.length === 0) {
      return { points: 0, financial: 0, openCount: 0, mainCount: 0, pyramidCount: 0 };
    }
    let ptsTotal = 0;
    let finTotal = 0;
    let openCount = 0;
    let mainCount = 0;
    let pyramidCount = 0;

    openOrders.forEach((o) => {
      if (o.status === 'OPEN') {
        const pts = o.type === 'BUY' ? currentPrice - o.entryPrice : o.entryPrice - currentPrice;
        const ctros = o.remainingContracts ?? o.contracts ?? 1;
        ptsTotal += pts;
        finTotal += pts * 0.2 * ctros;
        openCount++;
        if (o.role === 'MAIN') mainCount++;
        if (o.role === 'PYRAMID') pyramidCount++;
      }
    });

    return { points: ptsTotal, financial: finTotal, openCount, mainCount, pyramidCount };
  }, [openOrders, currentPrice]);

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full flex flex-col bg-slate-950 select-none overflow-hidden"
    >
      {/* ========================================================================= */}
      {/* BARRA DE FERRAMENTAS SUPERIOR                                             */}
      {/* ========================================================================= */}
      <div className="flex items-center justify-between gap-2 px-2.5 sm:px-4 py-1.5 sm:py-2 bg-slate-900/95 border-b border-slate-800 text-xs shrink-0 overflow-x-auto no-scrollbar">
        <div className="flex items-center gap-2 shrink-0">
          <div className="flex items-center gap-1 font-mono text-[11px] sm:text-xs">
            <span className="text-slate-400">10R:</span>
            <span className="font-semibold text-emerald-400">{boxes.length} blk</span>
          </div>

          <div className="h-3.5 w-[1px] bg-slate-800" />

          {/* PnL em Tempo Real no Top Toolbar */}
          <div
            className={`flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-mono font-bold border transition-colors ${
              openPnL.openCount > 0
                ? openPnL.financial > 0
                  ? 'bg-emerald-950/90 border-emerald-500/50 text-emerald-300'
                  : openPnL.financial < 0
                  ? 'bg-rose-950/90 border-rose-500/50 text-rose-300'
                  : 'bg-slate-900/90 border-slate-700 text-slate-300'
                : 'bg-slate-950/50 border-slate-800 text-slate-400'
            }`}
            title="Resultado flutuante acumulado das operações abertas"
          >
            <span className="text-[9.5px] text-slate-400 font-sans uppercase">PnL:</span>
            <span className="font-extrabold text-[11.5px]">
              {openPnL.financial > 0 ? '+' : ''}
              {openPnL.financial.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
            </span>
            <span
              className={`text-[9.5px] px-1 py-0.2 rounded font-semibold ${
                openPnL.points > 0
                  ? 'bg-emerald-500/20 text-emerald-300'
                  : openPnL.points < 0
                  ? 'bg-rose-500/20 text-rose-300'
                  : 'bg-slate-800 text-slate-400'
              }`}
            >
              {openPnL.points > 0 ? '+' : ''}
              {openPnL.points} pts
            </span>
          </div>

          <div className="h-3.5 w-[1px] bg-slate-800" />

          {/* Seletor do Modo de Exibição do Painel de Fluxo */}
          <div className="flex items-center gap-0.5 bg-slate-950/90 p-0.5 rounded border border-slate-800 shrink-0">
            <button
              onClick={() => setFlowViewMode('heikin_ashi')}
              className={`px-1.5 sm:px-2 py-0.5 rounded text-[10px] sm:text-[11px] font-semibold transition-colors cursor-pointer flex items-center gap-1 ${
                flowViewMode === 'heikin_ashi'
                  ? 'bg-purple-500/25 text-purple-300 border border-purple-500/40'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              title="Exibir Fluxo como Candles Heikin-Ashi (Verde = Subida, Vermelho = Descida, Cinza = Reversão)"
            >
              <Activity className="w-3 h-3 text-purple-400" />
              <span>Heikin-Ashi</span>
            </button>
            <button
              onClick={() => setFlowViewMode('histogram')}
              className={`px-1.5 sm:px-2 py-0.5 rounded text-[10px] sm:text-[11px] font-semibold transition-colors cursor-pointer flex items-center gap-1 ${
                flowViewMode === 'histogram'
                  ? 'bg-sky-500/25 text-sky-300 border border-sky-500/40'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              title="Exibir Histograma de Delta Tradicional"
            >
              <BarChart2 className="w-3 h-3 text-sky-400" />
              <span>Delta</span>
            </button>
            <button
              onClick={() => setFlowViewMode('hybrid')}
              className={`hidden sm:inline-flex items-center gap-1 px-1.5 sm:px-2 py-0.5 rounded text-[10px] sm:text-[11px] font-semibold transition-colors cursor-pointer ${
                flowViewMode === 'hybrid'
                  ? 'bg-emerald-500/25 text-emerald-300 border border-emerald-500/40'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              title="Exibir Heikin-Ashi sobreposto ao Histograma de Delta"
            >
              <span>Híbrido</span>
            </button>
          </div>

          <div className="h-3.5 w-[1px] bg-slate-800 hidden sm:block" />

          {/* Seletor de Espessura dos Tijolos */}
          <div className="hidden sm:flex items-center gap-0.5 bg-slate-950/90 p-0.5 rounded border border-slate-800 shrink-0">
            <button
              onClick={() => setBoxThickness('thin')}
              className={`px-1.5 sm:px-2 py-0.5 rounded text-[10px] sm:text-[11px] font-semibold transition-colors cursor-pointer ${
                boxThickness === 'thin'
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              title="Tijolos Finos (10px)"
            >
              Fino
            </button>
            <button
              onClick={() => setBoxThickness('ultrathin')}
              className={`px-1.5 sm:px-2 py-0.5 rounded text-[10px] sm:text-[11px] font-semibold transition-colors cursor-pointer ${
                boxThickness === 'ultrathin'
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              title="Tijolos Ultra-Finos (7px)"
            >
              Ultra
            </button>
          </div>

          {/* Modo de Espaçamento Dinâmico */}
          <button
            onClick={() => setSpacingMode((prev) => (prev === 'dynamic' ? 'fixed' : 'dynamic'))}
            className={`hidden lg:flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-medium transition-colors border cursor-pointer shrink-0 ${
              spacingMode === 'dynamic'
                ? 'bg-sky-500/15 text-sky-300 border-sky-500/30'
                : 'bg-slate-900 text-slate-400 border-slate-800'
            }`}
            title="Aproximação progressiva temporal dos tijolos"
          >
            <Sparkles className="w-3 h-3 text-sky-400" />
            <span>{spacingMode === 'dynamic' ? 'Aproximação Temporal' : 'Fixo'}</span>
          </button>
        </div>

        {/* CONTROLES DE AJUSTE DE ESCALA X E Y DO OPERADOR */}
        <div className="flex items-center gap-1 sm:gap-2 shrink-0 bg-slate-950/80 p-0.5 rounded-lg border border-slate-800">
          {/* Controle da Escala Y (Preço/Vertical) */}
          <div
            className="flex items-center gap-0.5 px-1 py-0.5 rounded bg-slate-900/60 border border-slate-800/80"
            title="Ajuste fino da Escala Y (Preços / Altura dos Boxes). Dica: você também pode arrastar a régua de preços na lateral!"
          >
            <span className="text-[10px] font-bold text-slate-500 mr-0.5">Y</span>
            <button
              onClick={() => setScaleY((prev) => Math.max(0.25, Number((prev - 0.15).toFixed(2))))}
              className="px-1.5 py-0.5 rounded text-[10px] font-bold text-slate-300 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
              title="Comprimir Escala Y (mais pontos na tela)"
            >
              -
            </button>
            <button
              onClick={() => {
                setScaleY(1.0);
                setPricePanOffset(0);
              }}
              className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-bold transition-colors cursor-pointer ${
                scaleY !== 1.0 || pricePanOffset !== 0
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              title="Clique para resetar Escala Y para 100% (Auto)"
            >
              {Math.round(scaleY * 100)}%
            </button>
            <button
              onClick={() => setScaleY((prev) => Math.min(4.0, Number((prev + 0.15).toFixed(2))))}
              className="px-1.5 py-0.5 rounded text-[10px] font-bold text-slate-300 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
              title="Esticar Escala Y (boxes mais altos)"
            >
              +
            </button>
          </div>

          {/* Controle da Escala X (Tempo/Espaçamento Horizontal) */}
          <div
            className="flex items-center gap-0.5 px-1 py-0.5 rounded bg-slate-900/60 border border-slate-800/80"
            title="Ajuste fino da Escala X (Tempo / Espaçamento dos Tijolos)"
          >
            <span className="text-[10px] font-bold text-slate-500 mr-0.5">X</span>
            <button
              onClick={() => setScaleX((prev) => Math.max(0.5, Number((prev - 0.15).toFixed(2))))}
              className="px-1.5 py-0.5 rounded text-[10px] font-bold text-slate-300 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
              title="Comprimir Escala X (boxes mais compactos)"
            >
              -
            </button>
            <button
              onClick={() => {
                setScaleX(1.0);
                setScrollOffset(0);
              }}
              className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-bold transition-colors cursor-pointer ${
                scaleX !== 1.0
                  ? 'bg-sky-500/20 text-sky-300 border border-sky-500/40'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              title="Clique para resetar Escala X para 100% (Auto)"
            >
              {Math.round(scaleX * 100)}%
            </button>
            <button
              onClick={() => setScaleX((prev) => Math.min(3.5, Number((prev + 0.15).toFixed(2))))}
              className="px-1.5 py-0.5 rounded text-[10px] font-bold text-slate-300 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
              title="Expandir Escala X (boxes mais arejados)"
            >
              +
            </button>
          </div>

          {/* Controle da Escala do Fluxo (Vertical) */}
          <div
            className="flex items-center gap-0.5 px-1 py-0.5 rounded bg-slate-900/60 border border-slate-800/80"
            title="Ajuste fino da Escala Vertical do Fluxo. Dica: você também pode arrastar a régua lateral do fluxo!"
          >
            <span className="text-[10px] font-bold text-purple-400 mr-0.5">Fluxo</span>
            <button
              onClick={() => setScaleFlow((prev) => Math.max(0.25, Number((prev - 0.15).toFixed(2))))}
              className="px-1.5 py-0.5 rounded text-[10px] font-bold text-slate-300 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
              title="Comprimir Escala do Fluxo (mais candles/amplitude na tela)"
            >
              -
            </button>
            <button
              onClick={() => {
                setScaleFlow(1.0);
                setFlowPanOffset(0);
              }}
              className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-bold transition-colors cursor-pointer ${
                scaleFlow !== 1.0 || flowPanOffset !== 0
                  ? 'bg-purple-500/20 text-purple-300 border border-purple-500/40'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              title="Clique para resetar Escala do Fluxo para 100%"
            >
              {Math.round(scaleFlow * 100)}%
            </button>
            <button
              onClick={() => setScaleFlow((prev) => Math.min(4.0, Number((prev + 0.15).toFixed(2))))}
              className="px-1.5 py-0.5 rounded text-[10px] font-bold text-slate-300 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
              title="Esticar Escala do Fluxo (candles/barras mais altas)"
            >
              +
            </button>
          </div>

          {/* Presets de Altura da Janela de Fluxo (Divisor) */}
          <div
            className="hidden sm:flex items-center gap-0.5 px-1 py-0.5 rounded bg-slate-900/60 border border-slate-800/80"
            title="Ajuste rápido da Altura da Janela de Fluxo (ou arraste a barra divisora entre os painéis)"
          >
            <span className="text-[10px] font-bold text-slate-500 mr-0.5">Janela</span>
            <button
              onClick={() => setFlowPaneRatio(0.25)}
              className={`px-1.5 py-0.5 rounded text-[9.5px] font-bold transition-colors cursor-pointer ${
                Math.abs(flowPaneRatio - 0.25) < 0.04
                  ? 'bg-sky-500/20 text-sky-300 border border-sky-500/40'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              title="Janela de Fluxo Compacta (25% da tela)"
            >
              25%
            </button>
            <button
              onClick={() => setFlowPaneRatio(0.33)}
              className={`px-1.5 py-0.5 rounded text-[9.5px] font-bold transition-colors cursor-pointer ${
                Math.abs(flowPaneRatio - 0.33) < 0.04
                  ? 'bg-sky-500/20 text-sky-300 border border-sky-500/40'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              title="Janela de Fluxo Equilibrada (33% da tela)"
            >
              33%
            </button>
            <button
              onClick={() => setFlowPaneRatio(0.46)}
              className={`px-1.5 py-0.5 rounded text-[9.5px] font-bold transition-colors cursor-pointer ${
                Math.abs(flowPaneRatio - 0.46) < 0.04
                  ? 'bg-sky-500/20 text-sky-300 border border-sky-500/40'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              title="Janela de Fluxo Expandida (46% da tela)"
            >
              46%
            </button>
          </div>

          {/* Botão de Centralização / Auto-Escala Completa */}
          <button
            onClick={handleResetAllScales}
            className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold transition-colors cursor-pointer ${
              isCustomScaled
                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
            }`}
            title="Auto-Ajustar Todas as Escalas (Preço, Tempo, Fluxo e Divisor)"
          >
            <Target className="w-3 h-3 text-emerald-400" />
            <span className="hidden sm:inline">Auto</span>
          </button>

          {/* Toggle Visibilidade das Linhas de Ordens (Entrada, Reteste, SL, TP, Parcial) */}
          <button
            onClick={() => setShowOrderLines((prev) => !prev)}
            className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold transition-colors cursor-pointer ${
              showOrderLines
                ? 'bg-sky-500/20 text-sky-300 border border-sky-500/40'
                : 'text-slate-500 hover:text-slate-300 bg-slate-900 border border-slate-800'
            }`}
            title="Alternar visibilidade das linhas de ordens (Entrada, SL, TP e Parcial)"
          >
            <Layers className="w-3 h-3 text-sky-400" />
            <span className="hidden md:inline">Linhas:</span>
            <span className="font-mono">{showOrderLines ? `(${openOrders.length})` : 'Off'}</span>
          </button>
        </div>

        {/* Status de Posição / Feedback no Topo */}
        <div className="flex items-center gap-1.5 shrink-0 text-[11px] font-mono">
          {openOrders.length > 0 ? (
            <div className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-sky-950/80 border border-sky-500/40 text-sky-300">
              <span className="w-1.5 h-1.5 rounded-full bg-sky-400 animate-pulse" />
              <span>{openOrders.length} Pos Ativa(s)</span>
            </div>
          ) : (
            <span className="text-slate-500 text-[10px] hidden sm:inline">Aguardando Sinal</span>
          )}
        </div>
      </div>

      {/* ========================================================================= */}
      {/* CANVAS PRINCIPAL COM HIT-TESTING, GESTOS E WIDGET DE ESCALA               */}
      {/* ========================================================================= */}
      <div className="relative flex-1 w-full min-h-[300px]">
        <canvas
          ref={canvasRef}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseLeave}
          onDoubleClick={handleDoubleClick}
          onWheel={handleWheel}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleMouseUp}
          className={`absolute inset-0 w-full h-full ${getCursorClass()} touch-none`}
        />

        {/* ========================================================================= */}
        {/* BOLETA RÁPIDA APENAS COM COMPRA, VENDA E ZERAR (SEM SOBREPOSIÇÃO)          */}
        {/* ========================================================================= */}
        {onManualOrder && (
          <div className="absolute top-2.5 left-2.5 z-30 flex items-center gap-1.5 bg-slate-950/92 backdrop-blur-md border border-slate-700/80 rounded-lg p-1 shadow-2xl pointer-events-auto select-none">
            {/* Botão Compacto de COMPRA */}
            <button
              onClick={() => onManualOrder('BUY')}
              className="px-2.5 py-1 text-[11px] font-bold rounded bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white transition-all cursor-pointer flex items-center gap-1 shadow-sm"
              title={`Enviar COMPRA a Mercado (${contracts}ct a ${currentPrice.toLocaleString('pt-BR')} pts)`}
            >
              <ArrowUp className="w-3 h-3 stroke-[2.5]" />
              <span>COMPRA</span>
              <span className="text-[9px] font-mono px-1 py-0.2 bg-emerald-800/80 rounded text-emerald-100">
                {contracts}ct
              </span>
            </button>

            {/* Botão Compacto de VENDA */}
            <button
              onClick={() => onManualOrder('SELL')}
              className="px-2.5 py-1 text-[11px] font-bold rounded bg-rose-600 hover:bg-rose-500 active:scale-95 text-white transition-all cursor-pointer flex items-center gap-1 shadow-sm"
              title={`Enviar VENDA a Mercado (${contracts}ct a ${currentPrice.toLocaleString('pt-BR')} pts)`}
            >
              <ArrowDown className="w-3 h-3 stroke-[2.5]" />
              <span>VENDA</span>
              <span className="text-[9px] font-mono px-1 py-0.2 bg-rose-800/80 rounded text-rose-100">
                {contracts}ct
              </span>
            </button>

            {/* Botão Compacto de ZERAR quando há posições abertas */}
            {openOrders.length > 0 && onClosePositions && (
              <button
                onClick={onClosePositions}
                className="px-2.5 py-1 text-[11px] font-bold rounded bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 active:scale-95 transition-all cursor-pointer flex items-center gap-1"
                title="Zerar todas as ordens e posições abertas imediatamente"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                <span>ZERAR ({openOrders.length})</span>
              </button>
            )}
          </div>
        )}

        {/* Controles de Escala Flutuantes na Parte Inferior Esquerda (Evitando PnL e Box Card) */}
        <div
          className="absolute bottom-2 left-2.5 z-20 flex items-center gap-1.5 bg-slate-900/90 backdrop-blur-md border border-slate-700/80 rounded-lg p-1 shadow-2xl text-slate-300 pointer-events-auto text-[10px] font-mono"
          title="Controle rápido de Escala de Preço (Y) e Fluxo (F)"
        >
          <span className="text-slate-400 font-bold px-1">Escalas:</span>
          
          {/* Preço (Y) */}
          <div className="flex items-center gap-0.5 bg-slate-950/80 px-1 py-0.5 rounded border border-slate-800">
            <span className="text-slate-500 font-bold">Y:</span>
            <button
              onClick={() => setScaleY((prev) => Math.min(4.0, Number((prev + 0.2).toFixed(2))))}
              className="w-4 h-4 flex items-center justify-center hover:text-emerald-300 hover:bg-slate-800 rounded font-bold cursor-pointer"
              title="Esticar Escala Y"
            >
              +
            </button>
            <button
              onClick={() => {
                setScaleY(1.0);
                setPricePanOffset(0);
              }}
              className="px-1 hover:text-emerald-300 cursor-pointer"
              title="Reset Y"
            >
              {Math.round(scaleY * 100)}%
            </button>
            <button
              onClick={() => setScaleY((prev) => Math.max(0.25, Number((prev - 0.2).toFixed(2))))}
              className="w-4 h-4 flex items-center justify-center hover:text-emerald-300 hover:bg-slate-800 rounded font-bold cursor-pointer"
              title="Comprimir Escala Y"
            >
              -
            </button>
          </div>

          {/* Pan Y (+50 / -50) */}
          <div className="flex items-center gap-0.5 bg-slate-950/80 px-1 py-0.5 rounded border border-slate-800">
            <button
              onClick={() => setPricePanOffset((prev) => prev + 50)}
              className="w-4 h-4 flex items-center justify-center hover:text-sky-300 hover:bg-slate-800 rounded cursor-pointer"
              title="Subir Preço (+50 pts)"
            >
              <ArrowUp className="w-2.5 h-2.5" />
            </button>
            <button
              onClick={() => setPricePanOffset((prev) => prev - 50)}
              className="w-4 h-4 flex items-center justify-center hover:text-sky-300 hover:bg-slate-800 rounded cursor-pointer"
              title="Descer Preço (-50 pts)"
            >
              <ArrowDown className="w-2.5 h-2.5" />
            </button>
          </div>

          {/* Fluxo (F) */}
          <div className="flex items-center gap-0.5 bg-slate-950/80 px-1 py-0.5 rounded border border-slate-800">
            <span className="text-purple-400 font-bold">Fluxo:</span>
            <button
              onClick={() => setScaleFlow((prev) => Math.min(4.0, Number((prev + 0.2).toFixed(2))))}
              className="w-4 h-4 flex items-center justify-center hover:text-purple-300 hover:bg-slate-800 rounded font-bold cursor-pointer"
              title="Esticar Fluxo"
            >
              +
            </button>
            <button
              onClick={() => {
                setScaleFlow(1.0);
                setFlowPanOffset(0);
              }}
              className="px-1 hover:text-purple-300 cursor-pointer"
              title="Reset Fluxo"
            >
              {Math.round(scaleFlow * 100)}%
            </button>
            <button
              onClick={() => setScaleFlow((prev) => Math.max(0.25, Number((prev - 0.2).toFixed(2))))}
              className="w-4 h-4 flex items-center justify-center hover:text-purple-300 hover:bg-slate-800 rounded font-bold cursor-pointer"
              title="Comprimir Fluxo"
            >
              -
            </button>
          </div>

          <button
            onClick={handleResetAllScales}
            className="px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 font-semibold cursor-pointer"
            title="Resetar todas as escalas"
          >
            Auto
          </button>
        </div>

        {/* ========================================================================= */}
        {/* QUADRO BOX RENKO FIXO: DESKTOP (CANTO INFERIOR DIREITO)                   */}
        {/* ========================================================================= */}
        {activeBox && (
          <div className="hidden sm:block absolute bottom-3 right-[88px] z-20 w-[285px] bg-slate-950/95 backdrop-blur-md border border-slate-700/80 rounded-lg p-2.5 shadow-2xl pointer-events-none select-none font-sans text-xs">
            <div className="flex items-center justify-between pb-1.5 border-b border-slate-800">
              <div className="flex items-center gap-1.5 font-bold text-slate-100">
                <Pin className="w-3 h-3 text-sky-400 rotate-45" />
                <span>Box Renko 10R #{activeBox.index}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span
                  className={`px-1.5 py-0.2 rounded text-[10px] font-bold ${
                    activeBox.direction === 'UP'
                      ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                      : 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                  }`}
                >
                  {activeBox.direction === 'UP' ? 'ALTA +50' : 'BAIXA -50'}
                </span>
                <span
                  className={`text-[9px] font-mono px-1 rounded ${
                    hoveredBox ? 'text-sky-400 bg-sky-500/10' : 'text-emerald-400 bg-emerald-500/10'
                  }`}
                >
                  {hoveredBox ? 'INSPEÇÃO' : 'AO VIVO'}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-x-2 gap-y-1 py-1.5 text-[11px] font-mono border-b border-slate-800/80">
              <div>
                <span className="text-slate-500 mr-1">Aber:</span>
                <span className="text-slate-200">{activeBox.open.toLocaleString('pt-BR')}</span>
              </div>
              <div>
                <span className="text-slate-500 mr-1">Fech:</span>
                <span className="text-slate-100 font-semibold">
                  {activeBox.close.toLocaleString('pt-BR')}
                </span>
              </div>
              <div>
                <span className="text-slate-500 mr-1">Máx:</span>
                <span className="text-slate-300">{activeBox.high.toLocaleString('pt-BR')}</span>
              </div>
              <div>
                <span className="text-slate-500 mr-1">Mín:</span>
                <span className="text-slate-300">{activeBox.low.toLocaleString('pt-BR')}</span>
              </div>
            </div>

            <div className="py-1.5 space-y-1 text-[11px] font-mono border-b border-slate-800/80">
              {/* Destaque do Fluxo Heikin-Ashi */}
              <div className="flex items-center justify-between">
                <span className="text-slate-400">Fluxo Heikin-Ashi:</span>
                <span
                  className={`font-bold flex items-center gap-1 ${
                    activeBoxHaState === 'UP'
                      ? 'text-emerald-400'
                      : activeBoxHaState === 'DOWN'
                      ? 'text-rose-400'
                      : 'text-slate-300'
                  }`}
                >
                  {activeBoxHaState === 'UP'
                    ? '▲ SUBIDA (VERDE)'
                    : activeBoxHaState === 'DOWN'
                    ? '▼ DESCIDA (VERMELHO)'
                    : '⚡ REVERSÃO (CINZA)'}
                </span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-slate-400">Saldo CVD:</span>
                <span className="text-sky-400 font-semibold">
                  {activeBox.cvdAtClose.toLocaleString('pt-BR')} ctros
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400">Delta do Box:</span>
                <span
                  className={`font-bold ${
                    activeBox.delta >= 0 ? 'text-emerald-400' : 'text-rose-400'
                  }`}
                >
                  {activeBox.delta > 0 ? '+' : ''}
                  {activeBox.delta} ctros
                </span>
              </div>
              <div className="flex items-center justify-between text-[10px] text-slate-500">
                <span>
                  C: {activeBox.buyVolume} | V: {activeBox.sellVolume}
                </span>
                <span>{activeBox.ticksCount} ticks</span>
              </div>
            </div>

            <div className="pt-1.5">
              {activeBox.convergenceType === 'BUY_CONVERGENCE' ? (
                <div className="text-[10px] font-bold text-emerald-300 bg-emerald-500/15 border border-emerald-500/30 rounded px-2 py-0.5 text-center">
                  ▲ CONVERGÊNCIA COMPRA DISPARADA
                </div>
              ) : activeBox.convergenceType === 'SELL_CONVERGENCE' ? (
                <div className="text-[10px] font-bold text-rose-300 bg-rose-500/15 border border-rose-500/30 rounded px-2 py-0.5 text-center">
                  ▼ CONVERGÊNCIA VENDA DISPARADA
                </div>
              ) : activeBox.convergenceType === 'DIVERGENCE' ? (
                <div className="text-[10px] font-bold text-amber-300 bg-amber-500/15 border border-amber-500/30 rounded px-2 py-0.5 text-center">
                  ⚡ DIVERGÊNCIA DE FLUXO (ABSORÇÃO)
                </div>
              ) : (
                <div className="text-[10px] text-slate-500 bg-slate-900/60 rounded px-2 py-0.5 text-center">
                  Fluxo Regular / Neutro
                </div>
              )}
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* QUADRO BOX RENKO: MOBILE COMPACT HUD (EM BAIXO, NÃO COBRE O GRÁFICO)      */}
        {/* ========================================================================= */}
        {activeBox && (
          <div className="block sm:hidden absolute bottom-1 left-2 right-14 z-20 font-sans pointer-events-auto">
            {isMobileDetailsOpen ? (
              <div className="bg-slate-950/95 backdrop-blur-md border border-slate-700 rounded-lg p-2.5 shadow-2xl animate-in slide-in-from-bottom duration-200">
                <div className="flex items-center justify-between pb-1 border-b border-slate-800">
                  <span className="font-bold text-slate-100 text-xs">
                    Box Renko 10R #{activeBox.index}
                  </span>
                  <button
                    onClick={() => setIsMobileDetailsOpen(false)}
                    className="p-1 text-slate-400 hover:text-slate-100 text-xs flex items-center gap-0.5 cursor-pointer"
                  >
                    <span>Ocultar</span>
                    <ChevronDown className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-x-2 gap-y-1 py-1.5 text-[10px] font-mono border-b border-slate-800/80">
                  <div>
                    Aber: <span className="text-slate-200">{activeBox.open}</span>
                  </div>
                  <div>
                    Fech: <span className="text-slate-100 font-semibold">{activeBox.close}</span>
                  </div>
                  <div>
                    Máx: <span className="text-slate-300">{activeBox.high}</span>
                  </div>
                  <div>
                    Mín: <span className="text-slate-300">{activeBox.low}</span>
                  </div>
                </div>
                <div className="space-y-1 py-1 text-[10px] font-mono">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400">Fluxo HA:</span>
                    <span
                      className={`font-bold ${
                        activeBoxHaState === 'UP'
                          ? 'text-emerald-400'
                          : activeBoxHaState === 'DOWN'
                          ? 'text-rose-400'
                          : 'text-slate-300'
                      }`}
                    >
                      {activeBoxHaState === 'UP' ? 'Subida' : activeBoxHaState === 'DOWN' ? 'Descida' : 'Reversão'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sky-400">CVD: {activeBox.cvdAtClose}</span>
                    <span
                      className={`font-bold ${
                        activeBox.delta >= 0 ? 'text-emerald-400' : 'text-rose-400'
                      }`}
                    >
                      Delta: {activeBox.delta > 0 ? '+' : ''}{activeBox.delta} ctros
                    </span>
                  </div>
                </div>
              </div>
            ) : (
              <div
                onClick={() => setIsMobileDetailsOpen(true)}
                className="bg-slate-900/90 backdrop-blur-md border border-slate-800 rounded-lg px-2.5 py-1 text-[11px] font-mono flex items-center justify-between shadow-lg cursor-pointer active:scale-98"
              >
                <div className="flex items-center gap-1.5">
                  <span
                    className={`w-2 h-2 rounded-full ${
                      activeBox.direction === 'UP' ? 'bg-emerald-400' : 'bg-rose-400'
                    }`}
                  />
                  <span className="font-bold text-slate-200">10R #{activeBox.index}</span>
                  <span
                    className={`font-bold ${
                      activeBox.delta >= 0 ? 'text-emerald-400' : 'text-rose-400'
                    }`}
                  >
                    Δ{activeBox.delta > 0 ? '+' : ''}{activeBox.delta}
                  </span>
                </div>
                <div className="flex items-center gap-1 text-[10px] text-sky-400">
                  <span>Detalhes</span>
                  <ChevronUp className="w-3 h-3" />
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ========================================================================= */}
      {/* RODAPÉ INFORMATIVO COM LEGENDA DE FLUXO HEIKIN-ASHI                       */}
      {/* ========================================================================= */}
      <div className="flex items-center justify-between px-3 sm:px-4 py-1 sm:py-1.5 bg-slate-950 border-t border-slate-900 text-[10px] sm:text-[11px] text-slate-400 font-mono shrink-0">
        <div className="flex items-center gap-2 sm:gap-3 overflow-x-auto no-scrollbar">
          {/* Legenda dos Boxes Renko 10R */}
          <div className="flex items-center gap-1 shrink-0">
            <span className="w-2 h-3 bg-emerald-500 rounded-xs" />
            <span>10R Alta</span>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <span className="w-2 h-3 bg-rose-500 rounded-xs" />
            <span>10R Baixa</span>
          </div>

          <div className="h-3 w-[1px] bg-slate-800 shrink-0" />

          {/* Legenda Solicitada do Fluxo Heikin-Ashi */}
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-slate-500 font-semibold">Fluxo HA:</span>
            <div className="flex items-center gap-1">
              <span className="w-2 h-2.5 bg-emerald-500 rounded-xs" />
              <span className="text-emerald-300">Subida</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="w-2 h-2.5 bg-rose-500 rounded-xs" />
              <span className="text-rose-300">Descida</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="w-2 h-2.5 bg-slate-400 rounded-xs" />
              <span className="text-slate-200 font-semibold">Reversão</span>
            </div>

            <div className="h-3 w-[1px] bg-slate-800 shrink-0 hidden sm:block" />

            <button
              onClick={() => {
                setScaleFlow(1.0);
                setFlowPanOffset(0);
              }}
              className="hidden sm:inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-purple-500/10 hover:bg-purple-500/20 text-purple-300 border border-purple-500/30 text-[9.5px] cursor-pointer shrink-0 whitespace-nowrap"
              title="Clique para resetar escala do fluxo para 100%"
            >
              <span>Escala Fluxo:</span>
              <strong className="font-mono">{Math.round(scaleFlow * 100)}%</strong>
            </button>
          </div>
        </div>

        <div className="text-slate-500 text-[9px] sm:text-[10px] min-w-0 truncate flex items-center justify-end gap-2 pl-2">
          <span className="hidden lg:inline truncate">
            💡 Arraste régua lateral para esticar Preço/Fluxo · Divisor para altura · Duplo clique para auto-escala
          </span>
          <span className="hidden sm:inline lg:hidden truncate">
            💡 Arraste réguas para zoom Y/Fluxo · Divisor para altura
          </span>
          <span className="sm:hidden truncate">Arraste réguas para zoom</span>
        </div>
      </div>
    </div>
  );
};
