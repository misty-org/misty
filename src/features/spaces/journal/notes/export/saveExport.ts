/**
 * Saves an exported file the way the app saves Space exports (a whiteboard's PNG and SVG): as a
 * download, which the app's webview writes to the Downloads folder once that folder is allowed.
 */
export function saveExportFile(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/** A file name from an item's title: no path separators or characters a system refuses. */
export function exportFilename(
  title: string,
  extension: string,
  fallback = "Untitled doc",
): string {
  const base = title
    .replace(/[\\/:*?"<>|\p{Cc}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return `${(base || fallback).slice(0, 120)}.${extension}`;
}
