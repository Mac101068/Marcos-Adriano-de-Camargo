import { useEffect, useMemo, useState } from 'react';
import { LocalPregao, SessionGap } from '../types/trading';
import { AssetSpec, chartSymbolFor } from '../assets/assetRegistry';
import { listarPregoesLocais, mesclarPregoes } from '../services/pregoesCatalogService';

/**
 * Sessão em tela: catálogo de pregões locais do ativo, pregão selecionado e as emendas
 * (gaps) entre sessões, que o gráfico usa para desenhar a linha entre dois pregões.
 *
 * Movido de App.tsx sem mudança de comportamento. O estado de REPLAY (isReplaying,
 * replayDays, replaySeed, replayOperates) fica de fora de propósito: é simulação.
 */
export function useSession(asset: AssetSpec) {
  const [localPregoes, setLocalPregoes] = useState<LocalPregao[]>([]);
  
    /**
     * Catálogo dos recortes por pregão SEM depender da ponte: o navegador lê o
     * arquivo estático `public/pregoes.json` (gerado pelo Python a partir de
     * `data/pregoes/`), que o Vite serve no dev e no build. A ponte, quando está
     * no ar, completa ou corrige a lista pela ação `LIST_LOCAL_PREGOES`.
     */
    useEffect(() => {
      let cancelado = false;
  
      listarPregoesLocais(chartSymbolFor(asset)).then((lista) => {
        if (cancelado) return;
        setLocalPregoes((atual) => mesclarPregoes(atual, lista));
      });
  
      return () => {
        cancelado = true;
      };
    }, [asset]);
  const currentAssetPregoes = useMemo(() => {
    const sym = chartSymbolFor(asset).toUpperCase();
    return localPregoes
      .filter((p) => p.symbol.toUpperCase() === sym || sym.startsWith(p.symbol.toUpperCase().slice(0, 3)))
      .slice(0, 10);
  }, [localPregoes, asset]);
  const [selectedPregaoDate, setSelectedPregaoDate] = useState<string | null>(null);
  const [selectedPregaoValue, setSelectedPregaoValue] = useState<string>('');

  useEffect(() => {
    if (currentAssetPregoes.length > 0 && !selectedPregaoDate) {
      const first = currentAssetPregoes[0];
      setSelectedPregaoDate(first.date);
      setSelectedPregaoValue(`date:${first.date}`);
    }
  }, [currentAssetPregoes, selectedPregaoDate]);
  const getPregaoCompactCode = (val: string): string => {
    if (val.startsWith('date:')) {
      const d = val.replace('date:', '');
      const idx = currentAssetPregoes.findIndex((p) => p.date === d);
      if (idx >= 0) return `Flow${idx + 1}`;
      const parts = d.split('-');
      return `Flow (${parts[2]}/${parts[1]})`;
    }
    return currentAssetPregoes.length > 0 ? 'Flow1' : 'Flow';
  };
  // Emendas de pregão (fechamento de ontem → abertura de hoje) da série Renko em tela.

  // Vão junto com os boxes para o gráfico desenhar a linha do gap entre as sessões.

  const [sessionGaps, setSessionGaps] = useState<SessionGap[]>([]);

  return {
    localPregoes, setLocalPregoes,
    currentAssetPregoes,
    selectedPregaoDate, setSelectedPregaoDate,
    selectedPregaoValue, setSelectedPregaoValue,
    getPregaoCompactCode,
    sessionGaps, setSessionGaps,
  };
}
