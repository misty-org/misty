import { spacesGateway } from "../spaces-gateway/spacesGateway";
import { readLink } from "./tutorSources";
import { useTutorStore } from "./tutorStore";
import type { Notebook, NotebookNote, NotebookSource } from "./tutorTypes";

/**
 * A Lab notebook shared into a Space, so people learn from each other: it becomes one of the
 * Space's docs, readable by everyone there, and the doc is rewritten as the notebook changes until
 * its owner stops sharing. Nothing is shared unless the person asks for that notebook. A friend
 * can save a shared notebook into their own Lab and keep going with their own AI.
 *
 * The doc's title starts with "Notebook: ", the way pick-up notes start with "Pick up: ", so the
 * Lab can find the Space's shared notebooks among its docs.
 *
 * Its last section, "Space notes", belongs to the Space: everyone can write there, and it is kept
 * word for word whenever the owner's notebook writes the rest of the doc again.
 */
export const NOTEBOOK_DOC_PREFIX = "Notebook: ";
const SPACE_NOTES_HEADING = "## Space notes";
const SPACE_NOTES_HINT =
  "_Anyone here can add to this section. It stays when the notebook updates._";
const note = (text: string) => text.replace(/\r\n/g, "\n").trim();

/** What the Space wrote under "Space notes" in the doc, or nothing. */
export function spaceNotesOf(markdown: string): string {
  const text = markdown.replace(/\r\n/g, "\n");
  const at = text.lastIndexOf(`\n${SPACE_NOTES_HEADING}\n`);
  const start = text.startsWith(`${SPACE_NOTES_HEADING}\n`) ? 0 : at < 0 ? -1 : at + 1;
  if (start < 0) return "";
  return text
    .slice(start + SPACE_NOTES_HEADING.length)
    .replace(SPACE_NOTES_HINT, "")
    .trim();
}

/**
 * The doc's body: the overview, the sources (links stay links), the owner's notes, then the
 * Space's own notes, carried over from the doc as it is now.
 */
export function notebookMarkdown(notebook: Notebook, spaceNotes = ""): string {
  const parts = [
    "_A notebook shared from the Lab. The sections above Space notes follow its owner's notebook. " +
      "Save it to your own Lab to keep learning from it with your AI._",
  ];
  if (notebook.brief?.summary) {
    parts.push("## Overview", note(notebook.brief.summary));
    if (notebook.brief.topics.length) parts.push(`**Topics:** ${notebook.brief.topics.join(", ")}`);
    if (notebook.brief.questions.length)
      parts.push(
        "## Questions to explore",
        notebook.brief.questions.map((q) => `- ${q}`).join("\n"),
      );
  }
  const sources = notebook.sources.filter((source) => source.context !== "off" || source.url);
  if (sources.length) parts.push("## Sources", sources.map(sourceLine).join("\n"));
  if (notebook.notes.length) {
    parts.push("## Notes");
    for (const item of notebook.notes) parts.push(`### ${item.title || "Note"}`, note(item.body));
  }
  parts.push(SPACE_NOTES_HEADING, SPACE_NOTES_HINT);
  if (spaceNotes.trim()) parts.push(spaceNotes.trim());
  return parts.join("\n\n") + "\n";
}

function sourceLine(source: NotebookSource): string {
  const title = source.title.replace(/[[\]]/g, "") || "Source";
  const about = source.summary ? `: ${oneLine(source.summary)}` : "";
  return source.url ? `- [${title}](${source.url})${about}` : `- ${title}${about}`;
}

const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();

/** A shared notebook read back from its doc: its links as sources to read again, its notes. */
export function notebookFromMarkdown(markdown: string): {
  sources: Pick<NotebookSource, "kind" | "title" | "url" | "text">[];
  notes: Pick<NotebookNote, "title" | "body">[];
} {
  const sections = new Map<string, string>();
  let heading = "";
  for (const line of markdown.replace(/\r\n/g, "\n").split("\n")) {
    const top = /^## (.+)$/.exec(line);
    if (top) {
      heading = top[1]!.trim();
      sections.set(heading, "");
      continue;
    }
    if (heading) sections.set(heading, `${sections.get(heading)}${line}\n`);
  }
  const sources: Pick<NotebookSource, "kind" | "title" | "url" | "text">[] = [];
  for (const line of (sections.get("Sources") ?? "").split("\n")) {
    const link = /^- \[([^\]]*)\]\((https?:\/\/[^)\s]+)\)(?::\s*(.*))?$/.exec(line.trim());
    if (link) {
      sources.push({ kind: "link", title: link[1] || link[2]!, url: link[2] });
      continue;
    }
    const plain = /^- ([^:]+)(?::\s*(.*))?$/.exec(line.trim());
    if (plain?.[2]) sources.push({ kind: "text", title: plain[1]!.trim(), text: plain[2] });
  }
  const notes: Pick<NotebookNote, "title" | "body">[] = [];
  const overview = sections.get("Overview")?.trim();
  if (overview) notes.push({ title: "Overview from the shared notebook", body: overview });
  for (const block of (sections.get("Notes") ?? "").split(/^### /m).slice(1)) {
    const [title = "", ...body] = block.split("\n");
    notes.push({ title: title.trim() || "Note", body: body.join("\n").trim() });
  }
  const fromSpace = spaceNotesOf(markdown);
  if (fromSpace) notes.push({ title: "Space notes", body: fromSpace });
  return { sources, notes };
}

