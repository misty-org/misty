import * as Y from "yjs";
import type { RichBlock, RichRun } from "./types";

/**
 * A text slot's content, in its three forms: the room's `Y.XmlFragment` (the Tiptap schema the
 * contract names: paragraph, bulletList, listItem, text, and bold, italic and link marks), the
 * flat blocks the renderer and the exports read, and the markdown agents write and read.
 * Nothing here needs an editor, so the tool host uses it on a bare doc.
 */

// ------------------------------------------------------------------------------------------
// Reading the room.

export function readRichText(fragment: Y.XmlFragment | null | undefined): RichBlock[] {
  if (!fragment) return [];
  const blocks: RichBlock[] = [];
  for (const child of fragment.toArray()) readNode(child, blocks, -1);
  return blocks;
}

function readNode(node: unknown, blocks: RichBlock[], listLevel: number): void {
  if (node instanceof Y.XmlText) {
    const runs = readTextRuns(node);
    if (runs.length) blocks.push({ kind: "paragraph", runs });
    return;
  }
  if (!(node instanceof Y.XmlElement)) return;
  if (node.nodeName === "bulletList" || node.nodeName === "orderedList") {
    for (const item of node.toArray()) readNode(item, blocks, listLevel + 1);
    return;
  }
  if (node.nodeName === "listItem") {
    for (const child of node.toArray()) {
      if (child instanceof Y.XmlElement && child.nodeName === "paragraph") {
        blocks.push({ kind: "bullet", level: listLevel > 0 ? 1 : 0, runs: readElementRuns(child) });
      } else {
        readNode(child, blocks, listLevel);
      }
    }
    return;
  }
  // A paragraph, or anything else a newer editor may have written: read as its text.
  blocks.push({ kind: "paragraph", runs: readElementRuns(node) });
}

function readElementRuns(element: Y.XmlElement): RichRun[] {
  const runs: RichRun[] = [];
  for (const child of element.toArray()) {
    if (child instanceof Y.XmlText) runs.push(...readTextRuns(child));
    else if (child instanceof Y.XmlElement) {
      if (child.nodeName === "hardBreak") runs.push({ text: " " });
      else runs.push(...readElementRuns(child));
    }
  }
  return mergeRuns(runs);
}

function readTextRuns(text: Y.XmlText): RichRun[] {
  const runs: RichRun[] = [];
  for (const part of text.toDelta() as {
    insert?: unknown;
    attributes?: Record<string, unknown>;
  }[]) {
    if (typeof part.insert !== "string" || !part.insert) continue;
    const attributes = part.attributes ?? {};
    const run: RichRun = { text: part.insert };
    for (const [key, value] of Object.entries(attributes)) {
      const mark = key.split("--")[0];
      if (mark === "bold" && value != null) run.bold = true;
      if (mark === "italic" && value != null) run.italic = true;
      if (mark === "link" && value && typeof value === "object") {
        const href = (value as { href?: unknown }).href;
        if (typeof href === "string" && safeHref(href)) run.href = href;
      }
    }
    runs.push(run);
  }
  return runs;
}

function mergeRuns(runs: RichRun[]): RichRun[] {
  const merged: RichRun[] = [];
  for (const run of runs) {
    const last = merged[merged.length - 1];
    if (last && last.bold === run.bold && last.italic === run.italic && last.href === run.href)
      last.text += run.text;
    else merged.push({ ...run });
  }
  return merged;
}

// ------------------------------------------------------------------------------------------
// Writing the room. Called inside the caller's transaction.

/** Replaces a fragment's content with these blocks. */
export function writeRichText(fragment: Y.XmlFragment, blocks: RichBlock[]): void {
  if (fragment.length) fragment.delete(0, fragment.length);
  let list: Y.XmlElement | null = null;
  let lastTopItem: Y.XmlElement | null = null;
  let nested: Y.XmlElement | null = null;
  for (const block of blocks) {
    if (block.kind === "paragraph") {
      list = null;
      lastTopItem = null;
      nested = null;
      appendParagraph(fragment, block.runs);
      continue;
    }
    if (block.level === 1 && lastTopItem) {
      if (!nested) {
        nested = new Y.XmlElement("bulletList");
        lastTopItem.insert(lastTopItem.length, [nested]);
      }
      const item = new Y.XmlElement("listItem");
      nested.insert(nested.length, [item]);
      appendParagraph(item, block.runs);
      continue;
    }
    if (!list) {
      list = new Y.XmlElement("bulletList");
      fragment.insert(fragment.length, [list]);
    }
    const item = new Y.XmlElement("listItem");
    list.insert(list.length, [item]);
    appendParagraph(item, block.runs);
    lastTopItem = item;
    nested = null;
  }
}

