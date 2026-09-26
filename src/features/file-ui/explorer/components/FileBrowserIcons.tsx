import type { FileEntry } from "@/native/contracts";
import {
  File,
  FileArchive,
  FileAudio,
  FileCode,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileVideo,
  Folder,
  FolderOpen,
  type LucideIcon,
} from "lucide-react";
import { fileBrowserStyles } from "./FileBrowserStyles";

// Group by content rather than assigning a different brand/color to every format.
const fileTypes: ReadonlyArray<readonly [LucideIcon, ReadonlySet<string>]> = [
  [FileArchive, new Set("zip rar 7z tar gz bz2 xz tgz zst".split(" "))],
  [FileAudio, new Set("mp3 wav flac aac m4a ogg opus aiff aif mid midi".split(" "))],
  [FileVideo, new Set("mp4 mov webm mkv avi m4v wmv mpg mpeg".split(" "))],
  [
    FileImage,
    new Set("png jpg jpeg gif webp avif svg ico bmp tiff tif heic heif raw psd".split(" ")),
  ],
  [FileSpreadsheet, new Set("csv tsv xls xlsx ods numbers".split(" "))],
  [FileText, new Set("txt md mdx markdown pdf doc docx odt rtf pages log epub".split(" "))],
  [
    FileCode,
    new Set(
      "js jsx ts tsx mjs cjs json jsonc html htm css scss sass less vue svelte py rs go java kt swift c h cpp hpp cs rb php sh bash zsh fish sql xml yaml yml toml ini conf env".split(
        " ",
      ),
    ),
  ],
];
const codeNames = new Set([
  "dockerfile",
  "containerfile",
  "makefile",
  "gemfile",
  "rakefile",
  ".gitignore",
  ".gitattributes",
  ".gitmodules",
  ".editorconfig",
  ".npmrc",
  ".nvmrc",
]);

function fileIconFor(name: string, extension?: string, mimeType?: string | null): LucideIcon {
  const normalizedName = name.toLowerCase();
  if (
    codeNames.has(normalizedName) ||
    normalizedName === ".env" ||
    normalizedName.startsWith(".env.")
  ) {
    return FileCode;
  }
  const dot = normalizedName.lastIndexOf(".");
  const suffix =
    extension?.replace(/^\./, "").toLowerCase() || (dot > 0 ? normalizedName.slice(dot + 1) : "");
  for (const [Icon, extensions] of fileTypes) {
    if (extensions.has(suffix)) return Icon;
  }
  // Remote and extensionless files can still supply a useful content type.
  const mime = mimeType?.toLowerCase();
  if (mime?.startsWith("image/")) return FileImage;
  if (mime?.startsWith("audio/")) return FileAudio;
  if (mime?.startsWith("video/")) return FileVideo;
  if (mime?.startsWith("text/") || mime === "application/pdf") return FileText;
  return File;
}

function EntryIcon(props: { icon: LucideIcon; size?: number; className?: string }) {
  const Icon = props.icon;
  return (
    <Icon
      aria-hidden="true"
      focusable="false"
      size={props.size ?? 20}
      strokeWidth={1.75}
      className={props.className ?? fileBrowserStyles.entryIcon}
    />
  );
}

export function FileIcon(props: { entry: FileEntry; size?: number; variant?: "table" | "grid" }) {
  const { entry } = props;
  return (
    <EntryIcon
      icon={
        entry.kind === "folder" ? Folder : fileIconFor(entry.name, entry.extension, entry.mimeType)
      }
      size={props.size}
    />
  );
}

export function FileNameIcon(props: {
  name: string;
  kind?: "file" | "folder";
  open?: boolean;
  size?: number;
  className?: string;
}) {
  return (
    <EntryIcon
      icon={props.kind === "folder" ? (props.open ? FolderOpen : Folder) : fileIconFor(props.name)}
      size={props.size}
      className={props.className}
    />
  );
}

export function GenericFileIcon(props: { kind: "file" | "folder"; size?: number }) {
  return <EntryIcon icon={props.kind === "folder" ? Folder : File} size={props.size} />;
}
