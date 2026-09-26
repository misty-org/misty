import { getCurrentWindow } from "@tauri-apps/api/window";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { useUserStore } from "@/features/auth/core";
import { isApiSessionTransitioning, readApiSessionGeneration } from "@/api/client/session";
import type { AiInvocationDeviceContext, AiSelectionSnapshot } from "@/features/ai-surface";
import { ensureServerAgentDevice, agentsDeviceSnapshot } from "@/features/agents";
import { useMistyStore } from "@/features/misty/useMistyStore";
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
    url: string;
    title: string;
    content: string;
    selection: boolean;
    editable: boolean;
    link: string;
    image: string;
    documentRevision: string;
    mail?: { account: string; threadReference: string } | null;
  };
}

export interface BrowserAskRequest {
  conversationId: string;
  context: GlobalAiContextRef[];
  selection: AiSelectionSnapshot;
  deviceContexts: AiInvocationDeviceContext[];
  notice?: string;
}

export function browserAskSource(snapshot: BrowserAskSnapshot): GlobalAiContextRef {
  const url = new URL(snapshot.page.url);
  if (
    !/^https?:$/.test(url.protocol) ||
    url.username ||
    url.password ||
    !snapshot.scopeId ||
    snapshot.page.content.length > 32000
  ) {
    throw new Error("This browser context is unavailable. Open Ask from the page again.");
  }
  return {
    id: snapshot.id,
    kind: "browser-tab",
    title: snapshot.page.title || url.hostname,
    href: url.href,
    source: "current",
    attached: true,
    privacy: "device",
    revision: snapshot.revision,
    opaqueScopeId: snapshot.scopeId,
    metadata: {
      source: "browser-context-menu",
      provider: snapshot.providerId || "website",
      origin: url.origin,
    },
  };
}

// Called only by the native host menu selection, never by remote page events.
// Opening Ask prepares context locally; submitAnswer is the only model boundary.
export async function openBrowserAsk(snapshot: BrowserAskSnapshot): Promise<void> {
  const state = useMistyStore.getState();
  if (state.working)
    throw new Error("Wait for the current Ask request or cancel it before starting another.");
  const accountId = useUserStore.getState().me?.id;
  if (!accountId || state.accountId !== accountId || isApiSessionTransitioning())
    throw new Error("Sign in to the current Misty account before using Ask.");
  const generation = readApiSessionGeneration();
  const stillCurrent = () =>
    !isApiSessionTransitioning() &&
    readApiSessionGeneration() === generation &&
    useUserStore.getState().me?.id === accountId &&
    useMistyStore.getState().accountId === accountId;
  const source = browserAskSource(snapshot);
  source.metadata = { ...source.metadata, app_id: "browser" };
  const deviceContexts: AiInvocationDeviceContext[] = [];
  let notice: string | undefined;
  if (hasTauriInternals()) {
    const local = await agentsDeviceSnapshot();
    if (!stillCurrent()) return;
    if (!local.device || local.device.status === "revoked")
      notice = "Connect this Misty device to let an agent interact with the page.";
    else {
      const device = await ensureServerAgentDevice(local.device);
      if (!stillCurrent()) return;
      deviceContexts.push({
        deviceId: device.id,
        kind: "browser_tab",
        opaqueRef: snapshot.scopeId,
        displayName: source.title,
        // A native menu supplies the source. Execution still requires the user's
        // submitted task and the existing run-bound native action checks.
        capabilities: [
          "browser.inspect",
          "browser.navigate",
          "browser.click",
          "browser.type",
          "browser.interact",
        ],
        metadata: {
          origin: new URL(source.href!).origin,
          label: source.title,
          source: "browser-context-menu",
          app_id: "browser",
          window_label: getCurrentWindow().label,
        },
      });
    }
  }
  if (!stillCurrent()) return;
  const conversationId = "";
  const request: BrowserAskRequest = {
    conversationId,
    context: [source],
    deviceContexts,
    notice,
    selection: {
      kind: "text",
      content: snapshot.page.content,
      object: {
        kind: "browser-tab",
        id: snapshot.id,
        revision: snapshot.revision,
      },
      anchors: {
        sourceURL: snapshot.page.url,
        documentRevision: snapshot.page.documentRevision,
      },
      contentHash: snapshot.contentHash,
    },
  };
  const prompts = {
    ask: "",
    "create-task":
      "Create a task from this page. Ask which website to use if no destination is specified.",
    "prepare-reply": "Prepare a reply to this email for my review.",
    "task-and-reply":
      "Create a task from this page and prepare a reply for my review. Ask which website to use if no destination is specified.",
  };
  const { openMisty } = await import("@/features/misty/handoff");
  if (!stillCurrent()) return;
  await openMisty({
    accountId,
    context: request.context,
    selection: request.selection,
    deviceContexts: request.deviceContexts,
    notice,
    prompt: prompts[snapshot.intent ?? "ask"] ?? "",
  });
}
