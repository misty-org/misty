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

/**
 * Opens Misty with the Note made from the capture attached, ready for a question about it. The
 * Note is read from the Space; it has no page of its own to open.
 */
export async function askAboutCapturedNote() {
  const { noteId, noteSpaceId, title } = useCaptureStore.getState();
  if (!noteId || !noteSpaceId) return;
  await noteAsk.get()({
    spaceId: noteSpaceId,
    context: [{ id: noteId, kind: "note", title, href: "", source: "server", spaceId: noteSpaceId }],
  });
}
