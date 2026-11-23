import { create } from "zustand";
import { useWorkspaceStore, workspaceSurfaceFromRoute } from "@/features/app-windows";
import { fileEvents, onFilesEvent } from "@/features/files";

export const FILES_ROUTE = "/agents?view=files";

export const useFilesReveal = create<{ path: string | null; at: number }>(() => ({
  path: null,
  at: 0,
}));

export function openFilesPage() {
  const surface = workspaceSurfaceFromRoute(FILES_ROUTE);
  if (!surface) return;
  const workspace = useWorkspaceStore.getState();
  const view = workspace.openDestination(surface);
  if (view.route !== FILES_ROUTE) workspace.updateViewRoute(view.id, FILES_ROUTE, true);
}

let stop: (() => void) | null = null;

export function startFilesReveal(): () => void {
  stop?.();
  stop = onFilesEvent<{ path: string }>(fileEvents.reveal, ({ path }) => {
    if (!path) return;
    useFilesReveal.setState({ path, at: Date.now() });
    openFilesPage();
  });
  return () => {
    stop?.();
    stop = null;
  };
}
