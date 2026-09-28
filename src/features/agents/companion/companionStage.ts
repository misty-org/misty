/** Bound an individual operation, never the lifetime of an executing task. */
export async function companionStage<T>(
  operation: Promise<T>,
  signal: AbortSignal,
  label: string,
  timeoutMs: number,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cancel: () => void = () => {};
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        cancel = () => reject(new DOMException("Companion interrupted", "AbortError"));
        if (signal.aborted) return cancel();
        signal.addEventListener("abort", cancel, { once: true });
        timer = setTimeout(
          () => reject(new Error(`${label} timed out. Please try again.`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", cancel);
  }
}
