/**
 * Small, defensive wrapper around localStorage.
 *
 * Storage can be missing (private windows), full, or throw on access, so every
 * call is wrapped and the app works — just slower — without it. Entries carry
 * their own write time so stale data can be shown while fresh data loads.
 */

const NAMESPACE = 'undercut:v1:';

interface Envelope<T> {
  t: number; // saved at, epoch ms
  v: T;
}

function store(): Storage | null {
  try {
    const s = globalThis.localStorage;
    if (!s) return null;
    return s;
  } catch {
    return null;
  }
}

export function readStored<T>(key: string): { value: T; savedAt: number } | null {
  const s = store();
  if (!s) return null;
  try {
    const raw = s.getItem(NAMESPACE + key);
    if (!raw) return null;
    const env = JSON.parse(raw) as Envelope<T>;
    if (typeof env !== 'object' || env === null || typeof env.t !== 'number') return null;
    return { value: env.v, savedAt: env.t };
  } catch {
    return null;
  }
}

export function writeStored<T>(key: string, value: T, now: number = Date.now()): boolean {
  const s = store();
  if (!s) return false;
  const payload = JSON.stringify({ t: now, v: value } satisfies Envelope<T>);
  try {
    s.setItem(NAMESPACE + key, payload);
    return true;
  } catch {
    // Most likely the quota. Evict the oldest quarter of our own entries and retry once.
    evictOldest(s, 0.25);
    try {
      s.setItem(NAMESPACE + key, payload);
      return true;
    } catch {
      return false;
    }
  }
}

export function removeStored(key: string): void {
  try {
    store()?.removeItem(NAMESPACE + key);
  } catch {
    /* ignore */
  }
}

/** Remove every cached entry this app has written (keeps preferences). */
export function clearCachedData(): number {
  const s = store();
  if (!s) return 0;
  const doomed: string[] = [];
  try {
    for (let i = 0; i < s.length; i++) {
      const k = s.key(i);
      if (k && k.startsWith(NAMESPACE + 'cache:')) doomed.push(k);
    }
    doomed.forEach((k) => s.removeItem(k));
  } catch {
    /* ignore */
  }
  return doomed.length;
}

function evictOldest(s: Storage, fraction: number): void {
  try {
    const entries: { key: string; t: number }[] = [];
    for (let i = 0; i < s.length; i++) {
      const k = s.key(i);
      if (!k || !k.startsWith(NAMESPACE + 'cache:')) continue;
      try {
        const env = JSON.parse(s.getItem(k) ?? '') as Envelope<unknown>;
        entries.push({ key: k, t: env.t ?? 0 });
      } catch {
        entries.push({ key: k, t: 0 });
      }
    }
    entries.sort((a, b) => a.t - b.t);
    const n = Math.max(1, Math.ceil(entries.length * fraction));
    entries.slice(0, n).forEach((e) => s.removeItem(e.key));
  } catch {
    /* ignore */
  }
}

/** Preferences are tiny and never evicted. */
export function readPref<T>(key: string, fallback: T): T {
  const hit = readStored<T>('pref:' + key);
  return hit ? hit.value : fallback;
}

export function writePref<T>(key: string, value: T): void {
  writeStored('pref:' + key, value);
}
