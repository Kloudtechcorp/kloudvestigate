// One queue per upstream origin and credential prevents concurrent reports from
// independently sending bursts or ignoring another request's rate-limit cooldown.
export class KloudtrackRequestQueue {
  private tail: Promise<unknown> = Promise.resolve();
  private nextRequestAt = 0;

  constructor(private readonly gapMs: number) {}

  defer(delayMs: number) {
    this.nextRequestAt = Math.max(this.nextRequestAt, Date.now() + delayMs);
  }

  run<T>(request: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    const pending = this.tail.then(async () => {
      signal?.throwIfAborted();
      while (this.nextRequestAt > Date.now()) {
        await delay(Math.min(this.nextRequestAt - Date.now(), 2_147_483_647), signal);
      }
      signal?.throwIfAborted();
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
