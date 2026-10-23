// End-to-end test in a real (headless) phone-sized Chromium.
// Covers: wallet/expense CRUD, deduction & refund, red/over-budget state,
// rate changes, persistence across reloads, theme, backup, offline (PWA).
// Run with: npm run test:e2e   (screenshots are written to ./screenshots)
import { chromium, devices } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png' };

// Minimal static server (no extra dependencies).
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const file = path.join(ROOT, p);
  if (!file.startsWith(ROOT) || !fs.existsSync(file)) return res.writeHead(404).end('not found');
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, r));
const URL_ = `http://localhost:${server.address().port}/`;

const shots = path.join(ROOT, 'screenshots');
fs.mkdirSync(shots, { recursive: true });

const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
const context = await browser.newContext({ ...devices['Pixel 7'], colorScheme: 'light', acceptDownloads: true });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

let step = 0;
const ok = (msg) => console.log(`  ✓ ${++step}. ${msg}`);
const shot = (name) => page.screenshot({ path: path.join(shots, `${name}.png`) });
const card = (name) => page.locator('.wallet-card', { has: page.locator('.wc-name', { hasText: name }) });
const sheet = () => page.locator('.sheet-wrap.open').last();
const settle = () => page.waitForTimeout(400); // sheet/bar animations
const goTab = async (t) => { await page.click(`.tab[data-tab="${t}"]`); await settle(); };

async function addWallet(name, budget) {
  await page.click('.fab-corner');
  await sheet().locator('input[name="name"]').fill(name);
  await sheet().locator('input[name="budget"]').fill(String(budget));
  await sheet().locator('button[type="submit"]').click();
  await settle();
}
async function addExpense(amount, wallet, note = '') {
  await page.click('.fab-center');
  const s = sheet();
  await s.locator('input[name="amount"]').fill(String(amount));
  await s.locator('label.chip', { hasText: wallet }).click();
  if (note) await s.locator('input[name="note"]').fill(note);
  await s.locator('button[type="submit"]').click();
  await settle();
}
const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem('yen-wallet:v1')));

