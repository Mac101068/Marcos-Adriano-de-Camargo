/**
 * VERIFICADOR DE CALIBRAÇÃO SINTÉTICO × REAL (jogável a qualquer momento)
 * ----------------------------------------------------------------------------
 * O gerador sintético (marketSimulator) foi calibrado para reproduzir o RETRATO do
 * pregão real do WINZ26 medido na base MT5 pós-borda (03–04/11, o único trecho
 * honesto — a série inteira carrega o salto fantasma de 30/10→03/11):
 *
 *   alvo por pregão: caminho ~118k pts · faixa 1.700–2.900 · líquido ~735 · ~636 boxes 10R
 *
 * Este script mede os mesmos 4 números em N seeds do sintético e diz se continua
 * dentro da faixa. Rodar:  npx tsx scripts/calibSintetico.ts
 */
import { generateHistoricalTicks } from '../src/utils/marketSimulator';
import { RenkoFlowEngine } from '../src/utils/renkoCalculator';
import { DEFAULT_EA_CONFIG } from '../src/services/eaConfigService';
import { Tick } from '../src/types/trading';

const cfg = {
  ...DEFAULT_EA_CONFIG,
  adaptiveThresholdEnabled: false,
  consolidationFilterEnabled: false,
  exhaustionFilterEnabled: false,
  requireCvdNewExtreme: false,
  minDeltaThreshold: 100,
};

const ALVO = { caminho: 118_000, faixaMin: 1_700, faixaMax: 2_900, liquido: 735, boxes: 636 };
const SEEDS = 5;
const DIAS_POR_SEED = 6;

let totBoxes = 0, totPath = 0, totFaixa = 0, totLiq = 0, n = 0;
for (let s = 1; s <= SEEDS; s++) {
  const ticks: Tick[] = generateHistoricalTicks(DIAS_POR_SEED, 177000, s * 12345);
  const porDia: Record<string, Tick[]> = {};
  for (const t of ticks) {
    const k = new Date(t.timestamp).toISOString().slice(0, 10);
    (porDia[k] ||= []).push(t);
  }
  const renko = new RenkoFlowEngine(50);
  for (const ts of Object.values(porDia)) {
    let path = 0, liq = 0;
    for (let i = 1; i < ts.length; i++) {
      path += Math.abs(ts[i].price - ts[i - 1].price);
      liq += ts[i].price - ts[i - 1].price;
    }
    const hi = Math.max(...ts.map((x) => x.price));
    const lo = Math.min(...ts.map((x) => x.price));
    totPath += path; totFaixa += hi - lo; totLiq += Math.abs(liq); n++;
  }
  for (const t of ticks) {
    // Conta TODOS os boxes fechados (um tick pode fechar vários no preenchimento Renko)
    totBoxes += renko.processTick(t, cfg).closedBoxes.length;
  }
}

const med = (v: number) => Math.round(v / n);
const linha = (rot: string, ob: number, alvo: string, ok: boolean) =>
  console.log(`${ok ? '✅' : '❌'} ${rot.padEnd(22)} ${String(ob).padStart(7)}   alvo ${alvo}`);

console.log(`Sintético: ${n} pregões (${SEEDS} seeds × ${DIAS_POR_SEED} dias) vs retrato REAL WINZ26 pós-borda\n`);
const caminho = med(totPath), faixa = med(totFaixa), liq = med(totLiq), boxes = med(totBoxes);
linha('caminho/pregão', caminho, `~${ALVO.caminho}`, Math.abs(caminho - ALVO.caminho) / ALVO.caminho < 0.2);
linha('faixa/pregão', faixa, `${ALVO.faixaMin}–${ALVO.faixaMax}`, faixa >= ALVO.faixaMin * 0.8 && faixa <= ALVO.faixaMax * 1.2);
linha('líquido/pregão', liq, `~${ALVO.liquido}`, liq >= ALVO.liquido * 0.5 && liq <= ALVO.liquido * 2);
linha('boxes 10R/pregão', boxes, `~${ALVO.boxes}`, boxes >= ALVO.boxes * 0.75);
