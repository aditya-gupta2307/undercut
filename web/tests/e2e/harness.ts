/**
 * End-to-end harness: serves dist/, launches Chromium, and answers every
 * request to the F1 APIs from the synthetic world. External fonts and media
 * are blocked so tests are hermetic.
 */

import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import type { Server } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildWorld, respond, type World } from '../fake-api/index';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export const DEFAULT_NOW = Date.UTC(2026, 9, 9, 6, 0); // Friday of the Singapore weekend, before FP1

export interface Harness {
  browser: Browser;
  server: Server;
  base: string;
  worlds: Map<number, World>;
  close: () => Promise<void>;
}

export async function startHarness(port = 4319): Promise<Harness> {
  const { startStaticServer } = (await import(path.join(ROOT, 'scripts/preview.mjs'))) as {
    startStaticServer: (dir: string, port: number) => Promise<Server>;
  };
  const server = await startStaticServer(path.join(ROOT, 'dist'), port);
  const browser = await chromium.launch();
  return {
    browser,
    server,
    base: `http://localhost:${port}/`,
    worlds: new Map(),
    close: async () => {
      await browser.close();
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}

export interface PageOptions {
  now?: number;
  theme?: 'light' | 'dark';
  width?: number;
  height?: number;
  fastNetwork?: boolean;
  rookie?: boolean;
  storage?: Record<string, string>;
}

export interface OpenedPage {
  page: Page;
  context: BrowserContext;
  errors: string[];
  requests: { host: string; url: string }[];
}

export async function openPage(h: Harness, route: string, opts: PageOptions = {}): Promise<OpenedPage> {
  const now = opts.now ?? DEFAULT_NOW;
  let world = h.worlds.get(now);
  if (!world) {
    world = buildWorld(now);
    h.worlds.set(now, world);
  }
  const context = await h.browser.newContext({
    viewport: { width: opts.width ?? 1360, height: opts.height ?? 900 },
    colorScheme: opts.theme ?? 'dark',
    deviceScaleFactor: 1,
  });
  const errors: string[] = [];
  const requests: { host: string; url: string }[] = [];
  const w = world;
  await context.route('**/*', async (route) => {
    const url = route.request().url();
    const host = new URL(url).hostname;
    if (host === 'localhost') return route.continue();
    requests.push({ host, url });
    const r = respond(w, url);
    if (r) return route.fulfill({ status: r.status, body: r.body, contentType: r.contentType, headers: { 'access-control-allow-origin': '*' } });
    return route.abort();
  });
  await context.addInitScript(
    ({ fast, storage }) => {
      if (fast) (globalThis as Record<string, unknown>).__UNDERCUT_TEST_FAST_NETWORK__ = true;
      for (const [k, v] of Object.entries(storage)) localStorage.setItem(k, v);
    },
    { fast: opts.fastNetwork !== false, storage: { ...(opts.storage ?? {}), ...(opts.rookie ? { 'undercut:v1:pref:rookie': JSON.stringify({ t: 0, v: true }) } : {}) } },
  );
  const page = await context.newPage();
  await page.clock.install({ time: now });
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  await page.goto(h.base + '#' + route);
  return { page, context, errors, requests };
}

/** Errors that are expected in a hermetic run (blocked fonts and media). */
export function realErrors(errors: string[]): string[] {
  return errors.filter((e) => !/ERR_FAILED|ERR_ABORTED|Failed to load resource/.test(e));
}
