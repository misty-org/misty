import type { NativeRecoveryStorage } from "./recoveryStorage";

/** Each window saves its own tabs under its own id, so two windows of a profile can't overwrite
 * each other. */
export function windowRecoveryKey(windowId: string) {
  return `workspace:w:${windowId}`;
}

/** The recovery store has no delete: a record's value is blanked, and blank reads as nothing. */
export function readRecoveryRecord(storage: NativeRecoveryStorage, key: string): string | null {
  return storage.getItem(key) || null;
}

/** Snapshot at the end of a burst, not on every resize frame. The recovery store
 * retains the exact failed write for a retry before accepting the newest value. */
export class WorkspaceRecoveryWriter {
  private timer?: ReturnType<typeof setTimeout>;
  private since?: number;
  constructor(
    private storage: NativeRecoveryStorage,
    private key: string,
    private capture: () => string,
    private failed: (error: unknown) => void,
    private saved: () => void = () => undefined,
  ) {}
  changed() {
    this.since ??= Date.now();
    clearTimeout(this.timer);
    this.timer = setTimeout(
      () => {
        void this.flush().then(this.saved, this.failed);
      },
      Math.max(0, Math.min(400, 2000 - (Date.now() - this.since))),
    );
  }
  /** `retry` also re-attempts saves native refused before; background saves
   * leave those alone until their value changes. */
  async flush(retry = false) {
    this.cancel();
    this.storage.setItem(this.key, this.capture());
    await (retry ? this.storage.retry() : this.storage.flush());
  }
  cancel() {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.since = undefined;
  }
}
