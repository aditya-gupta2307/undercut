import { Suspense, lazy, useEffect, useState, type ReactNode } from 'react';
import { jolpicaQueue, openf1Queue, type QueueStatus } from '../lib/http';
import { useSettings, type ThemeChoice } from './settings';
import { Link, useRoute } from './router';
import { useF1Index, useSeasonData } from './data';
import { TeamsProvider } from './teams';
import { ModelConfigProvider } from './ModelConfigProvider';
import { Lights, Toggle } from '../components/ui';
import { ErrorBoundary } from '../components/ErrorBoundary';

const PitWall = lazy(() => import('../pages/PitWall'));
const SeasonPage = lazy(() => import('../pages/Season'));
const RacePage = lazy(() => import('../pages/race/RacePage'));
const TitlePage = lazy(() => import('../pages/Title'));
const ModelLab = lazy(() => import('../pages/ModelLab'));
const DriversPage = lazy(() => import('../pages/Drivers'));
const LearnPage = lazy(() => import('../pages/Learn'));
const TimeMachine = lazy(() => import('../pages/TimeMachine'));
const PicksPage = lazy(() => import('../pages/Picks'));
const AboutPage = lazy(() => import('../pages/About'));

const NAV: { to: string; label: string; match: string }[] = [
  { to: '/', label: 'Pit Wall', match: '' },
  { to: '/season', label: 'Season', match: 'season' },
  { to: '/title', label: 'Title', match: 'title' },
  { to: '/model', label: 'Model', match: 'model' },
  { to: '/drivers', label: 'Drivers', match: 'drivers' },
  { to: '/picks', label: 'Picks', match: 'picks' },
  { to: '/time-machine', label: 'Time Machine', match: 'time-machine' },
  { to: '/learn', label: 'Learn', match: 'learn' },
];

export function Logo({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <path d="M5 27 C5 13 13 5 27 5" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" opacity="0.35" />
      <path d="M12 27 C12 18 18 12 27 12" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      <circle cx="16.4" cy="19.2" r="3.6" fill="var(--accent)" />
    </svg>
  );
}

