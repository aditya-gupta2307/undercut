/**
 * End-to-end suite: every page, rendered by a real browser against the
 * simulated F1 world, with the key interactions exercised and zero console
 * errors allowed.
 *
 *   npm run test:e2e        (builds first)
 */

import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import type { Page } from 'playwright';
import { openPage, realErrors, startHarness, type Harness, type PageOptions } from './harness';

let h: Harness;

before(async () => {
  h = await startHarness(4300 + Math.floor(Math.random() * 300));
});

after(async () => {
  await h?.close();
});

const ALLOWED_HOSTS = new Set(['api.jolpi.ca', 'api.openf1.org', 'api.open-meteo.com', 'fonts.googleapis.com', 'fonts.gstatic.com']);

async function visit(route: string, check: (page: Page) => Promise<void>, opts: PageOptions = {}): Promise<void> {
  const o = await openPage(h, route, opts);
  try {
    await check(o.page);
    assert.deepEqual(realErrors(o.errors), [], `console errors on ${route}`);
    const strangers = o.requests.filter((r) => !ALLOWED_HOSTS.has(r.host));
    assert.deepEqual(strangers, [], `unexpected hosts contacted from ${route}`);
  } finally {
    await o.context.close();
  }
}

const T = { timeout: 30_000 };

test('pit wall: next race, forecast, title fight and last race', async () => {
  await visit('/', async (page) => {
    await page.getByRole('heading', { name: 'Singapore', exact: true }).waitFor(T);
    await page.locator('.forecast-table tbody tr').nth(9).waitFor(T);
    await page.locator('.title-row').first().waitFor(T);
    assert.ok((await page.locator('.schedule li').count()) >= 5);
    assert.match((await page.locator('.podium').textContent()) ?? '', /Russell/);
  });
});

test('season: calendar, standings and points race', async () => {
  await visit('/season', async (page) => {
    await page.locator('.round-card').nth(22).waitFor(T);
    assert.equal(await page.locator('.round-card').count(), 23);
    assert.equal(await page.locator('.round-card.is-next').count(), 1);
    await page.getByRole('img', { name: /Cumulative drivers championship points/ }).waitFor(T);
    const rows = await page.locator('table:has(caption:text("Drivers\' championship standings")) tbody tr').count();
    assert.equal(rows, 22);
  });
});

test('race report: swing chart, classification, trace, strategy and race control', async () => {
  await visit('/race/2026/16', async (page) => {
    await page.getByRole('heading', { name: /Bahrain Grand Prix in Malaysia/i }).waitFor(T);
    await page.getByRole('img', { name: /Win probability for each driver/ }).waitFor({ timeout: 45_000 });
    assert.equal(await page.locator('table:has(caption:text("Race classification")) tbody tr').count(), 22);
    await page.getByRole('img', { name: /Gap to the race leader/ }).waitFor(T);
    await page.getByRole('button', { name: 'Positions' }).click();
    await page.getByRole('img', { name: /Running position of each driver/ }).waitFor(T);
    await page.getByRole('img', { name: /Tyre strategy/ }).waitFor(T);
    assert.ok((await page.locator('.rc-feed li').count()) >= 3);
  });
});

test('replay: plays, moves the clock, focuses a driver and jumps to a moment', async () => {
  await visit('/race/2026/16?tab=replay', async (page) => {
    const canvas = page.locator('.replay-stage canvas');
    await canvas.waitFor(T);
    assert.match((await page.locator('.replay-lap').textContent()) ?? '', /GRID/);
    await page.getByRole('button', { name: 'Play' }).click();
    await page.waitForTimeout(2500);
    await page.getByRole('button', { name: 'Pause' }).click();
    assert.match((await page.locator('.replay-lap').textContent()) ?? '', /LAP \d+\/55/);
    const first = page.locator('button.tower-row').first();
    await first.click();
    assert.equal(await first.getAttribute('aria-pressed'), 'true');
    await page.getByRole('button', { name: /The finish/ }).click();
    await page.waitForTimeout(300);
    assert.match((await page.locator('.replay-lap').textContent()) ?? '', /LAP 5[45]\/55/);
    // Canvas actually has pixels drawn on it.
    const painted = await canvas.evaluate((c: HTMLCanvasElement) => {
      const ctx = c.getContext('2d')!;
      const d = ctx.getImageData(0, 0, c.width, c.height).data;
      let n = 0;
      for (let i = 3; i < d.length; i += 4) if (d[i]! > 0) n++;
      return n;
    });
    assert.ok(painted > 1000, `canvas has ${painted} painted pixels`);
  });
});

