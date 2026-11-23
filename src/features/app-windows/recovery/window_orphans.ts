import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { NativeRecoveryStorage } from "./recovery_storage";
import { adoptWindowTabs } from "../tabs/adopt_window_tabs";
import { currentWindowId } from "../profiles/profile_window";
import { useWorkspaceStore } from "../tabs/use_workspace_store";
import { parseWorkspaceRecord } from "../tabs/workspace_record";
import { readRecoveryRecord, windowRecoveryKey } from "./workspace_recovery_writer";

export function startWindowOrphans(
  storage: NativeRecoveryStorage,
  save: () => Promise<void>,
): () => void {
  let stopped = false;
  let queue: Promise<void> = Promise.resolve();
  const waiting = new Set<string>();
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