function NetworkStatus() {
  const [s, setS] = useState<{ j: QueueStatus; o: QueueStatus }>(() => ({ j: jolpicaQueue.getStatus(), o: openf1Queue.getStatus() }));
  const [, tick] = useState(0);
  useEffect(() => {
    const a = jolpicaQueue.subscribe((j) => setS((p) => ({ ...p, j })));
    const b = openf1Queue.subscribe((o) => setS((p) => ({ ...p, o })));
    return () => {
      a();
      b();
    };
  }, []);
  const waiting = [s.j, s.o].find((q) => q.waitingUntil !== null && q.waitingUntil > Date.now());
  useEffect(() => {
    if (!waiting) return undefined;
    const id = setInterval(() => tick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [waiting]);
  const busy = s.j.inFlight + s.j.queued + s.o.inFlight + s.o.queued;
  let cls = 'netstat';
  let text = 'Live data';
  let title = 'Connected to Jolpica and OpenF1. Everything is computed in your browser.';
  if (waiting) {
    cls += ' wait';
    const secs = Math.max(1, Math.round((waiting.waitingUntil! - Date.now()) / 1000));
    const who = waiting.name === 'openf1' ? 'OpenF1' : 'Jolpica';
    text = `${who} · ${secs}s`;
    title = `${who} limits how fast it can be asked for data. Waiting ${secs}s before the next request${waiting.reason === 'retrying' ? ' (retrying after an error)' : ''}.`;
  } else if (busy > 0) {
    cls += ' busy';
    text = `Fetching ${busy}`;
    title = `${busy} request${busy === 1 ? '' : 's'} in progress or queued.`;
  }
  return (
    <span className={cls} title={title} role="status" aria-live="polite">
      <span className="dot" aria-hidden="true" />
      <span className="netstat-text">{text}</span>
    </span>
  );
}

function ThemeButton() {
  const { theme, setTheme, resolvedTheme } = useSettings();
  const next: Record<ThemeChoice, ThemeChoice> = { system: resolvedTheme === 'dark' ? 'light' : 'dark', light: 'dark', dark: 'light' };
  const label = resolvedTheme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme';
  return (
    <button
      type="button"
      className="btn btn-ghost icon-btn"
      aria-label={label}
      title={`${label}${theme === 'system' ? ' (currently following your system)' : ''}`}
      onClick={() => setTheme(next[theme])}
      onDoubleClick={() => setTheme('system')}
    >
      {resolvedTheme === 'dark' ? (
        <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="4.5" fill="currentColor" />
          {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => (
            <line key={a} x1="12" y1="2.5" x2="12" y2="5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" transform={`rotate(${a} 12 12)`} />
          ))}
        </svg>
      ) : (
        <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z" fill="currentColor" />
        </svg>
      )}
    </button>
  );
}

function SeasonSelect() {
  const { season, setSeason, currentYear } = useSettings();
  const years: number[] = [];
  for (let y = currentYear; y >= 2023; y--) years.push(y);
  return (
    <label className="row" style={{ gap: 6 }}>
      <span className="sr-only">Season</span>
      <select className="select" value={season} onChange={(e) => setSeason(Number(e.target.value))} aria-label="Season">
        {years.map((y) => (
          <option key={y} value={y}>
            {y}
          </option>
        ))}
      </select>
    </label>
  );
}

function TopBar() {
  const route = useRoute();
  const { rookie, setRookie } = useSettings();
  const section = route.path[0] ?? '';
  return (
    <header className="topbar">
      <div className="topbar-inner">
        <Link to="/" className="brand" aria-label="Undercut home">
          <Logo />
          <span className="brand-word">Undercut</span>
        </Link>
        <nav className="nav" aria-label="Main">
          {NAV.map((n) => (
            <Link key={n.to} to={n.to} aria-current={n.match === section || (n.match === 'season' && section === 'race') ? 'page' : undefined}>
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="topbar-tools">
          <NetworkStatus />
          <SeasonSelect />
          <Toggle on={rookie} onChange={setRookie} title="Rookie mode explains every piece of F1 jargon on the site">
            Rookie
          </Toggle>
          <ThemeButton />
        </div>
      </div>
    </header>
  );
}

function Footer() {
  return (
    <footer className="footer">
      <div className="footer-inner">
        <p>
          Undercut is an unofficial fan project, not associated with Formula 1 companies. Data from{' '}
          <a href="https://github.com/jolpica/jolpica-f1" target="_blank" rel="noreferrer">
            Jolpica
          </a>{' '}
          and{' '}
          <a href="https://openf1.org" target="_blank" rel="noreferrer">
            OpenF1
          </a>
          . Every forecast is computed in your browser and is a model, not a promise.
        </p>
        <Link to="/about">How it works · Data &amp; privacy</Link>
      </div>
    </footer>
  );
}

function Routes() {
  const route = useRoute();
  const [a, b, c] = route.path;
  let page: ReactNode;
  switch (a) {
    case undefined:
      page = <PitWall />;
      break;
    case 'season':
      page = <SeasonPage />;
      break;
    case 'race':
      page = <RacePage year={Number(b)} round={Number(c)} />;
      break;
    case 'title':
      page = <TitlePage />;
      break;
    case 'model':
      page = <ModelLab />;
      break;
    case 'drivers':
      page = <DriversPage />;
      break;
    case 'learn':
      page = <LearnPage />;
      break;
    case 'time-machine':
      page = <TimeMachine />;
      break;
    case 'picks':
      page = <PicksPage />;
      break;
    case 'about':
      page = <AboutPage />;
      break;
    default:
      page = (
        <div className="stack">
          <h1>Off track</h1>
          <p className="muted">
            There is no page here. <Link to="/">Back to the pit wall</Link>.
          </p>
        </div>
      );
  }
  return (
    <ErrorBoundary resetKey={route.raw}>
      <Suspense fallback={<Lights label="Loading page" />}>{page}</Suspense>
    </ErrorBoundary>
  );
}

export function App() {
  const { season } = useSettings();
  const s = useSeasonData(season);
  const idx = useF1Index(season);
  return (
    <ModelConfigProvider>
      <TeamsProvider season={s.season} sessions={idx.data?.sessions ?? null}>
        <a className="sr-only skip-link" href="#main">
          Skip to content
        </a>
        <TopBar />
        <main id="main" className="shell-main">
          <Routes />
        </main>
        <Footer />
      </TeamsProvider>
    </ModelConfigProvider>
  );
}
