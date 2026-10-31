import React, { useSyncExternalStore } from 'react';
import {
  Activity,
  Cpu,
  Play,
  Pause,
  StepForward,
  Zap,
  ArrowUpRight,
  ArrowDownRight,
  History,
  BookOpen,
  Bot,
  Database,
  Radio,
} from 'lucide-react';
import { AutomationConfig, MT5ConnectionState } from '../types/trading';
import { ChartSeries } from '../utils/barEngines';
import { SeriesKey } from '../utils/paperStrategyBot';
import { seriesCollectorService, SERIES_LABEL } from '../services/seriesCollectorService';
import { sessionCloseLockLabel } from '../utils/sessionRules';
import { ASSETS, AssetSpec, DEFAULT_ASSET_ID, formatPrice, renkoScaleLabel } from '../assets/assetRegistry';

/**
 * Aba SIMULADOR — Raio-X do sistema (pensada para quem está aprendendo).
 * Mostra em linguagem simples: o que gera os ticks, qual motor está ativo,
 * quantas barras cada série já fechou, o caminho do tick até a ordem,
 * e controles diretos (velocidade, pausar, 1 tick, agressão, replay).
 */

interface SimulatorViewProps {
  isSimulating: boolean;
  setIsSimulating: (v: boolean) => void;
  simulationSpeed: number;
  setSimulationSpeed: (v: number) => void;
  robotActive: boolean;
  onToggleRobot: () => void;
  currentPrice: number;
  mt5Status: MT5ConnectionState['status'];
  chartSeries: ChartSeries;
  rangePoints: number;
  timeframeSec: number;
  config: AutomationConfig;
  boxCounts: Record<SeriesKey, number>;
  tickBufferCount: number;
  ordersOpen: number;
  ordersClosed: number;
  onStepTick: () => void;
  onInjectAggression: (side: 'BUY' | 'SELL') => void;
  onReplayHistory: (days: number) => void;
  isReplaying: boolean;
  /** Ativo do simulador: horário de pregão, variação mínima e escala do Renko saem do spec. */
  asset?: AssetSpec;
}

const seriesAccent: Record<SeriesKey, string> = {
  renko: '#10b981',
  range: '#38bdf8',
  tempo: '#f59e0b',
  renko15r: '#a78bfa',
  renko20r: '#f472b6',
  renko25r: '#fb923c',
};

const StatChip: React.FC<{ label: string; value: string; color?: string }> = ({ label, value, color }) => (
  <div className="flex flex-col rounded-md border border-slate-800 bg-slate-900/60 px-2.5 py-1.5 min-w-[92px]">
    <span className="text-[9px] uppercase tracking-wider text-slate-500">{label}</span>
    <span className={`text-sm font-bold tabular-nums ${color ?? 'text-slate-100'}`}>{value}</span>
  </div>
);

const EngineCard: React.FC<{
  k: SeriesKey;
  scale: string;
  role: string;
  boxes: number;
  activeSeries: boolean;
  feedsRealOrders: boolean;
}> = ({ k, scale, role, boxes, activeSeries, feedsRealOrders }) => (
  <div
    className={`rounded-lg border px-3 py-2.5 flex flex-col gap-1 ${
      activeSeries ? 'bg-slate-800/60' : 'bg-slate-900/40'
    }`}
    style={{ borderColor: activeSeries ? `${seriesAccent[k]}` : `${seriesAccent[k]}44` }}
  >
    <div className="flex items-center gap-2">
      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: seriesAccent[k] }} />
      <span className="text-xs sm:text-[13px] font-bold text-slate-100">{SERIES_LABEL[k]}</span>
      <span className="ml-auto font-mono text-[11px] text-slate-400">{scale}</span>
    </div>
    <span className="text-[10px] text-slate-500 leading-snug">{role}</span>
    <div className="flex items-center justify-between mt-0.5">
      <span className="text-[11px] text-slate-400">
        Barras fechadas: <b className="text-slate-100 tabular-nums">{boxes.toLocaleString('pt-BR')}</b>
      </span>
      {feedsRealOrders ? (
        <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
          Ordens reais aqui
        </span>
      ) : (
        <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-slate-800 text-slate-500 border border-slate-700">
          Só medição
        </span>
      )}
    </div>
  </div>
);

