/**
 * calc.js — pure, side-effect-free money & date math.
 *
 * Everything shown in the UI (spent, remaining, percentages, totals, trip
 * allowances) is DERIVED from the raw wallets + expenses + exchange rate.
 * Nothing is cached, so changing the rate or editing an expense can never
 * leave a stale balance behind.
 */

export const CURRENCIES = ['SAR', 'JPY'];

/** Decimal places used when displaying / rounding each currency. */
const DECIMALS = { SAR: 2, JPY: 0 };

/**
 * Convert an amount between SAR and JPY.
 * @param {number} amount
 * @param {string} from  'SAR' | 'JPY'
 * @param {string} to    'SAR' | 'JPY'
 * @param {number} rate  how many JPY one SAR buys ("1 SAR = rate JPY")
 */
export function convert(amount, from, to, rate) {
  if (from === to) return amount;
  if (from === 'SAR' && to === 'JPY') return amount * rate;
  if (from === 'JPY' && to === 'SAR') return amount / rate;
  throw new Error(`Unsupported conversion ${from} -> ${to}`);
}

/** Round to the currency's natural precision (avoids 0.1 + 0.2 artefacts). */
export function roundMoney(amount, currency) {
  const f = 10 ** (DECIMALS[currency] ?? 2);
  return Math.round(amount * f) / f;
}

/** Format money for display, e.g. "SAR 1,234.50" or "¥12,340". */
export function formatMoney(amount, currency) {
  const d = DECIMALS[currency] ?? 2;
  const abs = Math.abs(amount);
  const num = abs.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  const sign = amount < 0 && roundMoney(abs, currency) !== 0 ? '−' : '';
  return currency === 'JPY' ? `${sign}¥${num}` : `${sign}${currency} ${num}`;
}

/** The "other" currency, used to show a second equivalent figure. */
export function otherCurrency(c) {
  return c === 'SAR' ? 'JPY' : 'SAR';
}

/**
 * Statistics for one wallet.
 * spentBudget / remainingBudget are in the wallet's budget currency (SAR by
 * default); spentSpend is in its spending currency (JPY by default).
 */
export function walletStats(wallet, expenses, settings) {
  const { rate, threshold } = settings;
  let spentBudget = 0;
  for (const e of expenses) {
    if (e.walletId !== wallet.id) continue;
    spentBudget += convert(e.amount, e.currency, wallet.budgetCurrency, rate);
  }
  const budget = wallet.budget;
  const remainingBudget = budget - spentBudget;
  const pct = budget > 0 ? (spentBudget / budget) * 100 : 0;

  // Compare at currency precision so 99.999999 % doesn't count as "over".
  const spentR = roundMoney(spentBudget, wallet.budgetCurrency);
  const budgetR = roundMoney(budget, wallet.budgetCurrency);
  const over = spentR > budgetR;
  const alert = over || pct >= threshold - 1e-9;

  const inCur = (amt, cur) => convert(amt, wallet.budgetCurrency, cur, rate);
  return {
    budget,
    spentBudget,
    remainingBudget,
    spentSAR: inCur(spentBudget, 'SAR'),
    spentJPY: inCur(spentBudget, 'JPY'),
    spentSpend: inCur(spentBudget, wallet.spendCurrency),
    remainingSAR: inCur(remainingBudget, 'SAR'),
    remainingJPY: inCur(remainingBudget, 'JPY'),
    budgetSAR: inCur(budget, 'SAR'),
    budgetJPY: inCur(budget, 'JPY'),
    pct,
    alert,
    over,
    status: over ? 'over' : alert ? 'alert' : 'ok',
  };
}

/** Totals across all wallets, in SAR and JPY. */
export function totals(wallets, expenses, settings) {
  let budgetSAR = 0;
  let spentSAR = 0;
  for (const w of wallets) {
    const s = walletStats(w, expenses, settings);
    budgetSAR += s.budgetSAR;
    spentSAR += s.spentSAR;
  }
  const remainingSAR = budgetSAR - spentSAR;
  const toJPY = (v) => convert(v, 'SAR', 'JPY', settings.rate);
  return {
    budgetSAR,
    spentSAR,
    remainingSAR,
    budgetJPY: toJPY(budgetSAR),
    spentJPY: toJPY(spentSAR),
    remainingJPY: toJPY(remainingSAR),
    pct: budgetSAR > 0 ? (spentSAR / budgetSAR) * 100 : 0,
  };
}

/* ------------------------------------------------------------------ dates */

/** Today's date as local "YYYY-MM-DD". */
export function todayISO(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Parse "YYYY-MM-DD" to a UTC day number (immune to DST/time-zone shifts). */
export function dayNumber(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86400000);
}

export function isoFromDayNumber(n) {
  return new Date(n * 86400000).toISOString().slice(0, 10);
}

/** Inclusive number of days between two ISO dates (same day => 1). */
export function daysInclusive(a, b) {
  return dayNumber(b) - dayNumber(a) + 1;
}

