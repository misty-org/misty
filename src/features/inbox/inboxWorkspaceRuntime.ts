import type { useAiSurfaceAdapter, useAiSurfaceActions } from "@/features/ai-surface/AiPaneHost";
import type { useMobileSurfaceChrome, useSurfacePresentation } from "@/shared/mobile";
import type { InboxStoreHook } from "./store/inboxStore";
import type { InboxUiRuntime } from "./inboxUiRuntime";
export interface InboxConnectionsState {
  accountId: string;
  authorizingProvider: string | null;
  removingConnectionId: string | null;
  error: string | null;
  setAccount(accountId: string): void;
  beginAuthorization(
    provider: string,
    capabilities: readonly string[],
    returnTo: string,
  ): Promise<string>;
  remove(connectionId: string): Promise<void>;
  clearError(): void;
}
export interface InboxWorkspaceRuntime {
  identity: { user: { id: string } | null; transitioning: boolean };
  store: InboxStoreHook;
  focused: boolean;
  presentation: ReturnType<typeof useSurfacePresentation>;
  connections: InboxConnectionsState;
  ui: InboxUiRuntime;
  openAuthorization(url: string): Promise<{ strategy?: string } | undefined>;
  useAiSurfaceAdapter: typeof useAiSurfaceAdapter;
  useAiSurfaceActions: (
    adapter: Parameters<typeof useAiSurfaceActions>[0],
  ) => Pick<ReturnType<typeof useAiSurfaceActions>, "available" | "runAction">;
  useMobileSurfaceChrome: typeof useMobileSurfaceChrome;
}
