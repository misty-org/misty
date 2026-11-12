import { apiRequest } from "@/api/client";
import { useTutorStore } from "./tutorStore";
import type { Guide, Notebook } from "./tutorTypes";

/**
 * Sharing to a Space: the person chooses to put a notebook or a guide in the Space as a note, which
 * its members (and the server) can read. Nothing in Tutor reaches the server otherwise. Sharing again
 * updates the same note.
 */

const limit = 95_000;
const notesPath = (spaceId: string) => `/spaces/${encodeURIComponent(spaceId)}/notes`;

/** The Space notes routes an agent's Space tools use: a new note with Markdown, or new content. */
const notes = {
  create: (spaceId: string, title: string, markdown: string) =>
    apiRequest<{ id: string }>(notesPath(spaceId), {
      method: "POST",
      body: JSON.stringify({ title, markdown }),
    }),
  replace: (spaceId: string, noteId: string, title: string, markdown: string) =>
    apiRequest(`${notesPath(spaceId)}/${encodeURIComponent(noteId)}/content`, {
      method: "PUT",
      body: JSON.stringify({ title, markdown }),
    }),
};

function clip(markdown: string): string {
  return markdown.length > limit ? `${markdown.slice(0, limit)}\n\n…` : markdown;
}

/** A notebook as one note: its sources by name, its notes, and the guides made from it. */
export function notebookMarkdown(notebook: Notebook, guides: Guide[]): string {
  const sources = notebook.sources.map(
    (source, index) =>
      `${index + 1}. ${source.url ? `[${source.title}](${source.url})` : source.title}`,
  );
  const notes = notebook.notes.map((note) => `### ${note.title}\n\n${note.body}`);
  const made = guides
    .filter((guide) => guide.kind === "guide")
    .map((guide) => `### ${guide.title}\n\n${guide.body.replace(/^#\s+.+\n+/, "")}`);
  return clip(
    [
      sources.length ? `## Sources\n\n${sources.join("\n")}` : "",
      notes.length ? `## Notes\n\n${notes.join("\n\n")}` : "",
      made.length ? `## Guides\n\n${made.join("\n\n")}` : "",
    ]
      .filter(Boolean)
      .join("\n\n") || "_Nothing in this notebook yet._",
  );
}

/** A guide, quiz or overview as Markdown. */
export function guideMarkdown(guide: Guide): string {
  if (guide.kind === "quiz")
    return clip(
      (guide.questions ?? [])
        .map(
          (q, index) =>
            `${index + 1}. ${q.question}\n${q.choices
              .map((choice, at) => `   - ${at === q.answer ? "**" + choice + "**" : choice}`)
              .join("\n")}${q.explanation ? `\n\n   ${q.explanation}` : ""}`,
        )
        .join("\n\n"),
    );
  if (guide.kind === "overview")
    return clip(
      (guide.script ?? [])
        .map((line) => `**${line.speaker === 0 ? "A" : "B"}:** ${line.text}`)
        .join("\n\n"),
    );
  return clip(guide.body);
}

async function upsert(
  spaceId: string,
  title: string,
  markdown: string,
  shared?: { spaceId: string; noteId: string },
) {
  if (shared?.spaceId === spaceId) {
    try {
      await notes.replace(spaceId, shared.noteId, title, markdown);
      return shared;
    } catch {
      // The note was deleted or can't be changed; a new one is made.
    }
  }
  const note = await notes.create(spaceId, title, markdown);
  return { spaceId, noteId: note.id };
}

export async function shareNotebook(notebookId: string, spaceId: string): Promise<void> {
  const store = useTutorStore.getState();
  const notebook = store.notebooks[notebookId];
  if (!notebook) return;
  const guides = Object.values(store.guides).filter((guide) => guide.notebookId === notebookId);
  const sharedNote = await upsert(
    spaceId,
    notebook.title,
    notebookMarkdown(notebook, guides),
    notebook.sharedNote,
  );
  useTutorStore.getState().updateNotebook(notebookId, (current) => ({ ...current, sharedNote }));
}

export async function shareGuide(guideId: string, spaceId: string): Promise<void> {
  const guide = useTutorStore.getState().guides[guideId];
  if (!guide) return;
  const sharedNote = await upsert(spaceId, guide.title, guideMarkdown(guide), guide.sharedNote);
  const current = useTutorStore.getState().guides[guideId];
  if (current) useTutorStore.getState().saveGuide({ ...current, sharedNote });
}
