import { File, Folder, FolderOpen } from "lucide-react";

export function FileIcon({ size = 16 }: { name: string; size?: number }) {
  return <File aria-hidden="true" size={size} className="shrink-0 select-none" />;
}

export function FolderIcon({ open, size = 16 }: { name?: string; open: boolean; size?: number }) {
  const Icon = open ? FolderOpen : Folder;
  return <Icon aria-hidden="true" size={size} className="shrink-0 select-none" />;
}
