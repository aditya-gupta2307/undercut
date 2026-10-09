/**
 * Beat the model: call the podium before lights out, then see who read the
 * race better — you or the simulation. Picks live only in this browser.
 */

import { useEffect, useMemo, useState } from 'react';
import { useNow, usePriorSeason, useSeasonData } from '../app/data';
import { entryList, useRaceForecast } from '../app/model';
import { useSettings } from '../app/settings';
import { Link, useTitle } from '../app/router';
import { useTeams } from '../app/teams';
import { currentTeams, eventStates, raceTime } from '../data/season';
import type { RaceEvent, Season } from '../data/types';
import { countdown, longDate, pct } from '../lib/format';
import { readStored, writeStored } from '../lib/storage';
import { modelPodium, scorePodium } from '../model/picks';
import { DriverTag, Empty, ErrorNotice, Lights, Panel, Stat } from '../components/ui';
import { RookieNote, Term } from '../components/Term';

interface PickEntry {
  podium: string[];
  madeAt: number;
  /** The model's podium call at the moment you saved yours. */
  model?: string[];
}
type PickBook = Record<string, PickEntry>;

const STORE_KEY = 'picks:v1';

function loadPicks(): PickBook {
  const v = readStored<PickBook>(STORE_KEY)?.value;
  return v && typeof v === 'object' ? v : {};
}

const pickKey = (year: number, round: number) => `${year}:${round}`;

export default function PicksPage() {
  const { season: year } = useSettings();
  useTitle('Beat the model');
  const cur = useSeasonData(year);
  const prior = usePriorSeason(year);
  const now = useNow(1000);
  const [book, setBook] = useState<PickBook>(loadPicks);
  const save = (next: PickBook) => {
    setBook(next);
    writeStored(STORE_KEY, next);
  };

  if (!cur.season) {
    if (cur.error) return <ErrorNotice error={cur.error} onRetry={cur.reload} what={`the ${year} season`} />;
    return <Lights label={`Loading the ${year} season`} />;
  }
  const season = cur.season;
  // Every key below comes from the season actually on screen.
  const y = season.year;
  const open = eventStates(season, now).find((s) => (s.status === 'next' || s.status === 'live') && raceTime(s.event) > now)?.event ?? null;
  const scored = season.events.filter((e) => season.results[e.round]?.length && book[pickKey(y, e.round)]);

  return (
    <div className="stack" style={{ gap: 22 }}>
      <header className="page-head">
        <div className="eyebrow">Prediction game</div>
        <h1>Beat the model</h1>
        <p className="muted" style={{ maxWidth: '68ch' }}>
          Call the podium before lights out. The model makes its call at the same moment. After the race you both score: 10 points for each driver in exactly the
          right place, 4 for a podium finisher in the wrong place, and a 10-point bonus for a perfect podium.
        </p>
      </header>

      {open ? (
        <OpenRace
          key={`${y}-${open.round}`}
          season={season}
          previous={prior}
          event={open}
          now={now}
          entry={book[pickKey(y, open.round)] ?? null}
          onSave={(e) => save({ ...book, [pickKey(y, open.round)]: e })}
        />
      ) : (
        <Empty>No race is open for picks right now — check back before the next Grand Prix.</Empty>
      )}

      <Scorecard key={y} season={season} previous={prior} events={scored} book={book} />
    </div>
  );
}

// ---------------------------------------------------------------------------

