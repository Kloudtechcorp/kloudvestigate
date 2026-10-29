// One queue per upstream origin and credential prevents concurrent reports from
// independently sending bursts or ignoring another request's rate-limit cooldown.

/** At most `max` requests in any `windowMs`; every window must have room before a request is sent. */
export type RequestBudget = Array<{ windowMs: number; max: number }>;

export class RequestBudgetExceededError extends Error {
  constructor(readonly retryAfterMs: number) {
    super(`The request budget has no room for another ${Math.ceil(retryAfterMs / 1000)} seconds.`);
    this.name = "RequestBudgetExceededError";
  }
}

export class KloudtrackRequestQueue {
  private tail: Promise<unknown> = Promise.resolve();
  private nextRequestAt = 0;
  private sentAt: number[] = [];

  constructor(
    private readonly gapMs: number,
    private readonly budget: RequestBudget = [],
    // A longer wait would outlast a serverless request, so the caller is told to retry later instead.
    private readonly maxBudgetWaitMs = Number.POSITIVE_INFINITY,
  ) {}

  defer(delayMs: number) {
    this.nextRequestAt = Math.max(this.nextRequestAt, Date.now() + delayMs);
  }

  run<T>(request: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    const pending = this.tail.then(async () => {
      signal?.throwIfAborted();
      while (true) {
        const now = Date.now();
        const budgetWaitMs = this.budgetWaitMs(now);
        if (budgetWaitMs > this.maxBudgetWaitMs) throw new RequestBudgetExceededError(budgetWaitMs);
        const waitMs = Math.max(this.nextRequestAt - now, budgetWaitMs);
        if (waitMs <= 0) break;
        await delay(Math.min(waitMs, 2_147_483_647), signal);
      }
      signal?.throwIfAborted();
      this.sentAt.push(Date.now());
      try {
        return await request();
      } finally {
        this.defer(this.gapMs);
      }
    });
    // A failed or cancelled request must not break the queue for later reports.
    this.tail = pending.catch(() => {});
    return withAbort(pending, signal);
  }

  private budgetWaitMs(now: number) {
    if (!this.budget.length) return 0;

    const longestWindowMs = Math.max(...this.budget.map((limit) => limit.windowMs));
    const keepFrom = this.sentAt.findIndex((time) => time > now - longestWindowMs);
    this.sentAt = keepFrom === -1 ? [] : this.sentAt.slice(keepFrom);

    let waitMs = 0;
    for (const { windowMs, max } of this.budget) {
      const inWindow = this.sentAt.filter((time) => time > now - windowMs);
      // The request that must leave the window before another one fits.
      if (inWindow.length >= max) waitMs = Math.max(waitMs, inWindow[inWindow.length - max] + windowMs - now);
    }
    return waitMs;
  }
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted();
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal!.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function withAbort<T>(pending: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return pending;
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    pending.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}
