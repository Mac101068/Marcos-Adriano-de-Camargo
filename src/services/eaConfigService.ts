import { AutomationConfig, ConfigPreset, ShadowRobotConfig, ShadowScaleR } from '../types/trading';
import { ASSETS, DEFAULT_ASSET_ID, chartSymbolFor, resolveAsset, type AssetId } from '../assets/assetRegistry';

const STORAGE_KEY_CONFIG = 'fluxo_renko_ea_config_v3';
const STORAGE_KEY_PROFILES = 'fluxo_renko_ea_profiles_v3';

/**
 * Default do Robô 2 (sombra): desligado e sem estratégia.
 * Fica exportado porque a UI e o runner precisam da mesma resposta quando o campo
 * não existe na config (config antigas, presets, import de JSON).
 */
export const DEFAULT_SHADOW_ROBOT: ShadowRobotConfig = { enabled: false, strategyId: null, scaleR: 20 };

/** Escalas aceitas pelo Robô 2 (a UI monta o seletor a partir daqui). */
export const SHADOW_SCALE_CHOICES: ShadowScaleR[] = [15, 20, 25];

/**
 * Sanitiza o bloco `shadowRobot` vindo do storage: objeto ausente, incompleto ou com valor
 * impossível (escala fora de 15/20/25) cai no default campo a campo — o mesmo cuidado dos
 * demais campos abaixo, para config antigas não quebrarem a sombra.
 */
export function normalizeShadowRobot(raw?: Partial<ShadowRobotConfig> | null): ShadowRobotConfig {
  const scale = raw?.scaleR as ShadowScaleR | undefined;
  return {
    enabled: raw?.enabled === true,
    strategyId: typeof raw?.strategyId === 'string' && raw.strategyId ? raw.strategyId : null,
    scaleR: scale !== undefined && SHADOW_SCALE_CHOICES.includes(scale) ? scale : DEFAULT_SHADOW_ROBOT.scaleR,
  };
}

