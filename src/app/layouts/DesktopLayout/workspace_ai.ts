import type {
  AiContextReference,
  AiSuggestedAction,
  AiSurfaceAdapter,
  AiSurfaceId,
} from "@/features/agents";
import type { WorkspaceSurfaceId, WorkspaceView } from "@/features/app-windows";

const surfaceLabels: Record<WorkspaceSurfaceId, string> = {
  space: "Space",
  agents: "Agents",
  direct: "Direct messages",
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
  if (tab.surfaceId === "direct") return "global";
  if (tab.surfaceId !== "space") return tab.surfaceId;
  const parts = tab.route.split("?")[0].split("/").filter(Boolean);
  const section = parts[2] ?? "";
  if (section === "social" || section === "chat") return "space.chat";
  if (section === "files" || section === "media" || section === "library") return "files";
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
  return {
    kind: "route",
    id: tab.id,
    title: tab.title || surfaceLabels[tab.surfaceId] || "Tool",
    privacy: "private",
  };
}

const action = (id: string, label: string, prompt: string): AiSuggestedAction => ({
  id,
  label,
  prompt,
  trigger: "object",
});

const workspaceAiActions: Partial<Record<AiSurfaceId, AiSuggestedAction[]>> = {
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
  files: [action("files.synthesize", "Synthesize", "Synthesize the visible files with citations.")],
};

function safeRouteDecode(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
