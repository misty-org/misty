export interface ExponentialBackoffOptions {
  attempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  sleep?: (delayMs: number) => Promise<void>;
  random?: () => number;
}

export async function withExponentialBackoff<T>(
  operation: () => Promise<T>,
  options: ExponentialBackoffOptions,
): Promise<T> {
  const attempts = Math.max(1, Math.floor(options.attempts));
  const sleep =
    options.sleep ?? ((delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)));
  const random = options.random ?? Math.random;
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt === attempts - 1) break;
      const exponential = Math.min(options.maxDelayMs, options.baseDelayMs * 2 ** attempt);
      const jittered = Math.max(1, Math.round(exponential * (0.8 + random() * 0.4)));
      await sleep(jittered);
    }
  }

  throw lastError;
}
