/**
 * Model Lab: how the forecasts work, how good they have been this season
 * (a walk-forward backtest against honest baselines), and the knobs to tune.
 */

import { useMemo, useState, type ReactNode } from 'react';
import { usePriorSeason, useSeasonData } from '../app/data';
import { useJob, type JobState } from '../app/jobs';
import { configKey, useModelConfig } from '../app/model';
import { useSettings } from '../app/settings';
import { Link, useTitle } from '../app/router';
import type { Season } from '../data/types';
import { pct } from '../lib/format';
import { DEFAULT_CONFIG, type ModelConfig } from '../model/config';
import { runBacktest, tuneRecency, type BacktestResult, type TuneCandidate, type VariantScore } from '../model/backtest';
import { skill } from '../model/metrics';
import { CalibrationChart } from '../components/charts/CalibrationChart';
import { DriverTag, Empty, ErrorNotice, Lights, Panel, Segmented, Stat } from '../components/ui';
import { Term, RookieNote } from '../components/Term';

function stamp(s: Season | null): string {
  return s ? `${s.year}@${s.fetchedAt}` : 'none';
}

export default function ModelLab() {
  const { season: year } = useSettings();
  useTitle('Model Lab');
  const cur = useSeasonData(year);
  const prior = usePriorSeason(year);
  const { config } = useModelConfig();
  const seasons = useMemo(() => (cur.season && prior !== undefined ? (prior ? [prior, cur.season] : [cur.season]) : null), [cur.season, prior]);
  const ready = seasons !== null;
  const bt = useJob<BacktestResult>(ready ? `backtest:${stamp(cur.season)}:${stamp(prior ?? null)}:${configKey(config)}` : null, (progress, cancelled) =>
    runBacktest(seasons!, year, { config, sims: Math.min(config.sims, 4000), onProgress: progress, cancelled }),
  );

  if (!cur.season) {
    if (cur.error) return <ErrorNotice error={cur.error} onRetry={cur.reload} what={`the ${year} season`} />;
    return <Lights label={`Loading the ${year} season`} />;
  }

  return (
    <div className="stack" style={{ gap: 22 }}>
      <header className="page-head">
        <div className="eyebrow">Under the hood</div>
        <h1>Model Lab</h1>
        <p className="muted" style={{ maxWidth: '72ch' }}>
          Every forecast on this site comes from one model, fitted in your browser from scratch. This page shows how it works and — more importantly — how well it
          has actually done: each {year} race was re-forecast using only what was known beforehand, then scored against what happened.
        </p>
      </header>

      <ReportCard bt={bt} season={cur.season} />
      <HowItWorks config={config} />
      <Knobs seasons={seasons} year={year} />
    </div>
  );
}

// ---------------------------------------------------------------------------

function Progress({ done, total, label }: { done: number; total: number; label: string }) {
  return (
    <div className="stack" style={{ gap: 10, padding: '18px 0' }}>
      <div className="faint" style={{ fontSize: 'var(--step--1)' }}>
        {label}
        {total ? ` · ${done} of ${total}` : '…'}
      </div>
      <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={total || 1} aria-valuenow={done} aria-label={label}>
        <div style={{ width: `${total ? (done / total) * 100 : 3}%` }} />
      </div>
    </div>
  );
}

const METRICS: { key: keyof Pick<VariantScore, 'winLogLoss' | 'winBrier' | 'podiumBrier' | 'pointsBrier' | 'favouriteHit'>; label: ReactNode; better: 'low' | 'high'; fmt: (v: number) => string }[] = [
  { key: 'winLogLoss', label: <Term id="log-loss">Winner log loss</Term>, better: 'low', fmt: (v) => v.toFixed(3) },
  { key: 'winBrier', label: <><Term id="brier">Brier</Term>: win</>, better: 'low', fmt: (v) => v.toFixed(4) },
  { key: 'podiumBrier', label: 'Brier: podium', better: 'low', fmt: (v) => v.toFixed(4) },
  { key: 'pointsBrier', label: 'Brier: points', better: 'low', fmt: (v) => v.toFixed(4) },
  { key: 'favouriteHit', label: 'Favourite won', better: 'high', fmt: (v) => pct(v, 0) },
];

