import React, { useEffect, useState } from 'react';
import { ArrowUp, ArrowDown, ChevronDown, ChevronUp, Pin, PinOff, Eye, Focus } from 'lucide-react';
import { TradeOrder } from '../types/trading';
import { ASSETS, AssetSpec, DEFAULT_ASSET_ID, formatPrice, pointsToBRL, snapToTick } from '../assets/assetRegistry';

/**
 * BOLETA — ordem rápida do operador, numa caixa única com recolhimento automático.
 *
 * Antes Existiam duas cópias que se anulavam: a barra grande sobre o gráfico (`lg:hidden`) e a
 * seção "Ordem rápida" da barra lateral (`hidden lg:flex`). Conforme o zoom da janela, uma das
 * duas sumia e a boleta desaparecia da tela. Esta caixa vive sobre o canvas, sempre presente,
 * e some de vista sozinha (recolhe) para não brigar com o gráfico.
 */

// v1: abre expandida na primeira vez; depois obedece a última escolha do operador
export const STORAGE_KEY_OPEN = 'fluxo_boleta_open_v1';
// v1: sub-caixa "Parâmetros" da boleta (abre expandida na primeira vez; depois obedece o operador)
export const STORAGE_KEY_PARAMS_OPEN = 'fluxo_boleta_params_open_v1';
// Recolhe sozinho depois desse tempo (não fecha enquanto o mouse estiver em cima, nem se fixado)
const AUTO_COLLAPSE_MS = 9000;
// Largura fixa da caixa expandida e o vão que o gráfico deixa a ela: quem desenha o canvas
// precisa saber desses números para o gráfico parar a 5px da borda esquerda da boleta
// (e, recolhida, a 5px da régua). É a única fonte desse número — mexa aqui e os dois lados seguem.
export const BOLETA_WIDTH = 196;
export const BOLETA_GAP = 5;
// Recuo do topo: 5px abaixo da linha de dados (a faixa de controles/indicadores do gráfico)
export const BOLETA_TOP = 5;

/**
 * Livro de hedge de um lado (COMPRAS ou VENDAS) — contas batidas no App, a boleta só exibe.
 * É a migração dos chips que viviam nas linhas de menu (tira do topo, barra do gráfico, janela
 * de Dados) para a área abaixo dos botões de compra e venda.
 */
export interface HedgeSideBook {
  /** Ordens abertas + limites paradas aguardando neste lado. */
  orders: number;
  /** Ordens efetivamente abertas (posição viva). */
  filled: number;
  /** Ordens paradas (limite) aguardando execução. */
  pending: number;
  /** Contratos vivos no lado (respeita saída parcial). */
  contracts: number;
  /** Preço médio de entrada ponderado por contrato. */
  avgEntry: number;
  /** Pontos flutuantes (mesma convenção do antigo chip: soma dos pontos por ordem). */
  livePts: number;
  /** R$ flutuante das posições abertas no lado. */
  liveBRL: number;
  /** R$ já realizado em saídas parciais de ordens ainda abertas neste lado. */
  partialBRL: number;
}

export interface HedgeBook {
  buy: HedgeSideBook;
  sell: HedgeSideBook;
  /** Soma dos resultados fechados POSITIVOS da sessão (realizado a mercado). */
  realizedProfit: number;
  /** Soma dos resultados fechados NEGATIVOS da sessão (número negativo). */
  realizedLoss: number;
  /** Realizado + flutuante dos dois lados + parciais — o PnL do dia na boleta. */
  dayPnl: number;
  /** Contratos negociados HOJE em compras (abertas + fechadas da sessão, sem limites paradas). */
  buyContractsToday: number;
  /** Contratos negociados HOJE em vendas. */
  sellContractsToday: number;
  /** Total de contratos do dia (C + V) — o giro completo da sessão. */
  contractsTodayTotal: number;
}

