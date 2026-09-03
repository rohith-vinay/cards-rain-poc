export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export interface PollOptions {
  /** Total time to keep trying before giving up. */
  timeoutMs?: number;
  /** Delay between attempts; grows up to maxIntervalMs. */
  intervalMs?: number;
  maxIntervalMs?: number;
  label?: string;
}

/**
 * Poll `fetcher` until `done` accepts the value. Used for the asynchronous parts of
 * Rain's flow: KYB review, and on-chain contract deployment.
 */
export async function pollUntil<T>(
  fetcher: () => Promise<T>,
  done: (value: T) => boolean,
  opts: PollOptions = {},
): Promise<T> {
  const timeoutMs = opts.timeoutMs ?? 120_000;
  const maxIntervalMs = opts.maxIntervalMs ?? 5_000;
  let interval = opts.intervalMs ?? 1_000;
  const deadline = Date.now() + timeoutMs;
  let last: T | undefined;

  while (Date.now() < deadline) {
    last = await fetcher();
    if (done(last)) return last;
    await sleep(interval);
    interval = Math.min(Math.round(interval * 1.5), maxIntervalMs);
  }

  throw new Error(
    `Timed out after ${Math.round(timeoutMs / 1000)}s waiting for ${opts.label ?? 'condition'}. ` +
      `Last value: ${JSON.stringify(last)}`,
  );
}
