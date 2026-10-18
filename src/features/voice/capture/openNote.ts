import { workspaceSurfaceFromRoute } from "@/features/workspace/routeSurface";
import { useWorkspaceStore } from "@/features/workspace/useWorkspaceStore";
import { useCaptureStore } from "./useCaptureStore";

function noteRoute() {
  const { noteId, noteSpaceId } = useCaptureStore.getState();
  if (!noteId || !noteSpaceId) return null;
  return `/spaces/${encodeURIComponent(noteSpaceId)}/notes?note=${encodeURIComponent(noteId)}&view=doc`;
}

/** Opens the Note made from the capture in a workspace tab. */
export function openCapturedNote() {
  const route = noteRoute();
  const surface = route && workspaceSurfaceFromRoute(route);
  if (!route || !surface) return;
  const workspace = useWorkspaceStore.getState();
  const view = workspace.openDestination(surface);
  if (view.route !== route) workspace.updateViewRoute(view.id, route, true);
}

/** Opens Misty with the Note attached, ready for a question about it. */
export async function askAboutCapturedNote() {
  const { noteId, noteSpaceId, title } = useCaptureStore.getState();
  const route = noteRoute();
  if (!noteId || !route) return;
  const { openMisty } = await import("@/features/misty/handoff");
  await openMisty({
    spaceId: noteSpaceId,
    context: [
      { id: noteId, kind: "note", title, href: route, source: "server", spaceId: noteSpaceId },
    ],
  });
}
