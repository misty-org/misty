import {
  File,
  FileArchive,
  FileAudio,
  FileCode2,
  FileJson,
  FileSpreadsheet,
  FileText,
  FileVideo,
  Folder,
  Image,
} from "lucide-react";
import type { FileEntry } from "../../../api/types";
import { fileBrowserStyles } from "./FileBrowserStyles";

export function FileIcon(props: { entry: FileEntry; size?: number; variant?: "table" | "grid" }) {
  const size = props.size ?? (props.variant === "table" ? 22 : 18);
  if (props.entry.kind === "folder") return <Folder size={size} className={fileBrowserStyles.folderIcon} />;

  const iconKind = fileIconKind(props.entry);
  const className = fileIconClass(iconKind);
  switch (iconKind) {
    case "archive":
      return <FileArchive size={size} className={className} />;
    case "audio":
      return <FileAudio size={size} className={className} />;
    case "code":
      return <FileCode2 size={size} className={className} />;
    case "image":
      return <Image size={size} className={className} />;
    case "json":
      return <FileJson size={size} className={className} />;
    case "spreadsheet":
      return <FileSpreadsheet size={size} className={className} />;
    case "text":
      return <FileText size={size} className={className} />;
    case "video":
      return <FileVideo size={size} className={className} />;
    default:
      return <File size={size} className={className} />;
  }
}

type FileIconKind = "archive" | "audio" | "code" | "file" | "image" | "json" | "spreadsheet" | "text" | "video";

function fileIconClass(kind: FileIconKind): string {
  switch (kind) {
    case "archive":
      return fileBrowserStyles.iconArchive;
    case "audio":
      return fileBrowserStyles.iconAudio;
    case "code":
    case "json":
      return fileBrowserStyles.iconCode;
    case "image":
      return fileBrowserStyles.iconImage;
    case "spreadsheet":
      return fileBrowserStyles.iconSpreadsheet;
    case "text":
      return fileBrowserStyles.iconText;
    case "video":
      return fileBrowserStyles.iconVideo;
    default:
      return fileBrowserStyles.fileIcon;
  }
}

const archiveExtensions = new Set(["7z", "bz2", "dmg", "gz", "pkg", "rar", "tar", "tgz", "xz", "zip"]);
const audioExtensions = new Set(["aac", "aif", "aiff", "flac", "m4a", "mp3", "ogg", "opus", "wav"]);
const codeExtensions = new Set([
  "c",
  "cc",
  "cpp",
  "cs",
  "css",
  "go",
  "h",
  "hpp",
  "html",
  "java",
  "js",
  "jsx",
  "kt",
  "mjs",
  "rs",
  "sh",
  "swift",
  "toml",
  "ts",
  "tsx",
  "vue",
  "xml",
  "yaml",
  "yml",
  "zsh",
]);
const imageExtensions = new Set(["bmp", "gif", "heic", "ico", "jpeg", "jpg", "png", "svg", "tif", "tiff", "webp"]);
const jsonExtensions = new Set(["json", "jsonc", "lock"]);
const spreadsheetExtensions = new Set(["csv", "numbers", "ods", "tsv", "xls", "xlsm", "xlsx"]);
const textExtensions = new Set(["doc", "docx", "log", "md", "pdf", "rtf", "txt"]);
const videoExtensions = new Set(["avi", "m4v", "mkv", "mov", "mp4", "mpeg", "mpg", "webm"]);

function fileIconKind(entry: FileEntry): FileIconKind {
  const extension = entry.extension.replace(/^\./, "").toLowerCase();
  const mimeType = (entry.mimeType ?? "").toLowerCase();

  if (mimeType.startsWith("image/") || imageExtensions.has(extension)) return "image";
  if (mimeType.startsWith("video/") || videoExtensions.has(extension)) return "video";
  if (mimeType.startsWith("audio/") || audioExtensions.has(extension)) return "audio";
  if (mimeType.includes("json") || jsonExtensions.has(extension)) return "json";
  if (spreadsheetExtensions.has(extension)) return "spreadsheet";
  if (archiveExtensions.has(extension)) return "archive";
  if (mimeType.startsWith("text/") || codeExtensions.has(extension)) return "code";
  if (textExtensions.has(extension)) return "text";
  return "file";
}
