import type { JSONContent } from "@tiptap/core";
import { yXmlFragmentToProsemirrorJSON } from "@tiptap/y-tiptap";
import { notePendingVersion } from "../markdown/materializeNoteMarkdown";
import { markdownToNoteJson } from "../markdown/noteMarkdown";
import {
  acquireNoteCollaborationSession,
  releaseNoteCollaborationSession,
} from "../noteCollaboration";

/** A doc as it stands in its live room: its title and the editor's JSON. */
export interface NoteDocument {
  title: string;
  json: JSONContent;
}

const syncTimeoutMs = 15_000;

/**
 * Reads a doc's current content from its live room (sharing an open editor's connection when
 * there is one). Server markdown no editor has applied yet is read as that markdown.
 */
export async function readNoteDocument(spaceId: string, noteId: string): Promise<NoteDocument> {
  const session = await acquireNoteCollaborationSession(spaceId, noteId);
  try {
    if (!session.provider.synced) {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          session.provider.off("sync", onSync);
          reject(new Error("The doc couldn't be opened in time. Try again."));
        }, syncTimeoutMs);
        const onSync = (synced: boolean) => {
          if (!synced) return;
          clearTimeout(timer);
          session.provider.off("sync", onSync);
          resolve();
        };
        session.provider.on("sync", onSync);
      });
    }
    const title = session.title.toString().trim();
    const pending = notePendingVersion(session.doc);
    const json =
      session.fragment.length && !pending
        ? (yXmlFragmentToProsemirrorJSON(session.fragment) as JSONContent)
        : markdownToNoteJson(
            pending
              ? String(session.metadata.get("pending_markdown") ?? "")
              : session.markdown.toString(),
          );
    return { title, json };
  } finally {
    releaseNoteCollaborationSession(spaceId, noteId);
  }
}
