/** The languages Misty has a language server for, by the id the native side knows them by. */
export type LspLanguage = "typescript" | "python" | "rust" | "go";

/** What a file is to its server: which server, and the LSP language id of its text. */
export interface LspFileKind {
  language: LspLanguage;
  languageId: string;
}

const byExtension: Record<string, LspFileKind> = {
  ts: { language: "typescript", languageId: "typescript" },
  mts: { language: "typescript", languageId: "typescript" },
  cts: { language: "typescript", languageId: "typescript" },
  tsx: { language: "typescript", languageId: "typescriptreact" },
  js: { language: "typescript", languageId: "javascript" },
  mjs: { language: "typescript", languageId: "javascript" },
  cjs: { language: "typescript", languageId: "javascript" },
  jsx: { language: "typescript", languageId: "javascriptreact" },
  py: { language: "python", languageId: "python" },
  pyi: { language: "python", languageId: "python" },
  rs: { language: "rust", languageId: "rust" },
  go: { language: "go", languageId: "go" },
};

/** The server a file at `path` gets, or null when there is none for it. */
export function lspFileKind(path: string): LspFileKind | null {
  const name = path.slice(Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1);
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return null;
  return byExtension[name.slice(dot + 1).toLowerCase()] ?? null;
}

/** Each server's own name, as installing and errors show it. */
export const serverNames: Record<LspLanguage, string> = {
  typescript: "typescript-language-server",
  python: "basedpyright",
  rust: "rust-analyzer",
  go: "gopls",
};

/** What the bottom bar calls a file's language: JavaScript files share TypeScript's server but
 * keep their own name. */
export function languageName(kind: LspFileKind): string {
  switch (kind.languageId) {
    case "javascript":
    case "javascriptreact":
      return "JavaScript";
    case "typescript":
    case "typescriptreact":
      return "TypeScript";
    case "python":
      return "Python";
    case "rust":
      return "Rust";
    default:
      return "Go";
  }
}
