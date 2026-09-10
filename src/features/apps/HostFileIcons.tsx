import { File, Folder } from "lucide-react";
import type { FileEntry } from "@/native/contracts";

/** Shell file labels use shell glyphs. File-type themes are downloaded with Files. */
export function FileNameIcon({ kind = "file", size = 20, className }: {
  name: string; kind?: "file" | "folder"; open?: boolean; size?: number; className?: string;
}) {
  const Icon = kind === "folder" ? Folder : File;
  return <Icon aria-hidden="true" size={size} className={className ?? "text-cream-muted"} />;
}
export function FileIcon({ entry, size }: { entry: FileEntry; size?: number; variant?: "table" | "grid" }) {
  return <FileNameIcon name={entry.name} kind={entry.kind === "folder" ? "folder" : "file"} size={size} />;
}
export function GenericFileIcon({ kind, size }: { kind: "file" | "folder"; size?: number }) {
  return <FileNameIcon name="" kind={kind} size={size} />;
}
