/**
 * Pit Wall: the home page. What is next, what the model thinks will happen,
 * where the title fight stands, and how the last race went.
 */

import { useMemo } from 'react';
import { useSettings } from '../app/settings';
import { useF1Index, useNow, usePriorSeason, useSeasonData } from '../app/data';
import { useChampionship, useRaceForecast } from '../app/model';
import { Link, useTitle } from '../app/router';
import { useTeams } from '../app/teams';
import { eventStates, isSeasonComplete, type EventState } from '../data/season';
import { linkSessions } from '../data/link';
import type { RaceEvent, Season } from '../data/types';
import { sessionList } from '../data/weekend';
import { clock, countdown, longDate, pct, trackClock } from '../lib/format';
import { DriverTag, ErrorNotice, Lights, Notice, Panel, ProbBar } from '../components/ui';
import { ForecastTable } from '../components/ForecastTable';
import { TrackMap } from '../components/TrackMap';
import { Term, RookieNote } from '../components/Term';
import { RACE_POINTS } from '../model/config';

function NextRace({ state, season, gmtOffset, circuitKey, now }: { state: EventState; season: Season; gmtOffset: string | null; circuitKey: number | null; now: number }) {
  const e = state.event;
  const sessions = sessionList(e);
  const upcoming = sessions.find((s) => s.end > now);
  const running = upcoming && upcoming.at <= now;
  return (
    <section className="hero" aria-label="Next race">
      <div className="hero-text">
        <div className="row">
          <span className="eyebrow">
            Round {e.round} of {season.events.length}
          </span>
          {state.status === 'live' ? <span className="chip chip-live">Race weekend</span> : <span className="chip chip-accent">Next race</span>}
          {e.hasSprint ? (
            <span className="chip">
              <Term id="sprint">Sprint</Term> weekend
            </span>
          ) : null}
        </div>
        <h1 className="hero-title">{e.name.replace(/ Grand Prix/, '')}</h1>
        <div className="hero-sub">
          {e.circuit.name} · {e.circuit.locality}, {e.circuit.country}
        </div>
        {upcoming ? (
          <div className="countdown" aria-live="off">
            <div className="countdown-label">{running ? `${upcoming.label} is running` : `${upcoming.label} starts in`}</div>
            <div className="countdown-value">{running ? 'Live now' : countdown(upcoming.at - now)}</div>
          </div>
        ) : (
          <div className="countdown">
            <div className="countdown-label">Results are on their way</div>
          </div>
        )}
        <ol className="schedule" aria-label="Weekend schedule">
          {sessions.map((s) => {
            const done = s.end < now;
            const live = s.at <= now && now <= s.end;
            return (
              <li key={s.key} className={done ? 'done' : live ? 'live' : ''}>
                <span className="sched-name">{s.label}</span>
                <span className="sched-day">{longDate(s.at)}</span>
                <span className="sched-time num">{clock(s.at)}</span>
                {gmtOffset ? <span className="sched-local num faint" title="Local time at the circuit">{trackClock(s.at, gmtOffset)} local</span> : null}
              </li>
            );
          })}
        </ol>
      </div>
      <div className="hero-track">
        <TrackMap circuitKey={circuitKey} height={300} car label={`${e.circuit.name} layout`} />
        <div className="faint hero-track-note">Drawn from real car-position data</div>
      </div>
    </section>
  );
}

function SeasonOver({ season, complete }: { season: Season; complete: boolean }) {
  const champ = season.driverStandings[0];
  const d = champ ? season.drivers[champ.driverId] : undefined;
  if (!complete) {
    // The finale has been run but its results are not published yet: no champion to crown.
    return (
      <section className="hero hero-done" aria-label="Season summary">
        <div className="hero-text">
          <span className="eyebrow">{season.year} season finale</span>
          <h1 className="hero-title">Chequered flag</h1>
          <div className="hero-sub">The last race of the year has been run. The champion is crowned here as soon as the results are published.</div>
        </div>
      </section>
    );
  }
  return (
    <section className="hero hero-done" aria-label="Season summary">
      <div className="hero-text">
        <span className="eyebrow">{season.year} season complete</span>
        <h1 className="hero-title">{d ? `${d.givenName} ${d.familyName}` : 'Season complete'}</h1>
        {champ ? (
          <div className="hero-sub">
            World Champion with {champ.points} points and {champ.wins} wins. Browse every race in the <Link to="/season">season view</Link>.
          </div>
        ) : null}
      </div>
    </section>
  );
}

