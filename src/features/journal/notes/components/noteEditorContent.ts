import type { Editor, JSONContent } from "@tiptap/react";
import type { Text as YText } from "yjs";
import type { NoteBlockEditorProps, NoteEditorSession } from "./noteEditorTypes";

export function initialContent(
  props: Pick<NoteBlockEditorProps, "body" | "bodyFormat" | "bodyMarkdown">,
): string | JSONContent {
  if (props.bodyFormat === "tiptap-json") {
    try {
      return JSON.parse(props.body) as JSONContent;
    } catch {
      return {
        type: "doc",
        content: [
          {
            type: "paragraph",
          },
        ],
      };
    }
  }
  return props.bodyMarkdown ?? props.body ?? "";
}
export function replaceYText(text: YText, value: string) {
  if (text.toString() === value) return;
  text.doc?.transact(() => {
    text.delete(0, text.length);
    text.insert(0, value);
  }, "misty-projection");
}
export function applyPendingMarkdown(editor: Editor, session?: NoteEditorSession) {
  if (!session) return;
  const awareness = session.provider.awareness;
  const connectedClients = [...awareness.getStates().keys()].sort((left, right) => left - right);
  if (connectedClients[0] !== awareness.clientID) return;
  const pending = Number(session.metadata.get("pending_version") ?? 0);
  const applied = Number(session.metadata.get("applied_version") ?? 0);
  const markdown = String(session.metadata.get("pending_markdown") ?? "");
  if (!pending || pending <= applied) return;
  editor.commands.setContent(markdown, {
    contentType: "markdown",
  });
  session.metadata.set("applied_version", pending);
}
export function collectNoteLinks(editor: Editor): string[] {
  const ids = new Set<string>();
  editor.state.doc.descendants((node) => {
    for (const mark of node.marks) {
      const id = noteIdFromHref(String(mark.attrs.href ?? ""));
      if (id) ids.add(id);
    }
  });
  return [...ids].sort();
}
export function noteIdFromHref(href: string): string | null {
  const match = href.match(/^misty-note:\/\/(note_[A-Za-z0-9-]+)$/);
  return match?.[1] ?? null;
}
export function collaborationUser(accountId?: string) {
  const seed = accountId ?? "misty-user";
  let hash = 0;
  for (const character of seed) hash = (hash * 31 + character.charCodeAt(0)) | 0;
  const colors = ["#8b7cf6", "#48a889", "#d09a55", "#cf6f79", "#5b91d5"];
  return {
    name: "Misty collaborator",
    color: colors[Math.abs(hash) % colors.length],
  };
}
