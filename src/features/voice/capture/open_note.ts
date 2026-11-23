import { createPort } from "@/shared/lib/seams";
import { useCaptureStore } from "./use_capture_store";

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

export async function askAboutCapturedNote() {
  const { noteId, noteSpaceId, title } = useCaptureStore.getState();
  if (!noteId || !noteSpaceId) return;
  await noteAsk.get()({
    spaceId: noteSpaceId,
    context: [
      { id: noteId, kind: "note", title, href: "", source: "server", spaceId: noteSpaceId },
    ],
  });
}
