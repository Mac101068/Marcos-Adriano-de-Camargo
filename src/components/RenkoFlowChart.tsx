import React, { useRef, useEffect, useState, useMemo } from 'react';
import { AutomationConfig, RenkoBox, TradeOrder } from '../types/trading';
import { ChartSeries } from '../utils/barEngines';
import { Drawing, DrawingColor, DrawingTool, loadDrawings, saveDrawings } from '../types/drawing';
import { ChartLayout, DrawingOverlay } from './DrawingOverlay';
import { PriceLevel, VWAP_CURVE_COLOR, VwapCurve } from '../utils/priceLevels';
import {
  ASSETS,
  AssetSpec,
  DEFAULT_ASSET_ID,
  boxPointsForR,
  clampRenkoR,
  chartSymbolFor,
  formatPrice,
  pointsToBRL,
  referencePrice,
  renkoRChoices,
  renkoRFromBoxPoints,
  renkoScaleLabel,
  snapToTick,
} from '../assets/assetRegistry';
import { ChartControlSidebar } from './ChartControlSidebar';
import { BoletaTicket, BOLETA_GAP, BOLETA_WIDTH, STORAGE_KEY_OPEN, HedgeBook } from './BoletaTicket';
import { DadosPanelWindow } from './DadosPanelWindow';
import { ShadowRobotPanel } from './ShadowRobotPanel';
import { RenkoBoxCard } from './RenkoBoxCard';
import { Sliders, ArrowUp, ArrowDown } from 'lucide-react';

const getStorageKeyScales = (assetId?: string) => `fluxo_renko_chart_scales_${assetId || 'WIN'}_v3`;
const STORAGE_KEY_FLOW_MODE = 'fluxo_renko_flow_mode_v1';
// v2: migra quem estava preso em 'compact' (meia tela) para o novo padrão 'fill' (tela inteira)
const STORAGE_KEY_SPACING_MODE = 'fluxo_renko_spacing_mode_v2';
// v3: janela inicial de ~1 dia COM folga (250) para o dia de contexto estático e a linha
// ABERTURA continuarem na tela depois que o replay do dia-alvo terminar (um dia costuma
// gerar 120-200 tijolos, então 120 apertava e empurrava a fronteira para fora).
// Teto agora é 3000 tijolos (~15 dias) — modo estudo: máximo de dias possível na tela.
const STORAGE_KEY_VISIBLE_COUNT = 'fluxo_renko_visible_count_v3';
// Níveis relevantes do pregão (leilão / abertura / VWAP / máx / mín / fechamento e ajuste) ligados por padrão.
const STORAGE_KEY_PRICE_LEVELS = 'fluxo_renko_price_levels_v1';
// Marca-d'água do ativo no painel de preço: ligada na primeira vez, depois é gosto do operador.
const STORAGE_KEY_ASSET_WATERMARK = 'fluxo_renko_asset_watermark_v1';
// Faixa da régua de tempo (eixo X): mora DENTRO do painel de preço, colada acima do divisor — antes
// ela vivia no topo do painel de fluxo e roubava 28px do indicador. Agora o indicador fica com a
// janela livre para ler o fluxo inteiro, e o tempo fica onde ele sempre pertenceu: no gráfico. A
// faixa continua sendo a zona de gesto do eixo X (arrastar = zoom/rolar o tempo; duplo clique = reset).
const TIME_AXIS_BAND_H = 22;
const TIME_AXIS_BASELINE = 8; // y do texto, medido PARA CIMA a partir do divisor
// Folga no topo do painel de fluxo: só a etiqueta do painel mora aí; o indicador começa abaixo.
const FLOW_TOP_PAD = 16;
// Recuo inicial do gráfico ("Chart Shift" do MetaTrader): distância, em pixels, entre a aresta
// direita do tijolo mais novo (o em formação) e a borda direita do desenho. 20px é o padrão.
const STORAGE_KEY_CHART_SHIFT = 'fluxo_renko_chart_shift_v1';
const CHART_SHIFT_DEFAULT = 20;
const CHART_SHIFT_MAX = 160;
// Setas ▲/▼ de compra e venda desenhadas sobre os tijolos (opção da janela "Dados").
const STORAGE_KEY_SIGNAL_ARROWS = 'fluxo_renko_signal_arrows_v1';
// Como o operador lê o resultado ao vivo das ordens no gráfico: em pontos (padrão) ou em R$.
const STORAGE_KEY_ORDER_VALUE_MODE = 'fluxo_renko_order_value_mode_v1';

type OrderValueMode = 'points' | 'money';

/**
 * '#rrggbb' -> rgba(...) com a transparência pedida. Cada nível chega ao canvas já discreto: a cor
 * serve para identificar o nível de relance, nunca para brigar com os tijolos do gráfico.
 */
const levelRgba = (hex: string, alpha: number) => {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
};

interface RenkoFlowChartProps {
  boxes: RenkoBox[];
  currentBox: Partial<RenkoBox> | null;
  currentPrice: number;
  openOrders: TradeOrder[];
  minDeltaThreshold: number;
  onManualOrder?: (type: 'BUY' | 'SELL') => void;
  onClosePositions?: () => void;
  /** Zerar por lado (hedge): passado direto da boleta para o App. */
  onClosePositionsSide?: (side: 'BUY' | 'SELL') => void;
  /** Livro do hedge calculado no App — a boleta exibe; o gráfico só faz a ponte. */
  hedgeBook?: HedgeBook;
  contracts?: number;
  stopLossPoints?: number;
  takeProfitPoints?: number;
  /** Piso do breakeven editável na boleta (fonte única; os painéis que o editavam foram eliminados). */
  breakevenOffsetPoints?: number;
  /** Distância do trailing stop editável na boleta (abaixo do break even). */
  trailingDistancePoints?: number;
  onTakeProfitChange?: (v: number) => void;
  onStopLossPointsChange?: (v: number) => void;
  onPartialPointsChange?: (v: number) => void;
  onBreakevenChange?: (v: number) => void;
  onTrailingChange?: (v: number) => void;
  onContractsChange?: (v: number) => void;
  isRealMT5Connected?: boolean;
  /** Modo da estratégia exibido na boleta (Pirâmide não tem SL/TP fixo). */
  strategyMode?: 'PULLBACK_RETEST' | 'PYRAMID_FLOW_CONFLUENCE';
  enablePartialExit?: boolean;
  partialPoints?: number;
  partialContracts?: number;
  trailingStop?: boolean;
  onExecutePyramidDemo?: () => void;
  // Série ativa (Pontos/Range/Tempo) e controles da barra do gráfico
  chartSeries?: ChartSeries;
  onSeriesChange?: (s: ChartSeries) => void;
  renkoBoxPoints?: number;
  /**
   * DEFINIÇÃO DA ESCALA DO BOX (fonte única: `config.boxPoints`). O R é editável no gráfico e
   * tudo que depende dele — motor, robôs, boleta, script Python, auditoria — lê este valor.
   */
  onRenkoBoxPointsChange?: (points: number) => void;
  /**
   * Atalho para o BLOCO DO RENKO nos Parâmetros. A escala do box é definida no painel de
   * Parâmetros; o gráfico só a lê. Em vez de um número morto na barra, o clique abre o bloco.
   */
  onOpenRenkoParam?: () => void;
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
  // ROBÔ 2 (SOMBRA): chip na tira de status + janela flutuante com o livro e os controles.
  // O gráfico não conhece o service — o App lê a sombra e entrega o resumo pronto.
  shadowEnabled?: boolean;
  shadowSummary?: string;
  /** Resultado da sombra em R$; só ele tem cor (a regra da plataforma: cor = sinal/placar). */
  shadowPnl?: number;
  shadowDetail?: string;
  onOpenShadowWindow?: () => void;
  shadowWindowOpen?: boolean;
  onShadowWindowClose?: () => void;
  /** Escolhas da sombra (estratégia/escala/ligar) viram patch do config — quem persiste é o App. */
  onPatchShadowConfig?: (patch: Partial<AutomationConfig>) => void;
  /** Níveis relevantes do pregão (utils/priceLevels), desenhados como tracejado cinza discreto. */
  priceLevels?: PriceLevel[];
  /** VWAP acumulada do dia amostrada nos tijolos — a curva laranja. */
  vwapCurve?: VwapCurve;
  /**
   * Ativo desenhado: valor do ponto (R$), variação mínima do hover e casas decimais do preço.
   * O gráfico continua medindo tudo em PONTOS; o spec só entra na conversão e na formatação.
   */
  asset?: AssetSpec;
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

// Torque único da "exaustão de fluxo": um box ainda do MESMO lado e acima do limiar, mas cuja
// agressão caiu a este percentual (ou menos) do box anterior, é marcado CINZA — é o movimento
// perdendo força, pó de reversão. Ajuste aqui (menor = só exaustão grave fica cinza; maior =
// mais sensível, mas pode acender cinza em pullback saudável).
const EXHAUST_DECAY_RATIO = 0.7;

export const RenkoFlowChart: React.FC<RenkoFlowChartProps> = ({
  boxes,
  currentBox,
  currentPrice,
  openOrders,
  minDeltaThreshold,
  onManualOrder,
  onClosePositions,
  onClosePositionsSide,
  hedgeBook,
  contracts = 2,
  stopLossPoints = 100,
  takeProfitPoints = 150,
  breakevenOffsetPoints = 5,
  trailingDistancePoints = 50,
  onTakeProfitChange,
    onStopLossPointsChange,
    onPartialPointsChange,
  onBreakevenChange,
  onTrailingChange,
  onContractsChange,
  isRealMT5Connected = false,
  strategyMode = 'PULLBACK_RETEST',
  enablePartialExit = true,
  partialPoints = 50,
  partialContracts = 1,
  trailingStop = true,
  onExecutePyramidDemo,
  chartSeries = 'renko',
  onSeriesChange,
  renkoBoxPoints = 50,
  onRenkoBoxPointsChange,
  onOpenRenkoParam,
  rangePoints = 50,
  onRangePointsChange,
  timeframeSec = 30,
  onTimeframeChange,
  dadosWindowOpen = false,
  onDadosWindowClose,
  boxWindowOpen = false,
  onBoxWindowClose,
  shadowEnabled = false,
  shadowSummary,
  shadowPnl,
  shadowDetail,
  onOpenShadowWindow,
  shadowWindowOpen = false,
  onShadowWindowClose,
  onPatchShadowConfig,
  priceLevels = [],
  vwapCurve,
  asset = ASSETS[DEFAULT_ASSET_ID],
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
  // Geometria vertical publicada a CADA draw (não só quando o layout muda): o arrasto livre
  // precisa converter px do mouse em pontos para o conteúdo colar no cursor (nada de
  // "puxa e o gráfico anda mais devagar"). chartLayoutRef só é atualizado quando o layout
  // cambia, então não serve para isso.
  const priceViewRef = useRef<{
    paneH: number; bottom: number; usableH: number; center: number; range: number;
  } | null>(null);
  // Última assinatura publicada do quadro do gráfico (left|width|divisorY) — variáveis CSS
  // --fluxo-chart-left/--fluxo-chart-width/--fluxo-divider-y, consumidas pelo toast do App.
  const lastFrameSigRef = useRef<string>('');
  const flowViewRef = useRef<{ bandH: number; range: number } | null>(null);
  // Passo horizontal REAL do tijolo (px por box), publicado a cada draw: sem ele o arrasto usa uma
  // constantezinha fixa e o gráfico anda ~0,15x da mão (parece grudado).
  const stepXRef = useRef<number>(22);
  // Limite de rolagem para trás, em TIJOLOS, publicado a cada draw: é a conta de quantos tijolos
  // cabem entre a âncora do mais novo e a borda esquerda. Sem esse teto o arrasto empurrava a
  // barra em formação para fora da tela (o "perdi o candle" do operador).
  const scrollMaxRef = useRef<number>(0);
  // Guarda vertical do tijolo em formação (auto-escala da última janela + preço atual). Null quando
  // o operador rolou para o histórico (estudo multidia) — aí o pan vertical volta a ser livre.
  const priceGuardRef = useRef<{
    baseMid: number; range: number; usableH: number; ref: number;
  } | null>(null);
  // Qual painel foi agarrado no mousedown: o pan vertical move só ele (preço ou fluxo).
  const dragPaneRef = useRef<'price' | 'flow'>('price');
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
    panFlow: number;
    pane: 'price' | 'flow';
  }>({ x: 0, y: 0, scroll: 0, panY: 0, panFlow: 0, pane: 'price' });

  // Arrasto dos divisores do gráfico (preço↔fluxo e Heikin-Ashi↔histograma) com o dedo, em celulares
  const touchDividerRef = useRef<{
    mode: 'MAIN' | 'HIST' | null;
    startY: number;
    startValue: number;
    usableH: number;
    canvasH: number;
  }>({ mode: null, startY: 0, startValue: 0.66, usableH: 100, canvasH: 100 });

  // Carrega escalas salvas pelo operador (se existirem) isoladas por ativo
  const initialScales = useMemo(() => {
    try {
      const saved = localStorage.getItem(getStorageKeyScales(asset?.id));
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
  }, [asset?.id]);

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

  // Ao alternar o ativo, reseta o Pan vertical de preço para centralizar na cotação do ativo novo
  // e carrega as escalas guardadas especificamente para este contrato
  useEffect(() => {
    setPricePanOffset(0);
    setFlowPanOffset(0);
    try {
      const saved = localStorage.getItem(getStorageKeyScales(asset?.id));
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.scaleY) setScaleY(Math.max(0.3, Math.min(4.0, Number(parsed.scaleY))));
        if (parsed.scaleX) setScaleX(Math.max(0.15, Math.min(3.5, Number(parsed.scaleX))));
        if (parsed.scaleFlow) setScaleFlow(Math.max(0.3, Math.min(4.0, Number(parsed.scaleFlow))));
      } else {
        setScaleY(1.0);
        setScaleX(1.0);
        setScaleFlow(1.0);
      }
    } catch {
      setScaleY(1.0);
      setScaleX(1.0);
    }
  }, [asset?.id]);

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

