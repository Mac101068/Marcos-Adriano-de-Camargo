// =========================================================================
// TIPOS DAS FERRAMENTAS DE DESENHO SOBRE O GRÁFICO
// Desenhos são ancorados em (índice do tijolo, preço) e não em pixels,
// acompanhando zoom, pan e scroll do gráfico automaticamente.
// =========================================================================

export type DrawingTool = 'select' | 'trendline' | 'hline' | 'rect' | 'arrow' | 'text';

export type DrawingKind = Exclude<DrawingTool, 'select'>;

// Cores permitidas: neutra (padrão profissional) + sinais de operação
export type DrawingColor = 'white' | 'green' | 'red';

export const DRAWING_COLOR_HEX: Record<DrawingColor, string> = {
  white: '#e5e5e5',
  green: '#10b981',
  red: '#ef4444',
};

export interface Drawing {
  id: string;
  kind: DrawingKind;
  /** Índice do tijolo Renko (posição em allBoxes) do ponto A */
  barA: number;
  /** Preço do ponto A */
  priceA: number;
  /** Índice do tijolo do ponto B (desprezado em hline/text) */
  barB: number;
  /** Preço do ponto B (desprezado em hline/text) */
  priceB: number;
  /** Conteúdo da anotação de texto (usado apenas em kind === 'text') */
  text?: string;
  color: DrawingColor;
}

export const STORAGE_KEY_DRAWINGS = 'fluxo-renko-drawings';

export const loadDrawings = (): Drawing[] => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_DRAWINGS);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (d) =>
        d &&
        typeof d.id === 'string' &&
        ['trendline', 'hline', 'rect', 'arrow', 'text'].includes(d.kind) &&
        Number.isFinite(d.barA) &&
        Number.isFinite(d.priceA)
    ) as Drawing[];
  } catch (e) {
    return [];
  }
};

export const saveDrawings = (drawings: Drawing[]) => {
  try {
    localStorage.setItem(STORAGE_KEY_DRAWINGS, JSON.stringify(drawings));
  } catch (e) {
    // Ignora erro de storage (ex.: cota cheia)
  }
};
