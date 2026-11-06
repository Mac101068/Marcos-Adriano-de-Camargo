import { LocalPregao } from '../types/trading';

/**
 * CATÁLOGO ESTÁTICO DOS RECORTES POR PREGÃO
 * ------------------------------------------------------------------
 * O navegador não lê o disco: o recorte por pregão só chega pelo WebSocket da
 * ponte (`LIST_LOCAL_PREGOES`), e a ponte exige o MetaTrader 5 no ar — sem o
 * terminal ela nem sobe, então o seletor ficava vazio.
 *
 * Este serviço lê o catálogo gerado pelo Python (`interface_github/public/
 * pregoes.json`, produzido por `gerar_catalogo_pregoes.py` a partir de
 * `data/pregoes/`). O Vite serve esse arquivo tanto no dev (porta 3000) quanto
 * no build de produção (a pasta `public/` vai para `dist/`).
 *
 * Quando a ponte está no ar, o catálogo dela tem precedência: este arquivo é a
 * base que garante o seletor utilizável com o terminal fechado.
 */

interface CatalogoArquivo {
  generatedAt?: string;
  symbols?: Record<string, LocalPregao[]>;
}

let cache: Promise<Record<string, LocalPregao[]>> | null = null;

async function carregarCatalogo(): Promise<Record<string, LocalPregao[]>> {
  if (!cache) {
    cache = fetch(`${import.meta.env.BASE_URL}pregoes.json`, { cache: 'no-store' })
      .then((resposta) => (resposta.ok ? resposta.json() : null))
      .then((json: CatalogoArquivo | null) => {
        const saida: Record<string, LocalPregao[]> = {};
        for (const [simbolo, pregoes] of Object.entries(json?.symbols ?? {})) {
          saida[simbolo.toUpperCase()] = Array.isArray(pregoes) ? pregoes : [];
        }
        return saida;
      })
      .catch(() => ({}));
  }

  return cache;
}

/** Pregões gravados em disco para um símbolo (ex.: `WINZ26`). */
export async function listarPregoesLocais(symbol: string): Promise<LocalPregao[]> {
  const catalogo = await carregarCatalogo();
  return catalogo[symbol.toUpperCase()] ?? [];
}

/**
 * Junta o catálogo da ponte com o catálogo estático sem duplicar pregão: o
 * caminho do arquivo é a chave, e a ponte (dado mais fresco) tem precedência.
 */
export function mesclarPregoes(atual: LocalPregao[], entrada: LocalPregao[]): LocalPregao[] {
  const porCaminho = new Map<string, LocalPregao>();

  for (const pregao of atual) porCaminho.set(pregao.path, pregao);
  for (const pregao of entrada) porCaminho.set(pregao.path, pregao);

  return [...porCaminho.values()].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}
