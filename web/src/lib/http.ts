/**
 * A polite HTTP client for rate-limited public APIs.
 *
 * Both data sources publish hard limits — Jolpica allows 4 requests/second and
 * 500/hour, OpenF1's free tier 3/second and 30/minute — and both answer an
 * over-eager client with HTTP 429. This queue:
 *
 *   - deduplicates identical in-flight requests (ten charts asking for the
 *     same lap data cost one request, not ten);
 *   - spaces requests out and keeps a sliding window per limit, persisted to
 *     localStorage so a page reload does not reset the count the server still
 *     remembers;
 *   - serves "high" priority work (what is on screen) before "low" priority
 *     prefetching (replay buffering, thumbnails);
 *   - retries 429 / 5xx / network failures with backoff, honouring Retry-After;
 *   - publishes its state so the UI can say "waiting for OpenF1" instead of
 *     looking frozen.
 */

import { readStored, writeStored } from './storage';

export interface LimitRule {
  max: number;
  windowMs: number;
}

export class HttpError extends Error {
  readonly status: number;
  readonly url: string;
  constructor(status: number, url: string, message?: string) {
    super(message ?? `HTTP ${status} for ${url}`);
    this.name = 'HttpError';
    this.status = status;
    this.url = url;
  }
}

export type Priority = 'high' | 'low';

export interface QueueStatus {
  name: string;
  queued: number;
  inFlight: number;
  /** Epoch ms until which the queue is deliberately idle, or null. */
  waitingUntil: number | null;
  reason: 'pacing' | 'rate-limited' | 'retrying' | null;
  completed: number;
  failed: number;
}

interface Job {
  url: string;
  priority: Priority;
  attempt: number;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
}

export interface QueueOptions {
  name: string;
  concurrency: number;
  minIntervalMs: number;
  rules: LimitRule[];
  maxRetries?: number;
  persist?: boolean;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

const RETRYABLE = new Set([429, 500, 502, 503, 504]);

export class RequestQueue {
  private readonly opts: Required<Omit<QueueOptions, 'fetchImpl' | 'now'>>;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly jobs: Job[] = [];
  private readonly inflightByUrl = new Map<string, Promise<unknown>>();
  private stamps: number[] = [];
  private lastStart = 0;
  private blockedUntil = 0;
  private running = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<(s: QueueStatus) => void>();
  private completed = 0;
  private failed = 0;
  private status: QueueStatus;

  constructor(options: QueueOptions) {
    this.opts = { maxRetries: 4, persist: true, ...options } as Required<Omit<QueueOptions, 'fetchImpl' | 'now'>>;
    this.fetchImpl = options.fetchImpl ?? ((input, init) => globalThis.fetch(input, init));
    this.now = options.now ?? (() => Date.now());
    this.status = this.snapshot(null, null);
    if (this.opts.persist) {
      const saved = readStored<number[]>('rate:' + this.opts.name);
      if (saved && Array.isArray(saved.value)) {
        const horizon = this.now() - this.longestWindow();
        this.stamps = saved.value.filter((t) => typeof t === 'number' && t > horizon && t <= this.now());
      }
    }
  }

  /** GET a URL and parse JSON. Identical concurrent calls share one request. */
  json<T>(url: string, priority: Priority = 'high'): Promise<T> {
    const existing = this.inflightByUrl.get(url);
    if (existing) {
      // Upgrade priority if an on-screen consumer now wants a queued prefetch.
      if (priority === 'high') {
        const queued = this.jobs.find((j) => j.url === url);
        if (queued) queued.priority = 'high';
      }
      return existing as Promise<T>;
    }
    const promise = new Promise<unknown>((resolve, reject) => {
      this.jobs.push({ url, priority, attempt: 0, resolve, reject });
    }).finally(() => {
      this.inflightByUrl.delete(url);
    });
    this.inflightByUrl.set(url, promise);
    this.pump();
    return promise as Promise<T>;
  }

  /** Adjust limits at runtime (tests, or a future API token with a higher quota). */
  tune(options: Partial<Pick<QueueOptions, 'concurrency' | 'minIntervalMs' | 'rules' | 'persist'>>): void {
    Object.assign(this.opts, options);
    this.pump();
  }

