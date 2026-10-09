/**
 * Developer tool: screenshot a route against the fake API.
 *   node --import tsx tests/e2e/shoot.ts "/route" out.png [--light] [--mobile] [--wait=ms] [--full] [--rookie] [--now=ISO]
 *        [--click=<selector>]... [--scroll=<selector>] [--after=ms] [--fill=<selector>::<text>]
 */

import { openPage, realErrors, startHarness } from './harness';

const [route = '/', out = 'shot.png', ...flags] = process.argv.slice(2);
const has = (f: string) => flags.includes(f);
const val = (f: string) => flags.find((x) => x.startsWith(f + '='))?.slice(f.length + 1);

const h = await startHarness(4400 + Math.floor(Math.random() * 400));
try {
  const opened = await openPage(h, route, {
    theme: has('--light') ? 'light' : 'dark',
    width: has('--mobile') ? 390 : Number(val('--width') ?? 1360),
    height: has('--mobile') ? 844 : 900,
    rookie: has('--rookie'),
    now: val('--now') ? Date.parse(val('--now')!) : undefined,
  });
  const { page, errors } = opened;
  await page.waitForTimeout(Number(val('--wait') ?? 3500));
  for (const f of flags) {
    if (f.startsWith('--click=')) {
      await page.locator(f.slice('--click='.length)).first().click();
      await page.waitForTimeout(400);
    } else if (f.startsWith('--scroll=')) {
      await page.locator(f.slice('--scroll='.length)).first().scrollIntoViewIfNeeded();
      await page.waitForTimeout(400);
    } else if (f.startsWith('--fill=')) {
      const [sel, text] = f.slice('--fill='.length).split('::');
      await page.locator(sel!).first().fill(text ?? '');
      await page.waitForTimeout(400);
    }
  }
  if (val('--after')) await page.waitForTimeout(Number(val('--after')));
  await page.screenshot({ path: out, fullPage: has('--full') });
  const bad = realErrors(errors);
  console.log(JSON.stringify({ out, errors: bad, requests: opened.requests.length }, null, 0));
} finally {
  await h.close();
}
