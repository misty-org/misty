/** Rejects when `work` has not settled within `ms`. The work itself keeps
 * running; callers only stop waiting on it. */
export function withDeadline<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("deadline")), ms);
  });
  return Promise.race([work, expired]).finally(() => clearTimeout(timer));
}

/** Saves page state before leaving a workspace. Best effort: a page that never
 * answers must not block the switch. */
export const captureBeforeSwitch = () =>
  withDeadline(
    import("./restore/capture").then(({ captureAll }) => captureAll(true)),
    5000,
  ).catch(() => undefined);

/** Longest a native sync command may take before the control gives up. */
export const nativeCommandMs = 15000;
