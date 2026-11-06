import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { NativeRecoveryStorage } from "@/features/workspace/recoveryStorage";
import { adoptWindowTabs } from "./adoptWindowTabs";
import { currentWindowId } from "./profileWindow";
import { useWorkspaceStore } from "./useWorkspaceStore";
import { parseWorkspaceRecord } from "./workspaceRecord";
import { readRecoveryRecord, windowRecoveryKey } from "./workspaceRecoveryWriter";

/**
 * Closing a window never removes tabs from its profile. The native side hands each closed window
 * to one other window of the profile, which moves its tabs here, asleep, saves, and only then
 * clears the closed window's record. A record that can't be read stays where it is.
 */
export function startWindowOrphans(
  storage: NativeRecoveryStorage,
  save: () => Promise<void>,
): () => void {
  let stopped = false;
  let queue: Promise<void> = Promise.resolve();
  /** Taken from the native side but not read yet, so a failed read gets another try. */
  const waiting = new Set<string>();
  /** Adopted, with the record still to clear once this window has saved them. */
  const adopted = new Set<string>();

  const adopt = async () => {
    for (const id of await invoke<string[]>("profile_window_take_orphans")) waiting.add(id);
    for (const id of waiting) {
      if (stopped) return;
      if (id === currentWindowId()) {
        waiting.delete(id);
        continue;
      }
      const key = windowRecoveryKey(id);
      await storage.load(key);
      const raw = readRecoveryRecord(storage, key);
      waiting.delete(id);
      if (!raw) continue;
      const closed = parseWorkspaceRecord(raw);
      useWorkspaceStore.setState((current) => adoptWindowTabs(current, closed));
      adopted.add(key);
    }
    if (stopped || !adopted.size) return;
    await save();
    for (const key of adopted) storage.setItem(key, "");
    adopted.clear();
    await storage.flush();
  };
  const run = () => {
    queue = queue.then(adopt).catch(() => undefined);
  };

  run();
  const stopListening = listen("misty://profile-window-orphans", () => {
    if (!stopped) run();
  }).catch(() => undefined);
  return () => {
    stopped = true;
    void stopListening.then((stop) => stop?.());
  };
}
