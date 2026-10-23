/**
 * app.js — UI: rendering, navigation, sheets (modals) and event handling.
 *
 * Flow: every user action calls `commit(fn)`, which mutates `state`, saves it
 * to localStorage, and re-renders. All money figures are recomputed from raw
 * data on each render (see calc.js), so balances are always consistent.
 */
import {
  CURRENCIES,
  convert,
  formatMoney,
  otherCurrency,
  walletStats,
  totals,
  tripStats,
  dailySeries,
  todayISO,
  dayNumber,
  isValidISODate,
  parseAmount,
  roundMoney,
} from './calc.js';
import {
  loadState,
  saveState,
  defaultState,
  normalizeState,
  exportPayload,
  nextWalletColor,
  uid,
  WALLET_COLORS,
  STORAGE_KEY,
} from './store.js';
import { walletBars, dailyBars, bindDailyChart } from './charts.js';

/* =================================================================== state */

let state = loadState();
let saveWarned = false;

/** Apply a change, persist it immediately, then re-render. */
function commit(mutator) {
  mutator(state);
  const ok = saveState(state);
  if (!ok && !saveWarned) {
    saveWarned = true;
    toast('Could not save — storage is full or blocked (private mode?)', 'error');
  }
  render();
}

const walletById = (id) => state.wallets.find((w) => w.id === id);
const stats = (w) => walletStats(w, state.expenses, state.settings);

/* ================================================================= helpers */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const money = formatMoney;
const pctText = (p) => `${p >= 10 || p === 0 ? Math.round(p) : p.toFixed(1)}%`;

/** Inline SVG icons (stroke-based, inherit currentColor). */
const ICON = {
  wallet: '<path d="M3 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v1h1a1 1 0 0 1 1 1v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M15 13h2"/><path d="M3 8h16"/>',
  list: '<path d="M8 6h12M8 12h12M8 18h12"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>',
  alert: '<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18v.01"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>',
  upload: '<path d="M12 21V9M7 14l5-5 5 5M5 3h14"/>',
  reset: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
  check: '<path d="M5 12l5 5L20 7"/>',
};
const icon = (name, cls = '') =>
  `<svg class="icon ${cls}" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICON[name]}</svg>`;

/** Human label for a day: Today / Yesterday / Wed, Oct 21 (2025). */
function dayLabel(iso) {
  const diff = dayNumber(todayISO()) - dayNumber(iso);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  if (diff === -1) return 'Tomorrow';
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const opts = { weekday: 'short', month: 'short', day: 'numeric' };
  if (y !== new Date().getFullYear()) opts.year = 'numeric';
  return date.toLocaleDateString('en-US', opts);
}

/* ======================================================= progress bar anim */

// Remember each bar's last width so re-renders animate from old -> new value
// instead of jumping (and first paint animates from 0).
const barMemory = new Map();
function animateBars(root) {
  const fills = $$('[data-bar]', root);
  fills.forEach((el) => {
    el.style.width = `${barMemory.get(el.dataset.bar) ?? 0}%`;
  });
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      fills.forEach((el) => {
        el.style.width = `${el.dataset.w}%`;
        barMemory.set(el.dataset.bar, Number(el.dataset.w));
      });
    }),
  );
}
const bar = (key, pct, extra = '') =>
  `<div class="bar ${extra}" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(pct)}"><div class="bar-fill" data-bar="${key}" data-w="${Math.min(100, Math.max(0, pct)).toFixed(2)}"></div></div>`;

/* =================================================================== theme */

const media = window.matchMedia('(prefers-color-scheme: dark)');
const resolvedTheme = () =>
  state.settings.theme === 'system' ? (media.matches ? 'dark' : 'light') : state.settings.theme;

