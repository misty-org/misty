// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).

export type EditorViewMode = "edit" | "preview";

const MARKDOWN_RE = /\.(?:md|markdown|mdx)$/i;
const HTML_RE = /\.(?:html?|xhtml)$/i;

export function isMarkdownFile(name: string): boolean {
  return MARKDOWN_RE.test(name);
}

export function isHtmlFile(name: string): boolean {
  return HTML_RE.test(name);
}

export function canPreviewFile(name: string): boolean {
  return isMarkdownFile(name) || isHtmlFile(name);
}

export function opensInPreview(name: string): boolean {
  return isMarkdownFile(name);
}

export function canOpenInBrowser(name: string): boolean {
  return isHtmlFile(name);
}
