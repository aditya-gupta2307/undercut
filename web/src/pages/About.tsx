/** How the site works: data sources, limits, storage, privacy and the stack. */

import { useEffect, useState } from 'react';
import { Link, useTitle } from '../app/router';
import { SITE } from '../content/site';
import { jolpicaQueue, openf1Queue, weatherQueue, type QueueStatus } from '../lib/http';
import { clearCachedData } from '../lib/storage';
import { plural } from '../lib/format';
import { Panel } from '../components/ui';

function useQueue(q: typeof jolpicaQueue): QueueStatus {
  const [s, setS] = useState<QueueStatus>(() => q.getStatus());
  useEffect(() => q.subscribe(setS), [q]);
  return s;
}

function storageUse(): { entries: number; kb: number } {
  try {
    let entries = 0;
    let bytes = 0;
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith('undercut:')) continue;
      entries++;
      bytes += (k.length + (localStorage.getItem(k)?.length ?? 0)) * 2;
    }
    return { entries, kb: Math.round(bytes / 1024) };
  } catch {
    return { entries: 0, kb: 0 };
  }
}

export default function About() {
  useTitle('About');
  const j = useQueue(jolpicaQueue);
  const o = useQueue(openf1Queue);
  const w = useQueue(weatherQueue);
  const [use, setUse] = useState(storageUse);
  const [cleared, setCleared] = useState<number | null>(null);
  // Data keeps arriving while the page is open; keep the storage figure current.
  const activity = j.completed + o.completed + w.completed;
  useEffect(() => setUse(storageUse()), [activity]);

  const sources = [
    {
      name: 'Jolpica F1',
      href: 'https://github.com/jolpica/jolpica-f1',
      what: 'Calendar, results, qualifying, sprints and standings back to 1950 — the successor to the Ergast API.',
      limits: '4 requests a second, 500 an hour',
      q: j,
    },
    {
      name: 'OpenF1',
      href: 'https://openf1.org',
      what: 'Lap timing, tyre stints, pit stops, race control, weather, car positions and team radio from 2023 onwards.',
      limits: '3 requests a second, 30 a minute (free tier)',
      q: o,
    },
    {
      name: 'Open-Meteo',
      href: 'https://open-meteo.com',
      what: 'Hourly weather forecasts for race day, up to about two weeks ahead.',
      limits: 'Generous; one request per race preview',
      q: w,
    },
  ];

  return (
    <div className="stack" style={{ gap: 22, maxWidth: 980 }}>
      <header className="page-head">
        <div className="eyebrow">About</div>
        <h1>How {SITE.name} works</h1>
        <p className="muted" style={{ fontSize: 'var(--step-1)', maxWidth: '68ch' }}>
          {SITE.name} is a static website with no server and no database. Your browser fetches public F1 data directly, fits the prediction model, runs the
          simulations and draws every chart — all on your own machine.
        </p>
      </header>

      <Panel title="Where the data comes from" sub="Each source is asked politely: requests are queued, spaced out and cached so the free limits are never exceeded" flush>
        <div className="table-wrap">
          <table className="data-table">
            <caption className="sr-only">Data sources and their limits</caption>
            <thead>
              <tr>
                <th scope="col">Source</th>
                <th scope="col">Provides</th>
                <th scope="col">Limits respected</th>
                <th scope="col" className="r">
                  This visit
                </th>
              </tr>
            </thead>
            <tbody>
              {sources.map((s) => (
                <tr key={s.name}>
                  <td>
                    <a href={s.href} target="_blank" rel="noreferrer">
                      {s.name}
                    </a>
                  </td>
                  <td className="muted wrap">{s.what}</td>
                  <td className="faint wrap" style={{ minWidth: 160 }}>
                    {s.limits}
                  </td>
                  <td className="r num">
                    {s.q.completed} ok{s.q.failed ? ` · ${s.q.failed} failed` : ''}
                    {s.q.queued + s.q.inFlight ? ` · ${s.q.queued + s.q.inFlight} pending` : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <div className="grid">
        <Panel className="span-6" title="What is stored in your browser">
          <div className="stack" style={{ gap: 12 }}>
            <p className="muted" style={{ fontSize: 'var(--step--1)' }}>
              Downloaded data is cached in this browser's local storage so pages load instantly next time: finished seasons and races are kept, the current season
              refreshes every few minutes. Your preferences (theme, Rookie mode, season, model settings) and your podium picks are stored the same way. Nothing leaves
              your device.
            </p>
            <div className="row spread" style={{ flexWrap: 'wrap', gap: 10 }}>
              <span className="num">
                {plural(use.entries, 'entry', 'entries')} · about {use.kb.toLocaleString()} KB
              </span>
              <button
                className="btn btn-sm"
                onClick={() => {
                  setCleared(clearCachedData());
                  setUse(storageUse());
                }}
              >
                Clear cached data
              </button>
            </div>
            {cleared !== null ? (
              <div className="faint" style={{ fontSize: 'var(--step--1)' }} role="status">
                Removed {cleared} cached {cleared === 1 ? 'entry' : 'entries'}. Preferences and picks were kept. Reload to fetch fresh data.
              </div>
            ) : null}
          </div>
        </Panel>
        <Panel className="span-6" title="Privacy">
          <ul className="muted" style={{ fontSize: 'var(--step--1)', margin: 0, paddingLeft: 18, display: 'grid', gap: 6 }}>
            <li>No accounts, cookies, analytics or tracking.</li>
            <li>No server of our own: the only requests go to the three data services above (and Google Fonts for typography).</li>
            <li>Team-radio audio is streamed from Formula 1's timing service only if you press play.</li>
          </ul>
        </Panel>
      </div>

      <Panel title="Under the hood">
        <div className="grid">
          <div className="span-6 stack" style={{ gap: 8 }}>
            <strong>The model</strong>
            <p className="muted" style={{ fontSize: 'var(--step--1)' }}>
              A Bayesian Plackett–Luce ranking model separating car from driver, with a grid-position effect, recency weighting and a retirement model, sampled by
              Monte Carlo. Every forecast is backtested walk-forward against honest baselines. <Link to="/model">Open the Model Lab →</Link>
            </p>
          </div>
          <div className="span-6 stack" style={{ gap: 8 }}>
            <strong>The stack</strong>
            <p className="muted" style={{ fontSize: 'var(--step--1)' }}>
              React 19 and TypeScript, bundled with esbuild; d3 scales for SVG charts and a canvas race replay; a rate-limited request queue with three-layer caching;
              unit tests on Node's built-in runner and end-to-end tests in Playwright against a simulated F1 API. Deployed as static files on GitHub Pages.
            </p>
          </div>
        </div>
      </Panel>

      <p className="faint" style={{ fontSize: 'var(--step--1)', maxWidth: '75ch' }}>
        {SITE.name} is an unofficial fan project and is not associated in any way with the Formula 1 companies. F1, FORMULA ONE, FORMULA 1, FIA FORMULA ONE WORLD
        CHAMPIONSHIP, GRAND PRIX and related marks are trade marks of Formula One Licensing B.V. Forecasts are model outputs for entertainment and learning, not
        betting advice.
        {SITE.author ? <> Built by {SITE.authorUrl ? <a href={SITE.authorUrl}>{SITE.author}</a> : SITE.author}.</> : null}
        {SITE.repoUrl ? (
          <>
            {' '}
            <a href={SITE.repoUrl}>Source code</a>.
          </>
        ) : null}
      </p>
    </div>
  );
}
