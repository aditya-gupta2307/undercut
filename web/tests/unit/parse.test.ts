import { test } from 'node:test';
import assert from 'node:assert/strict';
import { combineDateTime, durationToMs, hexColour, lapsDown, parseIso, secondsToMs } from '../../src/data/parse';

test('parseIso handles OpenF1 six-digit fractions and offsets', () => {
  assert.equal(parseIso('2023-09-16T13:59:07.606000+00:00'), Date.UTC(2023, 8, 16, 13, 59, 7, 606));
  assert.equal(parseIso('2024-09-22T12:03:57+00:00'), Date.UTC(2024, 8, 22, 12, 3, 57));
  assert.equal(parseIso('2026-10-09T08:30:00+08:00'), Date.UTC(2026, 9, 9, 0, 30, 0));
  assert.equal(parseIso('2026-10-09T08:30:00-05:00'), Date.UTC(2026, 9, 9, 13, 30, 0));
  assert.equal(parseIso('2026-10-09T08:30:00Z'), Date.UTC(2026, 9, 9, 8, 30, 0));
  // No zone means UTC (OpenF1's own query examples use this form).
  assert.equal(parseIso('2023-09-16T13:03:35.2'), Date.UTC(2023, 8, 16, 13, 3, 35, 200));
  assert.equal(parseIso('2026-03-08'), Date.UTC(2026, 2, 8));
  assert.equal(parseIso('not a date'), null);
  assert.equal(parseIso(null), null);
  assert.equal(parseIso(12345), null);
});

test('combineDateTime joins Jolpica date and time fields', () => {
  assert.equal(combineDateTime('2026-03-08', '04:00:00Z'), Date.UTC(2026, 2, 8, 4, 0, 0));
  assert.equal(combineDateTime('2026-03-08', undefined), null);
  assert.equal(combineDateTime(undefined, '04:00:00Z'), null);
});

test('durationToMs parses lap times, race times and gaps', () => {
  assert.equal(durationToMs('1:38.220'), 98_220);
  assert.equal(durationToMs('1:47:14.808'), 6_434_808);
  assert.equal(durationToMs('+2.307'), 2_307);
  assert.equal(durationToMs('23.4'), 23_400);
  assert.equal(durationToMs('105.334'), 105_334);
  assert.equal(durationToMs(''), null); // Jolpica sends "" for an unset Q2
  assert.equal(durationToMs(undefined), null);
  assert.equal(durationToMs('DNF'), null);
  assert.equal(durationToMs(91.743), 91_743);
});

test('lapsDown reads OpenF1 lapped-car gaps', () => {
  assert.equal(lapsDown('+1 LAP'), 1);
  assert.equal(lapsDown('+3 LAPS'), 3);
  assert.equal(lapsDown(20.945), 0);
  assert.equal(lapsDown(null), 0);
});

test('secondsToMs and hexColour', () => {
  assert.equal(secondsToMs(22.215), 22_215);
  assert.equal(secondsToMs(null), null);
  assert.equal(hexColour('3671C6'), '#3671C6');
  assert.equal(hexColour('#00d7b6'), '#00D7B6');
  assert.equal(hexColour('nope'), null);
  assert.equal(hexColour(null), null);
});