function ReportCard({ bt, season }: { bt: JobState<BacktestResult>; season: Season }) {
  const [calib, setCalib] = useState<'win' | 'podium'>('win');
  if (!Object.keys(season.results).length) {
    return (
      <Panel title="Report card">
        <Empty>The report card fills in after the first race of the season.</Empty>
      </Panel>
    );
  }
  if (bt.error) return <ErrorNotice error={bt.error} what="the backtest" />;
  if (bt.running || !bt.data) {
    return (
      <Panel title="Report card" sub="Re-forecasting every race with only the data available beforehand">
        <Progress done={bt.done} total={bt.total} label="Refitting the model race by race" />
      </Panel>
    );
  }
  const res = bt.data;
  const by = new Map(res.scores.map((s) => [s.variant, s]));
  const model = by.get('raceDay');
  const uniform = by.get('uniform');
  const grid = by.get('grid');
  const avgP = res.races.length ? res.races.reduce((s, r) => s + (r.winnerId ? r.raceDay.get(r.winnerId)?.pWin ?? 0 : 0), 0) / res.races.length : 0;

  return (
    <>
      <div className="stats">
        <Stat label="Races scored" value={String(res.races.length)} note={`${res.season} season, walk-forward`} />
        <Stat label="Favourite won" value={model ? pct(model.favouriteHit, 0) : '–'} note={model ? `${Math.round(model.favouriteHit * model.races)} of ${model.races} races` : undefined} />
        <Stat label="Average chance given to the winner" value={pct(avgP)} note={uniform ? `Guessing would give ${pct(1 / Math.max(1, res.races[0]?.entrants.length ?? 20))}` : undefined} />
        <Stat
          label={<>Skill vs <Term id="baseline">guessing</Term></>}
          value={model && uniform ? pct(skill(model.winLogLoss, uniform.winLogLoss), 0) : '–'}
          note="Reduction in winner log loss"
        />
        <Stat label="Skill vs grid order" value={model && grid ? pct(skill(model.winLogLoss, grid.winLogLoss), 0) : '–'} note="Positive = better than the grid alone" />
      </div>

      <Panel title="Scoreboard" sub="Lower is better for log loss and Brier scores; the best in each column is highlighted" flush>
        <RookieNote>
          <Term id="log-loss">Log loss</Term> punishes being confidently wrong: it asks how surprised the forecast was by each actual winner.{' '}
          <Term id="brier">Brier score</Term> is the average squared error of every probability. The baselines keep the model honest: one assumes anyone can win,
          the other that the grid order is everything.
        </RookieNote>
        <div className="table-wrap">
          <table className="data-table scoreboard">
            <caption className="sr-only">Forecast accuracy by method</caption>
            <thead>
              <tr>
                <th scope="col">Forecast</th>
                {METRICS.map((m) => (
                  <th key={m.key} scope="col" className="r">
                    {m.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {res.scores.map((s) => (
                <tr key={s.variant}>
                  <th scope="row" style={{ fontWeight: s.variant === 'raceDay' ? 600 : 400 }}>
                    {s.label}
                  </th>
                  {METRICS.map((m) => {
                    const vals = res.scores.map((x) => x[m.key]);
                    const best = m.better === 'low' ? Math.min(...vals) : Math.max(...vals);
                    return (
                      <td key={m.key} className={`r num ${s[m.key] === best ? 'best' : ''}`}>
                        {m.fmt(s[m.key])}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <div className="grid">
        <Panel
          className="span-6"
          title={<Term id="calibration">Calibration</Term>}
          sub="When the model says 30%, does it happen 30% of the time?"
          actions={
            <Segmented
              label="Outcome"
              value={calib}
              onChange={setCalib}
              options={[
                { value: 'win', label: 'Win' },
                { value: 'podium', label: 'Podium' },
              ]}
            />
          }
        >
          <CalibrationChart bins={res.calibration[calib]} label={calib} />
          <p className="faint" style={{ fontSize: 'var(--step--1)', marginTop: 8 }}>
            Dot size is how many forecasts fell in the bin; whiskers are 95% intervals. With one season of races, wide whiskers are expected.
          </p>
        </Panel>
        <Panel className="span-6" title="Race by race" sub="The model's chance for the eventual winner" flush>
          <RaceTable res={res} season={season} />
        </Panel>
      </div>
    </>
  );
}

function RaceTable({ res, season }: { res: BacktestResult; season: Season }) {
  return (
    <div className="table-wrap" style={{ maxHeight: 520, overflowY: 'auto' }}>
      <table className="data-table">
        <caption className="sr-only">Forecast for each race's winner</caption>
        <thead>
          <tr>
            <th scope="col">Rd</th>
            <th scope="col">Winner</th>
            <th scope="col" className="r">
              Race day
            </th>
            <th scope="col" className="r">
              Pre-quali
            </th>
            <th scope="col" className="r">
              Rank
            </th>
          </tr>
        </thead>
        <tbody>
          {res.races.map((r) => {
            const w = r.winnerId;
            const p = w ? r.raceDay.get(w)?.pWin ?? 0 : 0;
            const pq = w && r.preQuali ? r.preQuali.get(w)?.pWin ?? 0 : null;
            const rank = w ? [...r.raceDay.values()].filter((x) => x.pWin > p).length + 1 : null;
            const team = w ? r.entrants.find((e) => e.driverId === w)?.teamId ?? '' : '';
            return (
              <tr key={r.round}>
                <td className="num">
                  <Link to={`/race/${res.season}/${r.round}`}>{r.round}</Link>
                </td>
                <td>{w ? <DriverTag driver={season.drivers[w]} driverId={w} teamId={team} /> : '–'}</td>
                <td className="r num">{pct(p)}</td>
                <td className="r num faint">{pq !== null ? pct(pq) : '–'}</td>
                <td className="r num">{rank === 1 ? <span className="delta-up">fav</span> : rank !== null ? `#${rank}` : '–'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------

function HowItWorks({ config }: { config: ModelConfig }) {
  return (
    <Panel title="How it works" sub="Five ideas, all running in your browser">
      <div className="grid">
        <div className="span-7 stack" style={{ gap: 12 }}>
          <p>
            <strong>1. Racing as a sequence of choices.</strong> A <Term id="plackett-luce">Plackett–Luce</Term> model treats a finishing order as picking the winner
            from everyone, then second from those left, and so on — each driver chosen with probability proportional to their strength.
          </p>
          <div className="formula" aria-label="Model formula">
            {`P(order) = ∏ₖ  exp(sₖ) / Σ_{j ≥ k} exp(sⱼ)

strength  s = θ_team + δ_driver + β · (−log grid)`}
          </div>
          <p>
            <strong>2. Car and driver, separated.</strong> Each strength is a team (car) part θ and a driver part δ. Teammates share θ, so δ measures the driver
            against the same machinery. Priors (σ_team {config.sdTeam}, σ_driver {config.sdDriver}) keep small samples from running wild.
          </p>
          <p>
            <strong>3. Recent races matter more.</strong> Every result is weighted by 0.5^(races ago ÷ {Number.isFinite(config.halfLifeRaces) ? config.halfLifeRaces : '∞'}),
            and last season counts {pct(config.priorSeasonWeight, 0)} as much — big rule changes, like 2026's, reset the order. Sprints count {pct(config.sprintWeight, 0)} of
            a Grand Prix.
          </p>
          <p>
            <strong>4. Retirements.</strong> A beta-binomial model gives each car a <Term id="dnf">DNF</Term> chance, shrunk toward the team's and the field's rate.
          </p>
          <p>
            <strong>5. <Term id="monte-carlo">Monte Carlo</Term>.</strong> The race (and qualifying, if it has not happened) is simulated {config.sims.toLocaleString()}{' '}
            times with Gumbel noise — the exact way to sample Plackett–Luce orders. Win, podium and points chances are counts over those races.
          </p>
          <p className="faint" style={{ fontSize: 'var(--step--1)' }}>
            Fitting uses Newton's method with an analytic gradient and Hessian; the Laplace approximation gives the uncertainty shown on the{' '}
            <Link to="/drivers">Drivers</Link> page.
          </p>
        </div>
        <div className="span-5 stack" style={{ gap: 10 }}>
          <div className="eyebrow">Weight of past races</div>
          <WeightBars config={config} />
          <p className="faint" style={{ fontSize: 'var(--step--1)' }}>
            Each bar is one Grand Prix, newest on the right: amber this season, grey the season before (assuming a 24-race calendar).
          </p>
        </div>
      </div>
    </Panel>
  );
}

function WeightBars({ config }: { config: ModelConfig }) {
  const n = 36;
  const perSeason = 24;
  const thisSeason = 12; // illustrative: twelve races into the season
  const bars = Array.from({ length: n }, (_, i) => {
    const age = n - 1 - i;
    const seasonsBack = age < thisSeason ? 0 : 1 + Math.floor((age - thisSeason) / perSeason);
    const decay = Number.isFinite(config.halfLifeRaces) ? 0.5 ** (age / config.halfLifeRaces) : 1;
    return { age, w: decay * config.priorSeasonWeight ** seasonsBack, current: seasonsBack === 0 };
  });
  const W = 100 / n;
  return (
    <svg viewBox="0 0 100 40" preserveAspectRatio="none" style={{ width: '100%', height: 120 }} role="img" aria-label="Relative weight of past races in the model">
      {bars.map((b, i) => (
        <rect key={i} x={i * W + 0.25} width={W - 0.5} y={40 - b.w * 38} height={Math.max(0.3, b.w * 38)} fill={b.current ? 'var(--accent)' : 'var(--series-muted)'} rx={0.4}>
          <title>
            {b.age === 0 ? 'Most recent race' : `${b.age} races ago`}: weight {b.w.toFixed(2)}
          </title>
        </rect>
      ))}
    </svg>
  );
}

// ---------------------------------------------------------------------------

const HALF_LIVES = [2, 4, 6, 8, 12, 16, Number.POSITIVE_INFINITY];
const SIMS = [5000, 10000, 20000, 40000];

function Knobs({ seasons, year }: { seasons: Season[] | null; year: number }) {
  const { config, setConfig, isDefault } = useModelConfig();
  const [draft, setDraft] = useState<ModelConfig>(config);
  const [tuning, setTuning] = useState(false);
  const dirty = configKey(draft) !== configKey(config);
  // The two knobs being searched are left out of the key, so using a result does not rerun the search.
  const tuneKey = configKey({ ...config, halfLifeRaces: 0, priorSeasonWeight: 0 });
  const tune = useJob<TuneCandidate[]>(tuning && seasons ? `tune:${seasons.map(stamp).join('|')}:${tuneKey}` : null, (progress, cancelled) =>
    tuneRecency(seasons!, year, config, { onProgress: progress, cancelled }),
  );
  const set = <K extends keyof ModelConfig>(k: K, v: ModelConfig[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const fmtHL = (h: number) => (Number.isFinite(h) ? `${h} races` : 'No decay');

  return (
    <Panel
      title="Tune it yourself"
      sub="Changes apply to every forecast on the site and are remembered in this browser"
      actions={
        <>
          {!isDefault || dirty ? (
            <button
              className="btn btn-sm"
              onClick={() => {
                setDraft(DEFAULT_CONFIG);
                setConfig(DEFAULT_CONFIG);
              }}
            >
              Reset to defaults
            </button>
          ) : null}
          <button className="btn btn-sm btn-primary" disabled={!dirty} onClick={() => setConfig(draft)}>
            Apply and re-score
          </button>
        </>
      }
    >
      <div className="knobs">
        <div className="knob">
          <label htmlFor="k-hl">
            <span>
              <Term id="half-life">Half-life</Term>
            </span>
            <span className="num">{fmtHL(draft.halfLifeRaces)}</span>
          </label>
          <select id="k-hl" className="select" style={{ width: '100%' }} value={String(draft.halfLifeRaces)} onChange={(e) => set('halfLifeRaces', Number(e.target.value))}>
            {HALF_LIVES.map((h) => (
              <option key={String(h)} value={String(h)}>
                {fmtHL(h)}
              </option>
            ))}
          </select>
          <div className="hint">How fast old results fade. Short = only current form counts.</div>
        </div>
        <Slider id="k-psw" label="Last season counts" value={draft.priorSeasonWeight} min={0} max={1} step={0.05} fmt={(v) => pct(v, 0)} onChange={(v) => set('priorSeasonWeight', v)} hint="Low after big rule changes, when last year says little." />
        <Slider id="k-sw" label="Sprint weight" value={draft.sprintWeight} min={0} max={1} step={0.05} fmt={(v) => pct(v, 0)} onChange={(v) => set('sprintWeight', v)} hint="How much a sprint result counts, relative to a Grand Prix." />
        <Slider id="k-sdd" label="Driver spread (σ)" value={draft.sdDriver} min={0.2} max={1.5} step={0.05} fmt={(v) => v.toFixed(2)} onChange={(v) => set('sdDriver', v)} hint="Prior on how different drivers can be in the same car." />
        <Slider id="k-sdt" label="Car spread (σ)" value={draft.sdTeam} min={0.5} max={3} step={0.1} fmt={(v) => v.toFixed(1)} onChange={(v) => set('sdTeam', v)} hint="Prior on how different the cars can be." />
        <div className="knob">
          <label htmlFor="k-sims">
            <span>Simulations per race</span>
            <span className="num">{draft.sims.toLocaleString()}</span>
          </label>
          <select id="k-sims" className="select" style={{ width: '100%' }} value={draft.sims} onChange={(e) => set('sims', Number(e.target.value))}>
            {SIMS.map((s) => (
              <option key={s} value={s}>
                {s.toLocaleString()}
              </option>
            ))}
          </select>
          <div className="hint">More = smoother probabilities, slower pages.</div>
        </div>
      </div>

      <div className="stack" style={{ gap: 12, marginTop: 22, borderTop: '1px solid var(--line)', paddingTop: 18 }}>
        <div className="row spread" style={{ flexWrap: 'wrap', gap: 10 }}>
          <div>
            <strong>Auto-tune the recency knobs</strong>
            <div className="faint" style={{ fontSize: 'var(--step--1)' }}>
              Tries 20 combinations of half-life and last-season weight, scoring each by a full walk-forward backtest of {year}.
            </div>
          </div>
          {!tuning ? (
            <button className="btn btn-sm" onClick={() => setTuning(true)} disabled={!seasons}>
              Run auto-tune
            </button>
          ) : null}
        </div>
        {tuning ? (
          tune.error ? (
            <ErrorNotice error={tune.error} what="the tuning run" />
          ) : tune.running || !tune.data ? (
            <Progress done={tune.done} total={tune.total} label="Backtesting each setting" />
          ) : (
            <TuneResults rows={tune.data} current={config} onUse={(c) => {
              const next = { ...config, halfLifeRaces: c.halfLifeRaces, priorSeasonWeight: c.priorSeasonWeight };
              setDraft(next);
              setConfig(next);
            }} />
          )
        ) : null}
      </div>
    </Panel>
  );
}

function Slider({ id, label, value, min, max, step, fmt, onChange, hint }: { id: string; label: string; value: number; min: number; max: number; step: number; fmt: (v: number) => string; onChange: (v: number) => void; hint: string }) {
  return (
    <div className="knob">
      <label htmlFor={id}>
        <span>{label}</span>
        <span className="num">{fmt(value)}</span>
      </label>
      <input id={id} type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} style={{ width: '100%' }} />
      <div className="hint">{hint}</div>
    </div>
  );
}

function TuneResults({ rows, current, onUse }: { rows: TuneCandidate[]; current: ModelConfig; onUse: (c: TuneCandidate) => void }) {
  const best = rows[0];
  if (!best) return <Empty>No results.</Empty>;
  const isCurrent = (c: TuneCandidate) => c.halfLifeRaces === current.halfLifeRaces && c.priorSeasonWeight === current.priorSeasonWeight;
  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="table-wrap">
        <table className="data-table">
          <caption className="sr-only">Auto-tune results, best first</caption>
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col">Half-life</th>
              <th scope="col">Last season</th>
              <th scope="col" className="r">
                Winner log loss
              </th>
              <th scope="col" />
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 6).map((c, i) => (
              <tr key={`${c.halfLifeRaces}-${c.priorSeasonWeight}`}>
                <td className="num faint">{i + 1}</td>
                <td>{Number.isFinite(c.halfLifeRaces) ? `${c.halfLifeRaces} races` : 'No decay'}</td>
                <td>{pct(c.priorSeasonWeight, 0)}</td>
                <td className={`r num ${i === 0 ? 'delta-up' : ''}`}>{c.logLoss.toFixed(3)}</td>
                <td className="r">
                  {isCurrent(c) ? (
                    <span className="faint" style={{ fontSize: 'var(--step--1)' }}>
                      In use
                    </span>
                  ) : (
                    <button className="btn btn-sm btn-ghost" onClick={() => onUse(c)}>
                      Use
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="faint" style={{ fontSize: 'var(--step--1)' }}>
        A word of caution: tuning on the same races you then score on flatters the result. Treat the winner as a sensible setting, not proof.
      </p>
    </div>
  );
}