interface BoletaTicketProps {
  currentPrice: number;
  contracts: number;
  /** Preço atual do feed (o STOP read-only é derivado dele). */
  stopLossPoints: number;
  /**
   * Alvo variável (TP em pontos) — a boleta é a BASE: Robô, script Python e estratégias
   * buscam este valor; os sliders/painéis que o editavam antes foram eliminados.
   */
  takeProfitPoints: number;
  /** Piso do breakeven (offset de taxas sobre a entrada) — também editável só aqui. */
  breakevenOffsetPoints?: number;
  /** Pontos da saída parcial (1/2 do lote) — sexta linha editável da base. */
  partialPoints?: number;
  /** Modo da estratégia: na Pirâmide a Ordem Mãe não tem SL/TP fixo — a boleta diz isso, não inventa número. */
  strategyMode?: 'PULLBACK_RETEST' | 'PYRAMID_FLOW_CONFLUENCE' | 'SIGNAL_STACK';
  openOrders: TradeOrder[];
  /**
   * Livro do hedge (contratos por lado, preço médio, flutuante, ganhos/perdas/PnL do dia).
   * Quem calcula é o App — único dono das ordens; sem ele o painel some (mas as ordens seguem).
   */
  hedgeBook?: HedgeBook;
  isRealMT5Connected?: boolean;
  asset?: AssetSpec;
  /** Distância do trailing stop (pts atrás do extremo) — quinta linha editável da base. */
  trailingDistancePoints?: number;
  /**
   * Recuo da borda direita, em px: a boleta fica ENCARADA na grade lateral (régua de preços).
   * Quem passa o valor é o gráfico: é a largura do eixo (46px mobile / 64px desktop). O vão de
   * BOLETA_GAP é do DESENHO (o canvas que recua), não da caixa.
   */
  rightOffset?: number;
  /**
   * Engrenagem de ajustes do gráfico, agora colada na linha da boleta (ao lado do sininho de
   * fixar). O estado mora no gráfico — a boleta só aperta o interruptor.
   */
  chartToolsOpen?: boolean;
  onToggleChartTools?: () => void;
  /** Estado aberto/recolhido vem do gráfico (controlled): ele precisa saber o vão para o canvas. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onManualOrder?: (type: 'BUY' | 'SELL') => void;
  /** Zerar por lado (estratégia de hedge): cada botão manda fechar só o seu lado. */
  onClosePositionsSide?: (side: 'BUY' | 'SELL') => void;
  /** ZERAR TUDO: fecha os dois lados de uma vez (mesma ação do zerar-geral do gráfico). */
  onClosePositions?: () => void;
  /** Escrita dos valores-base das estratégias (persistem no config do EA via App). */
  onTakeProfitChange?: (v: number) => void;
  onStopLossPointsChange?: (v: number) => void;
  onPartialPointsChange?: (v: number) => void;
  onBreakevenChange?: (v: number) => void;
  onTrailingChange?: (v: number) => void;
  /** Breakeven POR DISTÂNCIA (padronização 07/11): pontos a favor até armar e pontos garantidos.
   *  0 em qualquer um dos dois desliga — é assim que a C/V sai só na virada por padrão. */
  breakevenTriggerPoints?: number;
  breakevenLockPoints?: number;
  onBreakevenTriggerChange?: (v: number) => void;
  onBreakevenLockChange?: (v: number) => void;
  onContractsChange?: (v: number) => void;
  /** Alteração do Risco em R$ (sincroniza com Stop Loss em pontos). */
  onRiskBRLChange?: (v: number) => void;
  /** Auto-Fit / Centralizar gráfico no preço ao vivo */
  onFitChart?: () => void;
  /** Gráfico deslocado ou fora do centro do tempo real */
  isChartShifted?: boolean;
}

const brl = (v: number) =>
  `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`;

/**
 * Linha de um lado do hedge: `C 3ct @ 121,30` à esquerda, o R$ flutuante colorido à direita.
 * Tono segue o RESULTADO (verde positivo / vermelho negativo), não o lado — em hedge os dois
 * lados costumam apontar para cores opostas, e quem lê quer saber quem está no lucro.
 */
