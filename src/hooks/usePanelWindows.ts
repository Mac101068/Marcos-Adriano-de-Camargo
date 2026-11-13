import { useEffect, useState } from 'react';

/**
 * Estado de navegação e das janelas flutuantes do painel.
 *
 * Movido de App.tsx sem mudança de comportamento: os mesmos nomes, os mesmos
 * defaults, as mesmas chaves de localStorage e os mesmos efeitos de persistência.
 */

export type PanelTab =
  | 'chart'
  | 'tape'
  | 'equity'
  | 'simulador'
  | 'comparativo'
  | 'avaliacao'
  | 'stats'
  | 'audit'
  | 'eas'
  | 'python'
  | 'docs'
  | 'settings'
  | 'studio'
  | 'admin';

/**
 * Token de atalho entre telas: o chip da escala no gráfico pede o BLOCO DO RENKO
 * dos Parâmetros, o AutomationPanel rola até o campo, pisca e devolve o token (null).
 */
export type ParamFocus = 'renkoBox' | null;

export function usePanelWindows() {
  const [activeTab, setActiveTab] = useState<PanelTab>('chart');
  const [paramFocus, setParamFocus] = useState<ParamFocus>(null);

  // Janela flutuante "Dados" (controles do painel Renko) — visível por padrão, persistida
  const [dadosPanelOpen, setDadosPanelOpen] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('fluxo_dados_window_v1');
      if (saved !== null) return saved !== '0';
    } catch {
      // storage indisponível: cai na regra de tela abaixo
    }
    // Sem preferência salva (primeiro acesso, ou aparelho novo): no celular a janela nasce
    // FECHADA porque ela cobre o gráfico inteiro — no desktop continua abrindo sozinha.
    return typeof window === 'undefined' || window.innerWidth >= 640;
  });

  useEffect(() => {
    try {
      localStorage.setItem('fluxo_dados_window_v1', dadosPanelOpen ? '1' : '0');
    } catch {
      // Ignora erro de storage
    }
  }, [dadosPanelOpen]);

  const handleToggleDadosPanel = () => {
    setDadosPanelOpen((v) => {
      // Ao reabrir pelo menu, leva o operador para a aba do gráfico onde a janela vive
      if (!v) setActiveTab('chart');
      return !v;
    });
  };

  // Janela flutuante "Box Renko" (card do box ativo) — fechada por padrão para não poluir o gráfico
  const [boxWindowOpen, setBoxWindowOpen] = useState<boolean>(() => {
    try {
      return localStorage.getItem('fluxo_renko_box_window_v1') === '1';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem('fluxo_renko_box_window_v1', boxWindowOpen ? '1' : '0');
    } catch {
      // Ignora erro de storage
    }
  }, [boxWindowOpen]);

  const handleToggleBoxWindow = () => {
    setBoxWindowOpen((v) => {
      // Ao reabrir pelo menu, leva o operador para a aba do gráfico onde a janela vive
      if (!v) setActiveTab('chart');
      return !v;
    });
  };

  // Janela flutuante do Robô 2 — escondida por padrão (o chip da tira é o atalho), persistida
  const [shadowWindowOpen, setShadowWindowOpen] = useState<boolean>(() => {
    try {
      return localStorage.getItem('fluxo_shadow_window_open_v1') === '1';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem('fluxo_shadow_window_open_v1', shadowWindowOpen ? '1' : '0');
    } catch {
      // Ignora erro de storage
    }
  }, [shadowWindowOpen]);

  const handleToggleShadowWindow = () => {
    setShadowWindowOpen((v) => {
      if (!v) setActiveTab('chart');
      return !v;
    });
  };

  // Menu "Mais" da barra inferior móvel — agrupa as abas secundárias sem rolagem lateral
  const [moreNavOpen, setMoreNavOpen] = useState<boolean>(false);

  return {
    activeTab,
    setActiveTab,
    paramFocus,
    setParamFocus,
    dadosPanelOpen,
    setDadosPanelOpen,
    boxWindowOpen,
    setBoxWindowOpen,
    shadowWindowOpen,
    setShadowWindowOpen,
    moreNavOpen,
    setMoreNavOpen,
    handleToggleDadosPanel,
    handleToggleBoxWindow,
    handleToggleShadowWindow,
  };
}
