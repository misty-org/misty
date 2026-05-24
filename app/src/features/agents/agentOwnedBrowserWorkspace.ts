import type { AiInvocationDeviceContext } from "@/features/ai-surface";
import { browserRuntimeCreated, browserScopeId } from "@/features/browser";
import type { GlobalAiContextRef } from "@/features/global-search/types";
import { browserSearchUrl, dockLeaves, useWorkspaceStore } from "@/features/workspace";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { ensureServerAgentDevice } from "./store/useAgentDeviceStore";
import { agentsDeviceSnapshot } from "./store/useAgentsStore";

export interface AgentOwnedBrowserWorkspace {
  context: GlobalAiContextRef;
  deviceContext: AiInvocationDeviceContext;
}

export function agentBrowserResearchQuery(prompt: string): string {
  const normalized = prompt.trim();
  if (
    !/\b(?:browse|search|research|look\s+up|find\s+(?:online|on\s+the\s+web)|web\s+search)\b/i.test(
      normalized,
    )
  ) {
    return "";
  }
  const withoutLead = normalized.replace(
    /^(?:please\s+)?(?:browse|search|research|look\s+up|find)(?:\s+the\s+web|\s+online|\s+on\s+the\s+web)?(?:\s+for)?\s*/i,
    "",
  );
  const focused = withoutLead.split(
    /\s+(?:(?:and\s+)?then|and)\s+(?:save|post|send|share|summarize)\b/i,
  )[0];
  return (focused || normalized).trim().slice(0, 500);
}

export async function createAgentOwnedBrowserWorkspace(
  prompt: string,
): Promise<AgentOwnedBrowserWorkspace | null> {
  const query = agentBrowserResearchQuery(prompt);
  if (!query || !hasTauriInternals()) return null;

  const workspace = useWorkspaceStore.getState();
  const sourcePane = dockLeaves(workspace.layout.root).find(
    (candidate) => candidate.id === workspace.layout.focusedPaneId,
  );
  const sourceTabId = sourcePane?.activeTabId;
  const url = browserSearchUrl(query);
  const tab = workspace.openBrowserTab({ url, sourceTabId: sourceTabId ?? undefined });
  useWorkspaceStore.getState().updateBrowserTab(tab.id, {
    agentOwned: true,
    title: `Misty research · ${query.slice(0, 48)}`,
  });

  const snapshot = await agentsDeviceSnapshot();
  if (!snapshot.device || snapshot.device.status === "revoked") {
    throw new Error("This Misty device is unavailable for browser work.");
  }
  const serverDevice = await ensureServerAgentDevice(snapshot.device);
  await waitForBrowserRuntime(tab);

  const scopeId = browserScopeId(tab);
  const label = `Misty research: ${query.slice(0, 80)}`;
  const capabilities = ["browser.inspect", "browser.navigate", "browser.click"];
  return {
    context: {
      id: tab.id,
      kind: "browser-tab",
      title: label,
      source: "current",
      attached: true,
      privacy: "device",
      opaqueScopeId: scopeId,
      metadata: { agentOwned: true },
    },
    deviceContext: {
      deviceId: serverDevice.id,
      kind: "browser_tab",
      opaqueRef: scopeId,
      displayName: label,
      capabilities,
      metadata: { kind: "browser_tab", label, origin: url, agentOwned: true },
    },
  };
}

async function waitForBrowserRuntime(tab: Parameters<typeof browserRuntimeCreated>[0]) {
  const deadline = Date.now() + 5_000;
  while (!browserRuntimeCreated(tab)) {
    if (Date.now() >= deadline) {
      throw new Error("Misty's browser workspace did not finish opening.");
    }
    await new Promise((resolve) => window.setTimeout(resolve, 50));
  }
}