const SideRow: React.FC<{ tag: 'C' | 'V'; book: HedgeSideBook; asset: AssetSpec }> = ({ tag, book, asset }) => {
  const total = book.liveBRL + book.partialBRL;
  const tone = book.filled === 0 ? 'text-zinc-500' : total > 0 ? 'text-emerald-300' : total < 0 ? 'text-rose-300' : 'text-zinc-100';
  return (
    <div
      className="flex items-baseline justify-between gap-2 leading-tight"
      title={`${tag === 'C' ? 'COMPRAS' : 'VENDAS'}: ${book.filled} ordem(ns) aberta(s)${book.pending ? ` + ${book.pending} parada(s)` : ''} · ${book.contracts} contrato(s) · médio ${formatPrice(book.avgEntry, asset)} pts · flutuante ${brl(total)}${book.partialBRL ? ` (sendo ${brl(book.partialBRL)} de parcial já realizada)` : ''}`}
    >
      <span className="text-[9.5px] uppercase tracking-wide shrink-0">
        <span className={tag === 'C' ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold'}>{tag}</span>
        <span className="text-zinc-500"> {book.contracts}ct</span>
        {book.avgEntry > 0 && <span className="text-zinc-500"> @ {formatPrice(book.avgEntry, asset)}</span>}
        {book.pending > 0 && <span className="text-amber-400/90"> +{book.pending}P</span>}
      </span>
      <span className={`text-[11px] font-semibold tabular-nums truncate ${tone}`}>
        {book.filled === 0 ? '—' : brl(total)}
      </span>
    </div>
  );
};

const Row: React.FC<{ label: string; value: string; tone?: 'neutral' | 'emerald' | 'rose' | 'sky' }> = ({
  label,
  value,
  tone = 'neutral',
}) => {
  const toneClass =
    tone === 'emerald'
      ? 'text-emerald-300'
      : tone === 'rose'
      ? 'text-rose-300'
      : tone === 'sky'
      ? 'text-sky-300'
      : 'text-zinc-100';
  return (
    <div className="flex items-baseline justify-between gap-2 leading-tight">
      <span className="text-[9.5px] uppercase tracking-wide text-zinc-500 shrink-0">{label}</span>
      <span className={`text-[11px] font-semibold tabular-nums truncate ${toneClass}`}>{value}</span>
    </div>
  );
};

/**
 * Linha editável da boleta (Contratos / Alvo / Breakeven / Trailing), no padrão de mercado de
 * order ticket (CQG/Trading Technologies): os dois lados da caixa mandam − e + (as setinhas
 * nativas do input somem), a unidade em cinza à direita. O número É a fonte — Robô, script e
 * estratégias leem este valor do config; os editores que viviam nos painéis foram eliminados.
 */
const StepperRow: React.FC<{
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit: string;
  onChange?: (v: number) => void;
  hint: string;
  decimals?: number;
}> = ({ label, value, min, max, step = 5, unit, onChange, hint, decimals = 0 }) => {
  const roundToStep = (v: number, s: number) => {
    if (s <= 0) return v;
    const inv = Math.round(1 / s);
    return inv >= 1 ? Math.round(v * inv) / inv : Math.round(v / s) * s;
  };
  const clamp = (v: number) => {
    const bounded = Math.min(max, Math.max(min, v));
    return roundToStep(bounded, step);
  };
  const bump = (dir: 1 | -1) => {
    const current = Number.isFinite(value) ? value : min;
    const nextVal = clamp(current + dir * step);
    onChange?.(Number(nextVal.toFixed(decimals)));
  };

  const [text, setText] = useState<string>(() => (decimals > 0 ? value.toFixed(decimals) : String(value)));
  const [isFocused, setIsFocused] = useState<boolean>(false);

  useEffect(() => {
    if (!isFocused) {
      setText(decimals > 0 ? value.toFixed(decimals) : String(value));
    }
  }, [value, decimals, isFocused]);

  const commit = (raw: string) => {
    const sanitized = raw.replace(',', '.').trim();
    const num = parseFloat(sanitized);
    if (!isNaN(num)) {
      const clamped = clamp(num);
      const finalVal = Number(clamped.toFixed(decimals));
      onChange?.(finalVal);
      setText(decimals > 0 ? finalVal.toFixed(decimals) : String(finalVal));
    } else {
      setText(decimals > 0 ? value.toFixed(decimals) : String(value));
    }
  };

  const btn =
    'w-[18px] h-[18px] shrink-0 rounded bg-zinc-900 border border-zinc-700 text-zinc-300 hover:text-white hover:border-zinc-500 active:scale-90 disabled:opacity-40 disabled:cursor-default text-[12px] font-bold leading-none flex items-center justify-center cursor-pointer transition-colors select-none';

  return (
    <div className="flex items-center justify-between gap-1.5 leading-tight" title={hint}>
      <span className="text-[9px] uppercase tracking-wide text-zinc-500 shrink-0 select-none">{label}</span>
      <span className="flex items-center gap-1">
        <button type="button" className={btn} disabled={!onChange} onClick={() => bump(-1)} aria-label={`Diminuir ${label}`}>
          −
        </button>
        <input
          type="text"
          inputMode={decimals > 0 ? 'decimal' : 'numeric'}
          value={text}
          disabled={!onChange}
          onFocus={(e) => {
            setIsFocused(true);
            e.target.select();
          }}
          onBlur={(e) => {
            setIsFocused(false);
            commit(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              commit((e.target as HTMLInputElement).value);
              (e.target as HTMLInputElement).blur();
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              bump(1);
            } else if (e.key === 'ArrowDown') {
              e.preventDefault();
              bump(-1);
            }
          }}
          onChange={(e) => {
            const raw = e.target.value;
            setText(raw);
            const num = parseFloat(raw.replace(',', '.'));
            if (!isNaN(num) && num >= min && num <= max) {
              onChange?.(Number(num.toFixed(decimals)));
            }
          }}
          className="w-[50px] h-[18px] rounded bg-zinc-900 border border-zinc-700 hover:border-zinc-500 px-1 text-center text-[10.5px] font-semibold font-mono tabular-nums text-zinc-100 focus:border-emerald-500 focus:outline-hidden disabled:opacity-50 transition-colors"
        />
        <button type="button" className={btn} disabled={!onChange} onClick={() => bump(1)} aria-label={`Aumentar ${label}`}>
          +
        </button>
        <span className="text-[8.5px] text-zinc-600 w-[16px] shrink-0 select-none">{unit}</span>
      </span>
    </div>
  );
};

export const BoletaTicket: React.FC<BoletaTicketProps> = ({
  currentPrice,
  contracts,
  stopLossPoints,
  takeProfitPoints,
  breakevenOffsetPoints = 5,
  strategyMode = 'PULLBACK_RETEST',
  openOrders,
  hedgeBook,
  isRealMT5Connected = false,
  asset = ASSETS[DEFAULT_ASSET_ID],
  trailingDistancePoints = 50,
  partialPoints = 50,
  rightOffset = 64,
  chartToolsOpen = false,
  onToggleChartTools,
  open,
  onOpenChange,
  onManualOrder,
  onClosePositionsSide,
  onClosePositions,
  onTakeProfitChange,
  onStopLossPointsChange,
  onPartialPointsChange,
  onBreakevenChange,
  onTrailingChange,
  onContractsChange,
  breakevenTriggerPoints = 0,
  breakevenLockPoints = 0,
  onBreakevenTriggerChange,
  onBreakevenLockChange,
  onRiskBRLChange,
  onFitChart,
  isChartShifted = false,
}) => {
  const [pinned, setPinned] = useState<boolean>(false);
  const [hovered, setHovered] = useState<boolean>(false);

  // PARÂMETROS: a sub-caixa recolhível dentro da boleta. A preferência é só de altura da caixa
  // (a largura não muda), então mora aqui dentro — o canvas não precisa saber de nada.
  const [paramsOpen, setParamsOpen] = useState<boolean>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_PARAMS_OPEN);
      return raw === null ? true : raw === 'true';
    } catch {
      return true;
    }
  });
  const toggleParams = () => {
    const next = !paramsOpen;
    setParamsOpen(next);
    try {
      localStorage.setItem(STORAGE_KEY_PARAMS_OPEN, String(next));
    } catch {
      // Ignora erro de storage
    }
  };

  // Recolhimento automático: roda de novo a cada mudança de estado e não interfere com o mouse
  // em cima da caixa, nem quando o operador fixou a boleta aberta.
  useEffect(() => {
    if (!open || pinned || hovered) return;
    const t = setTimeout(() => onOpenChange(false), AUTO_COLLAPSE_MS);
    return () => clearTimeout(t);
  }, [open, pinned, hovered, onOpenChange]);

  const isPyramid = strategyMode === 'PYRAMID_FLOW_CONFLUENCE';
  // R$ em risco na operação: a perda se o stop for batido (só faz sentido com SL fixo do modo Reteste)
  const riskBRL = isPyramid || stopLossPoints <= 0 ? 0 : pointsToBRL(stopLossPoints, contracts, asset);
  // Chip aberto: TUDO sempre visível — lados C/V (ainda que zerados), resultado da sessão e os
  // dois ZERAR (desabilitados quando o lado está vazio). A boleta é a base: dados e controles
  // dos dois lados vivem aqui, não atrás de um estado que some entre uma ordem e outra.
  const hedgeVisible =
    !!hedgeBook &&
    hedgeBook.buy.filled + hedgeBook.sell.filled + hedgeBook.buy.pending + hedgeBook.sell.pending > 0;

  // Recolhida, o ícone de olho (visualização) acompanha o chip: sem ele o atalho dos ajustes do gráfico ficaria
  // preso atrás do recolhimento automático (controle primário tem que estar sempre ao alcance).
  const gearBtn = (
    <button
      onClick={onToggleChartTools}
      className={`flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-md border backdrop-blur-md shadow-xl pointer-events-auto cursor-pointer transition-colors ${
        chartToolsOpen
          ? 'bg-amber-500/25 text-amber-200 border-amber-500/50'
          : 'bg-zinc-950/92 border-zinc-700/80 text-zinc-400 hover:text-white hover:border-zinc-600'
      }`}
      title="Ajustes de visualização do gráfico: tijolos, zoom, escala do fluxo e notificações"
      aria-label="Abrir ou fechar os ajustes de visualização do gráfico"
    >
      <Eye className="w-3.5 h-3.5" />
    </button>
  );

  // Chip fechado: um toque abre de novo (e a posição oposta do tijolo fica livre)
  if (!open) {
    return (
      <div
        className="absolute z-30 pointer-events-auto select-none flex items-center justify-end gap-1"
        style={{ right: rightOffset, top: BOLETA_TOP }}
      >
        {onFitChart && (
          <button
            onClick={onFitChart}
            className={`flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-md border backdrop-blur-md shadow-xl pointer-events-auto cursor-pointer transition-colors ${
              isChartShifted
                ? 'bg-sky-500/25 text-sky-200 border-sky-500/60 shadow-[0_0_8px_rgba(56,189,248,0.3)]'
                : 'bg-zinc-950/92 border-zinc-700/80 text-zinc-400 hover:text-white hover:border-zinc-600'
            }`}
            title="Auto-Fit: centralizar gráfico no preço e voltar ao tempo real"
            aria-label="Centralizar gráfico no preço"
          >
            <Focus className="w-3.5 h-3.5" />
          </button>
        )}
        {onToggleChartTools && gearBtn}
        <button
          onClick={() => onOpenChange(true)}
          className="flex items-center gap-1.5 px-2 h-[26px] rounded-md bg-zinc-950/92 backdrop-blur-md border border-zinc-700/80 shadow-xl text-[11px] font-mono text-zinc-200 hover:text-white hover:border-zinc-600 cursor-pointer transition-colors"
          title="Abrir a boleta (ordem rápida)"
        >
          <span className="text-[9px] font-sans font-bold uppercase tracking-wider text-amber-400">Boleta</span>
          <span className="font-semibold text-emerald-300 tabular-nums">{formatPrice(currentPrice, asset)}</span>
          {/* Recolhida, a boleta ainda resume o hedge: C/V com contratos de cada lado */}
          {hedgeVisible && (hedgeBook!.buy.contracts > 0 || hedgeBook!.sell.contracts > 0) ? (
            <span className="flex items-center gap-1 font-sans font-bold">
              {hedgeBook!.buy.contracts > 0 && (
                <span className="text-[9.5px] px-1 rounded bg-emerald-500/15 text-emerald-300 tabular-nums">
                  C{hedgeBook!.buy.contracts}
                </span>
              )}
              {hedgeBook!.sell.contracts > 0 && (
                <span className="text-[9.5px] px-1 rounded bg-rose-500/15 text-rose-300 tabular-nums">
                  V{hedgeBook!.sell.contracts}
                </span>
              )}
            </span>
          ) : (
            openOrders.length > 0 && (
              <span className="text-[9.5px] font-sans font-bold px-1 rounded bg-zinc-800 text-zinc-300">
                {openOrders.length}
              </span>
            )
          )}
          <ChevronUp className="w-3 h-3 text-zinc-500" />
        </button>
      </div>
    );
  }

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ right: rightOffset, top: BOLETA_TOP, width: BOLETA_WIDTH }}
      className="absolute z-30 rounded-lg bg-zinc-950/94 backdrop-blur-md border border-zinc-700/80 shadow-2xl pointer-events-auto select-none"
    >
      {/* Cabeçalho: título + fixar + recolher. O selo SIM/MT5 saiu daqui por pedido do operador
          (a linha ficou apertada com a engrenagem): o estado da ponte segue visível no botão de
          conexão do cabeçalho e nos títulos dos botões COMPRA/VENDA desta caixa. */}
      <div className="flex items-center gap-1.5 px-2 h-7 border-b border-zinc-800/80">
        <span className="text-[9px] font-sans font-bold uppercase tracking-wider text-amber-400">Boleta</span>
        {/* Ícone de Auto-Fit / Centralizar Preço */}
        {onFitChart && (
          <button
            onClick={onFitChart}
            className={`ml-auto p-0.5 cursor-pointer transition-colors ${
              isChartShifted
                ? 'text-sky-400 hover:text-sky-200 animate-pulse'
                : 'text-zinc-500 hover:text-zinc-200'
            }`}
            title="Auto-Fit: centralizar gráfico no preço e voltar ao tempo real"
            aria-label="Centralizar gráfico no preço"
          >
            <Focus className="w-3 h-3" />
          </button>
        )}
        {/* Ícone de olho dos ajustes de visualização: colado na linha da boleta, à esquerda do sininho. */}
        {onToggleChartTools && (
          <button
            onClick={onToggleChartTools}
            className={`${onFitChart ? '' : 'ml-auto '}p-0.5 cursor-pointer transition-colors ${
              chartToolsOpen ? 'text-amber-300' : 'text-zinc-500 hover:text-zinc-200'
            }`}
            title="Ajustes de visualização do gráfico: tijolos, zoom, escala do fluxo e notificações"
            aria-label="Abrir ou fechar os ajustes de visualização do gráfico"
          >
            <Eye className="w-3 h-3" />
          </button>
        )}
        <button
          onClick={() => setPinned((p) => !p)}
          className={`${onToggleChartTools ? '' : 'ml-auto '}p-0.5 cursor-pointer transition-colors ${
            pinned ? 'text-sky-300' : 'text-zinc-500 hover:text-zinc-200'
          }`}
          title={pinned ? 'Desfixar (volta a recolher sozinho)' : 'Fixar aberta (não recolhe sozinha)'}
          aria-label={pinned ? 'Desfixar boleta' : 'Fixar boleta'}
        >
          {pinned ? <PinOff className="w-3 h-3" /> : <Pin className="w-3 h-3" />}
        </button>
        <button
          onClick={() => onOpenChange(false)}
          className="p-0.5 text-zinc-500 hover:text-zinc-100 cursor-pointer"
          title="Recolher a boleta"
          aria-label="Recolher boleta"
        >
          <ChevronDown className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* ========================================================================== */}
      {/* PARÂMETROS: sub-caixa recolhível da boleta, igual à caixa inteira. A linha  */}
      {/* do Preço virou o TÍTULO branco — o preço já está bem visível na régua do    */}
      {/* gráfico. Dentro dela, todos os dados que antecedem os botões de ação.       */}
      {/* ========================================================================== */}
      <div className="border-b border-zinc-800/80">
        <button
          onClick={toggleParams}
          className="w-full flex items-center justify-between gap-2 px-2 py-1.5 cursor-pointer transition-colors hover:bg-zinc-900/60"
          title={paramsOpen ? 'Recolher os parâmetros da boleta' : 'Expandir os parâmetros da boleta'}
          aria-label={paramsOpen ? 'Recolher parâmetros' : 'Expandir parâmetros'}
          aria-expanded={paramsOpen}
        >
          <span className="text-[9px] font-sans font-bold uppercase tracking-wider text-white">Parâmetros</span>
          {paramsOpen ? (
            <ChevronUp className="w-3 h-3 text-zinc-500" />
          ) : (
            <ChevronDown className="w-3 h-3 text-zinc-500" />
          )}
        </button>
        {paramsOpen && (
          <div className="px-2 pb-1.5 space-y-0.5 font-mono">
            <StepperRow
              label="Contratos"
              value={contracts}
              min={1}
              max={99}
              step={1}
              unit="ct"
              onChange={onContractsChange}
              hint={`Lote das ordens da boleta e do Robô: ${contracts} contrato(s) · ${pointsToBRL(1, contracts, asset).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} por ponto a favor`}
            />
            {/* Stop, Alvo e Parcial editáveis: a boleta é a BASE — Robô, script Python e as
                estratégias do Estúdio buscam estes valores do config. Na Pirâmide o Stop da mãe é
                o ponto de partida do gatilho, mas o campo continua editável (vale para as pirâmides
                e para ordens manuais). */}
            {(() => {
              const def = asset?.tradeDefaults;
              const pStep = def?.stepperStep ?? (asset?.decimals ? 0.5 : 5);
              const maxSL = def?.maxSL ?? 1000;
              const maxTP = def?.maxTP ?? 2000;
              const beStep = asset?.decimals ? 0.5 : 1;
              const dec = asset?.decimals ?? 0;
              const minPar = pStep;
              return (
                <>
                  <StepperRow
                    label="Stop"
                    value={stopLossPoints}
                    min={0}
                    max={maxSL}
                    step={pStep}
                    decimals={dec}
                    unit="pts"
                    onChange={onStopLossPointsChange}
                    hint={`Stop Loss fixo: ${stopLossPoints} pts atrás da entrada ≈ ${pointsToBRL(stopLossPoints, contracts, asset).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} de risco por ${contracts} contrato(s). Base das estratégias.`}
                  />
                  <StepperRow
                    label="Risco SL"
                    value={Number(pointsToBRL(stopLossPoints, contracts, asset).toFixed(2))}
                    min={0}
                    max={Math.round(pointsToBRL(maxSL, contracts, asset))}
                    step={asset.id === 'WDO' ? 10 : 5}
                    decimals={2}
                    unit="R$"
                    onChange={(val) => {
                      const c = Math.max(1, contracts);
                      const pts = snapToTick(val / (asset.pointValue * c), asset);
                      onStopLossPointsChange?.(pts);
                      onRiskBRLChange?.(val);
                    }}
                    hint={
                      stopLossPoints <= 0
                        ? 'Risco financeiro: R$ 0,00 (sem Stop fixo — saída na virada de fluxo). Para definir um Stop Loss em R$, digite ou aumente o valor aqui.'
                        : `Risco financeiro da operação: perda máxima estimada se atingir o Stop Loss (${stopLossPoints} pts × ${contracts} ctro(s) × R$ ${asset.pointValue} = R$ ${pointsToBRL(stopLossPoints, contracts, asset).toFixed(2)}). Ao editar o valor em R$, o Stop Loss em pontos é recalculado automaticamente.`
                    }
                  />
                  <StepperRow
                    label="Alvo"
                    value={takeProfitPoints}
                    min={0}
                    max={maxTP}
                    step={pStep}
                    decimals={dec}
                    unit="pts"
                    onChange={onTakeProfitChange}
                    hint={`TP variável — base das estratégias: Robô, script Python e ordens da boleta buscam este valor. ${takeProfitPoints} pts ≈ ${pointsToBRL(takeProfitPoints, contracts, asset).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} por ${contracts} ctro(s)`}
                  />
                  <StepperRow
                    label="Parcial"
                    value={partialPoints}
                    min={minPar}
                    max={maxSL}
                    step={pStep}
                    decimals={dec}
                    unit="pts"
                    onChange={onPartialPointsChange}
                    hint={`Saída parcial (metade do lote) em +${partialPoints} pts — protege o breakeven antes do alvo final. Base das estratégias.`}
                  />
                  <StepperRow
                    label="Break even"
                    value={breakevenOffsetPoints}
                    min={0}
                    max={maxSL / 4}
                    step={beStep}
                    decimals={dec}
                    unit="pts"
                    onChange={onBreakevenChange}
                    hint={`Piso de proteção (taxas B3): ao proteger a posição, o stop garante entrada + ${breakevenOffsetPoints} pts. Vale para o breakeven da parcial, o do TP da pirâmide e o piso do gatilho.`}
                  />
                  <StepperRow
                    label="BE gatilho"
                    value={breakevenTriggerPoints}
                    min={0}
                    max={maxTP}
                    step={pStep}
                    decimals={dec}
                    unit="pts"
                    onChange={onBreakevenTriggerChange}
                    hint={
                      breakevenTriggerPoints <= 0 || breakevenLockPoints <= 0
                        ? 'DESLIGADO: o breakeven por distância não arma. A posição só sai na virada do sinal (ou no Stop, se houver).'
                        : `Breakeven por distância: quando a operação andar +${breakevenTriggerPoints} pts a favor, o stop trava em +${Math.max(breakevenLockPoints, breakevenOffsetPoints)} pts (o piso de taxas de ${breakevenOffsetPoints} pt nunca é violado). Vale o que vier primeiro: este stop, o Stop fixo ou a virada.`
                    }
                  />
                  <StepperRow
                    label="BE trava"
                    value={breakevenLockPoints}
                    min={0}
                    max={maxTP}
                    step={pStep}
                    decimals={dec}
                    unit="pts"
                    onChange={onBreakevenLockChange}
                    hint={
                      breakevenLockPoints <= 0
                        ? 'ZERO = breakeven por distância desligado (precisa dos dois campos preenchidos para armar).'
                        : `Garante +${breakevenLockPoints} pts (≈ ${pointsToBRL(breakevenLockPoints, contracts, asset).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} por ${contracts} ctro) quando o gatilho de ${breakevenTriggerPoints} pts for atingido.`
                    }
                  />
                  <StepperRow
                    label="Trailing"
                    value={trailingDistancePoints}
                    min={0}
                    max={maxSL}
                    step={pStep}
                    decimals={dec}
                    unit="pts"
                    onChange={onTrailingChange}
                    hint={`Trailing Stop: depois do gatilho, o stop acompanha o preço sempre ${trailingDistancePoints} pts atrás do extremo (máxima na compra, mínima na venda). Só anda a favor.`}
                  />
                </>
              );
            })()}
          </div>
        )}
      </div>

      {/* Ações */}
      <div className="px-2 pb-2 flex items-center gap-1.5">
        <button
          onClick={() => onManualOrder?.('BUY')}
          disabled={!onManualOrder}
          className="flex-1 h-[30px] rounded bg-emerald-600 hover:bg-emerald-500 active:scale-95 disabled:opacity-40 text-white text-[11px] font-bold flex items-center justify-center gap-1 transition-all cursor-pointer"
          title={`Enviar COMPRA a mercado (${contracts} ctros a ${formatPrice(currentPrice, asset)} pts)\n${
            isRealMT5Connected ? '🔌 Ponte MT5: este clique vai à corretora' : '🧪 Modo SIM: nada vai à corretora'
          }`}
        >
          <ArrowUp className="w-3 h-3 stroke-[2.5]" />
          <span>COMPRA</span>
        </button>
        <button
          onClick={() => onManualOrder?.('SELL')}
          disabled={!onManualOrder}
          className="flex-1 h-[30px] rounded bg-rose-600 hover:bg-rose-500 active:scale-95 disabled:opacity-40 text-white text-[11px] font-bold flex items-center justify-center gap-1 transition-all cursor-pointer"
          title={`Enviar VENDA a mercado (${contracts} ctros a ${formatPrice(currentPrice, asset)} pts)\n${
            isRealMT5Connected ? '🔌 Ponte MT5: este clique vai à corretora' : '🧪 Modo SIM: nada vai à corretora'
          }`}
        >
          <ArrowDown className="w-3 h-3 stroke-[2.5]" />
          <span>VENDA</span>
        </button>
      </div>
      {/* ZERAR TUDO em cima dos ZERAR por lado, sem borda entre eles: os três zerar formam
          um bloco só, logo abaixo de COMPRA/VENDA. Fecha os dois lados de uma vez. */}
      {onClosePositions && (
        <div className={`px-2 pb-1.5 grid grid-cols-2 gap-1.5 ${hedgeBook || onClosePositionsSide ? '' : 'pt-1.5 border-t border-zinc-800/80'}`}>
          <div className={`grid grid-cols-2 gap-1.5 col-span-2 ${onClosePositionsSide ? '' : 'hidden'}`}>
            <button
              onClick={() => onClosePositionsSide?.('BUY')}
              disabled={!hedgeBook || hedgeBook.buy.filled === 0}
              className="h-[24px] rounded text-[9.5px] font-bold bg-emerald-500/15 hover:bg-emerald-500/25 disabled:opacity-35 disabled:hover:bg-emerald-500/15 text-emerald-300 border border-emerald-500/40 active:scale-95 transition-all cursor-pointer disabled:cursor-default flex items-center justify-center gap-1"
              title="Zerar só as COMPRAS — as VENDAS do hedge continuam abertas"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse shrink-0" />
              <span>ZERAR C{hedgeBook ? ` (${hedgeBook.buy.contracts}ct)` : ''}</span>
            </button>
            <button
              onClick={() => onClosePositionsSide?.('SELL')}
              disabled={!hedgeBook || hedgeBook.sell.filled === 0}
              className="h-[24px] rounded text-[9.5px] font-bold bg-rose-500/15 hover:bg-rose-500/25 disabled:opacity-35 disabled:hover:bg-rose-500/15 text-rose-300 border border-rose-500/40 active:scale-95 transition-all cursor-pointer disabled:cursor-default flex items-center justify-center gap-1"
              title="Zerar só as VENDAS — as COMPRAS do hedge continuam abertas"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-rose-400 animate-pulse shrink-0" />
              <span>ZERAR V{hedgeBook ? ` (${hedgeBook.sell.contracts}ct)` : ''}</span>
            </button>
          </div>
          <button
            onClick={onClosePositions}
            disabled={openOrders.length === 0}
            className="col-span-2 h-[26px] rounded text-[10px] font-bold bg-amber-500/15 hover:bg-amber-500/25 disabled:opacity-35 disabled:hover:bg-amber-500/15 text-amber-300 border border-amber-500/40 active:scale-95 transition-all cursor-pointer disabled:cursor-default flex items-center justify-center gap-1.5"
            title="Zerar TUDO — fecha COMPRAS e VENDAS de uma vez"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
            <span>ZERAR TUDO ({openOrders.length})</span>
          </button>
        </div>
      )}
      {/* =================================================================== */}
      {/* HEDGE: o livro que migrou das linhas de menu para baixo dos botões.  */}
      {/* Dois lados (C/V) com contratos, preço médio e flutuante; realizado da */}
      {/* sessão (ganhos/perdas) e PnL do dia.                                  */}
      {/* =================================================================== */}
      {hedgeBook && (
        <div className="border-t border-zinc-800/80">
          <div className="px-2 py-1.5 space-y-0.5 font-mono">
            <div className="flex items-center justify-between leading-tight">
              <span className="text-[8.5px] font-sans font-bold uppercase tracking-wider text-zinc-500">
                Hedge
              </span>
              <span
                className="text-[8.5px] font-sans text-zinc-600"
                title="Contratos em cada lado. Em hedge os dois lados ficam vivos ao mesmo tempo."
              >
                {hedgeBook.buy.filled + hedgeBook.sell.filled} aberta(s)
              </span>
            </div>
            <SideRow tag="C" book={hedgeBook.buy} asset={asset} />
            <SideRow tag="V" book={hedgeBook.sell} asset={asset} />
          </div>
          <div className="px-2 py-1.5 space-y-0.5 font-mono border-t border-zinc-800/60">
            <Row label="Ganhos" value={brl(hedgeBook.realizedProfit)} tone="emerald" />
            <Row label="Perdas" value={brl(hedgeBook.realizedLoss)} tone="rose" />
            <Row
              label="PnL dia"
              value={brl(hedgeBook.dayPnl)}
              tone={hedgeBook.dayPnl > 0 ? 'emerald' : hedgeBook.dayPnl < 0 ? 'rose' : 'neutral'}
            />
          </div>
          {/* Giro do dia no rodapé — fecho padrão de order ticket: depois das ações, o resumo.
              Contratos NEGOCIADOS hoje por lado (abertas + fechadas da sessão), não só o vivo. */}
          <div className="px-2 pb-2 pt-1.5 border-t border-zinc-800/60 space-y-0.5 font-mono">
            <Row label="Compra hoje" value={`${hedgeBook.buyContractsToday} ct`} tone="emerald" />
            <Row label="Venda hoje" value={`${hedgeBook.sellContractsToday} ct`} tone="rose" />
            <Row label="Total dia" value={`${hedgeBook.contractsTodayTotal} ct`} tone="sky" />
          </div>
        </div>
      )}
    </div>
  );
};
