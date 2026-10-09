// Shared build configuration for dev, build and preview.
//
// Plain esbuild rather than a framework CLI: the whole pipeline is the ~100
// lines in this folder, and the bundler that produces the deployed site is the
// same one the tests run against.

import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** @param {'development' | 'production'} mode */
export function esbuildOptions(mode, outdir) {
  const prod = mode === 'production';
  return {
    absWorkingDir: ROOT,
    entryPoints: { main: 'src/main.tsx' },
    bundle: true,
    splitting: true,
    format: 'esm',
    target: ['es2020', 'chrome100', 'firefox100', 'safari15'],
    outdir,
    entryNames: prod ? '[name]-[hash]' : '[name]',
    chunkNames: prod ? 'chunk-[hash]' : 'chunk-[name]-[hash]',
    assetNames: '[name]-[hash]',
    jsx: 'automatic',
    minify: prod,
    sourcemap: true,
    metafile: true,
    legalComments: 'none',
    logLevel: 'info',
    define: { 'process.env.NODE_ENV': JSON.stringify(mode) },
  };
}

/** Find the bundled entry script and its CSS in an esbuild metafile. */
export function entryOutputs(metafile, outdirRelativeTo) {
  for (const [file, info] of Object.entries(metafile.outputs)) {
    if (info.entryPoint === 'src/main.tsx') {
      const rel = (p) => './' + path.relative(outdirRelativeTo, path.resolve(ROOT, p)).split(path.sep).join('/');
      return { js: rel(file), css: info.cssBundle ? rel(info.cssBundle) : null };
    }
  }
  throw new Error('Entry output for src/main.tsx not found in metafile');
}

/** Render index.html from the template, wiring in the bundled assets. */
export async function writeIndexHtml(targetDir, { js, css }, extraBodyHtml = '') {
  const template = await readFile(path.join(ROOT, 'index.html'), 'utf8');
  const html = template
    .replace('<!--app-css-->', css ? `<link rel="stylesheet" href="${css}">` : '')
    .replace('<!--app-js-->', `<script type="module" src="${js}"></script>${extraBodyHtml}`);
  await writeFile(path.join(targetDir, 'index.html'), html);
}

export async function copyPublic(targetDir) {
  const pub = path.join(ROOT, 'public');
  if (existsSync(pub)) await cp(pub, targetDir, { recursive: true });
}

export async function ensureDir(dir) {
  await mkdir(dir, { recursive: true });
}
