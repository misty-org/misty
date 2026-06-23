import { invoke } from "@tauri-apps/api/core";
import { withNativeDocumentService } from "./nativeDocumentService";
import { useAppsStore } from "./useAppsStore";

/** Keep scan authority alive until it finishes, even after Start returns to the UI. */
export async function invokeFilesSearch<T>(command: string, args: Record<string, unknown> = {}): Promise<T> {
  const spaceId = useAppsStore.getState().spaceId;
  if (command !== "search_start_scan") {
    return withNativeDocumentService("files", spaceId, instance => invoke<T>(command, {...args, instance}), undefined, "search");
  }
  let resolveStart!: (value:T) => void;
  let rejectStart!: (error:unknown) => void;
  const started = new Promise<T>((resolve,reject) => {resolveStart=resolve;rejectStart=reject;});
  void withNativeDocumentService("files", spaceId, async instance => {
    const initial = await invoke<T>(command, {...args, instance});
    resolveStart(initial);
    while (true) {
      await new Promise(resolve => setTimeout(resolve, 500));
      const status = await invoke<{scanInProgress:boolean}>("search_get_status", {instance});
      if (!status.scanInProgress) return;
    }
  }, undefined, "search").catch(rejectStart);
  return started;
}
