import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { useAuth } from "@/features/auth";
import { useConnectionsStore } from "@/features/integrations";
import { dockLeaves, useWorkspaceStore } from "@/features/workspace";
import { useAiSurfaceAdapter, useAiSurfaceActions } from "@/features/ai-surface/AiPaneHost";
import { openProviderAuthorizationLink } from "@/shared/platform/openExternalLink";
import { useMobileSurfaceChrome, useSurfacePresentation } from "@/shared/mobile";
import { inboxStoreForWorkspace } from "./store/inboxWorkspaceStores";
import { hostInboxUiRuntime } from "./hostInboxUiRuntime";
import { InboxWorkspaceView } from "./InboxWorkspaceView";
export function InboxWorkspace(props: { workspaceId?: string; initialRoute?: string } = {}) {
  const identity = useAuth();
  const presentation = useSurfacePresentation();
  const inboxStore = useMemo(() => inboxStoreForWorkspace(props.workspaceId), [props.workspaceId]);
  const workspaceFocused = useWorkspaceStore((state) => {
    if (!props.workspaceId) return true;
    const focusedPane = dockLeaves(state.layout.root).find(
      (pane) => pane.id === state.layout.focusedPaneId,
    );
    return focusedPane?.activeTabId === props.workspaceId;
  });
  const connections = useConnectionsStore(
    useShallow((state) => ({
      accountId: state.accountId,
      authorizingProvider: state.authorizingProvider,
      removingConnectionId: state.removingConnectionId,
      error: state.error,
      setAccount: state.setAccount,
      beginAuthorization: state.beginAuthorization,
      remove: state.remove,
      clearError: state.clearError,
    })),
  );
  return (
    <InboxWorkspaceView
      {...props}
      runtime={{
        identity,
        presentation,
        store: inboxStore,
        focused: workspaceFocused,
        connections,
        ui: hostInboxUiRuntime,
        openAuthorization: openProviderAuthorizationLink,
        useAiSurfaceAdapter,
        useAiSurfaceActions,
        useMobileSurfaceChrome,
      }}
    />
  );
}
