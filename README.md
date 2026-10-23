# Yen Wallet — travel budget tracker

A personal, offline-first budget tracker for a trip to Japan: **budgets in Saudi riyals (SAR), expenses in Japanese yen (JPY)**.
No login, no backend — everything is stored on your phone (localStorage) and saved automatically on every change.

- **Wallets**: one per category (Food, Shopping, Transport…) with a progress bar, spent and remaining in SAR **and** JPY.
  Cards turn red at the alert threshold (default 80%, adjustable) and show *Over budget* when exceeded.
- **Expenses**: big centre **+** to log yen amounts, grouped by day, filter by wallet, tap to edit / delete
  (wallet balances update automatically).
- **Analysis**: totals, spending by wallet, spending per day, daily average, days left and a suggested daily allowance
  (when trip dates are set), highest-spending wallet and a pace summary.
- **Settings** (gear icon): exchange rate (`1 SAR = X JPY`, default 40), alert threshold, trip dates, theme,
  export / import a JSON backup, reset all data.
- Installable **PWA**, works fully offline, light / dark mode (follows the system until you choose).

## Project structure

```
index.html            App shell (header, bottom nav, FABs)
css/styles.css        Mobile-first styles, light/dark tokens, animations
js/calc.js            Pure money/date math (conversion, wallet stats, trip pace, validation)
js/store.js           State, localStorage persistence, backup import/normalisation
js/charts.js          Tiny dependency-free charts (HTML bars + SVG daily chart)
js/app.js             UI: pages, bottom sheets, forms, events
sw.js                 Service worker (offline cache)
manifest.webmanifest  PWA manifest; icons in icons/
tests/                Unit tests (node:test) and an end-to-end browser test (Playwright)
```

**How balances work:** a wallet's spent amount is always computed from its expenses (each stored in yen with its
currency) and converted with the current rate. Adding, editing, moving or deleting an expense, or changing the rate,
can therefore never leave a stale balance behind.

## Run it locally

No build step — it is plain HTML/CSS/JS. Serve the folder with any static server (service workers need `http://`, not `file://`):

```bash
npm start            # = npx serve -l 5173 .
# or: python3 -m http.server 5173
```

Open <http://localhost:5173>.

To try it on your phone on the same Wi-Fi, open `http://<your-computer-ip>:5173` (offline mode / install needs HTTPS,
so for real use deploy it as below).

## Tests

```bash
npm install          # installs Playwright (dev only)
npm test             # unit tests: conversion, deduction, red/over-budget state, rate changes, persistence, import
npm run test:e2e     # drives the real app in a phone-sized headless Chromium; screenshots go to ./screenshots
```

If Playwright has no browser on your machine, run `npx playwright install chromium` once
(or set `CHROMIUM_PATH=/path/to/chromium`).

## Deploy for free (so you can open it on your phone)

### Option A — GitHub Pages

1. Push this folder to a GitHub repository (the files must be at the repo root, `index.html` included).
2. On GitHub: **Settings → Pages → Build and deployment → Source: Deploy from a branch**,
   choose your branch (e.g. `main`) and folder **/ (root)**, then **Save**.
3. After a minute the app is live at `https://<your-username>.github.io/<repo-name>/`.

All paths are relative, so it works from a sub-folder like that. (`.nojekyll` is included so Pages serves files as-is.)

### Option B — Netlify

- **Drag & drop:** go to <https://app.netlify.com/drop> and drop this folder. You get an `https://….netlify.app` URL instantly.
- **From Git:** *Add new site → Import an existing project*, pick the repo, leave the build command **empty** and set the
  publish directory to `.`.

### Install on your phone

Open the HTTPS URL once while online, then:

- **iPhone (Safari):** Share → **Add to Home Screen**.
- **Android (Chrome):** ⋮ menu → **Install app** / **Add to Home screen**.

After that it opens full-screen and works with no connection.

### Updating a deployed version

The service worker caches the app for offline use. When you change any file, bump `CACHE_VERSION` in `sw.js`
(e.g. `yen-wallet-v2`) and redeploy; open the app twice (or close and reopen it) to load the new version.
Your data is not affected — it lives in localStorage, not the cache.

## Your data

- Stored only in this browser on this device (key `yen-wallet:v1`). Clearing site data or uninstalling the app
  deletes it, so use **Settings → Export data** now and then, especially before switching phones.
- **Import data** replaces current data with the backup (after a confirmation).
- The data on your phone and on your computer are separate; use export/import to move between them.