function appendParagraph(parent: Y.XmlFragment | Y.XmlElement, runs: RichRun[]): void {
  const paragraph = new Y.XmlElement("paragraph");
  parent.insert(parent.length, [paragraph]);
  const text = new Y.XmlText();
  paragraph.insert(0, [text]);
  let offset = 0;
  for (const run of runs) {
    if (!run.text) continue;
    // Every run states all its marks, so a plain run never takes the marks of the one before.
    const attributes: Record<string, unknown> = {
      bold: run.bold ? {} : null,
      italic: run.italic ? {} : null,
      link:
        run.href && safeHref(run.href)
          ? { href: run.href, target: "_blank", rel: "noopener noreferrer nofollow", class: null }
          : null,
    };
    for (const key of Object.keys(attributes)) if (attributes[key] === null) delete attributes[key];
    text.insert(offset, run.text, attributes);
    offset += run.text.length;
  }
}

/** A deep copy of a fragment's content into another, for moving a slot under a new name. */
export function copyRichText(from: Y.XmlFragment, to: Y.XmlFragment): void {
  writeRichText(to, readRichText(from));
}

export function richTextIsEmpty(blocks: RichBlock[]): boolean {
  return blocks.every((block) => block.runs.every((run) => !run.text.trim()));
}

export function richPlainText(blocks: RichBlock[]): string {
  return blocks.map((block) => block.runs.map((run) => run.text).join("")).join("\n");
}

// ------------------------------------------------------------------------------------------
// Markdown, the form agents write and read.

const bulletLine = /^(\s*)(?:[-*+•]|\d+[.)])\s+(.*)$/;

/**
 * Paragraphs, `- ` bullets (indented two spaces or a tab for the second level), **bold**,
 * *italic* and [links](https://…). Headings read as paragraphs; anything else is kept as text.
 */
export function markdownToRich(markdown: string): RichBlock[] {
  const blocks: RichBlock[] = [];
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length)
      blocks.push({ kind: "paragraph", runs: parseInline(paragraph.join(" ")) });
    paragraph = [];
  };
  for (const raw of markdown.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.replace(/\s+$/, "");
    if (!line.trim()) {
      flush();
      continue;
    }
    const bullet = bulletLine.exec(line);
    if (bullet) {
      flush();
      const indent = bullet[1].replace(/\t/g, "  ").length;
      blocks.push({ kind: "bullet", level: indent >= 2 ? 1 : 0, runs: parseInline(bullet[2]) });
      continue;
    }
    paragraph.push(
      line
        .trim()
        .replace(/^#{1,6}\s+/, "")
        .replace(/^>\s?/, ""),
    );
  }
  flush();
  return blocks.filter((block) => block.runs.length > 0);
}

export function richToMarkdown(blocks: RichBlock[]): string {
  let out = "";
  blocks.forEach((block, index) => {
    const previous = blocks[index - 1];
    if (index > 0) out += previous?.kind === "bullet" && block.kind === "bullet" ? "\n" : "\n\n";
    const text = block.runs.map(runToMarkdown).join("");
    out += block.kind === "bullet" ? `${block.level ? "  " : ""}- ${text}` : text;
  });
  return out;
}

function runToMarkdown(run: RichRun): string {
  let text = run.text.replace(/([*_[\]\\])/g, "\\$1");
  if (run.italic) text = `*${text}*`;
  if (run.bold) text = `**${text}**`;
  if (run.href) text = `[${text}](${run.href})`;
  return text;
}

