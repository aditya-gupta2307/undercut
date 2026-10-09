/**
 * Drivers: car or driver? The ranking model split into the car's share and
 * the driver's, with honest error bars — plus the raw teammate head-to-heads
 * it is built on, and a profile for any driver.
 */

import { useMemo, useState } from 'react';
import { useComputed, usePriorSeason, useSeasonData } from '../app/data';
import { configKey, useModelConfig } from '../app/model';
import { useSettings } from '../app/settings';
import { Link, setQuery, useRoute, useTitle } from '../app/router';
import { useTeams } from '../app/teams';
import { currentTeams } from '../data/season';
import { lineageRoot } from '../data/teams';
import type { Season } from '../data/types';
import { pct, plural } from '../lib/format';
import { fitRatings, teammateDuels, type RatingsResult, type TeammateDuel } from '../model/ratings';
import { DriverTag, Empty, ErrorNotice, Lights, Panel, Segmented, Stat } from '../components/ui';
import { Term, RookieNote } from '../components/Term';

const Z90 = 1.645;

export default function DriversPage() {
  const { season: year } = useSettings();
  useTitle('Drivers');
  const cur = useSeasonData(year);
  const prior = usePriorSeason(year);
  const { config } = useModelConfig();
  const route = useRoute();
  const [kind, setKind] = useState<'race' | 'quali'>('race');
  const stampOf = (s: Season | null) => (s ? `${s.year}@${s.fetchedAt}` : 'none');
  const ready = cur.season !== null && prior !== undefined && Object.keys(cur.season.results).length > 0;
  const ratings = useComputed<RatingsResult>(ready ? `ratings:${kind}:${stampOf(cur.season)}:${stampOf(prior ?? null)}:${configKey(config)}` : null, () =>
    fitRatings(prior ? [prior, cur.season!] : [cur.season!], year, Date.now(), config, currentTeams(cur.season!), kind),
  );

  if (!cur.season) {
    if (cur.error) return <ErrorNotice error={cur.error} onRetry={cur.reload} what={`the ${year} season`} />;
    return <Lights label={`Loading the ${year} season`} />;
  }
  const season = cur.season;
  const selected = route.query.get('d');

  return (
    <div className="stack" style={{ gap: 22 }}>
      <header className="page-head">
        <div className="eyebrow">{year} drivers</div>
        <h1>Car or driver?</h1>
        <p className="muted" style={{ maxWidth: '72ch' }}>
          A fast car flatters anyone. The model splits every result into the car's share and the driver's: teammates share a car, so beating the person in identical
          machinery is the only way to score as a driver. Drivers who changed teams link the cars together.
        </p>
      </header>

      {selected && season.drivers[selected] ? <Profile season={season} driverId={selected} /> : null}

      {!Object.keys(season.results).length ? (
        <Empty>Ratings appear after the first race of the season.</Empty>
      ) : (
        <div className="grid">
          <Panel
            className="span-7"
            title="Driver ratings"
            sub={`Driver's share of ${kind === 'race' ? 'race' : 'qualifying'} pace, car removed · bars are 90% intervals`}
            actions={
              <Segmented
                label="Pace"
                value={kind}
                onChange={setKind}
                options={[
                  { value: 'race', label: 'Race' },
                  { value: 'quali', label: 'Qualifying' },
                ]}
              />
            }
            flush
          >
            <RookieNote>
              Zero is an average driver in the same car. The percentage is the model's chance this driver beats an average driver given identical machinery. Wide
              bars mean little evidence — a rookie, or a pair of teammates who rarely finish near each other.
            </RookieNote>
            {ratings.error ? (
              <div style={{ padding: 18 }}>
                <ErrorNotice error={ratings.error} what="the ratings" />
              </div>
            ) : ratings.computing || !ratings.value ? (
              <Lights label="Separating cars from drivers" />
            ) : (
              <DriverRatings season={season} res={ratings.value} selected={selected} />
            )}
          </Panel>
          <Panel className="span-5" title="Car ratings" sub="The team's share of the same strength scale" flush>
            {ratings.computing || !ratings.value ? <Lights label="Rating the cars" /> : <CarRatings season={season} res={ratings.value} />}
          </Panel>
        </div>
      )}

      <Panel title="Teammate battles" sub="Head-to-heads between drivers in the same car this season" flush>
        <Duels season={season} selected={selected} />
      </Panel>
    </div>
  );
}

// ---------------------------------------------------------------------------

function Interval({ mean, sd, lo, hi, colour }: { mean: number; sd: number; lo: number; hi: number; colour: string }) {
  const x = (v: number) => `${((Math.max(lo, Math.min(hi, v)) - lo) / (hi - lo)) * 100}%`;
  const a = Number.isFinite(sd) ? mean - Z90 * sd : mean;
  const b = Number.isFinite(sd) ? mean + Z90 * sd : mean;
  return (
    <div className="range-html" style={{ height: 22 }}>
      <span className="range-zero" style={{ left: x(0) }} />
      <span className="range-bar" style={{ left: x(a), width: `calc(${x(b)} - ${x(a)})`, background: colour, top: 8 }} />
      <span className="range-mid" style={{ left: x(mean), borderColor: colour, top: 5 }} />
    </div>
  );
}

