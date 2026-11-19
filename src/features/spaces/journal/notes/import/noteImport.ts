import { materializeNoteMarkdown, withToolDoc } from "../../../collab/toolSession";
import type { ItemVisibility } from "../../../api/visibility";
import { notesApi, type ServerSpaceNote } from "../api/api";
import { htmlToNoteJson, noteJsonToMarkdown } from "../markdown/noteMarkdown";

/** The files a new doc can be made from, as a file picker's `accept`. */
export const docImportAccept = ".md,.markdown,.txt,.docx";

const markdownTypes = new Set(["text/markdown", "text/x-markdown", "text/plain"]);
const docxType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function extension(name: string): string {
  return name.split(".").pop()?.toLowerCase() ?? "";
}

/** Whether a file (from a picker or a drop) can become a doc. */
export function isDocImportFile(file: Pick<File, "name" | "type">): boolean {
  const ext = extension(file.name);
  return (
    ["md", "markdown", "txt", "docx"].includes(ext) ||
    markdownTypes.has(file.type) ||
    file.type === docxType
  );
}

function titleFromName(name: string): string {
  return (
    name
      .replace(/\.[^.]+$/, "")
      .replace(/[_]+/g, " ")
      .trim() || "Untitled doc"
  );
}

/**
 * A markdown file's title and body: a first-line `# Heading` becomes the title, otherwise the
 * file's name does.
 */
export function splitMarkdownTitle(markdown: string, fileName: string) {
  const text = markdown.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const match = /^#[ \t]+(.+?)[ \t#]*(?:\n|$)/.exec(text.trimStart());
  if (match) {
    return {
      title: match[1]!.trim(),
      markdown: text.trimStart().slice(match[0].length).replace(/^\n+/, ""),
    };
  }
  return { title: titleFromName(fileName), markdown: text };
}

/** A Word file as markdown, through mammoth's HTML and the doc schema. */
export async function docxToMarkdown(data: ArrayBuffer): Promise<string> {
  const mammoth = (await import("mammoth")).default;
  const { value: html } = await mammoth.convertToHtml({ arrayBuffer: data });
  return noteJsonToMarkdown(htmlToNoteJson(html));
}

/** A file's doc title and markdown body. */
export async function docFileContent(file: File): Promise<{ title: string; markdown: string }> {
  if (extension(file.name) === "docx" || file.type === docxType) {
    return {
      title: titleFromName(file.name),
      markdown: await docxToMarkdown(await file.arrayBuffer()),
    };
  }
  return splitMarkdownTitle(await file.text(), file.name);
}

/**
 * Makes a new doc in the Space from a Markdown or Word file, its content written into the doc's
 * editor content at once (plan C4). Returns the new doc.
 */
export async function importDocFile(
  spaceId: string,
  file: File,
  options?: { visibility?: ItemVisibility },
): Promise<ServerSpaceNote> {
  const { title, markdown } = await docFileContent(file);
  const note = await notesApi.createWithMarkdown(spaceId, title, markdown, options?.visibility);
  // The server keeps the markdown either way; writing the content now means the doc is whole
  // before anyone opens it. If it can't be written now, the first editor to open it does.
  await withToolDoc("note", spaceId, note.id, (doc) =>
    materializeNoteMarkdown(doc, markdown),
  ).catch(() => undefined);
  return note;
}
