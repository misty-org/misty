import { create } from "zustand";
import { useWorkspaceStore, workspaceSurfaceFromRoute } from "@/features/app-windows";
import { fileEvents, onFilesEvent } from "@/features/files";

/** The Files page's address, the same in every Space. */
export const FILES_ROUTE = "/agents?view=files";

/** An item an agent asked to show (`files.reveal`), until the Files page has shown it. */
export const useFilesReveal = create<{ path: string | null; at: number }>(() => ({ path: null, at: 0 }));

/** Opens the Files page in the focused pane, or brings its tab forward. */
export function openFilesPage() {
  const surface = workspaceSurfaceFromRoute(FILES_ROUTE);
  if (!surface) return;
  const workspace = useWorkspaceStore.getState();
  const view = workspace.openDestination(surface);
  if (view.route !== FILES_ROUTE) workspace.updateViewRoute(view.id, FILES_ROUTE, true);
}

let stop: (() => void) | null = null;

/**
 * Hears `files://reveal` once for the window, from startup: the Files page opens and goes to the item's
 * folder with the item picked, so the person sees what the agent means.
 */
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
