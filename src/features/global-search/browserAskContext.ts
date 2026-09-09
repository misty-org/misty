import type { AiInvocationDeviceContext, AiSelectionSnapshot } from "@/features/ai-surface";
import { ensureServerAgentDevice } from "@/features/agents/store/useAgentDeviceStore";
import { agentsDeviceSnapshot } from "@/features/agents/store/useAgentsStore";
import { useGlobalSearchStore } from "./useGlobalSearchStore";
import type { GlobalAiContextRef } from "./types";

export interface BrowserAskSnapshot {
  id: string;
  scopeId: string;
  spaceId?: string | null;
  profileId?: string | null;
  providerId?: string | null;
  revision: string;
  contentHash: string;
  intent?: "ask" | "create-task" | "prepare-reply" | "task-and-reply";
  page: {
    url: string; title: string; content: string; selection: boolean;
    editable: boolean; link: string; image: string; documentRevision: string;
    mail?: { account: string; threadReference: string } | null;
  };
}

export interface BrowserAskRequest {
  conversationId: string;
  context: GlobalAiContextRef[];
  selection: AiSelectionSnapshot;
  deviceContexts: AiInvocationDeviceContext[];
  targetId?: string;
  capabilities?: string[];
  notice?: string;
}

export function browserAskSource(snapshot: BrowserAskSnapshot): GlobalAiContextRef {
  const url = new URL(snapshot.page.url);
  if (!/^https?:$/.test(url.protocol) || url.username || url.password || !snapshot.scopeId || snapshot.page.content.length > 32000) {
    throw new Error("This browser context is unavailable. Open Ask from the page again.");
  }
  return {
    id: snapshot.id, kind: "browser-tab", title: snapshot.page.title || url.hostname,
    href: url.href, source: "current", attached: true, privacy: "device",
    spaceId: snapshot.spaceId || undefined, revision: snapshot.revision,
    opaqueScopeId: snapshot.scopeId,
    metadata: { source: "browser-context-menu", provider: snapshot.providerId || "website", origin: url.origin },
  };
}

// Called only by the native host menu selection, never by remote page events.
// Opening Ask prepares context locally; submitAnswer is the only model boundary.
export async function openBrowserAsk(snapshot: BrowserAskSnapshot): Promise<void> {
  const state = useGlobalSearchStore.getState();
  if (state.working) throw new Error("Wait for the current Ask request or cancel it before starting another.");
  const accountId = state.accountId;
  const source = browserAskSource(snapshot);
  const deviceContexts: AiInvocationDeviceContext[] = [];
  let target: import("./browserAskTargets").BrowserAskTarget | undefined;
  let notice: string | undefined = !snapshot.spaceId
    ? "This page has no originating Space. Open it in a Space to enable browser actions."
    : !snapshot.providerId ? "Automation has not been verified for this website." : undefined;
  if (snapshot.spaceId) {
    const local = await agentsDeviceSnapshot();
    if (!local.device || local.device.status === "revoked") throw new Error("Connect this Misty device before using browser actions.");
    const device = await ensureServerAgentDevice(local.device);
    if (snapshot.providerId) {
      try {
        const { bindBrowserAskTarget } = await import("./browserAskTargets");
        target = await bindBrowserAskTarget(snapshot, accountId, device.id, () => {
          if (useGlobalSearchStore.getState().accountId !== accountId) throw new Error("The Misty account changed.");
        });
        if (!target) notice = "Automation has not been verified for this website.";
      } catch (error) {
        notice = error instanceof Error ? error.message : "Browser actions are unavailable. You can still ask about the attached content.";
      }
    }
    if (target) {
      if (!source.title.includes(target.account)) source.title = `${source.title} · ${target.account}`;
      source.metadata = { ...source.metadata, targetId: target.target.id, account: target.account, capabilities: target.capabilities.join(", "), ...(target.threadReference ? { threadReference: target.threadReference } : {}) };
    }
    deviceContexts.push({
      deviceId: device.id, kind: "browser_tab", opaqueRef: snapshot.scopeId,
      displayName: source.title,
      // The existing semantic executor uses these run-bound primitives. A
      // provider/account binding grants no standing approval for a commit.
      capabilities: target?.capabilities.some((name) => name !== "inbox.read")
        ? ["browser.inspect", "browser.navigate", "browser.click", "browser.type", "browser.interact"]
        : target?.capabilities.includes("inbox.read") ? ["browser.inspect", "browser.navigate"] : ["browser.inspect"],
      metadata: { origin: new URL(source.href!).origin, label: source.title, source: "browser-context-menu" },
    });
  }
  if (useGlobalSearchStore.getState().accountId !== accountId) return;
  const conversationId = await state.newConversation(snapshot.spaceId || undefined);
  if (useGlobalSearchStore.getState().accountId !== accountId) return;
  const request: BrowserAskRequest = {
    conversationId, context: [source], deviceContexts, targetId: target?.target.id, capabilities: target?.capabilities, notice,
    selection: {
      kind: "text", content: snapshot.page.content,
      object: { kind: "browser-tab", id: snapshot.id, spaceId: snapshot.spaceId || undefined, revision: snapshot.revision },
      anchors: { sourceURL: snapshot.page.url, documentRevision: snapshot.page.documentRevision, ...(target?.threadReference ? { threadReference: target.threadReference } : {}) },
      contentHash: snapshot.contentHash,
    },
  };
  const prompts = {
    ask: "",
    "create-task": "Create a task from this email in this Space's Planner.",
    "prepare-reply": "Prepare a reply to this email for my review.",
    "task-and-reply": "Create a task from this email in this Space's Planner and prepare a reply for my review.",
  };
  useGlobalSearchStore.setState({ browserRequest: request, context: request.context, query: prompts[snapshot.intent ?? "ask"] ?? "", mode: "ask", error: notice ?? null });
  useGlobalSearchStore.getState().openPanel();
}
