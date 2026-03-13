/**
 * Retry helper with exponential back-off.
 *
 * Defaults: 3 attempts, 1 s base delay, 2× multiplier.
 */

export interface RetryOptions {
  attempts?: number;
  baseDelayMs?: number;
  multiplier?: number;
}

const DEFAULT: Required<RetryOptions> = {
  attempts: 3,
  baseDelayMs: 1000,
  multiplier: 2,
};

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts?: RetryOptions,
): Promise<T> {
  const { attempts, baseDelayMs, multiplier } = { ...DEFAULT, ...opts };
  let lastError: unknown;

  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (i < attempts - 1) {
        const delay = baseDelayMs * Math.pow(multiplier, i);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }

  throw lastError;
}
