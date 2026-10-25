import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Tick, RenkoBox, TradeOrder, AutomationConfig, TerminalStats, MT5ConnectionState } from './types/trading';
import { RenkoFlowEngine } from './utils/renkoCalculator';
import { B3MarketSimulator } from './utils/marketSimulator';
import { Header } from './components/Header';
import { RenkoFlowChart } from './components/RenkoFlowChart';
import { TimesAndTrades } from './components/TimesAndTrades';
import { AutomationPanel } from './components/AutomationPanel';
import { OrdersAndStats } from './components/OrdersAndStats';
import { PythonScriptView } from './components/PythonScriptView';
import { DocumentationView } from './components/DocumentationView';
import { SubscriptionPaywall } from './components/SubscriptionPaywall';
import { AdminPanel } from './components/AdminPanel';
import { EquityCurveView } from './components/EquityCurveView';
import { UserProfile } from './types/auth';
import { AuthService } from './services/authService';
import { EaConfigService } from './services/eaConfigService';
import { OrderAuditService } from './services/orderAuditService';
import { IntradayOrderAudit } from './components/IntradayOrderAudit';
import { ProjectDossierPdfModal } from './components/ProjectDossierPdfModal';
import { ArrowUpRight, ArrowDownRight, Wifi, AlertTriangle, TrendingUp, Activity, Layers, Sliders, ShieldCheck, Terminal, LineChart } from 'lucide-react';

