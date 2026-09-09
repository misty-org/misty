import { allLayoutPanes } from "@/features/workspace/layoutTabs";
import { isMistyCodeControlsMethod, mistyCodeControlsContracts, type MistyCodeControlsParams } from "@misty/sdk";
import { AppRpcError, type AppRpcScope } from "./session";
import { useSettingsStore } from "@/features/settings";
import { useWorkspaceStore } from "@/features/workspace";
import { officialAppRoute } from "../appRoute";

/** Credentials and cross-app placement stay in the host, bound to the calling Code view. */
export function createCodeControlsRpc(scope: AppRpcScope) {
  const requests = new Map<string, AbortController>();
  scope.signal.addEventListener("abort", () => { requests.forEach(c => c.abort()); requests.clear(); }, { once: true });
  return {
    async request(message: { method: string; params?: unknown }) {
      scope.assert();
      if (scope.identity.appId !== "code" || !isMistyCodeControlsMethod(message.method))
        throw new AppRpcError("capability_denied", "These controls belong to Code.");
      const contract = mistyCodeControlsContracts[message.method];
      const params = contract.params.parse(message.params ?? {});
      let result: unknown;
      switch (message.method) {
        case "code.preferences.update": {
          const { key, value } = params as MistyCodeControlsParams<"code.preferences.update">;
          useSettingsStore.getState().updateSetting("editor", key, value);
          break;
        }
        case "code.models.open":
          window.dispatchEvent(new CustomEvent("misty:open-settings", { detail: { section: "models" } }));
          break;
        case "code.terminal.toggle": {
          scope.assert("navigation.write");
          const state = useWorkspaceStore.getState();
          if (state.activeScopeKey !== (scope.identity.spaceId ? `space:${scope.identity.spaceId}` : "global"))
            throw new AppRpcError("view_closed", "This Code Space is no longer active.");
          const panes = allLayoutPanes(state.layout);
          const pane = panes.find(p => p.tabs.some(t => t.id === scope.identity.instanceId && t.groupKey === "app:code"));
          if (!pane) throw new AppRpcError("view_closed", "This Code view is closed.");
          const existing = panes.flatMap(p => p.tabs).find(t => t.groupKey === "app:terminal" && (t.state as {codeTabId?:string})?.codeTabId === scope.identity.instanceId);
          if (existing) { state.closeTab(existing.id); state.focusTab(scope.identity.instanceId); break; }
          const placement = (params as MistyCodeControlsParams<"code.terminal.toggle">).placement ?? "down";
          const tab = state.openSurface({ surfaceId: "official-app", groupKey: "app:terminal", instanceKey: "terminal", title: "Terminal", route: officialAppRoute("terminal", scope.identity.spaceId), instancePolicy: "multiple", forceNew: true, paneId: pane.id, state: { version: 1, owner: "code", codeTabId: scope.identity.instanceId } });
          if (placement !== "current" && !state.dockTab(tab.id, pane.id, placement)) {
            state.closeTab(tab.id);
            throw new AppRpcError("panel_limit", "Close a panel before opening Terminal here.");
          }
          state.focusTab(tab.id);
          break;
        }
        case "code.rewrite.cancel":
          requests.get((params as {requestId:string}).requestId)?.abort();
          break;
        case "code.rewrite": {
          scope.assert("ai.use");
          throw new AppRpcError("misty_handoff_required", "Code rewrites now run in Misty. Update Code and use its Misty action.");
        }
      }
      scope.assert();
      return contract.result.parse(result);
    },
  };
}
