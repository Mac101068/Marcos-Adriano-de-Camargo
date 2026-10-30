import React, { useRef, useEffect, useState, useMemo } from 'react';
import { RenkoBox, TradeOrder } from '../types/trading';
import { ChartSeries } from '../utils/barEngines';
import { Drawing, DrawingColor, DrawingTool, loadDrawings, saveDrawings } from '../types/drawing';
import { ChartLayout, DrawingOverlay } from './DrawingOverlay';
import { ChartControlSidebar } from './ChartControlSidebar';
import { DadosPanelWindow } from './DadosPanelWindow';
import { RenkoBoxCard } from './RenkoBoxCard';
import { Sliders, ArrowUp, ArrowDown, Settings } from 'lucide-react';

const STORAGE_KEY_SCALES = 'fluxo_renko_chart_scales_v2';
const STORAGE_KEY_FLOW_MODE = 'fluxo_renko_flow_mode_v1';
// v2: migra quem estava preso em 'compact' (meia tela) para o novo padrão 'fill' (tela inteira)
const STORAGE_KEY_SPACING_MODE = 'fluxo_renko_spacing_mode_v2';
// v3: janela inicial de ~1 dia COM folga (250) para o dia de contexto estático e a linha
// ABERTURA continuarem na tela depois que o replay do dia-alvo terminar (um dia costuma
// gerar 120-200 tijolos, então 120 apertava e empurrava a fronteira para fora).
// Teto agora é 3000 tijolos (~15 dias) — modo estudo: máximo de dias possível na tela.
const STORAGE_KEY_VISIBLE_COUNT = 'fluxo_renko_visible_count_v3';

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
  // Série ativa (Pontos/Range/Tempo) e controles da barra do gráfico
  chartSeries?: ChartSeries;
  onSeriesChange?: (s: ChartSeries) => void;
  renkoBoxPoints?: number;
  rangePoints?: number;
  onRangePointsChange?: (n: number) => void;
  timeframeSec?: number;
  onTimeframeChange?: (n: number) => void;
  // Janela flutuante de controles (atalho "Dados" no menu)
  dadosWindowOpen?: boolean;
  onDadosWindowClose?: () => void;
  // Janela flutuante do Box Renko (atalho "Box Renko" no menu)
  boxWindowOpen?: boolean;
  onBoxWindowClose?: () => void;
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

