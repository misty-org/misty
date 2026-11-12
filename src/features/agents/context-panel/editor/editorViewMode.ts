// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).

/**
 * Which open files get a rendered preview in their tab, and which mode they open in. Markdown
 * opens rendered. HTML opens as code and renders on request: the preview shows the person's own
 * page, which is their choice to look at.
 */
export type EditorViewMode = "edit" | "preview";

const MARKDOWN_RE = /\.(?:md|markdown|mdx)$/i;
const HTML_RE = /\.(?:html?|xhtml)$/i;

export function isMarkdownFile(name: string): boolean {
  return MARKDOWN_RE.test(name);
}

export function isHtmlFile(name: string): boolean {
  return HTML_RE.test(name);
}

/** Whether the editor offers the edit and preview switch. */
export function canPreviewFile(name: string): boolean {
  return isMarkdownFile(name) || isHtmlFile(name);
}

/** Whether the file opens already rendered: Markdown only. */
export function opensInPreview(name: string): boolean {
  return isMarkdownFile(name);
}

/** Whether menus offer "Open in browser": HTML files. */
export function canOpenInBrowser(name: string): boolean {
  return isHtmlFile(name);
}