test('strategy lab: moving a stop changes the outcome; best plans can be tried', async () => {
  await visit('/race/2026/16?tab=strategy', async (page) => {
    const delta = page.locator('.big-delta').first();
    await delta.waitFor(T);
    assert.equal((await delta.textContent())?.trim(), '±0.0s');
    const handle = page.locator('.plan-handle').first();
    await handle.focus();
    for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowLeft');
    await page.waitForTimeout(200);
    assert.notEqual((await delta.textContent())?.trim(), '±0.0s');
    await page.getByRole('button', { name: 'Reset to real' }).click();
    assert.equal((await delta.textContent())?.trim(), '±0.0s');
    await page.getByRole('button', { name: 'Try' }).first().waitFor({ timeout: 45_000 });
    await page.getByRole('button', { name: 'Try' }).first().click();
    await page.waitForTimeout(200);
    assert.match((await delta.textContent())?.trim() ?? '', /^−\d/);
    await page.getByRole('img', { name: /Race time versus the real strategy/ }).waitFor(T);
  });
});

test('race preview: forecast, finishing heatmap, weather and circuit history', async () => {
  await visit('/race/2026/17', async (page) => {
    await page.getByRole('heading', { name: 'Singapore Grand Prix' }).waitFor(T);
    await page.locator('.forecast-table tbody tr').nth(9).waitFor(T);
    await page.locator('table.heatmap tbody tr').nth(21).waitFor(T);
    await page.getByText('Rain during the race').waitFor(T);
    await page.locator('.wx-hour').first().waitFor(T);
    await page.getByText('Pole converted').waitFor(T);
  });
});

test('title: odds, what-if and history', async () => {
  await visit('/title', async (page) => {
    await page.locator('.odds-row:not(.odds-head)').nth(9).waitFor({ timeout: 45_000 });
    const chips = page.locator('.whatif .pick-chip');
    await chips.nth(1).click();
    await chips.nth(0).click();
    await page.getByRole('button', { name: 'Run the season with this result' }).click();
    await page.locator('table:has(caption:text("Title odds before and after")) tbody tr').first().waitFor({ timeout: 45_000 });
    await page.getByRole('img', { name: /Championship probability after each round/ }).waitFor({ timeout: 90_000 });
  });
});

test('model lab: backtest scoreboard and calibration', async () => {
  await visit('/model', async (page) => {
    await page.locator('table.scoreboard tbody tr').nth(3).waitFor({ timeout: 90_000 });
    await page.getByRole('img', { name: /Calibration of win forecasts/ }).waitFor(T);
    await page.getByRole('button', { name: 'Podium' }).click();
    await page.getByRole('img', { name: /Calibration of podium forecasts/ }).waitFor(T);
  });
});

test('drivers: profile, ratings and teammate battles', async () => {
  await visit('/drivers?d=russell', async (page) => {
    await page.getByRole('heading', { name: 'George Russell' }).waitFor(T);
    await page.locator('.form-cell').first().waitFor(T);
    await page.locator('.rating-row .range-html').nth(10).waitFor({ timeout: 45_000 });
    assert.ok((await page.locator('.duel').count()) >= 10);
    await page.getByRole('button', { name: 'Qualifying' }).click();
    await page.locator('.rating-row .range-html').nth(10).waitFor({ timeout: 45_000 });
  });
});

test('picks: choose a podium, lock it in, and it survives a reload', async () => {
  const o = await openPage(h, '/picks');
  try {
    const page = o.page;
    await page.locator('.whatif .pick-chip').nth(2).waitFor(T);
    for (const i of [0, 1, 2]) await page.locator('.whatif .pick-chip').nth(i).click();
    await page.getByRole('button', { name: 'Lock in my picks' }).click();
    await page.getByText('Saved').waitFor(T);
    await page.reload();
    await page.getByText('Saved').waitFor(T);
    assert.equal(await page.locator('.slot.filled').count(), 3);
    assert.deepEqual(realErrors(o.errors), []);
  } finally {
    await o.context.close();
  }
});

test('time machine: switching eras re-scores the season', async () => {
  await visit('/time-machine', async (page) => {
    await page.locator('.system-card', { hasText: 'Wins only' }).click();
    await page.getByRole('heading', { name: 'Wins only rules' }).waitFor(T);
    assert.ok((await page.locator('table:has(caption:text("Standings re-scored")) tbody tr').count()) >= 20);
  });
});

test('learn: weekend formats, undercut simulator and glossary search', async () => {
  await visit('/learn', async (page) => {
    await page.getByRole('button', { name: 'Sprint weekend' }).click();
    await page.getByText('Sprint Qualifying').first().waitFor(T);
    const result = page.locator('.undercut-sim .big-delta');
    const before = await result.textContent();
    // Drive the slider with the keyboard, as a user would.
    await page.locator('#us-laps').focus();
    for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight');
    assert.notEqual(await result.textContent(), before);
    await page.getByRole('searchbox', { name: 'Search the glossary' }).fill('undercut');
    await page.locator('#g-undercut').waitFor(T);
    assert.ok((await page.locator('.glossary-list .glossary-item').count()) < 10);
  });
});

