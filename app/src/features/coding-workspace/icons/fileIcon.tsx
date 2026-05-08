import { File, FileCode, FileJson, FileText, Folder, FolderOpen } from "lucide-react";

const EXT_TO_ICON: Record<string, { icon: typeof FileCode; color: string }> = {
  ts: { icon: FileCode, color: "#87a9c7" },
  tsx: { icon: FileCode, color: "#87a9c7" },
  js: { icon: FileCode, color: "#e7cf94" },
  jsx: { icon: FileCode, color: "#e7cf94" },
  mjs: { icon: FileCode, color: "#e7cf94" },
  cjs: { icon: FileCode, color: "#e7cf94" },
  json: { icon: FileJson, color: "#d4b880" },
  jsonc: { icon: FileJson, color: "#d4b880" },
  toml: { icon: FileJson, color: "#a8c090" },
  yaml: { icon: FileJson, color: "#d68b80" },
  yml: { icon: FileJson, color: "#d68b80" },
  md: { icon: FileText, color: "#a9c7e2" },
  mdx: { icon: FileText, color: "#a9c7e2" },
  txt: { icon: FileText, color: "#8c8c8c" },
  rs: { icon: FileCode, color: "#e8a887" },
  py: { icon: FileCode, color: "#c5e89e" },
  css: { icon: FileCode, color: "#87a9c7" },
  scss: { icon: FileCode, color: "#87a9c7" },
  html: { icon: FileCode, color: "#e8a887" },
  htm: { icon: FileCode, color: "#e8a887" },
  sh: { icon: FileCode, color: "#c5e89e" },
  zsh: { icon: FileCode, color: "#c5e89e" },
  go: { icon: FileCode, color: "#a9c7e2" },
  rb: { icon: FileCode, color: "#d68b80" },
  java: { icon: FileCode, color: "#e7cf94" },
  swift: { icon: FileCode, color: "#e8a887" },
  kt: { icon: FileCode, color: "#c5a3d8" },
  cs: { icon: FileCode, color: "#87a9c7" },
  php: { icon: FileCode, color: "#c5a3d8" },
  vue: { icon: FileCode, color: "#a8c090" },
  svelte: { icon: FileCode, color: "#e8a887" },
  sql: { icon: FileCode, color: "#a9c7e2" },
  env: { icon: FileText, color: "#d4b880" },
  lock: { icon: FileText, color: "#8c8c8c" },
};

const FILENAME_TO_ICON: Record<string, { icon: typeof FileCode; color: string }> = {
  ".gitignore": { icon: FileText, color: "#d68b80" },
  ".gitattributes": { icon: FileText, color: "#d68b80" },
  "package.json": { icon: FileJson, color: "#d68b80" },
  "package-lock.json": { icon: FileJson, color: "#8c8c8c" },
  "tsconfig.json": { icon: FileJson, color: "#87a9c7" },
  "Cargo.toml": { icon: FileJson, color: "#e8a887" },
  "Cargo.lock": { icon: FileJson, color: "#8c8c8c" },
  "README.md": { icon: FileText, color: "#a9c7e2" },
  Dockerfile: { icon: FileCode, color: "#87a9c7" },
  Makefile: { icon: FileCode, color: "#a8c090" },
};

export function FileIcon({ name, size = 13 }: { name: string; size?: number }) {
  const key = name.toLowerCase();
  if (FILENAME_TO_ICON[name]) {
    const { icon: Icon, color } = FILENAME_TO_ICON[name];
    return <Icon size={size} style={{ color }} />;
  }
  const extension = key.includes(".") ? key.split(".").pop() : undefined;
  const mapping = extension ? EXT_TO_ICON[extension] : null;
  if (mapping) {
    const { icon: Icon, color } = mapping;
    return <Icon size={size} style={{ color }} />;
  }
  return <File size={size} className="text-cream-muted/60" />;
}

export function FolderIcon({ open, size = 13 }: { open: boolean; size?: number }) {
  const Icon = open ? FolderOpen : Folder;
  return <Icon size={size} className="text-cream-muted" />;
}