const PipelineStep: React.FC<{ n: number; title: string; desc: string; value: string; icon: React.ReactNode }> = ({
  n,
  title,
  desc,
  value,
  icon,
}) => (
  <div className="flex items-start gap-3 rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2.5">
    <div className="flex flex-col items-center gap-1 shrink-0">
      <div className="w-7 h-7 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-slate-300">
        {icon}
      </div>
      <span className="text-[9px] font-mono text-slate-600">ETAPA {n}</span>
    </div>
    <div className="flex-1 min-w-0">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-bold text-slate-100">{title}</span>
        <span className="text-[11px] font-mono text-emerald-300 tabular-nums shrink-0">{value}</span>
      </div>
      <p className="text-[10px] sm:text-[11px] text-slate-500 leading-snug mt-0.5">{desc}</p>
    </div>
  </div>
);

const GlossaryItem: React.FC<{ term: string; children: React.ReactNode }> = ({ term, children }) => (
  <details className="group rounded-md border border-slate-800 bg-slate-900/40 px-3 py-2">
    <summary className="text-[11px] sm:text-xs font-semibold text-slate-200 cursor-pointer list-none flex items-center justify-between">
      {term}
      <span className="text-slate-600 group-open:rotate-90 transition-transform text-xs">▸</span>
    </summary>
    <p className="text-[11px] text-slate-400 leading-relaxed mt-1.5">{children}</p>
  </details>
);