function TitleMini({ current, previous }: { current: Season; previous: Season | null | undefined }) {
  const title = useChampionship(current, previous);
  const { colour } = useTeams();
  if (title.error) return <ErrorNotice error={title.error} what="the title simulation" />;
  if (title.computing) return <Lights label="Simulating the rest of the season" />;
  if (!title.value) return <div className="empty">Title odds appear after the first race of the season.</div>;
  const contenders = title.value.drivers.filter((d) => d.pChampion > 0.001).slice(0, 5);
  if (title.value.remaining.length === 0) return <div className="empty">No races left to simulate.</div>;
  return (
    <div className="stack" style={{ gap: 10 }}>
      {contenders.map((d) => (
        <div key={d.driverId} className="title-row">
          <DriverTag driver={current.drivers[d.driverId]} driverId={d.driverId} teamId={d.teamId} />
          <ProbBar p={d.pChampion} colour={colour(d.teamId)} label={`${d.driverId} title chance`} />
          <span className="num faint title-pts">{d.currentPoints} pts</span>
        </div>
      ))}
      <div className="faint" style={{ fontSize: 'var(--step--1)' }}>
        {title.value.sims.toLocaleString()} simulated finishes to the season, {title.value.remaining.length} sessions still to run.{' '}
        <Link to="/title">Full title odds →</Link>
      </div>
    </div>
  );
}

function LastRace({ current, previous, event }: { current: Season; previous: Season | null | undefined; event: RaceEvent }) {
  const rows = current.results[event.round] ?? [];
  const podium = rows.filter((r) => r.position !== null && r.position <= 3).sort((a, b) => a.position! - b.position!);
  const fc = useRaceForecast(current, previous, event);
  const winner = podium[0];
  const pWinner = winner && fc.value ? fc.value.drivers.find((d) => d.driverId === winner.driverId)?.pWin ?? null : null;
  const favourite = fc.value?.drivers[0];
  return (
    <div className="stack" style={{ gap: 12 }}>
      <div>
        <div className="eyebrow">Round {event.round}</div>
        <h3 style={{ marginTop: 4 }}>
          <Link to={`/race/${event.season}/${event.round}`} className="plain-link">
            {event.name}
          </Link>
        </h3>
      </div>
      <ol className="podium">
        {podium.map((r) => (
          <li key={r.driverId}>
            <span className="pos">P{r.position}</span>
            <DriverTag driver={current.drivers[r.driverId]} driverId={r.driverId} teamId={r.teamId} showTeam />
            <span className="num faint">{r.timeText ?? ''}</span>
          </li>
        ))}
      </ol>
      {fc.computing ? (
        <div className="faint" style={{ fontSize: 'var(--step--1)' }}>Checking what the model said beforehand…</div>
      ) : pWinner !== null && favourite && winner ? (
        <p className="muted" style={{ fontSize: 'var(--step--1)' }}>
          Before lights out the model gave {current.drivers[winner.driverId]?.familyName ?? winner.driverId} a {pct(pWinner)} chance
          {favourite.driverId === winner.driverId ? ' — its favourite.' : `; its favourite was ${current.drivers[favourite.driverId]?.familyName ?? favourite.driverId} at ${pct(favourite.pWin)}.`}
        </p>
      ) : null}
      <Link to={`/race/${event.season}/${event.round}`} className="btn btn-sm" style={{ alignSelf: 'flex-start' }}>
        Race centre: swing chart, strategy, replay →
      </Link>
    </div>
  );
}