/** Shares the notebook into the window's Space, or writes it again there if it is shared. */
export async function shareNotebook(notebookId: string): Promise<void> {
  const notebook = useTutorStore.getState().notebooks[notebookId];
  const space = notebook?.shared
    ? { id: notebook.shared.spaceId, name: notebook.shared.spaceName }
    : spacesGateway.get().windowSpace();
  if (!notebook || !space) throw new Error("Open a Space to share this notebook with.");
  const gateway = spacesGateway.get();
  // What the Space wrote under Space notes is read back first and kept, never written over.
  const docId = notebook.shared?.docId;
  const spaceNotes = docId
    ? spaceNotesOf(await gateway.readDoc(space.id, docId).catch(() => ""))
    : "";
  const doc = await gateway.saveDoc(
    space.id,
    docId,
    `${NOTEBOOK_DOC_PREFIX}${notebook.title}`,
    notebookMarkdown(notebook, spaceNotes),
  );
  written.set(notebook.id, notebook.updatedAt);
  if (notebook.shared?.docId === doc.id) return;
  useTutorStore.getState().updateNotebook(notebook.id, (current) => ({
    ...current,
    shared: {
      spaceId: space.id,
      spaceName: space.name,
      docId: doc.id,
      sharedAt: new Date().toISOString(),
    },
  }));
  // Marking it shared is not a change to write again.
  written.set(notebook.id, useTutorStore.getState().notebooks[notebook.id]?.updatedAt ?? "");
}

/** Stops keeping the doc up to date; the doc stays in the Space as it last was. */
export function stopSharingNotebook(notebookId: string) {
  useTutorStore.getState().updateNotebook(notebookId, ({ shared: _shared, ...rest }) => rest);
}

/** Copies a notebook someone shared into the Space into the person's own Lab. */
export async function saveSharedNotebook(spaceId: string, docId: string, title: string) {
  const markdown = await spacesGateway.get().readDoc(spaceId, docId);
  const read = notebookFromMarkdown(markdown);
  const store = useTutorStore.getState();
  const made = store.createNotebook(title);
  const at = new Date().toISOString();
  store.updateNotebook(made.id, (current) => ({
    ...current,
    savedFrom: { spaceId, docId },
    sources: read.sources.map((source) => ({
      ...source,
      id: `source-${crypto.randomUUID()}`,
      context: "full",
      createdAt: at,
    })),
    notes: read.notes.map((item) => ({
      ...item,
      id: `note-${crypto.randomUUID()}`,
      origin: "person",
      createdAt: at,
      updatedAt: at,
    })),
  }));
  // The doc carries links, not their text: read each one now, as "Read again" would.
  const saved = useTutorStore.getState().notebooks[made.id];
  for (const source of saved?.sources ?? [])
    if (source.kind === "link" && source.url) void readLink(made.id, source);
  return made.id;
}

/** When each shared notebook was last written to its doc, so only a change writes again. */
const written = new Map<string, string>();
const pending = new Map<string, number>();
/** A burst of edits (an agent filling in notes, typing) writes the doc once it settles. */
const SETTLE_MS = 4000;
let watching = false;

/** Keeps every shared notebook's doc up to date while Misty runs. Safe to call again. */
export function watchSharedNotebooks() {
  if (watching) return;
  watching = true;
  for (const notebook of Object.values(useTutorStore.getState().notebooks))
    if (notebook.shared) written.set(notebook.id, notebook.updatedAt);
  useTutorStore.subscribe((state) => {
    for (const notebook of Object.values(state.notebooks)) {
      if (!notebook.shared) continue;
      if (!written.has(notebook.id)) written.set(notebook.id, notebook.updatedAt);
      if (written.get(notebook.id) === notebook.updatedAt) continue;
      window.clearTimeout(pending.get(notebook.id));
      pending.set(
        notebook.id,
        window.setTimeout(() => {
          pending.delete(notebook.id);
          void shareNotebook(notebook.id).catch(() => undefined);
        }, SETTLE_MS),
      );
    }
  });
}