export const SimulatorView: React.FC<SimulatorViewProps> = ({
  isSimulating,
  setIsSimulating,
  simulationSpeed,
  setSimulationSpeed,
  robotActive,
  onToggleRobot,
  currentPrice,
  mt5Status,
  chartSeries,
  rangePoints,
  timeframeSec,
  config,
  boxCounts,
  tickBufferCount,
  ordersOpen,
  ordersClosed,
  onStepTick,
  onInjectAggression,
  onReplayHistory,
  isReplaying,
  asset = ASSETS[DEFAULT_ASSET_ID],
}) => {
  useSyncExternalStore(seriesCollectorService.subscribe, seriesCollectorService.getVersion);
  const snap = seriesCollectorService.getSnapshot();

  const mt5Live = mt5Status === 'CONNECTED';
  const intervalMs = Math.max(50, Math.floor(2000 / simulationSpeed));
  const paceLabel = `${(intervalMs / 1000).toFixed(1).replace('.', ',')}s por tick`;
  const renkoScale = renkoScaleLabel(config.boxPoints, asset);
  const tickLabel = `${formatPrice(asset.tickSize, asset)} pts`;
  const sessionLabel = `${asset.session.open}–${asset.session.close}`;
  const collectorFresh = Date.now() - snap.updatedAt < 6000;

  const feedLabel = mt5Live
    ? 'MT5 AO VIVO'
    : isSimulating
    ? 'SIMULADOR RODANDO'
    : 'PAUSADO';
  const feedColor = mt5Live ? 'text-emerald-300' : isSimulating ? 'text-emerald-300' : 'text-rose-300';

  const activeSeriesKey: SeriesKey = chartSeries === 'renko' ? 'renko' : 'range';
  const shadowTrades = (Object.keys(snap.series) as SeriesKey[]).reduce((a, k) => a + snap.series[k].stats.trades, 0);
  const shadowOpen = (Object.keys(snap.series) as SeriesKey[]).reduce((a, k) => a + snap.series[k].stats.openCount, 0);

  return (
    <div className="h-full w-full rounded-lg border border-slate-800 bg-slate-950 flex flex-col overflow-hidden">
      {/* Faixa de status ao vivo */}
      <div className="flex items-center gap-2.5 px-3 sm:px-4 py-2.5 border-b border-slate-800 bg-slate-900/60 shrink-0 flex-wrap">
        <div className="p-1.5 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 shrink-0">
          <Cpu className="w-4 h-4" />
        </div>
        <div className="flex flex-col min-w-0 mr-2">
          <span className="text-sm font-bold text-slate-100 leading-tight">Simulador — Raio-X do Sistema</span>
          <span className="text-[10px] sm:text-[11px] text-slate-400 leading-tight">
            Tudo que está rodando neste exato momento, sem mistério
          </span>
        </div>
        <div
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-[11px] font-bold uppercase tracking-wider ${
            isSimulating || mt5Live
              ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-300'
              : 'bg-rose-500/10 border-rose-500/30 text-rose-300'
          }`}
        >
          <Radio className={`w-3 h-3 ${isSimulating || mt5Live ? 'animate-pulse' : ''}`} />
          {feedLabel}
        </div>
        <StatChip label="Preço" value={`${currentPrice.toLocaleString('pt-BR')} pts`} color="text-emerald-300" />
        <StatChip label="Ritmo" value={mt5Live ? 'tempo real' : `≈ ${paceLabel}`} />
        <StatChip label="Buffer de ticks" value={tickBufferCount.toLocaleString('pt-BR')} />
        <StatChip label="Robô" value={robotActive ? 'LIGADO' : 'PAUSADO'} color={robotActive ? 'text-emerald-300' : 'text-rose-300'} />
      </div>

      {/* Corpo rolável */}
      <div className="flex-1 min-h-0 overflow-y-auto px-3 sm:px-4 py-3 space-y-4">
        {/* Controles diretos */}
        <section>
          <h3 className="text-xs sm:text-sm font-bold text-slate-100 uppercase tracking-wide mb-2">Controles do mercado</h3>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => setIsSimulating(!isSimulating)}
              disabled={mt5Live}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold text-white transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                isSimulating ? 'bg-slate-700 hover:bg-slate-600' : 'bg-emerald-600 hover:bg-emerald-500'
              }`}
              title={mt5Live ? 'Com o MT5 conectado, o feed vem da corretora' : 'Ligar/desligar a geração de ticks do simulador'}
            >
              {isSimulating ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
              {isSimulating ? 'Pausar mercado' : 'Iniciar mercado'}
            </button>
            <button
              onClick={onStepTick}
              disabled={mt5Live}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              title="Avançar exatamente 1 tick (bom para estudar o gráfico degrau a degrau)"
            >
              <StepForward className="w-3.5 h-3.5" />
              1 tick
            </button>
            <button
              onClick={onToggleRobot}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold border transition-colors cursor-pointer ${
                robotActive
                  ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/25'
                  : 'bg-rose-500/10 border-rose-500/30 text-rose-300 hover:bg-rose-500/20'
              }`}
              title="Ligar/desligar o disparo automático de ordens (vale para simulador e MT5)"
            >
              <Bot className="w-3.5 h-3.5" />
              Robô: {robotActive ? 'LIGADO' : 'PAUSADO'}
            </button>
            <div className="flex items-center gap-1">
              <button
                onClick={() => onInjectAggression('BUY')}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-[11px] font-bold bg-emerald-600/70 hover:bg-emerald-500 text-white transition-colors cursor-pointer"
                title="Injeta uma agressão de compra grande (testa o fluxo comprador no gráfico)"
              >
                <ArrowUpRight className="w-3.5 h-3.5" /> Agressão compra
              </button>
              <button
                onClick={() => onInjectAggression('SELL')}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-[11px] font-bold bg-rose-600/70 hover:bg-rose-500 text-white transition-colors cursor-pointer"
                title="Injeta uma agressão de venda grande (teste defensivo da estratégia)"
              >
                <ArrowDownRight className="w-3.5 h-3.5" /> Agressão venda
              </button>
            </div>
            {/* Velocidade — comanda o feed ao vivo E a reprodução do replay (mesma da tira de status) */}
            <div
              className="flex items-center gap-2 ml-auto rounded-lg border border-slate-800 bg-slate-900/60 px-2.5 py-1.5"
              title="Compasso do simulador: vale para o feed ao vivo e para a reprodução do replay. 1x = bem lento (o dia inteiro leva ~1min45 no replay); 2x ~55s, 5x ~15s e 10x = modo apresentação (~5s)."
            >
              <Activity className="w-3.5 h-3.5 text-slate-400" />
              <span className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Velocidade</span>
              <input
                type="range"
                min={1}
                max={10}
                step={1}
                value={simulationSpeed}
                onChange={(e) => setSimulationSpeed(Number(e.target.value))}
                className="w-28 accent-emerald-500 cursor-pointer"
              />
              <span className="text-xs font-mono text-slate-200 w-6 text-right">{simulationSpeed}</span>
            </div>
          </div>
          {mt5Live && (
            <p className="text-[10px] sm:text-[11px] text-emerald-300/80 mt-1.5">
              MT5 conectado: os ticks agora vêm da corretora (o simulador está desligado automaticamente).
            </p>
          )}
        </section>

        {/* Motores de barra */}
        <section>
          <h3 className="text-xs sm:text-sm font-bold text-slate-100 uppercase tracking-wide mb-2">
            Quem está calculando agora — 6 motores em paralelo
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
            <EngineCard
              k="renko"
              scale={`${renkoScale} · ${config.boxPoints} pts`}
              role={
                chartSeries === 'renko'
                  ? 'SÉRIE ATIVA no gráfico — é esta que o robô usa para as ordens reais'
                  : `Motor clássico de blocos de pontos (1R = ${tickLabel})`
              }
              boxes={boxCounts.renko}
              activeSeries={chartSeries === 'renko'}
              feedsRealOrders={chartSeries === 'renko'}
            />
            <EngineCard
              k="range"
              scale={`${rangePoints} pts`}
              role={
                chartSeries === 'range'
                  ? 'SÉRIE ATIVA no gráfico — é esta que o robô usa para as ordens reais'
                  : 'Bloco fecha quando o preço percorre a metragem, ignore o tempo'
              }
              boxes={boxCounts.range}
              activeSeries={chartSeries === 'range'}
              feedsRealOrders={chartSeries === 'range'}
            />
            <EngineCard
              k="tempo"
              scale={`${timeframeSec < 60 ? `${timeframeSec}s` : `${Math.round(timeframeSec / 60)}min`}`}
              role='Saiu do gráfico (coisa do passado): roda escondido e só mostra o que já foi registrado no Coletor'
              boxes={boxCounts.tempo}
              activeSeries={false}
              feedsRealOrders={false}
            />
            <EngineCard
              k="renko15r"
              scale="75 pts"
              role="Renko grande de teste — roda escondido só para o coletor medir"
              boxes={boxCounts.renko15r}
              activeSeries={false}
              feedsRealOrders={false}
            />
            <EngineCard
              k="renko20r"
              scale="100 pts"
              role="Renko grande de teste — roda escondido só para o coletor medir"
              boxes={boxCounts.renko20r}
              activeSeries={false}
              feedsRealOrders={false}
            />
            <EngineCard
              k="renko25r"
              scale="125 pts"
              role="Renko grande de teste — roda escondido só para o coletor medir"
              boxes={boxCounts.renko25r}
              activeSeries={false}
              feedsRealOrders={false}
            />
          </div>
        </section>

        {/* Pipeline do tick até a ordem */}
        <section>
          <h3 className="text-xs sm:text-sm font-bold text-slate-100 uppercase tracking-wide mb-2">
            O caminho de 1 tick até virar ordem
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5">
            <PipelineStep
              n={1}
              icon={<Radio className="w-3.5 h-3.5" />}
              title="Mercado"
              desc="Simulador (ou MT5) gera ticks com preço, volume e agressor."
              value={`${tickBufferCount.toLocaleString('pt-BR')} ticks`}
            />
            <PipelineStep
              n={2}
              icon={<Cpu className="w-3.5 h-3.5" />}
              title="6 motores de barra"
              desc="Cada tick alimenta Renko, Range, Tempo e 15R/20R/25R ao mesmo tempo."
              value={`${Object.values(boxCounts).reduce((a, b) => a + b, 0).toLocaleString('pt-BR')} barras`}
            />
            <PipelineStep
              n={3}
              icon={<Zap className="w-3.5 h-3.5" />}
              title="Convergência"
              desc={`Estratégia ${config.strategyMode === 'PYRAMID_FLOW_CONFLUENCE' ? 'Pirâmide de Confluência' : 'Reteste (Pullback)'} avalia CADA barra que fecha.`}
              value={`série: ${SERIES_LABEL[activeSeriesKey]}`}
            />
            <PipelineStep
              n={4}
              icon={<Bot className="w-3.5 h-3.5" />}
              title="Robô real"
              desc="Só a SÉRIE ATIVA do gráfico dispara ordens (demo ou MT5)."
              value={`${ordersOpen} abertas / ${ordersClosed} fechadas`}
            />
            <PipelineStep
              n={5}
              icon={<Database className="w-3.5 h-3.5" />}
              title="Coletor sombra"
              desc="6 robôs de papel copiam as 6 séries para comparar eficiência."
              value={collectorFresh ? `${shadowTrades} trades • recebendo` : `${shadowTrades} trades`}
            />
          </div>
        </section>

        {/* Números da sessão + replay */}
        <section>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-2.5">
            <div className="rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2.5">
              <h3 className="text-xs sm:text-sm font-bold text-slate-100 uppercase tracking-wide mb-2">Números da sessão</h3>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] sm:text-xs text-slate-400">
                <span>Início da sessão</span>
                <b className="text-slate-100 text-right">{new Date(snap.sessionStarted).toLocaleTimeString('pt-BR')}</b>
                <span>Trades sombra (6 séries)</span>
                <b className="text-slate-100 text-right">{shadowTrades.toLocaleString('pt-BR')}</b>
                <span>Posições sombra abertas</span>
                <b className="text-slate-100 text-right">{shadowOpen}</b>
                <span>Ordens reais abertas</span>
                <b className="text-slate-100 text-right">{ordersOpen}</b>
                <span>Modo do EA</span>
                <b className="text-slate-100 text-right">
                  {config.strategyMode === 'PYRAMID_FLOW_CONFLUENCE' ? 'Pirâmide' : 'Reteste'}
                </b>
              </div>
            </div>
            <div className="rounded-lg border border-violet-500/30 bg-violet-500/5 px-3 py-2.5">
              <h3 className="text-xs sm:text-sm font-bold text-slate-100 uppercase tracking-wide mb-1">
                Histórico sintético (replay)
              </h3>
              <p className="text-[11px] text-slate-400 leading-snug mb-2">
                Gera {asset.session.weekdaysOnly ? 'dias úteis' : 'dias'} falsos ({sessionLabel}, com leilão/almoço/fechamento realistas) e reproduz nos
                6 motores e no coletor. <b className="text-slate-200">Nada aqui envia ordens reais.</b> Atenção: o
                replay zera a contabilidade atual do coletor <b className="text-slate-200">e também as ordens
                abertas, o livro de auditoria e o PnL da sessão</b> (começa um pregão limpo). Com o MT5
                conectado nada é apagado.
                <span className="text-slate-300"> A corrida agora é <b className="text-slate-200">progressiva</b>: começa
                na primeira barra e desenha o período todo (mínimo 1 dia) no compasso da velocidade acima — 1x leva ~1min45,
                2x ~55s, 5x ~15s e 10x roda em ~5s. Já dispara sozinha na abertura da plataforma e o mesmo controle vive na tira de status
                logo abaixo do menu, então não precisa sair desta aba para escolher o dia.</span>
                <span className="text-slate-300"> No chip <b className="text-slate-200">OPERA</b> da tira de status o
                replay também <b className="text-slate-200">opera a estratégia de verdade</b>: abre MAE e pirâmides,
                enche a auditoria e move o PnL enquanto o dia passa (precisa do Robô LIGADO). Desligado, ele fica
                silencioso e só alimenta o coletor. Nos dois casos nada é enviado à corretora — com o MT5 conectado o
                modo OPERA é bloqueado por segurança.</span>
                <span className="text-slate-300"> Trava de horário: {config.tradingHoursEnabled ? <b className="text-slate-200">liberado das {config.tradingStartTime} (leilão à vista e o 1º candle já é operável) e bloqueado das {config.tradingStopEntriesTime} até as {config.tradingStartTime}</b> : <b className="text-slate-200">filtro de entradas desligado — o robô pode abrir em qualquer hora do pregão</b>} — a janela é medida na hora da barra simulada, nunca no relógio da sala. Ao chegar na zeragem das <b className="text-slate-200">{sessionCloseLockLabel(config.tradingCloseAllTime)}</b> (hora da estratégia) o robô liquida todas as posições a mercado, cancela
                as limitadas pendentes e para de abrir operações até o próximo pregão — assim nenhum dia termina
                pendurado com ordem aberta. Com o MT5 conectado a trava não age, para jamais fechar posição real sem
                você mandar.</span>
              </p>
              <div className="flex items-center gap-2">
                {[1, 3, 5].map((d) => (
                  <button
                    key={d}
                    onClick={() => onReplayHistory(d)}
                    disabled={isReplaying}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold transition-colors cursor-pointer ${
                      isReplaying
                        ? 'bg-violet-500/20 text-violet-300/50 cursor-wait'
                        : 'bg-violet-600/60 hover:bg-violet-500 text-white'
                    }`}
                  >
                    <History className="w-3.5 h-3.5" /> {isReplaying ? 'Rodando...' : `${d} dia${d > 1 ? 's' : ''}`}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Glossário */}
        <section>
          <h3 className="text-xs sm:text-sm font-bold text-slate-100 uppercase tracking-wide mb-2 flex items-center gap-1.5">
            <BookOpen className="w-4 h-4 text-slate-400" /> O que é cada coisa? (clique para abrir)
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <GlossaryItem term="1R e o gráfico de Pontos (Renko)">
              1R = 1 bloco de {tickLabel} do {asset.label}. O gráfico de Pontos só desenha bloco quando o preço
              percorre a escala configurada (ex.: {renkoScale} = {config.boxPoints} pts, como está agora). Tempo não importa, só movimento.
            </GlossaryItem>
            <GlossaryItem term="Gráfico de Range">
              Bloco fecha quando o preço percorre a metragem escolhida (ex.: 50 pts entre mínima e máxima),
              não importa quanto tempo leve. Ótimo para ver a "briga" entre compra e venda.
            </GlossaryItem>
            <GlossaryItem term="Gráfico de Tempo">
              Candle por relógio (ex.: 30 segundos), desenhado como bloco sólido estilo Renko. É o gráfico
              tradicional, mas com a nossa pintura.
            </GlossaryItem>
            <GlossaryItem term="Robô sombra e Coletor">
              Seis contadores invisíveis que copiam a estratégia do EA em cada série/escala ao mesmo tempo e
              guardam o resultado em R$ na tela "Comparativo". Pura contabilidade — não envia ordem nenhuma.
            </GlossaryItem>
            <GlossaryItem term="Agressão de compra/venda (bancada)">
              Os botões injetam um bloco de ordens agressoras de ~100 contratos no preço. Serve para ver o
              indicador de fluxo e os motores reagindo a um choque de demanda/oferta.
            </GlossaryItem>
            <GlossaryItem term="Por que 15R/20R/25R fecham tão devagar?">
              Blocos de 75–125 pontos precisam percorrer 15–25x um R minúsculo. No simulador (que ladoia),
              isso leva minutos de tela — rode um replay 3d ou 5d para vê-los operar de verdade.
            </GlossaryItem>
          </div>
        </section>
      </div>

      {/* Rodapé */}
      <div className="px-3 sm:px-4 py-2 border-t border-slate-800/60 shrink-0">
        <p className="text-[10px] text-slate-500 leading-snug">
          Regra de ouro do sistema: <b className="text-slate-300">o robô real só obedece à série ativa no gráfico</b>
          ({SERIES_LABEL[activeSeriesKey]}). Todo o resto (15R/20R/25R e as outras 2 séries) roda em paralelo apenas
          para medir eficiência no coletor.
        </p>
      </div>
    </div>
  );
};
