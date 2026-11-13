import { invoke } from "@tauri-apps/api/core";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { useTutorStore } from "./tutorStore";
import type { NotebookSource } from "./tutorTypes";

/**
 * Every way a notebook takes a source. Files and recordings are read in native code (the confined
 * document worker, Soniox on the person's key); links are read by Misty itself, so the notebook
 * keeps their text; pasted text is kept as it is.
 */

/** A notebook holds at most this many sources, as NotebookLM's do. */
export const sourceLimit = 50;

interface PreparedDocument {
  displayName: string;
  mimeType: string;
  sections: { kind: string; locator: string; text: string }[];
  truncated: boolean;
}

interface TranscribedSource {
  name: string;
  mimeType: string;
  text: string;
  error?: string;
}

const desktopOnly = (what: string) => new Error(`${what} can be added in the Misty app.`);

function room(notebookId: string): number {
  const notebook = useTutorStore.getState().notebooks[notebookId];
  return notebook ? sourceLimit - notebook.sources.length : 0;
}

function textOf(document: PreparedDocument): string {
  return document.sections
    .map((section) => (section.locator ? `[${section.locator}]\n${section.text}` : section.text))
    .join("\n\n")
    .trim();
}

function addDocument(notebookId: string, document: PreparedDocument) {
  useTutorStore.getState().addSource(notebookId, {
    kind: "file",
    title: document.displayName,
    mimeType: document.mimeType,
    text: textOf(document),
    truncated: document.truncated,
    context: "full",
  });
}

/** Files the person picks in the system dialog. */
export async function addPickedFiles(notebookId: string): Promise<void> {
  if (!hasTauriInternals()) throw desktopOnly("Files");
  const documents = await invoke<PreparedDocument[]>("tutor_pick_sources");
  for (const document of documents.slice(0, room(notebookId))) addDocument(notebookId, document);
}

const plainText = /\.(txt|md|markdown|csv|tsv|json|html?|xml|ya?ml|log|tex|rst)$/i;

/** Files dropped on the dialog: plain text is read here, everything else in native code. */
export async function addDroppedFiles(notebookId: string, files: File[]): Promise<string[]> {
  const failed: string[] = [];
  for (const file of files.slice(0, room(notebookId))) {
    try {
      if (plainText.test(file.name) || file.type.startsWith("text/")) {
        useTutorStore.getState().addSource(notebookId, {
          kind: "file",
          title: file.name,
          mimeType: file.type || "text/plain",
          text: (await file.text()).slice(0, 2_000_000),
          context: "full",
        });
        continue;
      }
      if (!hasTauriInternals()) throw desktopOnly("Files");
      const document = await invoke<PreparedDocument>(
        "tutor_read_dropped",
        new Uint8Array(await file.arrayBuffer()),
        { headers: { "x-file-name": encodeURIComponent(file.name) } },
      );
      addDocument(notebookId, document);
    } catch (reason) {
      failed.push(`${file.name}: ${reason instanceof Error ? reason.message : String(reason)}`);
    }
  }
  return failed;
}

/** Recordings, transcribed with speakers. Answers what couldn't be read. */
export async function addRecordings(notebookId: string): Promise<string[]> {
  if (!hasTauriInternals()) throw desktopOnly("Recordings");
  const recordings = await invoke<TranscribedSource[]>("tutor_transcribe_sources");
  for (const recording of recordings.slice(0, room(notebookId)))
    if (!recording.error && recording.text)
      useTutorStore.getState().addSource(notebookId, {
        kind: "recording",
        title: recording.name,
        mimeType: recording.mimeType,
        text: recording.text,
        context: "full",
      });
  return recordings
    .filter((recording) => recording.error || !recording.text)
    .map((recording) => `${recording.name}: ${recording.error ?? "No speech was found."}`);
}

export function addText(notebookId: string, title: string, text: string): NotebookSource | null {
  if (room(notebookId) <= 0) return null;
  return useTutorStore
    .getState()
    .addSource(notebookId, { kind: "text", title, text, context: "full" });
}

/** A web page, PDF or YouTube video: kept at once, its text read in the background. */
export function addLink(notebookId: string, url: string, title?: string): Promise<string | null> {
  if (room(notebookId) <= 0) return Promise.resolve("This notebook is full.");
  const parsed = new URL(url);
  const source = useTutorStore.getState().addSource(notebookId, {
    kind: "link",
    url: parsed.href,
    title: title || `${parsed.hostname}${parsed.pathname === "/" ? "" : parsed.pathname}`,
    titled: Boolean(title),
    context: "full",
  });
  return readLink(notebookId, source);
}

/** Reads a link source's text into it. Answers why it couldn't, if it couldn't. */
export async function readLink(notebookId: string, source: NotebookSource): Promise<string | null> {
  if (!hasTauriInternals() || !source.url) return null;
  useTutorStore.getState().updateSource(notebookId, source.id, { reading: true });
  try {
    const read = await invoke<{ title: string; text: string; truncated: boolean }>(
      "tutor_read_link",
      { url: source.url },
    );
    useTutorStore.getState().updateSource(notebookId, source.id, {
      text: read.text,
      truncated: read.truncated,
      reading: false,
      ...(read.title && !source.titled ? { title: read.title } : {}),
    });
    return null;
  } catch (reason) {
    useTutorStore.getState().updateSource(notebookId, source.id, { reading: false });
    return `${source.title}: ${reason instanceof Error ? reason.message : String(reason)}`;
  }
}