function OpenRace({
  season,
  previous,
  event,
  now,
  entry,
  onSave,
}: {
  season: Season;
  previous: Season | null | undefined;
  event: RaceEvent;
  now: number;
  entry: PickEntry | null;
  onSave: (e: PickEntry) => void;
}) {
  const { colour } = useTeams();
  const fc = useRaceForecast(season, previous, event);
  const [draft, setDraft] = useState<string[]>(entry?.podium ?? []);
  const entrants = useMemo(() => {
    const list = entryList(season, event.round).entrants;
    const teams = currentTeams(season);
    // Championship order reads naturally when scanning for a driver.
    const rank = new Map(season.driverStandings.map((s, i) => [s.driverId, i]));
    return list
      .map((e) => ({ ...e, teamId: teams[e.driverId] ?? e.teamId }))
      .sort((a, b) => (rank.get(a.driverId) ?? 99) - (rank.get(b.driverId) ?? 99));
  }, [season, event.round]);
  const model = fc.value ? modelPodium(fc.value.drivers) : null;
  const lockAt = raceTime(event);
  const saved = entry !== null && entry.podium.join() === draft.join();
  const pick = (id: string) => setDraft((d) => (d.includes(id) ? d.filter((x) => x !== id) : d.length >= 3 ? d : [...d, id]));
  const code = (id: string) => season.drivers[id]?.code ?? id;

  return (
    <Panel
      title={`Your call: ${event.name}`}
      sub={`Picks lock at lights out — ${longDate(lockAt)}, in ${countdown(lockAt - now)}`}
      actions={
        <Link to={`/race/${event.season}/${event.round}`} className="btn btn-sm">
          Race preview
        </Link>
      }
    >
      <RookieNote>Pick three drivers in finishing order. Click a slot to clear it. Your picks are saved only in this browser.</RookieNote>
      <div className="stack" style={{ gap: 16 }}>
        <div className="pick-grid" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
          {[0, 1, 2].map((i) => {
            const id = draft[i];
            const e = id ? entrants.find((x) => x.driverId === id) : undefined;
            return (
              <button
                key={i}
                type="button"
                className={`slot ${id ? 'filled' : ''}`}
                onClick={() => id && setDraft((d) => d.filter((x) => x !== id))}
                aria-label={id ? `P${i + 1}: ${code(id)}. Click to clear.` : `P${i + 1}: empty`}
                style={{ textAlign: 'left', color: 'inherit', font: 'inherit', cursor: id ? 'pointer' : 'default' }}
              >
                <span className="slot-pos">P{i + 1}</span>
                {id ? <DriverTag driver={season.drivers[id]} driverId={id} teamId={e?.teamId ?? ''} showTeam /> : <span className="faint">Pick a driver</span>}
                {id ? <span className="faint">✕</span> : <span />}
              </button>
            );
          })}
        </div>
        {entrants.length === 0 ? (
          <Empty>The entry list is not known yet — picks open after the season's first qualifying session.</Empty>
        ) : null}
        <div className="whatif" role="group" aria-label="Drivers">
          {entrants.map((e) => {
            const i = draft.indexOf(e.driverId);
            return (
              <button key={e.driverId} type="button" className="pick-chip" aria-pressed={i >= 0} onClick={() => pick(e.driverId)} disabled={i < 0 && draft.length >= 3}>
                <span className="bar" style={{ background: colour(e.teamId) }} />
                {i >= 0 ? <strong>P{i + 1}</strong> : null}
                {code(e.driverId)}
              </button>
            );
          })}
        </div>
        <div className="row spread" style={{ flexWrap: 'wrap', gap: 10 }}>
          <div className="faint" style={{ fontSize: 'var(--step--1)' }}>
            {model ? (
              <>
                The model's call: <strong style={{ color: 'var(--ink)' }}>{model.map(code).join(' · ')}</strong>
                {fc.value ? ` (favourite ${code(fc.value.drivers[0]!.driverId)} at ${pct(fc.value.drivers[0]!.pWin)} to win)` : ''}
              </>
            ) : fc.computing ? (
              'The model is still thinking…'
            ) : (
              'No model call yet.'
            )}
          </div>
          <div className="row" style={{ gap: 8 }}>
            {saved ? <span className="chip chip-done">Saved</span> : null}
            <button className="btn btn-sm btn-primary" disabled={draft.length !== 3 || saved || now >= lockAt} onClick={() => onSave({ podium: draft, madeAt: Date.now(), model: model ?? undefined })}>
              {entry ? 'Update my picks' : 'Lock in my picks'}
            </button>
          </div>
        </div>
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------------------

function Scorecard({ season, previous, events, book }: { season: Season; previous: Season | null | undefined; events: RaceEvent[]; book: PickBook }) {
  const [totals, setTotals] = useState<Record<number, { you: number; model: number | null }>>({});
  const you = Object.values(totals).reduce((s, t) => s + t.you, 0);
  const model = Object.values(totals).reduce((s, t) => s + (t.model ?? 0), 0);
  if (!events.length) {
    return (
      <Panel title="Your season" sub="Scores appear here after each race you picked">
        <Empty>No scored picks yet. Make a call on the next race and come back after the chequered flag.</Empty>
      </Panel>
    );
  }
  return (
    <Panel title="Your season" sub={`${events.length} ${events.length === 1 ? 'race' : 'races'} picked`} flush>
      <div className="stats" style={{ margin: 18 }}>
        <Stat label="You" value={String(you)} note="points" />
        <Stat label="The model" value={String(model)} note="points" />
        <Stat label="Verdict" value={you > model ? 'You lead' : you < model ? 'Model leads' : 'All square'} note={`by ${Math.abs(you - model)}`} />
      </div>
      <div className="table-wrap">
        <table className="data-table">
          <caption className="sr-only">Your podium picks against the model's</caption>
          <thead>
            <tr>
              <th scope="col">Race</th>
              <th scope="col">Podium</th>
              <th scope="col">Your call</th>
              <th scope="col" className="r">
                You
              </th>
              <th scope="col">Model's call</th>
              <th scope="col" className="r">
                Model
              </th>
            </tr>
          </thead>
          <tbody>
            {events.map((e) => {
              const entry = book[pickKey(season.year, e.round)];
              if (!entry) return null;
              return (
                <ScoreRow
                  key={e.round}
                  season={season}
                  previous={previous}
                  event={e}
                  entry={entry}
                  onScore={(y, m) => setTotals((t) => (t[e.round]?.you === y && t[e.round]?.model === m ? t : { ...t, [e.round]: { you: y, model: m } }))}
                />
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="faint" style={{ fontSize: 'var(--step--2)', padding: '8px 18px 14px' }}>
        The model's call is the one it made when you saved your picks; for older picks, its <Term id="lights-out">race-day</Term> call.
      </p>
    </Panel>
  );
}

function ScoreRow({ season, previous, event, entry, onScore }: { season: Season; previous: Season | null | undefined; event: RaceEvent; entry: PickEntry; onScore: (you: number, model: number | null) => void }) {
  const fc = useRaceForecast(entry.model ? null : season, previous, entry.model ? null : event);
  const actual = (season.results[event.round] ?? [])
    .filter((r) => r.position !== null)
    .sort((a, b) => a.position! - b.position!)
    .map((r) => r.driverId);
  const late = entry.madeAt > raceTime(event);
  const modelCall = entry.model ?? (fc.value ? modelPodium(fc.value.drivers) : null);
  const youScore = late ? 0 : scorePodium(entry.podium, actual);
  const modelScore = modelCall ? scorePodium(modelCall, actual) : null;
  // Report upwards whenever the numbers change; the parent ignores repeats.
  useEffect(() => {
    onScore(youScore, modelScore);
  }, [youScore, modelScore]);
  const code = (id: string) => season.drivers[id]?.code ?? id;
  const mark = (id: string, i: number) => (actual[i] === id ? 'delta-up' : actual.slice(0, 3).includes(id) ? '' : 'faint');
  return (
    <tr>
      <td>
        <Link to={`/race/${event.season}/${event.round}`}>R{event.round}</Link> <span className="faint">{event.name.replace(/ Grand Prix.*/, '')}</span>
      </td>
      <td className="num">{actual.slice(0, 3).map(code).join(' · ')}</td>
      <td className="num">
        {entry.podium.map((id, i) => (
          <span key={id} className={mark(id, i)}>
            {i ? ' · ' : ''}
            {code(id)}
          </span>
        ))}
        {late ? <span className="faint"> (late)</span> : null}
      </td>
      <td className="r num">
        <strong>{youScore}</strong>
      </td>
      <td className="num">
        {modelCall
          ? modelCall.map((id, i) => (
              <span key={id} className={mark(id, i)}>
                {i ? ' · ' : ''}
                {code(id)}
              </span>
            ))
          : '…'}
      </td>
      <td className="r num">{modelScore ?? '…'}</td>
    </tr>
  );
}
