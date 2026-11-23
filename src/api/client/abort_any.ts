export type CombinedSignal = { signal: AbortSignal; dispose(): void };

type AbortSignalWithAny = typeof AbortSignal & {
  any?: (signals: AbortSignal[]) => AbortSignal;
};

export function abortAny(
  signals: AbortSignal[],
  native: AbortSignalWithAny["any"] | null = (AbortSignal as AbortSignalWithAny).any,
): CombinedSignal {
  if (signals.length === 1) return { signal: signals[0], dispose: () => {} };
  if (typeof native === "function") {
    return { signal: native.call(AbortSignal, signals), dispose: () => {} };
  }
  const controller = new AbortController();
  const already = signals.find((signal) => signal.aborted);
  if (already) {
    controller.abort(already.reason);
    return { signal: controller.signal, dispose: () => {} };
  }
  const listeners: Array<[AbortSignal, () => void]> = [];
  const dispose = () => {
    for (const [signal, listener] of listeners) signal.removeEventListener("abort", listener);
    listeners.length = 0;
  };
  for (const signal of signals) {
    const listener = () => {
      dispose();
      controller.abort(signal.reason);
    };
    listeners.push([signal, listener]);
    signal.addEventListener("abort", listener, { once: true });
  }
  return { signal: controller.signal, dispose };
}
