import type { WorkspaceView } from "@/features/app-windows";

interface PageOpener {
  addSurface(request: {
    surfaceId: "agents";
    groupKey: "tool:agents";
    title: string;
    route: string;
    paneId?: string;
  }): WorkspaceView;
  focusView(id: string): boolean;
}

/**
 * Opens one more page of the window's own in a workspace store and focuses it: a test's stand-in
 * for any page a tab can hold. `url` only names it, so each page gets its own route.
 */
export function openPage(
  store: PageOpener,
  request: { url?: string; paneId?: string } = {},
): WorkspaceView {
  const name = request.url ? new URL(request.url).hostname : "new";
  const view = store.addSurface({
    surfaceId: "agents",
    groupKey: "tool:agents",
    title: name,
    route: `/agents?conversation=${name}`,
    paneId: request.paneId,
  });
  store.focusView(view.id);
  return view;
}
