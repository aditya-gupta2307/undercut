/** Holds the model settings chosen in the Model Lab, remembered between visits. */

import { useMemo, useState, type ReactNode } from 'react';
import { readPref, writePref } from '../lib/storage';
import { DEFAULT_CONFIG, type ModelConfig } from '../model/config';
import { ModelConfigContext, configKey, type ModelConfigValue } from './model';

const PREF = 'model-config';

const LIMITS: Record<keyof ModelConfig, [number, number]> = {
  halfLifeRaces: [0.5, 1000],
  priorSeasonWeight: [0, 1],
  sprintWeight: [0, 1],
  sdTeam: [0.1, 5],
  sdDriver: [0.05, 3],
  betaMean: [0, 2],
  sdBeta: [0.05, 2],
  dnfPriorStarts: [1, 200],
  sims: [1000, 50_000],
};

/** Merge stored values with defaults, rejecting anything out of range. */
export function sanitizeConfig(raw: unknown): ModelConfig {
  const out: ModelConfig = { ...DEFAULT_CONFIG };
  if (!raw || typeof raw !== 'object') return out;
  const r = raw as Record<string, unknown>;
  for (const key of Object.keys(LIMITS) as (keyof ModelConfig)[]) {
    const v = r[key];
    if (key === 'halfLifeRaces' && (v === -1 || v === Number.POSITIVE_INFINITY)) {
      out.halfLifeRaces = Number.POSITIVE_INFINITY; // "no decay" (stored as -1, since JSON has no Infinity)
      continue;
    }
    if (typeof v !== 'number' || !Number.isFinite(v)) continue;
    const [lo, hi] = LIMITS[key];
    if (v >= lo && v <= hi) out[key] = key === 'sims' ? Math.round(v) : v;
  }
  return out;
}

function serialise(c: ModelConfig): Record<string, number> {
  return { ...c, halfLifeRaces: Number.isFinite(c.halfLifeRaces) ? c.halfLifeRaces : -1 };
}

export function ModelConfigProvider({ children }: { children: ReactNode }) {
  const [config, setState] = useState<ModelConfig>(() => sanitizeConfig(readPref<unknown>(PREF, null)));
  const value = useMemo<ModelConfigValue>(
    () => ({
      config,
      setConfig: (c: ModelConfig) => {
        const clean = sanitizeConfig(serialise(c));
        setState(clean);
        writePref(PREF, serialise(clean));
      },
      isDefault: configKey(config) === configKey(DEFAULT_CONFIG),
    }),
    [config],
  );
  return <ModelConfigContext.Provider value={value}>{children}</ModelConfigContext.Provider>;
}
