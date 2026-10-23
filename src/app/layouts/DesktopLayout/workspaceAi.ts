import type {
  AiContextReference,
  AiSuggestedAction,
  AiSurfaceAdapter,
  AiSurfaceId,
} from "@/features/ai-surface/AiPaneHost";
import type { WorkspaceSurfaceId, WorkspaceView } from "@/features/workspace";

const surfaceLabels: Record<WorkspaceSurfaceId, string> = {
  extensions: "Extensions",
  space: "Space",
  browser: "Browser",
  agents: "Agents",
  scheduled: "Scheduled",
};

export function workspaceAiAdapter(tab: WorkspaceView | undefined): AiSurfaceAdapter | null {
  if (!tab) return null;
  const surfaceId = aiSurfaceForView(tab);
  const context = aiContextForView(tab);
  return {
    surfaceId,
    label: tab.title || surfaceLabels[tab.surfaceId] || "Tool",
    getContext: () => [context],
    getSuggestedActions: () => workspaceAiActions[surfaceId] ?? [],
    openCitation: (citation) =>
      window.dispatchEvent(new CustomEvent("misty:open-ai-citation", { detail: citation })),
  };
}

function aiSurfaceForView(tab: WorkspaceView): AiSurfaceId {
  if (tab.surfaceId !== "space") return tab.surfaceId;
  const parts = tab.route.split("?")[0].split("/").filter(Boolean);
  const section = parts[2] ?? "";
  if (section === "notes") return "notes";
  if (section === "drawings") return "drawings";
  if (section === "social" || section === "chat") return "space.chat";
  if (section === "library") return "library";
  if (section === "activity") return "activity";
  return "settings";
}

function aiContextForView(tab: WorkspaceView): AiContextReference {
  if (tab.surfaceId === "space") {
    const parts = tab.route.split("?")[0].split("/").filter(Boolean);
    const spaceId = safeRouteDecode(parts[1] ?? "");
    return {
      kind: "space",
      id: `${spaceId}:${parts[2] ?? "overview"}:${parts[3] ?? "default"}`,
      title: tab.title,
      privacy: "shared",
      spaceId,
    };
  }
  const privacy = tab.surfaceId === "browser" ? "device" : "private";
  return {
    kind: privacy === "device" ? "device-scope" : "route",
    id: tab.id,
    title: tab.title || surfaceLabels[tab.surfaceId] || "Tool",
    privacy,
    opaqueScopeId: privacy === "device" ? tab.instanceKey : undefined,
  };
}

const action = (id: string, label: string, prompt: string): AiSuggestedAction => ({
  id,
  label,
  prompt,
  trigger: "object",
});

const workspaceAiActions: Partial<Record<AiSurfaceId, AiSuggestedAction[]>> = {
  activity: [
    action("activity.catch-up", "Catch me up", "Summarize unread activity by outcome and Space."),
  ],
  "space.chat": [
    action(
      "chat.recap",
      "Recap",
      "Recap the visible conversation, including decisions and open questions.",
    ),
    action(
      "chat.actions",
      "Find action items",
      "Identify action items and owners. Do not create tasks yet.",
    ),
  ],
  browser: [
    action(
      "browser.summary",
      "Summarize page",
      "Summarize the attached browser page and cite its key sections.",
    ),
    action(
      "browser.explain",
      "Explain page",
      "Explain the attached browser page in plain language.",
    ),
  ],
  drawings: [
    action(
      "drawings.summarize",
      "Summarize board",
      "Summarize the selected or visible drawing objects.",
    ),
  ],
  library: [
    action(
      "library.synthesize",
      "Synthesize",
      "Synthesize the visible Library sources with citations.",
    ),
  ],
};

function safeRouteDecode(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