/** Inline marks: **bold**, __bold__, *italic*, _italic_, [text](url) and backslash escapes. */
export function parseInline(source: string): RichRun[] {
  const runs: RichRun[] = [];
  const walk = (text: string, marks: Omit<RichRun, "text">) => {
    let plain = "";
    const push = () => {
      if (plain) runs.push({ text: plain, ...marks });
      plain = "";
    };
    let i = 0;
    while (i < text.length) {
      const rest = text.slice(i);
      if (rest[0] === "\\" && rest.length > 1) {
        plain += rest[1];
        i += 2;
        continue;
      }
      const strong = /^(\*\*|__)(.+?)\1/.exec(rest);
      if (strong) {
        push();
        walk(strong[2], { ...marks, bold: true });
        i += strong[0].length;
        continue;
      }
      const em = /^(\*|_)(?!\s)(.+?)\1(?![*_])/.exec(rest);
      if (em) {
        push();
        walk(em[2], { ...marks, italic: true });
        i += em[0].length;
        continue;
      }
      const link = /^\[([^\]]+)\]\(([^)\s]+)\)/.exec(rest);
      if (link) {
        push();
        walk(link[1], safeHref(link[2]) ? { ...marks, href: link[2] } : marks);
        i += link[0].length;
        continue;
      }
      plain += rest[0];
      i += 1;
    }
    push();
  };
  walk(source, {});
  return mergeRuns(runs.map(clean));
}

function clean(run: RichRun): RichRun {
  const next: RichRun = { text: run.text };
  if (run.bold) next.bold = true;
  if (run.italic) next.italic = true;
  if (run.href) next.href = run.href;
  return next;
}

export function safeHref(href: string): boolean {
  return /^(https?:|mailto:)/i.test(href.trim());
}

// ------------------------------------------------------------------------------------------
// HTML, the static form the renderer and the measurer draw. Its element structure and styles
// are the editor's own (`slotNodeStyles`), so a slot measures the same whether it is being
// edited or not.

const linkStyle = "color:inherit;text-decoration:underline;text-underline-offset:0.12em;";

/** A slot's text colors and bullet spacing, from its theme (`slotInk` in slotStyle.ts). */
export interface SlotInk {
  color: string;
  /** The bullets' own color: a list item carries it, and its paragraph sets the text back. */
  marker: string;
  bulletGap: string;
}

export function slotNodeStyles(ink: SlotInk) {
  return {
    paragraph: `margin:0;color:${ink.color};`,
    // `revert` brings back the browser's own markers: a disc, and a circle one level in.
    bulletList: [
      "margin:0;padding:0 0 0 1.15em;list-style:revert;display:flex;flex-direction:column;",
      `gap:${ink.bulletGap};`,
    ].join(""),
    listItem: `display:list-item;color:${ink.marker};`,
    link: linkStyle,
  };
}

export function richToHtml(blocks: RichBlock[], ink: SlotInk): string {
  const styles = slotNodeStyles(ink);
  let html = "";
  let index = 0;
  const item = (runs: RichRun[]) =>
    `<li style="${styles.listItem}"><p style="${styles.paragraph}">${runsToHtml(runs)}</p>`;
  while (index < blocks.length) {
    const block = blocks[index];
    if (block.kind === "paragraph") {
      html += `<p style="${styles.paragraph}">${runsToHtml(block.runs)}</p>`;
      index += 1;
      continue;
    }
    html += `<ul style="${styles.bulletList}">`;
    while (index < blocks.length && blocks[index].kind === "bullet") {
      html += item(blocks[index].runs);
      index += 1;
      if (isNested(blocks[index])) {
        html += `<ul style="${styles.bulletList}">`;
        while (isNested(blocks[index])) {
          html += `${item(blocks[index].runs)}</li>`;
          index += 1;
        }
        html += "</ul>";
      }
      html += "</li>";
    }
    html += "</ul>";
  }
  return html;
}

function isNested(block: RichBlock | undefined): boolean {
  return block?.kind === "bullet" && block.level === 1;
}

function runsToHtml(runs: RichRun[]): string {
  if (!runs.length) return "<br>";
  return runs
    .map((run) => {
      let text = escapeHtml(run.text);
      if (run.italic) text = `<em>${text}</em>`;
      if (run.bold) text = `<strong>${text}</strong>`;
      if (run.href && safeHref(run.href))
        text = `<a href="${escapeHtml(run.href)}" target="_blank" rel="noopener noreferrer nofollow" style="${linkStyle}">${text}</a>`;
      return text;
    })
    .join("");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
