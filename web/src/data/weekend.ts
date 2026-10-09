/** The sessions of a race weekend, in order, with typical lengths. */

import type { RaceEvent, SessionTimes } from './types';

export const SESSION_LABEL: Record<keyof SessionTimes, string> = {
  fp1: 'Practice 1',
  fp2: 'Practice 2',
  fp3: 'Practice 3',
  sprintQuali: 'Sprint Qualifying',
  sprint: 'Sprint',
  quali: 'Qualifying',
  race: 'Grand Prix',
};

/** Scheduled length in minutes (the race allows two hours). */
export const SESSION_LENGTH: Record<keyof SessionTimes, number> = {
  fp1: 60,
  fp2: 60,
  fp3: 60,
  sprintQuali: 44,
  sprint: 45,
  quali: 60,
  race: 120,
};

export interface WeekendSession {
  key: keyof SessionTimes;
  label: string;
  at: number;
  end: number;
}

export function sessionList(e: RaceEvent): WeekendSession[] {
  return (Object.keys(e.sessions) as (keyof SessionTimes)[])
    .filter((k) => typeof e.sessions[k] === 'number')
    .map((k) => ({ key: k, label: SESSION_LABEL[k], at: e.sessions[k]!, end: e.sessions[k]! + SESSION_LENGTH[k] * 60_000 }))
    .sort((a, b) => a.at - b.at);
}
