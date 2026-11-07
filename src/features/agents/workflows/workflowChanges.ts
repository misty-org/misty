import { emit, listen } from "@tauri-apps/api/event";
import { hasTauriInternals } from "@/shared/platform/tauri";

/**
 * Tells every window that a workflow or schedule kept on this computer changed: the agent saves from
 * the host window, and the Workflows page may be open in another.
 */
const eventName = "misty://workflows-changed";

export function announceWorkflowChange(): void {
  if (hasTauriInternals()) void emit(eventName).catch(() => undefined);
}

export function observeWorkflowChanges(
  _accountId: string,
  listener: () => Promise<unknown>,
): () => void {
  if (!hasTauriInternals()) return () => undefined;
  let stopped = false;
  let stop: (() => void) | undefined;
  void listen(eventName, () => void listener()).then((unlisten) => {
    if (stopped) unlisten();
    else stop = unlisten;
  });
  return () => {
    stopped = true;
    stop?.();
  };
}
