import { AutomationConfig, ConfigPreset } from '../types/trading';

const STORAGE_KEY_CONFIG = 'fluxo_renko_ea_config_v3';
const STORAGE_KEY_PROFILES = 'fluxo_renko_ea_profiles_v3';

export const DEFAULT_EA_CONFIG: AutomationConfig = {
  active: true,
  symbol: 'WIN$N',
  boxPoints: 50, // 10R no Mini-Índice
  contracts: 1, // 1 contrato padrão na Ordem Mãe
  minDeltaThreshold: 100, // Delta mínimo de agressão líquida
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
  mt5Host: 'localhost',
  mt5Port: 8765,
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
  tradingHoursEnabled: false,
  tradingStartTime: '09:05',
  tradingStopEntriesTime: '17:00',
  tradingCloseAllTime: '17:45',
  strategyMode: 'PYRAMID_FLOW_CONFLUENCE',
  pyramidTpPoints: 50, // TP de 50 pontos para as ordens da pirâmide
  pyramidContracts: 1, // 1 contrato por pirâmide
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
    description: 'Compra no fechamento de cada bloco verde com TP de 50 pts na pirâmide. Mantém a ordem principal aberta até a virada do fluxo. Zeragem total por inversão sem SL fixo.',
    config: {
      ...DEFAULT_EA_CONFIG,
      profileName: '10R Pirâmide & Confluência',
      strategyMode: 'PYRAMID_FLOW_CONFLUENCE',
      entryTriggerType: 'MARKET_ON_CLOSE',
      contracts: 1,
      pyramidContracts: 1,
      pyramidTpPoints: 50,
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
          strategyMode: stratMode,
          contracts: stratMode === 'PYRAMID_FLOW_CONFLUENCE' ? (parsed.contracts || 1) : (parsed.contracts || 2),
          pyramidTpPoints: parsed.pyramidTpPoints ?? DEFAULT_EA_CONFIG.pyramidTpPoints,
          pyramidContracts: parsed.pyramidContracts ?? DEFAULT_EA_CONFIG.pyramidContracts,
          holdMainUntilFlip: parsed.holdMainUntilFlip ?? DEFAULT_EA_CONFIG.holdMainUntilFlip,
          closeAllOnFlowFlip: parsed.closeAllOnFlowFlip ?? DEFAULT_EA_CONFIG.closeAllOnFlowFlip,
          noFixedStopLoss: parsed.noFixedStopLoss ?? DEFAULT_EA_CONFIG.noFixedStopLoss,
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
      profileName: candidate.profileName || 'Configuração Importada',
      lastSavedTimestamp: Date.now(),
    };

    this.saveConfig(validConfig);
    return validConfig;
  }
}
