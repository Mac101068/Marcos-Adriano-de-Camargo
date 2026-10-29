import React from 'react';
import {
  Activity,
  BarChart2,
  Layers,
  Sparkles,
  Target,
  ArrowUp,
  ArrowDown,
  X,
  Grid3x3,
  Rows3,
  Sliders,
} from 'lucide-react';
import { DrawingTool, DrawingColor } from '../types/drawing';
import { DrawingToolbar } from './DrawingToolbar';

export type FlowViewMode = 'heikin_ashi' | 'histogram' | 'hybrid';
export type BoxThickness = 'thin' | 'ultrathin' | 'medium';
export type SpacingMode = 'compact' | 'fill';

interface ScaleRowProps {
  label: string;
  hint: string;
  value: number;
  min: number;
  max: number;
  step: number;
  accent: 'neutral' | 'sky' | 'purple';
  onChange: (next: number) => void;
  onReset: () => void;
}

interface SectionProps {
  title: string;
  icon: React.ElementType;
  children: React.ReactNode;
  last?: boolean;
}

interface ChartControlSidebarProps {
  /* Sinal */
  blockCount: number;
  pnl: { financial: number; points: number; openCount: number };
  activePosCount: number;

  /* Exibição */
  flowViewMode: FlowViewMode;
  onFlowViewMode: (mode: FlowViewMode) => void;
  boxThickness: BoxThickness;
  onBoxThickness: (t: BoxThickness) => void;
  spacingMode: SpacingMode;
  onSpacingMode: (m: SpacingMode) => void;

  /* Escalas */
  scaleY: number;
  onScaleY: (v: number) => void;
  onResetY: () => void;
  scaleX: number;
  onScaleX: (v: number) => void;
  onResetX: () => void;
  scaleFlow: number;
  onScaleFlow: (v: number) => void;
  onResetFlow: () => void;
  flowPaneRatio: number;
  onFlowPaneRatio: (v: number) => void;
  isCustomScaled: boolean;
  onResetAll: () => void;

  /* Camadas */
  showOrderLines: boolean;
  onToggleOrderLines: () => void;

  /* Desenho */
  activeDrawingTool: DrawingTool;
  onSelectDrawingTool: (t: DrawingTool) => void;
  drawingColor: DrawingColor;
  onSelectDrawingColor: (c: DrawingColor) => void;
  onUndoDrawing: () => void;
  onClearDrawings: () => void;
  hasDrawings: boolean;

  /* Ordem rápida */
  currentPrice: number;
  contracts: number;
  onManualOrder?: (type: 'BUY' | 'SELL') => void;
  onClosePositions?: () => void;

  /* Drawer (mobile) */
  isDrawer?: boolean;
  onCloseDrawer?: () => void;

  /* Modo janela flutuante (atalho "Dados" no menu) */
  isWindow?: boolean;
}

const ACCENT_TEXT: Record<ScaleRowProps['accent'], string> = {
  neutral: 'text-slate-500',
  sky: 'text-sky-400',
  purple: 'text-purple-400',
};

const ACCENT_ACTIVE: Record<ScaleRowProps['accent'], string> = {
  neutral: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
  sky: 'bg-sky-500/20 text-sky-300 border-sky-500/40',
  purple: 'bg-purple-500/20 text-purple-300 border-purple-500/40',
};

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

// Linha de escala: rótulo + (−) valor (%) + (+), com duplo clique/valor para resetar
const ScaleRow: React.FC<ScaleRowProps> = ({ label, hint, value, min, max, step, accent, onChange, onReset }) => {
  const isCustom = Math.abs(value - 1) > 0.02;
  return (
    <div className="flex items-center justify-between gap-2 min-h-[28px]" title={hint}>
      <span className={`text-[10px] font-semibold uppercase tracking-wide ${ACCENT_TEXT[accent]}`}>{label}</span>
      <div className="flex items-center gap-0.5">
        <button
          onClick={() => onChange(Number(clamp(value - step, min, max).toFixed(2)))}
          className="w-6 h-6 flex items-center justify-center rounded text-[11px] font-bold text-slate-300 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer border border-slate-800/80 bg-slate-950/60"
          title={`Reduzir ${label}`}
        >
          −
        </button>
        <button
          onClick={onReset}
          className={`min-w-[46px] h-6 px-1 rounded text-[10px] font-mono font-bold tabular-nums transition-colors cursor-pointer border ${
            isCustom ? ACCENT_ACTIVE[accent] : 'text-slate-400 border-slate-800/80 bg-slate-950/60 hover:text-slate-100'
          }`}
          title={`Restaurar ${label} para 100%`}
        >
          {Math.round(value * 100)}%
        </button>
        <button
          onClick={() => onChange(Number(clamp(value + step, min, max).toFixed(2)))}
          className="w-6 h-6 flex items-center justify-center rounded text-[11px] font-bold text-slate-300 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer border border-slate-800/80 bg-slate-950/60"
          title={`Aumentar ${label}`}
        >
          +
        </button>
      </div>
    </div>
  );
};

