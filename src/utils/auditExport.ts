/**
 * EXPORTAR AUDITORIA — botão único no app
 * ----------------------------------------------------------------------------
 * Junta num só arquivo JSON o que hoje está espalhado no localStorage:
 *
 *   · ledger de RODADAS do replay  → `fluxo_round_audit_v1`
 *   · livro de ORDENS por ativo    → `fluxo_renko_intraday_audit_v3_<ATIVO>`
 *   · fita REAL capturada          → `fluxo_real_tape_v1`
 *   · configuração vigente         → `fluxo_renko_ea_config_v3`
 *
 * O arquivo é baixado como `auditoria-<data>-<hora>.json`, pronto para entregar a quem
 * for analisar. Nada é enviado para lugar nenhum: o download é local, o operador decide
 * o que faz com ele.
 *
 * ATENÇÃO À CHAVE: o audit de ordens NÃO se chama `fluxo_order_audit_WIN`. A chave real
 * (ver `orderAuditService.ts`) é `fluxo_renko_intraday_audit_v3_WIN`. O exportador lê a
 * chave certa e, se o operador tiver a antiga no navegador, inclui as duas — assim
 * ninguém perde histórico por causa de um nome errado.
 */

const CHAVES_FIXAS = [
  'fluxo_round_audit_v1',
  'fluxo_real_tape_v1',
  'fluxo_renko_ea_config_v3',
  'fluxo_bridge_token_v1',
];

const ATIVOS = ['WIN', 'WDO', 'BTCBR'];

/** Chave legada que o operador citou — pode existir em navegador antigo. */
const CHAVE_LEGADA_ORDENS = 'fluxo_order_audit_';

function lerChave(chave: string): unknown {
  try {
    const bruto = localStorage.getItem(chave);
    if (bruto === null) return null;
    try {
      return JSON.parse(bruto);
    } catch {
      return bruto;
    }
  } catch {
    return null;
  }
}

export interface PacoteAuditoria {
  geradoEm: string;
  origem: string;
  navegador: string;
  chaves: Record<string, unknown>;
  resumo: {
    rodadas: number;
    ordensPorAtivo: Record<string, number>;
    ticksDaFita: number;
  };
}

/** Monta o pacote inteiro em memória. Não escreve nada, não envia nada. */
export function montarPacoteAuditoria(): PacoteAuditoria {
  const chaves: Record<string, unknown> = {};

  for (const chave of CHAVES_FIXAS) {
    chaves[chave] = lerChave(chave);
  }

  for (const ativo of ATIVOS) {
    chaves[`fluxo_renko_intraday_audit_v3_${ativo}`] = lerChave(`fluxo_renko_intraday_audit_v3_${ativo}`);
    // legado, só se existir
    const legado = lerChave(`${CHAVE_LEGADA_ORDENS}${ativo}`);
    if (legado !== null) chaves[`${CHAVE_LEGADA_ORDENS}${ativo}`] = legado;
  }

  const rodadas = Array.isArray(chaves['fluxo_round_audit_v1']) ? (chaves['fluxo_round_audit_v1'] as unknown[]).length : 0;

  const ordensPorAtivo: Record<string, number> = {};
  for (const ativo of ATIVOS) {
    const livro = chaves[`fluxo_renko_intraday_audit_v3_${ativo}`];
    ordensPorAtivo[ativo] = Array.isArray(livro) ? livro.length : 0;
  }

  const fita = chaves['fluxo_real_tape_v1'] as { ticks?: unknown[] } | null;
  const ticksDaFita = fita && Array.isArray(fita.ticks) ? fita.ticks.length : 0;

  return {
    geradoEm: new Date().toISOString(),
    origem: 'Flow Quant MT5 — exportador de auditoria',
    navegador: typeof navigator !== 'undefined' ? navigator.userAgent : 'desconhecido',
    chaves,
    resumo: { rodadas, ordensPorAtivo, ticksDaFita },
  };
}

/** Baixa o pacote como arquivo. Devolve o nome do arquivo gerado. */
export function baixarPacoteAuditoria(): string {
  const pacote = montarPacoteAuditoria();
  const agora = new Date();
  const data = agora.toISOString().slice(0, 10);
  const hora = `${String(agora.getHours()).padStart(2, '0')}${String(agora.getMinutes()).padStart(2, '0')}`;
  const nome = `auditoria-${data}-${hora}.json`;

  const blob = new Blob([JSON.stringify(pacote, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Revoga no próximo ciclo: revogar imediatamente cancela o download em alguns navegadores
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return nome;
}
