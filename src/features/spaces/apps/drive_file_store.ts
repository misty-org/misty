import { FILE_TEXT, type FileEntry, type FileStore, type FileVersions } from "@misty/sdk";
import { spaceRequest } from "../api/api";
import { driveFileRef, driveHostError } from "../drive/drive_app_files";
import {
  driveEntryById,
  driveNative,
  driveParent,
  onDriveChanged,
  type DriveEntry,
} from "../drive/drive_native";

const VERSIONS_BOUND_MS = 5_000;

const LIVE_TEXT_EXTENSIONS = new Set([
  ".txt",
  ".text",
  ".md",
  ".markdown",
  ".mdx",
  ".rst",
  ".adoc",
  ".csv",
  ".tsv",
  ".log",
  ".ini",
  ".cfg",
  ".conf",
  ".toml",
  ".yaml",
  ".yml",
  ".json",
  ".jsonc",
  ".xml",
  ".html",
  ".htm",
  ".css",
  ".scss",
  ".less",
  ".js",
  ".mjs",
  ".cjs",
  ".jsx",
  ".ts",
  ".tsx",
  ".py",
  ".rb",
  ".go",
  ".rs",
  ".java",
  ".kt",
  ".swift",
  ".c",
  ".h",
  ".cc",
  ".cpp",
  ".hpp",
  ".cs",
  ".php",
  ".sh",
  ".bash",
  ".zsh",
  ".fish",
  ".sql",
  ".lua",
  ".r",
  ".tex",
  ".vue",
  ".svelte",
  ".graphql",
  ".proto",
]);

export interface DriveHolds {
  hold(entry: Pick<DriveEntry, "id" | "path">): Promise<() => void>;
}

export function liveTextName(entry: Pick<FileEntry, "name">): string | null {
  const dot = entry.name.lastIndexOf(".");
  const extension = dot >= 0 ? entry.name.slice(dot).toLowerCase() : "";
  return LIVE_TEXT_EXTENSIONS.has(extension) ? FILE_TEXT : null;
}

const positive = (value: unknown) =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : undefined;

export function driveFileStore(spaceId: string, holds: DriveHolds): FileStore {
  const itemPath = (fileId: string) =>
    `/spaces/${encodeURIComponent(spaceId)}/drive/items/${encodeURIComponent(fileId)}`;
  return {
    entry: (fileId) =>
      driveEntryById(spaceId, fileId).catch((cause: unknown) => {
        throw driveHostError(cause);
      }),
    read: (entry) => driveNative.read(spaceId, entry.path),
    write: (entry, data, base) =>
      driveNative.write(spaceId, driveParent(entry.path), entry.name, data, {
        item_id: entry.id,
        version: base,
      }),
    copy: (entry, name, data) => driveNative.write(spaceId, driveParent(entry.path), name, data),
    watch: (listener) =>
      onDriveChanged((changed) => {
        if (changed.space_id !== spaceId) return;
        listener({
          items: changed.items,
          ...(changed.removed ? { removed: changed.removed } : {}),
        });
      }),
    hold: (entry) =>
      holds.hold(entry).catch((cause: unknown) => {
        throw driveHostError(cause);
      }),
    async versions(fileId): Promise<FileVersions> {
      const answer = await spaceRequest<
        { version?: unknown; content_version?: unknown } | undefined
      >(itemPath(fileId), { signal: AbortSignal.timeout(VERSIONS_BOUND_MS) });
      const version = positive(answer?.version);
      const content = positive(answer?.content_version);
      return {
        ...(version === undefined ? {} : { version }),
        ...(content === undefined ? {} : { content_version: content }),
      };
    },
    ref: (entry) => driveFileRef(entry),
  };
}
