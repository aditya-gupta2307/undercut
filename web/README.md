# Undercut — website

This folder is the website. The project overview, screenshots, architecture and deployment guide are in the [main README](../README.md).

```bash
npm install
npm run dev          # http://localhost:5173
npm test             # unit and integration tests
npm run typecheck
npm run build        # static site in dist/
npx playwright install chromium && npm run test:e2e
```
