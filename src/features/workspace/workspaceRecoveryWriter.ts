import type { NativeRecoveryStorage } from "@/features/browser-sync/recovery";
import { spaceWindow } from "./spaceWindow";

/** A window saves its tabs under the Space it shows. The personal Space keeps the record
 * from before Spaces had windows, so its tabs come back. */
export function spaceRecoveryKey(space: { personal: boolean; key: string }) {
  return space.personal ? "workspace" : `workspace:space:${space.key}`;
}

/** Snapshot at the end of a burst, not on every resize frame. The recovery store
 * retains the exact failed write for a retry before accepting the newest value. */
export class WorkspaceRecoveryWriter {
  private timer?: ReturnType<typeof setTimeout>;
  private since?: number;
  constructor(
    private storage: NativeRecoveryStorage,
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
    this.storage.setItem(spaceRecoveryKey(spaceWindow()), this.capture());
    await (retry ? this.storage.retry() : this.storage.flush());
  }
  cancel() {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.since = undefined;
  }
}
