export type TextPreviewKind = "html" | "markdown" | "csv" | "code";

const CODE_EXTENSIONS = new Set([
  "c",
  "cc",
  "cpp",
  "cs",
  "css",
  "go",
  "h",
  "java",
  "js",
  "json",
  "jsx",
  "kt",
  "lua",
  "php",
  "py",
  "rb",
  "rs",
  "scss",
  "sh",
  "sql",
  "swift",
  "toml",
  "ts",
  "tsx",
  "txt",
  "xml",
  "yaml",
  "yml",
  "zsh",
]);

/** Files bigger than this show their icon instead of a live preview. */
export const TEXT_PREVIEW_MAX_BYTES = 256 * 1024;

/** Which live text preview a file gets, from its type or extension; null for none. */
export function textPreviewKind(mimeType: string, fileName: string): TextPreviewKind | null {
  const extension = fileName.toLowerCase().split(".").pop() ?? "";
  if (mimeType === "text/html" || extension === "html" || extension === "htm") return "html";
  if (mimeType === "text/markdown" || extension === "md" || extension === "markdown")
    return "markdown";
  if (mimeType === "text/csv" || extension === "csv" || extension === "tsv") return "csv";
  if (CODE_EXTENSIONS.has(extension) || mimeType.startsWith("text/") || mimeType.endsWith("json"))
    return "code";
  return null;
}
