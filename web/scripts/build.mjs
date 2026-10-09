// Production build: dist/ is a fully static site. Deploy it anywhere —
// GitHub Pages, Netlify, Vercel, or any folder behind a web server.

import * as esbuild from 'esbuild';
import { rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ROOT, copyPublic, ensureDir, entryOutputs, esbuildOptions, writeIndexHtml } from './shared.mjs';

const dist = path.join(ROOT, 'dist');
await rm(dist, { recursive: true, force: true });
await ensureDir(dist);

const result = await esbuild.build(esbuildOptions('production', path.join(dist, 'assets')));
await copyPublic(dist);
await writeIndexHtml(dist, entryOutputs(result.metafile, dist));

// GitHub Pages runs Jekyll by default, which drops files starting with "_".
await writeFile(path.join(dist, '.nojekyll'), '');

const bytes = Object.entries(result.metafile.outputs)
  .filter(([file]) => !file.endsWith('.map'))
  .reduce((sum, [, o]) => sum + o.bytes, 0);
console.log(`\nBuilt dist/ (${(bytes / 1024).toFixed(0)} KB of JS + CSS, before gzip)`);
