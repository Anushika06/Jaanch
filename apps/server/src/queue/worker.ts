import { randomBytes } from 'node:crypto';
import type { Job, JobsRepo } from '@jaanch/db';
import type { Logger } from '../logger.js';

/** Throw from a handler to retry later; any other error is retried with backoff. */
export class RetryLater extends Error {
  constructor(
    message: string,
    readonly delayMs: number,
  ) {
    super(message);
  }
}

/** Throw from a handler when retrying cannot help (bad input, permanent provider error). */
export class PermanentFailure extends Error {}

export type JobHandler = (job: Job<unknown>) => Promise<void>;

export interface WorkerOptions {
  concurrency: number;
  /** 0 disables periodic polling: the worker wakes on enqueue and on scheduled run times only. */
  pollMs: number;
  /** Jobs locked longer than this are considered abandoned (process crashed) and re-queued. */
  leaseMs: number;
  logger: Logger;
}

const MAX_TIMER_MS = 2_147_000_000;

/**
 * In-process worker over the Postgres job table. Event-driven by default: it drains the queue
 * when poked (after an enqueue) and sleeps until the next scheduled job — so an idle server makes
 * no database queries, which lets a serverless Postgres scale to zero.
 */
export class Worker {
  readonly id = `w-${randomBytes(4).toString('hex')}`;
  private active = 0;
  private draining = false;
  private redrain = false;
  private stopped = true;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private poller: ReturnType<typeof setInterval> | null = null;
  private readonly inflight = new Set<Promise<void>>();

  constructor(
    private readonly jobs: JobsRepo,
    private readonly handlers: Record<string, JobHandler>,
    private readonly opts: WorkerOptions,
  ) {}

  async start(): Promise<void> {
    this.stopped = false;
    const recovered = await this.jobs.recoverStale(this.opts.leaseMs);
    if (recovered)
      this.opts.logger.warn({ recovered }, 'requeued jobs abandoned by a previous process');
    if (this.opts.pollMs > 0) this.poller = setInterval(() => this.poke(), this.opts.pollMs);
    this.poke();
  }

  /** Ask the worker to look for work now (called after enqueueing). */
  poke(): void {
    if (this.stopped) return;
    if (this.draining) {
      this.redrain = true;
      return;
    }
    void this.drain();
  }

  private async drain(): Promise<void> {
    this.draining = true;
    try {
      do {
        this.redrain = false;
        while (!this.stopped && this.active < this.opts.concurrency) {
          const job = await this.jobs.claim(this.id, Object.keys(this.handlers));
          if (!job) break;
          this.run(job);
        }
      } while (this.redrain && !this.stopped);
      if (!this.stopped && this.active < this.opts.concurrency) await this.scheduleNext();
    } catch (err) {
      this.opts.logger.error({ err: String(err) }, 'worker drain failed; retrying shortly');
      this.wakeIn(5_000);
    } finally {
      this.draining = false;
    }
  }

  private run(job: Job<unknown>): void {
    this.active += 1;
    const p = (async () => {
      const started = Date.now();
      const handler = this.handlers[job.kind]!;
      try {
        await handler(job);
        await this.jobs.complete(job.id);
        this.opts.logger.info(
          { job: job.id, kind: job.kind, ms: Date.now() - started },
          'job done',
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const delay =
          err instanceof PermanentFailure
            ? null
            : err instanceof RetryLater
              ? err.delayMs
              : Math.min(60_000, 2_000 * 2 ** job.attempts);
        const outcome = await this.jobs.fail(job.id, message, delay).catch(() => 'failed' as const);
        this.opts.logger.warn(
          { job: job.id, kind: job.kind, attempt: job.attempts, outcome, err: message },
          'job failed',
        );
      } finally {
        this.active -= 1;
        this.poke();
      }
    })();
    this.inflight.add(p);
    void p.finally(() => this.inflight.delete(p));
  }

  private async scheduleNext(): Promise<void> {
    const next = await this.jobs.nextRunAt();
    if (!next) return; // idle: sleep until poked
    this.wakeIn(Math.max(50, next.getTime() - Date.now()));
  }

  private wakeIn(ms: number): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(
      () => {
        this.timer = null;
        this.poke();
      },
      Math.min(ms, MAX_TIMER_MS),
    );
    this.timer.unref?.();
  }

  /** Stop taking new jobs and wait for running ones (graceful shutdown). */
  async stop(timeoutMs = 20_000): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    if (this.poller) clearInterval(this.poller);
    await Promise.race([
      Promise.allSettled([...this.inflight]),
      new Promise((r) => setTimeout(r, timeoutMs)),
    ]);
  }

  get busy(): number {
    return this.active;
  }
}