try {
  console.log(`Testing ${URL_}`);
  await page.goto(URL_);
  await page.waitForSelector('.empty');
  ok('Empty state shows on first launch');
  await shot('01-empty');

  // ---- validation
  await page.click('.fab-corner');
  await sheet().locator('button[type="submit"]').click();
  assert.match(await sheet().locator('[data-field="name"] .err').textContent(), /name/i);
  assert.match(await sheet().locator('[data-field="budget"] .err').textContent(), /amount/i);
  await sheet().locator('input[name="name"]').fill('Food');
  await sheet().locator('input[name="budget"]').fill('-50');
  await sheet().locator('button[type="submit"]').click();
  assert.match(await sheet().locator('[data-field="budget"] .err').textContent(), /numbers only|negative/i);
  await page.keyboard.press('Escape');
  await settle();
  assert.equal((await stored())?.wallets?.length ?? 0, 0);
  ok('Empty and negative wallet budgets are rejected');

  // ---- create wallets
  await addWallet('Food', 100);
  await addWallet('Shopping', 500);
  assert.equal(await page.locator('.wallet-card').count(), 2);
  assert.match(await card('Food').textContent(), /SAR 100\.00/);
  assert.match(await card('Food').textContent(), /¥4,000/); // remaining in JPY at 40
  ok('Wallets created (Food SAR 100 = ¥4,000, Shopping SAR 500)');

  // ---- add expenses + deduction
  await goTab('expenses');
  await page.click('.fab-center');
  await sheet().locator('input[name="amount"]').fill('0');
  await sheet().locator('button[type="submit"]').click();
  assert.match(await sheet().locator('[data-field="amount"] .err').textContent(), /more than 0/);
  await page.keyboard.press('Escape');
  await settle();
  ok('Zero expense amount is rejected');

  await addExpense(1000, 'Food', 'Ramen');
  await addExpense(2200, 'Food', 'Sushi');
  await addExpense(6000, 'Shopping', 'Uniqlo');
  assert.equal(await page.locator('.row[data-edit-expense]').count(), 3);
  assert.match(await page.locator('.day-head').first().textContent(), /Today/);
  await shot('03-expenses');
  await goTab('wallets');
  const foodText = await card('Food').textContent();
  assert.match(foodText, /80%/);
  assert.match(foodText, /¥3,200/); // spent
  assert.match(foodText, /SAR 20\.00/); // remaining SAR
  assert.match(foodText, /¥800/); // remaining JPY
  ok('Expenses deducted: Food spent ¥3,200 → 80%, remaining SAR 20.00 / ¥800');

  // ---- red state at 80 %
  assert.ok(await card('Food').evaluate((el) => el.classList.contains('status-alert')));
  assert.ok(await card('Shopping').evaluate((el) => el.classList.contains('status-ok')));
  const barColor = await card('Food').locator('.bar-fill').evaluate((el) => getComputedStyle(el).backgroundColor);
  assert.equal(barColor, 'rgb(208, 59, 59)');
  ok('Food card is red (incl. progress bar) at the 80% threshold; Shopping stays normal');
  await shot('02-wallets-alert');

  // ---- persistence across reload
  await page.reload();
  await page.waitForSelector('.wallet-card');
  assert.equal(await page.locator('.wallet-card').count(), 2);
  assert.ok(await card('Food').evaluate((el) => el.classList.contains('status-alert')));
  assert.equal((await stored()).expenses.length, 3);
  ok('After reload: wallets, expenses, balances and red state are restored');

  // ---- edit expense (refund difference)
  await card('Food').click();
  await settle();
  await sheet().locator('.row', { hasText: 'Sushi' }).click();
  await settle();
  await sheet().locator('input[name="amount"]').fill('1000');
  await sheet().locator('button[type="submit"]').click();
  await settle();
  await page.keyboard.press('Escape');
  await settle();
  assert.match(await card('Food').textContent(), /50%/);
  assert.ok(await card('Food').evaluate((el) => el.classList.contains('status-ok')));
  ok('Editing Sushi ¥2,200 → ¥1,000 refunds the difference (Food 50%, no longer red)');

  // ---- over budget
  await goTab('expenses');
  await addExpense(3000, 'Food', 'Wagyu');
  await goTab('wallets');
  assert.ok(await card('Food').evaluate((el) => el.classList.contains('status-over')));
  assert.match(await card('Food').textContent(), /Over budget by SAR 25\.00/);
  ok('Exceeding the budget shows "Over budget by SAR 25.00" in red');
  await shot('04-over-budget');

  // ---- delete expense (refund)
  await goTab('expenses');
  await page.locator('.row', { hasText: 'Wagyu' }).click();
  await settle();
  await sheet().locator('[data-delete]').click();
  await settle();
  await sheet().locator('[data-confirm]').click();
  await page.waitForTimeout(700);
  assert.equal(await page.locator('.sheet-wrap.open').count(), 0);
  assert.equal(await page.locator('.row', { hasText: 'Wagyu' }).count(), 0);
  await goTab('wallets');
  assert.match(await card('Food').textContent(), /50%/);
  ok('Deleting an expense (with confirmation) refunds it to the wallet');

  // ---- filter
  await goTab('expenses');
  await page.locator('.chip[data-filter]', { hasText: 'Shopping' }).click();
  await settle();
  assert.equal(await page.locator('.row[data-edit-expense]').count(), 1);
  await page.locator('.chip[data-filter=""]').click();
  await settle();
  ok('Filter by wallet works');

  // ---- settings: rate + threshold + trip dates
  await page.click('[data-action="settings"]');
  await settle();
  await sheet().locator('input[name="rate"]').fill('20');
  await sheet().locator('input[name="tripStart"]').fill('2026-10-20');
  await sheet().locator('input[name="tripStart"]').dispatchEvent('change');
  await sheet().locator('input[name="tripEnd"]').fill('2026-10-30');
  await sheet().locator('input[name="tripEnd"]').dispatchEvent('change');
  await shot('06-settings');
  await page.keyboard.press('Escape');
  await settle();
  await goTab('wallets');
  // Food ¥2,000 at 1 SAR = 20 JPY → SAR 100 of 100 = 100 %.
  assert.match(await card('Food').textContent(), /100%/);
  assert.ok(await card('Food').evaluate((el) => el.classList.contains('status-alert')));
  assert.match(await card('Shopping').textContent(), /SAR 200\.00/); // 500 - 6000/20
  ok('Changing the rate to 20 recalculates all wallets (Food now 100%)');

  await page.click('[data-action="settings"]');
  await settle();
  await sheet().locator('input[name="rate"]').fill('40');
  await sheet().locator('input[name="threshold"]').fill('50');
  await sheet().locator('input[name="threshold"]').dispatchEvent('input');
  await page.keyboard.press('Escape');
  await settle();
  assert.ok(await card('Food').evaluate((el) => el.classList.contains('status-alert'))); // 50 % >= 50 %
  ok('Threshold is adjustable (50% → Food at 50% turns red)');

  // ---- analysis
  await goTab('analysis');
  assert.match(await page.locator('#view').textContent(), /Highest spending: Shopping/);
  assert.match(await page.locator('#view').textContent(), /Suggested daily allowance/);
  assert.ok(await page.locator('svg.daily .dbar path').count() >= 1);
  assert.ok(await page.locator('.hbar').count() === 2);
  await page.locator('svg.daily .dbar').last().click();
  assert.match(await page.locator('.chart-tip').textContent(), /¥.*SAR/);
  ok('Analysis shows totals, pace, allowance, both charts (with tap tooltip) and summary');
  await shot('05-analysis');

  // ---- theme persists
  await page.click('#theme-toggle');
  await settle();
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark');
  await page.reload();
  await page.waitForSelector('.stat');
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark');
  assert.equal(await page.locator('.tab.is-active').getAttribute('data-tab'), 'analysis');
  ok('Dark mode and current tab are remembered after reload');
  await shot('07-analysis-dark');
  await goTab('wallets');
  await shot('08-wallets-dark');

  // ---- export / import
  await page.click('[data-action="settings"]');
  await settle();
  const [download] = await Promise.all([page.waitForEvent('download'), sheet().locator('[data-act="export"]').click()]);
  const backupPath = path.join(shots, 'backup.json');
  await download.saveAs(backupPath);
  const backup = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
  assert.equal(backup.wallets.length, 2);
  assert.equal(backup.expenses.length, 3);
  ok(`Export produced ${download.suggestedFilename()} with 2 wallets / 3 expenses`);

  // ---- delete wallet with confirmation (removes its expenses)
  await page.keyboard.press('Escape');
  await settle();
  await card('Food').click();
  await settle();
  await sheet().locator('[data-act="delete"]').click();
  await settle();
  await sheet().locator('[data-close]').filter({ hasText: 'Cancel' }).click();
  await settle();
  assert.equal(await page.locator('.wallet-card').count(), 2);
  await sheet().locator('[data-act="delete"]').click();
  await settle();
  await sheet().locator('[data-confirm]').click();
  await page.waitForTimeout(800);
  assert.equal(await page.locator('.wallet-card').count(), 1);
  assert.equal(await page.locator('.sheet-wrap.open').count(), 0);
  assert.equal((await stored()).expenses.length, 1);
  ok('Delete wallet: Cancel keeps it; Confirm removes it and its expenses');

  await page.click('[data-action="settings"]');
  await settle();
  await sheet().locator('#import-file').setInputFiles(backupPath);
  await settle();
  await sheet().locator('[data-confirm]').click();
  await page.waitForTimeout(800);
  assert.equal(await page.locator('.wallet-card').count(), 2);
  assert.equal((await stored()).expenses.length, 3);
  ok('Import restores the backup (2 wallets / 3 expenses)');

  // ---- offline (service worker)
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload(); // make sure the page is controlled by the SW
  await context.setOffline(true);
  await page.reload();
  await page.waitForSelector('.wallet-card');
  assert.equal(await page.locator('.wallet-card').count(), 2);
  await context.setOffline(false);
  ok('App loads fully offline from the service worker cache');

  // ---- reset
  await page.click('[data-action="settings"]');
  await settle();
  await sheet().locator('[data-act="reset"]').click();
  await settle();
  await sheet().locator('[data-confirm]').click();
  await page.waitForTimeout(800);
  await page.waitForSelector('.empty');
  assert.equal((await stored()).wallets.length, 0);
  ok('Reset all data (with confirmation) returns to the empty state');

  assert.deepEqual(errors, [], `Console errors: ${errors.join('\n')}`);
  ok('No console errors');
  console.log(`\nAll ${step} end-to-end checks passed.`);
} catch (err) {
  await shot('FAILED').catch(() => {});
  console.error('\nE2E FAILED at step', step + 1, '\n', err);
  process.exitCode = 1;
} finally {
  await browser.close();
  server.close();
}