export const DEFAULT_EA_CONFIG: AutomationConfig = {
  active: true,
  // Ativo do seletor (Fase 2) e o código do contrato andam juntos: o símbolo vem do registro,
  // então trocar de ativo num lugar não deixa o outro apontando para outro mercado. O código é o
  // VIGENTE (o papel do pregão de hoje na corretora) — a série contínua ficou para os testes.
  assetId: DEFAULT_ASSET_ID,
  symbol: chartSymbolFor(ASSETS[DEFAULT_ASSET_ID]),
  boxPoints: 50, // 10R no Mini-Índice
  contracts: 1, // 1 contrato padrão na Ordem Mãe
  minDeltaThreshold: 300, // Δ físico calibrado para WINZ26: piso de 300 contratos para filtrar ruído de micro-boxes
  adaptiveThresholdEnabled: true, // LIGADO por padrão: o corte é AUTO-CALIBRADO pelo próprio pregão (percentil P70 + piso 1,6× a média do dia; zero valor físico). Base real WINZ26 (11 pregões): PF 3,71→4,17 e R$/trade 15,9→21,4 mantendo os 11 pregões positivos — sobe a qualidade por trade (expectancy), o que tira um EA do empate
  adaptiveThresholdPercentile: 0.7, // Percentil da agressão do próprio dia que vira corte (SEL-A: P70). O piso costuma mandar; no bench o percentil é alavanca fraca
  timeBasedRegimeEnabled: true, // Afinação dinâmica por horário da fita (Abertura P70, Meio-dia P80, Fechamento P80)
  adaptiveFloorMultiple: 1.6, // Piso: mínimo de 1,6× a média das agressões do dia (SEL-A) para dia morto não afrouxar o funil
  flowDivergenceMin: 0.5, // Divergência de fluxo mínima (escala-free): só vale box com |Δ| ≥ 50% do volume do tijolo (SEL-A). Mais seletivo que os 40% do Ciclo 17 — PF e R$/trade maiores mantendo todos os pregões positivos. 0/undefined desliga
  regimeLookbackBoxes: 20, // Janela do medidor de regime (boxes recentes)
  consolidationFilterEnabled: true, // Filtro de consolidação ativado: silencia falsos sinais dentro de lateralizações (ER < 0.35)
  consolidationLookbackBoxes: 10, // Janela da Efficiency Ratio (boxes recentes)
  consolidationErMax: 0.35, // ER abaixo disso = range curto/acumulação (sinal silenciado)
  exhaustionFilterEnabled: true, // Filtro de exaustão ativado: barra entrada no topo de estouro quando a agressão não tem continuidade
  exhaustionDeltaRatio: 0.7, // Agressão abaixo disto x box anterior do mesmo lado = exausto
  flowTrendFilterEnabled: true, // Filtro de tendência do fluxo (cor do painel FLUXO): CVD subindo só compra, caindo só venda. Ligado após replay de 22 pregões (os sinais contra a cor de 20 boxes respondiam pela conta inteira)
  flowTrendLookback: 20, // Boxes que definem a inclinação do CVD (a janela da cor)
  requireCvdNewExtreme: false,
  confirmationMode: 'BOX_CLOSE',
  stopLossPoints: 0, // Sem Stop Loss fixo (zeragem pela virada do fluxo)
  takeProfitPoints: 0, // Sem TP fixo na mãe (surfe contínuo)
  enablePartialExit: false, // Desabilitado na pirâmide
  partialPoints: 50,
  partialContracts: 1,
  moveStopToBreakevenOnPartial: false,
  breakevenOffsetPoints: 5,
  // DESLIGADO POR PADRÃO (decisão do operador, 07/11). Medido na fita real do WINZ26: com
  // 150/100 a Acumulação C/V cai de R$ 52.100 para R$ 9.810 — 949 breakevens travam a perna
  // antes de a virada pagar. Zero aqui = só sai na virada, como a estratégia foi desenhada.
  breakevenTriggerPoints: 0,
  breakevenLockPoints: 0,
  trailingStop: false,
  trailingActivationPoints: 60,
  trailingDistancePoints: 50,
  maxDailyLoss: 1000,
  maxDailyProfit: 2500,
  maxDailyTrades: 0, // 0 = sem limite para permitir piramidação contínua a cada box
  closeAllOnFinancialLock: false, // Trava batida: por padrão só para de abrir (posições abertas seguem gerenciadas)
  // Endereço da ponte: o MT5 roda no PC do Windows, não nesta máquina. `localhost` só serve
  // quando o próprio .py roda aqui — foi o que deixou o app piscando "porta inacessível"
  // apontando para si mesmo. O IP é o do Windows na rede local (ver canal/ do projeto).
  mt5Host: '192.168.18.154',
  mt5Port: 8765,
  // Tetos aceitos pela ponte: defesa contra comando perdido, loop de bug ou app clonado
  mt5MaxContractsPerOrder: 2,
  mt5MaxOrdersPerMinute: 12,
  dataSourceMode: 'SIMULATION',
  accountMode: 'HEDGE',
  maxSimultaneousPositions: 15,
  hedgeOppositeAction: 'CLOSE_OPPOSITE', // Zera imediatamente o lado oposto na virada
  orderFillingMode: 'ORDER_FILLING_RETURN',
  magicNumber: 102030,
  orderComment: 'Pyramid10R_Flow',
  directionLock: 'BOTH',
  onCloseOpposite: false,
  robotRole: 'MAIN',
  entryTriggerType: 'MARKET_ON_CLOSE',
  pullbackTarget: 'BOX_OPEN',
  pullbackCustomPoints: 25,
  pullbackMaxBoxesWait: 2,
  // Trava de horário de trabalho: o EA fica BLOQUEADO de 17:30 até 08:55 (madrugada do dia
  // seguinte) e LIBERADO das 08:55 — assim o leilão de abertura aparece na tela e desde o 1º
  // candle o robô pode operar. Zeragem compulsória às 17:30 (o WIN$N encerra às 17:45).
  // Os dois portões são obedecidos pelo terminal E pela ponte Python.
  // Janelas antigas intocadas (09:05–17:00/17:45 e 09:00–17:30/17:30) são convertidas uma única
  // vez por utils/tradingWindowMigration.ts; valor que você ajustou nunca é mexido.
  tradingHoursEnabled: true,
  tradingStartTime: '08:55',
  tradingStopEntriesTime: '17:30',
  tradingCloseAllTime: '17:30',
  strategyMode: 'PYRAMID_FLOW_CONFLUENCE',
  pyramidTpPoints: 50, // TP de 50 pontos para as ordens da pirâmide
  pyramidSlPoints: 0, // Sem stop fixo na pirâmide por padrão (saída por inversão)
  pyramidContracts: 1, // 1 contrato por pirâmide
  pyramidEntryType: 'MARKET_ON_CLOSE', // Entrada a mercado no fechamento do box (padrão clássico)
  moveMainToBreakevenOnPyramidTp: true, // Mãe protegida no breakeven a cada TP de pirâmide (bench A/B: triplica a mesa cortando a devolução da virada)
  holdMainUntilFlip: true,
  closeAllOnFlowFlip: true,
  flipConfirmBoxes: 1, // 1 = vira no 1º sinal contrário (regra histórica); N>1 exige confirmação (bench do Laboratório)
  noFixedStopLoss: true,
  shadowRobot: { ...DEFAULT_SHADOW_ROBOT },
  profileName: '10R Pirâmide & Confluência',
  // Fase A: preenchido no boot por ensureActiveStrategy; aqui é só o estado "ainda sem vínculo".
  strategyId: null,
  lastSavedTimestamp: Date.now(),
};

