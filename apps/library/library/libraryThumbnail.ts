const documentThumbnailExtensions = new Set([
  "pdf",
  "doc",
  "docx",
  "xls",
  "xlsx",
  "ppt",
  "pptx",
  "odt",
  "ods",
  "odp",
  "rtf",
  "epub",
  "md",
  "markdown",
  "txt",
  "csv",
  "tsv",
  "html",
  "htm",
  "xml",
  "json",
  "pages",
  "numbers",
  "key",
]);

export function libraryItemThumbnailEligible(mimeType: string, fileName: string): boolean {
  if (mimeType.startsWith("image/") || mimeType.startsWith("video/")) return true;
  const extension = fileName.toLowerCase().split(".").pop() ?? "";
  return (
    mimeType === "application/pdf" ||
    mimeType.startsWith("text/") ||
    mimeType.includes("document") ||
    mimeType.includes("spreadsheet") ||
    mimeType.includes("presentation") ||
    documentThumbnailExtensions.has(extension)
  );
}