function DriverRatings({ season, res, selected }: { season: Season; res: RatingsResult; selected: string | null }) {
  const span = Math.max(0.5, ...res.drivers.map((d) => Math.abs(d.mean) + Z90 * (Number.isFinite(d.sd) ? d.sd : 0)));
  const { colour } = useTeams();
  return (
    <div style={{ padding: '6px 0 12px' }}>
      <div className="rating-row faint" style={{ fontSize: 'var(--step--2)', paddingTop: 6, paddingBottom: 6 }} aria-hidden="true">
        <span />
        <span className="row spread">
          <span>← slower than teammate level</span>
          <span>faster →</span>
        </span>
        <span className="r">vs avg.</span>
      </div>
      {res.drivers.map((d) => (
        <div key={d.id} className={`rating-row ${selected === d.id ? 'is-selected' : ''}`}>
          <DriverTag driver={season.drivers[d.id]} driverId={d.id} teamId={d.teamId} link />
          <Interval mean={d.mean} sd={d.sd} lo={-span} hi={span} colour={colour(d.teamId)} />
          <span className="num r" title={`${pct(d.vsTeamAverage)} chance to beat an average driver in the same car`}>
            {pct(d.vsTeamAverage, 0)}
          </span>
        </div>
      ))}
    </div>
  );
}

