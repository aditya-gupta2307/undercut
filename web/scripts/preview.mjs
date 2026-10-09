// Serve the production build locally:  npm run build && npm run preview
// Zero dependencies — the e2e tests use the same server.

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { ROOT } from './shared.mjs';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.map': 'application/json',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

export function startStaticServer(dir = path.join(ROOT, 'dist'), port = 4173) {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      let file = path.normalize(path.join(dir, decodeURIComponent(url.pathname)));
      if (!file.startsWith(dir)) {
        res.writeHead(403).end('Forbidden');
        return;
      }
      const info = await stat(file).catch(() => null);
      if (!info) {
        res.writeHead(404).end('Not found');
        return;
      }
      if (info.isDirectory()) file = path.join(file, 'index.html');
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
      res.end(body);
    } catch (err) {
      res.writeHead(500).end(String(err));
    }
  });
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PORT ?? 4173);
  await startStaticServer(undefined, port);
  console.log(`Previewing dist/ at http://localhost:${port}`);
}