  subscribe(listener: (s: QueueStatus) => void): () => void {
    this.listeners.add(listener);
    listener(this.status);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getStatus(): QueueStatus {
    return this.status;
  }

  // -------------------------------------------------------------------------

  private longestWindow(): number {
    return Math.max(1000, ...this.opts.rules.map((r) => r.windowMs));
  }

  /** Milliseconds until the next request may start (0 = now). */
  private delayUntilAllowed(now: number): number {
    let wait = Math.max(0, this.blockedUntil - now, this.lastStart + this.opts.minIntervalMs - now);
    for (const rule of this.opts.rules) {
      const inWindow = this.stamps.filter((t) => t > now - rule.windowMs);
      if (inWindow.length >= rule.max) {
        const oldest = inWindow[inWindow.length - rule.max]!;
        wait = Math.max(wait, oldest + rule.windowMs - now + 5);
      }
    }
    return wait;
  }

  private nextJob(): Job | undefined {
    const idx = this.jobs.findIndex((j) => j.priority === 'high');
    if (idx >= 0) return this.jobs.splice(idx, 1)[0];
    return this.jobs.shift();
  }

  private pump(): void {
    if (this.timer) return; // a wake-up is already scheduled
    while (this.running < this.opts.concurrency && this.jobs.length > 0) {
      const now = this.now();
      const wait = this.delayUntilAllowed(now);
      if (wait > 0) {
        const reason = this.blockedUntil > now ? 'rate-limited' : 'pacing';
        this.publish(wait > 1500 ? now + wait : null, wait > 1500 ? reason : null);
        this.timer = setTimeout(() => {
          this.timer = null;
          this.pump();
        }, wait);
        return;
      }
      const job = this.nextJob();
      if (!job) break;
      this.lastStart = now;
      this.stamps.push(now);
      this.trimStamps(now);
      this.running++;
      void this.run(job);
    }
    this.publish(null, null);
  }

  private trimStamps(now: number): void {
    const horizon = now - this.longestWindow();
    if (this.stamps.length > 0 && this.stamps[0]! <= horizon) {
      this.stamps = this.stamps.filter((t) => t > horizon);
    }
    if (this.opts.persist) writeStored('rate:' + this.opts.name, this.stamps);
  }

  private async run(job: Job): Promise<void> {
    let retryDelay: number | null = null;
    let throttled = false;
    try {
      const res = await this.fetchImpl(job.url, {
        headers: { Accept: 'application/json' },
        credentials: 'omit',
        mode: 'cors',
      });
      if (res.ok) {
        const body = (await res.json()) as unknown;
        this.completed++;
        job.resolve(body);
      } else if (RETRYABLE.has(res.status) && job.attempt < this.opts.maxRetries) {
        retryDelay = this.backoff(job.attempt, res.headers.get('Retry-After'));
        if (res.status === 429) {
          throttled = true;
          this.blockedUntil = Math.max(this.blockedUntil, this.now() + retryDelay);
        }
      } else {
        this.failed++;
        job.reject(new HttpError(res.status, job.url));
      }
    } catch (err) {
      // TypeError from fetch = network failure or CORS rejection; JSON errors land here too.
      if (job.attempt < this.opts.maxRetries && !(err instanceof SyntaxError)) {
        retryDelay = this.backoff(job.attempt, null);
      } else {
        this.failed++;
        job.reject(err);
      }
    } finally {
      this.running--;
    }

    if (retryDelay !== null) {
      job.attempt++;
      setTimeout(() => {
        this.jobs.unshift(job);
        this.pump();
      }, retryDelay);
      this.publish(this.now() + retryDelay, throttled ? 'rate-limited' : 'retrying');
      return;
    }
    this.pump();
  }

  private backoff(attempt: number, retryAfter: string | null): number {
    if (retryAfter) {
      const secs = Number(retryAfter);
      if (Number.isFinite(secs) && secs >= 0) return Math.min(120_000, secs * 1000 + 250);
      const at = Date.parse(retryAfter);
      if (Number.isFinite(at)) return Math.min(120_000, Math.max(500, at - this.now()));
    }
    const base = Math.min(30_000, 1000 * 2 ** attempt);
    return base + Math.floor(Math.random() * 400);
  }

  private snapshot(waitingUntil: number | null, reason: QueueStatus['reason']): QueueStatus {
    return {
      name: this.opts.name,
      queued: this.jobs.length,
      inFlight: this.running,
      waitingUntil,
      reason,
      completed: this.completed,
      failed: this.failed,
    };
  }

  private publish(waitingUntil: number | null, reason: QueueStatus['reason']): void {
    const next = this.snapshot(waitingUntil, reason);
    const prev = this.status;
    if (
      prev.queued === next.queued &&
      prev.inFlight === next.inFlight &&
      prev.waitingUntil === next.waitingUntil &&
      prev.reason === next.reason &&
      prev.completed === next.completed &&
      prev.failed === next.failed
    ) {
      return;
    }
    this.status = next;
    this.listeners.forEach((l) => l(next));
  }
}

/** Jolpica: documented 4 req/s burst, 500 req/hour sustained. */
export const jolpicaQueue = new RequestQueue({
  name: 'jolpica',
  concurrency: 2,
  minIntervalMs: 300,
  rules: [
    { max: 4, windowMs: 1000 },
    { max: 450, windowMs: 3_600_000 },
  ],
});

/** OpenF1 community tier: documented 3 req/s and 30 req/minute. */
export const openf1Queue = new RequestQueue({
  name: 'openf1',
  concurrency: 2,
  minIntervalMs: 400,
  rules: [
    { max: 3, windowMs: 1000 },
    { max: 28, windowMs: 60_000 },
  ],
});

/** Open-Meteo (race-day forecasts): generous limits, but one forecast per page is plenty. */
export const weatherQueue = new RequestQueue({
  name: 'open-meteo',
  concurrency: 1,
  minIntervalMs: 250,
  rules: [{ max: 20, windowMs: 60_000 }],
  maxRetries: 1,
  persist: false,
});

// The automated test suite talks to a local fake API and sets this flag so it
// is not throttled like the real servers. It has no effect anywhere else.
if ((globalThis as { __UNDERCUT_TEST_FAST_NETWORK__?: boolean }).__UNDERCUT_TEST_FAST_NETWORK__) {
  for (const q of [jolpicaQueue, openf1Queue, weatherQueue]) q.tune({ minIntervalMs: 0, rules: [], concurrency: 4, persist: false });
}