export const BUILT_IN_PRESETS: ConfigPreset[] = [
  {
    id: 'preset-janela-fluxo',
    name: 'Janela de Fluxo & Agressão',
    badge: 'JANELA DE FLUXO',
    description:
      'Estratégia direcional desenhada para capturar as janelas de desequilíbrio entre Fluxo e Agressão. ' +
      'Entra a mercado na confirmação da confluência (Delta institucional + Heikin-Ashi) e surfa a pernada ' +
      'com saída cirúrgica na virada de fluxo ou exaustão.',
    config: {
      ...DEFAULT_EA_CONFIG,
      profileName: 'Janela de Fluxo & Agressão',
      strategyMode: 'PYRAMID_FLOW_CONFLUENCE',
      entryTriggerType: 'MARKET_ON_CLOSE',
      contracts: 1,
      pyramidContracts: 1,
      pyramidTpPoints: 60,
      moveMainToBreakevenOnPyramidTp: true,
      holdMainUntilFlip: true,
      closeAllOnFlowFlip: true,
      noFixedStopLoss: false,
      stopLossPoints: 80,
      takeProfitPoints: 200,
      enablePartialExit: true,
      partialPoints: 60,
      partialContracts: 1,
      moveStopToBreakevenOnPartial: true,
      breakevenOffsetPoints: 5,
      trailingStop: true,
      trailingActivationPoints: 80,
      trailingDistancePoints: 40,
      accountMode: 'HEDGE',
      maxSimultaneousPositions: 10,
      hedgeOppositeAction: 'CLOSE_OPPOSITE',
      minDeltaThreshold: 150,
      adaptiveThresholdEnabled: true,
      adaptiveThresholdPercentile: 0.7,
      adaptiveFloorMultiple: 1.6,
      flowDivergenceMin: 0.5,
    },
  },
  {
    id: 'preset-pyramid-flow-10r',
    name: '10R Pirâmide & Confluência (TP 50p + Surfe)',
    badge: 'PIRÂMIDE 50P',
    description: 'Compra no fechamento de cada bloco verde com TP de 50 pts na pirâmide. Mantém a ordem principal aberta surfando até a virada do fluxo, com proteção: a cada TP de pirâmide o stop da mãe vai ao breakeven (a virada não devolve o lucro já colhido). Zeragem por inversão sem SL fixo.',
    config: {
      ...DEFAULT_EA_CONFIG,
      profileName: '10R Pirâmide & Confluência',
      strategyMode: 'PYRAMID_FLOW_CONFLUENCE',
      entryTriggerType: 'MARKET_ON_CLOSE',
      contracts: 1,
      pyramidContracts: 1,
      pyramidTpPoints: 50,
      moveMainToBreakevenOnPyramidTp: true, // Mãe no breakeven a cada TP de pirâmide (proteção padrão contra a devolução da virada)
      holdMainUntilFlip: true,
      closeAllOnFlowFlip: true,
      noFixedStopLoss: true,
      stopLossPoints: 0,
      takeProfitPoints: 0,
      enablePartialExit: false,
      trailingStop: false,
      accountMode: 'HEDGE',
      maxSimultaneousPositions: 15,
      hedgeOppositeAction: 'CLOSE_OPPOSITE',
      minDeltaThreshold: 300, // Δ físico calibrado para WINZ26; evita sinais fracos e ruído
      adaptiveThresholdEnabled: true, // Funil AUTO-CALIBRADO do pregão (SEL-A: P70 + piso 1,6× média do dia) — régua relativa que sobrevive a mudança de volatilidade
      adaptiveThresholdPercentile: 0.7, // SEL-A
      adaptiveFloorMultiple: 1.6, // SEL-A
      flowDivergenceMin: 0.5, // + divergência de fluxo ≥ 50% do volume do tijolo (escala-free) — SEL-A
    },
  },
  {
    id: 'preset-cv-win',
    name: 'C/V Acumulação por Sinal — Mini Índice (WIN)',
    badge: 'C/V ÍNDICE',
    description:
      'Acumulação contínua por sinal no Mini Índice: abre no fluxo comprador/vendedor de cada box fechado, ' +
      'acumula contratos na mesma direção e zera tudo na virada de fluxo. Sem SL/TP fixo na mãe (saída por reversão). ' +
      'Escala clássica 10R (50 pts por box).',
    config: {
      ...DEFAULT_EA_CONFIG,
      profileName: 'C/V Acumulação — WIN',
      strategyMode: 'SIGNAL_STACK',
      assetId: 'WIN',
      symbol: chartSymbolFor(ASSETS.WIN),
      boxPoints: 50,
      contracts: 1,
      stopLossPoints: 0,
      takeProfitPoints: 0,
      enablePartialExit: false,
      trailingStop: false,
      accountMode: 'HEDGE',
      maxSimultaneousPositions: 15,
      hedgeOppositeAction: 'CLOSE_OPPOSITE',
      minDeltaThreshold: 300,
      adaptiveThresholdEnabled: true,
      adaptiveThresholdPercentile: 0.7,
      adaptiveFloorMultiple: 1.6,
      flowDivergenceMin: 0.5,
    },
  },
  {
    id: 'preset-cv-wdo',
    name: 'C/V Acumulação por Sinal — Mini Dólar (WDO)',
    badge: 'C/V DÓLAR',
    description:
      'A mesma leitura de Acumulação por Sinal da C/V do índice, calibrada para o Mini Dólar: ' +
      'abre no C/V impresso a cada box fechado, acumula na mesma direção e zera tudo no sinal oposto. ' +
      'Sem alvo e sem stop por padrão — a saída é a virada. Stop e breakeven por distância ficam ' +
      'disponíveis na boleta (fonte única de verdade) se o operador quiser ligar. Box de 2,5 pts ' +
      '(5 ticks de 0,5), a escala 10R do dólar, com R$ 10 por ponto.',
    config: {
      ...DEFAULT_EA_CONFIG,
      profileName: 'C/V Acumulação — WDO',
      strategyMode: 'SIGNAL_STACK',
      // Ativo: o registro manda. WDOZ26 é o vigente do pregão; o box de 2,5 pts é o 10R do dólar
      // (o WIN usa 50 pts) — sem isso o dia inteiro (~33 pts) levaria 13 boxes para fechar um
      // único tijolo de 50 e o gráfico abriria vazio.
      assetId: 'WDO',
      symbol: chartSymbolFor(ASSETS.WDO),
      boxPoints: 2.5,
      contracts: 1,
      // C/V puro: a saída é a virada. Stop 0 = desligado, alvo 0 = não fecha (decisão do operador).
      stopLossPoints: 0,
      takeProfitPoints: 0,
      enablePartialExit: false,
      trailingStop: false,
      accountMode: 'HEDGE',
      maxSimultaneousPositions: 15,
      hedgeOppositeAction: 'CLOSE_OPPOSITE',
      // Breakeven por distância DESLIGADO (0/0), igual ao DEFAULT_EA_CONFIG e ao que o 5d13cf4
      // decidiu. Medido na base real WDOZ26 (13 pregões, com corretagem): com 5/3 o resultado é
      // −R$ 2.918 (PF 0,74); desligado é +R$ 5.292 (PF 1,46). O breakeven apertado custa 183%
      // no dólar — quem quiser ligar, liga na boleta e assume o número.
      breakevenTriggerPoints: 0,
      breakevenLockPoints: 0,
      breakevenOffsetPoints: 0.5,
      // Funil de fluxo: mesmas alavancas SEL-A do WIN (a régua é relativa ao próprio dia, então
      // sobrevive à troca de mercado); só o Δ físico do aquecimento é menor no dólar.
      minDeltaThreshold: 15,
      adaptiveThresholdEnabled: true,
      adaptiveThresholdPercentile: 0.7,
      adaptiveFloorMultiple: 1.6,
      flowDivergenceMin: 0.5,
    },
  },
  {
    id: 'preset-institucional',
    name: '10R Padrão Institucional (Reteste)',
    badge: 'RETESTE',
    description: 'Entrada no Reteste/Pullback na abertura do box, Parcial +50 pts com Breakeven (+5 pts offset) e Trailing Stop de 50 pts.',
    config: {
      ...DEFAULT_EA_CONFIG,
      profileName: '10R Padrão Institucional',
      strategyMode: 'PULLBACK_RETEST',
      entryTriggerType: 'PULLBACK_ENTRY',
      pullbackTarget: 'BOX_OPEN',
      stopLossPoints: 100,
      takeProfitPoints: 150,
      enablePartialExit: true,
      partialPoints: 50,
      partialContracts: 1,
      moveStopToBreakevenOnPartial: true,
      breakevenOffsetPoints: 5,
      // Reteste: breakeven por distância continua fazendo sentido (tem alvo e parcial próprios)
      breakevenTriggerPoints: 150,
      breakevenLockPoints: 100,
      trailingStop: true,
      trailingActivationPoints: 60,
      trailingDistancePoints: 50,
      minDeltaThreshold: 250,
    },
  },
  {
    id: 'preset-scalper',
    name: '10R Scalper Agressivo',
    badge: 'ALTA VELOCIDADE',
    description: 'Entrada imediata a mercado no fechamento do box, alvo curto de 75 pts, saída parcial em 35 pts e Delta agressivo (150 ctros).',
    config: {
      ...DEFAULT_EA_CONFIG,
      profileName: '10R Scalper Agressivo',
      entryTriggerType: 'MARKET_ON_CLOSE',
      pullbackTarget: 'BOX_OPEN',
      stopLossPoints: 75,
      takeProfitPoints: 75,
      enablePartialExit: true,
      partialPoints: 35,
      partialContracts: 1,
      moveStopToBreakevenOnPartial: true,
      breakevenOffsetPoints: 0,
      breakevenTriggerPoints: 150,
      breakevenLockPoints: 100,
      trailingStop: false,
      trailingActivationPoints: 50,
      trailingDistancePoints: 40,
      minDeltaThreshold: 150,
    },
  },
  {
    id: 'preset-trend',
    name: '10R Trend Follower (Tendência Longa)',
    badge: 'LONGO ALVO',
    description: 'Pullback a 50% do box (25 pts), SL estendido de 150 pts, alvo de 250 pts e Trailing Stop de 75 pts para surfar grandes tendências.',
    config: {
      ...DEFAULT_EA_CONFIG,
      profileName: '10R Trend Follower',
      entryTriggerType: 'PULLBACK_ENTRY',
      pullbackTarget: 'BOX_50_PCT',
      pullbackCustomPoints: 25,
      stopLossPoints: 150,
      takeProfitPoints: 250,
      enablePartialExit: true,
      partialPoints: 75,
      partialContracts: 1,
      moveStopToBreakevenOnPartial: true,
      breakevenOffsetPoints: 10,
      breakevenTriggerPoints: 150,
      breakevenLockPoints: 100,
      trailingStop: true,
      trailingActivationPoints: 100,
      trailingDistancePoints: 75,
      minDeltaThreshold: 300,
      requireCvdNewExtreme: true,
    },
  },
  {
    id: 'preset-hedge',
    name: 'Hedge Multi-Posição B3',
    badge: 'HEDGE DUPLO',
    description: 'Suporte a até 4 posições simultâneas (compra e venda), saídas parciais e stops individuais rastreados por ticket.',
    config: {
      ...DEFAULT_EA_CONFIG,
      profileName: 'Hedge Multi-Posição B3',
      accountMode: 'HEDGE',
      maxSimultaneousPositions: 4,
      hedgeOppositeAction: 'ALLOW_SIMULTANEOUS',
      entryTriggerType: 'PULLBACK_ENTRY',
      pullbackTarget: 'BOX_OPEN',
      stopLossPoints: 100,
      takeProfitPoints: 150,
      enablePartialExit: true,
      partialPoints: 50,
      partialContracts: 1,
      moveStopToBreakevenOnPartial: true,
      trailingStop: true,
      trailingActivationPoints: 60,
      trailingDistancePoints: 50,
    },
  },
];

