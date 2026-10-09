/**
 * Race Centre: one page per Grand Prix. Before the race: forecast, grid and
 * circuit history. After it: the full analysis, a replay, and the Strategy Lab.
 */

import { Suspense, lazy } from 'react';
import { useF1Index, usePriorSeason, useRaceBundle, useSeasonData } from '../../app/data';
import { Link, useRoute, useTitle } from '../../app/router';
import { linkSessions } from '../../data/link';
import { longDate } from '../../lib/format';
import { ErrorNotice, Lights, Notice } from '../../components/ui';
import { Overview } from './Overview';
import { Preview } from './Preview';

const Replay = lazy(() => import('./Replay'));
const StrategyLab = lazy(() => import('./StrategyLab'));

export default function RacePage({ year, round }: { year: number; round: number }) {
  const valid = Number.isInteger(year) && year >= 1950 && Number.isInteger(round) && round > 0;
  const cur = useSeasonData(valid ? year : null);
  const prior = usePriorSeason(valid ? year : null);
  const idx = useF1Index(valid && year >= 2023 ? year : null);
  const route = useRoute();
  const event = cur.season?.events.find((e) => e.round === round) ?? null;
  useTitle(event ? `${event.season} ${event.name}` : 'Race');

  const linked = event && idx.data ? linkSessions(event, idx.data.meetings, idx.data.sessions) : null;
  const done = Boolean(event && cur.season?.results[round]?.length);
  const raceSession = linked?.race && linked.race.end + 30 * 60_000 < Date.now() ? linked.race : null;
  const bundle = useRaceBundle(done ? raceSession : null);

  if (!valid) return <Notice tone="warn">That race address does not look right. <Link to="/season">Pick a race from the season</Link>.</Notice>;
  if (!cur.season) {
    if (cur.error) return <ErrorNotice error={cur.error} onRetry={cur.reload} what={`the ${year} season`} />;
    return <Lights label="Loading the race" />;
  }
  if (!event) {
    return (
      <Notice tone="warn">
        There is no round {round} in {year}. <Link to="/season">Back to the season</Link>.
      </Notice>
    );
  }
  const season = cur.season;
  const tab = route.query.get('tab') ?? 'overview';
  // The view actually shown: replay and strategy need a finished race with timing.
  const view = (tab === 'replay' || tab === 'strategy') && done && raceSession ? tab : 'overview';
  const timingAvailable = year >= 2023 && Boolean(raceSession);
  const prevEvent = season.events.find((e) => e.round === round - 1);
  const nextEvent = season.events.find((e) => e.round === round + 1);
  const base = `/race/${year}/${round}`;
  // Moving to the previous or next race keeps the current view.
  const keepTab = tab !== 'overview' ? `?tab=${tab}` : '';

  return (
    <div className="stack" style={{ gap: 22 }}>
      <div className="race-head">
        <div className="stack" style={{ gap: 8 }}>
          <div className="crumbs">
            <Link to="/season">{year} season</Link> · Round {round} of {season.events.length}
            {event.hasSprint ? ' · Sprint weekend' : ''}
          </div>
          <h1>{event.name}</h1>
          <div className="muted">
            {event.circuit.name} · {event.circuit.locality}, {event.circuit.country} · {event.start ? longDate(event.start) : event.date}
          </div>
        </div>
        <div className="row">
          {prevEvent ? (
            <Link className="btn btn-sm" to={`/race/${year}/${prevEvent.round}${keepTab}`} aria-label={`Previous: ${prevEvent.name}`}>
              ← R{prevEvent.round}
            </Link>
          ) : null}
          {nextEvent ? (
            <Link className="btn btn-sm" to={`/race/${year}/${nextEvent.round}${keepTab}`} aria-label={`Next: ${nextEvent.name}`}>
              R{nextEvent.round} →
            </Link>
          ) : null}
        </div>
      </div>

      <nav className="tabs" aria-label="Race views">
        <Link to={base} aria-current={view === 'overview' ? 'page' : undefined}>
          {done ? 'Race report' : 'Preview'}
        </Link>
        <Link to={`${base}?tab=replay`} aria-current={view === 'replay' ? 'page' : undefined} aria-disabled={!timingAvailable || !done}>
          Replay
        </Link>
        <Link to={`${base}?tab=strategy`} aria-current={view === 'strategy' ? 'page' : undefined} aria-disabled={!timingAvailable || !done}>
          Strategy Lab
        </Link>
      </nav>

      {view === 'replay' && raceSession ? (
        <Suspense fallback={<Lights label="Loading replay" />}>
          <Replay key={raceSession.key} season={season} event={event} session={raceSession} bundle={bundle} />
        </Suspense>
      ) : view === 'strategy' && raceSession ? (
        <Suspense fallback={<Lights label="Loading the Strategy Lab" />}>
          <StrategyLab key={raceSession.key} season={season} event={event} bundle={bundle} />
        </Suspense>
      ) : done ? (
        <Overview key={`${year}-${round}`} season={season} previous={prior} event={event} bundle={bundle} timingAvailable={timingAvailable} linked={linked} />
      ) : (
        <Preview key={`${year}-${round}`} season={season} previous={prior} event={event} linked={linked} />
      )}
    </div>
  );
}
