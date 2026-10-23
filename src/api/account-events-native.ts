import { hasTauriInternals } from "@/shared/platform/tauri";
import { validEvent, type Subscriber } from "./account-event-model";

interface NativeAccountFeed {
  accountId: string;
  connected: boolean;
}

export async function nativeFeedConnected(accountId: string): Promise<boolean> {
  if (!hasTauriInternals()) return false;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const feed = await invoke<NativeAccountFeed | null>("browser_sync_account_feed");
    return !!feed && feed.connected && feed.accountId === accountId;
  } catch {
    // Not the main window, or no sync session: use the event stream.
    return false;
  }
}

/** Calls `onConnected` once the native feed for this account comes up. */
export function watchNativeFeed(accountId: string, onConnected: () => void): () => void {
  if (!hasTauriInternals()) return () => {};
  let stopped = false;
  let unlisten: (() => void) | undefined;
  void import("@tauri-apps/api/event")
    .then(({ listen }) =>
      listen("misty:browser-sync-changed", () => {
        void nativeFeedConnected(accountId).then((connected) => {
          if (connected && !stopped) onConnected();
        });
      }),
    )
    .then((stop) => {
      if (stopped) stop();
      else unlisten = stop;
    })
    .catch(() => {});
  return () => {
    stopped = true;
    unlisten?.();
  };
}

/** Delivers the sync socket's invalidations until it disconnects. A reset on
 * entry covers anything between the previous source closing and this one. */
export async function followNativeFeed(
  accountId: string,
  signal: AbortSignal,
  deliver: Subscriber,
) {
  const { listen } = await import("@tauri-apps/api/event");
  if (signal.aborted) return;
  await new Promise<void>((resolve) => {
    const unlisteners: Array<() => void> = [];
    let done = false;
    let checking = false;
    let liveness: ReturnType<typeof setInterval> | undefined;
    const finish = () => {
      if (done) return;
      done = true;
      clearInterval(liveness);
      signal.removeEventListener("abort", finish);
      for (const stop of unlisteners) stop();
      resolve();
    };
    const checkFeed = async () => {
      if (done || checking) return;
      checking = true;
      try {
        if (!(await nativeFeedConnected(accountId)) && !done) {
          // A missed native status event cannot strand readers on a dead feed.
          deliver({ topic: "reset" });
          finish();
        }
      } finally {
        checking = false;
      }
    };
    const retainListener = async (pending: Promise<() => void>) => {
      const stop = await pending;
      if (done) stop();
      else unlisteners.push(stop);
    };
    signal.addEventListener("abort", finish, { once: true });
    void Promise.all([
      retainListener(
        listen<{ accountId?: string; topic?: string; id?: string | null }>(
          "misty:account-event",
          ({ payload }) => {
            if (done || payload?.accountId !== accountId) return;
            const event = { topic: payload.topic ?? "", ...(payload.id ? { id: payload.id } : {}) };
            if (validEvent(event)) deliver(event);
          },
        ),
      ),
      retainListener(
        listen("misty:browser-sync-changed", () => {
          void checkFeed();
        }),
      ),
    ])
      .then(() => {
        if (!done) {
          // Recheck after listener registration closes the handover race.
          // This probes local transport metadata only, never server snapshots.
          liveness = setInterval(() => void checkFeed(), 15_000);
          void checkFeed();
          deliver({ topic: "reset" });
        }
      })
      .catch(finish);
  });
}
