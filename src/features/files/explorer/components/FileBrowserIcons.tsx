import type { FileEntry } from "@/native/contracts";
import { File, Folder } from "lucide-react";
import materialIconTheme from "material-icon-theme/dist/material-icons.json";
import { fileBrowserStyles } from "./FileBrowserStyles";

const materialTheme = materialIconTheme as MaterialIconTheme;
// Keyed by bare file name so the lookup does not depend on how Vite spells the
// glob keys for an aliased pattern.
const materialIconUrls = Object.fromEntries(
  Object.entries(
    import.meta.glob("#material-icon-theme/icons/*.svg", {
      eager: true,
      import: "default",
      query: "?url",
    }) as Record<string, string>,
  ).map(([iconPath, url]) => [iconPath.split("/").pop() ?? iconPath, url]),
);

export function FileIcon(props: { entry: FileEntry; size?: number; variant?: "table" | "grid" }) {
  const size = props.size ?? 20;
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
        style={{ width: size, height: size }}
        width={size}
      />
    );
  }

  if (props.entry.kind === "folder") {
    return <Folder size={size} className={fileBrowserStyles.folderIcon} />;
  }

  return <File size={size} className={fileBrowserStyles.fileIcon} />;
}

export function FileNameIcon(props: {
  name: string;
  kind?: "file" | "folder";
  open?: boolean;
  size?: number;
  className?: string;
}) {
  const kind = props.kind ?? "file";
  const size = props.size ?? 20;
  const iconUrl = materialIconUrlForName(props.name, kind, props.open ?? false);
  if (iconUrl) {
    return (
      <img
        alt=""
        aria-hidden="true"
        className={props.className ?? fileBrowserStyles.materialIcon}
        draggable={false}
        height={size}
        src={iconUrl}
        width={size}
        style={{ width: size, height: size }}
      />
    );
  }
  return kind === "folder" ? (
    <Folder size={size} className={props.className ?? fileBrowserStyles.folderIcon} />
  ) : (
    <File size={size} className={props.className ?? fileBrowserStyles.fileIcon} />
  );
}

export function GenericFileIcon(props: { kind: "file" | "folder"; size?: number }) {
  const size = props.size ?? 20;
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
        style={{ width: size, height: size }}
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
  if (entry.kind === "folder") return materialIconUrlForName(entry.name, "folder", false);

  const name = entry.name.toLowerCase();
  const exactNameIcon = materialTheme.fileNames[name];
  if (exactNameIcon) return materialIconUrl(exactNameIcon);

  const extension = normalizedExtension(entry);
  if (extension) {
    const extensionIcon = materialTheme.fileExtensions[extension];
    if (extensionIcon) return materialIconUrl(extensionIcon);
  }

  return materialIconUrl(materialTheme.file);
}

function materialIconUrlForName(
  rawName: string,
  kind: "file" | "folder",
  open: boolean,
): string | null {
  const name = rawName.toLowerCase();
  if (kind === "folder") {
    const expandedName = open
      ? (materialTheme.folderNamesExpanded?.[name] ?? materialTheme.folderNames[name])
      : materialTheme.folderNames[name];
    return materialIconUrl(
      expandedName ?? (open ? materialTheme.folderExpanded : undefined) ?? materialTheme.folder,
    );
  }

  const exactNameIcon = materialTheme.fileNames[name];
  if (exactNameIcon) return materialIconUrl(exactNameIcon);
  const index = name.lastIndexOf(".");
  const extension = index > 0 && index < name.length - 1 ? name.slice(index + 1) : "";
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
  return materialIconUrls[fileName] ?? null;
}

export type MaterialIconTheme = {
  iconDefinitions: Record<string, { iconPath?: string }>;
  fileExtensions: Record<string, string>;
  fileNames: Record<string, string>;
  folderNames: Record<string, string>;
  folderNamesExpanded?: Record<string, string>;
  folderExpanded?: string;
  folder: string;
  file: string;
};