const Section: React.FC<SectionProps> = ({ title, icon: Icon, children, last }) => (
  <section className={`px-3 py-2.5 ${last ? '' : 'border-b border-slate-800/70'}`}>
    <header className="flex items-center gap-1.5 mb-2">
      <Icon className="w-3 h-3 text-slate-500" />
      <span className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">{title}</span>
    </header>
    {children}
  </section>
);

// Grupo segmentado com barra de acento interna no item ativo
const Segmented: React.FC<{
  options: { value: string; label: string; icon?: React.ElementType; title?: string }[];
  current: string;
  onSelect: (value: string) => void;
}> = ({ options, current, onSelect }) => (
  <div className="flex items-center gap-1 flex-wrap">
    {options.map((opt) => {
      const active = opt.value === current;
      const Icon = opt.icon;
      return (
        <button
          key={opt.value}
          onClick={() => onSelect(opt.value)}
          title={opt.title}
          className={`flex items-center gap-1 px-2 h-[26px] rounded text-[10.5px] font-semibold transition-colors cursor-pointer border ${
            active
              ? 'bg-slate-800 text-slate-50 border-slate-700 shadow-[inset_2px_0_0_0_#e5e5e5]'
              : 'bg-slate-950/60 text-slate-400 border-slate-800/80 hover:text-slate-100'
          }`}
        >
          {Icon && <Icon className={`w-3 h-3 ${active ? 'text-slate-200' : 'text-slate-500'}`} />}
          <span>{opt.label}</span>
        </button>
      );
    })}
  </div>
);

