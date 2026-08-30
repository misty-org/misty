import { FileNameIcon } from "@/features/files/explorer";

export function FileIcon({ name, size = 16 }: { name: string; size?: number }) {
  return <FileNameIcon name={name} size={size} className="shrink-0 select-none object-contain" />;
}

export function FolderIcon({
  name = "",
  open,
  size = 16,
}: {
  name?: string;
  open: boolean;
  size?: number;
}) {
  return (
    <FileNameIcon
      name={name}
      kind="folder"
      open={open}
      size={size}
      className="shrink-0 select-none object-contain"
    />
  );
}
