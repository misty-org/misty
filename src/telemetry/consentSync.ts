export type Consent = readonly [usageAnalytics: boolean, errorReports: boolean];
export type ConsentWriter = (...consent: Consent) => Promise<void>;

/** Serializes consent changes and remembers only a successful write in this session. */
export class ConsentSync {
  private scope: string | null = null;
  private epoch = 0;
  private desired?: { epoch: number; key: string; values: Consent };
  private acknowledged?: string;
  private running = false;

  constructor(private readonly write: ConsentWriter) {}

  update(scope: string | null, values: Consent): void {
    if (scope !== this.scope) {
      this.scope = scope;
      this.epoch++;
      this.acknowledged = undefined;
      this.desired = undefined;
    }
    if (scope === null) return;
    this.desired = { epoch: this.epoch, key: JSON.stringify([this.epoch, ...values]), values };
    if (!this.running) void this.drain();
  }

  private async drain(): Promise<void> {
    this.running = true;
    try {
      while (this.desired && this.desired.key !== this.acknowledged) {
        const request = this.desired;
        try {
          await this.write(...request.values);
          if (request.epoch === this.epoch) this.acknowledged = request.key;
        } catch {
          // A later explicit trigger can retry failure. Never spin on a rejected session.
          if (this.desired?.key === request.key) break;
        }
      }
    } finally {
      this.running = false;
    }
  }
}
