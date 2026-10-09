/**
 * Learn F1 in five minutes: the weekend, points, tyres, flags, strategy (with
 * a hands-on undercut simulator), the 2026 rules and a searchable glossary.
 */

import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { Link, useTitle } from '../app/router';
import { GLOSSARY, type GlossaryEntry } from '../content/glossary';
import { RACE_POINTS, SPRINT_POINTS } from '../model/config';
import { undercutTrace, type UndercutInput } from '../model/undercut';
import { Segmented, TyreBadge } from '../components/ui';
import { Term } from '../components/Term';

const SECTIONS = [
  { id: 'weekend', label: 'The weekend' },
  { id: 'points', label: 'Points' },
  { id: 'tyres', label: 'Tyres' },
  { id: 'flags', label: 'Flags' },
  { id: 'strategy', label: 'Strategy' },
  { id: 'rules-2026', label: '2026 rules' },
  { id: 'glossary', label: 'Glossary' },
];

export default function LearnPage() {
  useTitle('Learn F1');
  return (
    <div className="stack" style={{ gap: 26 }}>
      <header className="page-head">
        <div className="eyebrow">New to Formula 1?</div>
        <h1>Learn F1 in five minutes</h1>
        <p className="muted" style={{ maxWidth: '68ch', fontSize: 'var(--step-1)' }}>
          Twenty-two cars, eleven teams, twenty-odd weekends a year. Everything you need to follow a race — and to read every chart on this site. Tip: switch on{' '}
          <strong>Rookie</strong> in the top bar and every term on the site explains itself.
        </p>
      </header>
      <div className="learn">
        <nav className="learn-nav" aria-label="Sections">
          {SECTIONS.map((s) => (
            <a key={s.id} href={`#/learn`} onClick={(e) => {
              e.preventDefault();
              document.getElementById(s.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }}>
              {s.label}
            </a>
          ))}
        </nav>
        <div className="stack" style={{ gap: 40, minWidth: 0 }}>
          <Weekend />
          <Points />
          <Tyres />
          <Flags />
          <Strategy />
          <Rules2026 />
          <Glossary />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function Section({ id, title, lead, children }: { id: string; title: string; lead?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} className="learn-section" aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`}>{title}</h2>
      {lead ? <p>{lead}</p> : null}
      {children}
    </section>
  );
}

function Weekend() {
  const [format, setFormat] = useState<'normal' | 'sprint'>('normal');
  const days =
    format === 'normal'
      ? [
          { day: 'Friday', sessions: [{ name: 'Practice 1', note: '60 min · set-up work' }, { name: 'Practice 2', note: '60 min · long runs on full fuel' }] },
          { day: 'Saturday', sessions: [{ name: 'Practice 3', note: '60 min · final tweaks' }, { name: 'Qualifying', note: 'Q1 → Q2 → Q3 · sets the grid', key: true }] },
          { day: 'Sunday', sessions: [{ name: 'Grand Prix', note: '≈305 km · 25 points to win', points: true }] },
        ]
      : [
          { day: 'Friday', sessions: [{ name: 'Practice 1', note: 'the only practice' }, { name: 'Sprint Qualifying', note: 'SQ1 → SQ3 · sets the sprint grid', key: true }] },
          { day: 'Saturday', sessions: [{ name: 'Sprint', note: '≈100 km · 8 points to win', points: true }, { name: 'Qualifying', note: 'sets the Grand Prix grid', key: true }] },
          { day: 'Sunday', sessions: [{ name: 'Grand Prix', note: '≈305 km · 25 points to win', points: true }] },
        ];
  return (
    <Section
      id="weekend"
      title="The weekend"
      lead={
        <>
          Practice is for the teams; <Term id="qualifying">qualifying</Term> decides the starting order; the <Term id="grand-prix">Grand Prix</Term> pays the points.
          Six weekends a season add a <Term id="sprint">sprint</Term>.
        </>
      }
    >
      <Segmented
        label="Weekend format"
        value={format}
        onChange={setFormat}
        options={[
          { value: 'normal', label: 'Standard weekend' },
          { value: 'sprint', label: 'Sprint weekend' },
        ]}
      />
      <div className="weekend-strip">
        {days.map((d) => (
          <div key={d.day} className="day-col">
            <div className="eyebrow">{d.day}</div>
            {d.sessions.map((s) => (
              <div key={s.name} className={`session ${'points' in s && s.points ? 'points' : ''}`}>
                <strong>{s.name}</strong>
                <div className="faint">{s.note}</div>
              </div>
            ))}
          </div>
        ))}
      </div>
      <p className="muted" style={{ fontSize: 'var(--step--1)', maxWidth: '68ch' }}>
        Qualifying is a knockout: everyone runs in Q1 and the slowest six are eliminated; Q2 drops six more; the top ten fight for <Term id="pole">pole position</Term> in{' '}
        <Term id="q3">Q3</Term>. From then on the cars are in <Term id="parc-ferme">parc fermé</Term> — set-up changes mean starting from the pit lane.
      </p>
    </Section>
  );
}

function Points() {
  return (
    <Section
      id="points"
      title="Points"
      lead={
        <>
          The top ten in a Grand Prix score, the top eight in a sprint. Drivers and teams each have a championship; a team scores both its drivers' points. Ties are
          broken by <Term id="countback">countback</Term> — most wins, then most second places, and so on.
        </>
      }
    >
      <div className="grid">
        <div className="span-6 table-wrap">
          <table className="data-table">
            <caption className="faint" style={{ textAlign: 'left', paddingBottom: 6 }}>
              Grand Prix
            </caption>
            <thead>
              <tr>
                {RACE_POINTS.map((_, i) => (
                  <th key={i} scope="col" className="r">
                    P{i + 1}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                {RACE_POINTS.map((p, i) => (
                  <td key={i} className="r num">
                    {p}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
        <div className="span-6 table-wrap">
          <table className="data-table">
            <caption className="faint" style={{ textAlign: 'left', paddingBottom: 6 }}>
              Sprint
            </caption>
            <thead>
              <tr>
                {SPRINT_POINTS.map((_, i) => (
                  <th key={i} scope="col" className="r">
                    P{i + 1}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                {SPRINT_POINTS.map((p, i) => (
                  <td key={i} className="r num">
                    {p}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      <p className="muted" style={{ fontSize: 'var(--step--1)', maxWidth: '68ch' }}>
        From 2019 to 2024 the driver with the <Term id="fastest-lap">fastest lap</Term> also got a bonus point if they finished in the top ten; it was dropped for
        2025. Curious how today's champions would have fared under the old rules? Try the <Link to="/time-machine">points time machine</Link>.
      </p>
    </Section>
  );
}

function Tyres() {
  const dry = [
    { c: 'SOFT', name: 'Soft', text: 'Fastest, but wears out quickest. Qualifying favourite.' },
    { c: 'MEDIUM', name: 'Medium', text: 'The all-rounder: decent pace, decent life.' },
    { c: 'HARD', name: 'Hard', text: 'Slowest, most durable — for long stints.' },
    { c: 'INTERMEDIATE', name: 'Intermediate', text: 'For a damp or drying track.' },
    { c: 'WET', name: 'Full wet', text: 'For heavy rain; pumps away standing water.' },
  ];
  const ring: Record<string, string> = { SOFT: 'var(--tyre-soft)', MEDIUM: 'var(--tyre-medium)', HARD: 'var(--tyre-hard)', INTERMEDIATE: 'var(--tyre-inter)', WET: 'var(--tyre-wet)' };
  return (
    <Section
      id="tyres"
      title="Tyres"
      lead={
        <>
          Pirelli brings three dry <Term id="compound">compounds</Term> to each race, colour-coded on the sidewall. In a dry race every driver must use at least two of
          them — the <Term id="two-compound-rule">two-compound rule</Term> — so everyone stops at least once.
        </>
      }
    >
      <div className="tyre-row">
        {dry.map((t) => (
          <div key={t.c} className="tyre-card">
            <div className="tyre-ring" style={{ borderColor: ring[t.c] } as CSSProperties} aria-hidden="true" />
            <strong>{t.name}</strong>
            <span className="muted">{t.text}</span>
          </div>
        ))}
      </div>
      <p className="muted" style={{ fontSize: 'var(--step--1)', maxWidth: '68ch' }}>
        Tyres lose grip as they wear — <Term id="degradation">degradation</Term> — so lap times creep up through a <Term id="stint">stint</Term>. When to stop, and
        onto which compound, is most of race strategy.
      </p>
    </Section>
  );
}

function Flags() {
  const flags: { name: string; id?: string; swatch: CSSProperties; text: string }[] = [
    { name: 'Green', id: 'green-flag', swatch: { background: '#22b14c' }, text: 'Track clear. Racing on.' },
    { name: 'Yellow', id: 'yellow-flag', swatch: { background: '#ffd21f' }, text: 'Danger ahead: slow down, no overtaking. Double yellow: be ready to stop.' },
    { name: 'Red', id: 'red-flag', swatch: { background: '#e8302a' }, text: 'Session stopped. Everyone back to the pit lane.' },
    { name: 'Blue', id: 'blue-flag', swatch: { background: '#2f7bff' }, text: 'A faster car is lapping you — let it through.' },
    { name: 'Chequered', id: 'chequered-flag', swatch: { background: 'repeating-conic-gradient(#111 0 25%, #fff 0 50%) 50% / 12px 12px' }, text: 'The end of the race or session.' },
    { name: 'Black and white', id: 'black-white-flag', swatch: { background: 'linear-gradient(135deg, #111 50%, #fff 50%)' }, text: 'Final warning for unsporting behaviour.' },
    { name: 'Black, orange disc', id: 'black-orange-flag', swatch: { background: 'radial-gradient(circle, #ff7a00 0 38%, #111 40%)' }, text: 'Your car is damaged — pit now.' },
    { name: 'Safety car', id: 'safety-car', swatch: { background: '#ffb21e', display: 'grid', placeItems: 'center', color: '#111', fontWeight: 800, fontSize: 13 }, text: 'Field bunches up behind the safety car; no overtaking.' },
    { name: 'Virtual safety car', id: 'vsc', swatch: { background: 'repeating-linear-gradient(90deg, #ffb21e 0 6px, #111 6px 12px)' }, text: 'Everyone slows to a set delta — no car on track, gaps frozen.' },
  ];
  return (
    <Section id="flags" title="Flags" lead={<>Marshals and the timing screens use flags to control the race. The ones that matter most to strategy are the safety cars: a cheap moment to pit.</>}>
      <div className="flags-grid">
        {flags.map((f) => (
          <div key={f.name} className="flag-card">
            <span className="swatch" style={f.swatch} aria-hidden="true">
              {f.name === 'Safety car' ? 'SC' : null}
            </span>
            <div>
              <strong>{f.id ? <Term id={f.id}>{f.name}</Term> : f.name}</strong>
              <div className="muted">{f.text}</div>
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------------------

function Strategy() {
  return (
    <Section
      id="strategy"
      title="Strategy: the undercut"
      lead={
        <>
          A <Term id="pit-stop">pit stop</Term> costs around 20 seconds. You cannot pass the car ahead on track? Stop first. Your new tyres are faster than their
          worn ones, so for a lap or two you gain time — and when they stop, you may come out ahead. That is the <Term id="undercut">undercut</Term>. Play with it:
        </>
      }
    >
      <UndercutSim />
      <p className="muted" style={{ fontSize: 'var(--step--1)', maxWidth: '68ch' }}>
        The opposite, the <Term id="overcut">overcut</Term>, works when new tyres take time to warm up or the stopping car rejoins in traffic. Real races are messier —
        see what actually happened in any race's <Link to="/season">Strategy Lab</Link>.
      </p>
    </Section>
  );
}

function UndercutSim() {
  const [s, setS] = useState<UndercutInput>({ gap: 2.0, fresh: 1.6, wear: 0.1, warmup: 0.6, laps: 1, stopDelta: 0, traffic: false });
  const trace = useMemo(() => undercutTrace(s), [s]);
  const final = trace[trace.length - 1]!.gap;
  const works = final < 0;
  const set = <K extends keyof UndercutInput>(k: K, v: UndercutInput[K]) => setS((x) => ({ ...x, [k]: v }));
  const max = Math.max(1, ...trace.map((t) => Math.abs(t.gap)));
  const H = 160;
  const mid = H / 2;
  const scale = (H / 2 - 18) / max;
  const W = 100 / trace.length;

  const slider = (k: 'gap' | 'fresh' | 'wear' | 'warmup' | 'stopDelta', label: string, min: number, max: number, step: number, fmt: (v: number) => string) => (
    <div className="knob">
      <label htmlFor={`us-${k}`}>
        <span>{label}</span>
        <span className="num">{fmt(s[k])}</span>
      </label>
      <input id={`us-${k}`} type="range" min={min} max={max} step={step} value={s[k]} onChange={(e) => set(k, Number(e.target.value))} style={{ width: '100%' }} />
    </div>
  );

  return (
    <div className="undercut-sim panel" style={{ padding: 18 }}>
      <div className="stack" style={{ gap: 14 }}>
        {slider('gap', 'Gap to the car ahead', 0.3, 6, 0.1, (v) => `${v.toFixed(1)}s`)}
        {slider('fresh', 'New-tyre advantage per lap', 0, 3, 0.1, (v) => `${v.toFixed(1)}s`)}
        {slider('wear', 'Extra wear per lap on old tyres', 0, 0.5, 0.05, (v) => `${v.toFixed(2)}s`)}
        {slider('warmup', 'Cold-tyre out-lap penalty', 0, 2, 0.1, (v) => `${v.toFixed(1)}s`)}
        {slider('stopDelta', 'Your stop slower than theirs by', -1.5, 2, 0.1, (v) => `${v > 0 ? '+' : ''}${v.toFixed(1)}s`)}
        <div className="knob">
          <label htmlFor="us-laps">
            <span>Laps before they react</span>
            <span className="num">{s.laps}</span>
          </label>
          <input id="us-laps" type="range" min={1} max={5} step={1} value={s.laps} onChange={(e) => set('laps', Number(e.target.value))} style={{ width: '100%' }} />
        </div>
        <label className="row" style={{ gap: 8, fontSize: 'var(--step--1)' }}>
          <input type="checkbox" checked={s.traffic} onChange={(e) => set('traffic', e.target.checked)} /> You rejoin behind slower traffic
        </label>
      </div>
      <div className="stack" style={{ gap: 12 }}>
        <div>
          <div className="eyebrow">Result</div>
          <div className={`big-delta ${works ? 'delta-up' : 'delta-down'}`}>{works ? `Ahead by ${Math.abs(final).toFixed(1)}s` : `Still ${final.toFixed(1)}s behind`}</div>
          <div className="muted" style={{ fontSize: 'var(--step--1)' }}>
            {works ? 'The undercut works — you come out in front once they have stopped.' : 'Not enough. Stop earlier, or hope for a slow stop ahead.'}
          </div>
        </div>
        <svg viewBox={`0 0 100 ${H}`} preserveAspectRatio="none" style={{ width: '100%', height: H }} role="img" aria-label="Gap to the rival on each lap: above the line is behind, below is ahead">
          <line x1={0} x2={100} y1={mid} y2={mid} stroke="var(--line-strong)" strokeWidth={0.6} vectorEffect="non-scaling-stroke" />
          {trace.map((t, i) => {
            const h = Math.abs(t.gap) * scale;
            const y = t.gap >= 0 ? mid - h : mid;
            return (
              <rect key={i} x={i * W + W * 0.18} width={W * 0.64} y={y} height={Math.max(0.8, h)} rx={1} fill={t.gap < 0 ? 'var(--good)' : 'var(--series-muted)'}>
                <title>
                  {t.note}: {t.gap >= 0 ? `${t.gap.toFixed(1)}s behind` : `${Math.abs(t.gap).toFixed(1)}s ahead`}
                </title>
              </rect>
            );
          })}
        </svg>
        <div className="faint" style={{ fontSize: 'var(--step--2)', display: 'grid', gridTemplateColumns: `repeat(${trace.length}, minmax(0, 1fr))` }}>
          {trace.map((t, i) => (
            <span key={i} style={{ textAlign: 'center' }}>
              {i === 0 ? 'Stop' : i === trace.length - 1 ? 'Their out-lap' : `Lap ${t.lap}`}
            </span>
          ))}
        </div>
        <div className="faint" style={{ fontSize: 'var(--step--2)' }}>Bars above the line: still behind. Below: ahead.</div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function Rules2026() {
  const items: { title: string; id: string; text: ReactNode }[] = [
    { title: 'Half electric', id: 'power-unit', text: 'The power unit splits its output roughly 50/50 between a combustion engine on fully sustainable fuel and a much stronger electric motor.' },
    { title: 'Active aerodynamics', id: 'active-aero', text: <>Wings switch between <Term id="straight-mode">Straight Mode</Term> (low drag) and <Term id="corner-mode">Corner Mode</Term> (grip) on every lap, for every car.</> },
    { title: 'Overtake replaces DRS', id: 'overtake-mode', text: <>Within a second of the car ahead? You get extra electrical energy for the next lap. <Term id="drs">DRS</Term> is gone.</> },
    { title: 'Boost and recharge', id: 'boost', text: <>Drivers choose where to spend battery energy with <Term id="boost">Boost</Term>, and must <Term id="recharge">recharge</Term> it under braking and lifting.</> },
    { title: 'Smaller, lighter cars', id: 'power-unit', text: 'Shorter and narrower than before, and around 30 kg lighter, for closer, nimbler racing.' },
    { title: 'Eleven teams', id: 'constructor', text: 'Cadillac joins as the eleventh team and Audi takes over Sauber: 22 cars on the grid.' },
  ];
  return (
    <Section
      id="rules-2026"
      title="What's new in 2026"
      lead={<>The biggest rule change in a generation: new engines, new aerodynamics, new ways to overtake. It is why this site weights last season's results down so hard.</>}
    >
      <div className="glossary-list">
        {items.map((it) => (
          <div key={it.title} className="glossary-item">
            <dt style={{ fontFamily: 'var(--font-display)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{it.title}</dt>
            <dd style={{ margin: '4px 0 0', color: 'var(--ink-2)' }}>{it.text}</dd>
          </div>
        ))}
      </div>
    </Section>
  );
}

function Glossary() {
  const [q, setQ] = useState('');
  const query = q.trim().toLowerCase();
  const matches = useMemo(
    () => GLOSSARY.filter((g) => !query || g.term.toLowerCase().includes(query) || g.short.toLowerCase().includes(query) || g.category.toLowerCase().includes(query)),
    [query],
  );
  const groups = useMemo(() => {
    const m = new Map<GlossaryEntry['category'], GlossaryEntry[]>();
    for (const g of matches) m.set(g.category, [...(m.get(g.category) ?? []), g]);
    return [...m.entries()];
  }, [matches]);
  return (
    <Section id="glossary" title="Glossary" lead={<>Every term used on this site, in plain English. {GLOSSARY.length} entries.</>}>
      <input className="search" type="search" placeholder="Search: undercut, parc fermé, Brier…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search the glossary" />
      {groups.length === 0 ? <div className="empty">Nothing matches “{q}”.</div> : null}
      {groups.map(([cat, entries]) => (
        <div key={cat} className="stack" style={{ gap: 8 }}>
          <div className="eyebrow">{cat}</div>
          <dl className="glossary-list" style={{ margin: 0 }}>
            {entries.map((g) => (
              <div key={g.id} className="glossary-item" id={`g-${g.id}`}>
                <dt>{g.term}</dt>
                <dd>{g.short}</dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        <span className="faint" style={{ fontSize: 'var(--step--1)' }}>Tyre markings:</span>
        {(['SOFT', 'MEDIUM', 'HARD', 'INTERMEDIATE', 'WET'] as const).map((c) => (
          <TyreBadge key={c} compound={c} />
        ))}
      </div>
    </Section>
  );
}
