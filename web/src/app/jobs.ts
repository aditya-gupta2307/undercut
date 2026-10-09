/**
 * Long-running computations (backtests, tuning) with progress, cancellation
 * when the page is left, and a result cache keyed by every input.
 */

import { useEffect, useRef, useState } from 'react';

export interface JobState<T> {
  data: T | null;
  error: unknown;
  done: number;
  total: number;
  running: boolean;
}

type Runner<T> = (progress: (done: number, total: number) => void, cancelled: () => boolean) => Promise<T | null>;

const results = new Map<string, unknown>();
const LIMIT = 12;

export function useJob<T>(key: string | null, run: Runner<T>): JobState<T> {
  const runRef = useRef(run);
  runRef.current = run;
  const initial = (k: string | null): JobState<T> => {
    const hit = k !== null && results.has(k) ? (results.get(k) as T) : null;
    return { data: hit, error: null, done: 0, total: 0, running: k !== null && hit === null };
  };
  const [state, setState] = useState<JobState<T> & { key: string | null }>(() => ({ ...initial(key), key }));

  useEffect(() => {
    if (key === null) {
      setState({ ...initial(null), key });
      return undefined;
    }
    if (results.has(key)) {
      setState({ data: results.get(key) as T, error: null, done: 0, total: 0, running: false, key });
      return undefined;
    }
    let cancelled = false;
    setState({ data: null, error: null, done: 0, total: 0, running: true, key });
    // Let the browser paint the progress state before the first heavy step.
    const id = setTimeout(() => {
      runRef
        .current(
          (done, total) => {
            if (!cancelled) setState((s) => (s.key === key ? { ...s, done, total } : s));
          },
          () => cancelled,
        )
        .then(
          (data) => {
            if (cancelled || data === null) return;
            results.set(key, data);
            if (results.size > LIMIT) results.delete(results.keys().next().value as string);
            setState({ data, error: null, done: 0, total: 0, running: false, key });
          },
          (error: unknown) => {
            if (!cancelled) setState({ data: null, error, done: 0, total: 0, running: false, key });
          },
        );
    }, 30);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [key]);

  if (state.key !== key) return initial(key);
  return { data: state.data, error: state.error, done: state.done, total: state.total, running: state.running };
}
