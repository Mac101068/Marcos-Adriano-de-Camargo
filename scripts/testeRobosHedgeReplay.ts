/**
 * ============================================================================
 * TESTE DE COMPORTAMENTO DOS ROBÔS HEDGE EM REPLAY (AUTOMATIZADO)
 * ----------------------------------------------------------------------------
 * Protocolo de validação:
 * 1. Carrega dados reais de 2 pregões do cache rolante de 10 dias.
 * 2. Passe 1: Robôs ativados (100001 e 100002).
 *    - Compras apenas no 100001; Vendas apenas no 100002.
 *    - PnL e posições coerentes.
 * 3. Passe 2: onCloseOpposite=true no RoboCompra (gestão sem SL/TP fixo,
 *    fechamento exclusivamente por virada de sinal).
 *    - Sinal contrário fecha apenas posições do 100001 com OPPOSITE_ROBOT_SIGNAL.
 *    - Posições do 100002 não são tocadas.
 * 4. Passe 3: Robôs pausados.
 *    - Rigorosamente zero intenções.
 * ============================================================================
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { Tick, AutomationConfig } from '../src/types/trading';
import { DEFAULT_EA_CONFIG } from '../src/services/eaConfigService';
import { createDirectionalRobot } from '../src/services/directionalRobotService';
import { ASSETS } from '../src/assets/assetRegistry';
import { RenkoFlowEngine } from '../src/utils/renkoCalculator';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.join(SCRIPT_DIR, '..', 'dados', 'mt5_real_WINZ26_2026-10-20_a_2026-11-04.json');

if (!fs.existsSync(DATA_FILE)) {
  console.error(`ERRO: Arquivo de cache ${DATA_FILE} não encontrado!`);
  process.exit(1);
}

const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
const allTicks: Tick[] = raw.ticks || [];

// Agrupar por data (YYYY-MM-DD)
const byDate = new Map<string, Tick[]>();
for (const t of allTicks) {
  const d = new Date(t.timestamp).toISOString().split('T')[0];
  if (!byDate.has(d)) byDate.set(d, []);
  byDate.get(d)!.push(t);
}

// Dois pregões reais com dinâmicas de mercado diferentes:
// 1. 2026-10-27 (Dia de alta e recuo, com alternância de sinais)
// 2. 2026-10-28 (Dia direcional de forte queda de mais de 5.000 pts)
const PREGAO_1 = '2026-10-27';
const PREGAO_2 = '2026-10-28';

const asset = ASSETS.WIN;
const baseConfig: AutomationConfig = {
  ...DEFAULT_EA_CONFIG,
  boxPoints: 50,
  contracts: 1,
  takeProfitPoints: 50,
  stopLossPoints: 100,
  strategyMode: 'PYRAMID_FLOW_CONFLUENCE',
  adaptiveThresholdEnabled: true,
};

interface TestResult {
  pregao: string;
  passe: string;
  sinaisBuy: number;
  sinaisSell: number;
  intentsBuy100001: number;
  intentsSell100002: number;
  intentsWrongBuy: number;
  intentsWrongSell: number;
  pnlBuy: number;
  pnlSell: number;
  oppositeClosesBuy: number;
  oppositeClosesSell: number;
  pass: boolean;
  notes: string;
}

const results: TestResult[] = [];

function runReplayPass(
  pregaoDate: string,
  passeName: string,
  options: {
    paused?: boolean;
    onCloseOppositeBuy?: boolean;
    onCloseOppositeSell?: boolean;
  }
): TestResult {
  const ticks = byDate.get(pregaoDate) || [];
  if (ticks.length === 0) {
    throw new Error(`Nenhum tick para o pregão ${pregaoDate}`);
  }

  // 1. Instanciar motor RenkoFlowEngine
  const engine = new RenkoFlowEngine(50, asset);
  engine.initialize(ticks[0].price, ticks[0].timestamp);

  // No passe 2 (teste de fechamento por sinal oposto), desabilitamos SL/TP fixo
  // para que as posições fiquem abertas até a chegada do sinal contrário
  const slPoints = options.onCloseOppositeBuy ? 0 : baseConfig.stopLossPoints;
  const tpPoints = options.onCloseOppositeBuy ? 0 : baseConfig.takeProfitPoints;

  // 2. Instanciar Robôs Hedge
  const buyRobot = createDirectionalRobot({
    direction: 'BUY',
    magic: 100001,
    asset,
    baseConfig: {
      ...baseConfig,
      stopLossPoints: slPoints,
      takeProfitPoints: tpPoints,
      directionLock: 'BUY_ONLY',
      onCloseOpposite: options.onCloseOppositeBuy ?? false,
    },
  });

  const sellRobot = createDirectionalRobot({
    direction: 'SELL',
    magic: 100002,
    asset,
    baseConfig: {
      ...baseConfig,
      stopLossPoints: slPoints,
      takeProfitPoints: tpPoints,
      directionLock: 'SELL_ONLY',
      onCloseOpposite: options.onCloseOppositeSell ?? false,
    },
  });

  // Ativar ou manter pausado
  if (!options.paused) {
    buyRobot.activate();
    sellRobot.activate();
  }

  let totalSignalsBuy = 0;
  let totalSignalsSell = 0;

  // 3. Simular handleIncomingTick tick a tick
  for (const tick of ticks) {
    // onTick para trailing/sl/tp
    buyRobot.onTick(tick.price);
    sellRobot.onTick(tick.price);

    // Processar no motor
    const res = engine.processTick(tick, baseConfig);
    if (res.newBoxClosed && res.closedBox && res.signal) {
      if (res.signal === 'BUY') totalSignalsBuy++;
      if (res.signal === 'SELL') totalSignalsSell++;

      // Dispatch para robôs
      buyRobot.onSignal(res.signal, res.closedBox.index, tick.price);
      sellRobot.onSignal(res.signal, res.closedBox.index, tick.price);
    }
  }

  const snapBuy = buyRobot.getSnapshot();
  const snapSell = sellRobot.getSnapshot();

  // Verificações
  const intentsWrongBuy = snapBuy.intents.filter((i) => i.direction !== 'BUY' || i.magic !== 100001).length;
  const intentsWrongSell = snapSell.intents.filter((i) => i.direction !== 'SELL' || i.magic !== 100002).length;

  // Contar fechamentos por OPPOSITE_ROBOT_SIGNAL (verificando action no auditTrail)
  const oppBuy = snapBuy.positions.filter((p) =>
    p.auditTrail?.some((e) => e.action === 'OPPOSITE_ROBOT_SIGNAL')
  ).length;
  const oppSell = snapSell.positions.filter((p) =>
    p.auditTrail?.some((e) => e.action === 'OPPOSITE_ROBOT_SIGNAL')
  ).length;

  let pass = true;
  let notes = '';

  if (options.paused) {
    if (snapBuy.intents.length !== 0 || snapSell.intents.length !== 0) {
      pass = false;
      notes += 'Robôs pausados geraram intenções! ';
    } else {
      notes += 'Zero intenções (OK). ';
    }
  } else {
    if (intentsWrongBuy > 0 || intentsWrongSell > 0) {
      pass = false;
      notes += 'Intenções com direção/magic errado! ';
    }
    if (options.onCloseOppositeBuy) {
      if (oppBuy === 0 && totalSignalsSell > 0 && snapBuy.intents.length > 0) {
        pass = false;
        notes += 'Nenhum fechamento por sinal oposto no RoboCompra! ';
      }
      if (oppSell > 0) {
        pass = false;
        notes += 'RoboVenda teve posições fechadas indevidamente por sinal oposto! ';
      }
      if (pass) notes += `Fechamentos opostos OK (${oppBuy} no Compra, 0 no Venda). `;
    } else {
      notes += `Isolamento OK (${snapBuy.intents.length} BUY, ${snapSell.intents.length} SELL). `;
    }
  }

  return {
    pregao: pregaoDate,
    passe: passeName,
    sinaisBuy: totalSignalsBuy,
    sinaisSell: totalSignalsSell,
    intentsBuy100001: snapBuy.intents.length,
    intentsSell100002: snapSell.intents.length,
    intentsWrongBuy,
    intentsWrongSell,
    pnlBuy: snapBuy.pnlFinancial,
    pnlSell: snapSell.pnlFinancial,
    oppositeClosesBuy: oppBuy,
    oppositeClosesSell: oppSell,
    pass,
    notes,
  };
}

console.log('================================================================================');
console.log('   INICIANDO ENSAIO EM REPLAY AUTOMATIZADO DOS ROBÔS HEDGE (2 PREGÕES REAIS)   ');
console.log('================================================================================\n');

for (const pregao of [PREGAO_1, PREGAO_2]) {
  console.log(`>>> Executando Pregão: ${pregao}...`);
  // Passe 1: Ativo Normal
  const r1 = runReplayPass(pregao, '1. Ativo Normal', { paused: false });
  results.push(r1);

  // Passe 2: onCloseOpposite no RoboCompra
  const r2 = runReplayPass(pregao, '2. onCloseOpposite (Compra)', {
    paused: false,
    onCloseOppositeBuy: true,
    onCloseOppositeSell: false,
  });
  results.push(r2);

  // Passe 3: Pausados
  const r3 = runReplayPass(pregao, '3. Robôs Pausados', { paused: true });
  results.push(r3);
}

// Tabela de resultados
console.log('\n====================================================================================================================================');
console.log('                                                  TABELA DE RESULTADOS DO PROTOCOLO HEDGE                                           ');
console.log('====================================================================================================================================');
console.log(
  'PREGÃO    | PASSE                       | SINAIS (B/S) | INTENTS 100001 | INTENTS 100002 | PnL COMPRA  | PnL VENDA   | OPP_CLOSE (C/V) | STATUS '
);
console.log('------------------------------------------------------------------------------------------------------------------------------------');

let allPassed = true;

for (const r of results) {
  if (!r.pass) allPassed = false;
  const pregaoStr = r.pregao;
  const passeStr = r.passe.padEnd(27, ' ');
  const sinaisStr = `${r.sinaisBuy}/${r.sinaisSell}`.padEnd(12, ' ');
  const intentsBStr = String(r.intentsBuy100001).padEnd(14, ' ');
  const intentsSStr = String(r.intentsSell100002).padEnd(14, ' ');
  const pnlBStr = `R$ ${r.pnlBuy.toFixed(2)}`.padEnd(11, ' ');
  const pnlSStr = `R$ ${r.pnlSell.toFixed(2)}`.padEnd(11, ' ');
  const oppStr = `${r.oppositeClosesBuy}/${r.oppositeClosesSell}`.padEnd(15, ' ');
  const statusStr = r.pass ? '✅ PASS' : '❌ FAIL';

  console.log(
    `${pregaoStr} | ${passeStr} | ${sinaisStr} | ${intentsBStr} | ${intentsSStr} | ${pnlBStr} | ${pnlSStr} | ${oppStr} | ${statusStr}`
  );
}

console.log('====================================================================================================================================\n');

if (allPassed) {
  console.log('🎉 TODOS OS TESTES PASSARAM COM SUCESSO! Código de saída 0.\n');
  process.exit(0);
} else {
  console.error('❌ HOUVE FALHAS NO TESTE DE COMPORTAMENTO. Código de saída 1.\n');
  process.exit(1);
}
