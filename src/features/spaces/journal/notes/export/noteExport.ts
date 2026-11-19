import type { JSONContent } from "@tiptap/core";
import { noteJsonToMarkdown } from "../markdown/noteMarkdown";
import { startsWithTitle } from "./docRuns";
import { resolveDocImage } from "./exportImages";
import { readNoteDocument } from "./noteDocument";
import { exportFilename, saveExportFile } from "./saveExport";

export type NoteExportFormat = "markdown" | "docx" | "pdf";

const extensions: Record<NoteExportFormat, string> = {
  markdown: "md",
  docx: "docx",
  pdf: "pdf",
};

/** A doc as Markdown: its title as the first heading, then the body as the editor writes it. */
export function noteMarkdownExport(title: string, json: JSONContent): string {
  const body = noteJsonToMarkdown(json).trim();
  const heading = title && !startsWithTitle(json, title) ? `# ${title}\n\n` : "";
  return `${heading}${body}\n`;
}

/** The exported file's bytes for a doc's content. */
export async function noteExportBlob(
  format: NoteExportFormat,
  title: string,
  json: JSONContent,
): Promise<Blob> {
  if (format === "markdown")
    return new Blob([noteMarkdownExport(title, json)], { type: "text/markdown;charset=utf-8" });
  if (format === "docx") {
    const { noteDocxBlob } = await import("./docxExport");
    return noteDocxBlob(title, json, resolveDocImage);
  }
  const { notePdfBlob } = await import("./pdfExport");
  return notePdfBlob(title, json, resolveDocImage);
}

/** Reads a doc from its room and saves it as Markdown, Word or PDF. */
export async function exportNote(
  spaceId: string,
  noteId: string,
  format: NoteExportFormat,
  fallbackTitle = "",
): Promise<void> {
  const document = await readNoteDocument(spaceId, noteId);
  const title = document.title || fallbackTitle;
  const blob = await noteExportBlob(format, title, document.json);
  saveExportFile(blob, exportFilename(title, extensions[format]));
}