export default function App() {
  const [activeTab, setActiveTab] = useState<'chart' | 'tape' | 'equity' | 'stats' | 'audit' | 'python' | 'docs' | 'settings' | 'admin'>('chart');
  const [currentUser, setCurrentUser] = useState<UserProfile>(() => AuthService.getCurrentUser());
  const [showRenewModal, setShowRenewModal] = useState<boolean>(false);
  const [showPdfModal, setShowPdfModal] = useState<boolean>(false);
  const [config, setConfig] = useState<AutomationConfig>(() => EaConfigService.loadSavedConfig());
  const [isSimulating, setIsSimulating] = useState<boolean>(true);
  const [simulationSpeed, setSimulationSpeed] = useState<number>(5);

  const [ticks, setTicks] = useState<Tick[]>([]);
  const [boxes, setBoxes] = useState<RenkoBox[]>([]);
  const [currentBox, setCurrentBox] = useState<Partial<RenkoBox> | null>(null);
  const [currentPrice, setCurrentPrice] = useState<number>(128500);
  const [cvd, setCvd] = useState<number>(0);

  const [orders, setOrders] = useState<TradeOrder[]>(() => {
    const saved = OrderAuditService.loadIntradayOrders();
    // Se já existem ordens salvas e alguma delas é da estratégia de pirâmide, preserva
    if (saved && saved.length > 0 && saved.some((o) => o.role === 'PYRAMID' || o.role === 'MAIN')) {
      return saved;
    }

    const defaultPyramidOrders: TradeOrder[] = [
      {
        id: 'ord-mother-main-buy',
        ticket: 849501,
        role: 'MAIN',
        timestamp: Date.now() - 3600000 * 0.25,
        timeStr: new Date(Date.now() - 3600000 * 0.25).toTimeString().split(' ')[0],
        type: 'BUY',
        entryPrice: 128450,
        contracts: 1,
        remainingContracts: 1,
        stopLoss: 0,
        takeProfit: 0,
        status: 'OPEN',
        source: 'ROBOT_EA',
        magicNumber: 101010,
        triggerReason: 'Virada de Fluxo Heikin-Ashi (Verde) · Ordem Mãe de Surfe',
        auditTrail: [
          {
            id: 'evt-mother-1',
            timestamp: Date.now() - 3600000 * 0.25,
            timeStr: new Date(Date.now() - 3600000 * 0.25).toTimeString().split(' ')[0],
            action: 'ORDER_DISPATCHED',
            title: 'Ordem Mãe de Surfe Executada',
            details: 'Entrada na virada de fluxo a 128.450 pts (1 contrato). Sem TP fixo (surfe contínuo até reversão) e sem SL em pontos (zeragem na virada do fluxo).',
            price: 128450,
            contracts: 1,
            delta: 420,
          },
        ],
      },
      {
        id: 'ord-pyramid-1-buy',
        ticket: 849502,
        role: 'PYRAMID',
        pyramidLevel: 1,
        timestamp: Date.now() - 3600000 * 0.15,
        timeStr: new Date(Date.now() - 3600000 * 0.15).toTimeString().split(' ')[0],
        type: 'BUY',
        entryPrice: 128500,
        contracts: 1,
        remainingContracts: 1,
        stopLoss: 0,
        takeProfit: 128550, // +50 pts alvo
        status: 'OPEN',
        source: 'ROBOT_EA',
        magicNumber: 101010,
        triggerReason: 'Fechamento Box 10R Verde · Pirâmide #1 (Alvo +50p)',
        auditTrail: [
          {
            id: 'evt-pyr-1',
            timestamp: Date.now() - 3600000 * 0.15,
            timeStr: new Date(Date.now() - 3600000 * 0.15).toTimeString().split(' ')[0],
            action: 'ORDER_DISPATCHED',
            title: 'Pirâmide #1 Disparada no Box Verde',
            details: 'Entrada em 128.500 pts com alvo de +50 pontos (TP: 128.550 pts). Stop pela virada do fluxo.',
            price: 128500,
            contracts: 1,
            delta: 310,
          },
        ],
      },
      {
        id: 'ord-pyramid-2-buy',
        ticket: 849503,
        role: 'PYRAMID',
        pyramidLevel: 2,
        timestamp: Date.now() - 3600000 * 0.05,
        timeStr: new Date(Date.now() - 3600000 * 0.05).toTimeString().split(' ')[0],
        type: 'BUY',
        entryPrice: 128550,
        contracts: 1,
        remainingContracts: 1,
        stopLoss: 0,
        takeProfit: 128600, // +50 pts alvo
        status: 'OPEN',
        source: 'ROBOT_EA',
        magicNumber: 101010,
        triggerReason: 'Fechamento Box 10R Verde · Pirâmide #2 (Alvo +50p)',
        auditTrail: [
          {
            id: 'evt-pyr-2',
            timestamp: Date.now() - 3600000 * 0.05,
            timeStr: new Date(Date.now() - 3600000 * 0.05).toTimeString().split(' ')[0],
            action: 'ORDER_DISPATCHED',
            title: 'Pirâmide #2 Disparada no Box Verde',
            details: 'Entrada em 128.550 pts com alvo de +50 pontos (TP: 128.600 pts). Stop pela virada do fluxo.',
            price: 128550,
            contracts: 1,
            delta: 290,
          },
        ],
      },
      {
        id: 'ord-pyr-closed-prev',
        ticket: 849490,
        role: 'PYRAMID',
        pyramidLevel: 1,
        timestamp: Date.now() - 3600000 * 0.5,
        timeStr: new Date(Date.now() - 3600000 * 0.5).toTimeString().split(' ')[0],
        type: 'BUY',
        entryPrice: 128400,
        exitPrice: 128450,
        exitTimestamp: Date.now() - 3600000 * 0.45,
        exitTimeStr: new Date(Date.now() - 3600000 * 0.45).toTimeString().split(' ')[0],
        exitReason: 'TAKE_PROFIT',
        source: 'ROBOT_EA',
        magicNumber: 101010,
        contracts: 1,
        stopLoss: 0,
        takeProfit: 128450,
        status: 'CLOSED_PROFIT',
        pointsResult: 50,
        financialResult: 10.0,
        triggerReason: 'Fechamento Box 10R Verde · Pirâmide Anterior (+50p Alvo Concluído)',
        auditTrail: [
          {
            id: 'evt-pyr-prev-1',
            timestamp: Date.now() - 3600000 * 0.5,
            timeStr: new Date(Date.now() - 3600000 * 0.5).toTimeString().split(' ')[0],
            action: 'ORDER_DISPATCHED',
            title: 'Pirâmide Disparada no Box Verde',
            details: 'Entrada em 128.400 pts com alvo de +50 pontos.',
            price: 128400,
            contracts: 1,
          },
          {
            id: 'evt-pyr-prev-2',
            timestamp: Date.now() - 3600000 * 0.45,
            timeStr: new Date(Date.now() - 3600000 * 0.45).toTimeString().split(' ')[0],
            action: 'TAKE_PROFIT_HIT',
            title: 'Alvo de 50 Pontos da Pirâmide Atingido!',
            details: 'Take Profit de +50 pontos liquidado com sucesso (+R$ 10,00).',
            price: 128450,
            contracts: 1,
          },
        ],
      },
    ];

    const historicClosed: TradeOrder[] = [
      {
        id: 'init-ord-1',
        ticket: 849102,
        timestamp: Date.now() - 3600000 * 3.5,
        timeStr: '09:18:24',
        type: 'BUY',
        entryPrice: 128200,
        exitPrice: 128350,
        exitTimestamp: Date.now() - 3600000 * 3.42,
        exitTimeStr: '09:23:10',
        exitReason: 'TAKE_PROFIT',
        source: 'ROBOT_EA',
        magicNumber: 101010,
        contracts: 2,
        stopLoss: 128100,
        takeProfit: 128350,
        status: 'CLOSED_PROFIT',
        pointsResult: 150,
        financialResult: 60.0,
        triggerReason: 'Convergência Alta 10R (Delta +380 contratos)',
        auditTrail: [
          {
            id: 'evt-init-1-1',
            timestamp: Date.now() - 3600000 * 3.5,
            timeStr: '09:18:24',
            action: 'ORDER_DISPATCHED',
            title: 'Ordem Disparada pelo Robô 10R',
            details: 'Convergência Alta confirmada. Delta +380 contratos no fechamento do box 10R.',
            price: 128200,
            contracts: 2,
          },
          {
            id: 'evt-init-1-2',
            timestamp: Date.now() - 3600000 * 3.42,
            timeStr: '09:23:10',
            action: 'TAKE_PROFIT_HIT',
            title: 'Take Profit Atingido (+150 pts)',
            details: 'Alvo final liquidado a 128.350 pts com lucro de R$ 60,00.',
            price: 128350,
            contracts: 2,
          },
        ],
      },
      {
        id: 'init-ord-2',
        ticket: 849156,
        timestamp: Date.now() - 3600000 * 2.9,
        timeStr: '09:34:10',
        type: 'BUY',
        entryPrice: 128350,
        exitPrice: 128400,
        exitTimestamp: Date.now() - 3600000 * 2.82,
        exitTimeStr: '09:39:05',
        exitReason: 'TAKE_PROFIT',
        source: 'ROBOT_EA',
        magicNumber: 101010,
        contracts: 2,
        remainingContracts: 1,
        partialExecuted: true,
        partialPrice: 128400,
        partialPoints: 50,
        partialFinancial: 20.0,
        partialTimestamp: Date.now() - 3600000 * 2.86,
        isBreakevenActive: true,
        stopLoss: 128355,
        takeProfit: 128500,
        status: 'CLOSED_PROFIT',
        pointsResult: 50,
        financialResult: 20.0,
        triggerReason: 'Convergência Alta 10R [Parcial Batida]',
        auditTrail: [
          {
            id: 'evt-init-2-1',
            timestamp: Date.now() - 3600000 * 2.9,
            timeStr: '09:34:10',
            action: 'ORDER_DISPATCHED',
            title: 'Ordem Disparada pelo Robô 10R',
            details: 'Compra enviada a mercado a 128.350 pts com 2 contratos.',
            price: 128350,
            contracts: 2,
          },
          {
            id: 'evt-init-2-2',
            timestamp: Date.now() - 3600000 * 2.86,
            timeStr: '09:36:30',
            action: 'PARTIAL_FILLED',
            title: 'Saída Parcial Concluída (+50 pts)',
            details: '1 contrato liquidado no 1º box a favor (+R$ 20,00).',
            price: 128400,
            contracts: 1,
          },
          {
            id: 'evt-init-2-3',
            timestamp: Date.now() - 3600000 * 2.85,
            timeStr: '09:36:31',
            action: 'BREAKEVEN_MOVED',
            title: 'Stop Loss Protegido no Breakeven',
            details: 'SL reposicionado em 128.355 pts (+5 pts offset de taxas da B3).',
            price: 128355,
          },
        ],
      },
    ];

    const closedSaved = saved && saved.length > 0 ? saved.filter((o) => o.status !== 'OPEN' && o.status !== 'PENDING_LIMIT') : historicClosed;
    return [...defaultPyramidOrders, ...closedSaved];
  });
  const [latestToast, setLatestToast] = useState<{
    id: string;
    type: 'BUY' | 'SELL';
    title: string;
    description: string;
    timestamp: number;
  } | null>(null);

  // Estado da Conexão MT5 Live Bridge
  const [mt5State, setMt5State] = useState<MT5ConnectionState>({
    status: 'DISCONNECTED',
  });
  const wsRef = useRef<WebSocket | null>(null);

  // Instâncias dos motores de cálculo
  const engineRef = useRef<RenkoFlowEngine>(new RenkoFlowEngine(50));
  const simulatorRef = useRef<B3MarketSimulator>(new B3MarketSimulator(128500));

  // Inicializa dados históricos iniciais para que o terminal comece populado
  useEffect(() => {
    const engine = engineRef.current;
    const sim = simulatorRef.current;
    engine.initialize(128500);

    const initialTicks: Tick[] = [];
    // Simula 350 ticks para gerar os primeiros ~20 boxes
    for (let i = 0; i < 350; i++) {
      const t = sim.generateNextTick();
      initialTicks.unshift(t);
      engine.processTick(t, config);
    }

    setTicks(initialTicks.slice(0, 100));
    setBoxes([...engine.getBoxes()]);
    setCurrentBox(engine.getCurrentBox());
    setCurrentPrice(sim.getPrice());
    setCvd(engine.getCvd());
  }, []);

  // Atualiza tamanho do box quando a config mudar
  useEffect(() => {
    engineRef.current.setBoxPoints(config.boxPoints);
  }, [config.boxPoints]);

  // Função para processar a execução de um tick
  const handleIncomingTick = useCallback(
    (tick: Tick) => {
      const engine = engineRef.current;
      setCurrentPrice(tick.price);

      // Adiciona na fita de Times & Trades
      setTicks((prev) => [tick, ...prev.slice(0, 99)]);

      // Processa no motor de Renko 10R e Fluxo
      const result = engine.processTick(tick, config);
      setCvd(engine.getCvd());
      setCurrentBox(engine.getCurrentBox());

      // Se um novo box 10R fechou
      if (result.newBoxClosed && result.closedBox) {
        setBoxes([...engine.getBoxes()]);

          // Se gerou sinal de convergência e o robô está ativo
          if (result.signal && config.active && result.closedBox) {
            // Checa trava de quantidade máxima de trades no dia
            if (config.maxDailyTrades && orders.length >= config.maxDailyTrades) {
              return;
            }

            // Checa janela de horários configurada pelo operador
            if (config.tradingHoursEnabled) {
              const nowHM = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
              if (nowHM < config.tradingStartTime || nowHM >= config.tradingStopEntriesTime) {
                return;
              }
            }

            const signalType = result.signal;
            // =========================================================================
            // ESTRATÉGIA 1: PIRÂMIDE COM CONFLUÊNCIA DE FLUXO & RENKO 10R
            // (Compre no fechamento de cada bloco verde com TP de 50p, mantendo a principal
            // aberta até a virada de fluxo. Zeragem total por inversão sem SL fixo).
            // =========================================================================
            if (config.strategyMode === 'PYRAMID_FLOW_CONFLUENCE') {
              const signalType = result.signal; // 'BUY' (bloco verde) ou 'SELL' (bloco vermelho)
              const oppositeType = signalType === 'BUY' ? 'SELL' : 'BUY';

              setOrders((prev) => {
                let updatedPrev = [...prev];

                // 1. SAÍDA COMPULSÓRIA POR INVERSÃO DE MERCADO:
                // Se o fluxo virou de VENDA para COMPRA (ou vice-versa),
                // encerra a entrada principal oposta e qualquer ordem da pirâmide oposta ainda aberta.
                const hasOppositeOpen = updatedPrev.some(
                  (o) => (o.status === 'OPEN' || o.status === 'PENDING_LIMIT') && o.type === oppositeType
                );

                if (hasOppositeOpen) {
                  let totalClosedPnL = 0;
                  updatedPrev = updatedPrev.map((o) => {
                    if ((o.status === 'OPEN' || o.status === 'PENDING_LIMIT') && o.type === oppositeType) {
                      const pts = o.type === 'BUY' ? tick.price - o.entryPrice : o.entryPrice - tick.price;
                      const activeCtros = o.remainingContracts || o.contracts;
                      const fin = pts * 0.2 * activeCtros + (o.partialFinancial || 0);
                      totalClosedPnL += fin;

                      const flipEvt = OrderAuditService.createEvent(
                        'FLIP_REVERSAL_CLOSED',
                        `Zeragem por Inversão de Mercado (${oppositeType} ➔ ${signalType})`,
                        `Virada do fluxo para ${signalType === 'BUY' ? 'ALTA (Bloco Verde)' : 'BAIXA (Bloco Vermelho)'}. Posição ${
                          o.role === 'MAIN' ? 'Principal (Surfe)' : `Pirâmide #${o.pyramidLevel || 1}`
                        } liquidada a mercado a ${tick.price} pts. Resultado: ${pts >= 0 ? '+' : ''}${pts} pts (R$ ${fin.toFixed(2)}).`,
                        tick.price,
                        activeCtros
                      );

                      return {
                        ...o,
                        status: 'CLOSED_MANUAL' as const,
                        exitPrice: tick.price,
                        exitTimestamp: Date.now(),
                        exitTimeStr: new Date().toTimeString().split(' ')[0],
                        exitReason: 'FLIP_REVERSAL' as const,
                        pointsResult: pts,
                        financialResult: fin,
                        auditTrail: o.auditTrail ? [...o.auditTrail, flipEvt] : [flipEvt],
                      };
                    }
                    return o;
                  });

                  setLatestToast({
                    id: `flip-toast-${Date.now()}`,
                    type: signalType,
                    title: `🔄 INVERSÃO DE MERCADO: POSIÇÕES ANTERIORES ZERADAS!`,
                    description: `Virada do fluxo para ${signalType === 'BUY' ? 'ALTA' : 'BAIXA'}. Entrada mãe e ordens da pirâmide encerradas (R$ ${totalClosedPnL.toFixed(2)}).`,
                    timestamp: Date.now(),
                  });

                  if (mt5State.status === 'CONNECTED' && wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
                    wsRef.current.send(JSON.stringify({ action: 'CLOSE_POSITIONS' }));
                  }
                }

                // 2. DISPARO NA DIREÇÃO ATUAL:
                // Se não há ordem MAIN aberta nesta direção: cria a Entrada Principal (Surfe sem TP/SL fixo)
                // Se já há ordem MAIN aberta nesta direção: cria uma nova Ordem da Pirâmide com TP de 50 pts!
                const openSameSide = updatedPrev.filter(
                  (o) => o.status === 'OPEN' && o.type === signalType
                );
                const hasMainOrder = openSameSide.some((o) => o.role === 'MAIN');

                let newOrder: TradeOrder;

                if (!hasMainOrder) {
                  const mainEvt = OrderAuditService.createEvent(
                    'ORDER_DISPATCHED',
                    `Ordem Principal ${signalType === 'BUY' ? 'COMPRA' : 'VENDA'} (Surfe de Tendência)`,
                    `Entrada Matriz no fechamento do 1º bloco ${signalType === 'BUY' ? 'verde' : 'vermelho'} a ${tick.price} pts (${config.contracts} ctro(s)). Mantida aberta até a virada do fluxo!`,
                    tick.price,
                    config.contracts,
                    result.closedBox!.delta
                  );

                  newOrder = {
                    id: `ord-main-${Date.now()}`,
                    ticket: Math.floor(100000 + Math.random() * 900000),
                    timestamp: Date.now(),
                    timeStr: new Date().toTimeString().split(' ')[0],
                    type: signalType,
                    role: 'MAIN',
                    entryPrice: tick.price,
                    contracts: config.contracts,
                    stopLoss: 0,
                    takeProfit: 0,
                    status: 'OPEN',
                    source: mt5State.status === 'CONNECTED' ? 'MT5_LIVE' : 'ROBOT_EA',
                    magicNumber: config.magicNumber,
                    triggerReason: `Entrada Principal ${signalType === 'BUY' ? 'Compra' : 'Venda'} 10R (Surfe até Virada do Fluxo)`,
                    isRealMT5: mt5State.status === 'CONNECTED',
                    auditTrail: [mainEvt],
                  };

                  setLatestToast({
                    id: `main-toast-${Date.now()}`,
                    type: signalType,
                    title: `🚀 ENTRADA PRINCIPAL ${signalType === 'BUY' ? 'COMPRA' : 'VENDA'} EXECUTADA!`,
                    description: `Surfe iniciado a ${tick.price.toLocaleString('pt-BR')} pts (${config.contracts} ct). Aberta até a virada do fluxo.`,
                    timestamp: Date.now(),
                  });

                  if (mt5State.status === 'CONNECTED' && wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
                    wsRef.current.send(
                      JSON.stringify({
                        action: 'ORDER_SEND',
                        type: signalType,
                        contracts: config.contracts,
                        comment: `PIRAMIDE_MAIN_${signalType}`,
                      })
                    );
                  }
                } else {
                  // Ordem da Pirâmide (Subadd com TP de 50 pontos)
                  const pyramidOrders = openSameSide.filter((o) => o.role === 'PYRAMID');
                  const pyramidLevel = pyramidOrders.length + 1;
                  const tpPoints = config.pyramidTpPoints || 50;
                  const targetTp = signalType === 'BUY' ? tick.price + tpPoints : tick.price - tpPoints;
                  const pyrContracts = config.pyramidContracts || 1;

                  const pyrEvt = OrderAuditService.createEvent(
                    'ORDER_DISPATCHED',
                    `Ordem da Pirâmide #${pyramidLevel} (${signalType === 'BUY' ? 'COMPRA' : 'VENDA'})`,
                    `Nova compra/venda no fechamento do bloco ${signalType === 'BUY' ? 'verde' : 'vermelho'} a ${tick.price} pts (${pyrContracts} ctro). Alvo TP fixo em +${tpPoints} pts (${targetTp} pts).`,
                    tick.price,
                    pyrContracts,
                    result.closedBox!.delta
                  );

                  newOrder = {
                    id: `ord-pyr-${Date.now()}-${pyramidLevel}`,
                    ticket: Math.floor(100000 + Math.random() * 900000),
                    timestamp: Date.now(),
                    timeStr: new Date().toTimeString().split(' ')[0],
                    type: signalType,
                    role: 'PYRAMID',
                    pyramidLevel,
                    entryPrice: tick.price,
                    contracts: pyrContracts,
                    stopLoss: 0,
                    takeProfit: targetTp,
                    status: 'OPEN',
                    source: mt5State.status === 'CONNECTED' ? 'MT5_LIVE' : 'ROBOT_EA',
                    magicNumber: config.magicNumber,
                    triggerReason: `Pirâmide #${pyramidLevel} ${signalType === 'BUY' ? 'Compra' : 'Venda'} 10R (+${tpPoints}p TP)`,
                    isRealMT5: mt5State.status === 'CONNECTED',
                    auditTrail: [pyrEvt],
                  };

                  setLatestToast({
                    id: `pyr-toast-${Date.now()}`,
                    type: signalType,
                    title: `🔺 PIRÂMIDE #${pyramidLevel} ${signalType === 'BUY' ? 'COMPRA' : 'VENDA'} (+${tpPoints}p TP)!`,
                    description: `Entrada a ${tick.price.toLocaleString('pt-BR')} pts. Alvo TP em ${targetTp.toLocaleString('pt-BR')} pts (+1 box).`,
                    timestamp: Date.now(),
                  });

                  if (mt5State.status === 'CONNECTED' && wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
                    wsRef.current.send(
                      JSON.stringify({
                        action: 'ORDER_SEND',
                        type: signalType,
                        contracts: pyrContracts,
                        tp: tpPoints,
                        comment: `PIRAMIDE_SUB_${pyramidLevel}`,
                      })
                    );
                  }
                }

                return [newOrder, ...updatedPrev];
              });
            } else {
              // =========================================================================
              // ESTRATÉGIA 2: RETESTE / PULLBACK CLÁSSICO INSTITUCIONAL
              // =========================================================================
              const signalType = result.signal;
              const isPullbackMode = config.entryTriggerType === 'PULLBACK_ENTRY';

              // Calcula o preço do reteste/pullback na entrada
              let limitPrice = tick.price;
              if (isPullbackMode) {
                if (config.pullbackTarget === 'BOX_OPEN') {
                  limitPrice = result.closedBox.open; // Retorna 100% até a abertura onde o bloco iniciou
                } else if (config.pullbackTarget === 'BOX_50_PCT') {
                  limitPrice = (result.closedBox.open + result.closedBox.close) / 2; // Retorno de 50%
                } else {
                  limitPrice =
                    signalType === 'BUY'
                      ? result.closedBox.close - config.pullbackCustomPoints
                      : result.closedBox.close + config.pullbackCustomPoints;
                }
              }

              const effectivePrice = isPullbackMode ? limitPrice : tick.price;
              const sl =
                signalType === 'BUY'
                  ? effectivePrice - config.stopLossPoints
                  : effectivePrice + config.stopLossPoints;
              const tp =
                signalType === 'BUY'
                  ? effectivePrice + config.takeProfitPoints
                  : effectivePrice - config.takeProfitPoints;

              setOrders((prev) => {
                const currentOpen = prev.filter((o) => o.status === 'OPEN' || o.status === 'PENDING_LIMIT');

                let updatedPrev = prev;
                if (config.accountMode === 'HEDGE') {
                  if (config.hedgeOppositeAction === 'CLOSE_OPPOSITE') {
                    const oppositeType = signalType === 'BUY' ? 'SELL' : 'BUY';
                    updatedPrev = prev.map((o) => {
                      if (o.status === 'OPEN' && o.type === oppositeType) {
                        const pts = o.type === 'BUY' ? tick.price - o.entryPrice : o.entryPrice - tick.price;
                        return {
                          ...o,
                          status: 'CLOSED_MANUAL' as const,
                          exitPrice: tick.price,
                          pointsResult: pts,
                          financialResult: pts * 0.2 * o.contracts,
                        };
                      }
                      return o;
                    });
                  } else if (config.hedgeOppositeAction === 'IGNORE_NEW') {
                    const oppositeType = signalType === 'BUY' ? 'SELL' : 'BUY';
                    if (currentOpen.some((o) => o.type === oppositeType && o.status === 'OPEN')) {
                      return prev;
                    }
                  }

                  if (currentOpen.filter((o) => o.status === 'OPEN').length >= config.maxSimultaneousPositions) {
                    return updatedPrev;
                  }

                  const initialAuditEvt = OrderAuditService.createEvent(
                    'ORDER_DISPATCHED',
                    isPullbackMode ? 'Ordem Limitada Posicionada no Reteste' : 'Ordem a Mercado Disparada',
                    isPullbackMode
                      ? `Aguardando pullback de reteste na abertura do box em ${limitPrice} pts. Sinal: ${result.signalReason}`
                      : `Execução imediata a mercado em ${effectivePrice} pts. Sinal: ${result.signalReason}`,
                    isPullbackMode ? limitPrice : effectivePrice,
                    config.contracts,
                    result.closedBox!.delta
                  );

                  const newOrder: TradeOrder = {
                    id: `ord-${Date.now()}`,
                    ticket: Math.floor(100000 + Math.random() * 900000),
                    timestamp: Date.now(),
                    timeStr: new Date().toTimeString().split(' ')[0],
                    type: signalType,
                    entryPrice: effectivePrice,
                    limitPrice: isPullbackMode ? limitPrice : undefined,
                    pendingBoxIndex: result.closedBox!.index,
                    contracts: config.contracts,
                    stopLoss: sl,
                    takeProfit: tp,
                    status: isPullbackMode ? 'PENDING_LIMIT' : 'OPEN',
                    triggerReason: isPullbackMode
                      ? `${result.signalReason} [Aguardando Reteste em ${limitPrice.toLocaleString('pt-BR')} pts]`
                      : `${result.signalReason} [MERCADO]`,
                    isRealMT5: mt5State.status === 'CONNECTED',
                    source: mt5State.status === 'CONNECTED' ? 'MT5_LIVE' : 'ROBOT_EA',
                    magicNumber: config.magicNumber,
                    auditTrail: [initialAuditEvt],
                  };

                  return [newOrder, ...updatedPrev];
                } else {
                  if (currentOpen.length > 0) return prev;

                  const initialAuditEvt = OrderAuditService.createEvent(
                    'ORDER_DISPATCHED',
                    isPullbackMode ? 'Ordem Limitada Posicionada no Reteste' : 'Ordem a Mercado Disparada',
                    isPullbackMode
                      ? `Aguardando pullback de reteste na abertura do box em ${limitPrice} pts. Sinal: ${result.signalReason}`
                      : `Execução imediata a mercado em ${effectivePrice} pts. Sinal: ${result.signalReason}`,
                    isPullbackMode ? limitPrice : effectivePrice,
                    config.contracts,
                    result.closedBox!.delta
                  );

                  const newOrder: TradeOrder = {
                    id: `ord-${Date.now()}`,
                    ticket: Math.floor(100000 + Math.random() * 900000),
                    timestamp: Date.now(),
                    timeStr: new Date().toTimeString().split(' ')[0],
                    type: signalType,
                    entryPrice: effectivePrice,
                    limitPrice: isPullbackMode ? limitPrice : undefined,
                    pendingBoxIndex: result.closedBox!.index,
                    contracts: config.contracts,
                    stopLoss: sl,
                    takeProfit: tp,
                    status: isPullbackMode ? 'PENDING_LIMIT' : 'OPEN',
                    triggerReason: isPullbackMode
                      ? `${result.signalReason} [Aguardando Retorno na Entrada]`
                      : `${result.signalReason}`,
                    isRealMT5: mt5State.status === 'CONNECTED',
                    source: mt5State.status === 'CONNECTED' ? 'MT5_LIVE' : 'ROBOT_EA',
                    magicNumber: config.magicNumber,
                    auditTrail: [initialAuditEvt],
                  };

                  return [newOrder, ...prev];
                }
              });

              // Notificação toast modo reteste
              if (isPullbackMode) {
                setLatestToast({
                  id: `ord-toast-${Date.now()}`,
                  type: signalType,
                  title: `ORDEM LIMITADA POSICIONADA NO RETESTE`,
                  description: `Convergência detectada! Aguardando o preço VOLTAR para testar a entrada em ${limitPrice.toLocaleString('pt-BR')} pts.`,
                  timestamp: Date.now(),
                });
              } else {
                setLatestToast({
                  id: `ord-toast-${Date.now()}`,
                  type: signalType,
                  title: `ORDEM ${signalType === 'BUY' ? 'COMPRA' : 'VENDA'} DISPARADA A MERCADO`,
                  description: `${result.signalReason} a ${tick.price.toLocaleString('pt-BR')} pts`,
                  timestamp: Date.now(),
                });
              }

              // Se conectado ao MT5 Live via WebSocket, envia para o MT5
              if (mt5State.status === 'CONNECTED' && wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
                wsRef.current.send(
                  JSON.stringify({
                    action: 'ORDER_SEND',
                    type: signalType,
                    isLimit: isPullbackMode,
                    limitPrice: isPullbackMode ? limitPrice : undefined,
                    contracts: config.contracts,
                    sl: config.stopLossPoints,
                    tp: config.takeProfitPoints,
                    comment: isPullbackMode ? `Reteste ${signalType}` : `10R ${signalType}`,
                  })
                );
              }
            }
          }
        }

      // 1. Monitoramento de ordens pendentes de PULLBACK (aciona quando o preço recua para testar a entrada)
      // 2. Checagem de ordens abertas para Stop Loss ou Take Profit
      setOrders((prevOrders) => {
        let changed = false;
        const currentBoxIdx = boxes.length > 0 ? boxes[boxes.length - 1].index : 0;

        const updated = prevOrders.map((ord) => {
          // SE FOR ORDEM LIMITADA PENDENTE DE PULLBACK
          if (ord.status === 'PENDING_LIMIT' && ord.limitPrice !== undefined) {
            // Se for COMPRA pendente e o preço recuou até o preço limite da entrada (ou abaixo)
            if (ord.type === 'BUY' && tick.price <= ord.limitPrice) {
              changed = true;
              setLatestToast({
                id: `fill-toast-${Date.now()}`,
                type: 'BUY',
                title: `🎯 COMPRA ACIONADA NO RETESTE DA ENTRADA!`,
                description: `O preço voltou e executou a compra a ${ord.limitPrice.toLocaleString('pt-BR')} pts (Abertura do Box)!`,
                timestamp: Date.now(),
              });
              const fillEvt = OrderAuditService.createEvent(
                'ORDER_FILLED',
                'Ordem Executada no Reteste (COMPRA)',
                `Preço recuou para a abertura do box e executou a entrada em ${ord.limitPrice} pts.`,
                ord.limitPrice,
                ord.contracts
              );
              return {
                ...ord,
                status: 'OPEN' as const,
                entryPrice: ord.limitPrice,
                fillTimestamp: Date.now(),
                fillTimeStr: new Date().toTimeString().split(' ')[0],
                triggerReason: `Executado no Reteste da Entrada (${ord.limitPrice} pts)`,
                auditTrail: ord.auditTrail ? [...ord.auditTrail, fillEvt] : [fillEvt],
              };
            }

            // Se for VENDA pendente e o preço subiu até o preço limite da entrada (ou acima)
            if (ord.type === 'SELL' && tick.price >= ord.limitPrice) {
              changed = true;
              setLatestToast({
                id: `fill-toast-${Date.now()}`,
                type: 'SELL',
                title: `🎯 VENDA ACIONADA NO RETESTE DA ENTRADA!`,
                description: `O preço subiu e executou a venda a ${ord.limitPrice.toLocaleString('pt-BR')} pts (Abertura do Box)!`,
                timestamp: Date.now(),
              });
              const fillEvt = OrderAuditService.createEvent(
                'ORDER_FILLED',
                'Ordem Executada no Reteste (VENDA)',
                `Preço subiu para a abertura do box e executou a venda em ${ord.limitPrice} pts.`,
                ord.limitPrice,
                ord.contracts
              );
              return {
                ...ord,
                status: 'OPEN' as const,
                entryPrice: ord.limitPrice,
                fillTimestamp: Date.now(),
                fillTimeStr: new Date().toTimeString().split(' ')[0],
                triggerReason: `Executado no Reteste da Entrada (${ord.limitPrice} pts)`,
                auditTrail: ord.auditTrail ? [...ord.auditTrail, fillEvt] : [fillEvt],
              };
            }

            // Se o preço se afastou sem voltar e ultrapassou a validade
            if (ord.pendingBoxIndex !== undefined && currentBoxIdx - ord.pendingBoxIndex >= config.pullbackMaxBoxesWait) {
              changed = true;
              const expEvt = OrderAuditService.createEvent(
                'ORDER_EXPIRED',
                'Validade da Ordem Expirada',
                `Preço se afastou ${config.pullbackMaxBoxesWait} boxes sem retornar ao patamar de ${ord.limitPrice} pts.`,
                tick.price,
                ord.contracts
              );
              return {
                ...ord,
                status: 'EXPIRED_PULLBACK' as const,
                exitTimestamp: Date.now(),
                exitTimeStr: new Date().toTimeString().split(' ')[0],
                exitReason: 'EXPIRED_PULLBACK' as const,
                triggerReason: 'Expirada: Preço continuou sem retornar para testar a entrada.',
                auditTrail: ord.auditTrail ? [...ord.auditTrail, expEvt] : [expEvt],
              };
            }

            return ord;
          }

          // SE FOR POSIÇÃO ABERTA (VERIFICA PARCIAL, TRAILING STOP, SL E TP)
          if (ord.status === 'OPEN') {
            const isBuy = ord.type === 'BUY';
            const curPrice = tick.price;

            // 1. CHECAGEM DE REALIZAÇÃO PARCIAL
            if (config.enablePartialExit && !ord.partialExecuted && ord.contracts > 1) {
              const reachedPartial = isBuy
                ? curPrice >= ord.entryPrice + config.partialPoints
                : curPrice <= ord.entryPrice - config.partialPoints;

              if (reachedPartial) {
                changed = true;
                const partialCtros = Math.min(config.partialContracts, ord.contracts - 1);
                const pts = config.partialPoints;
                const partialFin = pts * 0.2 * partialCtros;
                const remaining = ord.contracts - partialCtros;

                // Move Stop Loss para Breakeven (+ offset de segurança) se configurado
                const newSL = config.moveStopToBreakevenOnPartial
                  ? isBuy
                    ? ord.entryPrice + config.breakevenOffsetPoints
                    : ord.entryPrice - config.breakevenOffsetPoints
                  : ord.stopLoss;

                setLatestToast({
                  id: `partial-toast-${Date.now()}`,
                  type: ord.type,
                  title: `🎯 SAÍDA PARCIAL EXECUTADA (+${pts} pts)!`,
                  description: `${partialCtros} contrato(s) realizado(s) com lucro de R$ ${partialFin.toFixed(2)}. ${
                    config.moveStopToBreakevenOnPartial ? 'Stop Loss movido para o Breakeven protegido!' : ''
                  }`,
                  timestamp: Date.now(),
                });

                if (mt5State.status === 'CONNECTED' && wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
                  wsRef.current.send(
                    JSON.stringify({
                      action: 'ORDER_PARTIAL_CLOSE',
                      ticket: ord.ticket,
                      partialVolume: partialCtros,
                      newSL: config.moveStopToBreakevenOnPartial ? newSL : undefined,
                    })
                  );
                }

                const partialEvt = OrderAuditService.createEvent(
                  'PARTIAL_FILLED',
                  `Saída Parcial Concluída (+${pts} pts)`,
                  `${partialCtros} contrato(s) realizado(s) com lucro de R$ ${partialFin.toFixed(2)}. Restante: ${remaining} contrato(s).`,
                  isBuy ? ord.entryPrice + config.partialPoints : ord.entryPrice - config.partialPoints,
                  partialCtros
                );

                const newAuditTrail = ord.auditTrail ? [...ord.auditTrail, partialEvt] : [partialEvt];
                if (config.moveStopToBreakevenOnPartial) {
                  newAuditTrail.push(
                    OrderAuditService.createEvent(
                      'BREAKEVEN_MOVED',
                      'Stop Loss Movido para o Breakeven',
                      `SL protegido em ${newSL} pts (+${config.breakevenOffsetPoints} pts offset taxas B3).`,
                      newSL
                    )
                  );
                }

                return {
                  ...ord,
                  partialExecuted: true,
                  partialPrice: isBuy ? ord.entryPrice + config.partialPoints : ord.entryPrice - config.partialPoints,
                  partialPoints: pts,
                  partialFinancial: partialFin,
                  partialTimestamp: Date.now(),
                  remainingContracts: remaining,
                  stopLoss: newSL,
                  isBreakevenActive: config.moveStopToBreakevenOnPartial,
                  auditTrail: newAuditTrail,
                };
              }
            }

            // 2. CHECAGEM DE TRAILING STOP DINÂMICO
            let currentSL = ord.stopLoss;
            let beActive = ord.isBreakevenActive;
            let curHigh = ord.highestPriceSinceEntry || ord.entryPrice;
            let curLow = ord.lowestPriceSinceEntry || ord.entryPrice;

            if (config.trailingStop) {
              if (isBuy) {
                curHigh = Math.max(curHigh, curPrice);
                if (curHigh - ord.entryPrice >= config.trailingActivationPoints) {
                  const trailTarget = curHigh - config.trailingDistancePoints;
                  if (trailTarget > currentSL) {
                    currentSL = trailTarget;
                    beActive = true;
                    changed = true;
                  }
                }
              } else {
                curLow = Math.min(curLow, curPrice);
                if (ord.entryPrice - curLow >= config.trailingActivationPoints) {
                  const trailTarget = curLow + config.trailingDistancePoints;
                  if (trailTarget < currentSL) {
                    currentSL = trailTarget;
                    beActive = true;
                    changed = true;
                  }
                }
              }
            }

            // 3. CHECAGEM DE TAKE PROFIT (apenas se configurado > 0)
            const hitTP = ord.takeProfit > 0 && (isBuy ? curPrice >= ord.takeProfit : curPrice <= ord.takeProfit);
            if (hitTP) {
              changed = true;
              const points = isBuy ? ord.takeProfit - ord.entryPrice : ord.entryPrice - ord.takeProfit;
              const activeCtros = ord.remainingContracts || ord.contracts;
              const fin = points * 0.2 * activeCtros + (ord.partialFinancial || 0);
              const isPyr = ord.role === 'PYRAMID';

              const tpEvt = OrderAuditService.createEvent(
                'TAKE_PROFIT_HIT',
                isPyr
                  ? `TP da Pirâmide #${ord.pyramidLevel || 1} Atingido (+${points} pts)`
                  : `Take Profit Atingido (+${points} pts)`,
                `Alvo alcançado e liquidado a ${ord.takeProfit} pts. Lucro: R$ ${fin.toFixed(2)}. ${
                  isPyr ? 'A entrada principal continua aberta surfando a perna!' : ''
                }`,
                ord.takeProfit,
                activeCtros
              );

              setLatestToast({
                id: `tp-toast-${Date.now()}`,
                type: ord.type,
                title: isPyr ? `🎯 TP PIRÂMIDE (+${points} pts)!` : `🎯 TAKE PROFIT BATIDO (+${points} pts)!`,
                description: `${isPyr ? `Ordem da pirâmide #${ord.pyramidLevel || 1}` : 'Operação'} liquidada com lucro de R$ ${fin.toFixed(2)}. ${
                  isPyr ? 'Ordem mãe segue aberta surfando!' : ''
                }`,
                timestamp: Date.now(),
              });

              return {
                ...ord,
                status: 'CLOSED_PROFIT' as const,
                exitPrice: ord.takeProfit,
                exitTimestamp: Date.now(),
                exitTimeStr: new Date().toTimeString().split(' ')[0],
                exitReason: 'TAKE_PROFIT' as const,
                pointsResult: points,
                financialResult: fin,
                auditTrail: ord.auditTrail ? [...ord.auditTrail, tpEvt] : [tpEvt],
              };
            }

            // 4. CHECAGEM DE STOP LOSS (apenas se configurado > 0)
            const hitSL = currentSL > 0 && (isBuy ? curPrice <= currentSL : curPrice >= currentSL);
            if (hitSL) {
              changed = true;
              const points = isBuy ? currentSL - ord.entryPrice : ord.entryPrice - currentSL;
              const activeCtros = ord.remainingContracts || ord.contracts;
              const fin = points * 0.2 * activeCtros + (ord.partialFinancial || 0);
              const isBE = ord.isBreakevenActive && fin >= 0;

              const slEvt = OrderAuditService.createEvent(
                'STOP_LOSS_HIT',
                isBE ? `Saída Protegida no Breakeven (${points >= 0 ? '+' : ''}${points} pts)` : `Stop Loss Atingido (${points} pts)`,
                `Executada saída de contenção de risco a ${currentSL} pts. Resultado: R$ ${fin.toFixed(2)}.`,
                currentSL,
                activeCtros
              );

              return {
                ...ord,
                status: fin >= 0 ? ('CLOSED_PROFIT' as const) : ('CLOSED_LOSS' as const),
                exitPrice: currentSL,
                exitTimestamp: Date.now(),
                exitTimeStr: new Date().toTimeString().split(' ')[0],
                exitReason: isBE ? ('BREAKEVEN' as const) : ('STOP_LOSS' as const),
                pointsResult: points,
                financialResult: fin,
                stopLoss: currentSL,
                auditTrail: ord.auditTrail ? [...ord.auditTrail, slEvt] : [slEvt],
              };
            }

            // Se o Trailing Stop atualizou o SL ou o preço extremo
            if (
              currentSL !== ord.stopLoss ||
              curHigh !== ord.highestPriceSinceEntry ||
              curLow !== ord.lowestPriceSinceEntry
            ) {
              const trailEvt = currentSL !== ord.stopLoss ? [
                OrderAuditService.createEvent(
                  'TRAILING_STOP_MOVED',
                  'Trailing Stop Atualizado',
                  `SL movido para ${currentSL} pts acompanhando nova máxima/mínima.`,
                  currentSL
                )
              ] : [];

              return {
                ...ord,
                stopLoss: currentSL,
                isBreakevenActive: beActive,
                highestPriceSinceEntry: curHigh,
                lowestPriceSinceEntry: curLow,
                auditTrail: trailEvt.length > 0 && ord.auditTrail ? [...ord.auditTrail, ...trailEvt] : ord.auditTrail,
              };
            }
          }

          return ord;
        });

        return changed ? updated : prevOrders;
      });
    },
    [config, mt5State.status]
  );

  // Conexão WebSocket com o MetaTrader 5 (Local Bridge)
  const toggleMT5Connect = useCallback(() => {
    if (mt5State.status === 'CONNECTED' || mt5State.status === 'CONNECTING') {
      if (wsRef.current) {
        wsRef.current.close();
      }
      setMt5State({ status: 'DISCONNECTED' });
      setIsSimulating(true);
      return;
    }

    setMt5State({ status: 'CONNECTING' });
    const host = config.mt5Host || 'localhost';
    const port = config.mt5Port || 8765;
    const wsUrl = `ws://${host}:${port}`;

    try {
      const socket = new WebSocket(wsUrl);
      wsRef.current = socket;

      socket.onopen = () => {
        setMt5State({
          status: 'CONNECTED',
          brokerCompany: 'MetaTrader 5 Live Bridge',
        });
        setIsSimulating(false); // Pausa simulação quando conectado ao MT5 real
        setLatestToast({
          id: `mt5-conn-${Date.now()}`,
          type: 'BUY',
          title: 'METATRADER 5 CONECTADO COM SUCESSO',
          description: `Ponte ativa em ${wsUrl}. Recebendo ticks reais e pronto para enviar ordens.`,
          timestamp: Date.now(),
        });
      };

      socket.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          if (payload.type === 'ACCOUNT_INFO') {
            setMt5State((prev) => ({
              ...prev,
              accountLogin: payload.data.login,
              brokerCompany: payload.data.broker,
              balance: payload.data.balance,
            }));
          } else if (payload.type === 'TICK') {
            handleIncomingTick(payload.data);
          } else if (payload.type === 'ORDER_RESULT') {
            setLatestToast({
              id: `mt5-ord-${Date.now()}`,
              type: payload.orderType === 'BUY' ? 'BUY' : 'SELL',
              title: payload.status === 'DONE' ? 'ORDEM EXECUTADA NO MT5' : 'ERRO NO ENVIO MT5',
              description:
                payload.status === 'DONE'
                  ? `Ticket #${payload.ticket} executado a mercado no MetaTrader 5!`
                  : 'Falha ao enviar ordem para o MT5. Verifique margem e conexão.',
              timestamp: Date.now(),
            });
          }
        } catch {
          // Erro de parse ignorado
        }
      };

      socket.onerror = () => {
        setMt5State({
          status: 'ERROR',
          lastError: `Não foi possível conectar em ${wsUrl}. Certifique-se de executar 'python bot_mt5_convergencia_10r.py'`,
        });
        setLatestToast({
          id: `mt5-err-${Date.now()}`,
          type: 'SELL',
          title: 'FALHA NA CONEXÃO COM O MT5',
          description: `Execute o script 'python bot_mt5_convergencia_10r.py' no seu PC para habilitar o servidor local em ${wsUrl}.`,
          timestamp: Date.now(),
        });
        setIsSimulating(true);
      };

      socket.onclose = () => {
        setMt5State({ status: 'DISCONNECTED' });
      };
    } catch {
      setMt5State({ status: 'ERROR', lastError: 'Falha ao instanciar WebSocket.' });
      setIsSimulating(true);
    }
  }, [config.mt5Host, config.mt5Port, mt5State.status, handleIncomingTick]);

  // Envio manual de ordem (boleta rápida da tela) com suporte à Pirâmide & Confluência
  const handleManualOrder = (type: 'BUY' | 'SELL') => {
    const entryPrice = currentPrice;
    const ticket = Math.floor(100000 + Math.random() * 900000);

    // Se estiver no modo Pirâmide & Confluência
    if (config.strategyMode === 'PYRAMID_FLOW_CONFLUENCE') {
      const activeSameDir = orders.filter((o) => o.status === 'OPEN' && o.type === type);
      const activeOppDir = orders.filter((o) => o.status === 'OPEN' && o.type !== type);

      // Inversão se houver posições opostas: encerra tudo
      if (activeOppDir.length > 0) {
        handleClosePositions();
      }

      const hasMother = activeSameDir.some((o) => o.role === 'MAIN');
      const role: 'MAIN' | 'PYRAMID' = hasMother ? 'PYRAMID' : 'MAIN';
      const pyrCount = activeSameDir.filter((o) => o.role === 'PYRAMID').length;
      const pyrLevel = pyrCount + 1;
      const contracts = role === 'MAIN' ? config.contracts || 1 : config.pyramidContracts || 1;
      const tp =
        role === 'PYRAMID'
          ? type === 'BUY'
            ? entryPrice + (config.pyramidTpPoints || 50)
            : entryPrice - (config.pyramidTpPoints || 50)
          : 0;
      const sl = 0;

      const orderTitle =
        role === 'MAIN'
          ? `Ordem Mãe de ${type === 'BUY' ? 'COMPRA' : 'VENDA'} (Surfe)`
          : `Pirâmide #${pyrLevel} de ${type === 'BUY' ? 'COMPRA' : 'VENDA'} (+50p Alvo)`;
      const orderDetails =
        role === 'MAIN'
          ? `Ordem mãe aberta em ${entryPrice} pts (${contracts}ct). Sem TP fixo (surfe até reversão) e sem SL fixo (stop na virada do fluxo).`
          : `Pirâmide #${pyrLevel} aberta em ${entryPrice} pts (${contracts}ct) com Alvo Take Profit de +50 pts (${tp} pts).`;

      const manEvt = OrderAuditService.createEvent(
        'ORDER_DISPATCHED',
        orderTitle,
        orderDetails,
        entryPrice,
        contracts
      );

      const newOrder: TradeOrder = {
        id: `manual-${Date.now()}`,
        ticket,
        timestamp: Date.now(),
        timeStr: new Date().toTimeString().split(' ')[0],
        type,
        role,
        pyramidLevel: role === 'PYRAMID' ? pyrLevel : undefined,
        entryPrice,
        contracts,
        stopLoss: sl,
        takeProfit: tp,
        status: 'OPEN',
        source: mt5State.status === 'CONNECTED' ? 'MT5_LIVE' : 'MANUAL',
        magicNumber: config.magicNumber || 101010,
        triggerReason:
          role === 'MAIN'
            ? 'Boleta Rápida · Ordem Mãe de Surfe'
            : `Boleta Rápida · Pirâmide #${pyrLevel} (Alvo +50p)`,
        isRealMT5: mt5State.status === 'CONNECTED',
        auditTrail: [manEvt],
      };

      setOrders((prev) => [newOrder, ...prev]);

      setLatestToast({
        id: newOrder.id,
        type,
        title:
          role === 'MAIN'
            ? `🟢 ORDEM MÃE ${type} EXECUTADA`
            : `🔺 PIRÂMIDE #${pyrLevel} ${type} EXECUTADA`,
        description:
          role === 'MAIN'
            ? `Entrada: ${entryPrice.toLocaleString('pt-BR')} pts · Surfe até reversão`
            : `Entrada: ${entryPrice.toLocaleString('pt-BR')} pts · Alvo TP: ${tp.toLocaleString('pt-BR')} pts (+50p)`,
        timestamp: Date.now(),
      });

      if (mt5State.status === 'CONNECTED' && wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(
          JSON.stringify({
            action: 'ORDER_SEND',
            type,
            contracts,
            sl: 0,
            tp: tp > 0 ? (config.pyramidTpPoints || 50) : 0,
            comment: role === 'MAIN' ? 'MAE_SURFE' : `PIR_${pyrLevel}`,
          })
        );
      }
      return;
    }

    const sl = type === 'BUY' ? entryPrice - config.stopLossPoints : entryPrice + config.stopLossPoints;
    const tp = type === 'BUY' ? entryPrice + config.takeProfitPoints : entryPrice - config.takeProfitPoints;

    const manEvt = OrderAuditService.createEvent(
      'ORDER_DISPATCHED',
      `Ordem Manual de ${type === 'BUY' ? 'COMPRA' : 'VENDA'} Enviada`,
      `Boleta manual rápida disparada a ${entryPrice} pts (${config.contracts} contrato(s)). SL: ${sl} pts | TP: ${tp} pts.`,
      entryPrice,
      config.contracts
    );

    const newOrder: TradeOrder = {
      id: `manual-${Date.now()}`,
      ticket,
      timestamp: Date.now(),
      timeStr: new Date().toTimeString().split(' ')[0],
      type,
      entryPrice,
      contracts: config.contracts,
      stopLoss: sl,
      takeProfit: tp,
      status: 'OPEN',
      source: mt5State.status === 'CONNECTED' ? 'MT5_LIVE' : 'MANUAL',
      magicNumber: 999999,
      triggerReason: `Disparo Manual via Terminal (${config.contracts} ctros)`,
      isRealMT5: mt5State.status === 'CONNECTED',
      auditTrail: [manEvt],
    };

    setOrders((prev) => [newOrder, ...prev]);

    setLatestToast({
      id: newOrder.id,
      type,
      title: `ORDEM ${type === 'BUY' ? 'COMPRA' : 'VENDA'} MANUAL ENVIADA`,
      description: `Entrada: ${entryPrice.toLocaleString('pt-BR')} pts · SL: ${sl} · TP: ${tp}`,
      timestamp: Date.now(),
    });

    // Se conectado ao MT5 Live, envia para execução real
    if (mt5State.status === 'CONNECTED' && wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          action: 'ORDER_SEND',
          type,
          contracts: config.contracts,
          sl: config.stopLossPoints,
          tp: config.takeProfitPoints,
          comment: 'Manual Web Terminal',
        })
      );
    }
  };

  // Executar demonstração ao vivo da estratégia da pirâmide (Ordem Mãe + Pirâmides com alvo +50p)
  const handleExecutePyramidDemo = useCallback(() => {
    const basePrice = Math.round(currentPrice / 50) * 50;
    const motherPrice = basePrice - 50;
    const pyr1Price = basePrice;
    const now = Date.now();

    const demoMother: TradeOrder = {
      id: `ord-mother-${now}`,
      ticket: Math.floor(840000 + Math.random() * 9000),
      role: 'MAIN',
      timestamp: now - 180000,
      timeStr: new Date(now - 180000).toTimeString().split(' ')[0],
      type: 'BUY',
      entryPrice: motherPrice,
      contracts: config.contracts || 1,
      remainingContracts: config.contracts || 1,
      stopLoss: 0,
      takeProfit: 0,
      status: 'OPEN',
      source: 'ROBOT_EA',
      magicNumber: config.magicNumber || 101010,
      triggerReason: 'Virada de Fluxo Heikin-Ashi (Verde) · Ordem Mãe de Surfe',
      auditTrail: [
        OrderAuditService.createEvent(
          'ORDER_DISPATCHED',
          'Ordem Mãe de Surfe Executada',
          `Entrada em ${motherPrice} pts (1 contrato). Sem TP fixo (surfe contínuo até reversão) e sem SL fixo em pontos.`,
          motherPrice,
          config.contracts || 1
        ),
      ],
    };

    const demoPyr1: TradeOrder = {
      id: `ord-pyr-1-${now}`,
      ticket: Math.floor(840000 + Math.random() * 9000),
      role: 'PYRAMID',
      pyramidLevel: 1,
      timestamp: now - 60000,
      timeStr: new Date(now - 60000).toTimeString().split(' ')[0],
      type: 'BUY',
      entryPrice: pyr1Price,
      contracts: config.pyramidContracts || 1,
      remainingContracts: config.pyramidContracts || 1,
      stopLoss: 0,
      takeProfit: pyr1Price + (config.pyramidTpPoints || 50),
      status: 'OPEN',
      source: 'ROBOT_EA',
      magicNumber: config.magicNumber || 101010,
      triggerReason: `Fechamento Box 10R Verde · Pirâmide #1 (Alvo: +${config.pyramidTpPoints || 50}p)`,
      auditTrail: [
        OrderAuditService.createEvent(
          'ORDER_DISPATCHED',
          'Pirâmide #1 Disparada',
          `Entrada em ${pyr1Price} pts com alvo de +50 pontos (TP: ${pyr1Price + 50} pts).`,
          pyr1Price,
          config.pyramidContracts || 1
        ),
      ],
    };

    setOrders((prev) => {
      const closed = prev.filter((o) => o.status !== 'OPEN' && o.status !== 'PENDING_LIMIT');
      const updated = [demoMother, demoPyr1, ...closed];
      OrderAuditService.saveIntradayOrders(updated);
      return updated;
    });

    setIsSimulating(true);

    setLatestToast({
      id: `toast-pyr-${now}`,
      type: 'BUY',
      title: '🎯 ESTRATÉGIA PIRÂMIDE EXECUTANDO!',
      description: `Ordem Mãe @ ${motherPrice} pts (surfe) + Pirâmide #1 @ ${pyr1Price} pts (Alvo TP +50p: ${pyr1Price + 50} pts).`,
      timestamp: now,
    });
  }, [currentPrice, config]);

  // Zerar posições abertas
  const handleClosePositions = () => {
    setOrders((prev) =>
      prev.map((o) => {
        if (o.status !== 'OPEN') return o;
        const activeCtros = o.remainingContracts || o.contracts;
        const pts = o.type === 'BUY' ? currentPrice - o.entryPrice : o.entryPrice - currentPrice;
        const fin = pts * 0.2 * activeCtros + (o.partialFinancial || 0);

        const closeEvt = OrderAuditService.createEvent(
          'MANUAL_CLOSED',
          'Encerramento Manual Compulsório',
          `Posição zerada a mercado a ${currentPrice} pts. Resultado obtido: ${pts > 0 ? '+' : ''}${pts} pts (R$ ${fin.toFixed(2)}).`,
          currentPrice,
          activeCtros
        );

        return {
          ...o,
          status: 'CLOSED_MANUAL' as const,
          exitPrice: currentPrice,
          exitTimestamp: Date.now(),
          exitTimeStr: new Date().toTimeString().split(' ')[0],
          exitReason: 'MANUAL' as const,
          pointsResult: pts,
          financialResult: fin,
          auditTrail: o.auditTrail ? [...o.auditTrail, closeEvt] : [closeEvt],
        };
      })
    );

    if (mt5State.status === 'CONNECTED' && wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ action: 'CLOSE_POSITIONS' }));
    }

    setLatestToast({
      id: `close-${Date.now()}`,
      type: 'SELL',
      title: 'POSIÇÕES ZERADAS',
      description: 'Todas as operações abertas foram encerradas a mercado e registradas na auditoria.',
      timestamp: Date.now(),
    });
  };

  // Persistência contínua do livro de auditoria intraday
  useEffect(() => {
    OrderAuditService.saveIntradayOrders(orders);
  }, [orders]);

  // Zerar e reiniciar auditoria para novo pregão
  const handleResetAudit = () => {
    OrderAuditService.clearIntradayAudit();
    setOrders([]);
    setLatestToast({
      id: `reset-audit-${Date.now()}`,
      type: 'BUY',
      title: 'AUDITORIA ZERADA',
      description: 'Novo pregão iniciado. Livro de ordens limpo para auditoria.',
      timestamp: Date.now(),
    });
  };

  // Loop de simulação em tempo real (quando não conectado ao MT5)
  useEffect(() => {
    if (!isSimulating || mt5State.status === 'CONNECTED') return;

    const intervalMs = Math.max(30, Math.floor(450 / simulationSpeed));
    const timer = setInterval(() => {
      const nextTick = simulatorRef.current.generateNextTick();
      handleIncomingTick(nextTick);
    }, intervalMs);

    return () => clearInterval(timer);
  }, [isSimulating, simulationSpeed, mt5State.status, handleIncomingTick]);

  // Avançar 1 tick manual
  const handleStepTick = () => {
    const nextTick = simulatorRef.current.generateNextTick();
    handleIncomingTick(nextTick);
  };

  // Injetar onda institucional (para testar convergência)
  const handleInjectLargeAggression = (type: 'BUY' | 'SELL') => {
    const now = Date.now();
    const currentP = simulatorRef.current.getPrice();
    const isBuy = type === 'BUY';
    const step = 5;

    for (let i = 0; i < 6; i++) {
      const p = isBuy ? currentP + i * step : currentP - i * step;
      simulatorRef.current.setPrice(p);
      const tick: Tick = {
        id: `inject-${Date.now()}-${i}`,
        timestamp: now + i * 20,
        timeStr: new Date(now + i * 20).toTimeString().split(' ')[0],
        price: p,
        volume: 65 + i * 15,
        aggressor: isBuy ? 'BUY' : 'SELL',
        buyerBroker: isBuy ? 'BTG Pactual (Institucional)' : 'XP Investimentos',
        sellerBroker: isBuy ? 'Bradesco' : 'UBS Brasil (Institucional)',
      };
      handleIncomingTick(tick);
    }
  };

  // Limpar e reiniciar dados
  const handleResetData = () => {
    const engine = engineRef.current;
    const sim = simulatorRef.current;
    sim.setPrice(128500);
    engine.initialize(128500);
    setTicks([]);
    setBoxes([]);
    setCurrentBox(null);
    setCurrentPrice(128500);
    setCvd(0);
    setOrders([]);
    OrderAuditService.clearIntradayAudit();
  };

  // Estatísticas calculadas
  const stats: TerminalStats = React.useMemo(() => {
    const closed = orders.filter((o) => o.status !== 'OPEN');
    const winning = closed.filter((o) => (o.financialResult || 0) > 0);
    const losing = closed.filter((o) => (o.financialResult || 0) < 0);
    const totalWinR = winning.reduce((acc, o) => acc + (o.financialResult || 0), 0);
    const totalLossR = Math.abs(losing.reduce((acc, o) => acc + (o.financialResult || 0), 0));
    const netFin = closed.reduce((acc, o) => acc + (o.financialResult || 0), 0);
    const totalPts = closed.reduce((acc, o) => acc + (o.pointsResult || 0), 0);

    const winRate = closed.length > 0 ? (winning.length / closed.length) * 100 : 0;
    const profitFactor = totalLossR > 0 ? totalWinR / totalLossR : totalWinR > 0 ? 9.99 : 0;
    const convergencesCount = boxes.filter((b) => b.isConvergence || b.convergenceType?.includes('CONVERGENCE')).length;

    return {
      totalTrades: closed.length,
      winningTrades: winning.length,
      losingTrades: losing.length,
      winRate,
      totalPoints: totalPts,
      netFinancial: netFin,
      profitFactor,
      maxDrawdown: 100,
      convergencesDetected: convergencesCount,
    };
  }, [orders, boxes]);

  const openOrders = React.useMemo(() => {
    return orders.filter((o) => o.status === 'OPEN' || o.status === 'PENDING_LIMIT');
  }, [orders]);

  // Auto-dismiss toast
  useEffect(() => {
    if (!latestToast) return;
    const t = setTimeout(() => {
      setLatestToast(null);
    }, 4500);
    return () => clearTimeout(t);
  }, [latestToast]);

  return (
    <div className="flex flex-col h-[100dvh] w-screen bg-[#030712] text-slate-100 overflow-hidden font-sans">
      {/* Top Bar seguindo o contrato de 3 zonas */}
      <Header
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        isSimulating={isSimulating}
        setIsSimulating={setIsSimulating}
        robotActive={config.active}
        setRobotActive={(active) => {
          setConfig((prev) => {
            const updated = { ...prev, active, lastSavedTimestamp: Date.now() };
            EaConfigService.saveConfig(updated);
            return updated;
          });
        }}
        lastPrice={currentPrice}
        openOrdersCount={openOrders.length}
        mt5State={mt5State}
        onToggleMT5Connect={toggleMT5Connect}
        currentUser={currentUser}
        onUserChanged={(u) => setCurrentUser(u)}
        onOpenRenewModal={() => setShowRenewModal(true)}
        eaProfileName={config.profileName}
        onOpenPdfModal={() => setShowPdfModal(true)}
      />

      {/* Tira de Métricas e Status Rápido (scroll horizontal suave no celular sem quebrar) */}
      <div className="flex items-center justify-between px-3 sm:px-6 py-1.5 bg-slate-950 border-b border-slate-900 text-[11px] sm:text-xs shrink-0 font-mono overflow-x-auto no-scrollbar gap-3">
        <div className="flex items-center gap-3 sm:gap-6 shrink-0">
          <div className="flex items-center gap-1.5 sm:gap-2">
            <span className="text-slate-400">Ativo:</span>
            <span className="text-slate-100 font-bold">{config.symbol}</span>
            <span className="text-emerald-400 font-semibold">{currentPrice.toLocaleString('pt-BR')} pts</span>
          </div>
          <div className="flex items-center gap-1.5 sm:gap-2">
            <span className="text-slate-400">Renko:</span>
            <span className="text-slate-200">10R ({config.boxPoints} pts)</span>
          </div>
          <div className="flex items-center gap-1.5 sm:gap-2">
            <span className="text-slate-400">CVD:</span>
            <span className={`font-semibold ${cvd >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
              {cvd > 0 ? '+' : ''}
              {cvd.toLocaleString('pt-BR')}
            </span>
          </div>
          <div className="hidden md:flex items-center gap-2">
            <span className="text-slate-400">Origem:</span>
            <span className={mt5State.status === 'CONNECTED' ? 'text-emerald-400 font-bold' : 'text-sky-400'}>
              {mt5State.status === 'CONNECTED'
                ? `MT5 Real (${mt5State.brokerCompany} #${mt5State.accountLogin || ''})`
                : 'Simulação B3'}
            </span>
          </div>
          <div className="hidden lg:flex items-center gap-1.5 px-2 py-0.5 rounded bg-slate-900 border border-slate-800 text-[11px]">
            <span className="text-slate-400">Modo:</span>
            <span className="text-emerald-400 font-bold">{config.accountMode}</span>
          </div>
        </div>

        <div className="flex items-center gap-2.5 sm:gap-4 shrink-0">
          {openOrders.length > 0 && (
            <div className="flex items-center gap-1.5 text-sky-400 bg-sky-500/10 px-2 py-0.5 rounded border border-sky-500/30 text-[10px] sm:text-xs">
              <span className="w-1.5 h-1.5 rounded-full bg-sky-400 animate-pulse" />
              <span>
                {openOrders.length === 1
                  ? `${openOrders[0].type} ${openOrders[0].contracts}x @ ${openOrders[0].entryPrice}`
                  : `${openOrders.length} Pos`}
              </span>
            </div>
          )}

          <div className="flex items-center gap-1.5 sm:gap-2">
            <span className="text-slate-400 text-[10px] sm:text-xs">PnL:</span>
            <span
              className={`font-bold ${
                stats.netFinancial >= 0 ? 'text-emerald-400' : 'text-rose-400'
              }`}
            >
              R$ {stats.netFinancial.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
            </span>
          </div>
        </div>
      </div>

      {/* Conteúdo Principal com compensação inferior no celular */}
      <main className="flex-1 min-h-0 p-1.5 sm:p-3 pb-16 lg:pb-3 bg-slate-950 overflow-hidden">
        {!AuthService.isSubscriptionActive(currentUser) && currentUser.role !== 'ADMIN' ? (
          <div className="h-full w-full overflow-y-auto">
            <SubscriptionPaywall
              user={currentUser}
              onRenewSuccess={(updatedUser) => {
                setCurrentUser(updatedUser);
                setLatestToast({
                  id: `toast-${Date.now()}`,
                  type: 'BUY',
                  title: 'Acesso Web Liberado!',
                  description: `Sua assinatura foi renovada e o terminal está ativo.`,
                  timestamp: Date.now(),
                });
              }}
              onSwitchUser={() => {
                const admin =
                  AuthService.getAllUsers().find((u) => u.role === 'ADMIN') || AuthService.getAllUsers()[0];
                AuthService.setCurrentUser(admin);
                setCurrentUser(admin);
              }}
            />
          </div>
        ) : (
          <>
            {activeTab === 'chart' && (
              <div className="h-full w-full rounded-lg border border-slate-800 overflow-hidden flex flex-col">
                <RenkoFlowChart
                  boxes={boxes}
                  currentBox={currentBox}
                  currentPrice={currentPrice}
                  openOrders={openOrders}
                  minDeltaThreshold={config.minDeltaThreshold}
                  onManualOrder={handleManualOrder}
                  onClosePositions={handleClosePositions}
                  contracts={config.contracts}
                  stopLossPoints={config.stopLossPoints}
                  takeProfitPoints={config.takeProfitPoints}
                  isRealMT5Connected={mt5State.status === 'CONNECTED'}
                  enablePartialExit={config.enablePartialExit}
                  partialPoints={config.partialPoints}
                  partialContracts={config.partialContracts}
                  trailingStop={config.trailingStop}
                  onExecutePyramidDemo={handleExecutePyramidDemo}
                />
              </div>
            )}

            {activeTab === 'tape' && (
              <div className="h-full w-full">
                <TimesAndTrades ticks={ticks} cvd={cvd} />
              </div>
            )}

            {activeTab === 'equity' && (
              <div className="h-full w-full">
                <EquityCurveView
                  orders={orders}
                  stats={stats}
                  currentPrice={currentPrice}
                />
              </div>
            )}

            {activeTab === 'stats' && (
              <div className="h-full w-full">
                <OrdersAndStats
                  orders={orders}
                  stats={stats}
                  currentPrice={currentPrice}
                  onNavigateToAudit={() => setActiveTab('audit')}
                />
              </div>
            )}

            {activeTab === 'audit' && (
              <div className="h-full w-full">
                <IntradayOrderAudit
                  orders={orders}
                  currentPrice={currentPrice}
                  symbol={config.symbol}
                  onClearAudit={handleResetAudit}
                  onOpenSettings={() => setActiveTab('settings')}
                />
              </div>
            )}

            {activeTab === 'python' && (
              <div className="h-full w-full">
                <PythonScriptView config={config} />
              </div>
            )}

            {activeTab === 'docs' && (
              <div className="h-full w-full">
                <DocumentationView
                  config={config}
                  mt5State={mt5State}
                  onToggleMT5Connect={toggleMT5Connect}
                  onOpenPdfModal={() => setShowPdfModal(true)}
                />
              </div>
            )}

            {activeTab === 'settings' && (
              <div className="h-full w-full">
                <AutomationPanel
                  config={config}
                  setConfig={setConfig}
                  simulationSpeed={simulationSpeed}
                  setSimulationSpeed={setSimulationSpeed}
                  onStepTick={handleStepTick}
                  onInjectLargeAggression={handleInjectLargeAggression}
                  onResetData={handleResetData}
                />
              </div>
            )}

            {activeTab === 'admin' && (
              <div className="h-full w-full">
                <AdminPanel
                  currentUser={currentUser}
                  onUserListUpdated={() => {
                    setCurrentUser(AuthService.getCurrentUser());
                  }}
                  onSelectUserToTest={(targetUser) => {
                    AuthService.setCurrentUser(targetUser);
                    setCurrentUser(targetUser);
                    if (targetUser.role !== 'ADMIN') {
                      setActiveTab('chart');
                    }
                  }}
                />
              </div>
            )}
          </>
        )}
      </main>

      {/* Barra de Navegação Inferior Móvel (Exclusiva para Celulares e Tablets pequenos < 1024px) */}
      <nav className="fixed bottom-0 left-0 right-0 z-40 bg-slate-950/95 backdrop-blur-md border-t border-slate-800 lg:hidden px-1 py-1.5 flex items-center justify-around safe-area-pb shadow-lg">
        <button
          onClick={() => setActiveTab('chart')}
          className={`flex flex-col items-center justify-center py-1 px-2 rounded-lg text-[10px] font-medium transition-all ${
            activeTab === 'chart'
              ? 'text-cyan-400 bg-cyan-950/40 font-semibold'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <TrendingUp className="w-4 h-4 mb-0.5" />
          <span>Gráfico</span>
        </button>

        <button
          onClick={() => setActiveTab('tape')}
          className={`flex flex-col items-center justify-center py-1 px-2 rounded-lg text-[10px] font-medium transition-all ${
            activeTab === 'tape'
              ? 'text-cyan-400 bg-cyan-950/40 font-semibold'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Activity className="w-4 h-4 mb-0.5" />
          <span>Fluxo</span>
        </button>

        <button
          onClick={() => setActiveTab('equity')}
          className={`flex flex-col items-center justify-center py-1 px-2 rounded-lg text-[10px] font-medium transition-all ${
            activeTab === 'equity'
              ? 'text-cyan-400 bg-cyan-950/40 font-semibold'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <LineChart className="w-4 h-4 mb-0.5" />
          <span>Curva</span>
        </button>

        <button
          onClick={() => setActiveTab('stats')}
          className={`relative flex flex-col items-center justify-center py-1 px-2 rounded-lg text-[10px] font-medium transition-all ${
            activeTab === 'stats'
              ? 'text-cyan-400 bg-cyan-950/40 font-semibold'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          {openOrders.length > 0 && (
            <span className="absolute top-1 right-2 w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
          )}
          <Layers className="w-4 h-4 mb-0.5" />
          <span>Ordens</span>
        </button>

        <button
          onClick={() => setActiveTab('audit')}
          className={`relative flex flex-col items-center justify-center py-1 px-2 rounded-lg text-[10px] font-medium transition-all ${
            activeTab === 'audit'
              ? 'text-cyan-400 bg-cyan-950/40 font-semibold'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <ShieldCheck className="w-4 h-4 mb-0.5" />
          <span>Auditoria</span>
        </button>

        <button
          onClick={() => setActiveTab('settings')}
          className={`flex flex-col items-center justify-center py-1 px-2 rounded-lg text-[10px] font-medium transition-all ${
            activeTab === 'settings'
              ? 'text-cyan-400 bg-cyan-950/40 font-semibold'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Sliders className="w-4 h-4 mb-0.5" />
          <span>Ajustes</span>
        </button>

        {currentUser.role === 'ADMIN' ? (
          <button
            onClick={() => setActiveTab('admin')}
            className={`flex flex-col items-center justify-center py-1 px-3 rounded-lg text-[10px] font-medium transition-all ${
              activeTab === 'admin'
                ? 'text-amber-400 bg-amber-950/40 font-semibold'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <ShieldCheck className="w-4 h-4 mb-0.5" />
            <span>Admin</span>
          </button>
        ) : (
          <button
            onClick={() => setActiveTab('python')}
            className={`flex flex-col items-center justify-center py-1 px-3 rounded-lg text-[10px] font-medium transition-all ${
              activeTab === 'python'
                ? 'text-cyan-400 bg-cyan-950/40 font-semibold'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Terminal className="w-4 h-4 mb-0.5" />
            <span>MT5 Bot</span>
          </button>
        )}
      </nav>

      {/* Modal de Renovação Manual / Planos (quando clicado pelo usuário no header) */}
      {showRenewModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
          <div className="relative w-full max-w-4xl my-auto">
            <button
              onClick={() => setShowRenewModal(false)}
              className="absolute top-4 right-4 z-50 w-8 h-8 rounded-full bg-slate-800 text-slate-300 hover:text-white flex items-center justify-center font-bold hover:bg-slate-700 transition-colors"
            >
              ✕
            </button>
            <SubscriptionPaywall
              user={currentUser}
              onRenewSuccess={(updatedUser) => {
                setCurrentUser(updatedUser);
                setShowRenewModal(false);
                setLatestToast({
                  id: `toast-${Date.now()}`,
                  type: 'BUY',
                  title: 'Assinatura Atualizada!',
                  description: `Sua assinatura foi renovada com sucesso.`,
                  timestamp: Date.now(),
                });
              }}
              onSwitchUser={() => {
                setShowRenewModal(false);
              }}
            />
          </div>
        </div>
      )}

      {/* Modal Executivo do Dossiê do Projeto & Exportação em PDF */}
      <ProjectDossierPdfModal
        isOpen={showPdfModal}
        onClose={() => setShowPdfModal(false)}
        config={config}
      />

      {/* Toast Flutuante de Disparo de Ordem / Conexão */}
      {latestToast && (
        <div className="fixed bottom-16 sm:bottom-6 right-3 sm:right-6 left-3 sm:left-auto z-50 max-w-sm sm:w-full bg-slate-900 border border-slate-700 rounded-lg p-3.5 shadow-2xl animate-in slide-in-from-bottom duration-300">
          <div className="flex items-start gap-3">
            <div
              className={`p-2 rounded-lg shrink-0 ${
                latestToast.type === 'BUY'
                  ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                  : 'bg-rose-500/20 text-rose-400 border border-rose-500/40'
              }`}
            >
              {latestToast.type === 'BUY' ? (
                <ArrowUpRight className="w-5 h-5" />
              ) : (
                <ArrowDownRight className="w-5 h-5" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-100">{latestToast.title}</span>
                <span className="text-[10px] text-slate-500 font-mono">
                  {mt5State.status === 'CONNECTED' ? 'MT5 Real' : 'Simulador'}
                </span>
              </div>
              <p className="text-xs text-slate-300 mt-0.5 leading-snug">{latestToast.description}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
