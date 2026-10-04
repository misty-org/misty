import type { FileEntry } from "@/native/ipc";
import {
  File,
  FileArchive,
  FileChartColumn,
  FileType2,
  Database,
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
import { cn, itemToneClass, itemTones, type ItemTone } from "@/shared/ui";
import { fileBrowserStyles } from "./FileBrowserStyles";

// Group by content rather than assigning a different brand/color to every format.
const fileTypes: ReadonlyArray<readonly [LucideIcon, ItemTone, ReadonlySet<string>]> = [
  [FileArchive, itemTones.archive, new Set("zip rar 7z tar gz bz2 xz tgz zst".split(" "))],
  [
    FileAudio,
    itemTones.media,
    new Set("mp3 wav flac aac m4a ogg opus aiff aif mid midi".split(" ")),
  ],
  [FileVideo, itemTones.media, new Set("mp4 mov webm mkv avi m4v wmv mpg mpeg".split(" "))],
  [
    FileImage,
    itemTones.image,
    new Set("png jpg jpeg gif webp avif svg ico bmp tiff tif heic heif raw psd".split(" ")),
  ],
  [FileChartColumn, itemTones.slides, new Set("ppt pptx pps ppsx odp key keynote".split(" "))],
  [FileType2, itemTones.font, new Set("ttf otf woff woff2 eot ttc".split(" "))],
  [Database, itemTones.data, new Set("db sqlite sqlite3 db3 mdb accdb duckdb parquet".split(" "))],
  [FileSpreadsheet, itemTones.sheet, new Set("csv tsv xls xlsx ods numbers".split(" "))],
  [FileText, itemTones.pdf, new Set(["pdf"])],
  [
    FileText,
    itemTones.document,
    new Set("txt md mdx markdown doc docx odt rtf pages log epub".split(" ")),
  ],
  [
    FileCode,
    itemTones.code,
    new Set(
      [
        "js jsx ts tsx mjs cjs json jsonc html htm css scss sass less vue svelte",
        "py rs go java kt swift c h cpp hpp cs rb php sh bash zsh fish sql",
        "xml yaml yml toml ini conf env",
      ]
        .join(" ")
        .split(" "),
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

type FileGlyph = { icon: LucideIcon; tone?: ItemTone };

function fileIconFor(name: string, extension?: string, mimeType?: string | null): FileGlyph {
  const normalizedName = name.toLowerCase();
  if (
    codeNames.has(normalizedName) ||
    normalizedName === ".env" ||
    normalizedName.startsWith(".env.")
  ) {
    return { icon: FileCode, tone: itemTones.code };
  }
  const dot = normalizedName.lastIndexOf(".");
  const suffix =
    extension?.replace(/^\./, "").toLowerCase() || (dot > 0 ? normalizedName.slice(dot + 1) : "");
  for (const [icon, tone, extensions] of fileTypes) {
    if (extensions.has(suffix)) return { icon, tone };
  }
  // Remote and extensionless files can still supply a useful content type.
  const mime = mimeType?.toLowerCase();
  if (mime?.startsWith("image/")) return { icon: FileImage, tone: itemTones.image };
  if (mime?.startsWith("audio/")) return { icon: FileAudio, tone: itemTones.media };
  if (mime?.startsWith("video/")) return { icon: FileVideo, tone: itemTones.media };
  if (mime === "application/pdf") return { icon: FileText, tone: itemTones.pdf };
  if (mime?.startsWith("text/")) return { icon: FileText, tone: itemTones.document };
  return { icon: File };
}

const folderGlyph: FileGlyph = { icon: Folder, tone: itemTones.folder };

function EntryIcon(props: FileGlyph & { size?: number; className?: string }) {
  const Icon = props.icon;
  return (
    <Icon
      aria-hidden="true"
      focusable="false"
      size={props.size ?? 20}
      strokeWidth={1.75}
      className={cn(
        fileBrowserStyles.entryIcon,
        props.tone ? itemToneClass(props.tone) : fileBrowserStyles.entryIconMuted,
        props.className,
      )}
    />
  );
}

export function FileIcon(props: { entry: FileEntry; size?: number; variant?: "table" | "grid" }) {
  const { entry } = props;
  const glyph =
    entry.kind === "folder"
      ? folderGlyph
      : fileIconFor(entry.name, entry.extension, entry.mimeType);
  return <EntryIcon {...glyph} size={props.size} />;
}

export function FileNameIcon(props: {
  name: string;
  kind?: "file" | "folder";
  open?: boolean;
  size?: number;
  className?: string;
}) {
  const glyph =
    props.kind === "folder"
      ? { ...folderGlyph, icon: props.open ? FolderOpen : Folder }
      : fileIconFor(props.name);
  return <EntryIcon {...glyph} size={props.size} className={props.className} />;
}

export function GenericFileIcon(props: { kind: "file" | "folder"; size?: number }) {
  return (
    <EntryIcon {...(props.kind === "folder" ? folderGlyph : { icon: File })} size={props.size} />
  );
}
