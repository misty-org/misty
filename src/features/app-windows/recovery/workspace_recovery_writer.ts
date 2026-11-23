import type { NativeRecoveryStorage } from "./recovery_storage";

export function windowRecoveryKey(windowId: string) {
  return `workspace:w:${windowId}`;
}

export function readRecoveryRecord(storage: NativeRecoveryStorage, key: string): string | null {
  return storage.getItem(key) || null;
}

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
