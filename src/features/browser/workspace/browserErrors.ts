import { useBrowserRuntimeStore } from "@/features/webviews/browserRuntime";

export function setBrowserError(tabId: string, error: unknown) {
  useBrowserRuntimeStore
    .getState()
    .setError(tabId, error instanceof Error ? error.message : String(error));
}