export class EaConfigService {
  /**
   * Carrega a última configuração registrada no localStorage.
   * Se nenhuma configuração prévia for encontrada, retorna os padrões institucionais.
   */
  public static loadSavedConfig(): AutomationConfig {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_CONFIG);
      if (saved) {
        const parsed = JSON.parse(saved);
        const stratMode = parsed.strategyMode || DEFAULT_EA_CONFIG.strategyMode;
        return {
          ...DEFAULT_EA_CONFIG,
          ...parsed,
          // assetId só vale se for um ativo conhecido; config antigo sem o campo resolve pelo
          // símbolo gravado (e a migração versionada trata do que ficou no storage).
          assetId: (ASSETS[parsed.assetId as AssetId] ? parsed.assetId : resolveAsset(parsed.symbol).id) as AssetId,
          strategyMode: stratMode,
          contracts: stratMode === 'PYRAMID_FLOW_CONFLUENCE' ? (parsed.contracts || 1) : (parsed.contracts || 2),
          pyramidTpPoints: parsed.pyramidTpPoints ?? DEFAULT_EA_CONFIG.pyramidTpPoints,
          pyramidSlPoints: parsed.pyramidSlPoints ?? DEFAULT_EA_CONFIG.pyramidSlPoints,
          pyramidContracts: parsed.pyramidContracts ?? DEFAULT_EA_CONFIG.pyramidContracts,
          pyramidEntryType: parsed.pyramidEntryType ?? DEFAULT_EA_CONFIG.pyramidEntryType,
          moveMainToBreakevenOnPyramidTp: parsed.moveMainToBreakevenOnPyramidTp ?? DEFAULT_EA_CONFIG.moveMainToBreakevenOnPyramidTp,
          holdMainUntilFlip: parsed.holdMainUntilFlip ?? DEFAULT_EA_CONFIG.holdMainUntilFlip,
          closeAllOnFlowFlip: parsed.closeAllOnFlowFlip ?? DEFAULT_EA_CONFIG.closeAllOnFlowFlip,
          flipConfirmBoxes: parsed.flipConfirmBoxes ?? DEFAULT_EA_CONFIG.flipConfirmBoxes,
          noFixedStopLoss: parsed.noFixedStopLoss ?? DEFAULT_EA_CONFIG.noFixedStopLoss,
          adaptiveThresholdEnabled: parsed.adaptiveThresholdEnabled ?? DEFAULT_EA_CONFIG.adaptiveThresholdEnabled,
          regimeLookbackBoxes: parsed.regimeLookbackBoxes ?? DEFAULT_EA_CONFIG.regimeLookbackBoxes,
          consolidationFilterEnabled: parsed.consolidationFilterEnabled ?? DEFAULT_EA_CONFIG.consolidationFilterEnabled,
          consolidationLookbackBoxes: parsed.consolidationLookbackBoxes ?? DEFAULT_EA_CONFIG.consolidationLookbackBoxes,
          consolidationErMax: parsed.consolidationErMax ?? DEFAULT_EA_CONFIG.consolidationErMax,
          exhaustionFilterEnabled: parsed.exhaustionFilterEnabled ?? DEFAULT_EA_CONFIG.exhaustionFilterEnabled,
          exhaustionDeltaRatio: parsed.exhaustionDeltaRatio ?? DEFAULT_EA_CONFIG.exhaustionDeltaRatio,
          flowTrendFilterEnabled: parsed.flowTrendFilterEnabled ?? DEFAULT_EA_CONFIG.flowTrendFilterEnabled,
          flowTrendLookback: parsed.flowTrendLookback ?? DEFAULT_EA_CONFIG.flowTrendLookback,
          mt5MaxContractsPerOrder: parsed.mt5MaxContractsPerOrder ?? DEFAULT_EA_CONFIG.mt5MaxContractsPerOrder,
          mt5MaxOrdersPerMinute: parsed.mt5MaxOrdersPerMinute ?? DEFAULT_EA_CONFIG.mt5MaxOrdersPerMinute,
          // Breakeven por distância: config antigo não tem os campos. Sem o `??`, ficariam
          // `undefined` e o motor compararia contra nada (a mesma armadilha do valor gravado).
          breakevenTriggerPoints: parsed.breakevenTriggerPoints ?? DEFAULT_EA_CONFIG.breakevenTriggerPoints,
          breakevenLockPoints: parsed.breakevenLockPoints ?? DEFAULT_EA_CONFIG.breakevenLockPoints,
          // Endereço da ponte: o valor GRAVADO vence o default (mesma armadilha do `loadSavedConfig`
          // que já mordeu nas alavancas da Pirâmide). Config antigo gravou `localhost` quando o
          // campo não existia na tela; `localhost` nunca é o PC do MT5 nesta arquitetura, então
          // é promovido para o IP da ponte. Qualquer outro host digitado pelo operador é mantido.
          mt5Host:
            !parsed.mt5Host || parsed.mt5Host === 'localhost' || parsed.mt5Host === '127.0.0.1'
              ? DEFAULT_EA_CONFIG.mt5Host
              : parsed.mt5Host,
          enablePartialExit: stratMode === 'PYRAMID_FLOW_CONFLUENCE' ? false : (parsed.enablePartialExit ?? true),
          directionLock: parsed.directionLock ?? DEFAULT_EA_CONFIG.directionLock,
          onCloseOpposite: parsed.onCloseOpposite ?? DEFAULT_EA_CONFIG.onCloseOpposite,
          robotRole: parsed.robotRole ?? DEFAULT_EA_CONFIG.robotRole,
          // Robô 2: sempre reassemble — storage antigo não tem o campo, e um objeto parcial
          // não pode deixar `scaleR` undefined (a sombra derivaria pts de undefined).
          shadowRobot: normalizeShadowRobot(parsed.shadowRobot),
          // Fase A: preserva o vínculo do config ativo com a estratégia. Config antigo sem o campo
          // volta null e é semeado/vinculado por ensureActiveStrategy no boot do App.
          strategyId: typeof parsed.strategyId === 'string' && parsed.strategyId ? parsed.strategyId : null,
          lastSavedTimestamp: parsed.lastSavedTimestamp || Date.now(),
        };
      }
    } catch (e) {
      console.warn('Erro ao carregar configuração salva do EA:', e);
    }
    return { ...DEFAULT_EA_CONFIG };
  }

  /**
   * Registra e persiste a configuração atual do EA no localStorage.
   */
  public static saveConfig(config: AutomationConfig): { success: boolean; timestamp: number } {
    try {
      const timestamp = Date.now();
      const configToSave: AutomationConfig = {
        ...config,
        lastSavedTimestamp: timestamp,
      };
      localStorage.setItem(STORAGE_KEY_CONFIG, JSON.stringify(configToSave));
      return { success: true, timestamp };
    } catch (e) {
      console.error('Falha ao salvar configuração do EA:', e);
      return { success: false, timestamp: Date.now() };
    }
  }

  /**
   * Restaura para os padrões de fábrica institucionais.
   */
  public static resetToDefault(): AutomationConfig {
    const config = { ...DEFAULT_EA_CONFIG, lastSavedTimestamp: Date.now() };
    this.saveConfig(config);
    return config;
  }

  /**
   * Obtém os perfis institucionais pré-definidos.
   */
  public static getBuiltInPresets(): ConfigPreset[] {
    return BUILT_IN_PRESETS;
  }

  /**
   * Obtém os perfis personalizados salvos pelo operador.
   */
  public static getCustomProfiles(): ConfigPreset[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_PROFILES);
      if (raw) {
        return JSON.parse(raw);
      }
    } catch (e) {
      console.warn('Erro ao carregar perfis customizados do operador:', e);
    }
    return [];
  }

  /**
   * Salva a configuração atual como um perfil customizado do operador.
   */
  public static saveCustomProfile(name: string, config: AutomationConfig): ConfigPreset {
    const profiles = this.getCustomProfiles();
    const id = `profile-custom-${Date.now()}`;
    const newProfile: ConfigPreset = {
      id,
      name,
      badge: 'CUSTOM OPERADOR',
      isCustom: true,
      description: `Setup personalizado salvo em ${new Date().toLocaleDateString('pt-BR')} às ${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}.`,
      config: {
        ...config,
        profileName: name,
        lastSavedTimestamp: Date.now(),
      },
    };

    profiles.push(newProfile);
    try {
      localStorage.setItem(STORAGE_KEY_PROFILES, JSON.stringify(profiles));
    } catch (e) {
      console.error('Erro ao salvar perfil customizado:', e);
    }

    return newProfile;
  }

  /**
   * Exclui um perfil customizado do operador.
   */
  public static deleteCustomProfile(id: string): void {
    const profiles = this.getCustomProfiles().filter((p) => p.id !== id);
    try {
      localStorage.setItem(STORAGE_KEY_PROFILES, JSON.stringify(profiles));
    } catch (e) {
      console.error('Erro ao deletar perfil:', e);
    }
  }

  /**
   * Exporta a configuração atual como arquivo JSON.
   */
  public static exportConfigAsJson(config: AutomationConfig): string {
    return JSON.stringify(
      {
        appName: 'Fluxo & Renko 10R - MT5 Quant Terminal',
        exportedAt: new Date().toISOString(),
        config,
      },
      null,
      2
    );
  }

  /**
   * Importa e valida um arquivo JSON com a configuração do EA.
   */
  public static importConfigFromJson(jsonStr: string): AutomationConfig {
    const parsed = JSON.parse(jsonStr);
    const candidate = parsed.config ? parsed.config : parsed;

    // Higienização e validação com os defaults
    const validConfig: AutomationConfig = {
      ...DEFAULT_EA_CONFIG,
      ...candidate,
      // JSON importado de antes da Fase 2 não traz `assetId`: sem esta linha o spread jogaria o
      // WIN por cima e uma estratégia de WDO$N ficaria com R$/ponto e tick de outro mercado.
      assetId: (ASSETS[candidate.assetId as AssetId] ? candidate.assetId : resolveAsset(candidate.symbol).id) as AssetId,
      profileName: candidate.profileName || 'Configuração Importada',
      // Fase A: se o JSON importado trouxer um vínculo válido, ele é mantido; senão o boot re-semeia.
      strategyId: typeof candidate.strategyId === 'string' && candidate.strategyId ? candidate.strategyId : null,
      lastSavedTimestamp: Date.now(),
    };

    this.saveConfig(validConfig);
    return validConfig;
  }

  /**
   * Mensagem que replica na ponte as REGRAS de julgamento do sinal que estão ligadas na
   * tela. Sem isso a ponte opera com constantes compiladas e o robô compra uma coisa enquanto
   * o gráfico desenha outra — é a divergência que fazia a tela parecer certa e o resultado,
   * errado. Só julgamento: nenhum campo daqui dispara ordem.
   */
  public static buildBridgeSyncMessage(config: AutomationConfig): string {
    return JSON.stringify({
      action: 'SYNC_EA_CONFIG',
      symbol: config.symbol,
      strategyMode: config.strategyMode,
      minDeltaThreshold: config.minDeltaThreshold,
      adaptiveThresholdEnabled: config.adaptiveThresholdEnabled,
      adaptiveThresholdPercentile: config.adaptiveThresholdPercentile,
      timeBasedRegimeEnabled: config.timeBasedRegimeEnabled ?? true,
      adaptiveFloorMultiple: config.adaptiveFloorMultiple,
      regimeLookbackBoxes: config.regimeLookbackBoxes,
      flowDivergenceMin: config.flowDivergenceMin,
      consolidationFilterEnabled: config.consolidationFilterEnabled,
      consolidationLookbackBoxes: config.consolidationLookbackBoxes,
      consolidationErMax: config.consolidationErMax,
      exhaustionFilterEnabled: config.exhaustionFilterEnabled,
      exhaustionDeltaRatio: config.exhaustionDeltaRatio,
      flowTrendFilterEnabled: config.flowTrendFilterEnabled === true,
      flowTrendLookback: config.flowTrendLookback ?? 20,
      requireCvdNewExtreme: config.requireCvdNewExtreme,
    });
  }
}
