/** Display formatting. Times are shown in the viewer's own time zone. */

export function pct(p: number, digits?: number): string {
  if (!Number.isFinite(p)) return '–';
  const v = p * 100;
  if (digits !== undefined) return `${v.toFixed(digits)}%`;
  if (v > 0 && v < 0.1) return '<0.1%';
  if (v > 99.9 && v < 100) return '>99.9%';
  if (v < 10) return `${v.toFixed(1)}%`;
  return `${Math.round(v)}%`;
}

export function lapTime(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return '–';
  const m = Math.floor(ms / 60_000);
  const s = (ms % 60_000) / 1000;
  return m > 0 ? `${m}:${s.toFixed(3).padStart(6, '0')}` : s.toFixed(3);
}

export function gap(ms: number | null | undefined, digits = 3): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return '–';
  const sign = ms < 0 ? '−' : '+';
  const a = Math.abs(ms);
  if (a >= 60_000) return `${sign}${lapTime(a)}`;
  return `${sign}${(a / 1000).toFixed(digits)}`;
}

export function seconds(ms: number, digits = 1): string {
  return `${(ms / 1000).toFixed(digits)}s`;
}

export function signed(n: number, digits = 0): string {
  if (!Number.isFinite(n)) return '–';
  const v = n.toFixed(digits);
  return n > 0 ? `+${v}` : n < 0 ? `−${v.slice(1)}` : v;
}

export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]!);
}

const dateFmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' });
const dateLong = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
const timeFmt = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });

export function shortDate(ms: number): string {
  return dateFmt.format(ms);
}

export function longDate(ms: number): string {
  return dateLong.format(ms);
}

export function clock(ms: number): string {
  return timeFmt.format(ms);
}

const hourFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric' });

/** "9 AM" or "09" depending on the viewer's locale. */
export function hourLabel(ms: number): string {
  return hourFmt.format(ms);
}

/** Track-local wall clock from OpenF1's gmt_offset ("08:00:00" / "-05:00:00"). */
export function trackClock(ms: number, gmtOffset: string): string {
  const m = /^(-)?(\d{2}):(\d{2})/.exec(gmtOffset);
  if (!m) return clock(ms);
  const sign = m[1] ? -1 : 1;
  const offset = sign * (Number(m[2]) * 60 + Number(m[3])) * 60_000;
  const d = new Date(ms + offset);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

/** "GMT+8", "GMT−5", "GMT+5:30" from OpenF1's gmt_offset. */
export function gmtLabel(gmtOffset: string): string {
  const m = /^(-)?(\d{2}):(\d{2})/.exec(gmtOffset);
  if (!m) return 'GMT';
  const h = Number(m[2]);
  const min = Number(m[3]);
  if (h === 0 && min === 0) return 'GMT';
  return `GMT${m[1] ? '−' : '+'}${h}${min ? `:${String(min).padStart(2, '0')}` : ''}`;
}

export function dateRange(a: number, b: number): string {
  const da = new Date(a);
  const db = new Date(b);
  if (da.getMonth() === db.getMonth()) return `${da.getDate()}–${dateFmt.format(b)}`;
  return `${dateFmt.format(a)} – ${dateFmt.format(b)}`;
}

/** "3d 04h", "4h 12m", "12m 05s". */
export function countdown(ms: number): string {
  if (ms <= 0) return 'now';
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return `${d}d ${String(h).padStart(2, '0')}h`;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  return `${m}m ${String(sec).padStart(2, '0')}s`;
}

export function relativeTime(ms: number, now: number): string {
  const d = ms - now;
  const a = Math.abs(d);
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  if (a < 3_600_000) return rtf.format(Math.round(d / 60_000), 'minute');
  if (a < 86_400_000) return rtf.format(Math.round(d / 3_600_000), 'hour');
  return rtf.format(Math.round(d / 86_400_000), 'day');
}

export function compactNumber(n: number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(n);
}

export function plural(n: number, word: string, pluralWord = word + 's'): string {
  return `${n} ${n === 1 ? word : pluralWord}`;
}
