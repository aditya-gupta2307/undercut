/**
 * Rookie Mode. With it on, jargon anywhere on the site is underlined and
 * explains itself on hover, focus or tap. With it off, terms are plain text.
 */

import { useId, useRef, useState, type ReactNode } from 'react';
import { GLOSSARY_BY_ID } from '../content/glossary';
import { useSettings } from '../app/settings';

export function Term({ id, children }: { id: string; children?: ReactNode }) {
  const { rookie } = useSettings();
  const entry = GLOSSARY_BY_ID[id];
  const ref = useRef<HTMLSpanElement | null>(null);
  const [pos, setPos] = useState<{ x: number; y: number; above: boolean } | null>(null);
  const tipId = useId();
  const label = children ?? entry?.term ?? id;
  if (!entry || !rookie) return <>{label}</>;

  const show = () => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const above = r.bottom + 140 > window.innerHeight;
    const x = Math.min(Math.max(12, r.left), window.innerWidth - 332);
    setPos({ x, y: above ? r.top - 8 : r.bottom + 8, above });
  };
  const hide = () => setPos(null);

  return (
    <>
      <span
        ref={ref}
        className="term"
        tabIndex={0}
        role="button"
        aria-describedby={pos ? tipId : undefined}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        onClick={(e) => {
          e.stopPropagation();
          if (pos) hide();
          else show();
        }}
      >
        {label}
      </span>
      {pos ? (
        <span
          id={tipId}
          role="tooltip"
          className="popover"
          style={{ left: pos.x, top: pos.y, transform: pos.above ? 'translateY(-100%)' : undefined }}
        >
          <strong>{entry.term}</strong>
          {entry.short}
        </span>
      ) : null}
    </>
  );
}

/** A short explanation that only appears in Rookie Mode. */
export function RookieNote({ children }: { children: ReactNode }) {
  const { rookie } = useSettings();
  if (!rookie) return null;
  return <div className="explainer">{children}</div>;
}
