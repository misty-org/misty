// Right after browser work, the agent's next browser step usually follows
// within seconds. The worker then holds its next claim open on the server
// (docs/agents/harness.md, Device jobs) so the job is
// handed over the moment it is queued, instead of after a notification
// reaches this device and it asks again. Notifications stay the fallback.
export const heldClaimWaitMs = 25_000;
/** A run's next step comes after the model's turn, often well past half a minute, and a run can
 * last many minutes: hold claims open for ten minutes after any job, re-holding each that comes
 * back empty, so a step never waits on a notification that a reconnecting socket dropped. */
export const holdAfterJobMs = 600_000;

export class HeldClaims {
  private lastJobAt = Number.NEGATIVE_INFINITY;
  private unsupported = false;
  private controller?: AbortController;

  noteJob(): void {
    this.lastJobAt = Date.now();
  }

  /** Whether claims are held now, so an empty one is held again rather than ended. */
  holding(): boolean {
    return !this.unsupported && Date.now() - this.lastJobAt <= holdAfterJobMs;
  }

  /** The hold for the next claim, or undefined to claim without waiting. */
  next(): { waitMs: number; signal: AbortSignal } | undefined {
    if (this.unsupported || Date.now() - this.lastJobAt > holdAfterJobMs) return undefined;
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
