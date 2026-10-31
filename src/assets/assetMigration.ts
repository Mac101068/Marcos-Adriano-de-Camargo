import { TradeOrder } from '../types/trading';
import { OrderAuditService, AUDIT_STORAGE_KEY, auditKeyForAsset } from '../services/orderAuditService';
import { AssetSpec, isStaleOrderPrice } from './assetRegistry';

/**
 * MIGRAÇÃO DO PREÇO DE REFERÊNCIA DO ATIVO (flag v1).
 *
 * O WIN tinha 128.500 como preço-base do mercado sintético e como régua do sanitizador de ordens.
 * O ajuste anterior real do WINZ26 hoje está em ~171.500. Com a mudança, qualquer ordem aberta
 * vinda do storage antigo aponta para um preço ~25% abaixo do pregão atual: ela nunca seria
 * fechada por estratégia nenhuma e ficaria poluindo PnL, auditoria e a lista de posições.
 *
 * O que esta migração faz, UMA única vez:
 *  - ordem OPEN com preço fora da tolerância do ativo → ENCERRADA MANUAL no próprio preço de
 *    entrada (0 pts, 0 R$). O histórico do operador continua lá e exportável; só deixa de ser
 *    posição viva. É exatamente o que `loadIntradayOrders` já fazia, só que gravado de uma vez
 *    em vez de re-derivar a cada leitura.
 *  - ordem PENDING_LIMIT fora da tolerância → EXPIRADA. Uma limitada a 128.450 num mercado de
 *    171.500 nunca faria sentido e travaria o estado para sempre.
 *
 * O que esta migração NÃO toca: ordens já fechadas (resultado histórico é fato consumado),
 * configuração, biblioteca de estratégias e qualquer valor escolhido pelo operador.
 *
 * Ao subir outro base no futuro: troque a flag (…_v2) — flag nova força rodar de novo.
 */

const DONE_FLAG = 'fluxo_asset_base_171500_v1';

export interface AssetBaselineMigration {
  /** Ordens que deixaram de ser posição viva por estarem no preço antigo. */
  discarded: number;
  /** De qual ativo o base migrou (aparece no aviso da tela). */
  assetLabel: string;
  /** Preço de referência atual, já formatado com as casas do ativo. */
  baseFormatted: string;
}

/** Reescreve o pregão salvo descartando o que ficou preso no preço antigo do ativo. */
function discardStaleOrders(raw: unknown, asset: AssetSpec): { kept: boolean; discarded: number } {
  if (!Array.isArray(raw)) return { kept: false, discarded: 0 };
  const list = raw as TradeOrder[];
  let discarded = 0;

  const next = list.map((o) => {
    const price = o.status === 'PENDING_LIMIT' ? o.limitPrice ?? o.entryPrice : o.entryPrice;
    if (o.status !== 'OPEN' && o.status !== 'PENDING_LIMIT') return o;
    if (!isStaleOrderPrice(price, asset)) return o;
    discarded += 1;

    const expired = o.status === 'PENDING_LIMIT';
    const evt = OrderAuditService.createEvent(
      expired ? 'ORDER_EXPIRED' : 'MANUAL_CLOSED',
      expired ? 'Limitada expirada na troca de preço de referência' : 'Posição encerrada na troca de preço de referência',
      `O preço de referência do ${asset.label} passou a ${asset.basePrice.toLocaleString('pt-BR')} pts. ` +
        `A ordem estava em ${price.toLocaleString('pt-BR')} pts, fora da tolerância do pregão, e não podia continuar como posição viva.`
    );

    return {
      ...o,
      status: (expired ? 'EXPIRED_PULLBACK' : 'CLOSED_MANUAL') as TradeOrder['status'],
      exitPrice: o.entryPrice,
      exitReason: 'MANUAL' as const,
      auditTrail: o.auditTrail ? [...o.auditTrail, evt] : [evt],
    };
  });

  if (discarded === 0) return { kept: false, discarded: 0 };
  OrderAuditService.saveIntradayOrders(next, asset.id);
  return { kept: true, discarded };
}

export function migrateAssetBaseline(asset: AssetSpec): AssetBaselineMigration {
  const result: AssetBaselineMigration = {
    discarded: 0,
    assetLabel: asset.label,
    baseFormatted: asset.basePrice.toLocaleString('pt-BR'),
  };
  try {
    if (localStorage.getItem(DONE_FLAG)) return result;

    // Desde a Fase 2 cada ativo tem o seu livro; o legado de chave única é todo WIN e a
    // migração de seleção já o copiou. A leitura do chave antiga fica como fallback para o
    // caso de um navegador onde a Fase 1 precisa sanejar antes de a seleção ter rodado.
    const raw =
      localStorage.getItem(auditKeyForAsset(asset.id)) ??
      (asset.id === 'WIN' ? localStorage.getItem(AUDIT_STORAGE_KEY) : null);
    if (raw) {
      const { discarded } = discardStaleOrders(JSON.parse(raw), asset);
      result.discarded = discarded;
    }

    // Só marca como feito depois de ler e reescrever: se estourar acima, tenta de novo na próxima.
    localStorage.setItem(DONE_FLAG, '1');
  } catch {
    // Sem storage (modo privado / JSON corrompido): nada é destruído e o sanitizador da leitura
    // continua cuidando das ordens velhas do mesmo jeito.
  }
  return result;
}
