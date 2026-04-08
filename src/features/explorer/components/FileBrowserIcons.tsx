import type { MaterialIconTheme } from "@/models/types/features/explorer/components/FileBrowserIcons";
export type { MaterialIconTheme } from "@/models/types/features/explorer/components/FileBrowserIcons";
import { File, Folder } from "lucide-react";
import materialIconTheme from "material-icon-theme/dist/material-icons.json";
import type { FileEntry } from "@/models/interfaces/services/misty-api";
import { fileBrowserStyles } from "./FileBrowserStyles";

const materialTheme = materialIconTheme as MaterialIconTheme;
const materialIconUrls = import.meta.glob("/node_modules/material-icon-theme/icons/*.svg", {
  eager: true,
  import: "default",
  query: "?url",
}) as Record<string, string>;

export function FileIcon(props: { entry: FileEntry; size?: number; variant?: "table" | "grid" }) {
  const size = props.size ?? (props.variant === "table" ? 22 : 18);
  const iconUrl = materialIconUrlForEntry(props.entry);

  if (iconUrl) {
    return (
      <img
        alt=""
        aria-hidden="true"
        className={fileBrowserStyles.materialIcon}
        draggable={false}
        height={size}
        src={iconUrl}
        width={size}
      />
    );
  }

  if (props.entry.kind === "folder") {
    return <Folder size={size} className={fileBrowserStyles.folderIcon} />;
  }

  return <File size={size} className={fileBrowserStyles.fileIcon} />;
}

export function GenericFileIcon(props: { kind: "file" | "folder"; size?: number }) {
  const size = props.size ?? 18;
  const iconUrl = materialIconUrl(
    props.kind === "folder" ? materialTheme.folder : materialTheme.file,
  );
  if (iconUrl) {
    return (
      <img
        alt=""
        aria-hidden="true"
        className={fileBrowserStyles.materialIcon}
        draggable={false}
        height={size}
        src={iconUrl}
        width={size}
      />
    );
  }

  return props.kind === "folder" ? (
    <Folder size={size} className={fileBrowserStyles.folderIcon} />
  ) : (
    <File size={size} className={fileBrowserStyles.fileIcon} />
  );
}

function materialIconUrlForEntry(entry: FileEntry): string | null {
  const name = entry.name.toLowerCase();
  if (entry.kind === "folder") {
    return materialIconUrl(materialTheme.folderNames[name] ?? materialTheme.folder);
  }

  const exactNameIcon = materialTheme.fileNames[name];
  if (exactNameIcon) return materialIconUrl(exactNameIcon);

  const extension = normalizedExtension(entry);
  if (extension) {
    const extensionIcon = materialTheme.fileExtensions[extension];
    if (extensionIcon) return materialIconUrl(extensionIcon);
  }

  return materialIconUrl(materialTheme.file);
}

function normalizedExtension(entry: FileEntry): string {
  const extension = entry.extension.replace(/^\./, "").toLowerCase();
  if (extension) return extension;

  const index = entry.name.lastIndexOf(".");
  if (index <= 0 || index === entry.name.length - 1) return "";
  return entry.name.slice(index + 1).toLowerCase();
}

function materialIconUrl(iconName: string | undefined): string | null {
  if (!iconName) return null;
  const definition = materialTheme.iconDefinitions[iconName];
  const fileName = definition?.iconPath?.split("/").pop();
  if (!fileName) return null;
  return materialIconUrls[`/node_modules/material-icon-theme/icons/${fileName}`] ?? null;
}
