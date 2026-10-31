import { AutomationConfig } from './trading';

/**
 * Estratégia salva pelo operador no Estúdio de Estratégias.
 * É um snapshot completo e versionado do AutomationConfig — a biblioteca é
 * separada dos "perfis" antigos do painel Ajustes de propósito: nada aqui
 * toca o config ativo sem uma ativação explícita do operador.
 */
export interface SavedStrategy {
  id: string;
  name: string;
  description?: string;
  createdAt: number;
  updatedAt: number;
  config: AutomationConfig;
}
