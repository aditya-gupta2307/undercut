/**
 * Viewer preferences: theme, rookie mode and the season being browsed.
 * Stored per browser; everything works without storage.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { readPref, writePref } from '../lib/storage';

export type ThemeChoice = 'system' | 'light' | 'dark';

export interface Settings {
  theme: ThemeChoice;
  resolvedTheme: 'light' | 'dark';
  setTheme: (t: ThemeChoice) => void;
  rookie: boolean;
  setRookie: (on: boolean) => void;
  season: number;
  setSeason: (y: number) => void;
  currentYear: number;
}

const SettingsContext = createContext<Settings | null>(null);

/** The surface every chart is drawn on, per theme (kept in sync with tokens.css). */
export const SURFACE = { dark: '#11161C', light: '#FFFFFF' } as const;

function systemTheme(): 'light' | 'dark' {
  try {
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

function readThemeChoice(): ThemeChoice {
  try {
    const v = localStorage.getItem('undercut:theme');
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const currentYear = new Date().getUTCFullYear();
  const [theme, setThemeState] = useState<ThemeChoice>(readThemeChoice);
  const [system, setSystem] = useState<'light' | 'dark'>(systemTheme);
  const [rookie, setRookieState] = useState<boolean>(() => readPref('rookie', false));
  const [season, setSeasonState] = useState<number>(() => {
    const y = readPref<number>('season', currentYear);
    return y >= 2023 && y <= currentYear ? y : currentYear;
  });

  useEffect(() => {
    let mq: MediaQueryList | null = null;
    try {
      mq = window.matchMedia('(prefers-color-scheme: light)');
    } catch {
      return undefined;
    }
    const on = () => setSystem(mq!.matches ? 'light' : 'dark');
    mq.addEventListener('change', on);
    return () => mq!.removeEventListener('change', on);
  }, []);

  const setTheme = useCallback((t: ThemeChoice) => {
    setThemeState(t);
    try {
      if (t === 'system') {
        localStorage.removeItem('undercut:theme');
        document.documentElement.removeAttribute('data-theme');
      } else {
        localStorage.setItem('undercut:theme', t);
        document.documentElement.setAttribute('data-theme', t);
      }
    } catch {
      if (t === 'system') document.documentElement.removeAttribute('data-theme');
      else document.documentElement.setAttribute('data-theme', t);
    }
  }, []);

  const setRookie = useCallback((on: boolean) => {
    setRookieState(on);
    writePref('rookie', on);
  }, []);

  const setSeason = useCallback((y: number) => {
    setSeasonState(y);
    writePref('season', y);
  }, []);

  const value = useMemo<Settings>(
    () => ({
      theme,
      resolvedTheme: theme === 'system' ? system : theme,
      setTheme,
      rookie,
      setRookie,
      season,
      setSeason,
      currentYear,
    }),
    [theme, system, setTheme, rookie, setRookie, season, setSeason, currentYear],
  );

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): Settings {
  const s = useContext(SettingsContext);
  if (!s) throw new Error('useSettings must be used inside SettingsProvider');
  return s;
}