function applyTheme(animate = false) {
  const root = document.documentElement;
  if (animate) {
    root.classList.add('theme-anim');
    clearTimeout(applyTheme.t);
    applyTheme.t = setTimeout(() => root.classList.remove('theme-anim'), 450);
  }
  const t = resolvedTheme();
  root.dataset.theme = t;
  $('meta[name="theme-color"]')?.setAttribute('content', t === 'dark' ? '#121214' : '#f6f6f3');
  const btn = $('#theme-toggle');
  if (btn) {
    btn.innerHTML = icon(t === 'dark' ? 'sun' : 'moon');
    btn.setAttribute('aria-label', t === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
  }
}
media.addEventListener?.('change', () => state.settings.theme === 'system' && applyTheme(true));

/* =================================================================== pages */

const TITLES = { wallets: 'Wallets', expenses: 'Expenses', analysis: 'Analysis' };

function render() {
  const tab = state.ui.tab;
  $('#page-title').textContent = TITLES[tab];
  $$('.tab').forEach((b) => {
    const on = b.dataset.tab === tab;
    b.classList.toggle('is-active', on);
    b.setAttribute('aria-current', on ? 'page' : 'false');
  });
  document.body.dataset.page = tab;

  const view = $('#view');
  view.innerHTML = tab === 'wallets' ? walletsPage() : tab === 'expenses' ? expensesPage() : analysisPage();
  animateBars(view);
  if (tab === 'analysis') {
    const daily = $('#daily-chart');
    if (daily) bindDailyChart(daily);
  }
  // Keep any open "live" sheet (e.g. wallet details) in sync.
  sheets.forEach((s) => s.refresh?.());
}

function emptyState(emoji, title, text, action = '') {
  return `<div class="empty"><div class="empty-art" aria-hidden="true">${emoji}</div><h2>${title}</h2><p>${text}</p>${action}</div>`;
}

/* ---------------------------------------------------------------- wallets */

function walletCard(w) {
  const s = stats(w);
  const other = otherCurrency(w.budgetCurrency);
  const remB = w.budgetCurrency === 'SAR' ? s.remainingSAR : s.remainingJPY;
  const remO = other === 'SAR' ? s.remainingSAR : s.remainingJPY;
  const spentO = w.spendCurrency === w.budgetCurrency ? (other === 'SAR' ? s.spentSAR : s.spentJPY) : s.spentBudget;
  const spentOCur = w.spendCurrency === w.budgetCurrency ? other : w.budgetCurrency;
  let badge = '';
  if (s.over) badge = `<span class="badge badge-danger">${icon('alert')}Over budget by ${money(-s.remainingBudget, w.budgetCurrency)}</span>`;
  else if (s.alert) badge = `<span class="badge badge-danger">${icon('alert')}Alert · ${pctText(s.pct)} used</span>`;

  return `<button class="card wallet-card status-${s.status}" data-open-wallet="${w.id}" style="--c:${w.color}">
    <div class="wc-top">
      <span class="wc-name"><i class="dot"></i>${esc(w.name)}</span>
      <span class="wc-pct">${pctText(s.pct)}</span>
    </div>
    ${bar(`w-${w.id}`, s.pct)}
    <div class="wc-grid">
      <div><span class="lbl">Spent</span><b>${money(s.spentSpend, w.spendCurrency)}</b><small>${money(spentO, spentOCur)}</small></div>
      <div class="ta-r"><span class="lbl">Remaining</span><b class="${remB < 0 ? 'neg' : ''}">${money(remB, w.budgetCurrency)}</b><small>${money(remO, other)}</small></div>
    </div>
    <div class="wc-foot"><span>Budget ${money(w.budget, w.budgetCurrency)}</span>${badge}</div>
  </button>`;
}

function walletsPage() {
  if (!state.wallets.length) {
    return emptyState(
      '👛',
      'No wallets yet',
      'Create a wallet for each kind of spending — Food, Shopping, Transport… Set the budget in riyals and spend in yen.',
      `<button class="btn btn-primary" data-action="new-wallet">${icon('plus')}Create your first wallet</button>`,
    );
  }
  const t = totals(state.wallets, state.expenses, state.settings);
  const alerts = state.wallets.filter((w) => stats(w).alert).length;
  return `<section class="summary card">
      <div class="summary-row">
        <div><span class="lbl">Total remaining</span><b class="big ${t.remainingSAR < 0 ? 'neg' : ''}">${money(t.remainingSAR, 'SAR')}</b><small>${money(t.remainingJPY, 'JPY')}</small></div>
        <div class="ta-r"><span class="lbl">Spent</span><b>${pctText(t.pct)}</b><small>of ${money(t.budgetSAR, 'SAR')}</small></div>
      </div>
      ${bar('total-home', t.pct, t.pct >= state.settings.threshold ? 'is-danger' : '')}
      <p class="muted tiny rate-line">1 SAR = ${state.settings.rate} JPY${alerts ? ` · <span class="danger-text">${alerts} wallet${alerts > 1 ? 's' : ''} need${alerts > 1 ? '' : 's'} attention</span>` : ''}</p>
    </section>
    <section class="wallet-list">${state.wallets.map(walletCard).join('')}</section>`;
}

/* --------------------------------------------------------------- expenses */

function sortedExpenses(list) {
  return [...list].sort((a, b) => (a.date === b.date ? b.createdAt - a.createdAt : a.date < b.date ? 1 : -1));
}

/** Expenses grouped by day (newest first) with a per-day total. */
function expenseGroups(list) {
  const groups = [];
  for (const e of sortedExpenses(list)) {
    let g = groups[groups.length - 1];
    if (!g || g.date !== e.date) groups.push((g = { date: e.date, items: [], totalJPY: 0 }));
    g.items.push(e);
    g.totalJPY += convert(e.amount, e.currency, 'JPY', state.settings.rate);
  }
  return groups
    .map(
      (g) => `<section class="day-group">
        <h3 class="day-head"><span>${dayLabel(g.date)}</span><span>${money(g.totalJPY, 'JPY')}</span></h3>
        <div class="card list">${g.items.map(expenseRow).join('')}</div>
      </section>`,
    )
    .join('');
}

function expenseRow(e) {
  const w = walletById(e.walletId);
  const alt = otherCurrency(e.currency);
  return `<button class="row" data-edit-expense="${e.id}" style="--c:${w.color}">
    <i class="dot"></i>
    <span class="row-main"><b>${esc(e.note) || esc(w.name)}</b><small>${esc(w.name)}</small></span>
    <span class="row-amt"><b>${money(e.amount, e.currency)}</b><small>${money(convert(e.amount, e.currency, alt, state.settings.rate), alt)}</small></span>
  </button>`;
}

function expensesPage() {
  if (!state.wallets.length) {
    return emptyState(
      '🧾',
      'Create a wallet first',
      'Expenses are taken from a wallet. Add one (e.g. Food) and then log your yen spending here.',
      `<button class="btn btn-primary" data-action="new-wallet">${icon('plus')}Create a wallet</button>`,
    );
  }
  const f = state.ui.filterWalletId;
  const list = f ? state.expenses.filter((e) => e.walletId === f) : state.expenses;
  const chips = `<div class="chips" role="tablist" aria-label="Filter by wallet">
      <button class="chip ${!f ? 'is-on' : ''}" data-filter="">All</button>
      ${state.wallets.map((w) => `<button class="chip ${f === w.id ? 'is-on' : ''}" data-filter="${w.id}" style="--c:${w.color}"><i class="dot"></i>${esc(w.name)}</button>`).join('')}
    </div>`;
  if (!list.length) {
    return (
      chips +
      emptyState(
        '🍜',
        f ? 'No expenses in this wallet' : 'No expenses yet',
        f ? 'Nothing spent from this wallet so far.' : 'Tap the + button to log your first purchase in yen.',
      )
    );
  }
  const totalJPY = list.reduce((s, e) => s + convert(e.amount, e.currency, 'JPY', state.settings.rate), 0);
  return `${chips}<p class="muted tiny list-meta">${list.length} expense${list.length > 1 ? 's' : ''} · ${money(totalJPY, 'JPY')} · ${money(totalJPY / state.settings.rate, 'SAR')}</p>${expenseGroups(list)}`;
}

/* --------------------------------------------------------------- analysis */

function stat(label, sar, jpy, cls = '') {
  return `<div class="stat ${cls}"><span class="lbl">${label}</span><b>${money(sar, 'SAR')}</b><small>${money(jpy, 'JPY')}</small></div>`;
}

/** Inner width available to a chart inside a card on the current screen. */
function chartWidth() {
  const w = $('#view')?.clientWidth || 360;
  return Math.max(260, Math.min(640, w) - 32 - 32 + 8);
}

function analysisPage() {
  if (!state.wallets.length) {
    return emptyState('📊', 'Nothing to analyse yet', 'Create wallets and add expenses to see your spending breakdown.',
      `<button class="btn btn-primary" data-action="new-wallet">${icon('plus')}Create a wallet</button>`);
  }
  const today = todayISO();
  const t = tripStats(state.wallets, state.expenses, state.settings, today);
  const ws = state.wallets.map((w) => ({ w, s: stats(w) }));

  // Pace section.
  let pace = `<div class="stat-grid">
      <div class="stat"><span class="lbl">Avg per day</span><b>${money(t.avgDailySAR, 'SAR')}</b><small>${money(t.avgDailyJPY, 'JPY')} · ${t.elapsedDays} day${t.elapsedDays === 1 ? '' : 's'}</small></div>`;
  if (t.daysLeft != null) {
    pace += `<div class="stat"><span class="lbl">Days left</span><b>${t.daysLeft}</b><small>${t.phase === 'after' ? 'Trip has ended' : t.phase === 'before' ? 'Trip not started yet' : 'including today'}</small></div>
      <div class="stat span-2 accent"><span class="lbl">Suggested daily allowance</span><b>${t.daysLeft ? money(t.dailyAllowanceSAR, 'SAR') : '—'}</b><small>${t.daysLeft ? `${money(t.dailyAllowanceJPY, 'JPY')} per day for the rest of the trip` : 'No days left in the trip'}</small></div>`;
  }
  pace += '</div>';
  if (t.daysLeft == null) {
    pace += `<p class="hint">Set your trip dates in <button class="link" data-action="settings">Settings</button> to see days left and a suggested daily allowance.</p>`;
  }

  // Spending by wallet, biggest first (colour stays with the wallet).
  const rows = ws
    .map(({ w, s }) => ({ name: w.name, color: w.color, sar: s.spentSAR, jpy: s.spentJPY }))
    .sort((a, b) => b.sar - a.sar);
  const hasSpend = rows.some((r) => r.sar > 0);

  const series = dailySeries(state.wallets, state.expenses, state.settings, today);

  // Summary.
  const top = rows[0];
  const counts = { ok: 0, alert: 0, over: 0 };
  ws.forEach(({ s }) => counts[s.status]++);
  let paceMsg = '';
  if (t.tripElapsedPct != null && t.phase !== 'before') {
    const diff = t.pct - t.tripElapsedPct;
    paceMsg = `<li>${icon(diff > 5 ? 'alert' : 'check')}<span>You've used <b>${pctText(t.pct)}</b> of your budget with <b>${pctText(t.tripElapsedPct)}</b> of the trip done — ${diff > 5 ? '<b class="danger-text">spending faster than planned</b>' : '<b class="ok-text">on track</b>'}.</span></li>`;
  }

  return `<section class="card section">
      <h2 class="section-title">Overview</h2>
      <div class="stat-grid three">
        ${stat('Budget', t.budgetSAR, t.budgetJPY)}
        ${stat('Spent', t.spentSAR, t.spentJPY)}
        ${stat('Remaining', t.remainingSAR, t.remainingJPY, t.remainingSAR < 0 ? 'is-neg' : '')}
      </div>
      ${bar('total-analysis', t.pct, t.pct >= state.settings.threshold ? 'is-danger' : '')}
      <p class="muted tiny">${pctText(t.pct)} of total budget spent</p>
    </section>

    <section class="card section"><h2 class="section-title">Daily pace</h2>${pace}</section>

    <section class="card section">
      <h2 class="section-title">Spending by wallet</h2>
      ${hasSpend ? walletBars(rows) : '<p class="muted">No spending yet.</p>'}
    </section>

    <section class="card section" id="daily-chart">
      <h2 class="section-title">Spending per day</h2>
      ${series.length && series.some((d) => d.sar > 0) ? `${dailyBars(series, state.settings.rate, today, chartWidth())}<p class="muted tiny">Tap a bar for details.</p>` : '<p class="muted">No spending yet.</p>'}
    </section>

    <section class="card section">
      <h2 class="section-title">Summary</h2>
      <ul class="summary-list">
        ${hasSpend ? `<li>${icon('chart')}<span>Highest spending: <b>${esc(top.name)}</b> — ${money(top.jpy, 'JPY')} (${money(top.sar, 'SAR')})</span></li>` : ''}
        <li>${icon('wallet')}<span><b>${counts.ok}</b> on track · <b class="${counts.alert ? 'danger-text' : ''}">${counts.alert}</b> near limit · <b class="${counts.over ? 'danger-text' : ''}">${counts.over}</b> over budget</span></li>
        ${paceMsg}
        <li>${icon('list')}<span><b>${state.expenses.length}</b> expense${state.expenses.length === 1 ? '' : 's'} logged</span></li>
      </ul>
    </section>`;
}

/* ================================================================== sheets */

/**
 * Bottom-sheet modals. Each open sheet adds a history entry so the phone's
 * back button / gesture closes the top sheet instead of leaving the app.
 */
const sheets = [];

function openSheet({ title, body, className = '', onMount, refresh }) {
  const el = document.createElement('div');
  el.className = 'sheet-wrap';
  el.innerHTML = `<div class="sheet-backdrop" data-close></div>
    <div class="sheet ${className}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="sheet-grip" aria-hidden="true"></div>
      <header class="sheet-head"><h2>${esc(title)}</h2><button class="icon-btn" data-close aria-label="Close">${icon('close')}</button></header>
      <div class="sheet-body">${body}</div>
    </div>`;
  document.body.appendChild(el);
  const sheet = { el, refresh: refresh ? () => refresh(sheet) : null, prevFocus: document.activeElement };
  sheets.push(sheet);
  history.pushState({ depth: sheets.length }, '');
  document.body.classList.add('has-sheet');
  requestAnimationFrame(() => el.classList.add('open'));
  $$('[data-close]', el).forEach((b) => b.addEventListener('click', () => closeSheets(1)));
  onMount?.(el, sheet);
  return sheet;
}

/** Close the top `n` sheets (goes back in history; popstate does the work). */
function closeSheets(n = 1) {
  n = Math.min(n, sheets.length);
  if (n > 0) history.go(-n);
}

function removeSheetsTo(depth) {
  while (sheets.length > depth) {
    const s = sheets.pop();
    s.el.classList.remove('open');
    s.el.classList.add('closing');
    setTimeout(() => s.el.remove(), 250);
    s.prevFocus?.focus?.({ preventScroll: true });
  }
  if (!sheets.length) document.body.classList.remove('has-sheet');
}

window.addEventListener('popstate', (e) => removeSheetsTo(e.state?.depth ?? 0));

/** Promise-based confirmation dialog. */
function confirmSheet({ title, message, confirmLabel = 'Confirm', danger = true }) {
  return new Promise((resolve) => {
    let answer = false;
    openSheet({
      title,
      className: 'sheet-confirm',
      body: `<p class="confirm-msg">${message}</p>
        <div class="btn-row">
          <button class="btn btn-ghost" data-close>Cancel</button>
          <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-confirm>${confirmLabel}</button>
        </div>`,
      onMount(el) {
        $('[data-confirm]', el).addEventListener('click', () => {
          answer = true;
          closeSheets(1);
        });
        // Resolve once the sheet has actually closed (Cancel, backdrop, back
        // button or Confirm), so callers see an accurate sheet stack.
        const obs = new MutationObserver(() => {
          if (!el.classList.contains('closing')) return;
          obs.disconnect();
          resolve(answer);
        });
        obs.observe(el, { attributes: true });
        setTimeout(() => $('[data-confirm]', el).focus(), 50);
      },
    });
  });
}

/* ------------------------------------------------------------- form utils */

function setError(form, name, msg) {
  const field = $(`[data-field="${name}"]`, form);
  if (!field) return;
  field.classList.toggle('has-error', !!msg);
  const out = $('.err', field);
  if (out) out.textContent = msg || '';
}

const segmented = (name, options, value) =>
  `<div class="seg" role="radiogroup">${options
    .map(
      ([v, label]) =>
        `<label><input type="radio" name="${name}" value="${v}" ${v === value ? 'checked' : ''}><span>${label}</span></label>`,
    )
    .join('')}</div>`;

/* ------------------------------------------------------------ wallet form */

function openWalletForm(wallet = null) {
  const w = wallet || {
    name: '',
    budget: '',
    budgetCurrency: 'SAR',
    spendCurrency: 'JPY',
    color: nextWalletColor(state.wallets),
  };
  const ccy = CURRENCIES.map((c) => [c, c]);
  openSheet({
    title: wallet ? 'Edit wallet' : 'New wallet',
    body: `<form class="form" novalidate>
      <div class="field" data-field="name">
        <label for="w-name">Name</label>
        <input id="w-name" name="name" maxlength="40" placeholder="e.g. Food, Shopping, Transport" value="${esc(w.name)}" autocomplete="off" enterkeyhint="next">
        <p class="err"></p>
      </div>
      <div class="field" data-field="budget">
        <label for="w-budget">Budget</label>
        <div class="input-affix"><input id="w-budget" name="budget" inputmode="decimal" placeholder="0" value="${w.budget}" autocomplete="off"><span class="affix" data-budget-ccy>${w.budgetCurrency}</span></div>
        <p class="err"></p>
        <p class="help" data-budget-preview></p>
      </div>
      <div class="field-row">
        <div class="field"><label>Budget currency</label>${segmented('budgetCurrency', ccy, w.budgetCurrency)}</div>
        <div class="field"><label>Spending currency</label>${segmented('spendCurrency', ccy, w.spendCurrency)}</div>
      </div>
      <div class="field"><label>Colour</label>
        <div class="swatches">${WALLET_COLORS.map((c) => `<label class="swatch" style="--c:${c}"><input type="radio" name="color" value="${c}" ${c === w.color ? 'checked' : ''} aria-label="Colour ${c}"><span></span></label>`).join('')}</div>
      </div>
      <button class="btn btn-primary btn-block" type="submit">${wallet ? 'Save changes' : 'Create wallet'}</button>
    </form>`,
    onMount(el) {
      const form = $('form', el);
      const preview = () => {
        const bc = form.budgetCurrency.value;
        $('[data-budget-ccy]', form).textContent = bc;
        const p = parseAmount(form.budget.value);
        const o = otherCurrency(bc);
        $('[data-budget-preview]', form).textContent = p.ok
          ? `≈ ${money(convert(p.value, bc, o, state.settings.rate), o)} at 1 SAR = ${state.settings.rate} JPY`
          : '';
      };
      form.addEventListener('input', preview);
      preview();
      if (!wallet) setTimeout(() => form.name.focus(), 80);

      form.addEventListener('submit', (ev) => {
        ev.preventDefault();
        const name = form.name.value.trim();
        const amt = parseAmount(form.budget.value);
        setError(form, 'name', name ? '' : 'Give the wallet a name');
        const dup = state.wallets.some((x) => x.id !== wallet?.id && x.name.toLowerCase() === name.toLowerCase());
        if (name && dup) setError(form, 'name', 'You already have a wallet with this name');
        setError(form, 'budget', amt.ok ? '' : amt.error);
        if (!name || dup || !amt.ok) {
          $('.has-error input', form)?.focus();
          return;
        }
        const data = {
          name,
          budget: roundMoney(amt.value, form.budgetCurrency.value),
          budgetCurrency: form.budgetCurrency.value,
          spendCurrency: form.spendCurrency.value,
          color: form.color.value,
        };
        commit((s) => {
          if (wallet) Object.assign(walletById(wallet.id), data);
          else s.wallets.push({ id: uid(), createdAt: Date.now(), ...data });
        });
        closeSheets(1);
        toast(wallet ? 'Wallet updated' : `Wallet “${name}” created`);
      });
    },
  });
}

/* ---------------------------------------------------------- wallet detail */

function openWalletDetail(id) {
  const build = () => {
    const w = walletById(id);
    if (!w) return null;
    const s = stats(w);
    const exps = state.expenses.filter((e) => e.walletId === id);
    const other = otherCurrency(w.budgetCurrency);
    const remO = other === 'SAR' ? s.remainingSAR : s.remainingJPY;
    return `<div class="detail status-${s.status}" style="--c:${w.color}">
        <div class="detail-top">
          <div><span class="lbl">Remaining</span><b class="big ${s.remainingBudget < 0 ? 'neg' : ''}">${money(s.remainingBudget, w.budgetCurrency)}</b><small>${money(remO, other)}</small></div>
          <div class="ta-r"><span class="lbl">Used</span><b class="big">${pctText(s.pct)}</b><small>alert at ${state.settings.threshold}%</small></div>
        </div>
        ${bar(`d-${w.id}`, s.pct)}
        <div class="detail-meta"><span>Spent ${money(s.spentSpend, w.spendCurrency)} · ${money(s.spentBudget, w.budgetCurrency)}</span><span>Budget ${money(w.budget, w.budgetCurrency)}</span></div>
        ${s.over ? `<p class="badge badge-danger">${icon('alert')}Over budget by ${money(-s.remainingBudget, w.budgetCurrency)}</p>` : s.alert ? `<p class="badge badge-danger">${icon('alert')}You've used ${pctText(s.pct)} of this budget</p>` : ''}
        <div class="btn-row three">
          <button class="btn btn-primary" data-act="add">${icon('plus')}Expense</button>
          <button class="btn btn-ghost" data-act="edit">${icon('edit')}Edit</button>
          <button class="btn btn-ghost danger-text" data-act="delete">${icon('trash')}Delete</button>
        </div>
      </div>
      <h3 class="sub-title">Expenses (${exps.length})</h3>
      ${exps.length ? expenseGroups(exps) : '<p class="muted center pad">No expenses in this wallet yet.</p>'}`;
  };
  const bind = (sheet) => {
    const el = sheet.el;
    $('[data-act="add"]', el)?.addEventListener('click', () => openExpenseForm(null, id));
    $('[data-act="edit"]', el)?.addEventListener('click', () => openWalletForm(walletById(id)));
    $('[data-act="delete"]', el)?.addEventListener('click', () => deleteWallet(id));
    $$('[data-edit-expense]', el).forEach((b) =>
      b.addEventListener('click', () => openExpenseForm(state.expenses.find((e) => e.id === b.dataset.editExpense))),
    );
    animateBars(el);
  };
  const w = walletById(id);
  openSheet({
    title: w.name,
    className: 'sheet-tall',
    body: build(),
    onMount: (_el, sheet) => bind(sheet),
    refresh(sheet) {
      const html = build();
      if (html == null) return; // wallet deleted; closing is handled by the delete flow
      $('.sheet-head h2', sheet.el).textContent = walletById(id).name;
      $('.sheet-body', sheet.el).innerHTML = html;
      bind(sheet);
    },
  });
}

async function deleteWallet(id) {
  const w = walletById(id);
  const n = state.expenses.filter((e) => e.walletId === id).length;
  const ok = await confirmSheet({
    title: 'Delete wallet?',
    message: `“<b>${esc(w.name)}</b>” ${n ? `and its <b>${n} expense${n > 1 ? 's' : ''}</b> ` : ''}will be permanently deleted. This can’t be undone.`,
    confirmLabel: 'Delete wallet',
  });
  if (!ok) return;
  commit((s) => {
    s.wallets = s.wallets.filter((x) => x.id !== id);
    s.expenses = s.expenses.filter((e) => e.walletId !== id);
    if (s.ui.filterWalletId === id) s.ui.filterWalletId = null;
    if (s.ui.lastWalletId === id) s.ui.lastWalletId = null;
  });
  closeSheets(sheets.length); // the wallet detail (and anything under it)
  toast('Wallet deleted');
}

/* ----------------------------------------------------------- expense form */

function openExpenseForm(expense = null, presetWalletId = null) {
  if (!state.wallets.length) {
    toast('Create a wallet first');
    openWalletForm();
    return;
  }
  const initialWallet =
    expense?.walletId ||
    presetWalletId ||
    (walletById(state.ui.filterWalletId) && state.ui.filterWalletId) ||
    (walletById(state.ui.lastWalletId) && state.ui.lastWalletId) ||
    state.wallets[0].id;
  let currency = expense?.currency || walletById(initialWallet).spendCurrency;

  openSheet({
    title: expense ? 'Edit expense' : 'Add expense',
    body: `<form class="form" novalidate>
      <div class="field" data-field="amount">
        <label for="e-amount">Amount</label>
        <div class="input-affix big-input"><input id="e-amount" name="amount" inputmode="decimal" placeholder="0" value="${expense ? expense.amount : ''}" autocomplete="off" enterkeyhint="done"><span class="affix" data-ccy>${currency}</span></div>
        <p class="err"></p>
        <p class="help" data-preview></p>
      </div>
      <div class="field" data-field="wallet">
        <label>From wallet</label>
        <div class="chips wrap">${state.wallets
          .map(
            (w) =>
              `<label class="chip pick" style="--c:${w.color}"><input type="radio" name="wallet" value="${w.id}" ${w.id === initialWallet ? 'checked' : ''}><i class="dot"></i>${esc(w.name)}</label>`,
          )
          .join('')}</div>
        <p class="err"></p>
      </div>
      <div class="field-row">
        <div class="field" data-field="date"><label for="e-date">Date</label><input id="e-date" type="date" name="date" value="${expense?.date || todayISO()}" required><p class="err"></p></div>
      </div>
      <div class="field"><label for="e-note">Note <span class="muted">(optional)</span></label><input id="e-note" name="note" maxlength="120" placeholder="e.g. Ramen in Shinjuku" value="${esc(expense?.note || '')}" autocomplete="off"></div>
      <button class="btn btn-primary btn-block" type="submit">${expense ? 'Save changes' : 'Add expense'}</button>
      ${expense ? `<button class="btn btn-ghost btn-block danger-text" type="button" data-delete>${icon('trash')}Delete expense</button>` : ''}
    </form>`,
    onMount(el) {
      const form = $('form', el);
      const preview = () => {
        const w = walletById(form.wallet.value);
        $('[data-ccy]', form).textContent = currency;
        const p = parseAmount(form.amount.value);
        const out = $('[data-preview]', form);
        if (!w) return (out.textContent = '');
        // Show the wallet balance before/after this expense.
        const s = stats(w);
        const own = expense && expense.walletId === w.id ? convert(expense.amount, expense.currency, w.budgetCurrency, state.settings.rate) : 0;
        const before = s.remainingBudget + own;
        const cost = p.ok ? convert(p.value, currency, w.budgetCurrency, state.settings.rate) : 0;
        const after = before - cost;
        out.innerHTML = p.ok
          ? `≈ <b>${money(cost, w.budgetCurrency)}</b> · ${esc(w.name)} left after: <b class="${after < 0 ? 'danger-text' : ''}">${money(after, w.budgetCurrency)}</b>`
          : `${esc(w.name)} has ${money(before, w.budgetCurrency)} left`;
      };
      form.addEventListener('change', (e) => {
        if (e.target.name === 'wallet') currency = walletById(form.wallet.value).spendCurrency;
        preview();
      });
      form.addEventListener('input', preview);
      preview();
      if (!expense) setTimeout(() => form.amount.focus(), 80);

      form.addEventListener('submit', (ev) => {
        ev.preventDefault();
        const amt = parseAmount(form.amount.value);
        const walletId = form.wallet.value;
        const date = form.date.value;
        setError(form, 'amount', amt.ok ? '' : amt.error);
        setError(form, 'wallet', walletById(walletId) ? '' : 'Choose a wallet');
        setError(form, 'date', isValidISODate(date) ? '' : 'Pick a valid date');
        if (!amt.ok || !walletById(walletId) || !isValidISODate(date)) return;
        const data = { walletId, amount: roundMoney(amt.value, currency), currency, date, note: form.note.value.trim() };
        commit((s) => {
          if (expense) Object.assign(s.expenses.find((e) => e.id === expense.id), data);
          else s.expenses.push({ id: uid(), createdAt: Date.now(), ...data });
          s.ui.lastWalletId = walletId;
        });
        closeSheets(1);
        const w = walletById(walletId);
        const st = stats(w);
        toast(
          `${expense ? 'Updated' : 'Added'} ${money(data.amount, currency)} · ${w.name}: ${money(st.remainingBudget, w.budgetCurrency)} left`,
          st.alert ? 'error' : '',
        );
      });

      $('[data-delete]', form)?.addEventListener('click', async () => {
        const ok = await confirmSheet({
          title: 'Delete expense?',
          message: `${money(expense.amount, expense.currency)} will be refunded to “${esc(walletById(expense.walletId).name)}”.`,
          confirmLabel: 'Delete',
        });
        if (!ok) return;
        commit((s) => (s.expenses = s.expenses.filter((e) => e.id !== expense.id)));
        closeSheets(1); // the expense form (confirm already closed)
        toast('Expense deleted');
      });
    },
  });
}

/* ---------------------------------------------------------------- settings */

function openSettings() {
  const st = state.settings;
  openSheet({
    title: 'Settings',
    className: 'sheet-tall',
    body: `<form class="form" novalidate>
      <div class="field" data-field="rate">
        <label for="s-rate">Exchange rate</label>
        <div class="input-affix pre"><span class="affix">1 SAR =</span><input id="s-rate" name="rate" inputmode="decimal" value="${st.rate}" autocomplete="off"><span class="affix">JPY</span></div>
        <p class="err"></p>
        <p class="help" data-rate-help></p>
      </div>
      <div class="field">
        <label for="s-thr">Red alert at <b data-thr>${st.threshold}%</b> of budget</label>
        <input id="s-thr" type="range" name="threshold" min="50" max="100" step="5" value="${st.threshold}">
      </div>
      <div class="field-row" data-field="trip">
        <div class="field"><label for="s-start">Trip start</label><input id="s-start" type="date" name="tripStart" value="${st.tripStart}"></div>
        <div class="field"><label for="s-end">Trip end</label><input id="s-end" type="date" name="tripEnd" value="${st.tripEnd}"></div>
        <p class="err span-2"></p>
      </div>
      <div class="field"><label>Theme</label>${segmented('theme', [['system', 'System'], ['light', 'Light'], ['dark', 'Dark']], st.theme)}</div>
    </form>
    <h3 class="sub-title">Backup</h3>
    <div class="card list">
      <button class="row" data-act="export">${icon('download')}<span class="row-main"><b>Export data</b><small>Save a JSON backup file</small></span></button>
      <label class="row" for="import-file">${icon('upload')}<span class="row-main"><b>Import data</b><small>Restore from a JSON backup</small></span></label>
      <input id="import-file" type="file" accept="application/json,.json" hidden>
      <button class="row danger-text" data-act="reset">${icon('reset')}<span class="row-main"><b>Reset all data</b><small>Delete every wallet, expense and setting</small></span></button>
    </div>
    <p class="muted tiny center pad">Your data is stored only on this device and saved automatically.</p>`,
    onMount(el) {
      const form = $('form', el);
      const rateHelp = () => {
        const r = parseAmount(form.rate.value);
        $('[data-rate-help]', form).textContent = r.ok ? `1,000 JPY ≈ ${money(1000 / r.value, 'SAR')} · 100 SAR = ${money(100 * r.value, 'JPY')}` : '';
      };
      rateHelp();

      form.rate.addEventListener('input', () => {
        const r = parseAmount(form.rate.value);
        setError(form, 'rate', r.ok ? '' : r.error);
        rateHelp();
        if (r.ok) commit((s) => (s.settings.rate = r.value));
      });
      form.threshold.addEventListener('input', () => {
        $('[data-thr]', form).textContent = `${form.threshold.value}%`;
        commit((s) => (s.settings.threshold = Number(form.threshold.value)));
      });
      const tripChange = () => {
        const a = form.tripStart.value;
        const b = form.tripEnd.value;
        const bad = a && b && b < a;
        setError(form, 'trip', bad ? 'Trip end must be on or after the start date' : '');
        if (!bad) commit((s) => Object.assign(s.settings, { tripStart: a, tripEnd: b }));
      };
      form.tripStart.addEventListener('change', tripChange);
      form.tripEnd.addEventListener('change', tripChange);
      $$('input[name="theme"]', form).forEach((r) =>
        r.addEventListener('change', () => {
          commit((s) => (s.settings.theme = r.value));
          applyTheme(true);
        }),
      );
      form.addEventListener('submit', (e) => e.preventDefault());

      $('[data-act="export"]', el).addEventListener('click', exportData);
      $('#import-file', el).addEventListener('change', (e) => importData(e.target));
      $('[data-act="reset"]', el).addEventListener('click', async () => {
        const ok = await confirmSheet({
          title: 'Reset all data?',
          message: 'All wallets, expenses and settings will be deleted from this device. Consider exporting a backup first.',
          confirmLabel: 'Reset everything',
        });
        if (!ok) return;
        commit((s) => Object.assign(s, defaultState()));
        applyTheme(true);
        closeSheets(sheets.length);
        toast('All data has been reset');
      });
    },
  });
}

function exportData() {
  try {
    const blob = new Blob([JSON.stringify(exportPayload(state), null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `budget-backup-${todayISO()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast('Backup exported');
  } catch (err) {
    toast('Export failed', 'error');
  }
}

async function importData(input) {
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  let next;
  try {
    next = normalizeState(JSON.parse(await file.text()));
  } catch (err) {
    toast(err instanceof SyntaxError ? 'That file is not valid JSON' : err.message, 'error');
    return;
  }
  const ok = await confirmSheet({
    title: 'Import backup?',
    message: `This replaces your current data with <b>${next.wallets.length} wallet${next.wallets.length === 1 ? '' : 's'}</b> and <b>${next.expenses.length} expense${next.expenses.length === 1 ? '' : 's'}</b> from the file.`,
    confirmLabel: 'Replace my data',
    danger: false,
  });
  if (!ok) return;
  commit((s) => Object.assign(s, next, { ui: { ...next.ui, tab: s.ui.tab } }));
  applyTheme(true);
  closeSheets(sheets.length);
  toast('Backup imported');
}

/* =================================================================== toast */

function toast(msg, kind = '') {
  const el = $('#toast');
  el.textContent = msg;
  el.className = `toast show ${kind}`;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (el.className = 'toast'), 2800);
}

/* ================================================================== events */

document.addEventListener('click', (e) => {
  const t = e.target.closest('.tab[data-tab],[data-open-wallet],[data-edit-expense],[data-filter],[data-action]');
  if (!t || t.closest('.sheet')) {
    // Clicks inside sheets are handled by the sheet's own listeners,
    // except generic actions (e.g. the "Settings" link) handled below.
    if (!t?.dataset.action) return;
  }
  if (t.dataset.tab) {
    commit((s) => (s.ui.tab = t.dataset.tab));
    window.scrollTo({ top: 0 });
  } else if (t.dataset.openWallet) openWalletDetail(t.dataset.openWallet);
  else if (t.dataset.editExpense) openExpenseForm(state.expenses.find((x) => x.id === t.dataset.editExpense));
  else if (t.dataset.filter !== undefined) commit((s) => (s.ui.filterWalletId = t.dataset.filter || null));
  else if (t.dataset.action === 'new-wallet') openWalletForm();
  else if (t.dataset.action === 'new-expense') openExpenseForm();
  else if (t.dataset.action === 'settings') openSettings();
});

$('#theme-toggle').addEventListener('click', () => {
  commit((s) => (s.settings.theme = resolvedTheme() === 'dark' ? 'light' : 'dark'));
  applyTheme(true);
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && sheets.length) closeSheets(1);
});

// Another tab changed the data (e.g. desktop + installed PWA open together).
window.addEventListener('storage', (e) => {
  if (e.key && e.key !== STORAGE_KEY) return;
  state = loadState();
  applyTheme();
  render();
});

/* ==================================================================== boot */

history.replaceState({ depth: 0 }, '');
applyTheme();
render();
document.documentElement.classList.add('ready');

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((err) => console.warn('SW registration failed', err));
  });
}

// Expose for debugging / automated tests.
window.__budget = { get state() { return state; } };
