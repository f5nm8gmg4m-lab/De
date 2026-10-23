// Unit tests for the pure money/date logic and persistence helpers.
// Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  convert, walletStats, totals, tripStats, dailySeries, parseAmount, formatMoney, daysInclusive,
} from '../js/calc.js';
import { normalizeState, loadState, saveState, defaultState, STORAGE_KEY } from '../js/store.js';

const settings = { rate: 40, threshold: 80, tripStart: '', tripEnd: '', theme: 'system' };
const food = { id: 'f', name: 'Food', budget: 100, budgetCurrency: 'SAR', spendCurrency: 'JPY', color: '#2a78d6' };
const exp = (amount, walletId = 'f', date = '2026-10-20', currency = 'JPY') => ({ id: Math.random() + '', walletId, amount, currency, date, note: '', createdAt: 1 });

test('convert SAR <-> JPY using "1 SAR = X JPY"', () => {
  assert.equal(convert(100, 'SAR', 'JPY', 40), 4000);
  assert.equal(convert(4000, 'JPY', 'SAR', 40), 100);
  assert.equal(convert(5, 'JPY', 'JPY', 40), 5);
});

test('expenses are deducted from the right wallet', () => {
  const s = walletStats(food, [exp(1000), exp(500, 'other')], settings);
  assert.equal(s.spentJPY, 1000);
  assert.equal(s.spentSAR, 25);
  assert.equal(s.remainingSAR, 75);
  assert.equal(s.remainingJPY, 3000);
  assert.equal(s.pct, 25);
  assert.equal(s.status, 'ok');
});

test('wallet turns red at the threshold and shows over budget when exceeded', () => {
  assert.equal(walletStats(food, [exp(3199)], settings).status, 'ok'); // 79.975 %
  assert.equal(walletStats(food, [exp(3200)], settings).status, 'alert'); // exactly 80 %
  assert.equal(walletStats(food, [exp(4000)], settings).status, 'alert'); // exactly 100 % = not over
  const over = walletStats(food, [exp(4400)], settings);
  assert.equal(over.status, 'over');
  assert.equal(over.remainingSAR, -10);
  // Adjustable threshold.
  assert.equal(walletStats(food, [exp(3200)], { ...settings, threshold: 90 }).status, 'ok');
});

test('changing the exchange rate recalculates everything', () => {
  const e = [exp(2000)];
  assert.equal(walletStats(food, e, settings).spentSAR, 50);
  const r50 = walletStats(food, e, { ...settings, rate: 50 });
  assert.equal(r50.spentSAR, 40);
  assert.equal(r50.remainingJPY, 3000); // 60 SAR * 50
  assert.equal(walletStats(food, e, { ...settings, rate: 20 }).status, 'alert'); // exactly 100 SAR
  assert.equal(walletStats(food, e, { ...settings, rate: 19 }).status, 'over'); // 105.26 SAR
});

test('totals and trip pace', () => {
  const shop = { ...food, id: 's', name: 'Shop', budget: 300 };
  const e = [exp(1000, 'f', '2026-10-20'), exp(4000, 's', '2026-10-21')];
  const t = totals([food, shop], e, settings);
  assert.equal(t.budgetSAR, 400);
  assert.equal(t.spentSAR, 125);
  assert.equal(t.remainingJPY, 11000);

  const st = { ...settings, tripStart: '2026-10-20', tripEnd: '2026-10-29' };
  const ts = tripStats([food, shop], e, st, '2026-10-24');
  assert.equal(ts.elapsedDays, 5);
  assert.equal(ts.avgDailySAR, 25);
  assert.equal(ts.daysLeft, 6); // 24..29 inclusive
  assert.equal(ts.dailyAllowanceSAR, 275 / 6);
  assert.equal(ts.tripElapsedPct, 50);
  // Before the trip: days left = whole trip.
  assert.equal(tripStats([food], [], st, '2026-10-01').daysLeft, 10);
  // After the trip.
  assert.equal(tripStats([food], [], st, '2026-11-05').daysLeft, 0);
});

test('daily series fills gaps with zero', () => {
  const s = dailySeries([food], [exp(400, 'f', '2026-10-20'), exp(800, 'f', '2026-10-22')], settings, '2026-10-23');
  assert.deepEqual(s.map((d) => d.sar), [10, 0, 20, 0]);
  assert.equal(daysInclusive('2026-10-20', '2026-10-23'), 4);
});

test('input validation rejects empty, zero, negative and junk amounts', () => {
  for (const bad of ['', '  ', '0', '-5', 'abc', '1e5', '--1', '1.2.3']) assert.equal(parseAmount(bad).ok, false, bad);
  assert.deepEqual(parseAmount('1,500'), { ok: true, value: 1500 });
  assert.deepEqual(parseAmount('12.5'), { ok: true, value: 12.5 });
});

test('formatting', () => {
  assert.equal(formatMoney(12345.4, 'JPY'), '¥12,345');
  assert.equal(formatMoney(1234.5, 'SAR'), 'SAR 1,234.50');
  assert.equal(formatMoney(-10, 'SAR'), '−SAR 10.00');
});

test('persistence round-trip and graceful failure', () => {
  const mem = new Map();
  const storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  const s = defaultState();
  s.wallets.push(food);
  s.expenses.push(exp(1000));
  s.settings.rate = 41.5;
  s.settings.theme = 'dark';
  assert.equal(saveState(s, storage), true);
  const back = loadState(storage);
  assert.equal(back.settings.rate, 41.5);
  assert.equal(back.settings.theme, 'dark');
  assert.equal(back.wallets.length, 1);
  assert.equal(back.expenses[0].amount, 1000);

  const broken = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('quota'); } };
  assert.equal(saveState(s, broken), false);
  assert.deepEqual(loadState(broken), defaultState());
  mem.set(STORAGE_KEY, '{not json');
  assert.deepEqual(loadState(storage), defaultState());
});

test('import normalisation drops invalid data', () => {
  assert.throws(() => normalizeState({ hello: 1 }));
  const n = normalizeState({
    settings: { rate: -3, threshold: 500 },
    wallets: [food, { id: 'bad', name: 'x', budget: -1 }],
    expenses: [exp(100), exp(-5), exp(100, 'missing'), { ...exp(1), date: '2026-13-45' }],
  });
  assert.equal(n.settings.rate, 40);
  assert.equal(n.settings.threshold, 100);
  assert.equal(n.wallets.length, 1);
  assert.equal(n.expenses.length, 1);
});
