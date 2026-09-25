export function languageFor(filename: string): string | null {
  const extension = filename.split(".").pop()?.toLowerCase();
  switch (extension) {
    case "ts":
    case "tsx":
      return "typescript";
    case "js":
    case "jsx":
    case "mjs":
    case "cjs":
      return "javascript";
    case "rs":
      return "rust";
    case "py":
    case "pyw":
    case "pyx":
      return "python";
    case "go":
      return "go";
    case "c":
    case "cpp":
    case "cc":
    case "cxx":
    case "h":
    case "hpp":
      return "cpp";
    case "yaml":
    case "yml":
      return "yaml";
    case "json":
    case "jsonc":
      return "json";
    case "html":
    case "htm":
      return "html";
    case "css":
    case "scss":
    case "less":
      return "css";
    case "sh":
    case "bash":
    case "zsh":
      return "bash";
    case "lua":
      return "lua";
    case "zig":
      return "zig";
    default:
      return null;
  }
}
