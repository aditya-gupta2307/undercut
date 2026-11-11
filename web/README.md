# Running Undercut locally

This folder is the whole site: a static React and TypeScript app bundled with esbuild, so there's no server to run. You need Node.js 20.6 or newer.

```bash
npm install
npm run dev          # http://localhost:5173, reloads on save
npm test             # unit and integration tests
npm run typecheck
npm run build        # static site in dist/
npx playwright install chromium && npm run test:e2e   # browser tests
```

The browser tests run every page against a simulated F1 season (fake versions of the Jolpica, OpenF1 and Open-Meteo APIs in `tests/fake-api`), so they work offline. Every push to `main` runs `.github/workflows/deploy-web.yml`, which type-checks, runs both test suites, builds the site and publishes it to GitHub Pages.

Where things live:

- `src/data`: API clients and parsers
- `src/model`: the ranking model, simulations, backtest, strategy and replay maths
- `src/pages`: one file per page (`race/` holds the race report, replay and Strategy Lab)
- `src/components`: charts, the track map and shared UI
- `tests/unit` and `tests/e2e`: the test suites
