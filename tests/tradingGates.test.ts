import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { DEFAULT_EA_CONFIG } from '../src/services/eaConfigService';
import type { TradeOrder } from '../src/types/trading';
import { isWithinTradingWindow, preserveRobotArmOnAssetChange, sessionFinancialLock } from '../src/utils/tradingGates';
import { isSessionCloseLock, setEnforceTimeGates } from '../src/utils/sessionRules';

const localTime = (hour: number, minute: number) => new Date(2026, 10, 6, hour, minute).getTime();

afterEach(() => setEnforceTimeGates(true));

test('entry window includes its start and excludes its cutoff', () => {
  const config = {
    ...DEFAULT_EA_CONFIG,
    tradingHoursEnabled: true,
    tradingStartTime: '08:55',
    tradingStopEntriesTime: '17:30',
  };
  setEnforceTimeGates(true);

  assert.equal(isWithinTradingWindow(localTime(8, 54), config), false);
  assert.equal(isWithinTradingWindow(localTime(8, 55), config), true);
  assert.equal(isWithinTradingWindow(localTime(17, 29), config), true);
  assert.equal(isWithinTradingWindow(localTime(17, 30), config), false);
});

test('switching away from WIN never carries the armed state into another asset', () => {
  assert.equal(preserveRobotArmOnAssetChange(true, 'WIN'), true);
  assert.equal(preserveRobotArmOnAssetChange(true, 'WDO'), false);
  assert.equal(preserveRobotArmOnAssetChange(true, 'BTCBR'), false);
  assert.equal(preserveRobotArmOnAssetChange(false, 'WIN'), false);
});

test('entry window is open when time gates are disabled or configuration is invalid', () => {
  const config = {
    ...DEFAULT_EA_CONFIG,
    tradingHoursEnabled: true,
    tradingStartTime: 'invalid',
    tradingStopEntriesTime: '17:30',
  };
  setEnforceTimeGates(false);
  assert.equal(isWithinTradingWindow(localTime(2, 0), config), true);

  setEnforceTimeGates(true);
  assert.equal(isWithinTradingWindow(localTime(2, 0), config), true);
});

test('forced close lock covers configured close time through the 35-minute liquidation window', () => {
  setEnforceTimeGates(true);
  assert.equal(isSessionCloseLock(localTime(17, 29), '17:30'), false);
  assert.equal(isSessionCloseLock(localTime(17, 30), '17:30'), true);
  assert.equal(isSessionCloseLock(localTime(18, 4), '17:30'), true);
  assert.equal(isSessionCloseLock(localTime(18, 5), '17:30'), false);

  setEnforceTimeGates(false);
  assert.equal(isSessionCloseLock(localTime(17, 30), '17:30'), false);
});

const closedTrade = (id: string, financialResult: number, exitTimestamp: number): TradeOrder => ({
  id,
  timestamp: exitTimestamp - 60_000,
  timeStr: '10:00:00',
  exitTimestamp,
  exitTimeStr: '10:01:00',
  type: 'BUY',
  entryPrice: 100,
  exitPrice: 101,
  contracts: 1,
  stopLoss: 0,
  takeProfit: 0,
  financialResult,
  status: 'CLOSED_PROFIT',
  triggerReason: 'Teste',
});

test('daily financial lock counts only closed trades from the current session', () => {
  const sessionStart = localTime(9, 0);
  const config = {
    ...DEFAULT_EA_CONFIG,
    maxDailyProfit: 500,
    maxDailyLoss: 300,
    maxDailyTrades: 2,
  };
  const priorSessionTrade = closedTrade('old', 1_000, sessionStart - 1);
  const currentSessionTrades = [
    closedTrade('first', 300, sessionStart + 1),
    closedTrade('second', 200, sessionStart + 2),
  ];
  const openTrade = { ...closedTrade('open', 900, sessionStart + 3), status: 'OPEN' as const };

  assert.equal(sessionFinancialLock([priorSessionTrade, openTrade], config, sessionStart), null);
  const lock = sessionFinancialLock([...currentSessionTrades, openTrade], config, sessionStart);
  assert.equal(lock?.net, 500);
  assert.equal(lock?.trades, 2);
  assert.match(lock?.reason ?? '', /Meta diária de ganho atingida/);
});

test('daily financial lock triggers at the configured loss threshold', () => {
  const sessionStart = localTime(9, 0);
  const config = {
    ...DEFAULT_EA_CONFIG,
    maxDailyProfit: 0,
    maxDailyLoss: 300,
    maxDailyTrades: 0,
  };

  const lock = sessionFinancialLock([closedTrade('loss', -300, sessionStart + 1)], config, sessionStart);
  assert.equal(lock?.net, -300);
  assert.equal(lock?.trades, 1);
  assert.match(lock?.reason ?? '', /Trava de perda diária acionada/);
});
