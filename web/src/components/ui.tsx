/** Small presentational building blocks used across every page. */

import { useState, type CSSProperties, type ReactNode } from 'react';
import { HttpError } from '../lib/http';
import { pct } from '../lib/format';
import { Link } from '../app/router';
import { useTeams } from '../app/teams';
import type { DriverInfo } from '../data/types';

export function cssVars(vars: Record<string, string | number>): CSSProperties {
  return vars as CSSProperties;
}

// ---------------------------------------------------------------------------

interface PanelProps {
  title: ReactNode;
  sub?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  flush?: boolean;
  foot?: ReactNode;
  explainer?: ReactNode;
  id?: string;
}

export function Panel({ title, sub, actions, children, className, flush, foot, explainer, id }: PanelProps) {
  return (
    <section className={`panel ${className ?? ''}`} id={id} aria-label={typeof title === 'string' ? title : undefined}>
      <header className="panel-head">
        <div>
          <h2 className="panel-title">{title}</h2>
          {sub ? <div className="panel-sub">{sub}</div> : null}
        </div>
        {actions ? <div className="row">{actions}</div> : null}
      </header>
      {explainer ? <div className="explainer">{explainer}</div> : null}
      <div className={`panel-body ${flush ? 'flush' : ''}`}>{children}</div>
      {foot ? <footer className="panel-foot">{foot}</footer> : null}
    </section>
  );
}

/** The loading state: five start lights coming on, then going out. */
export function Lights({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="centered" role="status" aria-live="polite">
      <div className="lights">
        <div className="lights-row" aria-hidden="true">
          <span />
          <span />
          <span />
          <span />
          <span />
        </div>
        <span>{label}…</span>
      </div>
    </div>
  );
}

export function errorMessage(err: unknown): string {
  if (err instanceof HttpError) {
    if (err.status === 429) return 'The data service is rate-limiting requests. It will be retried automatically — give it a minute.';
    if (err.status >= 500) return `The data service had a problem (HTTP ${err.status}). It is usually temporary.`;
    return `The data service answered HTTP ${err.status}.`;
  }
  if (err instanceof TypeError) return 'Could not reach the data service. Check your connection, or try again shortly.';
  if (err instanceof Error) return err.message;
  return 'Something went wrong while loading.';
}

export function ErrorNotice({ error, onRetry, what }: { error: unknown; onRetry?: () => void; what?: string }) {
  return (
    <div className="notice notice-error" role="alert">
      <span className="icon" aria-hidden="true">
        !
      </span>
      <div className="stack" style={{ gap: 8 }}>
        <div>
          <strong>{what ? `Couldn't load ${what}.` : "Couldn't load this."}</strong> {errorMessage(error)}
        </div>
        {onRetry ? (
          <div>
            <button className="btn btn-sm" onClick={onRetry}>
              Try again
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function Notice({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'warn' }) {
  return (
    <div className={`notice ${tone === 'warn' ? 'notice-warn' : ''}`}>
      <span className="icon" aria-hidden="true">
        {tone === 'warn' ? '▲' : 'i'}
      </span>
      <div>{children}</div>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

// ---------------------------------------------------------------------------

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: ReactNode; disabled?: boolean }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={o.value === value} disabled={o.disabled} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ on, onChange, children, title }: { on: boolean; onChange: (v: boolean) => void; children: ReactNode; title?: string }) {
  return (
    <button type="button" className="toggle" aria-pressed={on} onClick={() => onChange(!on)} title={title}>
      <span className="switch" aria-hidden="true" />
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------

export function TeamBar({ teamId, height = 18 }: { teamId: string; height?: number }) {
  const { colour } = useTeams();
  return <span className="bar" style={{ background: colour(teamId), height }} aria-hidden="true" />;
}

interface DriverTagProps {
  driver: DriverInfo | undefined;
  driverId: string;
  teamId: string;
  showName?: boolean;
  showTeam?: boolean;
  link?: boolean;
}

export function DriverTag({ driver, driverId, teamId, showName = true, showTeam = false, link = false }: DriverTagProps) {
  const { colour, name } = useTeams();
  const code = driver?.code ?? driverId.slice(0, 3).toUpperCase();
  const full = driver ? `${driver.givenName} ${driver.familyName}` : driverId;
  const body = (
    <>
      <span className="bar" style={{ background: colour(teamId) }} aria-hidden="true" />
      <span className="code">{code}</span>
      {showName ? <span className="name">{driver?.familyName ?? driverId}</span> : <span className="sr-only">{full}</span>}
      {showTeam ? <span className="team">{name(teamId)}</span> : null}
    </>
  );
  if (link) {
    return (
      <Link to={`/drivers?d=${encodeURIComponent(driverId)}`} className="driver-tag" title={full}>
        {body}
      </Link>
    );
  }
  return (
    <span className="driver-tag" title={full}>
      {body}
    </span>
  );
}

/** A probability as a bar with its value. Width encodes the value; the number is always visible. */
export function ProbBar({ p, colour, max = 1, label }: { p: number; colour: string; max?: number; label?: string }) {
  const w = Math.max(0, Math.min(1, p / max)) * 100;
  return (
    <div className="pbar" aria-label={label ? `${label}: ${pct(p)}` : pct(p)}>
      <div className="track">
        <div className="fill" style={{ width: `${w}%`, background: colour }} />
      </div>
      <span className="val">{pct(p)}</span>
    </div>
  );
}

export function Stat({ label, value, note }: { label: ReactNode; value: ReactNode; note?: ReactNode }) {
  return (
    <div className="stat">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {note ? <div className="note">{note}</div> : null}
    </div>
  );
}

export function TyreBadge({ compound }: { compound: string }) {
  const map: Record<string, string> = {
    SOFT: 'var(--tyre-soft)',
    MEDIUM: 'var(--tyre-medium)',
    HARD: 'var(--tyre-hard)',
    INTERMEDIATE: 'var(--tyre-inter)',
    WET: 'var(--tyre-wet)',
  };
  return (
    <span className="tyre" style={{ borderColor: map[compound] ?? 'var(--tyre-unknown)' }} title={compound.toLowerCase()}>
      {compound === 'UNKNOWN' ? '?' : compound[0]}
    </span>
  );
}

export function Delta({ value, invert = false }: { value: number | null; invert?: boolean }) {
  if (value === null || !Number.isFinite(value)) return <span className="delta-flat">–</span>;
  const good = invert ? value < 0 : value > 0;
  if (value === 0) return <span className="delta-flat">0</span>;
  return (
    <span className={good ? 'delta-up' : 'delta-down'}>
      <span aria-hidden="true">{value > 0 ? '▲' : '▼'}</span>
      <span className="sr-only">{value > 0 ? 'up' : 'down'}</span> {Math.abs(value)}
    </span>
  );
}

/** Disclosure for long lists. */
export function useExpand(initial = false): [boolean, () => void] {
  const [open, setOpen] = useState(initial);
  return [open, () => setOpen((o) => !o)];
}
