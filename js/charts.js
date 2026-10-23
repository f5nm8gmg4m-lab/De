/**
 * charts.js — tiny dependency-free charts (HTML + inline SVG).
 * Kept deliberately small so the app stays fast and works offline.
 */
import { formatMoney } from './calc.js';

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/**
 * Horizontal bar list: spending by wallet. Each row is labelled directly
 * (name + value), so colour is never the only way to identify a wallet.
 * rows: [{ name, color, sar, jpy }]
 */
export function walletBars(rows) {
  const max = Math.max(...rows.map((r) => r.sar), 0);
  return `<ul class="hbars" role="list">${rows
    .map((r) => {
      const w = max > 0 ? (r.sar / max) * 100 : 0;
      return `<li class="hbar" title="${esc(r.name)}: ${formatMoney(r.jpy, 'JPY')} (${formatMoney(r.sar, 'SAR')})">
        <div class="hbar-head">
          <span class="hbar-name"><i class="dot" style="background:${r.color}"></i>${esc(r.name)}</span>
          <span class="hbar-val">${formatMoney(r.jpy, 'JPY')} <small>${formatMoney(r.sar, 'SAR')}</small></span>
        </div>
        <div class="hbar-track"><div class="hbar-fill" style="--w:${w.toFixed(2)}%;background:${r.color}"></div></div>
      </li>`;
    })
    .join('')}</ul>`;
}

/** Pick a "nice" axis maximum (1, 2, 2.5, 5 × 10^n). */
function niceMax(v) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

const shortDate = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

/**
 * Vertical bar chart of spending per day (SAR on the axis, JPY in the tooltip).
 * series: [{ date, sar }], rate for JPY equivalents.
 * Returns an HTML string; call `bindDailyChart` after inserting it for tooltips.
 */
export function dailyBars(series, rate, today, availWidth = 300) {
  const n = series.length;
  const padL = 44;
  const padR = 8;
  const gap = 6;
  // Fill the card when there are few days; scroll horizontally when many.
  const barW = Math.min(36, Math.max(18, (availWidth - padL - padR) / n - gap));
  const padT = 12;
  const plotH = 150;
  const padB = 26;
  const width = Math.max(availWidth, padL + padR + n * (barW + gap));
  const height = padT + plotH + padB;
  const max = niceMax(Math.max(...series.map((s) => s.sar), 0));
  const y = (v) => padT + plotH - (v / max) * plotH;

  // 3 recessive gridlines + labels.
  let grid = '';
  for (let i = 0; i <= 2; i++) {
    const v = (max / 2) * i;
    const gy = y(v);
    grid += `<line x1="${padL}" x2="${width - padR}" y1="${gy}" y2="${gy}" class="${i === 0 ? 'axis' : 'grid'}"/>`;
    grid += `<text x="${padL - 6}" y="${gy + 4}" text-anchor="end" class="tick">${v >= 1000 ? `${+(v / 1000).toFixed(1)}k` : +v.toFixed(0)}</text>`;
  }

  // Label every Nth day, counted back from the newest so labels never collide.
  const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor((width - padL) / 52))));
  let bars = '';
  series.forEach((s, i) => {
    const x = padL + gap / 2 + i * (barW + gap);
    const h = Math.max(0, plotH - (y(s.sar) - padT));
    const r = Math.min(4, h);
    const top = padT + plotH - h;
    // Bar with rounded top corners, anchored flat on the baseline.
    const path =
      h > 0
        ? `M${x},${padT + plotH} V${top + r} Q${x},${top} ${x + r},${top} H${x + barW - r} Q${x + barW},${top} ${x + barW},${top + r} V${padT + plotH} Z`
        : '';
    const label = `${shortDate(s.date)}: ${formatMoney(s.sar * rate, 'JPY')} (${formatMoney(s.sar, 'SAR')})`;
    bars += `<g class="dbar${s.date === today ? ' is-today' : ''}" data-tip="${esc(label)}" tabindex="0" role="img" aria-label="${esc(label)}">
      <rect x="${x - gap / 2}" y="${padT}" width="${barW + gap}" height="${plotH}" class="hit"/>
      ${path ? `<path d="${path}"/>` : ''}
    </g>`;
    if ((n - 1 - i) % every === 0) {
      bars += `<text x="${x + barW / 2}" y="${height - 8}" text-anchor="middle" class="tick">${shortDate(s.date)}</text>`;
    }
  });

  return `<div class="chart-scroll"><svg class="daily" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" aria-label="Spending per day in SAR">
    ${grid}${bars}
    <text x="4" y="${padT + 4}" class="tick unit">SAR</text>
  </svg></div><div class="chart-tip" role="status" aria-live="polite"></div>`;
}

/** Attach tap / hover / focus tooltips to a rendered daily chart. */
export function bindDailyChart(container) {
  const tip = container.querySelector('.chart-tip');
  const bars = container.querySelectorAll('.dbar');
  if (!tip) return;
  const show = (g) => {
    bars.forEach((b) => b.classList.toggle('is-active', b === g));
    tip.textContent = g.dataset.tip;
    tip.classList.add('show');
  };
  bars.forEach((g) => {
    g.addEventListener('pointerenter', () => show(g));
    g.addEventListener('click', () => show(g));
    g.addEventListener('focus', () => show(g));
  });
  // Start scrolled to the most recent days.
  const scroller = container.querySelector('.chart-scroll');
  if (scroller) scroller.scrollLeft = scroller.scrollWidth;
}