// Formata o intervalo do gráfico de Tempo para exibição compacta (ex.: 30s, 1min, 5min)
function formatTimeframe(sec: number): string {
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.round(sec / 60)}min`;
  return `${Math.round(sec / 3600)}h`;
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
  chartSeries = 'renko',
  onSeriesChange,
  renkoBoxPoints = 50,
  rangePoints = 50,
  onRangePointsChange,
  timeframeSec = 30,
  onTimeframeChange,
  dadosWindowOpen = false,
  onDadosWindowClose,
  boxWindowOpen = false,
  onBoxWindowClose,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // =========================================================================
  // FERRAMENTAS DE DESENHO: estado da barra, desenhos persistidos e layout
  // publicado pelo canvas para a camada SVG (âncora em preço/tijolo, não px)
  // =========================================================================
  const [activeDrawingTool, setActiveDrawingTool] = useState<DrawingTool>('select');
  const [drawingColor, setDrawingColor] = useState<DrawingColor>('white');
  const [drawings, setDrawings] = useState<Drawing[]>([]);
  const [selectedDrawingId, setSelectedDrawingId] = useState<string | null>(null);
  const chartLayoutRef = useRef<ChartLayout | null>(null);
  const [canvasSize, setCanvasSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const [layoutVersion, setLayoutVersion] = useState(0);
  const lastLayoutSigRef = useRef<string>('');

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

  // Arrasto dos divisores do gráfico (preço↔fluxo e Heikin-Ashi↔histograma) com o dedo, em celulares
  const touchDividerRef = useRef<{
    mode: 'MAIN' | 'HIST' | null;
    startY: number;
    startValue: number;
    usableH: number;
    canvasH: number;
  }>({ mode: null, startY: 0, startValue: 0.66, usableH: 100, canvasH: 100 });

  // Carrega escalas salvas pelo operador (se existirem)
  const initialScales = useMemo(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_SCALES);
      if (saved) {
        const parsed = JSON.parse(saved);
        return {
          // Piso 0.15: permite abrir o zoom o suficiente para caber vários dias na tela (estudo)
          scaleX: Math.max(0.15, Math.min(3.5, Number(parsed.scaleX) || 1.0)),
          scaleY: Math.max(0.3, Math.min(4.0, Number(parsed.scaleY) || 1.0)),
          scaleFlow: Math.max(0.3, Math.min(4.0, Number(parsed.scaleFlow) || 1.0)),
          flowPaneRatio: Math.max(0.2, Math.min(0.5, Number(parsed.flowPaneRatio) || 0.33)),
          flowPanOffset: Number(parsed.flowPanOffset) || 0,
          haHistSplit: Math.max(0.3, Math.min(0.85, Number(parsed.haHistSplit) || 0.66)),
        };
      }
    } catch (e) {
      // Ignora erro de storage
    }
    return { scaleX: 1.0, scaleY: 1.0, scaleFlow: 1.0, flowPaneRatio: 0.33, flowPanOffset: 0, haHistSplit: 0.66 };
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
  const [haHistSplit, setHaHistSplit] = useState<number>(initialScales.haHistSplit ?? 0.66); // Divisor interno: % da janela de fluxo para o Heikin-Ashi (0.30 a 0.85)

  // Janela do eixo X (tijolos na tela): persistida, com teto alto de propósito — cada sessão
  // gera ~100-150 blocos, então dá para colocar MAIS DE UM DIA inteiro na tela.
  const [visibleCount, setVisibleCount] = useState<number>(() => {
    try {
      const saved = Number(localStorage.getItem(STORAGE_KEY_VISIBLE_COUNT));
      if (saved >= 14 && saved <= 3000) return saved;
    } catch (e) {
      // Ignora
    }
    // Desktop: 250 tijolos cobrem um dia inteiro com folga, então o contexto (ontem) e a
    // linha ABERTURA continuam visíveis mesmo no fim do replay. Mobile: janela menor.
    return typeof window !== 'undefined' && window.innerWidth < 640 ? 50 : 250;
  });
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_VISIBLE_COUNT, String(visibleCount));
    } catch (e) {
      // Ignora
    }
  }, [visibleCount]);
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
  const [dragMode, setDragMode] = useState<'CHART' | 'Y_AXIS' | 'X_AXIS' | 'FLOW_AXIS' | 'DIVIDER' | 'HA_HIST_DIVIDER' | null>(null);
  const [dragStartX, setDragStartX] = useState<number>(0);
  const [dragStartY, setDragStartY] = useState<number>(0);
  const [dragStartScroll, setDragStartScroll] = useState<number>(0);
  const [dragStartScaleY, setDragStartScaleY] = useState<number>(1.0);
  const [dragStartPanOffset, setDragStartPanOffset] = useState<number>(0);
  const [dragStartScaleX, setDragStartScaleX] = useState<number>(1.0);
  const [dragStartScaleFlow, setDragStartScaleFlow] = useState<number>(1.0);
  const [dragStartFlowPanOffset, setDragStartFlowPanOffset] = useState<number>(0);
  const [dragStartFlowRatio, setDragStartFlowRatio] = useState<number>(0.33);
  const [dragStartHaHistSplit, setDragStartHaHistSplit] = useState<number>(0.66);

  // Controle do card flutuante em celulares
  const [isMobileDetailsOpen, setIsMobileDetailsOpen] = useState<boolean>(false);

  // Barra lateral de controles: dockada na esquerda no desktop, drawer em telas pequenas
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(false);

  // Painel de ajustes de exibição do gráfico (aberto pela engrenagem no canto inferior direito).
  // Concentra tijolos/zoom/modo/escala do fluxo + legenda, tirando a tarima miúda sempre-visível.
  const [chartToolsOpen, setChartToolsOpen] = useState<boolean>(false);

  // Preferências visuais
  const [showOrderLines, setShowOrderLines] = useState<boolean>(true);
  const [boxThickness, setBoxThickness] = useState<'thin' | 'ultrathin' | 'medium'>('thin');
  // 'compact' = tijolos sempre agrupados à direita | 'fill' = auto-ajuste que preenche a tela
  const [spacingMode, setSpacingMode] = useState<'compact' | 'fill'>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_SPACING_MODE);
      if (saved === 'fill' || saved === 'compact') return saved;
    } catch (e) {
      // Ignora
    }
    return 'fill'; // Padrão: aproveitar a tela inteira (compact continua disponível na lateral)
  });
  const [rightMargin, setRightMargin] = useState<number>(() =>
    typeof window !== 'undefined' && window.innerWidth < 640 ? 50 : 90
  );

  // Área clicável do selo "HISTÓRICO −N · VOLTE AO HOJE" (preenchida pelo draw do canvas)
  const scrollBadgeRef = useRef<{ x0: number; x1: number; y0: number; y1: number } | null>(null);

  // O handler de roda vive num ref para o listener nativo (não-passivo) nunca precisar ser
  // reanexado: com onWheel do React o preventDefault é ignorado (listener passivo) e a página
  // inteira rola junto com o zoom do gráfico.
  const wheelHandlerRef = useRef<(e: WheelEvent) => void>(null);

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
          haHistSplit: Number(haHistSplit.toFixed(3)),
        })
      );
    } catch (e) {
      // Ignora
    }
  }, [scaleX, scaleY, scaleFlow, flowPaneRatio, flowPanOffset, haHistSplit]);

  // Salva preferência do modo de fluxo
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_FLOW_MODE, flowViewMode);
    } catch (e) {
      // Ignora
    }
  }, [flowViewMode]);

  // Salva preferência do espaçamento dos tijolos
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_SPACING_MODE, spacingMode);
    } catch (e) {
      // Ignora
    }
  }, [spacingMode]);

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
    const rightAxisWidth = isMobile ? 46 : 64;
    const chartWidth = width - rightAxisWidth;
    const effectiveRightMargin = isMobile ? Math.min(rightMargin, 50) : rightMargin;

    // Fundo escuro profissional
    ctx.fillStyle = '#09090b';
    ctx.fillRect(0, 0, width, height);

    // Divisor interativo de painel (arrastável) — mesmo acabamento do divisor do histograma
    const mainDividerActive =
      dragMode === 'DIVIDER' ||
      (mousePos !== null && Math.abs(mousePos.y - pricePaneHeight) <= 7 && mousePos.x < chartWidth);

    ctx.strokeStyle = mainDividerActive ? 'rgba(52, 211, 153, 0.65)' : '#27272a';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, pricePaneHeight);
    ctx.lineTo(width, pricePaneHeight);
    ctx.stroke();

    // Marcador central no divisor indicando que é redimensionável por arrasto
    const handleW = isMobile ? 34 : 48;
    const handleH = mainDividerActive ? 5 : 4;
    const handleX = chartWidth / 2 - handleW / 2;
    const handleY = pricePaneHeight - handleH / 2;
    ctx.fillStyle = mainDividerActive ? '#10b981' : '#27272a';
    ctx.beginPath();
    ctx.roundRect(handleX, handleY, handleW, handleH, 2.5);
    ctx.fill();
    ctx.strokeStyle = mainDividerActive ? 'rgba(16, 185, 129, 0.8)' : '#52525b';
    ctx.lineWidth = 1;
    ctx.stroke();

    // 3 pontos no puxador
    ctx.fillStyle = mainDividerActive ? '#ecfdf5' : '#a1a1aa';
    for (let d = -1; d <= 1; d++) {
      ctx.beginPath();
      ctx.arc(chartWidth / 2 + d * (isMobile ? 7 : 10), pricePaneHeight, 1.1, 0, Math.PI * 2);
      ctx.fill();
    }

    // Etiquetas dos painéis, no mesmo padrão das subfaixas de fluxo
    if (!isMobile) {
      ctx.font = '8.5px "Plus Jakarta Sans", sans-serif';
      ctx.textAlign = 'left';
      ctx.fillStyle = '#52525b';
      const pricePaneLabel =
        chartSeries === 'range' ? 'PREÇO · RANGE' : chartSeries === 'tempo' ? 'PREÇO · TEMPO' : 'PREÇO · RENKO';
      ctx.fillText(pricePaneLabel, 4, pricePaneHeight - 10);
      // No Heikin-Ashi a própria subfaixa já vem rotulada logo abaixo, então só rotula o
      // painel de fluxo nos modos onde ele ocupa a janela inteira.
      if (flowViewMode !== 'heikin_ashi') {
        ctx.fillText(
          flowViewMode === 'histogram' ? 'FLUXO · DELTA' : 'FLUXO · HÍBRIDO',
          4,
          pricePaneHeight + 14
        );
      }
    }

    // Eixo de preços lateral
    ctx.fillStyle = '#121215';
    ctx.fillRect(chartWidth, 0, rightAxisWidth, height);
    ctx.beginPath();
    ctx.moveTo(chartWidth, 0);
    ctx.lineTo(chartWidth, height);
    ctx.stroke();

    if (allBoxes.length === 0) {
      ctx.fillStyle = '#71717a';
      ctx.font = isMobile ? '11px "Plus Jakarta Sans", sans-serif' : '13px "Plus Jakarta Sans", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(
        `Aguardando ticks para formar ${
          chartSeries === 'range' ? `Range ${rangePoints} pts` : chartSeries === 'tempo' ? `candles de ${formatTimeframe(timeframeSec)}` : 'Renko 10R'
        }...`,
        width / 2,
        height / 2
      );
      return;
    }

    // Janela de visualização do EIXO X: o scrollOffset agora REALMENTE revela tijolos
    // antigos (antes ele só empurrava os últimos para fora da tela, deixando vazio).
    const totalCount = allBoxes.length;
    // No "Preencher" a janela é exatamente o "Tijolos X" pedido (o auto-ajuste de passo é que
    // cuida de caber na tela), senão o zoom X encolheria a janela por baixo do controle e
    // nunca daria para ver mais dias no zoom mínimo. No Compacto o zoom ainda corta a janela.
    const baseVisible =
      spacingMode === 'fill'
        ? Math.max(10, visibleCount)
        : Math.max(10, Math.round(visibleCount / Math.sqrt(scaleX)));
    // Passo base antes de fatiar os dados (o modo "Preencher" precisa dele para calcular
    // quantos tijolos cabem na tela inteira)
    const baseSpacingStep = isMobile ? 14 : 17;
    const availableWidth = Math.max(100, chartWidth - effectiveRightMargin - (isMobile ? 16 : 30));
    const effectiveScroll = Math.max(0, Math.min(scrollOffset, Math.max(0, totalCount - 2)));
    // Janela visível: no "Preencher" vale o "Tijolos X" pedido pelo operador (até 3000 — até
    // ~15 dias de uma só vez, para estudo); o auto-ajuste abaixo calcula o passo para que TODOS
    // caibam na largura da tela. No Compacto o vão fica no passo base (transborda = pan).
    const screenFitMax = Math.max(10, Math.floor(availableWidth / Math.max(2, baseSpacingStep * scaleX)));
    const viewCount = Math.max(
      10,
      Math.min(totalCount, spacingMode === 'fill' ? baseVisible : Math.min(baseVisible, screenFitMax))
    );
    const endIdx = Math.max(1, Math.min(totalCount, totalCount - Math.round(effectiveScroll)));
    const startIdx = Math.max(0, endIdx - viewCount);
    const displayedBoxes = allBoxes.slice(startIdx, endIdx);

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
    let boxWidth = Math.max(5, Math.min(28, Math.round(baseBoxWidth * Math.sqrt(scaleX))));

    // Posicionamento X com ancoragem à direita
    // Auto-fit do modo "Preencher": distribui a janela escolhida pela largura TODA da tela
    // (vão máximo de 170px quando há poucos tijolos; aperta abaixo do passo base quando há
    // muitos — é assim que vários dias inteiros cabem juntos para estudo).
    const autoFitStep =
      displayedBoxes.length > 1
        ? Math.min(isMobile ? 100 : 170, Math.max(1, availableWidth / (displayedBoxes.length + 1)))
        : baseSpacingStep;

    const dynamicStep = spacingMode === 'fill' ? autoFitStep : baseSpacingStep;
    const stepX = dynamicStep * scaleX;

    // No Preencher denso (multidia) o tijolo encolhe junto com o vão, para nunca sobrepor;
    // piso 1px: com milhares de tijolos o gráfico vira um "bloco" contínuo legível como silhueta
    boxWidth = Math.min(boxWidth, Math.max(1, stepX - (stepX >= 8 ? 2 : stepX >= 3 ? 0.5 : 0.2)));

    // Último tijolo VISÍVEL encostado na margem direita; ao rolar para o histórico a ancora
    // volta para a margem (antes o scroll empurrava a barra nova para fora da tela).
    const newestVisibleIsLast = endIdx >= totalCount && effectiveScroll === 0;
    const lastBoxX = newestVisibleIsLast
      ? chartWidth - effectiveRightMargin
      : chartWidth - effectiveRightMargin - (totalCount - endIdx) * stepX;
    const xs: number[] = new Array(displayedBoxes.length);
    let currX = lastBoxX;

    for (let i = displayedBoxes.length - 1; i >= 0; i--) {
      xs[i] = currX;
      if (i > 0) {
        currX -= stepX;
      }
    }

    // =======================================================================
    // MARCADOR DE ABERTURA DE DIA: linha vertical tracejada onde o dia vira.
    // Deixa o dia de contexto (ontem) e o dia-alvo visualmente separados, tanto
    // no replay (ontem estático) quanto ao vivo na virada do pregão.
    // =======================================================================
    const dayBoundaries: { x: number; label: string }[] = [];
    for (let i = 1; i < displayedBoxes.length; i++) {
      const prevDay = new Date(displayedBoxes[i - 1].timeEnd || displayedBoxes[i - 1].timeStart).getDate();
      const curDay = new Date(displayedBoxes[i].timeEnd || displayedBoxes[i].timeStart).getDate();
      if (curDay !== prevDay) {
        dayBoundaries.push({
          x: (xs[i] + xs[i - 1]) / 2,
          label: new Date(displayedBoxes[i].timeEnd || displayedBoxes[i].timeStart).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }),
        });
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

      const colorFill = state === 'REVERSAL' ? '#a1a1aa' : state === 'UP' ? '#10b981' : '#ef4444';
      const colorStroke = state === 'REVERSAL' ? '#71717a' : state === 'UP' ? '#059669' : '#dc2626';

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
      // Usa a subfaixa do HA (declaração posterior é segura: só é chamada após o cálculo das bandas)
      const top = flowTopMargin;
      const h = Math.max(20, haBandHeight - 2);
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

    // NOVO: no modo Heikin-Ashi, particiona o painel de fluxo em duas subfaixas:
    // candles Heikin-Ashi em cima + histograma de Delta embaixo, para decisão visual.
    // A proporção é ajustável arrastando o divisor interno (haHistSplit).
    const haSplitHist = flowViewMode === 'heikin_ashi';
    const clampedHaSplit = Math.max(0.3, Math.min(0.85, haHistSplit));
    const haBandTop = flowTopMargin;
    const haBandHeight = haSplitHist ? usableFlowHeight * clampedHaSplit : usableFlowHeight;
    const haBandBottom = haBandTop + haBandHeight;
    const histBandTop = haSplitHist ? haBandBottom + 12 : flowTopMargin;
    const histBandBottom = flowTopMargin + usableFlowHeight;
    const histBandHeight = Math.max(0, histBandBottom - histBandTop);
    const histMidY = (histBandTop + histBandBottom) / 2;
    const histHalf = Math.max(6, histBandHeight / 2);
    // Mapeia o Delta para a subfaixa inferior (usa a mesma escala efetiva do histograma cheio)
    const histDeltaToY = (delta: number) => histMidY - (delta / effectiveMaxAbsDelta) * histHalf;
    const histZeroY = histDeltaToY(0);

    const flowHaToY = (val: number) => {
      return haBandTop + haBandHeight - ((val - effectiveMinFlowHa) / effectiveHaRange) * haBandHeight;
    };

    // =======================================================================
    // GRADE DINÂMICA DE PREÇOS (EIXO Y ADAPTATIVO)
    // =======================================================================
    const pxPer50Pts = Math.abs(priceToY(centerPrice + 50) - priceToY(centerPrice));
    let gridStep = pxPer50Pts < 18 ? 100 : pxPer50Pts > 55 ? 25 : 50;
    while ((effectiveMaxPrice - effectiveMinPrice) / gridStep > 20) {
      gridStep *= 2;
    }

    ctx.strokeStyle = '#18181b';
    ctx.lineWidth = 1;
    ctx.fillStyle = '#71717a';
    ctx.font = isMobile ? '8.5px "JetBrains Mono", monospace' : '10px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';

    const startGridPrice = Math.ceil(effectiveMinPrice / gridStep) * gridStep;
    for (let p = startGridPrice; p <= effectiveMaxPrice; p += gridStep) {
      const y = priceToY(p);
      if (y >= 10 && y <= pricePaneHeight - 10) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(chartWidth, y);
        ctx.stroke();
        ctx.fillText(p.toLocaleString('pt-BR'), chartWidth + rightAxisWidth / 2, y + 3.5);
      }
    }

    // =======================================================================
    // ESCALA E NÍVEIS DA JANELA DE FLUXO (EIXO LATERAL & GRADE ADAPTATIVA)
    // =======================================================================
    if (flowViewMode === 'heikin_ashi' || flowViewMode === 'hybrid') {
      const lastHa = flowHaData[flowHaData.length - 1];
      const lastHaY = lastHa ? flowHaToY(lastHa.close) : null;

      // Calcula haStep dinamicamente para garantir no máximo 1 linha a cada 24px da faixa do HA
      const maxHaTicks = Math.max(2, Math.floor(haBandHeight / 24));
      const rawHaStep = Math.max(1, effectiveHaRange / maxHaTicks);

      // Arredonda para um passo limpo (1, 2, 5, 10, 25, 50, 100, 250, 500, 1000, etc.)
      const pow10 = Math.pow(10, Math.floor(Math.log10(rawHaStep)));
      const rel = rawHaStep / pow10;
      let stepFactor = 1;
      if (rel > 5) stepFactor = 10;
      else if (rel > 2.2) stepFactor = 5;
      else if (rel > 1.2) stepFactor = 2.5;
      const haStep = Math.max(1, Math.round(stepFactor * pow10));

      const startHaVal = Math.ceil(effectiveMinFlowHa / haStep) * haStep;
      ctx.font = isMobile ? '7.5px "JetBrains Mono", monospace' : '8.5px "JetBrains Mono", monospace';

      let lastDrawnFlowY = -999;
      for (let v = startHaVal; v <= effectiveMaxFlowHa; v += haStep) {
        const y = flowHaToY(v);
        // Restrito à subfaixa do Heikin-Ashi: assim nenhuma grade invade o histograma
        if (y >= haBandTop - 1 && y <= haBandBottom + 1) {
          // Evita colisão vertical com rótulo anterior ou com o badge do último valor
          if (Math.abs(y - lastDrawnFlowY) < 18) continue;
          if (lastHaY !== null && Math.abs(y - lastHaY) < 14) continue;

          const isZero = Math.abs(v) < 1;
          ctx.strokeStyle = isZero ? '#3f3f46' : 'rgba(39, 39, 42, 0.55)';
          ctx.setLineDash(isZero ? [4, 4] : [1, 4]);
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(chartWidth, y);
          ctx.stroke();
          ctx.setLineDash([]);

          ctx.fillStyle = isZero ? '#a1a1aa' : '#71717a';
          ctx.textAlign = 'center';
          const sign = v > 0 ? '+' : '';
          const formatted = Math.abs(v) >= 1000 ? `${sign}${(v / 1000).toFixed(1)}k` : `${sign}${v}`;
          ctx.fillText(formatted, chartWidth + rightAxisWidth / 2, y + 3);
          lastDrawnFlowY = y;
        }
      }

      // Badge com o valor do último candle Heikin-Ashi na régua lateral
      if (lastHa && lastHaY !== null) {
        if (lastHaY >= haBandTop && lastHaY <= haBandBottom) {
          const badgeFill =
            lastHa.state === 'UP' ? '#059669' : lastHa.state === 'DOWN' ? '#dc2626' : '#52525b';
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
        ctx.strokeStyle = '#27272a';
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(0, zeroY);
        ctx.lineTo(chartWidth, zeroY);
        ctx.stroke();
        ctx.setLineDash([]);
        if (flowViewMode === 'histogram') {
          ctx.fillStyle = '#a1a1aa';
          ctx.font = isMobile ? '8px "JetBrains Mono"' : '9px "JetBrains Mono"';
          ctx.textAlign = 'center';
          ctx.fillText('0Δ', chartWidth + rightAxisWidth / 2, zeroY + 3);
        }
      }

      // Limiares ±: degraus do regime (fator por box fechado) quando o medidor anotou os boxes;
      // sem fator (toggle adaptativo desligado em boxes novos) continuam linhas retas do fixo.
      const drawStepThresholds = (mapY: (v: number) => number, bandTop: number, bandBottom: number) => {
        const segs: { x0: number; x1: number; upY: number; dnY: number }[] = [];
        let prevEdge: number | null = null;
        displayedBoxes.forEach((bx, idx) => {
          const cx = xs[idx];
          const edge = cx + boxWidth / 2;
          const f = bx.regimeFactor ?? 1;
          const upY = mapY(minDeltaThreshold * f);
          const dnY = mapY(-minDeltaThreshold * f);
          if (prevEdge !== null) segs.push({ x0: prevEdge, x1: edge - boxWidth, upY, dnY });
          prevEdge = edge;
        });
        for (const s of segs) {
          if (s.x1 < 0) continue;
          const x0 = Math.max(0, s.x0);
          const x1 = Math.min(chartWidth, s.x1);
          if (x1 <= x0) continue;
          for (const [y, color] of [
            [s.upY, 'rgba(16, 185, 129, 0.35)'],
            [s.dnY, 'rgba(239, 68, 68, 0.35)'],
          ] as const) {
            if (y < bandTop || y > bandBottom) continue;
            ctx.strokeStyle = color;
            ctx.setLineDash([2, 4]);
            ctx.beginPath();
            ctx.moveTo(x0, y);
            ctx.lineTo(x1, y);
            ctx.stroke();
            ctx.setLineDash([]);
          }
        }
      };

      const lastClosedBox = displayedBoxes[displayedBoxes.length - 1];
      const anyAdaptive = displayedBoxes.some((bx) => bx.regimeFactor !== undefined);
      if (anyAdaptive) {
        drawStepThresholds(deltaToY, pricePaneHeight + 8, height - 12);
      } else {
        // Compatibilidade: linhas retas do limiar fixo
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
        }

        if (lowerThresholdY <= height - 14) {
          ctx.strokeStyle = 'rgba(239, 68, 68, 0.35)';
          ctx.setLineDash([2, 4]);
          ctx.beginPath();
          ctx.moveTo(0, lowerThresholdY);
          ctx.lineTo(chartWidth, lowerThresholdY);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }

      if (flowViewMode === 'histogram') {
        // Rótulo na régua lateral: limiar efetivo do último box fechado (com o fator do momento)
        const lastF = lastClosedBox?.regimeFactor ?? 1;
        const upLbl = anyAdaptive && lastClosedBox
          ? `+${Math.round(minDeltaThreshold * lastF)}Δ${lastF !== 1 ? ` (${lastF.toFixed(1)}x)` : ''}`
          : `+${minDeltaThreshold}Δ`;
        const upYLbl = deltaToY(anyAdaptive && lastClosedBox ? minDeltaThreshold * lastF : minDeltaThreshold);
        if (upYLbl >= pricePaneHeight + 10) {
          ctx.fillStyle = '#10b981';
          ctx.font = isMobile ? '8px "JetBrains Mono"' : '9px "JetBrains Mono"';
          ctx.textAlign = 'center';
          ctx.fillText(upLbl, chartWidth + rightAxisWidth / 2, upYLbl + 3);
        }
        const dnYLbl = deltaToY(anyAdaptive && lastClosedBox ? -minDeltaThreshold * lastF : -minDeltaThreshold);
        if (dnYLbl <= height - 14) {
          ctx.fillStyle = '#ef4444';
          ctx.font = isMobile ? '8px "JetBrains Mono"' : '9px "JetBrains Mono"';
          ctx.textAlign = 'center';
          ctx.fillText(anyAdaptive && lastClosedBox ? `-${Math.round(minDeltaThreshold * lastF)}Δ` : `-${minDeltaThreshold}Δ`, chartWidth + rightAxisWidth / 2, dnYLbl + 3);
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

    // =======================================================================
    // NOVO: SUBFAIXA DE HISTOGRAMA DE DELTA (abaixo do Heikin-Ashi no modo 'heikin_ashi')
    // =======================================================================
    if (haSplitHist && histBandHeight > 8) {
      // Divisor ARRASTÁVEL entre os candles Heikin-Ashi e o histograma de Delta,
      // repetindo o estilo do divisor principal (linha + alça central + 3 pontos).
      const histDividerY = haBandBottom + 6;
      const histDividerActive =
        dragMode === 'HA_HIST_DIVIDER' ||
        (mousePos !== null && Math.abs(mousePos.y - histDividerY) <= 7 && mousePos.x < chartWidth);

      ctx.strokeStyle = histDividerActive ? 'rgba(52, 211, 153, 0.65)' : '#27272a';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, histDividerY);
      ctx.lineTo(chartWidth, histDividerY);
      ctx.stroke();

      const hHandleW = isMobile ? 34 : 48;
      const hHandleH = histDividerActive ? 5 : 4;
      ctx.fillStyle = histDividerActive ? '#10b981' : '#27272a';
      ctx.beginPath();
      ctx.roundRect(chartWidth / 2 - hHandleW / 2, histDividerY - hHandleH / 2, hHandleW, hHandleH, 2.5);
      ctx.fill();
      ctx.fillStyle = histDividerActive ? '#ecfdf5' : '#a1a1aa';
      for (let d = -1; d <= 1; d++) {
        ctx.beginPath();
        ctx.arc(chartWidth / 2 + d * (isMobile ? 7 : 10), histDividerY, 1.1, 0, Math.PI * 2);
        ctx.fill();
      }

      // Etiqueta das subfaixas, para ficar claro o que é vela de fluxo e o que é histograma
      if (!isMobile) {
        ctx.font = '8.5px "Plus Jakarta Sans", sans-serif';
        ctx.textAlign = 'left';
        ctx.fillStyle = '#52525b';
        ctx.fillText('FLUXO · HEIKIN-ASHI', 4, haBandTop + 9);
        ctx.fillText('HISTOGRAMA · DELTA', 4, histBandTop + 9);
      }

      // Linha de zero do Delta
      ctx.strokeStyle = '#3f3f46';
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(0, histZeroY);
      ctx.lineTo(chartWidth, histZeroY);
      ctx.stroke();
      ctx.setLineDash([]);

      // ---- ESCALA NUMÉRICA DO DELTA (grade adaptativa + rótulos na régua direita) ----
      const maxHistTicks = Math.max(2, Math.floor(histBandHeight / 22));
      const rawHistStep = Math.max(1, (2 * effectiveMaxAbsDelta) / maxHistTicks);
      const hPow = Math.pow(10, Math.floor(Math.log10(rawHistStep)));
      const hRel = rawHistStep / hPow;
      let hFactor = 1;
      if (hRel > 5) hFactor = 10;
      else if (hRel > 2) hFactor = 5;
      else if (hRel > 1) hFactor = 2;
      const histStep = Math.max(1, Math.round(hFactor * hPow));

      ctx.font = isMobile ? '7px "JetBrains Mono"' : '8px "JetBrains Mono"';
      ctx.textAlign = 'center';
      let lastHistLblY = -999;
      const histTickStart = -Math.ceil(effectiveMaxAbsDelta / histStep) * histStep;
      for (let v = histTickStart; v <= effectiveMaxAbsDelta; v += histStep) {
        const y = histDeltaToY(v);
        if (y < histBandTop - 1 || y > histBandBottom + 1) continue;
        if (Math.abs(y - lastHistLblY) < 14) continue;
        const isZero = Math.abs(v) < 1;
        if (!isZero) {
          ctx.strokeStyle = 'rgba(39, 39, 42, 0.5)';
          ctx.setLineDash([1, 4]);
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(chartWidth, y);
          ctx.stroke();
          ctx.setLineDash([]);
        }
        ctx.fillStyle = isZero ? '#a1a1aa' : '#71717a';
        const sign = v > 0 ? '+' : '';
        const lbl =
          Math.abs(v) >= 1000 ? `${sign}${(v / 1000).toFixed(1)}kΔ` : `${sign}${Math.round(v)}Δ`;
        ctx.fillText(lbl, chartWidth + rightAxisWidth / 2, y + 3);
        lastHistLblY = y;
      }

      // Guias de limiar na subfaixa de histórico: degraus do regime (idem), com recorte vertical
      {
        const clipped = (y: number) => Math.max(histBandTop, Math.min(histBandBottom, y));
        let prevEdge: number | null = null;
        ctx.setLineDash([2, 4]);
        displayedBoxes.forEach((bx, idx) => {
          const edge = xs[idx] + boxWidth / 2;
          if (prevEdge === null) return void (prevEdge = edge);
          const f = bx.regimeFactor ?? 1;
          const upY = clipped(histDeltaToY(minDeltaThreshold * f));
          const dnY = clipped(histDeltaToY(-minDeltaThreshold * f));
          const x0 = Math.max(0, prevEdge);
          const x1 = Math.min(chartWidth, edge - boxWidth);
          prevEdge = edge;
          if (x1 <= x0) return;
          ctx.strokeStyle = 'rgba(16, 185, 129, 0.3)';
          ctx.beginPath();
          ctx.moveTo(x0, upY);
          ctx.lineTo(x1, upY);
          ctx.stroke();
          ctx.strokeStyle = 'rgba(239, 68, 68, 0.3)';
          ctx.beginPath();
          ctx.moveTo(x0, dnY);
          ctx.lineTo(x1, dnY);
          ctx.stroke();
        });
        ctx.setLineDash([]);
      }

      // Selo com o Delta ao vivo do último box (inclui o box em formação)
      const lastLiveBox = displayedBoxes[displayedBoxes.length - 1];
      if (lastLiveBox) {
        const badgeY = histDeltaToY(lastLiveBox.delta);
        if (badgeY >= histBandTop - 2 && badgeY <= histBandBottom + 2) {
          ctx.fillStyle = lastLiveBox.delta >= 0 ? '#059669' : '#dc2626';
          ctx.beginPath();
          ctx.roundRect(chartWidth + 1, badgeY - 7, rightAxisWidth - 2, 14, 2);
          ctx.fill();
          ctx.fillStyle = '#ffffff';
          ctx.font = isMobile ? 'bold 7.5px "JetBrains Mono"' : 'bold 8.5px "JetBrains Mono"';
          ctx.textAlign = 'center';
          ctx.fillText(
            `${lastLiveBox.delta > 0 ? '+' : ''}${Math.round(lastLiveBox.delta)}Δ`,
            chartWidth + rightAxisWidth / 2,
            badgeY + 3.5
          );
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
      // Ghost de conclusão ("faltam Xp") só faz sentido no Renko por pontos
      const showRenkoGhost = isForming && chartSeries === 'renko';

      const openY = priceToY(b.open);
      const closeY = priceToY(b.close);
      const topY = Math.min(openY, closeY);
      const boxH = Math.max(3, Math.abs(closeY - openY));

      const highY = priceToY(b.high);
      const lowY = priceToY(b.low);

      // Pavio (no gráfico de Tempo desenhamos blocos sólidos estilo Renko, sem pavios)
      if (chartSeries !== 'tempo') {
        ctx.strokeStyle = isUp ? '#059669' : '#dc2626';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(centerX, highY);
        ctx.lineTo(centerX, lowY);
        ctx.stroke();
      }

      if (showRenkoGhost) {
        const targetClosePrice = isUp ? b.open + renkoBoxPoints : b.open - renkoBoxPoints;
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
      // O dia de contexto (ontem, estático) nunca operou: suas marcas de compra/venda e
      // convergência ficam suprimidas — só os tijolos crus aparecem.
      const hideSignals = b.isStaticContext === true;
      const prevBox = i > 0 ? displayedBoxes[i - 1] : null;
      const isFirstBuyConvergence =
        b.convergenceType === 'BUY_CONVERGENCE' &&
        (!prevBox || prevBox.convergenceType !== 'BUY_CONVERGENCE');
      const isFirstSellConvergence =
        b.convergenceType === 'SELL_CONVERGENCE' &&
        (!prevBox || prevBox.convergenceType !== 'SELL_CONVERGENCE');

      const shouldDrawBuy =
        !hideSignals &&
        (b.orderDispatched === 'BUY' ||
          isFirstBuyConvergence ||
          (b.convergenceType === 'BUY_CONVERGENCE' && centerX - lastBuySignalX >= 65));

      const shouldDrawSell =
        !hideSignals &&
        (b.orderDispatched === 'SELL' ||
          isFirstSellConvergence ||
          (b.convergenceType === 'SELL_CONVERGENCE' && centerX - lastSellSignalX >= 65));

      if (shouldDrawBuy) {
        ctx.fillStyle = '#10b981';
        ctx.font = isMobile ? 'bold 8.5px "Plus Jakarta Sans"' : 'bold 10px "Plus Jakarta Sans"';
        ctx.textAlign = 'center';
        const label = isMobile ? '▲ C' : b.orderDispatched === 'BUY' ? '▲ MÃE' : '▲ COMPRA';
        ctx.fillText(label, centerX, lowY + (isMobile ? 12 : 16));
        lastBuySignalX = centerX;
      } else if (!hideSignals && b.convergenceType === 'BUY_CONVERGENCE' && !isMobile && centerX - lastBuySignalX >= 22) {
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
      } else if (!hideSignals && b.convergenceType === 'SELL_CONVERGENCE' && !isMobile && centerX - lastSellSignalX >= 22) {
        ctx.fillStyle = '#dc2626';
        ctx.font = '8px "Plus Jakarta Sans"';
        ctx.textAlign = 'center';
        ctx.fillText('▼', centerX, highY - 5);
      }

      // =======================================================================
      // DESENHO DO PAINEL INFERIOR: HEIKIN-ASHI E/OU HISTOGRAMA DE DELTA
      // =======================================================================
      // 1. Histograma de Delta (cheio em 'histogram'/'hybrid'; na subfaixa inferior em 'heikin_ashi')
      if (flowViewMode === 'histogram' || flowViewMode === 'hybrid' || haSplitHist) {
        const mapDeltaY = haSplitHist ? histDeltaToY : deltaToY;
        const refZeroY = haSplitHist ? histZeroY : deltaZeroY;
        const deltaY = mapDeltaY(b.delta);
        const isPositiveDelta = b.delta >= 0;
        let barTop = Math.min(refZeroY, deltaY);
        let barHeight = Math.max(2, Math.abs(deltaY - refZeroY));
        if (haSplitHist) {
          // Restringe as barras à subfaixa inferior para não invadirem os candles HA
          barTop = Math.max(histBandTop, barTop);
          barHeight = Math.min(barHeight, histBandBottom - barTop);
          if (barHeight < 1) barHeight = 1;
        }

        // "fluxo forte" segue o limiar efetivo do box (fixo × fator do momento), quando medido
        const strongFlow = Math.abs(b.delta) >= minDeltaThreshold * (b.regimeFactor ?? 1);
        const opacity = flowViewMode === 'hybrid' ? '0.35' : haSplitHist ? '0.9' : '1.0';

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
            ctx.fillStyle = '#fafafa';
            ctx.beginPath();
            ctx.arc(centerX, (highY + lowY) / 2, isMobile ? 1.5 : 2, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
    });

    boxPositionsRef.current = boxPositions;

    // =======================================================================
    // LINHA DE ABERTURA DE DIA (contexto ↔ dia-alvo): tracejado vertical full-height
    // =======================================================================
    dayBoundaries.forEach((db) => {
      if (db.x < 4 || db.x > chartWidth - 4) return;
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 1.4;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(db.x, 6);
      ctx.lineTo(db.x, height - 26);
      ctx.stroke();
      ctx.setLineDash([]);
      // Etiqueta "ABERTURA · dd/mm" num pequeno selo acima da linha
      ctx.font = isMobile ? 'bold 7.5px "Plus Jakarta Sans"' : 'bold 8.5px "Plus Jakarta Sans"';
      ctx.textAlign = 'center';
      const labelTxt = `ABERTURA ${db.label}`;
      const lw = ctx.measureText(labelTxt).width + 10;
      const lx = Math.min(Math.max(db.x, lw / 2 + 2), chartWidth - lw / 2 - 2);
      ctx.fillStyle = 'rgba(245, 158, 11, 0.14)';
      ctx.beginPath();
      ctx.roundRect(lx - lw / 2, 8, lw, 14, 3);
      ctx.fill();
      ctx.strokeStyle = 'rgba(245, 158, 11, 0.55)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = '#fbbf24';
      ctx.fillText(labelTxt, lx, 18);
    });

    // Selo "HISTÓRICO -N": avisa que o operador rolou para trás; um clique nele volta ao hoje
    if (effectiveScroll >= 1) {
      ctx.font = isMobile ? 'bold 8px "Plus Jakarta Sans"' : 'bold 9px "Plus Jakarta Sans"';
      ctx.textAlign = 'right';
      const backTxt = `⟨ HISTÓRICO −${Math.round(effectiveScroll)} · VOLTE AO HOJE`;
      const bw = ctx.measureText(backTxt).width + 14;
      const bx = chartWidth - effectiveRightMargin - 6;
      ctx.fillStyle = 'rgba(56, 189, 248, 0.14)';
      ctx.beginPath();
      ctx.roundRect(bx - bw, 26, bw, 17, 4);
      ctx.fill();
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.5)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = '#7dd3fc';
      ctx.fillText(backTxt, bx - 7, 38);
      scrollBadgeRef.current = { x0: bx - bw, x1: bx, y0: 26, y1: 43 };
    } else {
      scrollBadgeRef.current = null;
    }

    // Publica o layout do painel de preço para a camada de desenho (SVG),
    // mantendo os desenhos ancorados em (índice do tijolo, preço) mesmo com zoom/pan
    const layoutSig = [width, height, pricePaneHeight, effectiveMinPrice, effectiveMaxPrice, startIdx, lastBoxX, stepX].join('|');
    if (layoutSig !== lastLayoutSigRef.current) {
      lastLayoutSigRef.current = layoutSig;
      chartLayoutRef.current = {
        height,
        pricePaneHeight,
        priceToY,
        yToPrice,
        indexToX: (k: number) => lastBoxX - (endIdx - 1 - k) * stepX,
        xToIndex: (x: number) => endIdx - 1 - (lastBoxX - x) / stepX,
      };
      setCanvasSize((prev) => (prev.w === width && prev.h === height ? prev : { w: width, h: height }));
      setLayoutVersion((v) => v + 1);
    }

    // =======================================================================
    // RÉGUA HORIZONTAL DE TEMPO (EIXO X)
    // =======================================================================
    const timeAxisY = height - 14;
    ctx.fillStyle = '#52525b';
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
        ctx.strokeStyle = 'rgba(161, 161, 170, 0.35)';
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
          ctx.fillStyle = '#27272a';
          ctx.fillRect(chartWidth + 1, mousePos.y - 8, rightAxisWidth - 2, 16);
          ctx.strokeStyle = '#71717a';
          ctx.strokeRect(chartWidth + 1, mousePos.y - 8, rightAxisWidth - 2, 16);
          ctx.fillStyle = '#fafafa';
          ctx.font = isMobile ? 'bold 8.5px "JetBrains Mono"' : 'bold 9.5px "JetBrains Mono"';
          ctx.textAlign = 'center';
          ctx.fillText(
            hoveredPrice.toLocaleString('pt-BR'),
            chartWidth + rightAxisWidth / 2,
            mousePos.y + 3.5
          );
        } else {
          // Leitura flutuante na régua lateral da Janela de Fluxo
          ctx.fillStyle = '#27272a';
          ctx.fillRect(chartWidth + 1, mousePos.y - 8, rightAxisWidth - 2, 16);
          ctx.strokeStyle = '#71717a';
          ctx.strokeRect(chartWidth + 1, mousePos.y - 8, rightAxisWidth - 2, 16);
          ctx.fillStyle = '#fafafa';
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
    haHistSplit,
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
    isDragging,
    dragMode,
    chartSeries,
    renkoBoxPoints,
    rangePoints,
    timeframeSec,
  ]);

  // =========================================================================
  // AÇÕES DAS FERRAMENTAS DE DESENHO: persistência, atalhos e edição
  // =========================================================================
  useEffect(() => {
    setDrawings(loadDrawings());
  }, []);

  useEffect(() => {
    saveDrawings(drawings);
  }, [drawings]);

  const undoLastDrawing = () => setDrawings((prev) => prev.slice(0, -1));

  const clearAllDrawings = () => {
    if (drawings.length === 0) return;
    if (window.confirm('Remover todos os desenhos do gráfico?')) {
      setDrawings([]);
      setSelectedDrawingId(null);
    }
  };

  const handleDrawingSelect = (id: string | null) => setSelectedDrawingId(id);

  const handleDrawingCreate = (d: Drawing) => {
    setDrawings((prev) => [...prev, d]);
    setSelectedDrawingId(d.id);
  };

  const handleDrawingUpdate = (id: string, patch: Partial<Drawing>) => {
    setDrawings((prev) => prev.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  };

  const handleDrawingDelete = (id: string) => {
    setDrawings((prev) => prev.filter((d) => d.id !== id));
    setSelectedDrawingId((cur) => (cur === id ? null : cur));
  };

  // Atalhos: V/H/R/A/T selecionam ferramentas, Delete apaga seleção, Ctrl+Z desfaz, Esc limpa seleção
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        setDrawings((prev) => prev.slice(0, -1));
        return;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedDrawingId) {
        handleDrawingDelete(selectedDrawingId);
        return;
      }
      if (e.key === 'Escape') {
        setSelectedDrawingId(null);
        setActiveDrawingTool('select');
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const map: Record<string, DrawingTool> = { v: 'select', h: 'hline', r: 'rect', a: 'arrow', t: 'text', l: 'trendline' };
      const tool = map[e.key.toLowerCase()];
      if (tool) setActiveDrawingTool(tool);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [selectedDrawingId]);

  // =========================================================================
  // MANIPULAÇÃO DE MOUSE: DIVISOR, ESCALAS E EIXOS (PREÇO, TEMPO E FLUXO)
  // =========================================================================
  /** Espelha o layout do canvas para hit-testing: onde fica cada divisor e a altura útil do fluxo. */
  const getFlowDividerLayout = (canvasW: number, canvasH: number) => {
    const isMobile = canvasW < 640;
    const rightAxisWidth = isMobile ? 46 : 64;
    const chartW = canvasW - rightAxisWidth;
    const clampedRatio = Math.max(0.18, Math.min(0.55, flowPaneRatio));
    const flowPaneH = canvasH * clampedRatio;
    const pricePaneH = canvasH - flowPaneH;
    // Mesma conta do desenho: margem superior 12 + margem inferior 16
    const usableFlowH = Math.max(40, flowPaneH - 12 - 16);
    const clampedSplit = Math.max(0.3, Math.min(0.85, haHistSplit));
    const haBandH = flowViewMode === 'heikin_ashi' ? usableFlowH * clampedSplit : usableFlowH;
    return {
      isMobile,
      chartW,
      flowPaneH,
      pricePaneH,
      usableFlowH,
      haBandH,
      // Divisor interno Heikin-Ashi ↔ histograma (só existe no modo Heikin-Ashi)
      histDividerY: pricePaneH + 12 + haBandH + 6,
    };
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const { chartW, pricePaneH, histDividerY } = getFlowDividerLayout(rect.width, rect.height);

    // 0. Clique no selo "VOLTE AO HOJE": zera o scroll e ancora de novo na barra mais recente
    const badge = scrollBadgeRef.current;
    if (badge && x >= badge.x0 && x <= badge.x1 && y >= badge.y0 && y <= badge.y1) {
      setScrollOffset(0);
      return;
    }

    // 1. Clique no divisor entre o gráfico de preço e a janela de fluxo
    if (Math.abs(y - pricePaneH) <= 8 && x < chartW) {
      setDragMode('DIVIDER');
      setDragStartY(e.clientY);
      setDragStartFlowRatio(flowPaneRatio);
      setIsDragging(true);
      return;
    }

    // 1b. Clique no divisor interno: arrasta a altura do histograma de Delta
    if (flowViewMode === 'heikin_ashi' && Math.abs(y - histDividerY) <= 8 && x < chartW) {
      setDragMode('HA_HIST_DIVIDER');
      setDragStartY(e.clientY);
      setDragStartHaHistSplit(haHistSplit);
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
      } else if (dragMode === 'HA_HIST_DIVIDER') {
        const { usableFlowH } = getFlowDividerLayout(rect.width, rect.height);
        const deltaY = e.clientY - dragStartY;
        // Arrastar para baixo aumenta o Heikin-Ashi; para cima aumenta o histograma
        const newSplit = Math.max(0.3, Math.min(0.85, dragStartHaHistSplit + deltaY / usableFlowH));
        setHaHistSplit(Number(newSplit.toFixed(3)));
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
        const newScaleX = Math.max(0.15, Math.min(3.5, dragStartScaleX * factor));
        setScaleX(newScaleX);
      } else if (dragMode === 'CHART') {
        const deltaX = e.clientX - dragStartX;
        const offsetDelta = deltaX / (22 * scaleX);
        // Limite real do histórico: dá para rolar até o primeiro tijolo encostar na direita
        const maxScroll = Math.max(0, allBoxes.length - 10);
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
    touchDividerRef.current.mode = null;
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
    const { chartW, pricePaneH, histDividerY } = getFlowDividerLayout(rect.width, rect.height);

    if (Math.abs(y - pricePaneH) <= 8 && x < chartW) {
      // Duplo clique no divisor: reseta para altura padrão de 33%
      setFlowPaneRatio(0.33);
    } else if (flowViewMode === 'heikin_ashi' && Math.abs(y - histDividerY) <= 8 && x < chartW) {
      // Duplo clique no divisor interno: volta a dividir 2/3 fluxo + 1/3 histograma
      setHaHistSplit(0.66);
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

  const handleWheel = (e: WheelEvent) => {
    e.preventDefault();
    const canvasEl = canvasRef.current;
    if (!canvasEl) return;
    const rect = canvasEl.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const isMobile = rect.width < 640;
    const rightAxisWidth = isMobile ? 46 : 64;
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
      // Shift + roda: pan horizontal pelo histórico (com limite real de barras)
      setScrollOffset((prev) => Math.max(0, Math.min(Math.max(0, allBoxes.length - 10), prev - (e.deltaY > 0 ? 2 : -2))));
    } else if (e.ctrlKey) {
      // Ctrl + roda: zoom fino na escala X (piso 0.15 permite abrir até caber vários dias)
      const zoomFactor = e.deltaY < 0 ? 1.08 : 0.92;
      setScaleX((prev) => Math.max(0.15, Math.min(3.5, prev * zoomFactor)));
    } else {
      // Roda normal no gráfico: ajusta zoom horizontal e densidade dos blocos
      if (e.deltaY < 0) {
        setScaleX((prev) => Math.min(3.5, prev * 1.05));
        setVisibleCount((prev) => Math.max(14, prev - 2));
      } else {
        setScaleX((prev) => Math.max(0.15, prev * 0.95));
        setVisibleCount((prev) => Math.min(3000, prev + 2));
      }
    }
  };

  wheelHandlerRef.current = handleWheel;

  // Anexa a roda como listener nativo não-passivo (permite preventDefault de verdade)
  useEffect(() => {
    const canvasEl = canvasRef.current;
    if (!canvasEl) return;
    const onWheelNative = (e: WheelEvent) => wheelHandlerRef.current?.(e);
    canvasEl.addEventListener('wheel', onWheelNative, { passive: false });
    return () => canvasEl.removeEventListener('wheel', onWheelNative);
  }, []);

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

      // Dedo em cima de um dos divisores: arrasta o painel em vez de rolar o gráfico
      const lay = getFlowDividerLayout(rect.width, rect.height);
      if (Math.abs(y - lay.pricePaneH) <= 12 && x < lay.chartW) {
        touchDividerRef.current = {
          mode: 'MAIN',
          startY: touch.clientY,
          startValue: flowPaneRatio,
          usableH: lay.usableFlowH,
          canvasH: rect.height,
        };
        return;
      }
      if (flowViewMode === 'heikin_ashi' && Math.abs(y - lay.histDividerY) <= 12 && x < lay.chartW) {
        touchDividerRef.current = {
          mode: 'HIST',
          startY: touch.clientY,
          startValue: haHistSplit,
          usableH: lay.usableFlowH,
          canvasH: rect.height,
        };
        return;
      }

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

      // Divisor sendo arrastado pelo dedo
      if (touchDividerRef.current.mode) {
        const deltaY = touch.clientY - touchDividerRef.current.startY;
        if (touchDividerRef.current.mode === 'MAIN') {
          const newRatio = Math.max(
            0.18,
            Math.min(0.55, touchDividerRef.current.startValue - deltaY / touchDividerRef.current.canvasH)
          );
          setFlowPaneRatio(Number(newRatio.toFixed(3)));
        } else {
          const newSplit = Math.max(
            0.3,
            Math.min(0.85, touchDividerRef.current.startValue + deltaY / touchDividerRef.current.usableH)
          );
          setHaHistSplit(Number(newSplit.toFixed(3)));
        }
        const rectT = e.currentTarget.getBoundingClientRect();
        setMousePos({ x: touch.clientX - rectT.left, y: touch.clientY - rectT.top });
        return;
      }

      const deltaX = touch.clientX - touchStartRef.current.x;
      const offsetDelta = deltaX / (20 * scaleX);
      const maxScroll = Math.max(0, allBoxes.length - 10);
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
          setScaleX((prev) => Math.max(0.15, Math.min(3.5, prev * (diffX > 0 ? 1.04 : 0.96))));
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
    setHaHistSplit(0.66);
    setVisibleCount(typeof window !== 'undefined' && window.innerWidth < 640 ? 26 : 40);
  };

  const isCustomScaled =
    scaleY !== 1.0 ||
    pricePanOffset !== 0 ||
    scaleX !== 1.0 ||
    scaleFlow !== 1.0 ||
    flowPanOffset !== 0 ||
    Math.abs(flowPaneRatio - 0.33) > 0.02 ||
    Math.abs(haHistSplit - 0.66) > 0.02;

  // Determina classe de cursor baseada na área
  const getCursorClass = () => {
    if (dragMode === 'DIVIDER' || dragMode === 'HA_HIST_DIVIDER') return 'cursor-row-resize';
    if (dragMode === 'FLOW_AXIS' || dragMode === 'Y_AXIS') return 'cursor-ns-resize';
    if (dragMode === 'X_AXIS') return 'cursor-ew-resize';
    if (dragMode === 'CHART') return 'cursor-grabbing';
    if (mousePos && canvasRef.current) {
      const { chartW, pricePaneH, histDividerY } = getFlowDividerLayout(
        canvasRef.current.clientWidth,
        canvasRef.current.clientHeight
      );
      const canvasH = canvasRef.current.clientHeight;

      if (Math.abs(mousePos.y - pricePaneH) <= 7 && mousePos.x < chartW) {
        return 'cursor-row-resize';
      }
      if (flowViewMode === 'heikin_ashi' && Math.abs(mousePos.y - histDividerY) <= 7 && mousePos.x < chartW) {
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

  // Fecha o drawer de controles com Esc
  useEffect(() => {
    if (!sidebarOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSidebarOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [sidebarOpen]);

  // Props compartilhadas entre a barra lateral dockada (desktop) e o drawer (telas pequenas)
  const sidebarProps = {
    blockCount: boxes.length,
    visibleCount,
    onVisibleCount: setVisibleCount,
    pnl: openPnL,
    activePosCount: openOrders.length,
    flowViewMode,
    onFlowViewMode: setFlowViewMode,
    boxThickness,
    onBoxThickness: setBoxThickness,
    spacingMode,
    onSpacingMode: setSpacingMode,
    scaleY,
    onScaleY: setScaleY,
    onResetY: () => {
      setScaleY(1.0);
      setPricePanOffset(0);
    },
    scaleX,
    onScaleX: setScaleX,
    onResetX: () => {
      setScaleX(1.0);
      setScrollOffset(0);
    },
    scaleFlow,
    onScaleFlow: setScaleFlow,
    onResetFlow: () => {
      setScaleFlow(1.0);
      setFlowPanOffset(0);
    },
    flowPaneRatio,
    onFlowPaneRatio: setFlowPaneRatio,
    isCustomScaled,
    onResetAll: handleResetAllScales,
    showOrderLines,
    onToggleOrderLines: () => setShowOrderLines((prev) => !prev),
    activeDrawingTool,
    onSelectDrawingTool: setActiveDrawingTool,
    drawingColor,
    onSelectDrawingColor: setDrawingColor,
    onUndoDrawing: undoLastDrawing,
    onClearDrawings: clearAllDrawings,
    hasDrawings: drawings.length > 0,
    currentPrice,
    contracts,
    onManualOrder,
    onClosePositions,
  };

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full flex flex-col bg-zinc-950 select-none overflow-hidden"
    >
      {/* ========================================================================= */}
      {/* TIRA DE STATUS COMPACTA: sem botões (todos vivem na barra lateral)         */}
      {/* ========================================================================= */}
      <div className="flex items-center justify-between gap-2 px-2.5 sm:px-4 h-9 shrink-0 bg-zinc-900/95 border-b border-zinc-800 text-[11px] font-mono">
        <div className="flex items-center gap-2 min-w-0">
          {/* Abre a barra lateral de controles em telas pequenas */}
          <button
            onClick={() => setSidebarOpen(true)}
            className="lg:hidden flex items-center gap-1 px-1.5 h-[22px] rounded bg-zinc-950/70 border border-zinc-700/80 text-zinc-300 hover:text-zinc-100 cursor-pointer"
            title="Abrir controles do gráfico"
          >
            <Sliders className="w-3 h-3" />
            <span className="text-[10px] font-sans">Controles</span>
          </button>

          {/* Seletor da série: Pontos (Renko) x Range, com escala editável (Tempo saiu do gráfico) */}
          <div className="flex items-center gap-1.5 shrink-0 rounded-md border border-zinc-600/70 bg-zinc-950/60 px-1.5 py-0.5" title="Escolha o tipo de gráfico e a escala">
            <span className="text-[9.5px] text-zinc-400 font-sans uppercase tracking-wide hidden sm:inline">Gráfico</span>
            <select
              value={chartSeries}
              onChange={(e) => onSeriesChange?.(e.target.value as ChartSeries)}
              className="h-6 rounded bg-zinc-900 border border-zinc-600/70 text-emerald-300 text-[11px] px-1.5 cursor-pointer focus:outline-none focus:border-emerald-500"
              title="Tipo de gráfico: Pontos (Renko) ou Range (variação de preço)"
            >
              <option value="renko">Pontos</option>
              <option value="range">Range</option>
            </select>
            {chartSeries === 'renko' && (
              <span className="text-zinc-400 text-[10.5px]" title="Escala do Renko definida no Painel do EA">
                {Math.max(1, Math.round(renkoBoxPoints / 5))}R
              </span>
            )}
            {chartSeries === 'range' && (
              <select
                value={rangePoints}
                onChange={(e) => onRangePointsChange?.(Number(e.target.value))}
                className="h-6 rounded bg-zinc-900 border border-zinc-600/70 text-emerald-300 text-[11px] px-1.5 cursor-pointer focus:outline-none focus:border-emerald-500"
                title="Escala do Range em pontos (variação High-Low por barra)"
              >
                {[10, 25, 50, 75, 100, 150].map((p) => (
                  <option key={p} value={p}>
                    {p} pts
                  </option>
                ))}
              </select>
            )}
          </div>
          <span className="text-emerald-400 font-semibold tabular-nums">{boxes.length} blk</span>

          <div className="h-3.5 w-[1px] bg-zinc-800" />

          <span
            className={`flex items-center gap-1 px-1.5 py-0.5 rounded border font-bold tabular-nums ${
              openPnL.openCount > 0
                ? openPnL.financial > 0
                  ? 'bg-emerald-950/90 border-emerald-500/50 text-emerald-300'
                  : openPnL.financial < 0
                  ? 'bg-rose-950/90 border-rose-500/50 text-rose-300'
                  : 'bg-zinc-900/90 border-zinc-700 text-zinc-300'
                : 'bg-zinc-950/50 border-zinc-800 text-zinc-400'
            }`}
            title="Resultado flutuante acumulado das operações abertas"
          >
            {openPnL.financial > 0 ? '+' : ''}
            {openPnL.financial.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
            {openPnL.openCount > 0 && (
              <span
                className={`text-[9.5px] px-1 py-0.2 rounded font-semibold ${
                  openPnL.points > 0
                    ? 'bg-emerald-500/20 text-emerald-300'
                    : openPnL.points < 0
                    ? 'bg-rose-500/20 text-rose-300'
                    : 'bg-zinc-800 text-zinc-400'
                }`}
              >
                {openPnL.points > 0 ? '+' : ''}
                {openPnL.points} pts
              </span>
            )}
          </span>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {openOrders.length > 0 ? (
            <div className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-zinc-900/80 border border-zinc-600/40 text-zinc-300 text-[10px]">
              <span className="w-1.5 h-1.5 rounded-full bg-zinc-400 animate-pulse" />
              <span>{openOrders.length} Pos Ativa(s)</span>
            </div>
          ) : (
            <span className="text-zinc-500 text-[10px] hidden sm:inline">Aguardando Sinal</span>
          )}
        </div>
      </div>

      {/* ========================================================================= */}
      {/* CORPO: CANVAS + JANELAS FLUTUANTES "DADOS" E "BOX RENKO"                 */}
      {/* ========================================================================= */}
      <div className="flex-1 flex flex-row min-h-0 relative">
        {dadosWindowOpen && (
          <DadosPanelWindow title="Dados — Painel Renko" onClose={() => onDadosWindowClose?.()}>
            <ChartControlSidebar {...sidebarProps} isWindow />
          </DadosPanelWindow>
        )}

        {/* Janela do Box Renko — nasce ao lado da janela Dados para não se sobrepor */}
        {boxWindowOpen && activeBox && (
          <div className="hidden sm:contents">
            <DadosPanelWindow
              title="Box Renko — 10R"
              onClose={() => onBoxWindowClose?.()}
              initialPos={{ x: dadosWindowOpen ? 262 : 10, y: 10 }}
            >
              <RenkoBoxCard
                box={activeBox}
                haState={activeBoxHaState}
                isInspection={Boolean(hoveredBox)}
                bounds={canvasSize}
                variant="window"
              />
            </DadosPanelWindow>
          </div>
        )}

        {/* ====================================================================== */}
        {/* CANVAS PRINCIPAL COM HIT-TESTING E GESTOS                              */}
        {/* ====================================================================== */}
        <div className="relative flex-1 w-full min-w-0 min-h-[300px]">
        <canvas
          ref={canvasRef}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseLeave}
          onDoubleClick={handleDoubleClick}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleMouseUp}
          className={`absolute inset-0 w-full h-full ${getCursorClass()} touch-none`}
        />

        {/* ========================================================================= */}
        {/* CAMADA DE DESENHO PROFISSIONAL: barra de ferramentas + overlay SVG         */}
        {/* ========================================================================= */}
        <DrawingOverlay
          width={canvasSize.w}
          layout={chartLayoutRef.current}
          drawings={drawings}
          activeTool={activeDrawingTool}
          activeColor={drawingColor}
          selectedId={selectedDrawingId}
          onSelect={handleDrawingSelect}
          onCreate={handleDrawingCreate}
          onUpdate={handleDrawingUpdate}
          onDelete={handleDrawingDelete}
        />

        {/* ========================================================================= */}
        {/* BOLETA COMPACTA SOMENTE EM TELAS PEQUENAS (no desktop vive na barra lateral) */}
        {/* ========================================================================= */}
        {onManualOrder && (
          <div className="lg:hidden absolute top-2 left-2 right-2 z-30 flex items-center gap-1.5 bg-zinc-950/92 backdrop-blur-md border border-zinc-700/80 rounded-lg p-1 shadow-2xl pointer-events-auto select-none">
            <button
              onClick={() => onManualOrder('BUY')}
              className="flex-1 px-2 h-[30px] text-[11px] font-bold rounded bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white transition-all cursor-pointer flex items-center justify-center gap-1"
              title={`Enviar COMPRA a Mercado (${contracts}ct a ${currentPrice.toLocaleString('pt-BR')} pts)`}
            >
              <ArrowUp className="w-3 h-3 stroke-[2.5]" />
              <span>COMPRA</span>
            </button>
            <button
              onClick={() => onManualOrder('SELL')}
              className="flex-1 px-2 h-[30px] text-[11px] font-bold rounded bg-rose-600 hover:bg-rose-500 active:scale-95 text-white transition-all cursor-pointer flex items-center justify-center gap-1"
              title={`Enviar VENDA a Mercado (${contracts}ct a ${currentPrice.toLocaleString('pt-BR')} pts)`}
            >
              <ArrowDown className="w-3 h-3 stroke-[2.5]" />
              <span>VENDA</span>
            </button>
            {openOrders.length > 0 && onClosePositions && (
              <button
                onClick={onClosePositions}
                className="flex-1 px-2 h-[30px] text-[11px] font-bold rounded bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 active:scale-95 transition-all cursor-pointer flex items-center justify-center gap-1"
                title="Zerar todas as ordens e posições abertas imediatamente"
              >
                <span>ZERAR ({openOrders.length})</span>
              </button>
            )}
          </div>
        )}

        {/* ========================================================================= */}
        {/* BOX RENKO: agora vive na janela flutuante "Box Renko" (topo) — ver corpo  */}
        {/* ========================================================================= */}

        {/* ========================================================================= */}
        {/* ENGRENAGEM DE AJUSTES: atalho no canto inferior direito que abre o painel  */}
        {/* de exibição (tijolos/zoom/modo/escala do fluxo + legenda). Limpa a tela.     */}
        {/* ========================================================================= */}
        {chartToolsOpen && (
          <div className="absolute bottom-11 right-2 z-30 w-[252px] rounded-lg bg-zinc-900/96 backdrop-blur-md border border-zinc-700/80 p-2.5 shadow-2xl pointer-events-auto select-none space-y-2.5">
            {/* Tijolos na tela (eixo X) */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] font-semibold text-zinc-400">Tijolos na tela (eixo X)</span>
                <span className="text-[10px] font-mono text-zinc-500 tabular-nums">≈ {Math.round(visibleCount / 140)} dia(s)</span>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setVisibleCount((prev) => Math.max(14, prev - 20))}
                  className="w-7 h-7 flex items-center justify-center rounded bg-zinc-800 text-sm font-bold text-zinc-200 hover:bg-zinc-700 cursor-pointer"
                  title="Menos tijolos na tela"
                >
                  −
                </button>
                <button
                  onClick={() => {
                    // Atalho multidia: 40 → 300 → 600 → 1200 → 2500 → 40
                    const next =
                      visibleCount < 250 ? 300 : visibleCount < 500 ? 600 : visibleCount < 1000 ? 1200 : visibleCount < 2000 ? 2500 : 40;
                    setVisibleCount(next);
                  }}
                  className="flex-1 h-7 rounded bg-zinc-800 text-xs font-mono font-bold text-zinc-100 hover:bg-zinc-700 cursor-pointer tabular-nums"
                  title="Clique para alternar 40 → 300 → 600 → 1200 → 2500 tijolos (mais dias na tela)"
                >
                  {visibleCount}
                </button>
                <button
                  onClick={() => setVisibleCount((prev) => Math.min(3000, prev + 20))}
                  className="w-7 h-7 flex items-center justify-center rounded bg-zinc-800 text-sm font-bold text-zinc-200 hover:bg-zinc-700 cursor-pointer"
                  title="Mais tijolos na tela (até ~15 dias para estudo)"
                >
                  +
                </button>
              </div>
            </div>

            {/* Zoom horizontal + modo de preenchimento */}
            <div className="flex items-center gap-1">
              <button
                onClick={() => setScaleX((prev) => Math.max(0.15, Number((prev * 0.9).toFixed(2))))}
                className="flex-1 h-7 rounded bg-zinc-800 text-[10px] font-semibold text-zinc-200 hover:bg-zinc-700 cursor-pointer"
                title="Zoom horizontal para fora (comprimir tijolos) — ou Ctrl+roda"
              >
                ⤡ Zoom −
              </button>
              <button
                onClick={() => setScaleX((prev) => Math.min(3.5, Number((prev * 1.1).toFixed(2))))}
                className="flex-1 h-7 rounded bg-zinc-800 text-[10px] font-semibold text-zinc-200 hover:bg-zinc-700 cursor-pointer"
                title="Zoom horizontal para dentro — ou Ctrl+roda"
              >
                ⤢ Zoom +
              </button>
              <button
                onClick={() => setSpacingMode((prev) => (prev === 'fill' ? 'compact' : 'fill'))}
                className={`w-14 h-7 rounded text-[10px] font-bold cursor-pointer border ${
                  spacingMode === 'fill'
                    ? 'bg-sky-500/20 text-sky-300 border-sky-500/40'
                    : 'bg-zinc-800 text-zinc-400 border-zinc-700 hover:text-white'
                }`}
                title="Preencher: tela inteira | Compacto: tijolos agrupados à direita"
              >
                {spacingMode === 'fill' ? 'FILL' : 'STD'}
              </button>
            </div>

            {scrollOffset > 0 && (
              <button
                onClick={() => setScrollOffset(0)}
                className="w-full h-7 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40 hover:bg-amber-500/30 cursor-pointer"
                title={`Você rolou ${Math.round(scrollOffset)} tijolos para o histórico — voltar à barra mais recente`}
              >
                ⟳ Voltar ao HOJE
              </button>
            )}

            {/* Escala do fluxo (reset) */}
            <button
              onClick={() => {
                setScaleFlow(1.0);
                setFlowPanOffset(0);
              }}
              className="w-full h-7 rounded text-[10px] font-semibold bg-purple-500/10 hover:bg-purple-500/20 text-purple-300 border border-purple-500/30 cursor-pointer"
              title="Clique para resetar a escala do painel de fluxo para 100%"
            >
              Escala do fluxo: {Math.round(scaleFlow * 100)}% · resetar
            </button>

            {/* Legenda (antes no rodapé, agora dentro do painel) */}
            <div className="border-t border-zinc-800 pt-2 grid grid-cols-2 gap-x-2 gap-y-1 text-[9.5px] text-zinc-400">
              <div className="flex items-center gap-1">
                <span className="w-2 h-3 bg-emerald-500 rounded-xs" /> <span>10R Alta</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="w-2 h-3 bg-rose-500 rounded-xs" /> <span>10R Baixa</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="w-2 h-2.5 bg-emerald-500 rounded-xs" /> <span>HA Subida</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="w-2 h-2.5 bg-rose-500 rounded-xs" /> <span>HA Descida</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="w-2 h-2.5 bg-zinc-400 rounded-xs" /> <span>HA Reversão</span>
              </div>
            </div>
          </div>
        )}
        <button
          onClick={() => setChartToolsOpen((o) => !o)}
          className={`absolute bottom-8 sm:bottom-2 right-[9px] sm:right-[18px] z-30 flex h-7 w-7 items-center justify-center rounded-md border backdrop-blur-sm shadow-lg pointer-events-auto cursor-pointer transition-colors ${
            chartToolsOpen
              ? 'bg-sky-500/25 text-sky-200 border-sky-500/50'
              : 'bg-zinc-900/85 text-zinc-300 border-zinc-700/70 hover:text-white'
          }`}
          title="Ajustes do gráfico: tijolos, zoom, modo de tela, escala do fluxo e legenda"
        >
          <Settings className="w-4 h-4" />
        </button>

        {/* ========================================================================= */}
        {/* BOX RENKO: HUD compacto em telas pequenas                                 */}
        {/* ========================================================================= */}
        {activeBox && (
          <div className="block sm:hidden absolute bottom-1 left-2 right-2 z-20 font-sans pointer-events-auto">
            <RenkoBoxCard
              box={activeBox}
              haState={activeBoxHaState}
              isInspection={Boolean(hoveredBox)}
              bounds={canvasSize}
              variant="mobile"
              mobileOpen={isMobileDetailsOpen}
              onToggleMobile={setIsMobileDetailsOpen}
            />
          </div>
        )}
        </div>
      </div>

      {/* Drawer de controles (telas pequenas): mesma barra lateral sobre o gráfico */}
      {sidebarOpen && (
        <>
          <div
            className="fixed inset-0 z-40 bg-zinc-950/70 backdrop-blur-sm lg:hidden"
            onClick={() => setSidebarOpen(false)}
          />
          <div className="fixed top-0 bottom-0 left-0 z-50 lg:hidden shadow-2xl shadow-black/60">
            <ChartControlSidebar {...sidebarProps} isDrawer onCloseDrawer={() => setSidebarOpen(false)} />
          </div>
        </>
      )}

      {/* ========================================================================= */}
      {/* RODAPÉ ENXUTO: só a dica de interação (a legenda migrou para a engrenagem)  */}
      {/* ========================================================================= */}
      <div className="flex items-center justify-end px-3 sm:px-4 py-0.5 bg-zinc-950 border-t border-zinc-900 text-[9px] sm:text-[10px] text-zinc-600 font-mono shrink-0">
        <span className="truncate">
          ⚙ Ajustes no canto inferior direito · arraste as réguas para zoom Y/Fluxo · duplo clique auto-escala
        </span>
      </div>
    </div>
  );
};
