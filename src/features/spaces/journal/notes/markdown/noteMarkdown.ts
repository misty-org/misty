import { Editor, type JSONContent } from "@tiptap/core";
import type { Schema } from "@tiptap/pm/model";
import { noteSchemaExtensions } from "../components/noteSchemaExtensions";

/*
 * A doc's conversions without an open editor: markdown, HTML and the editor's JSON, through one
 * headless editor built from the same schema extensions as the real one, so a doc converted here
 * is exactly what the editor would make of the same text.
 */

let headless: Editor | null = null;

function headlessEditor(): Editor {
  if (!headless || headless.isDestroyed) {
    headless = new Editor({
      extensions: noteSchemaExtensions({}),
      content: "",
    });
  }
  return headless;
}

/** The doc schema the editor uses, for writing a Yjs fragment. */
export function noteSchema(): Schema {
  return headlessEditor().schema;
}

const emptyDoc: JSONContent = { type: "doc", content: [{ type: "paragraph" }] };

/** Markdown (with `::embed{…}` directives, tables and fenced code) to the editor's JSON. */
export function markdownToNoteJson(markdown: string): JSONContent {
  const editor = headlessEditor();
  editor.commands.setContent(markdown || "", { contentType: "markdown", emitUpdate: false });
  return editor.getJSON() ?? emptyDoc;
}

/** HTML (an imported Word file's, say) to the editor's JSON, keeping only what the schema has. */
export function htmlToNoteJson(html: string): JSONContent {
  const editor = headlessEditor();
  editor.commands.setContent(html || "", { contentType: "html", emitUpdate: false });
  return editor.getJSON() ?? emptyDoc;
}

/** The editor's JSON to markdown, as the editor's own markdown copy would hold it. */
export function noteJsonToMarkdown(json: JSONContent): string {
  const editor = headlessEditor();
  const manager = editor.markdown;
  if (manager) return manager.serialize(json);
  editor.commands.setContent(json, { emitUpdate: false });
  return editor.getMarkdown();
}

/** The editor's JSON to HTML. */
export function noteJsonToHtml(json: JSONContent): string {
  const editor = headlessEditor();
  editor.commands.setContent(json, { emitUpdate: false });
  return editor.getHTML();
}

/** Markdown to HTML, for an import that only has markdown. */
export function markdownToNoteHtml(markdown: string): string {
  return noteJsonToHtml(markdownToNoteJson(markdown));
}

const textblocks = new Set(["paragraph", "heading", "codeBlock"]);

function inlineText(node: JSONContent): string {
  if (node.type === "text") return node.text ?? "";
  if (node.type === "hardBreak") return "\n";
  return (node.content ?? []).map(inlineText).join("");
}

/** The plain text of a doc, one line per block, for previews. */
export function noteJsonToPlainText(json: JSONContent): string {
  const lines: string[] = [];
  const visit = (node: JSONContent) => {
    if (node.type === "mistyEmbed") {
      lines.push(`[${String(node.attrs?.title || "Embedded item")}]`);
      return;
    }
    if (textblocks.has(node.type ?? "")) {
      lines.push(inlineText(node));
      return;
    }
    for (const child of node.content ?? []) visit(child);
  };
  visit(json);
  return lines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** The doc ids a doc links to (`misty-note://…`), as the editor records them. */
export function noteJsonLinks(json: JSONContent): string[] {
  const ids = new Set<string>();
  const walk = (node: JSONContent) => {
    for (const mark of node.marks ?? []) {
      const match = String(mark.attrs?.href ?? "").match(/^misty-note:\/\/(note_[A-Za-z0-9-]+)$/);
      if (match?.[1]) ids.add(match[1]);
    }
    for (const child of node.content ?? []) walk(child);
  };
  walk(json);
  return [...ids].sort();
}
