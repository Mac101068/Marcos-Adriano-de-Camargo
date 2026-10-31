import { AutomationConfig, ConfigPreset } from '../types/trading';
import { ASSETS, DEFAULT_ASSET_ID, resolveAsset, type AssetId } from '../assets/assetRegistry';

const STORAGE_KEY_CONFIG = 'fluxo_renko_ea_config_v3';
const STORAGE_KEY_PROFILES = 'fluxo_renko_ea_profiles_v3';

export const DEFAULT_EA_CONFIG: AutomationConfig = {
  active: true,
  // Ativo do seletor (Fase 2) e o código do contrato andam juntos: o símbolo vem do registro,
  // então trocar de ativo num lugar não deixa o outro apontando para outro mercado.
  assetId: DEFAULT_ASSET_ID,
  symbol: ASSETS[DEFAULT_ASSET_ID].primarySymbol,
  boxPoints: 50, // 10R no Mini-Índice
  contracts: 1, // 1 contrato padrão na Ordem Mãe
  minDeltaThreshold: 100, // Delta mínimo de agressão líquida
  adaptiveThresholdEnabled: true, // Limiar adaptativo ligado por padrão: ±mín × fator de regime do momento
  regimeLookbackBoxes: 20, // Janela do medidor de regime (boxes recentes)
  requireCvdNewExtreme: false,
  confirmationMode: 'BOX_CLOSE',
  stopLossPoints: 0, // Sem Stop Loss fixo (zeragem pela virada do fluxo)
  takeProfitPoints: 0, // Sem TP fixo na mãe (surfe contínuo)
  enablePartialExit: false, // Desabilitado na pirâmide
  partialPoints: 50,
  partialContracts: 1,
  moveStopToBreakevenOnPartial: false,
  breakevenOffsetPoints: 5,
  trailingStop: false,
  trailingActivationPoints: 60,
  trailingDistancePoints: 50,
  maxDailyLoss: 1000,
  maxDailyProfit: 2500,
  maxDailyTrades: 0, // 0 = sem limite para permitir piramidação contínua a cada box
  closeAllOnFinancialLock: false, // Trava batida: por padrão só para de abrir (posições abertas seguem gerenciadas)
  mt5Host: 'localhost',
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
  moveMainToBreakevenOnPyramidTp: false, // Breakeven da ordem mãe ao bater TP de pirâmide (opcional)
  holdMainUntilFlip: true,
  closeAllOnFlowFlip: true,
  noFixedStopLoss: true,
  profileName: '10R Pirâmide & Confluência',
  lastSavedTimestamp: Date.now(),
};

export const BUILT_IN_PRESETS: ConfigPreset[] = [
  {
    id: 'preset-pyramid-flow-10r',
    name: '10R Pirâmide & Confluência (TP 50p + Surfe)',
    badge: 'PIRÂMIDE 50P',
    description: 'Compra no fechamento de cada bloco verde com TP de 50 pts na pirâmide. Mantém a ordem principal aberta até a virada do fluxo e, a cada TP batido, protege a ordem mãe no breakeven. Zeragem total por inversão sem SL fixo.',
    config: {
      ...DEFAULT_EA_CONFIG,
      profileName: '10R Pirâmide & Confluência',
      strategyMode: 'PYRAMID_FLOW_CONFLUENCE',
      entryTriggerType: 'MARKET_ON_CLOSE',
      contracts: 1,
      pyramidContracts: 1,
      pyramidTpPoints: 50,
      moveMainToBreakevenOnPyramidTp: true, // Protege a ordem mãe no breakeven a cada TP de pirâmide batido
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
      minDeltaThreshold: 100,
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
          noFixedStopLoss: parsed.noFixedStopLoss ?? DEFAULT_EA_CONFIG.noFixedStopLoss,
          adaptiveThresholdEnabled: parsed.adaptiveThresholdEnabled ?? DEFAULT_EA_CONFIG.adaptiveThresholdEnabled,
          regimeLookbackBoxes: parsed.regimeLookbackBoxes ?? DEFAULT_EA_CONFIG.regimeLookbackBoxes,
          mt5MaxContractsPerOrder: parsed.mt5MaxContractsPerOrder ?? DEFAULT_EA_CONFIG.mt5MaxContractsPerOrder,
          mt5MaxOrdersPerMinute: parsed.mt5MaxOrdersPerMinute ?? DEFAULT_EA_CONFIG.mt5MaxOrdersPerMinute,
          enablePartialExit: stratMode === 'PYRAMID_FLOW_CONFLUENCE' ? false : (parsed.enablePartialExit ?? true),
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
      lastSavedTimestamp: Date.now(),
    };

    this.saveConfig(validConfig);
    return validConfig;
  }
}
