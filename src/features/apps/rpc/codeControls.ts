import { isMistyCodeControlsMethod, mistyCodeControlsContracts, type MistyCodeControlsParams } from "@misty/sdk";
import { AppRpcError, type AppRpcScope } from "./session";
import { useSettingsStore } from "@/features/settings";
import { useAiSettings } from "@/features/coding-workspace/ai/useAiSettings";
import { readApiKey } from "@/features/coding-workspace/ai/keychain";
import { streamRewrite } from "@/features/coding-workspace/ai/providers";
import { useWorkspaceStore, dockLeaves } from "@/features/workspace";
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
          const panes = dockLeaves(state.layout.root);
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
          const input = params as MistyCodeControlsParams<"code.rewrite">;
          if (requests.size || requests.has(input.requestId)) throw new AppRpcError("busy", "A rewrite is already running.");
          const controller = new AbortController();
          requests.set(input.requestId, controller);
          try {
            const settings = useAiSettings.getState();
            const apiKey = await readApiKey(settings.providerId);
            scope.assert("ai.use");
            if (!apiKey) throw new Error("Open AI settings to add a model API key.");
            let text = "";
            await streamRewrite({ ...input, settings, apiKey, signal: controller.signal, onDelta(delta) {
              scope.assert("ai.use");
              text += delta;
              if (text.length > 512 * 1024) { controller.abort(); throw new Error("The rewrite is too large."); }
            } });
            if (controller.signal.aborted) throw new Error("Rewrite cancelled.");
            result = text;
          } finally { requests.delete(input.requestId); }
          break;
        }
      }
      scope.assert();
      return contract.result.parse(result);
    },
  };
}
