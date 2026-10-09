import { test } from 'node:test';
import assert from 'node:assert/strict';
import { forecastAvailable, openMeteoUrl, parseOpenMeteo, summariseRaceWeather, weatherLabel } from '../../src/data/weather';
import { gmtLabel } from '../../src/lib/format';

const sample = {
  latitude: 1.29,
  longitude: 103.86,
  timezone: 'GMT',
  hourly_units: { time: 'iso8601', temperature_2m: '°C', precipitation_probability: '%' },
  hourly: {
    time: ['2026-10-11T10:00', '2026-10-11T11:00', '2026-10-11T12:00', '2026-10-11T13:00', '2026-10-11T14:00'],
    temperature_2m: [29.1, 28.4, 27.9, null, 27.2],
    precipitation_probability: [10, 20, 40, 60, 30],
    precipitation: [0, 0, 0.2, 1.4, 0],
    wind_speed_10m: [9.4, 8.1, 7.7, 12.0, 6.5],
    weather_code: [1, 3, 61, 95, 2],
  },
};

test('Open-Meteo hourly blocks are parsed as GMT hours', () => {
  const rows = parseOpenMeteo(sample);
  assert.equal(rows.length, 5);
  assert.equal(rows[0]!.at, Date.UTC(2026, 9, 11, 10));
  assert.equal(rows[2]!.rainChance, 0.4);
  assert.equal(rows[3]!.tempC, null);
  assert.equal(rows[3]!.code, 95);
  assert.deepEqual(parseOpenMeteo({ error: true, reason: 'nope' }), []);
  assert.deepEqual(parseOpenMeteo(null), []);
});

test('race weather summary covers lights out to two hours later', () => {
  const rows = parseOpenMeteo(sample);
  const s = summariseRaceWeather(rows, Date.UTC(2026, 9, 11, 12, 0));
  assert.equal(s.atStart!.at, Date.UTC(2026, 9, 11, 12));
  assert.equal(s.peakRainChance, 0.6);
  // Between the wettest hour (0.6) and the independent combination (1 − 0.6·0.4 = 0.76).
  assert.ok(s.anyRainChance! > 0.6 && s.anyRainChance! < 0.76);
  assert.deepEqual(s.tempRange, [27.9, 27.9]);
  assert.equal(weatherLabel(95), 'Thunderstorms');
  assert.equal(weatherLabel(61), 'Rain');
  assert.equal(weatherLabel(null), '–');
});

test('forecasts are only requested inside the forecast horizon', () => {
  const now = Date.UTC(2026, 9, 9, 6);
  assert.equal(forecastAvailable(Date.UTC(2026, 9, 11, 12), now), true);
  assert.equal(forecastAvailable(Date.UTC(2026, 10, 29, 16), now), false);
  assert.equal(forecastAvailable(Date.UTC(2026, 9, 4, 7), now), false);
  const url = new URL(openMeteoUrl(1.2914, 103.864, Date.UTC(2026, 9, 11, 10), Date.UTC(2026, 9, 11, 15)));
  assert.equal(url.hostname, 'api.open-meteo.com');
  assert.equal(url.searchParams.get('start_date'), '2026-10-11');
  assert.equal(url.searchParams.get('end_date'), '2026-10-11');
  assert.equal(url.searchParams.get('timezone'), 'GMT');
});

test('GMT offsets read naturally', () => {
  assert.equal(gmtLabel('08:00:00'), 'GMT+8');
  assert.equal(gmtLabel('-05:00:00'), 'GMT−5');
  assert.equal(gmtLabel('05:30:00'), 'GMT+5:30');
  assert.equal(gmtLabel('00:00:00'), 'GMT');
  assert.equal(gmtLabel('garbage'), 'GMT');
});