  // Recuo inicial do tijolo em formação (px). Persistido: é preferência de leitura de tela, não
  // parâmetro de estratégia — cada operador quer o candle mais novo colado na borda ou folgado.
  const [chartShift, setChartShift] = useState<number>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_CHART_SHIFT);
      if (raw !== null) {
        const v = Number(raw);
        if (Number.isFinite(v) && v >= 0 && v <= CHART_SHIFT_MAX) return v;
      }
    } catch (e) {
      // Ignora
    }
    return CHART_SHIFT_DEFAULT;
  });
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_CHART_SHIFT, String(chartShift));
    } catch (e) {
      // Ignora
    }
  }, [chartShift]);

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

  // Painel de ajustes de exibição do gráfico (aberto pela engrenagem na linha da boleta).
  // Concentra tijolos/zoom/modo/escala do fluxo + legenda, tirando a tarima miúda sempre-visível.
  const [chartToolsOpen, setChartToolsOpen] = useState<boolean>(false);

  // Preferências visuais
  const [showOrderLines, setShowOrderLines] = useState<boolean>(true);
  // Níveis do pregão: traço fino na cor do nível + etiqueta curta. Persistido porque é preferência de
  // leitura de tela, não parâmetro de estratégia.
  const [showPriceLevels, setShowPriceLevels] = useState<boolean>(
    () => localStorage.getItem(STORAGE_KEY_PRICE_LEVELS) !== '0'
  );
  const togglePriceLevels = () => {
    setShowPriceLevels((prev) => {
      localStorage.setItem(STORAGE_KEY_PRICE_LEVELS, prev ? '0' : '1');
      return !prev;
    });
  };
  const [boxThickness, setBoxThickness] = useState<'thin' | 'ultrathin' | 'medium'>('thin');
  // Marca-d'água do ativo aberto (sigla + série + vigente) atrás dos tijolos. Anexo opcional:
  // quem quer a tela limpa desliga, e a escolha sobrevive à recarga.
  const [assetWatermark, setAssetWatermark] = useState<boolean>(
    () => localStorage.getItem(STORAGE_KEY_ASSET_WATERMARK) !== '0'
  );
  const toggleAssetWatermark = () => {
    setAssetWatermark((prev) => {
      try {
        localStorage.setItem(STORAGE_KEY_ASSET_WATERMARK, prev ? '0' : '1');
      } catch (e) {
        // Ignora
      }
      return !prev;
    });
  };
  // Setas ▲/▼ de sinal: ligado por padrão, mas o operador pode querer só os tijolos crus.
  const [showSignalArrows, setShowSignalArrows] = useState<boolean>(
    () => localStorage.getItem(STORAGE_KEY_SIGNAL_ARROWS) !== '0'
  );
  const toggleSignalArrows = () => {
    setShowSignalArrows((prev) => {
      try {
        localStorage.setItem(STORAGE_KEY_SIGNAL_ARROWS, prev ? '0' : '1');
      } catch (e) {
        // Ignora
      }
      return !prev;
    });
  };
  // Leitura das ordens em pontos (padrão, é a unidade do Robô) ou em valor (R$ da posição).
  const [orderValueMode, setOrderValueMode] = useState<OrderValueMode>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_ORDER_VALUE_MODE);
      if (saved === 'points' || saved === 'money') return saved;
    } catch (e) {
      // Ignora
    }
    return 'points';
  });
  const handleOrderValueMode = (next: OrderValueMode) => {
    setOrderValueMode(next);
    try {
      localStorage.setItem(STORAGE_KEY_ORDER_VALUE_MODE, next);
    } catch (e) {
      // Ignora
    }
  };
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

  // BOLETA: aberta ou recolhida. O estado mora aqui (a caixa é controlada) porque o canvas
  // precisa saber do vão: com ela aberta, o gráfico para a BOLETA_GAP (5px) da borda esquerda
  // da boleta; recolhida, o gráfico usa a tela toda até os mesmos 5px da margem. A preferência é a
  // mesma persistida em fluxo_boleta_open_v1 (mesma chave de antes — nada de migração nova).
  const [boletaOpen, setBoletaOpen] = useState<boolean>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_OPEN);
      return raw === null ? true : raw === 'true';
    } catch {
      return true;
    }
  });
  const handleBoletaOpenChange = (next: boolean) => {
    setBoletaOpen(next);
    try {
      localStorage.setItem(STORAGE_KEY_OPEN, String(next));
    } catch {
      // Ignora erro de storage
    }
  };
  // Reserva que a boleta aberta rouba do DESENHO: largura da caixa + vão (BOLETA_GAP), para o
  // último tijolo parar exatamente a 5px da borda esquerda dela. Abaixo de 560px a reserva engoliria
  // o gráfico inteiro — lá a caixa flutua sobre o canvas (como sempre foi no celular).
  const reserveForWidth = (w: number) =>
    !boletaOpen || w < 560 ? 0 : BOLETA_WIDTH + BOLETA_GAP;

  // Área clicável do selo "HISTÓRICO −N · VOLTE AO HOJE" (preenchida pelo draw do canvas)
  const scrollBadgeRef = useRef<{ x0: number; x1: number; y0: number; y1: number } | null>(null);

  // O handler de roda vive num ref para o listener nativo (não-passivo) nunca precisar ser
  // reanexado: com onWheel do React o preventDefault é ignorado (listener passivo) e a página
  // inteira rola junto com o zoom do gráfico.
  const wheelHandlerRef = useRef<(e: WheelEvent) => void>(null);

  // Salva no localStorage para persistir a escolha de escalas e layout do operador isoladas por ativo
  useEffect(() => {
    try {
      localStorage.setItem(
        getStorageKeyScales(asset?.id),
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
  }, [scaleX, scaleY, scaleFlow, flowPaneRatio, flowPanOffset, haHistSplit, asset?.id]);

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

  // Identifica o status do Heikin-Ashi do activeBox para mostrar no HUD.
  // Igual à cor da vela (Melhoria A): governado pela agressão REAL do box, não pela
  // média suavizada — senão a etiqueta do quadro fixo brigaria com a cor desenhada.
  const activeBoxHaState = useMemo(() => {
    if (!activeBox) return null;
    const effThreshold = minDeltaThreshold * (activeBox.regimeFactor ?? 1);
    const d = activeBox.delta ?? 0;
    const decisiveFlow = d !== 0 && Math.abs(d) >= effThreshold;
    // Espelha a exaustão da vela: compara com o box anterior do mesmo lado.
    const idx = allBoxes.findIndex((b) => b.index === activeBox.index);
    const prevDelta = idx > 0 ? allBoxes[idx - 1].delta ?? 0 : 0;
    const sameSide = d !== 0 && prevDelta !== 0 && Math.sign(d) === Math.sign(prevDelta);
    const losingForce = sameSide && decisiveFlow && Math.abs(d) <= Math.abs(prevDelta) * EXHAUST_DECAY_RATIO;
    if (!decisiveFlow || losingForce) return 'REVERSAL';
    return d > 0 ? 'UP' : 'DOWN';
  }, [activeBox, allBoxes, minDeltaThreshold]);

  // =========================================================================
  // RENDERIZAÇÃO DO CANVAS: RENKO (escala da config) & FLUXO HEIKIN-ASHI
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
    // Borda direita real da ÁREA DE DESENHO: com a boleta aberta ela recua para o vão (5px) da
    // borda esquerda da caixa; a régua de preços (chartWidth) continua ancorada na extrema direita.
    // Em tela estreita (< 560px) a reserva engoliria o gráfico — lá a boleta flutua sobre o desenho.
    const boletaReserve = reserveForWidth(width);
    const plotRight = width - rightAxisWidth - boletaReserve;
    // Margem direita do último tijolo, sempre o vão de 5px (o pedido do operador):
    // - boleta ABERTA: a reserva (largura + vão) já embute o vão — margem extra 0, senão o vão
    //   saía duplicado e os 90px antigos ainda criavam faixa morta;
    // - boleta RECOLHIDA: o desenho vai até 5px da régua (antes parava nos 50/90px da margem,
    //   desperdiçando tela), e o chip flutua sobre essa faixa sem tijolos.
    const effectiveRightMargin = boletaReserve > 0 ? 0 : Math.min(rightMargin, BOLETA_GAP);
    // Onde as linhas horizontais de referência param (grade, níveis, VWAP, preço atual, ordens):
    // a mesma borda que o último tijolo — 5px antes da boleta aberta, 5px antes da régua quando
    // recolhida. Sem isso a linha tracejada atravessava o vão e encostava na grade.
    const lineRight = plotRight - effectiveRightMargin;

    // Publica o QUADRO DE DESENHO em coordenadas de viewport (borda esquerda, largura útil e a
    // altura da linha divisória Preço ↔ Fluxo) em variáveis CSS, para o toast do App estacionar
    // centrado NELE — o MESMO centro do punho do divisor (handleX = lineRight/2) — e 14px acima
    // do traço, acompanhando o arrasto. A largura é o lineRight, não a do canvas: o canvas ainda
    // embute a reserva da boleta e a régua, e centrar por ele empurrava o aviso para a faixa da
    // boleta. Só escreve quando a assinatura muda: o draw roda a cada tick e setProperty a cada
    // medição custaria reflow à toa.
    const frameLeft = Math.round(rect.left);
    const frameWidth = Math.round(lineRight);
    const dividerViewportY = Math.round(rect.top + pricePaneHeight);
    const frameSig = `${frameLeft}|${frameWidth}|${dividerViewportY}`;
    if (frameSig !== lastFrameSigRef.current) {
      lastFrameSigRef.current = frameSig;
      const rootStyle = document.documentElement.style;
      rootStyle.setProperty('--fluxo-chart-left', `${frameLeft}px`);
      rootStyle.setProperty('--fluxo-chart-width', `${frameWidth}px`);
      rootStyle.setProperty('--fluxo-divider-y', `${dividerViewportY}px`);
    }

    // Fundo escuro profissional
    ctx.fillStyle = '#09090b';
    ctx.fillRect(0, 0, width, height);

    // =========================================================================
    // MARCA D'ÁGUA DO ATIVO — a assinatura do gráfico aberto, desenhada ANTES da
    // grade e dos tijolos para ficar por baixo de tudo, e recortada na área de
    // desenho (0..plotRight) para nunca invadir a régua de preços nem a faixa da
    // boleta. Um código só no corpo: o contrato que o gráfico realmente abre
    // (vigente do pregão; contínua quando não há vencimento confirmado).
    // Ligada/desligada na engrenagem, por gosto do operador.
    // =========================================================================
    if (assetWatermark) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, plotRight, pricePaneHeight);
      ctx.clip();
      const wmCx = plotRight / 2;
      const wmCy = pricePaneHeight / 2;
      const wmText = chartSymbolFor(asset).toUpperCase();
      // Corpo proporcional ao painel, com piso e teto: em monitor grande a sigla não pode
      // virar anúncio; em janela miúda não pode sumir. O teto horizontal agora é dividido
      // pelo comprimento do código (WINZ26 tem o dobro de letras de WIN) para a marca ocupar
      // a mesma mancha visual de antes.
      const wmMonogram = Math.max(30, Math.min(140, pricePaneHeight * 0.34, (plotRight * 0.5) / (wmText.length * 0.62)));
      const wmSub = Math.max(9, Math.min(15, wmMonogram * 0.16));
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      // 13% de branco sobre #09090b: ~+31 por canal — marca lida de primeira, mas ainda atrás
      // dos tijolos (o gráfico manda; a assinatura só diz de que ativo é). Por isso a marca nunca
      // vira legenda: ela é contexto, não dado.
      ctx.fillStyle = 'rgba(255,255,255,0.13)';
      ctx.font = `700 ${wmMonogram}px "Plus Jakarta Sans", sans-serif`;
      ctx.fillText(wmText, wmCx, wmCy - wmMonogram * 0.2);
      ctx.fillStyle = 'rgba(255,255,255,0.11)';
      ctx.font = `600 ${wmSub}px "Plus Jakarta Sans", sans-serif`;
      ctx.fillText(asset.watermarkCaption.toUpperCase(), wmCx, wmCy + wmMonogram * 0.3);
      // Spec sem vencimento declarado avisa atrás dos tijolos (não pode assinar em silêncio um
      // código que a corretora ainda não confirmou). Com vigente, o código do corpo já basta —
      // a linha miúda de papel ("VIGENTE") saiu por pedido do operador.
      if (!asset.activeContract) {
        ctx.fillStyle = 'rgba(255,255,255,0.1)';
        ctx.font = `${Math.max(8, wmSub - 1)}px "JetBrains Mono", monospace`;
        ctx.fillText('VENCIMENTO A CONFIRMAR', wmCx, wmCy + wmMonogram * 0.3 + wmSub * 1.6);
      }
      ctx.restore();
    }

    // Divisor interativo de painel (arrastável) — mesmo acabamento do divisor do histograma
    const mainDividerActive =
      dragMode === 'DIVIDER' ||
      (mousePos !== null && Math.abs(mousePos.y - pricePaneHeight) <= 7 && mousePos.x < plotRight);

    ctx.strokeStyle = mainDividerActive ? 'rgba(52, 211, 153, 0.65)' : '#27272a';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, pricePaneHeight);
    ctx.lineTo(width, pricePaneHeight);
    ctx.stroke();

    // Marcador central no divisor indicando que é redimensionável por arrasto
    const handleW = isMobile ? 34 : 48;
    const handleH = mainDividerActive ? 5 : 4;
    const handleX = lineRight / 2 - handleW / 2;
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
      ctx.arc(lineRight / 2 + d * (isMobile ? 7 : 10), pricePaneHeight, 1.1, 0, Math.PI * 2);
      ctx.fill();
    }

    // Etiquetas dos painéis, no mesmo padrão das subfaixas de fluxo. A do preço sobe para logo acima
    // da faixa da régua de tempo (que agora vive dentro do painel de preço), para não brigar com ela.
    if (!isMobile) {
      ctx.font = '8.5px "Plus Jakarta Sans", sans-serif';
      ctx.textAlign = 'left';
      ctx.fillStyle = '#52525b';
      const pricePaneLabel =
        chartSeries === 'range' ? 'PREÇO · RANGE' : chartSeries === 'tempo' ? 'PREÇO · TEMPO' : 'PREÇO · RENKO';
      ctx.fillText(pricePaneLabel, 4, pricePaneHeight - TIME_AXIS_BAND_H - 4);
      // No Heikin-Ashi a própria subfaixa já vem rotulada logo abaixo, então só rotula o
      // painel de fluxo nos modos onde ele ocupa a janela inteira. A etiqueta senta na folga do
      // topo: a régua de tempo não mora mais aí, o indicador é dono da janela.
      if (flowViewMode !== 'heikin_ashi') {
        ctx.fillText(
          flowViewMode === 'histogram' ? 'FLUXO · DELTA' : 'FLUXO · HÍBRIDO',
          4,
          pricePaneHeight + FLOW_TOP_PAD - 4
        );
      }
    }

    // Eixo de preços lateral: a faixa escura da régua vai do fim do DESENHO até a borda da tela,
    // então a boleta aberta fica sentada nessa faixa (encostada na grade) em vez de cobrir tijolos.
    // O traço de separação é a borda esquerda do desenho; o da régua só aparece sem vão (senão
    // ficaria uma linha dupla atrás da caixa).
    ctx.fillStyle = '#121215';
    ctx.fillRect(plotRight, 0, width - plotRight, height);
    ctx.strokeStyle = '#27272a';
    ctx.lineWidth = 1;
    const axisBorderX = boletaReserve > 0 ? plotRight : chartWidth;
    ctx.beginPath();
    ctx.moveTo(axisBorderX, 0);
    ctx.lineTo(axisBorderX, height);
    ctx.stroke();

    if (allBoxes.length === 0) {
      ctx.fillStyle = '#71717a';
      ctx.font = isMobile ? '11px "Plus Jakarta Sans", sans-serif' : '13px "Plus Jakarta Sans", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(
        `Aguardando ticks para formar ${
          chartSeries === 'range' ? `Range ${rangePoints} pts` : chartSeries === 'tempo' ? `candles de ${formatTimeframe(timeframeSec)}` : `Renko ${renkoScaleLabel(renkoBoxPoints, asset)}`
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
    // "Chart Shift": folga fixa entre a aresta direita do tijolo mais novo e a borda do desenho. Entra
    // na conta da largura ÚTIL junto com o vão da boleta — senão o auto-ajuste do Preencher contaria
    // com uma tela que não existe e empurraria a barra em formação para fora. Em janela estreita o
    // recuo nunca devora mais que 30% da tela: pedido grande vira o máximo útil.
    const roomWidth = Math.max(100, plotRight - effectiveRightMargin - (isMobile ? 16 : 30));
    const shiftPx = Math.max(0, Math.min(chartShift, roomWidth * 0.3));
    const availableWidth = Math.max(60, roomWidth - shiftPx);
    // Janela visível: no "Preencher" vale o "Tijolos X" pedido pelo operador (até 3000 — até
    // ~15 dias de uma só vez, para estudo); o auto-ajuste abaixo calcula o passo para que TODOS
    // caibam na largura da tela. No Compacto o vão fica no passo base (transborda = pan).
    const screenFitMax = Math.max(10, Math.floor(availableWidth / Math.max(2, baseSpacingStep * scaleX)));
    const viewCount = Math.max(
      10,
      Math.min(totalCount, spacingMode === 'fill' ? baseVisible : Math.min(baseVisible, screenFitMax))
    );

    if (totalCount === 0) return;

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
    // Usa viewCount (a janela PEDIDA) e não o tamanho da fatia: senão cada tijolo rolado para fora
    // encolhia o passo e o arrasto virava um zoom indesejado.
    const autoFitStep =
      viewCount > 1
        ? Math.min(isMobile ? 100 : 170, Math.max(1, availableWidth / (viewCount + 1)))
        : baseSpacingStep;

    const dynamicStep = spacingMode === 'fill' ? autoFitStep : baseSpacingStep;
    const stepX = dynamicStep * scaleX;
    stepXRef.current = Math.max(1, stepX);

    // No Preencher denso (multidia) o tijolo encolhe junto com o vão, para nunca sobrepor;
    // piso 1px: com milhares de tijolos o gráfico vira um "bloco" contínuo legível como silhueta
    boxWidth = Math.min(boxWidth, Math.max(1, stepX - (stepX >= 8 ? 2 : stepX >= 3 ? 0.5 : 0.2)));

    // Âncora à direita COM PAN CONTÍNUO: a série desliza effectiveScroll * stepX PIXELS, e não
    // "N tijolos inteiros." É isso que faz o arrasto horizontal seguir a mão 1:1 em vez de grudar
    // e pular de um em um bloco. scroll = 0 cola a aresta direita do tijolo em formação a shiftPx
    // da borda do desenho (o recuo inicial pedido).
    // lastBoxX é o CENTRO do tijolo: desconta meia largura para que a ARESTA direita pare no recuo
    // (senão metade dele invade o vão de 5px da boleta).
    const lastBoxAnchor = lineRight - shiftPx - boxWidth / 2;
    // Teto do pan: o CENTRO da barra mais nova nunca passa dos 40px da borda esquerda. Publicamos o
    // valor (em tijolos) para os handlers de arrasto/roda truncarem igual ao draw — sem isso o mouse
    // rolava até "todos os tijolos menos 10" e o candle em formação ia embora para fora da tela.
    const scrollMaxPx = Math.max(0, lastBoxAnchor - 40);
    const scrollMaxBars = Math.min(Math.max(0, totalCount - 3), scrollMaxPx / stepX);
    scrollMaxRef.current = scrollMaxBars;
    const effectiveScroll = Math.max(0, Math.min(scrollOffset, scrollMaxBars));
    const lastBoxX = lastBoxAnchor - effectiveScroll * stepX;

    // A barra mais nova é SEMPRE a última da fatia (endIdx fixo em totalCount). O pan recorta pelo
    // lado ESQUERDO: mantemos a janela pedida e trazemos só os tijolos que ainda têm um pixel na
    // tela. Antes o scroll cortava pelo lado direito, então a barra em formação saía da fatia e
    // sumia — o pior defeito possível numa tela de operação.
    const barsOnScreen = Math.max(1, Math.ceil(lastBoxX / stepX) + 1);
    const endIdx = totalCount;
    const startIdx = Math.max(0, endIdx - Math.max(viewCount, barsOnScreen));
    const displayedBoxes = allBoxes.slice(startIdx, endIdx);

    if (displayedBoxes.length === 0) return;

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
    // A fronteira do dia NOVO só nasce depois do leilão de abertura: antes disso
    // o traço ficaria colado na barra em formação, "caminhando" com o gráfico.
    // =======================================================================
    const lastBoxTime = allBoxes[totalCount - 1]?.timeEnd || allBoxes[totalCount - 1]?.timeStart || 0;
    const dayBoundaries: { x: number; label: string }[] = [];
    for (let i = 1; i < displayedBoxes.length; i++) {
      const prevDay = new Date(displayedBoxes[i - 1].timeEnd || displayedBoxes[i - 1].timeStart).getDate();
      const curDay = new Date(displayedBoxes[i].timeEnd || displayedBoxes[i].timeStart).getDate();
      if (curDay !== prevDay) {
        const bornAt = displayedBoxes[i].timeStart || displayedBoxes[i].timeEnd;
        if (lastBoxTime < bornAt + asset.session.auctionMinutes * 60_000) continue;
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

      // ── Melhoria A: cor governada pela AGRESSÃO REAL do box, não pela média do HA ──
      // O formato do candle (open/close/high/low acima) fica igual — é contexto. Mas a
      // COR agora vem do delta deste box contra o limiar efetivo (fixo × fator de regime),
      // a mesma régua que o robô usa. Assim a virada acende no exato box em que comprador
      // ou vendedor vence, em vez de esperar a média suavizada do Heikin-Ashi cruzar.
      const effThreshold = minDeltaThreshold * (b.regimeFactor ?? 1);
      const deltaThisBox = b.delta ?? 0;
      const decisiveFlow = deltaThisBox !== 0 && Math.abs(deltaThisBox) >= effThreshold;

      // ── Exaustão (pedido do operador): verde/vermelho que PERDE força é pó de reversão. ──
      // Se o box ainda é decisivo (passa o limiar) mas a agressão caiu bem abaixo do box
      // anterior DO MESMO LADO, ele vira CINZA: não é indecisão, é o movimento se esgotando.
      const prevDelta = i > 0 ? displayedBoxes[i - 1].delta ?? 0 : 0;
      const sameSideAsPrev =
        deltaThisBox !== 0 && prevDelta !== 0 && Math.sign(deltaThisBox) === Math.sign(prevDelta);
      const losingForce =
        sameSideAsPrev && decisiveFlow && Math.abs(deltaThisBox) <= Math.abs(prevDelta) * EXHAUST_DECAY_RATIO;

      // Cinza = indecisão (nenhum lado passou o limiar) OU exaustão (perdeu força).
      // Verde/vermelho = agressão decisiva e segurando (ou acelerando) a força.
      let state: 'UP' | 'DOWN' | 'REVERSAL';
      if (!decisiveFlow || losingForce) {
        state = 'REVERSAL';
      } else {
        state = deltaThisBox > 0 ? 'UP' : 'DOWN';
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
    const visibleBoxes = displayedBoxes.filter((_, i) => xs[i] >= -40 && xs[i] <= plotRight + 40);
    const boxesForScale = visibleBoxes.length > 0 ? visibleBoxes : displayedBoxes;

    let boxMin = Infinity;
    let boxMax = -Infinity;
    boxesForScale.forEach((b) => {
      boxMin = Math.min(boxMin, b.low, b.open, b.close);
      boxMax = Math.max(boxMax, b.high, b.open, b.close);
    });

    if (!isFinite(boxMin) || !isFinite(boxMax) || boxMin >= boxMax) {
      // eixo Y sem nenhum box na tela: a régua do ativo (preço real fresco ou basePrice do registro)
      const fallbackCenter = currentPrice > 0 ? currentPrice : referencePrice(asset);
      const span = asset?.id === 'WDO' ? 10 : (asset?.id === 'BTCBR' || asset?.id === 'BTC' ? 500 : 100);
      boxMin = fallbackCenter - span;
      boxMax = fallbackCenter + span;
    }

    let minPrice = boxMin;
    let maxPrice = boxMax;

    // Apenas expande a escala para ordens abertas se estiverem a até a distância máxima permitida
    const maxAllowedOrderDist = asset?.id === 'WDO' ? 25 : (asset?.id === 'BTCBR' || asset?.id === 'BTC' ? 1500 : 350);
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

    const isWdo = asset?.id === 'WDO';
    const isBtc = asset?.id === 'BTCBR' || asset?.id === 'BTC';
    const minRange = isWdo ? 4 : isBtc ? 100 : 50;
    const priceRange = Math.max(minRange, maxPrice - minPrice);
    // Folga da auto-escala (sem zoom Y): 7% do range com piso proporcional ao ativo
    const minPad = isWdo ? 1.5 : isBtc ? 60 : 16;
    const minPadZoom = isWdo ? 3.0 : isBtc ? 120 : 30;
    const pricePadding = scaleY === 1.0 ? Math.max(minPad, priceRange * 0.07) : Math.max(minPadZoom, priceRange * 0.12);
    minPrice -= pricePadding;
    maxPrice += pricePadding;

    const baseMidPrice = (maxPrice + minPrice) / 2;
    const minBaseRange = isWdo ? 2.5 : isBtc ? 40 : 10;
    const basePriceRange = Math.max(minBaseRange, maxPrice - minPrice);

    const effectivePriceRange = basePriceRange / Math.max(0.2, scaleY);
    const centerPrice = baseMidPrice + pricePanOffset;
    const effectiveMinPrice = centerPrice - effectivePriceRange / 2;
    const effectiveMaxPrice = centerPrice + effectivePriceRange / 2;

    const priceTopMargin = 12;
    // Base do painel de preço respeita a faixa da régua de tempo, que agora mora aí dentro.
    const priceBottomMargin = TIME_AXIS_BAND_H;
    const usablePriceHeight = Math.max(50, pricePaneHeight - priceTopMargin - priceBottomMargin);

    priceViewRef.current = {
      paneH: pricePaneHeight,
      bottom: priceBottomMargin,
      usableH: usablePriceHeight,
      center: centerPrice,
      range: effectivePriceRange,
    };

    // Guarda do tijolo em formação: enquanto o operador estiver "no hoje" (pan horizontal pequeno),
    // o arrasto vertical tem o pan limitado para que o preço atual nunca saia do painel de preço — era
    // assim que o candle "ia embora" ao puxar para cima/baixo. Assim que o histórico é revelado para
    // estudo (mais de 15% da janela rolada, no mínimo 2 tijolos), a guarda é liberada e o pan volta a
    // ser 100% livre: ali o preço atual pode (e deve) sair da tela.
    const nearToday = effectiveScroll <= Math.max(2, viewCount * 0.15);
    priceGuardRef.current = nearToday
      ? {
          baseMid: baseMidPrice,
          range: effectivePriceRange,
          usableH: usablePriceHeight,
          ref: currentPrice,
        }
      : null;

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
      if (xs[i] >= -40 && xs[i] <= plotRight + 40) {
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

    // Topo do fluxo: usa só a folga da etiqueta do painel. A régua de tempo (eixo X) subiu para
    // dentro do painel de preço, então o indicador pega a janela desde o divisor.
    const flowTopMargin = pricePaneHeight + FLOW_TOP_PAD;
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

    flowViewRef.current = { bandH: haBandHeight, range: effectiveHaRange };

    // =======================================================================
    // GRADE DINÂMICA DE PREÇOS (EIXO Y ADAPTATIVO POR ATIVO)
    // =======================================================================
    const targetTicks = Math.max(4, Math.min(14, Math.floor(usablePriceHeight / 38)));
    const rawStep = effectivePriceRange / targetTicks;
    let gridStep: number;
    if (isWdo) {
      const candidates = [0.5, 1.0, 2.0, 2.5, 5.0, 10.0, 20.0, 25.0, 50.0];
      gridStep = candidates.find((c) => c >= rawStep) ?? (Math.ceil(rawStep / 50) * 50);
    } else if (isBtc) {
      const candidates = [20, 50, 100, 200, 500, 1000, 2000, 5000];
      gridStep = candidates.find((c) => c >= rawStep) ?? (Math.ceil(rawStep / 5000) * 5000);
    } else {
      const candidates = [5, 10, 25, 50, 100, 200, 250, 500, 1000];
      gridStep = candidates.find((c) => c >= rawStep) ?? (Math.ceil(rawStep / 1000) * 1000);
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
        ctx.lineTo(lineRight, y);
        ctx.stroke();
        ctx.fillText(formatPrice(p, asset), chartWidth + rightAxisWidth / 2, y + 3.5);
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
          ctx.lineTo(lineRight, y);
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
        ctx.lineTo(lineRight, zeroY);
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
          const x1 = Math.min(lineRight, s.x1);
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
          ctx.lineTo(lineRight, upperThresholdY);
          ctx.stroke();
          ctx.setLineDash([]);
        }

        if (lowerThresholdY <= height - 14) {
          ctx.strokeStyle = 'rgba(239, 68, 68, 0.35)';
          ctx.setLineDash([2, 4]);
          ctx.beginPath();
          ctx.moveTo(0, lowerThresholdY);
          ctx.lineTo(lineRight, lowerThresholdY);
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
        (mousePos !== null && Math.abs(mousePos.y - histDividerY) <= 7 && mousePos.x < lineRight);

      ctx.strokeStyle = histDividerActive ? 'rgba(52, 211, 153, 0.65)' : '#27272a';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, histDividerY);
      ctx.lineTo(lineRight, histDividerY);
      ctx.stroke();

      const hHandleW = isMobile ? 34 : 48;
      const hHandleH = histDividerActive ? 5 : 4;
      ctx.fillStyle = histDividerActive ? '#10b981' : '#27272a';
      ctx.beginPath();
      ctx.roundRect(lineRight / 2 - hHandleW / 2, histDividerY - hHandleH / 2, hHandleW, hHandleH, 2.5);
      ctx.fill();
      ctx.fillStyle = histDividerActive ? '#ecfdf5' : '#a1a1aa';
      for (let d = -1; d <= 1; d++) {
        ctx.beginPath();
        ctx.arc(lineRight / 2 + d * (isMobile ? 7 : 10), histDividerY, 1.1, 0, Math.PI * 2);
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
      ctx.lineTo(lineRight, histZeroY);
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
          ctx.lineTo(lineRight, y);
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
          const x1 = Math.min(lineRight, edge - boxWidth);
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

    // Recorte na borda do desenho: box em formação, rótulos de sinal (COMPRA/VENDA) e pavios
    // não podem invadir o vão da boleta nem a faixa de 5 px antes da régua.
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, Math.max(0, lineRight), height);
    ctx.clip();

    // Linha CVD (desenhada sutilmente em todos os modos)
    ctx.strokeStyle = flowViewMode === 'heikin_ashi' ? 'rgba(56, 189, 248, 0.45)' : '#38bdf8';
    ctx.lineWidth = flowViewMode === 'heikin_ashi' ? 1.0 : 1.5;
    ctx.beginPath();
    let hasStartedCvd = false;
    displayedBoxes.forEach((b, i) => {
      const x = xs[i];
      if (x < -20 || x > plotRight + 20) return;
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
    // DESENHO DOS TIJOLOS RENKO (PAINEL SUPERIOR)
    // =======================================================================
    let lastBuySignalX = -999;
    let lastSellSignalX = -999;

    displayedBoxes.forEach((b, i) => {
      const centerX = xs[i];
      if (centerX < -30 || centerX > plotRight + 30) return;

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

      // Recorte vertical do painel de preço: com o arrasto livre o centro da escala sai da
      // auto-escala, então tijolos fora da janela deixam de cair dentro do painel. Sem isso eles
      // babariam sobre o divisor e sobre a janela de fluxo (linhas de preço/ordens já se guardam).
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, Math.max(0, lineRight), Math.max(1, pricePaneHeight - 1));
      ctx.clip();

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
      // Setas ▲/▼ são preferência de leitura (opção "Setas de sinal" na janela Dados), além do
      // dia de contexto estático, que nunca operou e continua sem marcas.
      const hideSignals = b.isStaticContext === true || !showSignalArrows;
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
        // Padrão único em TODOS os navegadores: ▲ C compra / ▼ V venda — a palavra "MÃE" foi
        // abolida do gráfico (poluía a tela; papel e lado continuam distinguíveis nas linhas
        // de ordem pela cor e pela tag P1/P2/RET, que só existem quando há pirâmide/reteste).
        ctx.fillText('▲ C', centerX, lowY + (isMobile ? 12 : 16));
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
        ctx.fillText('▼ V', centerX, highY - (isMobile ? 6 : 10));
        lastSellSignalX = centerX;
      } else if (!hideSignals && b.convergenceType === 'SELL_CONVERGENCE' && !isMobile && centerX - lastSellSignalX >= 22) {
        ctx.fillStyle = '#dc2626';
        ctx.font = '8px "Plus Jakarta Sans"';
        ctx.textAlign = 'center';
        ctx.fillText('▼', centerX, highY - 5);
      }
      ctx.restore();

      // Recorte da janela de fluxo (espelho do recorte de preço, para o outro lado): com o pan
      // livre os candles Heikin-Ashi e as barras de Delta fora da janela não podem subir por cima
      // do divisor nem descer sobre o eixo de horários.
      const flowClipTop = Math.max(0, pricePaneHeight);
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, flowClipTop, Math.max(0, lineRight), Math.max(1, height - 24 - flowClipTop));
      ctx.clip();

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
      ctx.restore();
    });
    ctx.restore();

    boxPositionsRef.current = boxPositions;

    // =======================================================================
    // LINHA DE ABERTURA DE DIA (contexto ↔ dia-alvo): traço fino só dentro do
    // painel de preço. Antes ela descia full-height, furava o divisor e o fluxo
    // inteiro — "vazava a caixa" e virava ruído na janela de baixo.
    // =======================================================================
    dayBoundaries.forEach((db) => {
      if (db.x < 4 || db.x > lineRight - 4) return;
      ctx.strokeStyle = 'rgba(245, 158, 11, 0.45)';
      ctx.lineWidth = 1;
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.moveTo(db.x, 6);
      ctx.lineTo(db.x, pricePaneHeight - 3);
      ctx.stroke();
      ctx.setLineDash([]);
      // Etiqueta limpa: só a data em texto âmbar miúdo, sem placa — o traço já separa
      // os dias e a etiqueta grande competia com o selo HISTÓRICO no topo.
      ctx.font = isMobile ? 'bold 7px "Plus Jakarta Sans"' : 'bold 7.5px "Plus Jakarta Sans"';
      ctx.textAlign = 'center';
      const lw = ctx.measureText(db.label).width + 6;
      const lx = Math.min(Math.max(db.x, lw / 2 + 2), lineRight - lw / 2 - 2);
      ctx.fillStyle = '#f59e0b';
      ctx.fillText(db.label, lx, 14);
    });

    // Selo "HISTÓRICO -N": avisa que o operador rolou para trás; um clique nele volta ao hoje
    if (effectiveScroll >= 1) {
      ctx.font = isMobile ? 'bold 8px "Plus Jakarta Sans"' : 'bold 9px "Plus Jakarta Sans"';
      ctx.textAlign = 'right';
      const backTxt = `⟨ HISTÓRICO −${Math.round(effectiveScroll)} · VOLTE AO HOJE`;
      const bw = ctx.measureText(backTxt).width + 14;
      const bx = lineRight - 8;
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
    // RÉGUA HORIZONTAL DE TEMPO (EIXO X) — dentro do painel de preço, colada
    // acima do divisor arrastável. O indicador abaixo fica com a janela livre.
    // =======================================================================
    const timeAxisY = pricePaneHeight - TIME_AXIS_BASELINE;
    ctx.fillStyle = '#52525b';
    ctx.font = isMobile ? '8px "JetBrains Mono"' : '9px "JetBrains Mono"';
    ctx.textAlign = 'center';

    let lastLabelX = -100;
    const minLabelSpacing = isMobile ? 55 : 70;
    displayedBoxes.forEach((b, i) => {
      const x = xs[i];
      if (x >= 20 && x <= lineRight - 20 && x - lastLabelX >= minLabelSpacing) {
        const timeStr = new Date(b.timeEnd || b.timeStart).toLocaleTimeString('pt-BR', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        });
        ctx.fillText(timeStr, x, timeAxisY);
        lastLabelX = x;
      }
    });

    // =======================================================================
    // CAMADA DE ETIQUETAS: placas limpas, com anti-sobreposição
    // =======================================================================
    // Ordem mãe, pirâmide e parcial costumam cair a poucos pontos uma da outra. Sem deslocar, as
    // etiquetas viram um borrão empilhado e a tela "carrega". Estas duas listas guardam o espaço
    // vertical já ocupado — uma para as tags do corpo do gráfico, outra para os números da régua.
    // Níveis do pregão e preço atual também se registram aqui, então nada briga com nada.
    const tagBands: { y0: number; y1: number }[] = [];
    const axisBands: { y0: number; y1: number }[] = [];

    // Centro livre mais próximo do y real; null quando o painel está cheio — nesse caso a etiqueta
    // nem é desenhada (a linha continua no preço correto; é melhor faltar texto do que mentir).
    const freeBand = (
      center: number,
      half: number,
      bands: { y0: number; y1: number }[],
      top = 2,
      bottom = pricePaneHeight - 2
    ): number | null => {
      for (let step = 0; step <= 7; step++) {
        for (const dir of step === 0 ? [0] : [-1, 1]) {
          // Passo (2*half + 4): meio dedo de folga entre uma etiqueta e outra — placa colada
          // sem borda já parece uma só, e é exatamente o empilhamento da mãe com a pirâmide.
          const c = center + dir * step * (half * 2 + 4);
          if (c - half < top || c + half > bottom) continue;
          if (bands.some((b) => c - half < b.y1 + 2 && c + half > b.y0 - 2)) continue;
          bands.push({ y0: c - half, y1: c + half });
          return c;
        }
      }
      return null;
    };

    // Valor ao vivo da posição: pontos (unidade nativa do robô) ou R$ (valor do ponto do ativo ×
    // contratos ainda abertos). Sinal = cor: verde positivo, vermelho negativo.
    const fmtLivePoints = (pts: number) => {
      const v = Math.round(pts * 10) / 10;
      const abs = Number.isInteger(v) ? String(Math.abs(v)) : Math.abs(v).toFixed(1);
      return `${v > 0 ? '+' : v < 0 ? '-' : ''}${abs}p`;
    };
    const fmtLiveBRL = (v: number) => {
      const a = Math.abs(v);
      return `${v > 0 ? '+' : v < 0 ? '-' : ''}R$${a >= 100 ? a.toFixed(0) : a.toFixed(2)}`;
    };
    const liveColor = (v: number) => (v > 0 ? '#34d399' : v < 0 ? '#fb7185' : '#a1a1aa');

    // Etiqueta de ordem: placa escura + contorno na cor da linha, texto curto na cor da linha e o
    // valor ao vivo na cor do resultado. Substitui o bloco saturado que existia antes.
    const drawOrderTag = (opts: {
      priceY: number;
      role: string;
      value?: string;
      valueColor?: string;
      lineColor: string;
    }) => {
      const { priceY, role, value, valueColor = '#d4d4d8', lineColor } = opts;
      ctx.font = isMobile ? 'bold 7.5px "JetBrains Mono"' : 'bold 8.5px "JetBrains Mono"';
      const roleW = ctx.measureText(role).width;
      const valW = value ? ctx.measureText(value).width + 6 : 0;
      const w = roleW + valW + 12;
      const placed = freeBand(priceY, 8.5, tagBands);
      if (placed === null) return;
      // Mesma proteção de sempre: encostado no topo, a placa cede lugar ao selo do dia.
      const x = placed <= 56 ? 245 : 8;
      ctx.fillStyle = 'rgba(9, 9, 11, 0.88)';
      ctx.beginPath();
      ctx.roundRect(x, placed - 8.5, w, 17, 3);
      ctx.fill();
      ctx.strokeStyle = lineColor;
      ctx.lineWidth = 1;
      ctx.globalAlpha = 0.55;
      ctx.stroke();
      ctx.globalAlpha = 1;
      if (Math.abs(placed - priceY) > 1) {
        // Fio-guia até o y real: a etiqueta deslocada não pode parecer estar em outro preço.
        ctx.globalAlpha = 0.4;
        ctx.beginPath();
        ctx.moveTo(x + 2, priceY);
        ctx.lineTo(x + 2, placed);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      ctx.textAlign = 'left';
      ctx.fillStyle = lineColor;
      ctx.fillText(role, x + 6, placed + 3);
      if (value) {
        ctx.fillStyle = valueColor;
        ctx.fillText(value, x + 6 + roleW + 6, placed + 3);
      }
    };

    // Número na régua: só o valor, pintado com a cor da linha — sem placa colorida atrás.
    const drawAxisValue = (priceY: number, price: number, color: string) => {
      const placed = freeBand(priceY, 8.5, axisBands);
      if (placed === null) return;
      const txt = formatPrice(price, asset);
      let px = isMobile ? 8 : 9.5;
      ctx.font = `bold ${px}px "JetBrains Mono"`;
      // A régua é estreita (46px mobile / 64px desktop): apertar o corpo é melhor que cortar número.
      while (px > 6.5 && ctx.measureText(txt).width > rightAxisWidth - 8) {
        px -= 0.5;
        ctx.font = `bold ${px}px "JetBrains Mono"`;
      }
      if (Math.abs(placed - priceY) > 1) {
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.globalAlpha = 0.45;
        ctx.beginPath();
        ctx.moveTo(chartWidth + 2, priceY);
        ctx.lineTo(chartWidth + 2, placed);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      ctx.fillStyle = color;
      ctx.textAlign = 'center';
      ctx.fillText(txt, chartWidth + rightAxisWidth / 2, placed + 3);
    };

    // =======================================================================
    // NÍVEIS RELEVANTES DO PREGÃO (leilão, abertura, VWAP, máx/mín e o dia anterior:
    // fechamento e ajuste): tracejado fino com a cor do nível e etiqueta curta à esquerda. Vem
    // ANTES do preço atual e das linhas de ordem de propósito: referência de estudo não pode
    // brigar com o que se opera.
    // =======================================================================
    if (showPriceLevels && priceLevels.length > 0) {
      ctx.font = isMobile ? '8px "JetBrains Mono", monospace' : '9px "JetBrains Mono", monospace';
      ctx.textAlign = 'left';
      let lastLabelY = -999;
      priceLevels.forEach((lv) => {
        const y = priceToY(lv.price);
        if (y < 8 || y > pricePaneHeight - 6) return;
        ctx.strokeStyle = levelRgba(lv.color, 0.45);
        ctx.lineWidth = 1;
        ctx.setLineDash([5, 5]);
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(lineRight, y);
        ctx.stroke();
        ctx.setLineDash([]);
        // Duas etiquetas no mesmo pixel viram ruído: a segunda fica só com o traço.
        if (Math.abs(y - lastLabelY) < 12) return;
        lastLabelY = y;
        const tag = `${lv.label} ${formatPrice(lv.price, asset)}`;
        const tw = ctx.measureText(tag).width + 8;
        ctx.fillStyle = 'rgba(9, 9, 11, 0.74)';
        ctx.beginPath();
        ctx.roundRect(4, y - 8, tw, 12, 2);
        ctx.fill();
        // A etiqueta usa a cor do nível, mas um tom acima do traço para continuar legível.
        ctx.fillStyle = levelRgba(lv.color, 0.85);
        ctx.fillText(tag, 8, y + 1.5);
        // Reserva a faixa: etiqueta de nível e etiqueta de ordem no mesmo y virariam ruído.
        tagBands.push({ y0: y - 8, y1: y + 4 });
      });
    }

    // =======================================================================
    // VWAP ACUMULADA DO DIA (curva laranja): um ponto por tijolo, com a VWAP calculada até o
    // fechamento dele. Quebra a cada novo pregão — VWAP é por dia, então ontem também tem a sua.
    // =======================================================================
    if (showPriceLevels && vwapCurve && vwapCurve.points.length > 1) {
      ctx.strokeStyle = levelRgba(VWAP_CURVE_COLOR, 0.9);
      ctx.lineWidth = 1.4;
      ctx.setLineDash([]);
      let opened = false;
      let prevSeg = -1;
      let tip: { x: number; y: number } | null = null;
      for (const p of vwapCurve.points) {
        const x = lastBoxX - (endIdx - 1 - p.index) * stepX;
        const y = priceToY(p.price);
        if (x < 0 || x > lineRight || y < 2 || y > pricePaneHeight - 2) {
          // Fora da tela: fecha o traço atual para não riscar por cima do vazio.
          if (opened) {
            ctx.stroke();
            opened = false;
          }
          continue;
        }
        if (!opened || p.seg !== prevSeg) {
          if (opened) ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(x, y);
          opened = true;
        } else {
          ctx.lineTo(x, y);
        }
        prevSeg = p.seg;
        tip = { x, y };
      }
      if (opened) ctx.stroke();
      // O traço termina num ponto no preço corrente da VWAP. A etiqueta de texto saiu do gráfico a
      // pedido do operador: o número já existe na régua e a placa só competia com as etiquetas das
      // ordens (que agora têm prioridade de espaço).
      if (tip) {
        ctx.fillStyle = levelRgba(VWAP_CURVE_COLOR, 0.95);
        ctx.beginPath();
        ctx.arc(tip.x, tip.y, 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }

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
      ctx.lineTo(lineRight, currentPriceY);
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
      // O número do preço atual é o mais importante da régua: reserva a faixa dele para os valores
      // das ordens não subirem por cima (eles deslocam sozinhos, com fio-guia).
      axisBands.push({ y0: currentPriceY - 9, y1: currentPriceY + 9 });
    }

    // Linhas de Posições (Entrada, Reteste, Parcial, Trailing SL e TP)
    if (showOrderLines && openOrders.length > 0) {
      openOrders.forEach((o) => {
        const isPending = o.status === 'PENDING_LIMIT';
        const targetPrice = isPending && o.limitPrice ? o.limitPrice : o.entryPrice;
        const entryY = priceToY(targetPrice);
        // Abreviatura pedida (etiqueta o menor possível): ▲ C = compra, ▼ V = venda — a
        // palavra "MÃE" saiu da etiqueta para não poluir a tela; o papel continua legível
        // pelo prefixo (P1, P2, RET) que só existe nas pirâmides e nos retestes Limit.
        const side = o.type === 'BUY' ? '▲ C' : '▼ V';
        const ctros = o.remainingContracts ?? o.contracts ?? 1;

        // 1. Linha de Entrada / Reteste Limitado
        if (entryY >= 0 && entryY <= pricePaneHeight) {
          const lineColor = isPending ? '#f59e0b' : o.type === 'BUY' ? '#10b981' : '#ef4444';
          ctx.strokeStyle = lineColor;
          ctx.lineWidth = 1.75;
          ctx.setLineDash(isPending ? [6, 4] : [4, 2]);
          ctx.beginPath();
          ctx.moveTo(0, entryY);
          ctx.lineTo(lineRight, entryY);
          ctx.stroke();
          ctx.setLineDash([]);

          // No lugar do preço de entrada, o VALOR AO VIVO da posição (verde se positiva,
          // vermelho se negativa) — em pontos ou em R$, na opção da janela Dados. O preço de entrada
          // não se perde: é o número que agora aparece na régua, na cor da linha.
          const livePts = o.type === 'BUY' ? currentPrice - o.entryPrice : o.entryPrice - currentPrice;
          const liveTxt = isPending
            ? `Δ${Math.abs(Math.round((targetPrice - currentPrice) * 10) / 10)}p`
            : orderValueMode === 'money'
            ? fmtLiveBRL(pointsToBRL(livePts, ctros, asset))
            : fmtLivePoints(livePts);
          const roleTag = isPending
            ? `RET ${side}`
            : o.role === 'PYRAMID'
            ? `P${o.pyramidLevel || 1} ${side}`
            : side;

          drawOrderTag({
            priceY: entryY,
            role: `${roleTag} ${ctros}ct`,
            value: liveTxt,
            valueColor: isPending ? '#fbbf24' : liveColor(livePts),
            lineColor,
          });
          drawAxisValue(entryY, targetPrice, lineColor);
        }

        // 2. Linha de Saída Parcial (+50 pts, apenas em estratégias clássicas, nunca na ordem mãe da pirâmide)
        if (enablePartialExit && o.role !== 'MAIN' && o.role !== 'PYRAMID' && !o.partialExecuted && o.contracts > 1 && !isPending) {
          const partialTarget =
            o.type === 'BUY' ? o.entryPrice + partialPoints : o.entryPrice - partialPoints;
          const partialY = priceToY(partialTarget);

          if (partialY >= 0 && partialY <= pricePaneHeight) {
            const lineColor = '#06b6d4';
            ctx.strokeStyle = lineColor;
            ctx.lineWidth = 1.5;
            ctx.setLineDash([4, 4]);
            ctx.beginPath();
            ctx.moveTo(0, partialY);
            ctx.lineTo(lineRight, partialY);
            ctx.stroke();
            ctx.setLineDash([]);

            drawOrderTag({
              priceY: partialY,
              role: 'PAR',
              value: `+${partialPoints}p`,
              valueColor: '#22d3ee',
              lineColor,
            });
            drawAxisValue(partialY, partialTarget, lineColor);
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
            ctx.lineTo(lineRight, slY);
            ctx.stroke();
            ctx.setLineDash([]);

            // Etiqueta clean: só o papel (SL / SL BE) e a distância em pontos. O preço do stop
            // passa a ser lido na régua, como número colorido — sem placa saturada.
            const slPts = Math.round(Math.abs(o.entryPrice - o.stopLoss) * 10) / 10;
            drawOrderTag({
              priceY: slY,
              role: isProtected ? 'SL BE' : 'SL',
              value: isProtected ? `+${slPts}p` : `-${slPts}p`,
              valueColor: isProtected ? '#fbbf24' : '#fb7185',
              lineColor: isProtected ? '#f59e0b' : '#ef4444',
            });
            drawAxisValue(slY, o.stopLoss, isProtected ? '#f59e0b' : '#ef4444');
          } else {
            // SL fora da tela: seta + texto colorido na borda (sem placa), para não brigar com
            // o preço atual da régua.
            const below = slY > pricePaneHeight;
            ctx.fillStyle = isProtected ? '#f59e0b' : '#ef4444';
            ctx.font = 'bold 8px "JetBrains Mono"';
            ctx.textAlign = 'center';
            ctx.fillText(
              `${below ? '▼' : '▲'} SL ${formatPrice(o.stopLoss, asset)}`,
              chartWidth + rightAxisWidth / 2,
              below ? pricePaneHeight - 6 : 12
            );
          }
        }

        // 4. Take Profit (apenas se configurado > 0)
        if (o.takeProfit > 0) {
          const tpY = priceToY(o.takeProfit);
          // Papel e cor definidos antes do desenho: a etiqueta dentro da tela e o aviso na borda
          // precisam da mesma identidade visual do alvo.
          const isPyramidTp = o.role === 'PYRAMID';
          const tpLineColor = isPyramidTp ? '#0ea5e9' : '#10b981';
          if (tpY >= 0 && tpY <= pricePaneHeight) {
            ctx.strokeStyle = tpLineColor;
            ctx.lineWidth = 1.5;
            ctx.setLineDash([4, 4]);
            ctx.beginPath();
            ctx.moveTo(0, tpY);
            ctx.lineTo(lineRight, tpY);
            ctx.stroke();
            ctx.setLineDash([]);

            // Mesma clean-up do SL: papel + distância; o preço do alvo vai para a régua.
            const tpPts = Math.round(Math.abs(o.takeProfit - o.entryPrice) * 10) / 10;
            drawOrderTag({
              priceY: tpY,
              role: isPyramidTp ? `ALVO P${o.pyramidLevel || 1}` : 'TP',
              value: `+${tpPts}p`,
              valueColor: isPyramidTp ? '#38bdf8' : '#34d399',
              lineColor: tpLineColor,
            });
            drawAxisValue(tpY, o.takeProfit, tpLineColor);
          } else {
            // Alvo fora da tela: texto na cor da linha, sem placa.
            const above = tpY < 0;
            ctx.fillStyle = tpLineColor;
            ctx.font = 'bold 8px "JetBrains Mono"';
            ctx.textAlign = 'center';
            ctx.fillText(
              `${above ? '▲' : '▼'} TP ${formatPrice(o.takeProfit, asset)}`,
              chartWidth + rightAxisWidth / 2,
              above ? 12 : pricePaneHeight - 6
            );
          }
        }
      });
    }

    // =======================================================================
    // CROSSHAIR INTERATIVO & LEITURA DIRETA DO PREÇO NO EIXO Y
    // =======================================================================
    if (mousePos && mousePos.x < plotRight) {
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
        ctx.lineTo(lineRight, mousePos.y);
        ctx.stroke();
        ctx.setLineDash([]);

        // Badge de preço flutuante na régua do eixo Y
        if (mousePos.y <= pricePaneHeight) {
          const hoveredPrice = snapToTick(yToPrice(mousePos.y), asset);
          ctx.fillStyle = '#27272a';
          ctx.fillRect(chartWidth + 1, mousePos.y - 8, rightAxisWidth - 2, 16);
          ctx.strokeStyle = '#71717a';
          ctx.strokeRect(chartWidth + 1, mousePos.y - 8, rightAxisWidth - 2, 16);
          ctx.fillStyle = '#fafafa';
          ctx.font = isMobile ? 'bold 8.5px "JetBrains Mono"' : 'bold 9.5px "JetBrains Mono"';
          ctx.textAlign = 'center';
          ctx.fillText(
            formatPrice(hoveredPrice, asset),
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
    showPriceLevels,
    priceLevels,
    vwapCurve,
    asset,
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
    boletaOpen,
    chartShift,
    showSignalArrows,
    orderValueMode,
    assetWatermark,
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
    // Mesma conta do desenho: folga do topo do fluxo (etiqueta) + margem inferior 16
    const usableFlowH = Math.max(40, flowPaneH - FLOW_TOP_PAD - 16);
    const clampedSplit = Math.max(0.3, Math.min(0.85, haHistSplit));
    const haBandH = flowViewMode === 'heikin_ashi' ? usableFlowH * clampedSplit : usableFlowH;
    return {
      isMobile,
      chartW,
      // Borda direita da área de desenho: com a boleta aberta, o vão (5px) antes da borda esquerda dela
      plotW: chartW - reserveForWidth(canvasW),
      flowPaneH,
      pricePaneH,
      usableFlowH,
      haBandH,
      // Divisor interno Heikin-Ashi ↔ histograma (só existe no modo Heikin-Ashi)
      histDividerY: pricePaneH + FLOW_TOP_PAD + haBandH + 6,
    };
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const { chartW, plotW, pricePaneH, histDividerY } = getFlowDividerLayout(rect.width, rect.height);

    // 0. Clique no selo "VOLTE AO HOJE": zera o scroll e ancora de novo na barra mais recente
    const badge = scrollBadgeRef.current;
    if (badge && x >= badge.x0 && x <= badge.x1 && y >= badge.y0 && y <= badge.y1) {
      setScrollOffset(0);
      return;
    }

    // 1. Clique no divisor entre o gráfico de preço e a janela de fluxo
    // (tolerância 5: logo ACIMA fica a faixa da régua de tempo, que é do eixo X)
    if (Math.abs(y - pricePaneH) <= 5 && x < plotW) {
      setDragMode('DIVIDER');
      setDragStartY(e.clientY);
      setDragStartFlowRatio(flowPaneRatio);
      setIsDragging(true);
      return;
    }

    // 1b. Clique no divisor interno: arrasta a altura do histograma de Delta
    if (flowViewMode === 'heikin_ashi' && Math.abs(y - histDividerY) <= 5 && x < plotW) {
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
    } else if (y > pricePaneH - TIME_AXIS_BAND_H && y < pricePaneH && x < plotW) {
      // 4. Clique na faixa da régua de tempo (dentro do painel de preço, acima do divisor):
      // arrasta a escala do Eixo X
      setDragMode('X_AXIS');
      setDragStartX(e.clientX);
      setDragStartScaleX(scaleX);
      setDragStartScroll(scrollOffset);
      setIsDragging(true);
    } else {
      // 5. CORPO do gráfico — e a faixa livre do vão da boleta, que se comporta como corpo:
      // PAN LIVRE nas duas direções, sem tecla nenhuma. Horizontal rola o tempo; vertical move
      // o painel que foi agarrado (preço em cima, janela de fluxo embaixo) colado no mouse.
      dragPaneRef.current = y > pricePaneH ? 'flow' : 'price';
      setDragMode('CHART');
      setIsDragging(true);
      setDragStartX(e.clientX);
      setDragStartY(e.clientY);
      setDragStartScroll(scrollOffset);
      setDragStartPanOffset(pricePanOffset);
      setDragStartFlowPanOffset(flowPanOffset);
    }
  };

  // Truncar do pan vertical com a guarda do tijolo em formação: devolve o mesmo pan se a barra mais
  // nova continua dentro do painel de preço; senão cola no limite que a mantém visível (10px de
  // folga do topo/base). Sem a guarda (histórico revelado) o pan segue livre.
  const clampPricePan = (pan: number) => {
    const gd = priceGuardRef.current;
    if (!gd || gd.usableH <= 0 || gd.range <= 0) return pan;
    const half = gd.range / 2;
    const margin = (gd.range * 10) / gd.usableH;
    const rel = gd.ref - gd.baseMid;
    const lo = rel - half + margin;
    const hi = rel + half - margin;
    // Zoom vertical mais fundo que o painel: a janela não comporta mais nada além do preço atual,
    // então ele é o centro possível — é preferível ver só o candle em formação a ver nada.
    if (lo > hi) return rel;
    return Math.max(lo, Math.min(hi, pan));
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
          setPricePanOffset(clampPricePan(dragStartPanOffset + deltaY * 1.5));
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
        // Sinal negativo: o conteúdo SEGUE a mão (puxe para a direita e os tijolos vão para a
        // direita, revelando o histórico pela esquerda). Dividir pelo passo REAL (e não por 22px
        // fixos) é o que faz andar 1:1.
        const offsetDelta = -deltaX / Math.max(1, stepXRef.current);
        // Limite publicado pelo draw: a barra mais nova (o candle em formação) nunca sai da tela.
        const maxScroll = Math.max(0, scrollMaxRef.current);
        setScrollOffset(Math.max(0, Math.min(maxScroll, dragStartScroll + offsetDelta)));

        // Pan vertical LIVRE (antes exigia Shift e tinha fator fixo): converte os px do mouse na
        // mesma unidade da escala do painel agarrado, então o tijolo embaixo do cursor não escapa.
        const deltaY = e.clientY - dragStartY;
        if (dragPaneRef.current === 'flow') {
          const f = flowViewRef.current;
          const ptsPerPx = f && f.bandH > 0 ? f.range / f.bandH : 3;
          setFlowPanOffset(dragStartFlowPanOffset + deltaY * ptsPerPx);
        } else {
          const v = priceViewRef.current;
          const ptsPerPx = v && v.usableH > 0 ? v.range / v.usableH : 1.5;
          setPricePanOffset(clampPricePan(dragStartPanOffset + deltaY * ptsPerPx));
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
    const { chartW, plotW, pricePaneH, histDividerY } = getFlowDividerLayout(rect.width, rect.height);

    if (Math.abs(y - pricePaneH) <= 5 && x < plotW) {
      // Duplo clique no divisor: reseta para altura padrão de 33%
      setFlowPaneRatio(0.33);
    } else if (flowViewMode === 'heikin_ashi' && Math.abs(y - histDividerY) <= 5 && x < plotW) {
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
    } else if (y > pricePaneH - TIME_AXIS_BAND_H && y < pricePaneH && x < plotW) {
      // Duplo clique na faixa da régua de tempo (no pé do painel de preço): reseta escala horizontal!
      setScaleX(1.0);
      setScrollOffset(0);
    } else {
      // Duplo clique no corpo: auto-escala total. É o "desfaz" do arrasto livre — o gráfico
      // encaixa de novo tudo o que está visível (pan e zoom voltam ao zero).
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
    // Vão da boleta: a roda na faixa livre entre o desenho e a régua zooma como no corpo do
    // gráfico (Alt) ou rola para trás — nunca mexe na escala da régua de preços.
    const plotW = chartW - reserveForWidth(rect.width);
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
      // Shift + roda: pan horizontal pelo histórico (limitado pelo teto publicado no draw, o mesmo
      // que impede a barra em formação de sair da tela)
      const wheelMax = Math.max(0, scrollMaxRef.current);
      setScrollOffset((prev) => Math.max(0, Math.min(wheelMax, prev - (e.deltaY > 0 ? 2 : -2))));
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
      if (Math.abs(y - lay.pricePaneH) <= 12 && x < lay.plotW) {
        touchDividerRef.current = {
          mode: 'MAIN',
          startY: touch.clientY,
          startValue: flowPaneRatio,
          usableH: lay.usableFlowH,
          canvasH: rect.height,
        };
        return;
      }
      if (flowViewMode === 'heikin_ashi' && Math.abs(y - lay.histDividerY) <= 12 && x < lay.plotW) {
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
        panFlow: flowPanOffset,
        pane: y > lay.pricePaneH ? 'flow' : 'price',
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
      // Mesmo gesto do mouse: conteúdo segue o dedo, 1:1 com o passo real, com o teto do draw
      // (a barra em formação não pode sair da tela).
      const offsetDelta = -deltaX / Math.max(1, stepXRef.current);
      const maxScroll = Math.max(0, scrollMaxRef.current);
      setScrollOffset(Math.max(0, Math.min(maxScroll, touchStartRef.current.scroll + offsetDelta)));

      // Pan vertical livre com o dedo (mesmo gesto do mouse): move só o painel agarrado.
      const deltaYTouch = touch.clientY - touchStartRef.current.y;
      if (touchStartRef.current.pane === 'flow') {
        const f = flowViewRef.current;
        const ptsPerPx = f && f.bandH > 0 ? f.range / f.bandH : 3;
        setFlowPanOffset(touchStartRef.current.panFlow + deltaYTouch * ptsPerPx);
      } else {
        const v = priceViewRef.current;
        const ptsPerPx = v && v.usableH > 0 ? v.range / v.usableH : 1.5;
        setPricePanOffset(clampPricePan(touchStartRef.current.panY + deltaYTouch * ptsPerPx));
      }

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
      const { chartW, plotW, pricePaneH, histDividerY } = getFlowDividerLayout(
        canvasRef.current.clientWidth,
        canvasRef.current.clientHeight
      );

      if (Math.abs(mousePos.y - pricePaneH) <= 7 && mousePos.x < plotW) {
        return 'cursor-row-resize';
      }
      if (flowViewMode === 'heikin_ashi' && Math.abs(mousePos.y - histDividerY) <= 7 && mousePos.x < plotW) {
        return 'cursor-row-resize';
      }
      if (mousePos.x >= chartW) return 'cursor-ns-resize';
      // Faixa da régua de tempo (pé do painel de preço, acima do divisor): o eixo X arrastável
      if (
        mousePos.y > pricePaneH - TIME_AXIS_BAND_H &&
        mousePos.y < pricePaneH &&
        mousePos.x < plotW
      ) {
        return 'cursor-ew-resize';
      }
    }
    // Corpo do gráfico: mãozinha — ele é arrastável nas duas direções, sem tecla.
    return 'cursor-grab';
  };

  // Cálculo do PnL flutuante migrou para o livro de hedge do App (hedgeBook), que alimenta a
  // boleta — a antiga tira de status e a janela de Dados só repetiam esse número.

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
    showSignalArrows,
    onToggleSignalArrows: toggleSignalArrows,
    orderValueMode,
    onOrderValueMode: handleOrderValueMode,
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
    // A janela "Dados" anuncia a escala dos blocos que ela mesma conta: nunca um "10R" fixo.
    blockScaleLabel:
      chartSeries === 'renko'
        ? renkoScaleLabel(renkoBoxPoints, asset)
        : chartSeries === 'range'
        ? `Range ${rangePoints}pts`
        : `${formatTimeframe(timeframeSec)}`,
  };

  // ── Escala do box (R) editável na engrenagem ──
  // O operador pensa em R e o terminal mede em pontos: as duas conversões abaixo são a ponte,
  // sempre encaixada na variação mínima do ativo (WIN: 1R = 5 pts).
  const renkoR = renkoRFromBoxPoints(renkoBoxPoints, asset);
  const boxScaleLabel = renkoScaleLabel(renkoBoxPoints, asset);
  const applyRenkoR = (r: number) => {
    const clamped = clampRenkoR(r);
    onRenkoBoxPointsChange?.(boxPointsForR(clamped, asset));
  };
  const stepRenkoR = (delta: number) => applyRenkoR(renkoR + delta);
  const cycleRenkoR = () => {
    const ladder = renkoRChoices(asset, renkoR);
    const i = ladder.indexOf(renkoR);
    applyRenkoR(ladder[(i + 1) % ladder.length] ?? ladder[0]);
  };

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full flex flex-col bg-zinc-950 select-none overflow-hidden"
    >
      {/* ========================================================================= */}
      {/* TIRA DE STATUS COMPACTA: sem botões (todos vivem na barra lateral)         */}
      {/* ========================================================================= */}
      <div className="flex items-center justify-between gap-2 px-2.5 sm:px-4 h-7 shrink-0 bg-zinc-900/95 border-b border-zinc-800 text-[11px] font-mono">
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
          <div className="flex items-center gap-1.5 shrink-0 rounded-md border border-zinc-600/70 bg-zinc-950/60 px-1.5 py-0" title="Escolha o tipo de gráfico e a escala">
            <span className="text-[9.5px] text-zinc-400 font-sans uppercase tracking-wide hidden sm:inline">Gráfico</span>
            <select
              value={chartSeries}
              onChange={(e) => onSeriesChange?.(e.target.value as ChartSeries)}
              className="h-[22px] rounded bg-zinc-900 border border-zinc-600/70 text-emerald-300 text-[11px] px-1.5 cursor-pointer focus:outline-none focus:border-emerald-500"
              title="Tipo de gráfico: Pontos (Renko) ou Range (variação de preço)"
            >
              <option value="renko">Pontos</option>
              <option value="range">Range</option>
            </select>
            {chartSeries === 'renko' && (
              <div className="flex items-center gap-1 bg-zinc-900 border border-zinc-700/80 rounded px-1 py-0.5">
                <button
                  type="button"
                  onClick={() => stepRenkoR(-1)}
                  className="w-4 h-4 flex items-center justify-center rounded bg-zinc-800 text-[10px] font-bold text-zinc-300 hover:bg-zinc-700 hover:text-white cursor-pointer select-none"
                  title={`Diminuir 1R (atual: ${renkoR}R)`}
                >
                  -
                </button>
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={renkoR}
                  onChange={(e) => {
                    const v = parseInt(e.target.value, 10);
                    if (!isNaN(v) && v > 0) applyRenkoR(v);
                  }}
                  className="w-9 h-4 bg-black/60 border border-zinc-700 rounded text-center text-[10.5px] font-mono font-bold text-emerald-300 focus:outline-none focus:border-emerald-500 tabular-nums p-0"
                  title={`Digite o valor em R (1R = ${asset.tickSize} pts -> ${renkoBoxPoints} pts). Clique para digitar.`}
                />
                <span className="text-[10px] font-mono text-zinc-400 select-none">R</span>
                <button
                  type="button"
                  onClick={() => stepRenkoR(1)}
                  className="w-4 h-4 flex items-center justify-center rounded bg-zinc-800 text-[10px] font-bold text-zinc-300 hover:bg-zinc-700 hover:text-white cursor-pointer select-none"
                  title={`Aumentar 1R (atual: ${renkoR}R)`}
                >
                  +
                </button>
                <button
                  type="button"
                  onClick={() => onOpenRenkoParam?.()}
                  className="text-[9.5px] text-zinc-500 hover:text-zinc-300 cursor-pointer ml-0.5 tabular-nums"
                  title="Abrir no painel de Parâmetros"
                >
                  ({renkoBoxPoints}p)
                </button>
              </div>
            )}
            {chartSeries === 'range' && (
              <select
                value={rangePoints}
                onChange={(e) => onRangePointsChange?.(Number(e.target.value))}
                className="h-[22px] rounded bg-zinc-900 border border-zinc-600/70 text-emerald-300 text-[11px] px-1.5 cursor-pointer focus:outline-none focus:border-emerald-500"
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

          {/* ROBÔ 2 (sombra): atalho para a janela do segundo robô de papel. Sem sombra ligada,
              o chip é só o "+" — clicar abre a janela, onde se escolhe estratégia e escala. */}
          {onOpenShadowWindow && (
            <button
              onClick={() => onOpenShadowWindow()}
              className="flex items-center gap-1 px-1.5 h-[22px] rounded border font-sans text-[10px] cursor-pointer transition-colors whitespace-nowrap max-w-[190px] overflow-hidden text-ellipsis"
              title={shadowDetail || 'Robô 2 (sombra) — segundo robô em papel, com estratégia e escala próprias'}
            >
              <span className={shadowEnabled ? 'text-zinc-200' : 'text-zinc-500'}>
                {shadowEnabled ? shadowSummary || 'Robô 2' : '+ Sombra'}
              </span>
              {shadowEnabled && shadowPnl !== undefined && (
                <span
                  className={`font-mono tabular-nums ${
                    shadowPnl > 0 ? 'text-emerald-400' : shadowPnl < 0 ? 'text-rose-400' : 'text-zinc-400'
                  }`}
                >
                  {shadowPnl > 0 ? '+' : ''}
                  {shadowPnl.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              )}
            </button>
          )}

          {/* O chip de PnL flutuante saiu da tira: o número vivo agora mora no painel Hedge da boleta. */}
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {/* Níveis do pregão: ficam ligados por padrão e este chip serve para sumir com eles
              quando a tela estiver cheia demais. No hover, a lista completa com os preços. */}
          {priceLevels.length > 0 && (
            <button
              onClick={togglePriceLevels}
              className={`flex items-center gap-1 px-1.5 h-[22px] rounded border font-sans text-[10px] cursor-pointer transition-colors ${
                showPriceLevels
                  ? 'bg-zinc-800/80 border-zinc-600/70 text-zinc-200 hover:text-white'
                  : 'bg-zinc-950/60 border-zinc-800 text-zinc-500 hover:text-zinc-300'
              }`}
              title={
                (showPriceLevels
                  ? 'Níveis do pregão visíveis — clique para ocultar\n'
                  : 'Níveis do pregão ocultos — clique para mostrar\n') +
                  priceLevels.map((lv) => `${lv.label} ${formatPrice(lv.price, asset)} pts · ${lv.detail}`).join('\n') +
                  (vwapCurve?.current != null
                    ? `\nVWAP (curva laranja) ${formatPrice(vwapCurve.current, asset)} pts · acumulada do dia, reinicia a cada pregão`
                    : '') +
                  '\n(níveis fora da faixa de preço desenhada não aparecem no gráfico — abra mais dias na tela)'
              }
            >
              <span className="w-3 border-t border-dashed border-slate-400/80" />
              <span>NÍVEIS</span>
              <span className="text-zinc-500 tabular-nums">{priceLevels.length}</span>
            </button>
          )}
          {/* A contagem de posições ativas migrou para a boleta (painel Hedge). Aqui só sobra a
              dica de sinal — e APENAS quando não há posição aberta, senão a tira mentiria ao
              operador com posições vivas na tela. */}
          {openOrders.length === 0 && (
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
              title={`Box Renko — ${renkoScaleLabel(renkoBoxPoints, asset)}`}
              onClose={() => onBoxWindowClose?.()}
              initialPos={{ x: dadosWindowOpen ? 262 : 10, y: 10 }}
            >
              <RenkoBoxCard
                box={activeBox}
                haState={activeBoxHaState}
                isInspection={Boolean(hoveredBox)}
                bounds={canvasSize}
                scaleLabel={boxScaleLabel}
                variant="window"
              />
            </DadosPanelWindow>
          </div>
        )}

        {/* Janela do Robô 2 (sombra): terceira da pilha, à direita das outras duas */}
        {shadowWindowOpen && (
          <DadosPanelWindow
            title="Robô 2 (sombra)"
            onClose={() => onShadowWindowClose?.()}
            initialPos={{ x: dadosWindowOpen ? 514 : boxWindowOpen ? 302 : 10, y: 10 }}
          >
            <ShadowRobotPanel onPatchConfig={onPatchShadowConfig} />
          </DadosPanelWindow>
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
        {/* BOLETA: uma caixa só, em desktop e mobile, com recolhimento automático.        */}
        {/* Fica ENCARADA na grade lateral (régua de preços): o recuo é a largura do eixo,   */}
        {/* e o vão (5px) pertence ao DESENHO — o canvas para de desenhar ali, então o       */}
        {/* gráfico nunca fica escondido embaixo da boleta.                                  */}
        {/* ========================================================================= */}
        {onManualOrder && (
          <BoletaTicket
            currentPrice={currentPrice}
            contracts={contracts}
            stopLossPoints={stopLossPoints}
            takeProfitPoints={takeProfitPoints}
            breakevenOffsetPoints={breakevenOffsetPoints}
            trailingDistancePoints={trailingDistancePoints}
            partialPoints={partialPoints}
            onTakeProfitChange={onTakeProfitChange}
            onStopLossPointsChange={onStopLossPointsChange}
            onPartialPointsChange={onPartialPointsChange}
            onBreakevenChange={onBreakevenChange}
            onTrailingChange={onTrailingChange}
            onContractsChange={onContractsChange}
            strategyMode={strategyMode}
            openOrders={openOrders}
            hedgeBook={hedgeBook}
            isRealMT5Connected={isRealMT5Connected}
            asset={asset}
            open={boletaOpen}
            onOpenChange={handleBoletaOpenChange}
            rightOffset={
              // Encostada na grade: o recuo é só a largura da régua (46/64px), então a borda
              // direita da caixa coincide com a borda esquerda da grade de preços. O vão
              // (BOLETA_GAP) é do DESENHO (reserveForWidth), não da caixa: somá-lo aqui
              // empurrava a boleta para dentro dos tijolos.
              (canvasSize.w > 0 ? canvasSize.w : 9999) < 640 ? 46 : 64
            }
            onManualOrder={onManualOrder}
            onClosePositionsSide={onClosePositionsSide}
            onClosePositions={() => onClosePositions?.()}
            chartToolsOpen={chartToolsOpen}
            onToggleChartTools={() => setChartToolsOpen((o) => !o)}
          />
        )}

        {/* ========================================================================= */}
        {/* BOX RENKO: agora vive na janela flutuante "Box Renko" (topo) — ver corpo  */}
        {/* ========================================================================= */}

        {/* ========================================================================= */}
        {/* Engrenagem DE AJUSTES: o interruptor vive na linha da boleta; o painel abre aqui.   */}
        {/* Painel de exibição (tijolos/zoom/modo/escala do fluxo + legenda). Limpa a tela.  */}
        {/* ========================================================================= */}
        {chartToolsOpen && (
          <div className="absolute bottom-11 right-2 z-30 w-[252px] rounded-lg bg-zinc-900/96 backdrop-blur-md border border-zinc-700/80 p-2.5 shadow-2xl pointer-events-auto select-none space-y-2.5">
            {/* ESCALA DO BOX (R) — a definição mora aqui. Trocar o R redesenha a história inteira
                na escala nova (o App reprocessa os ticks guardados), então o teste é imediato. */}
            {chartSeries === 'renko' && onRenkoBoxPointsChange && (
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] font-semibold text-zinc-400">Box Renko (tijolo)</span>
                  <span className="text-[10px] font-mono text-zinc-500 tabular-nums">
                    1R = {asset.tickSize} pts
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => stepRenkoR(-1)}
                    className="w-7 h-7 flex items-center justify-center rounded bg-zinc-800 text-sm font-bold text-zinc-200 hover:bg-zinc-700 cursor-pointer"
                    title={`Diminuir 1R (box ${renkoR - 1}R = ${boxPointsForR(renkoR - 1, asset)} pts)`}
                  >
                    −
                  </button>
                  <button
                    onClick={cycleRenkoR}
                    className="flex-1 h-7 rounded bg-zinc-800 text-[11px] font-mono font-bold text-zinc-100 hover:bg-zinc-700 cursor-pointer tabular-nums"
                    title="Clique para percorrer a escada de testes (5R → 8R → 9R → 10R → 15R → 20R → 25R → 29R → 30R)"
                  >
                    {renkoR}R · {renkoBoxPoints} pts
                  </button>
                  <button
                    onClick={() => stepRenkoR(1)}
                    className="w-7 h-7 flex items-center justify-center rounded bg-zinc-800 text-sm font-bold text-zinc-200 hover:bg-zinc-700 cursor-pointer"
                    title={`Aumentar 1R (box ${renkoR + 1}R = ${boxPointsForR(renkoR + 1, asset)} pts)`}
                  >
                    +
                  </button>
                </div>
                {/* Escada de testes: um toque por escala, sem precisar clicar 19 vezes no +. */}
                <div className="flex flex-wrap gap-1 mt-1.5">
                  {renkoRChoices(asset, renkoR).map((r) => (
                    <button
                      key={r}
                      onClick={() => applyRenkoR(r)}
                      className={`px-1.5 h-[22px] rounded text-[10px] font-mono font-bold cursor-pointer border transition-colors ${
                        r === renkoR
                          ? 'bg-zinc-700 text-zinc-100 border-zinc-500'
                          : 'bg-zinc-800 text-zinc-400 border-zinc-700 hover:text-white'
                      }`}
                      title={`Box de ${r}R = ${boxPointsForR(r, asset)} pts`}
                    >
                      {r}R
                    </button>
                  ))}
                </div>
                <p className="text-[9px] leading-snug text-zinc-500 mt-1">
                  Esta é a escala do tijolo: o gráfico redesenha na hora e robôs, boleta, auditoria e
                  script Python passam a usar este box.
                </p>
              </div>
            )}

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

            {/* Recuo inicial do gráfico — o "Chart Shift" do MetaTrader: distância (px) entre a aresta
                direita do candle em formação e a borda do desenho. Persistido. */}
            <div className="flex items-center gap-1">
              <button
                onClick={() => setChartShift((prev) => Math.max(0, prev - 5))}
                className="w-7 h-7 flex items-center justify-center rounded bg-zinc-800 text-sm font-bold text-zinc-200 hover:bg-zinc-700 cursor-pointer"
                title="Encostar o candle em formação na borda direita (5px por clique)"
              >
                −
              </button>
              <button
                onClick={() => setChartShift(CHART_SHIFT_DEFAULT)}
                className="flex-1 h-7 rounded bg-zinc-800 text-[10px] font-mono font-bold text-zinc-100 hover:bg-zinc-700 cursor-pointer tabular-nums"
                title={`Recuo inicial do gráfico (px) — clique para voltar ao padrão de ${CHART_SHIFT_DEFAULT}px`}
              >
                ↤ {chartShift}px
              </button>
              <button
                onClick={() => setChartShift((prev) => Math.min(CHART_SHIFT_MAX, prev + 5))}
                className="w-7 h-7 flex items-center justify-center rounded bg-zinc-800 text-sm font-bold text-zinc-200 hover:bg-zinc-700 cursor-pointer"
                title="Dar mais folga ao candle em formação (5px por clique)"
              >
                +
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

            {/* Marca-d'água do ativo: anexo opcional. A assinatura (sigla + série + vigente) mora
                atrás dos tijolos; quem quer a tela limpa desanexa e a escolha fica guardada. */}
            <button
              onClick={toggleAssetWatermark}
              className={`w-full h-7 rounded text-[10px] font-semibold border cursor-pointer transition-colors ${
                assetWatermark
                  ? 'bg-zinc-800 text-zinc-100 border-zinc-600'
                  : 'bg-zinc-900 text-zinc-500 border-zinc-800 hover:text-zinc-300'
              }`}
              title="Marca d'água do ativo aberto, desenhada atrás dos tijolos no painel de preço: sigla, produto e os dois códigos que definem o gráfico (série contínua e contrato vigente). Desligue para ficar só o gráfico cru."
            >
              Marca d'água: {assetWatermark ? `${asset.id} anexada` : 'desanexada'}
            </button>

            {/* Legenda (antes no rodapé, agora dentro do painel) */}
            <div className="border-t border-zinc-800 pt-2 grid grid-cols-2 gap-x-2 gap-y-1 text-[9.5px] text-zinc-400">
              <div className="flex items-center gap-1">
                <span className="w-2 h-3 bg-emerald-500 rounded-xs" /> <span>{boxScaleLabel} Alta</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="w-2 h-3 bg-rose-500 rounded-xs" /> <span>{boxScaleLabel} Baixa</span>
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
        {/* Engrenagem morava aqui, solta no canto inferior direito. O interruptor migrou para a
            linha da boleta (ao lado do sininho de fixar) — o painel abaixo continua o mesmo, só
            muda quem abre a porta. */}

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
              scaleLabel={boxScaleLabel}
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
          Ajustes no ⚙ da linha da Boleta (o painel abre no canto inferior direito) · arraste o gráfico para mover · réguas dão zoom Y/Fluxo · duplo clique auto-escala
        </span>
      </div>
    </div>
  );
};
