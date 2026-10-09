/**
 * A tiny hash router. Hash URLs (#/race/2026/16) work on any static host —
 * GitHub Pages included — without server-side rewrite rules, and refreshing
 * any page just works.
 */

import { useEffect, useSyncExternalStore, type AnchorHTMLAttributes, type ReactNode } from 'react';

export interface Route {
  path: string[];
  query: URLSearchParams;
  raw: string;
}

function safeDecode(part: string): string {
  try {
    return decodeURIComponent(part);
  } catch {
    return part; // a malformed escape: keep the raw text and let the page say "not found"
  }
}

function parse(hash: string): Route {
  const raw = hash.replace(/^#/, '') || '/';
  const [p = '/', q = ''] = raw.split('?');
  return {
    path: p.split('/').filter(Boolean).map(safeDecode),
    query: new URLSearchParams(q),
    raw,
  };
}

let current = parse(typeof location !== 'undefined' ? location.hash : '');
const listeners = new Set<() => void>();

if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', () => {
    const prev = current.path.join('/');
    current = parse(location.hash);
    if (current.path.join('/') !== prev) window.scrollTo({ top: 0 });
    listeners.forEach((l) => l());
  });
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export function useRoute(): Route {
  return useSyncExternalStore(subscribe, () => current, () => current);
}

export function href(to: string): string {
  return '#' + (to.startsWith('/') ? to : '/' + to);
}

export function navigate(to: string, opts: { replace?: boolean } = {}): void {
  const next = href(to);
  if (opts.replace) {
    history.replaceState(null, '', next);
    current = parse(next);
    listeners.forEach((l) => l());
  } else {
    location.hash = next;
  }
}

/** Update query parameters on the current route without adding history entries. */
export function setQuery(updates: Record<string, string | null>): void {
  const q = new URLSearchParams(current.query);
  for (const [k, v] of Object.entries(updates)) {
    if (v === null) q.delete(k);
    else q.set(k, v);
  }
  const qs = q.toString();
  navigate('/' + current.path.map(encodeURIComponent).join('/') + (qs ? '?' + qs : ''), { replace: true });
}

interface LinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> {
  to: string;
  children?: ReactNode;
}

export function Link({ to, children, ...rest }: LinkProps) {
  return (
    <a href={href(to)} {...rest}>
      {children}
    </a>
  );
}

/** Sets the document title for the current page. */
export function useTitle(title: string): void {
  useEffect(() => {
    document.title = title ? `${title} · Undercut` : 'Undercut';
  }, [title]);
}
