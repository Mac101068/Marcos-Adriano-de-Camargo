// Regressão da escala editável do box Renko: `npx tsx scripts/renkoBoxScaleAssert.ts`.
// Cobre a conversão R <-> pontos, a reconstrução do histórico em escala nova, o texto do sinal,
// o script Python gerado e a matemática da caixa editável de Ajustes.
import {
  ASSETS,
  DEFAULT_ASSET_ID,
  boxPointsForR,
  clampBoxPoints,
  clampRenkoR,
  renkoRFromBoxPoints,
  renkoRChoices,
  renkoScaleLabel,
} from '../src/assets/assetRegistry';
import { RenkoFlowEngine } from '../src/utils/renkoCalculator';
import { Tick, AutomationConfig } from '../src/types/trading';
import { DEFAULT_EA_CONFIG } from '../src/services/eaConfigService';
import { generatePythonMT5Script } from '../src/utils/pythonScriptGenerator';

const win = ASSETS[DEFAULT_ASSET_ID];
const assert = (cond: boolean, msg: string) => {
  if (!cond) {
    console.error('FALHOU: ' + msg);
    process.exit(1);
  }
  console.log('ok  ' + msg);
};

// 1) Conversão R <-> pontos encaixada no tick do WIN (1R = 5 pts)
for (const r of [8, 9, 10, 15, 25, 29]) {
  const pts = boxPointsForR(r, win);
  assert(pts === r * 5, `${r}R -> ${pts} pts (esperado ${r * 5})`);
  assert(renkoRFromBoxPoints(pts, win) === r, `${pts} pts -> ${r}R de volta`);
  assert(renkoScaleLabel(pts, win) === `${r}R`, `rótulo de ${pts} pts = ${r}R`);
}

// 2) Escada de testes cobre as escalas pedidas
const ladder = renkoRChoices(win, 10);
for (const r of [8, 9, 15, 25, 29]) {
  assert(ladder.includes(r), `escada inclui ${r}R -> [${ladder.join(', ')}]`);
}

// 3) Trocar a escala reconstrói a história inteira (mesmos ticks, box novo)
const config: AutomationConfig = { ...DEFAULT_EA_CONFIG, boxPoints: 50 };
const ticks: Tick[] = [];
let price = 171500;
let dir = 1;
for (let i = 0; i < 4000; i++) {
  // passeio aleatório determinístico, com reversões periódicas
  if (i % 400 === 399) dir *= -1;
  price += dir * (2 + (i % 7));
  ticks.push({
    id: `t-${i}`,
    timeStr: new Date(1_700_000_000_000 + i * 300).toTimeString().split(' ')[0],
    price,
    volume: 10 + (i % 5),
    aggressor: dir > 0 ? 'BUY' : 'SELL',
    timestamp: 1_700_000_000_000 + i * 300,
  });
}

const build = (boxPoints: number) => {
  const eng = new RenkoFlowEngine(boxPoints, win);
  eng.initialize(ticks[0].price, ticks[0].timestamp);
  for (const t of ticks) eng.processTick(t, { ...config, boxPoints });
  return eng.getBoxes();
};

const boxes10 = build(50);
const boxes8 = build(40);
const boxes29 = build(145);
assert(boxes10.length > 10, `10R formou ${boxes10.length} boxes`);
assert(boxes8.length > boxes10.length, `8R (${boxes8.length}) gera mais tijolos que 10R (${boxes10.length})`);
assert(boxes29.length < boxes10.length, `29R (${boxes29.length}) gera menos tijolos que 10R (${boxes10.length})`);
assert(
  boxes8.every((b) => Math.abs(b.close - b.open) === 40),
  'todos os boxes de 8R medem exatamente 40 pts'
);
assert(
  boxes29.every((b) => Math.abs(b.close - b.open) === 145),
  'todos os boxes de 29R medem exatamente 145 pts'
);

// 4) Motivo do sinal denuncia a escala real (40 pts = 8R no WIN, e não o antigo 10R)
const eng = new RenkoFlowEngine(40, win);
eng.initialize(ticks[0].price, ticks[0].timestamp);
let reason = '';
for (const t of ticks) {
  const res = eng.processTick(t, {
    ...config,
    boxPoints: 40,
    minDeltaThreshold: 1,
    strategyMode: 'PULLBACK_RETEST',
    requireCvdNewExtreme: false,
  });
  if (res.signalReason) reason = res.signalReason;
}
assert(reason.includes('Preço 8R'), `motivo do sinal usa a escala 8R (40 pts): "${reason}"`);
assert(!reason.includes('10R'), `motivo não anuncia a escala antiga: "${reason}"`);

// 5) Script Python gerado carrega a escala definida no gráfico
const py = generatePythonMT5Script({ ...config, boxPoints: 40 });
assert(py.includes('RENKO 8R'), 'título do script Python anuncia RENKO 8R (box de 40 pts)');
assert(py.includes('BOX_POINTS = 40'), 'BOX_POINTS do script sai do config (40)');
assert(py.includes('1R = 5 pts'), 'script explica a conversão 1R = tick do ativo');
assert(!py.includes('Box 10R'), 'script não fala em Box 10R');

// 6) Matemática da caixa editável de Ajustes (o que o slider de 25 em 25 não conseguia)
assert(clampRenkoR(8) === 8 && boxPointsForR(clampRenkoR(8), win) === 40, 'digitar 8 -> box de 40 pts');
assert(clampRenkoR(29) === 29 && boxPointsForR(clampRenkoR(29), win) === 145, 'digitar 29 -> box de 145 pts');
assert(clampRenkoR(0.4) === 1 && clampRenkoR(99) === 60, 'R fora da faixa é aparado em 1R..60R');
assert(clampBoxPoints(143, win) === 145, '143 pts encaixa no tick (145 = 29R)');
assert(clampBoxPoints(7, win) === 5, '7 pts encaixa para baixo (5 = 1R)');
assert(clampBoxPoints(999, win) === 300, '999 pts é aparado no teto de 60R');
assert(clampBoxPoints(40, win) === 40 && renkoScaleLabel(clampBoxPoints(40, win), win) === '8R', '40 pts ida e volta em 8R');

console.log('\nTODOS OS ASSERTS PASSARAM');
