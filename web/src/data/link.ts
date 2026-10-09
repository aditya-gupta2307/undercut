/**
 * Joining the two sources.
 *
 * Jolpica and OpenF1 share no keys. Names are unreliable too — in 2026 the
 * relocated "Bahrain Grand Prix" ran at Sepang, which Jolpica calls "Bahrain
 * Grand Prix in Malaysia" and OpenF1 lists under country "Bahrain". So events
 * are matched by *time*: the OpenF1 meeting whose date range contains the
 * Jolpica race start. Drivers are matched by car number within a race (both
 * sources publish it), falling back to the three-letter code.
 */

import type { F1Session, Meeting, RaceEvent, ResultRow, SessionDriver } from './types';
import { raceTime } from './season';

export interface LinkedSessions {
  meeting: Meeting;
  race: F1Session | null;
  sprint: F1Session | null;
  quali: F1Session | null;
  sprintQuali: F1Session | null;
  all: F1Session[];
}

const SIX_HOURS = 6 * 3_600_000;

export function isTestingMeeting(m: Meeting): boolean {
  return /test/i.test(m.name) || /test/i.test(m.officialName);
}

export function findMeeting(event: RaceEvent, meetings: Meeting[]): Meeting | null {
  const t = raceTime(event);
  const candidates = meetings.filter((m) => !m.cancelled && !isTestingMeeting(m));
  const containing = candidates.filter((m) => m.start - SIX_HOURS <= t && t <= m.end + SIX_HOURS);
  if (containing.length) {
    // If two overlap (should not happen) prefer the one ending closest after the race.
    return containing.sort((a, b) => Math.abs(a.end - t) - Math.abs(b.end - t))[0]!;
  }
  return null;
}

export function linkSessions(event: RaceEvent, meetings: Meeting[], sessions: F1Session[]): LinkedSessions | null {
  const meeting = findMeeting(event, meetings);
  if (!meeting) return null;
  const all = sessions.filter((s) => s.meetingKey === meeting.key && !s.cancelled).sort((a, b) => a.start - b.start);
  const named = (...names: string[]) => all.find((s) => names.includes(s.name)) ?? null;
  return {
    meeting,
    race: named('Race'),
    sprint: named('Sprint'),
    quali: named('Qualifying'),
    sprintQuali: named('Sprint Qualifying', 'Sprint Shootout'),
    all,
  };
}

export interface DriverLink {
  number: number;
  driverId: string | null;
  acronym: string;
  teamName: string;
  colour: string | null;
  fullName: string;
}

/**
 * Map OpenF1 car numbers to Jolpica driver ids for one race. Car number is
 * authoritative when results exist; the acronym covers sessions that run
 * before Jolpica has published anything for the weekend.
 */
export function linkDrivers(
  sessionDrivers: SessionDriver[],
  results: ResultRow[] | undefined,
  codeToDriverId: Record<string, string>,
): DriverLink[] {
  const byNumber = new Map<number, string>();
  for (const r of results ?? []) if (r.carNumber !== null) byNumber.set(r.carNumber, r.driverId);
  return sessionDrivers.map((d) => ({
    number: d.number,
    driverId: byNumber.get(d.number) ?? codeToDriverId[d.acronym.toUpperCase()] ?? null,
    acronym: d.acronym,
    teamName: d.teamName,
    colour: d.teamColour,
    fullName: d.fullName,
  }));
}
