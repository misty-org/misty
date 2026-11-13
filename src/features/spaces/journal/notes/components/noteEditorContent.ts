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
/**
 * Brings the shared markdown copy to `value` by changing only the stretch that differs. Rewriting
 * it whole would make two people's rewrites at the same moment both land, doubling the text; a
 * change to the middle merges with someone else's elsewhere.
 */
export function replaceYText(text: YText, value: string) {
  const current = text.toString();
  if (current === value) return;
  let start = 0;
  const shortest = Math.min(current.length, value.length);
  while (start < shortest && current[start] === value[start]) start++;
  let end = 0;
  while (
    end < shortest - start &&
    current[current.length - 1 - end] === value[value.length - 1 - end]
  )
    end++;
  text.doc?.transact(() => {
    const removed = current.length - start - end;
    if (removed > 0) text.delete(start, removed);
    const added = value.slice(start, value.length - end);
    if (added) text.insert(start, added);
  }, "misty-projection");
}
/** How long a refused claim waits before asking again, in case the holder went quiet. */
const pendingClaimRetryMs = 5000;

/**
 * Applies markdown the server put into the doc (an agent's or the API's rewrite) to the shared
 * editor content, in exactly one open copy. Viewers never apply it, and an editor asks only once
 * its copy has synced. The collaboration room grants each pending version to one editor's
 * connection at a time, so two people opening the doc together don't both write the body and
 * double it. Returns a function that stops watching.
 */
export function watchPendingMarkdown(editor: Editor, session?: NoteEditorSession): () => void {
  if (!session || session.role === "viewer") return () => {};
  const { metadata, provider } = session;
  let requested = 0;
  let retry: ReturnType<typeof setTimeout> | undefined;
  const pendingVersion = () => {
    const pending = Number(metadata.get("pending_version") ?? 0);
    const applied = Number(metadata.get("applied_version") ?? 0);
    return pending > applied ? pending : 0;
  };
  const claim = () => {
    if (!provider.synced || editor.isDestroyed) return;
    const pending = pendingVersion();
    if (!pending || pending === requested) return;
    requested = pending;
    provider.sendMessage(JSON.stringify({ type: "claim_pending_markdown", version: pending }));
  };
  const onLease = (message: string) => {
    let lease: { type?: unknown; version?: unknown; granted?: unknown };
    try {
      lease = JSON.parse(message) as typeof lease;
    } catch {
      return;
    }
    if (lease.type !== "pending_markdown_lease" || lease.version !== requested) return;
    if (lease.granted !== true) {
      // Someone else holds it. Ask again later, in case they leave without applying it.
      clearTimeout(retry);
      retry = setTimeout(() => {
        requested = 0;
        claim();
      }, pendingClaimRetryMs);
      return;
    }
    if (editor.isDestroyed || pendingVersion() !== requested) return;
    const markdown = String(metadata.get("pending_markdown") ?? "");
    editor.commands.setContent(markdown, { contentType: "markdown" });
    metadata.set("applied_version", requested);
  };
  const onSync = (synced: boolean) => {
    // A new connection holds no lease, so a reconnected copy asks again.
    if (!synced) requested = 0;
    claim();
  };
  metadata.observe(claim);
  provider.on("custom-message", onLease);
  provider.on("sync", onSync);
  claim();
  return () => {
    clearTimeout(retry);
    metadata.unobserve(claim);
    provider.off("custom-message", onLease);
    provider.off("sync", onSync);
  };
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
export function collaborationUser(accountId?: string, name?: string) {
  const seed = accountId ?? "misty-user";
  let hash = 0;
  for (const character of seed) hash = (hash * 31 + character.charCodeAt(0)) | 0;
  const colors = ["#8b7cf6", "#48a889", "#d09a55", "#cf6f79", "#5b91d5"];
  return {
    name: name || "Collaborator",
    color: colors[Math.abs(hash) % colors.length],
  };
}
