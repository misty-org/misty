// Right after browser work, the agent's next browser step usually follows
// within seconds. The worker then holds its next claim open on the server
// (docs/plans/agentic-browser.md, Phase 2: faster device hop) so the job is
// handed over the moment it is queued, instead of after a notification
// reaches this device and it asks again. Notifications stay the fallback.
export const heldClaimWaitMs = 25_000;
const holdAfterBrowserJobMs = 30_000;

export class HeldClaims {
  private lastBrowserJobAt = Number.NEGATIVE_INFINITY;
  private unsupported = false;
  private controller?: AbortController;

  noteBrowserJob(): void {
    this.lastBrowserJobAt = Date.now();
  }

  /** The hold for the next claim, or undefined to claim without waiting. */
  next(): { waitMs: number; signal: AbortSignal } | undefined {
    if (this.unsupported || Date.now() - this.lastBrowserJobAt > holdAfterBrowserJobMs)
      return undefined;
    this.controller = new AbortController();
    return { waitMs: heldClaimWaitMs, signal: this.controller.signal };
  }

  /** A server without held claims refuses the field; claim without it from then on. */
  refused(error: unknown): boolean {
    const status =
      error && typeof error === "object" && "status" in error ? Number(error.status) : 0;
    if (status !== 400) return false;
    this.unsupported = true;
    return true;
  }

  /** Hangs up a held claim; the server puts back any job it had just claimed. */
  cancel(): void {
    this.controller?.abort(new Error("device_execution_stopped"));
    this.controller = undefined;
  }
}
