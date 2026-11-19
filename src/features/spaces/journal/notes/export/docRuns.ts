import type { JSONContent } from "@tiptap/core";

/** One run of text with its marks, as the Word and PDF writers lay it out. */
export interface DocRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  code?: boolean;
  superscript?: boolean;
  subscript?: boolean;
  /** An outside link; links to other docs (`misty-note://`) stay plain text. */
  link?: string;
  /** A line break inside the block. */
  break?: boolean;
}

/** The runs of a text block's inline content. */
export function inlineRuns(content: readonly JSONContent[] | undefined): DocRun[] {
  const runs: DocRun[] = [];
  for (const node of content ?? []) {
    if (node.type === "hardBreak") {
      runs.push({ text: "", break: true });
      continue;
    }
    if (node.type !== "text" || !node.text) continue;
    const run: DocRun = { text: node.text };
    for (const mark of node.marks ?? []) {
      if (mark.type === "bold") run.bold = true;
      else if (mark.type === "italic") run.italic = true;
      else if (mark.type === "underline") run.underline = true;
      else if (mark.type === "strike") run.strike = true;
      else if (mark.type === "code") run.code = true;
      else if (mark.type === "superscript") run.superscript = true;
      else if (mark.type === "subscript") run.subscript = true;
      else if (mark.type === "link") {
        const href = String(mark.attrs?.href ?? "");
        if (/^(https?:|mailto:)/i.test(href)) run.link = href;
      }
    }
    runs.push(run);
  }
  return runs;
}

/** The plain text of a block's inline content. */
export function inlineText(content: readonly JSONContent[] | undefined): string {
  return inlineRuns(content)
    .map((run) => (run.break ? "\n" : run.text))
    .join("");
}

/** What an embed says in an exported file: its kind and last-known title. Nothing is copied. */
export function embedPlaceholder(attrs: Record<string, unknown> | undefined): string {
  const kind = String(attrs?.kind ?? "");
  const label =
    kind === "board-frame"
      ? "Whiteboard frame"
      : kind === "data-range"
        ? "Data range"
        : "Data chart";
  const title = String(attrs?.title ?? "").trim();
  return title ? `${label}: ${title}` : label;
}

/** Whether the doc already opens with its title as a heading. */
export function startsWithTitle(json: JSONContent, title: string): boolean {
  const first = json.content?.[0];
  return (
    first?.type === "heading" && inlineText(first.content).trim() === title.trim() && Boolean(title)
  );
}