export const ChartControlSidebar: React.FC<ChartControlSidebarProps> = ({
  blockCount,
  pnl,
  activePosCount,
  flowViewMode,
  onFlowViewMode,
  boxThickness,
  onBoxThickness,
  spacingMode,
  onSpacingMode,
  scaleY,
  onScaleY,
  onResetY,
  scaleX,
  onScaleX,
  onResetX,
  scaleFlow,
  onScaleFlow,
  onResetFlow,
  flowPaneRatio,
  onFlowPaneRatio,
  isCustomScaled,
  onResetAll,
  showOrderLines,
  onToggleOrderLines,
  activeDrawingTool,
  onSelectDrawingTool,
  drawingColor,
  onSelectDrawingColor,
  onUndoDrawing,
  onClearDrawings,
  hasDrawings,
  currentPrice,
  contracts,
  onManualOrder,
  onClosePositions,
  isDrawer = false,
  onCloseDrawer,
  isWindow = false,
}) => {
  return (
    <aside
      className={
        isWindow
          ? 'flex w-full h-full min-h-0 shrink-0 flex-col bg-slate-900/95'
          : isDrawer
          ? 'w-[262px] h-full shrink-0 flex flex-col bg-slate-900/98 backdrop-blur-md border-r border-slate-800'
          : 'hidden lg:flex w-[232px] shrink-0 flex-col bg-slate-900/70 border-r border-slate-800 min-h-0'
      }
    >
      {/* Cabeçalho da barra lateral */}
      <div className="flex items-center justify-between px-3 h-8 shrink-0 border-b border-slate-800/70 bg-slate-950/40">
        <div className="flex items-center gap-1.5">
          <Sliders className="w-3 h-3 text-slate-500" />
          <span className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">Controles</span>
        </div>
        {isDrawer && (
          <button
            onClick={onCloseDrawer}
            className="w-6 h-6 flex items-center justify-center rounded text-slate-400 hover:text-slate-100 hover:bg-slate-800 cursor-pointer"
            title="Fechar controles"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Corpo rolável: nunca corta controle fora da área */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {/* SINAL */}
        <Section title="Sinal" icon={Activity}>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-[11px] font-mono">
              <span className="text-slate-500">Blocos 10R</span>
              <span className="text-emerald-400 font-bold tabular-nums">{blockCount}</span>
            </div>
            <div
              className={`flex items-center justify-between px-2 py-1 rounded border font-mono text-[11px] ${
                pnl.openCount > 0
                  ? pnl.financial > 0
                    ? 'bg-emerald-950/70 border-emerald-500/40 text-emerald-300'
                    : pnl.financial < 0
                    ? 'bg-rose-950/70 border-rose-500/40 text-rose-300'
                    : 'bg-slate-950/60 border-slate-700 text-slate-300'
                  : 'bg-slate-950/50 border-slate-800/80 text-slate-400'
              }`}
              title="Resultado flutuante acumulado das operações abertas"
            >
              <span className="uppercase text-[9px] tracking-wide">PnL</span>
              <span className="font-bold tabular-nums">
                {pnl.financial > 0 ? '+' : ''}
                {pnl.financial.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                {pnl.openCount > 0 && (
                  <span className="ml-1.5 text-[9.5px] font-semibold">
                    ({pnl.points > 0 ? '+' : ''}
                    {pnl.points} pts)
                  </span>
                )}
              </span>
            </div>
            {activePosCount > 0 ? (
              <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-sky-950/70 border border-sky-500/30 text-sky-300 text-[10.5px] font-mono">
                <span className="w-1.5 h-1.5 rounded-full bg-sky-400 animate-pulse" />
                <span>{activePosCount} Pos Ativa(s)</span>
              </div>
            ) : (
              <div className="text-[10px] text-slate-500 font-mono">Aguardando Sinal</div>
            )}
          </div>
        </Section>

        {/* EXIBIÇÃO */}
        <Section title="Exibição" icon={Grid3x3}>
          <div className="space-y-2.5">
            <div>
              <span className="block text-[9.5px] text-slate-600 mb-1">Painel de fluxo</span>
              <Segmented
                current={flowViewMode}
                onSelect={(v) => onFlowViewMode(v as FlowViewMode)}
                options={[
                  {
                    value: 'heikin_ashi',
                    label: 'Heikin-Ashi',
                    icon: Activity,
                    title: 'Candles Heikin-Ashi de fluxo (verde subida, vermelho descida, cinza reversão)',
                  },
                  { value: 'histogram', label: 'Delta', icon: BarChart2, title: 'Histograma de Delta tradicional' },
                  { value: 'hybrid', label: 'Híbrido', title: 'Heikin-Ashi sobreposto ao histograma de Delta' },
                ]}
              />
            </div>

            <div>
              <span className="block text-[9.5px] text-slate-600 mb-1">Tijolo</span>
              <Segmented
                current={boxThickness}
                onSelect={(v) => onBoxThickness(v as BoxThickness)}
                options={[
                  { value: 'thin', label: 'Fino', title: 'Tijolos finos (10px)' },
                  { value: 'ultrathin', label: 'Ultra', title: 'Tijolos ultra-finos (7px)' },
                  { value: 'medium', label: 'Largo', title: 'Tijolos largos (14px)' },
                ]}
              />
            </div>

            <div>
              <span className="block text-[9.5px] text-slate-600 mb-1">Espaçamento</span>
              <Segmented
                current={spacingMode}
                onSelect={(v) => onSpacingMode(v as SpacingMode)}
                options={[
                  { value: 'compact', label: 'Compacto', icon: Rows3, title: 'Tijolos agrupados à direita (padrão Renko)' },
                  {
                    value: 'fill',
                    label: 'Preencher',
                    icon: Sparkles,
                    title: 'Auto-ajuste distribui os tijolos pela tela',
                  },
                ]}
              />
            </div>
          </div>
        </Section>

        {/* ESCALAS */}
        <Section title="Escalas" icon={Target}>
          <div className="space-y-0.5">
            <ScaleRow
              label="Preço (Y)"
              hint="Altura dos tijolos. Dica: arraste a régua de preços na lateral direita"
              value={scaleY}
              min={0.25}
              max={4}
              step={0.15}
              accent="neutral"
              onChange={onScaleY}
              onReset={onResetY}
            />
            <ScaleRow
              label="Tempo (X)"
              hint="Largura e vão dos tijolos"
              value={scaleX}
              min={0.5}
              max={3.5}
              step={0.15}
              accent="sky"
              onChange={onScaleX}
              onReset={onResetX}
            />
            <ScaleRow
              label="Fluxo (F)"
              hint="Altura dos candles de fluxo. Dica: arraste a régua lateral do fluxo"
              value={scaleFlow}
              min={0.25}
              max={4}
              step={0.15}
              accent="purple"
              onChange={onScaleFlow}
              onReset={onResetFlow}
            />

            <div className="flex items-center justify-between gap-2 min-h-[28px]">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Janela</span>
              <Segmented
                current={String(flowPaneRatio <= 0.29 ? 0.25 : flowPaneRatio <= 0.4 ? 0.33 : 0.46)}
                onSelect={(v) => onFlowPaneRatio(Number(v))}
                options={[
                  { value: '0.25', label: '25%', title: 'Janela de fluxo compacta' },
                  { value: '0.33', label: '33%', title: 'Janela de fluxo equilibrada' },
                  { value: '0.46', label: '46%', title: 'Janela de fluxo expandida' },
                ]}
              />
            </div>

            <button
              onClick={onResetAll}
              className={`w-full mt-1 flex items-center justify-center gap-1.5 h-[28px] rounded text-[11px] font-semibold transition-colors cursor-pointer border ${
                isCustomScaled
                  ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                  : 'bg-slate-950/60 text-slate-400 border-slate-800/80 hover:text-slate-100'
              }`}
              title="Auto-ajustar todas as escalas (preço, tempo, fluxo e divisor)"
            >
              <Target className="w-3 h-3 text-emerald-400" />
              <span>Auto-ajustar</span>
            </button>
          </div>
        </Section>

        {/* CAMADAS */}
        <Section title="Camadas" icon={Layers}>
          <button
            onClick={onToggleOrderLines}
            className={`w-full flex items-center justify-between gap-2 h-[28px] px-2 rounded text-[11px] font-semibold transition-colors cursor-pointer border ${
              showOrderLines
                ? 'bg-sky-500/15 text-sky-300 border-sky-500/30'
                : 'bg-slate-950/60 text-slate-500 border-slate-800/80 hover:text-slate-200'
            }`}
            title="Alternar visibilidade das linhas de ordens (entrada, reteste, SL, TP e parcial)"
          >
            <span className="flex items-center gap-1.5">
              <Layers className="w-3 h-3 text-sky-400" />
              Linhas de ordem
            </span>
            <span className="font-mono">{showOrderLines ? 'On' : 'Off'}</span>
          </button>
        </Section>

        {/* DESENHO */}
        <Section title="Desenho" icon={Sliders}>
          <DrawingToolbar
            layout="inline"
            activeTool={activeDrawingTool}
            onSelectTool={onSelectDrawingTool}
            activeColor={drawingColor}
            onSelectColor={onSelectDrawingColor}
            onUndo={onUndoDrawing}
            onClearAll={onClearDrawings}
            hasDrawings={hasDrawings}
          />
          <p className="mt-1.5 text-[9.5px] leading-snug text-slate-600">
            Atalhos: V seleção · H linha · R zona · A seta · T texto · Ctrl+Z desfazer
          </p>
        </Section>

        {/* ORDEM RÁPIDA */}
        {onManualOrder && (
          <Section title="Ordem rápida" icon={ArrowUp} last>
            <div className="space-y-1.5">
              <button
                onClick={() => onManualOrder('BUY')}
                className="w-full flex items-center justify-between px-2.5 h-[32px] rounded-md text-[11px] font-bold bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white transition-all cursor-pointer"
                title={`Enviar COMPRA a Mercado (${contracts}ct a ${currentPrice.toLocaleString('pt-BR')} pts)`}
              >
                <span className="flex items-center gap-1.5">
                  <ArrowUp className="w-3.5 h-3.5 stroke-[2.5]" />
                  COMPRA
                </span>
                <span className="text-[9px] font-mono px-1 py-0.2 bg-emerald-800/80 rounded text-emerald-100">
                  {contracts}ct
                </span>
              </button>
              <button
                onClick={() => onManualOrder('SELL')}
                className="w-full flex items-center justify-between px-2.5 h-[32px] rounded-md text-[11px] font-bold bg-rose-600 hover:bg-rose-500 active:scale-95 text-white transition-all cursor-pointer"
                title={`Enviar VENDA a Mercado (${contracts}ct a ${currentPrice.toLocaleString('pt-BR')} pts)`}
              >
                <span className="flex items-center gap-1.5">
                  <ArrowDown className="w-3.5 h-3.5 stroke-[2.5]" />
                  VENDA
                </span>
                <span className="text-[9px] font-mono px-1 py-0.2 bg-rose-800/80 rounded text-rose-100">
                  {contracts}ct
                </span>
              </button>
              {activePosCount > 0 && onClosePositions && (
                <button
                  onClick={onClosePositions}
                  className="w-full flex items-center justify-center gap-1.5 px-2.5 h-[30px] rounded-md text-[11px] font-bold bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 active:scale-95 transition-all cursor-pointer"
                  title="Zerar todas as ordens e posições abertas imediatamente"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                  <span>ZERAR ({activePosCount})</span>
                </button>
              )}
            </div>
          </Section>
        )}
      </div>
    </aside>
  );
};