export default function PitWall() {
  useTitle('');
  const { season: year } = useSettings();
  const cur = useSeasonData(year);
  const prior = usePriorSeason(year);
  const idx = useF1Index(year);
  const now = useNow(1000);

  const states = useMemo(() => (cur.season ? eventStates(cur.season, now) : []), [cur.season, Math.floor(now / 60_000)]);
  const next = states.find((s) => s.status === 'live' || s.status === 'next') ?? null;
  const awaiting = states.find((s) => s.status === 'awaiting-results') ?? null;
  const last = [...states].reverse().find((s) => s.status === 'completed') ?? null;
  const link = next && idx.data && cur.season ? linkSessions(next.event, idx.data.meetings, idx.data.sessions) : null;
  const forecastEvent = next?.event ?? null;
  const fc = useRaceForecast(cur.season, prior, forecastEvent);

  if (!cur.season) {
    if (cur.error) return <ErrorNotice error={cur.error} onRetry={cur.reload} what={`the ${year} season`} />;
    return <Lights label={`Loading the ${year} season`} />;
  }
  const season = cur.season;

  return (
    <div className="stack" style={{ gap: 24 }}>
      {cur.error ? <ErrorNotice error={cur.error} onRetry={cur.reload} what="the latest results" /> : null}
      {season.events.length === 0 ? (
        <Notice>The {year} calendar has not been published yet. Pick last season in the top bar to explore it.</Notice>
      ) : next ? (
        <NextRace state={next} season={season} gmtOffset={link?.meeting.gmtOffset ?? null} circuitKey={link?.meeting.circuitKey ?? null} now={now} />
      ) : (
        <SeasonOver season={season} complete={isSeasonComplete(season, now)} />
      )}
      {awaiting ? (
        <Notice>
          The {awaiting.event.name} has finished; results appear here as soon as they are published (usually within a few hours).
        </Notice>
      ) : null}

      <div className="grid">
        {next ? (
          <Panel
            className="span-8"
            title="The model's call"
            sub={
              fc.value
                ? `${fc.value.models.config.sims.toLocaleString()} simulated races · ${
                    fc.value.gridKnown ? 'grid set by qualifying' : 'qualifying simulated too'
                  } · trained on ${fc.value.models.training.weekends} weekends`
                : fc.computing
                  ? 'Fitting the model…'
                  : fc.error
                    ? 'The forecast could not be computed'
                    : 'Waiting for the entry list'
            }
            actions={
              <Link to="/picks" className="btn btn-sm btn-primary">
                Beat the model
              </Link>
            }
            flush
            foot={
              <>
                A <Term id="plackett-luce">Plackett–Luce</Term> ranking model with a team + driver split, recency weighting and a
                retirement model. <Link to="/model">See how well it has done this season →</Link>
              </>
            }
          >
            <RookieNote>
              Each percentage is how often that driver won (or reached the podium, or scored) when the model replayed this race{' '}
              {fc.value?.models.config.sims.toLocaleString() ?? 'thousands of'} times. Big favourites still lose: 40% means losing more often than winning.
            </RookieNote>
            {fc.error ? (
              <div style={{ padding: 18 }}>
                <ErrorNotice error={fc.error} what="the forecast" />
              </div>
            ) : fc.computing ? (
              <Lights label="Simulating the race" />
            ) : !fc.value ? (
              <div className="empty">The forecast appears once the entry list is known — after the season's first qualifying session.</div>
            ) : (
              <ForecastTable season={season} forecast={fc.value.drivers} showPole={!fc.value.gridKnown} />
            )}
          </Panel>
        ) : null}

        <div className={`stack ${next ? 'span-4' : 'span-12'}`}>
          <Panel title="Title fight" sub="Probability of becoming champion">
            <TitleMini current={season} previous={prior} />
          </Panel>
          {last ? (
            <Panel title="Last race">
              <LastRace current={season} previous={prior} event={last.event} />
            </Panel>
          ) : null}
          <Panel title="Points, at a glance">
            <p className="muted" style={{ fontSize: 'var(--step--1)' }}>
              A <Term id="grand-prix">Grand Prix</Term> pays {RACE_POINTS.join(' · ')} to the top ten. New to all this?{' '}
              <Link to="/learn">Learn F1 in five minutes</Link>, or switch on <strong>Rookie</strong> mode up top to have every term explained in place.
            </p>
          </Panel>
        </div>
      </div>
    </div>
  );
}
