import { workspaceSurfaceFromRoute } from "@/features/app-windows";
import { useWorkspaceStore } from "@/features/app-windows";
import { createPort } from "@/shared/lib/seams";
import { useCaptureStore } from "./useCaptureStore";

/** Asking Misty about a note is agents' job; agents sit above voice and fill this in at startup. */
export const noteAsk = createPort<
  (input: {
    spaceId?: string;
    context: Array<{
      id: string;
      kind: string;
      title: string;
      href: string;
      source: "server";
      spaceId?: string;
    }>;
  }) => Promise<void>
>("asking Misty about a note");

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
  await noteAsk.get()({
    spaceId: noteSpaceId,
    context: [
      { id: noteId, kind: "note", title, href: route, source: "server", spaceId: noteSpaceId },
    ],
  });
}
