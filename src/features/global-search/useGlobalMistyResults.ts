import { useWorkspaceStore, workspaceSurfaceFromRoute } from "@/features/workspace";
import { kuraOpen } from "@/native/kura";
import { useNavigate } from "react-router-dom";
import type { GlobalAiContextRef, GlobalSearchResult } from "./types";

export function useGlobalMistyResults(input: {
  activePaneId: string;
  context: GlobalAiContextRef[];
  setContext: (context: GlobalAiContextRef[]) => void;
  closePanel: () => void;
  onNavigate?: (href: string) => void;
}) {
  const navigate = useNavigate();
  const openResult = async (result: GlobalSearchResult) => {
    if (input.onNavigate) {
      input.closePanel();
      input.onNavigate(result.href);
      return;
    }
    const fileResult = result.fileResult;
    if (fileResult || result.href === "/files") {
      // Files open in Kura, Misty's separate file manager.
      const path =
        fileResult?.entry.path ?? (result.id.startsWith("file:") ? result.id.slice(5) : "");
      input.closePanel();
      if (!path) return;
      const folder = (fileResult?.entry.kind ?? result.kind) === "folder";
      const parent = path.replace(/[\\/][^\\/]+[\\/]?$/, "") || "/";
      await kuraOpen(
        folder ? { action: "open", path } : { action: "open", path: parent, select: path },
      ).catch(() => undefined);
      return;
    }
    input.closePanel();
    const surface = workspaceSurfaceFromRoute(result.href);
    if (surface) {
      const tab = useWorkspaceStore.getState().openSurface(surface);
      useWorkspaceStore.getState().focusView(tab.id);
    }
    navigate(result.href);
  };
  const addResultContext = (result: GlobalSearchResult) => {
    const localPath =
      result.fileResult?.entry.location.kind === "local" ? result.fileResult.entry.path : undefined;
    input.setContext([
      ...input.context,
      {
        id: result.id,
        kind: result.kind,
        title: result.title,
        href: result.href,
        source: result.source,
        spaceId: result.spaceId,
        spaceName: result.spaceName,
        ...(localPath ? { localPath, attached: false } : { attached: true }),
      },
    ]);
  };
  return { openResult, addResultContext };
}
