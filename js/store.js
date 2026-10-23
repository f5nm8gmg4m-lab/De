/**
 * store.js — app state + persistence.
 *
 * The whole state lives in one object that is written to localStorage after
 * every change (see `commit`). All storage access is wrapped in try/catch so
 * private-mode / full-quota browsers degrade gracefully instead of crashing.
 */
import { CURRENCIES, isValidISODate } from './calc.js';

export const STORAGE_KEY = 'yen-wallet:v1';
export const SCHEMA_VERSION = 1;

/** Wallet colors — a fixed, colour-blind-checked order (red is reserved for alerts). */
export const WALLET_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6'];

export const DEFAULT_SETTINGS = Object.freeze({
  rate: 40, // 1 SAR = 40 JPY
  threshold: 80, // % of budget at which a wallet turns red
  tripStart: '',
  tripEnd: '',
  theme: 'system', // 'system' | 'light' | 'dark'
});

export function defaultState() {
  return {
    version: SCHEMA_VERSION,
    settings: { ...DEFAULT_SETTINGS },
    wallets: [],
    expenses: [],
    ui: { tab: 'wallets', lastWalletId: null, filterWalletId: null },
  };
}

export function uid() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

const num = (v, fallback) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const str = (v, fallback = '') => (typeof v === 'string' ? v : fallback);
const cur = (v, fallback) => (CURRENCIES.includes(v) ? v : fallback);

/**
 * Turn any parsed JSON (from storage or an imported backup) into a valid state.
 * Unknown / broken entries are dropped rather than crashing the app.
 * Throws only if the input is not recognisable as app data at all.
 */
export function normalizeState(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.wallets) || !Array.isArray(raw.expenses)) {
    throw new Error('This file does not look like a budget backup.');
  }
  const base = defaultState();
  const s = raw.settings || {};
  const settings = {
    rate: num(s.rate, DEFAULT_SETTINGS.rate) > 0 ? num(s.rate, DEFAULT_SETTINGS.rate) : DEFAULT_SETTINGS.rate,
    threshold: Math.min(100, Math.max(1, num(s.threshold, DEFAULT_SETTINGS.threshold))),
    tripStart: isValidISODate(s.tripStart) ? s.tripStart : '',
    tripEnd: isValidISODate(s.tripEnd) ? s.tripEnd : '',
    theme: ['system', 'light', 'dark'].includes(s.theme) ? s.theme : 'system',
  };

  const wallets = [];
  const seen = new Set();
  raw.wallets.forEach((w, i) => {
    if (!w || typeof w !== 'object') return;
    const id = str(w.id) || uid();
    if (seen.has(id)) return;
    const budget = num(w.budget, NaN);
    if (!(budget > 0)) return;
    seen.add(id);
    wallets.push({
      id,
      name: str(w.name).trim().slice(0, 40) || 'Wallet',
      budget,
      budgetCurrency: cur(w.budgetCurrency, 'SAR'),
      spendCurrency: cur(w.spendCurrency, 'JPY'),
      color: /^#[0-9a-f]{6}$/i.test(w.color) ? w.color : WALLET_COLORS[i % WALLET_COLORS.length],
      createdAt: num(w.createdAt, Date.now()),
    });
  });

  const expenses = [];
  for (const e of raw.expenses) {
    if (!e || typeof e !== 'object' || !seen.has(e.walletId)) continue;
    const amount = num(e.amount, NaN);
    if (!(amount > 0) || !isValidISODate(e.date)) continue;
    const wallet = wallets.find((w) => w.id === e.walletId);
    expenses.push({
      id: str(e.id) || uid(),
      walletId: e.walletId,
      amount,
      currency: cur(e.currency, wallet.spendCurrency),
      note: str(e.note).slice(0, 120),
      date: e.date,
      createdAt: num(e.createdAt, Date.now()),
    });
  }

  const u = raw.ui || {};
  const ui = {
    tab: ['wallets', 'expenses', 'analysis'].includes(u.tab) ? u.tab : 'wallets',
    lastWalletId: seen.has(u.lastWalletId) ? u.lastWalletId : null,
    filterWalletId: seen.has(u.filterWalletId) ? u.filterWalletId : null,
  };
  return { ...base, settings, wallets, expenses, ui };
}

/** Load state from localStorage, falling back to defaults on any problem. */
export function loadState(storage = globalThis.localStorage) {
  try {
    const text = storage?.getItem(STORAGE_KEY);
    if (!text) return defaultState();
    return normalizeState(JSON.parse(text));
  } catch (err) {
    console.warn('Could not load saved data, starting fresh.', err);
    return defaultState();
  }
}

/** Save state; returns false (never throws) if storage is unavailable or full. */
export function saveState(state, storage = globalThis.localStorage) {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch (err) {
    console.warn('Could not save data.', err);
    return false;
  }
}

/** Data written to an export file (UI state is left out on purpose). */
export function exportPayload(state) {
  return {
    app: 'yen-wallet',
    version: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    settings: state.settings,
    wallets: state.wallets,
    expenses: state.expenses,
  };
}

/** Pick the first wallet colour not yet used (falls back to cycling). */
export function nextWalletColor(wallets) {
  const used = new Set(wallets.map((w) => w.color));
  return WALLET_COLORS.find((c) => !used.has(c)) || WALLET_COLORS[wallets.length % WALLET_COLORS.length];
}
