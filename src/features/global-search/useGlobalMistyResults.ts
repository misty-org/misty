import { useWorkspaceStore, workspaceSurfaceFromRoute } from "@/features/workspace";
import type { SearchResult } from "@/native/contracts";
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
    const isFileLocation =
      Boolean(result.fileResult) ||
      result.kind === "file" ||
      result.kind === "folder" ||
      result.id.startsWith("file:") ||
      result.href === "/files";

    if (!isFileLocation || (result.href !== "/files" && !result.fileResult)) {
      input.closePanel();
      const surface = workspaceSurfaceFromRoute(result.href);
      if (surface) {
        const tab = useWorkspaceStore.getState().openSurface(surface);
        useWorkspaceStore.getState().focusTab(tab.id);
      }
      navigate(result.href);
      return;
    }

    const fileResult: SearchResult = result.fileResult ?? {
      entry: {
        id: result.id.startsWith("file:") ? result.id.slice(5) : result.id,
        name: result.title,
        path: result.id.startsWith("file:") ? result.id.slice(5) : result.id,
        extension: "",
        mimeType: null,
        remoteModified: result.updatedAt ?? null,
        kind: result.kind === "folder" ? "folder" : "file",
        sizeBytes: null,
        modifiedMs: null,
        createdMs: null,
        readonly: false,
        hidden: false,
        location: { kind: "local", providerType: null, remoteName: null, remotePath: null },
      },
      score: result.score ?? 1,
      sourceKind: "local",
      indexedAtMs: Date.now(),
    };

    input.closePanel();
    const filesRoute = `/apps/files?path=${encodeURIComponent(fileResult.entry.path)}${fileResult.entry.kind === "file" ? `&select=${encodeURIComponent(fileResult.entry.name)}` : ""}`;
    const surface = workspaceSurfaceFromRoute(filesRoute);
    if (surface) {
      const tab = useWorkspaceStore.getState().openSurface({
        ...surface,
      });
      useWorkspaceStore.getState().focusTab(tab.id);
    }
    navigate(filesRoute);

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
