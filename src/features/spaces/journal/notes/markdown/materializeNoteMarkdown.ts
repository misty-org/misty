import type { JSONContent } from "@tiptap/core";
import { prosemirrorJSONToYXmlFragment, yXmlFragmentToProsemirrorJSON } from "@tiptap/y-tiptap";
import type * as Y from "yjs";
import { replaceYText } from "../components/noteEditorContent";
import { markdownToNoteJson, noteJsonLinks, noteJsonToMarkdown, noteSchema } from "./noteMarkdown";

/** The origin a tool session's note write carries, so open editors can tell it from a person's. */
export const noteToolOrigin = "misty-tool-session";

/**
 * Keeps the block ids the doc already has where the new content has the same kind of block in
 * the same place, so rewriting a doc with what it already says changes nothing, and links and
 * comments anchored to a block keep finding it.
 */
function carryBlockIds(next: JSONContent, previous: JSONContent | undefined): JSONContent {
  if (!previous || previous.type !== next.type) return next;
  const id = previous.attrs?.id;
  const attrs = id && next.attrs && "id" in next.attrs ? { ...next.attrs, id } : next.attrs;
  return {
    ...next,
    ...(attrs ? { attrs } : {}),
    ...(next.content
      ? {
          content: next.content.map((child, index) =>
            carryBlockIds(child, previous.content?.[index]),
          ),
        }
      : {}),
  };
}

/**
 * Writes markdown into a doc's editor content, the way an open editor does when it claims the
 * server's pending markdown: the Tiptap fragment ("tiptap") gets the converted document, the
 * markdown copy ("misty:markdown") and the doc's metadata ("misty:document") follow it, and the
 * pending version is marked applied, so no editor opening the doc later applies it a second time.
 *
 * The fragment is updated by difference, so writing the content it already holds changes
 * nothing. Runs in one transaction. Returns the markdown as the editor will hold it.
 */
export function materializeNoteMarkdown(
  doc: Y.Doc,
  markdown: string,
  options?: { title?: string },
): string {
  const fragment = doc.getXmlFragment("tiptap");
  const previous = fragment.length
    ? (yXmlFragmentToProsemirrorJSON(fragment) as JSONContent)
    : undefined;
  const json = carryBlockIds(markdownToNoteJson(markdown), previous);
  const normalized = noteJsonToMarkdown(json);
  const schema = noteSchema();
  doc.transact(() => {
    const metadata = doc.getMap<unknown>("misty:document");
    prosemirrorJSONToYXmlFragment(schema, json, fragment);
    replaceYText(doc.getText("misty:markdown"), normalized);
    if (options?.title !== undefined) replaceYText(doc.getText("misty:title"), options.title);
    metadata.set("schema", "tiptap-v1");
    metadata.set("outgoing_note_ids", noteJsonLinks(json));
    // The same release an editor makes once it has applied a pending version: the room's
    // lease on it is spent, and every copy sees the version as done.
    const pending = Number(metadata.get("pending_version") ?? 0);
    const applied = Number(metadata.get("applied_version") ?? 0);
    if (pending > applied) metadata.set("applied_version", pending);
  }, noteToolOrigin);
  return normalized;
}

/** Whether a doc holds server markdown no copy has applied yet. */
export function notePendingVersion(doc: Y.Doc): number {
  const metadata = doc.getMap<unknown>("misty:document");
  const pending = Number(metadata.get("pending_version") ?? 0);
  const applied = Number(metadata.get("applied_version") ?? 0);
  return pending > applied ? pending : 0;
}
