import type { MistyAppSDK } from "@misty/sdk";

/** One leased native watch. Polling transfers only a coalesced revision, never paths.
 * Native code receives filesystem events; this does not scan the tree on a timer.
 */
export async function observeSdkDirectory(
  files: Pick<MistyAppSDK["files"], "watchDirectory" | "watchStatus" | "watchClose">,
  directory: string,
  options: { signal: AbortSignal; onChange(): void; onError(error: unknown): void },
) {
  let closed = false;
  let watcher: string | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let revision = 0;
  const closeWatch = async (handle: string) => {
    await files.watchClose(handle).catch(() => undefined);
  };
  const close = async () => {
    if (closed) return;
    closed = true;
    clearTimeout(timer);
    options.signal.removeEventListener("abort", abort);
    const handle = watcher;
    watcher = undefined;
    if (handle) await closeWatch(handle);
  };
  const abort = () => {
    void close();
  };
  const alive = () => !closed && !options.signal.aborted;
  const report = (error: unknown) => {
    if (alive()) {
      try {
        options.onError(error);
      } catch {
        /* An observer callback cannot retain a native lease. */
      }
    }
  };
  const changed = () => {
    if (alive()) {
      try {
        options.onChange();
      } catch (error) {
        report(error);
      }
    }
  };
  const open = async () => {
    if (!alive()) throw new Error("This folder observer is closed.");
    const result = await files.watchDirectory(directory);
    if (!alive()) {
      await closeWatch(result.watcher);
      throw new Error("This folder observer is closed.");
    }
    watcher = result.watcher;
    revision = 0;
  };
  const poll = async () => {
    if (!alive() || !watcher) return;
    try {
      const status = await files.watchStatus(watcher);
      if (!alive()) return;
      if (status.revision !== revision || !status.active) changed();
      revision = status.revision;
      if (!status.active) {
        const handle = watcher;
        watcher = undefined;
        await closeWatch(handle);
        if (status.reason !== "root_changed") throw new Error("The native folder watcher stopped.");
        // The native grant survives a rename; reopen against its new location.
        await open();
      }
      if (alive())
        timer = setTimeout(() => {
          void poll();
        }, 500);
    } catch (error) {
      report(error);
      await close();
    }
  };
  options.signal.addEventListener("abort", abort, { once: true });
  try {
    await open();
    timer = setTimeout(() => {
      void poll();
    }, 500);
    return close;
  } catch (error) {
    await close();
    throw error;
  }
}
