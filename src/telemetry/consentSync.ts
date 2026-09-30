/**
 * Saves the analytics and error-reporting consent switches to the account.
 *
 * The settings document is re-applied for many unrelated reasons (startup, a
 * profile refresh, any other setting changing). Consent is sent only when the
 * pair actually differs from the last pair this signed-in session saved, and
 * it runs at idle priority: it never competes with work the user is waiting on.
 */
export type ConsentSender = (usageAnalytics: boolean, errorReports: boolean) => Promise<void>;

export interface ConsentSync {
  /** Record the current pair; sends later only when it differs from what was saved. */
  update(usageAnalytics: boolean, errorReports: boolean): void;
  /** A new signed-in session has not saved anything yet. */
  reset(): void;
}

type Schedule = (run: () => void) => void;

const idle: Schedule = (run) => {
  const request = (globalThis as { requestIdleCallback?: (cb: () => void, o?: object) => number })
    .requestIdleCallback;
  if (request) request(run, { timeout: 10_000 });
  else setTimeout(run, 1_000);
};

export function createConsentSync(send: () => ConsentSender | null, schedule = idle): ConsentSync {
  let saved: string | null = null;
  let desired: [boolean, boolean] | null = null;
  let queued = false;
  let generation = 0;
  const flush = () => {
    queued = false;
    const sender = send();
    if (!desired || !sender) return;
    const [usage, errors] = desired;
    const key = `${usage}:${errors}`;
    if (key === saved) return;
    saved = key;
    const current = generation;
    void sender(usage, errors).catch(() => {
      // Allow the next real change or sign-in to try again; never retry in a loop.
      if (current === generation && saved === key) saved = null;
    });
  };
  return {
    update(usageAnalytics, errorReports) {
      desired = [usageAnalytics, errorReports];
      if (`${usageAnalytics}:${errorReports}` === saved || queued) return;
      queued = true;
      schedule(flush);
    },
    reset() {
      generation++;
      saved = null;
    },
  };
}