function CarRatings({ season, res }: { season: Season; res: RatingsResult }) {
  const { colour, name } = useTeams();
  // Model keys are team lineages ("sauber" covers Audi); show this season's name.
  const current = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of Object.values(currentTeams(season))) m.set(lineageRoot(t), t);
    return m;
  }, [season]);
  const rows = res.teams.filter((t) => current.has(t.id));
  if (!rows.length) return <Empty>No cars to rate yet.</Empty>;
  const lo = Math.min(...rows.map((t) => t.mean - Z90 * (Number.isFinite(t.sd) ? t.sd : 0)));
  const hi = Math.max(...rows.map((t) => t.mean + Z90 * (Number.isFinite(t.sd) ? t.sd : 0)));
  const pad = (hi - lo) * 0.05 || 0.5;
  return (
    <div style={{ padding: '10px 0 12px' }}>
      {rows.map((t) => {
        const teamId = current.get(t.id)!;
        return (
          <div key={t.id} className="rating-row">
            <span className="driver-tag">
              <span className="bar" style={{ background: colour(teamId) }} aria-hidden="true" />
              <span className="name" style={{ fontWeight: 500 }}>
                {name(teamId)}
              </span>
            </span>
            <Interval mean={t.mean} sd={t.sd} lo={lo - pad} hi={hi + pad} colour={colour(teamId)} />
            <span className="num r faint">{t.mean >= 0 ? '+' : '−'}{Math.abs(t.mean).toFixed(2)}</span>
          </div>
        );
      })}
      <p className="faint" style={{ fontSize: 'var(--step--2)', padding: '8px 18px 0' }}>
        Log-strength relative to the field. One unit ≈ 2.7× the chance of beating a rival car, all else equal.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------

function Duels({ season, selected }: { season: Season; selected: string | null }) {
  const { colour } = useTeams();
  const duels = useMemo(() => teammateDuels(season).sort((a, b) => b.qualiA + b.qualiB - (a.qualiA + a.qualiB)), [season]);
  if (!duels.length) return <Empty>Head-to-heads appear after the first qualifying session.</Empty>;
  return (
    <div>
      {duels.map((d) => (
        <DuelRow key={`${d.teamId}-${d.a}-${d.b}`} duel={d} season={season} colour={colour(d.teamId)} selected={selected} />
      ))}
    </div>
  );
}

function SplitBar({ a, b, colour, label }: { a: number; b: number; colour: string; label: string }) {
  const total = a + b;
  return (
    <div className="stack" style={{ gap: 3 }}>
      <div className="row spread num" style={{ fontSize: 'var(--step--1)' }}>
        <strong>{a}</strong>
        <span className="faint" style={{ fontSize: 'var(--step--2)' }}>
          {label}
        </span>
        <strong>{b}</strong>
      </div>
      <div className="split-bar" role="img" aria-label={`${label}: ${a} to ${b}`}>
        {total ? (
          <>
            <span style={{ width: `${(a / total) * 100}%`, background: colour }} />
            <span style={{ width: `${(b / total) * 100}%`, background: 'var(--surface-3)' }} />
          </>
        ) : (
          <span style={{ width: '100%', background: 'var(--surface-3)' }} />
        )}
      </div>
    </div>
  );
}

function DuelRow({ duel, season, colour, selected }: { duel: TeammateDuel; season: Season; colour: string; selected: string | null }) {
  const gap = duel.medianGapPct;
  const faster = gap === null ? null : gap > 0 ? duel.b : duel.a;
  const isSel = selected === duel.a || selected === duel.b;
  return (
    <div className={`duel ${isSel ? 'is-selected' : ''}`}>
      <div className="row" style={{ gap: 8 }}>
        <DriverTag driver={season.drivers[duel.a]} driverId={duel.a} teamId={duel.teamId} link />
        <span className="faint num" style={{ fontSize: 'var(--step--1)' }}>
          {duel.pointsA} pts
        </span>
      </div>
      <div className="stack" style={{ gap: 8 }}>
        <SplitBar a={duel.qualiA} b={duel.qualiB} colour={colour} label="Quali" />
        <SplitBar a={duel.raceA} b={duel.raceB} colour={colour} label="Race" />
        {gap !== null ? (
          <div className="faint" style={{ fontSize: 'var(--step--2)', textAlign: 'center' }}>
            {season.drivers[faster!]?.code ?? faster} quicker by {Math.abs(gap).toFixed(2)}% · median of {plural(duel.gaps, 'session')}
          </div>
        ) : null}
      </div>
      <div className="row side-b" style={{ gap: 8 }}>
        <span className="faint num" style={{ fontSize: 'var(--step--1)' }}>
          {duel.pointsB} pts
        </span>
        <DriverTag driver={season.drivers[duel.b]} driverId={duel.b} teamId={duel.teamId} link />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function Profile({ season, driverId }: { season: Season; driverId: string }) {
  const { colour, name } = useTeams();
  const d = season.drivers[driverId]!;
  const teamId = currentTeams(season)[driverId] ?? '';
  const stats = useMemo(() => {
    const rows = season.events
      .map((e) => ({ e, r: season.results[e.round]?.find((x) => x.driverId === driverId) ?? null, q: season.qualifying[e.round]?.find((x) => x.driverId === driverId) ?? null }))
      .filter((x) => x.r || x.q);
    const finished = rows.filter((x) => x.r?.finish === 'finished' && x.r.position !== null);
    const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
    const standing = season.driverStandings.find((s) => s.driverId === driverId);
    return {
      rows,
      starts: rows.filter((x) => x.r && x.r.finish !== 'dns').length,
      wins: rows.filter((x) => x.r?.position === 1).length,
      podiums: rows.filter((x) => x.r?.position !== null && x.r?.position !== undefined && x.r.position <= 3).length,
      dnfs: rows.filter((x) => x.r?.finish === 'dnf').length,
      avgFinish: avg(finished.map((x) => x.r!.position!)),
      avgGrid: avg(rows.filter((x) => x.q).map((x) => x.q!.position)),
      standing,
    };
  }, [season, driverId]);
  const age = d.dateOfBirth ? Math.floor((Date.now() - Date.parse(d.dateOfBirth)) / (365.25 * 86_400_000)) : null;
  return (
    <Panel
      title={`${d.givenName} ${d.familyName}`}
      sub={`${d.permanentNumber !== null ? `#${d.permanentNumber} · ` : ''}${name(teamId)} · ${d.nationality}${age !== null ? ` · ${age}` : ''}`}
      actions={
        <button className="btn btn-sm btn-ghost" onClick={() => setQuery({ d: null })}>
          Close
        </button>
      }
    >
      <div className="stack" style={{ gap: 16 }}>
        <div className="stats">
          <Stat label="Championship" value={stats.standing ? `P${stats.standing.position ?? stats.standing.positionText}` : '–'} note={stats.standing ? `${stats.standing.points} points` : undefined} />
          <Stat label="Wins · podiums" value={`${stats.wins} · ${stats.podiums}`} note={`from ${plural(stats.starts, 'start')}`} />
          <Stat label="Average finish" value={stats.avgFinish !== null ? stats.avgFinish.toFixed(1) : '–'} note="when classified" />
          <Stat label="Average qualifying" value={stats.avgGrid !== null ? stats.avgGrid.toFixed(1) : '–'} />
          <Stat label={<Term id="dnf">Retirements</Term>} value={String(stats.dnfs)} />
        </div>
        <div>
          <div className="eyebrow" style={{ marginBottom: 8 }}>
            Every round
          </div>
          <ol className="form-strip" aria-label="Finishing position at each round">
            {stats.rows.map(({ e, r, q }) => {
              const pos = r?.position ?? null;
              const label = r ? (r.finish === 'finished' && pos !== null ? `P${pos}` : r.finish.toUpperCase()) : '–';
              const tone = pos === 1 ? 'win' : pos !== null && pos <= 3 ? 'podium' : pos !== null && pos <= 10 ? 'points' : r && r.finish !== 'finished' ? 'out' : '';
              return (
                <li key={e.round}>
                  <Link to={`/race/${e.season}/${e.round}`} className={`form-cell ${tone}`} title={`${e.name}: ${label}${q ? ` · qualified P${q.position}` : ''}`} style={tone === 'win' ? { borderColor: colour(teamId) } : undefined}>
                    <span className="form-round">R{e.round}</span>
                    <span className="form-pos">{label}</span>
                  </Link>
                </li>
              );
            })}
          </ol>
        </div>
      </div>
    </Panel>
  );
}