export function isValidISODate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  return isoFromDayNumber(dayNumber(s)) === s;
}

/** Sum of spending per day (in SAR) keyed by ISO date. */
export function spendingByDay(wallets, expenses, settings) {
  const byId = new Map(wallets.map((w) => [w.id, w]));
  const map = new Map();
  for (const e of expenses) {
    if (!byId.has(e.walletId)) continue;
    const sar = convert(e.amount, e.currency, 'SAR', settings.rate);
    map.set(e.date, (map.get(e.date) || 0) + sar);
  }
  return map;
}

/**
 * Daily series for the chart: one entry per calendar day (gaps filled with 0)
 * from the trip start (or first expense) to today / trip end / last expense.
 */
export function dailySeries(wallets, expenses, settings, today = todayISO()) {
  const map = spendingByDay(wallets, expenses, settings);
  const dates = [...map.keys()].sort();
  const { tripStart, tripEnd } = settings;
  let start = tripStart || dates[0];
  if (!start) return [];
  if (dates[0] && dates[0] < start) start = dates[0];
  let end = tripEnd && tripEnd < today ? tripEnd : today;
  if (end < start) end = tripEnd && tripEnd >= start ? tripEnd : start;
  const last = dates[dates.length - 1];
  if (last && last > end) end = last;
  const out = [];
  for (let n = dayNumber(start); n <= dayNumber(end); n++) {
    const iso = isoFromDayNumber(n);
    out.push({ date: iso, sar: map.get(iso) || 0 });
  }
  return out;
}

/**
 * Pace numbers for the Analysis page.
 * - avgDailySAR: total spent / days elapsed. Days elapsed = trip start .. today
 *   (capped at trip end) if a trip start is set, otherwise first expense .. today.
 * - daysLeft / dailyAllowanceSAR: only when a trip end is set. Days left counts
 *   today (you can still spend today). Before the trip starts it's the whole trip.
 */
export function tripStats(wallets, expenses, settings, today = todayISO()) {
  const t = totals(wallets, expenses, settings);
  const { tripStart, tripEnd } = settings;
  const usable = expenses.filter((e) => wallets.some((w) => w.id === e.walletId));
  const firstExpense = usable.map((e) => e.date).sort()[0];

  let elapsedDays = 0;
  const from = tripStart || firstExpense;
  if (from) {
    let to = tripEnd && tripEnd < today ? tripEnd : today;
    if (firstExpense && !tripStart && firstExpense > to) to = firstExpense;
    elapsedDays = Math.max(0, daysInclusive(from, to));
  }
  const avgDailySAR = elapsedDays > 0 ? t.spentSAR / elapsedDays : 0;

  let daysLeft = null;
  let tripDays = null;
  let phase = 'none'; // none | before | during | after
  if (tripEnd) {
    const startForLeft = tripStart && tripStart > today ? tripStart : today;
    daysLeft = Math.max(0, daysInclusive(startForLeft, tripEnd));
    phase = tripEnd < today ? 'after' : tripStart && tripStart > today ? 'before' : 'during';
  } else if (tripStart) {
    phase = tripStart > today ? 'before' : 'during';
  }
  if (tripStart && tripEnd && tripEnd >= tripStart) tripDays = daysInclusive(tripStart, tripEnd);

  const dailyAllowanceSAR = daysLeft ? Math.max(0, t.remainingSAR) / daysLeft : null;
  const toJPY = (v) => (v == null ? null : convert(v, 'SAR', 'JPY', settings.rate));

  // Share of the trip that has elapsed — compared against share of budget used.
  let tripElapsedPct = null;
  if (tripDays) {
    const done = phase === 'before' ? 0 : phase === 'after' ? tripDays : daysInclusive(tripStart, today);
    tripElapsedPct = Math.min(100, (done / tripDays) * 100);
  }

  return {
    ...t,
    elapsedDays,
    avgDailySAR,
    avgDailyJPY: toJPY(avgDailySAR),
    daysLeft,
    tripDays,
    phase,
    tripElapsedPct,
    dailyAllowanceSAR,
    dailyAllowanceJPY: toJPY(dailyAllowanceSAR),
  };
}

/**
 * Validate a positive money amount typed by the user.
 * Returns { ok, value, error }.
 */
export function parseAmount(raw, { allowZero = false } = {}) {
  const s = String(raw ?? '').trim().replace(/,/g, '');
  if (s === '') return { ok: false, error: 'Enter an amount' };
  if (!/^\d*\.?\d+$|^\d+\.$/.test(s)) return { ok: false, error: 'Use numbers only (no minus sign)' };
  const value = Number(s);
  if (!Number.isFinite(value)) return { ok: false, error: 'Invalid number' };
  if (value < 0) return { ok: false, error: 'Amount cannot be negative' };
  if (!allowZero && value === 0) return { ok: false, error: 'Amount must be more than 0' };
  if (value > 1e12) return { ok: false, error: 'That amount is too large' };
  return { ok: true, value };
}