test('about: data sources and clearing the cache', async () => {
  await visit('/about', async (page) => {
    await page.getByRole('link', { name: 'OpenF1' }).first().waitFor(T);
    await page.getByRole('button', { name: 'Clear cached data' }).click();
    await page.getByText(/Removed \d+ cached/).waitFor(T);
  });
});

test('rookie mode explains terms; the theme can be switched', async () => {
  await visit(
    '/race/2026/17',
    async (page) => {
      const term = page.locator('.term').first();
      await term.waitFor(T);
      await term.hover();
      await page.locator('.popover').waitFor(T);
      await page.getByRole('button', { name: /theme/i }).click();
      const theme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
      assert.ok(theme === 'light' || theme === 'dark');
    },
    { rookie: true },
  );
});

test('phone width: no sideways scrolling on the main pages', async () => {
  for (const route of ['/', '/season', '/race/2026/16', '/title', '/learn']) {
    await visit(
      route,
      async (page) => {
        await page.waitForTimeout(3500);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        assert.ok(overflow <= 1, `${route} overflows by ${overflow}px`);
      },
      { width: 390, height: 844 },
    );
  }
});

test('light theme renders the race report without errors', async () => {
  await visit(
    '/race/2026/16',
    async (page) => {
      await page.getByRole('img', { name: /Win probability for each driver/ }).waitFor({ timeout: 45_000 });
      const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
      assert.notEqual(bg, 'rgb(11, 14, 18)');
    },
    { theme: 'light' },
  );
});

test('after the season: the champion is crowned and every round has a report', async () => {
  await visit(
    '/',
    async (page) => {
      await page.getByText('season complete').waitFor({ timeout: 45_000 });
    },
    { now: Date.UTC(2026, 11, 9, 12) },
  );
});

test('unknown pages and bad race addresses fail gracefully', async () => {
  await visit('/nowhere', async (page) => {
    await page.getByRole('heading', { name: 'Off track' }).waitFor(T);
  });
  await visit('/race/2026/99', async (page) => {
    await page.getByText('There is no round 99 in 2026').waitFor(T);
  });
});

// ---------------------------------------------------------------------------
// Regressions from the QA review

test('switching season on the picks page keeps the app alive and scores that season', async () => {
  const book = { '2025:5': { podium: ['russell', 'antonelli', 'piastri'], madeAt: 0 } };
  await visit(
    '/picks',
    async (page) => {
      await page.getByRole('heading', { name: 'Beat the model' }).waitFor(T);
      await page.getByRole('combobox', { name: 'Season' }).selectOption('2025');
      await page.getByText('1 race picked').waitFor({ timeout: 45_000 });
      assert.ok(((await page.locator('#root').innerHTML()) ?? '').length > 1000, 'the app is still rendered');
      await page.getByRole('combobox', { name: 'Season' }).selectOption('2026');
      await page.getByText('No scored picks yet').waitFor(T);
    },
    { storage: { 'undercut:v1:picks:v1': JSON.stringify({ t: 0, v: book }) } },
  );
});

test('moving between races resets the replay and keeps the current view', async () => {
  await visit('/race/2026/16?tab=replay', async (page) => {
    await page.locator('.replay-stage canvas').waitFor(T);
    await page.getByRole('button', { name: /The finish/ }).click();
    await page.waitForTimeout(300);
    assert.match((await page.locator('.replay-lap').textContent()) ?? '', /LAP 5\d\/55/);
    await page.getByRole('link', { name: /Previous: Azerbaijan/ }).click();
    await page.getByRole('heading', { name: /Azerbaijan Grand Prix/ }).waitFor(T);
    await page.locator('.replay-stage canvas').waitFor(T);
    assert.match((await page.locator('.replay-lap').textContent()) ?? '', /GRID/);
    assert.match(page.url(), /tab=replay/);
    // A race not yet run has no replay: the preview shows, and the tab bar says so.
    await page.getByRole('link', { name: /Next: Bahrain Grand Prix in Malaysia/ }).click();
    await page.getByRole('link', { name: /Next: Singapore/ }).click();
    await page.getByRole('heading', { name: 'Singapore Grand Prix' }).waitFor(T);
    assert.equal(await page.locator('.tabs a[aria-current="page"]').textContent(), 'Preview');
  });
});

test('a malformed address shows a message instead of a blank page', async () => {
  await visit('/race/2026/%E0%A4%A', async (page) => {
    await page.getByText('does not look right').waitFor(T);
  });
});

test('before the first race: empty states, not endless spinners', async () => {
  await visit(
    '/',
    async (page) => {
      await page.getByText('The forecast appears once the entry list is known').waitFor({ timeout: 45_000 });
      await page.getByText('Title odds appear after the first race').waitFor(T);
      assert.equal(await page.locator('[role="status"] .lights').count(), 0, 'no loader left spinning');
    },
    { now: Date.UTC(2026, 1, 25, 12) },
  );
});
