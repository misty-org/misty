import type { FileEntry } from "@/native/contracts";
import { Button } from "@/shared/ui";
import { Archive, FileText, Folder, Music } from "lucide-react";
import type { LoadedInspectorPreview } from "../../model/interfaces/components/FileInspectorPreview";
import { formatBytes } from "../../utils/fileFormat";
import { FileIcon } from "../FileBrowserIcons";
import { inspectorStyles } from "../FileInspectorStyles";
import {
  archiveEntryIsArchive,
  archiveEntryName,
  formatArchiveEntrySize,
} from "./archivePresentation";

export function PreviewImage(props: { className: string; src: string; alt: string }) {
  return (
    <img
      className={props.className}
      src={props.src}
      alt={props.alt}
      draggable={false}
      loading="lazy"
      decoding="async"
    />
  );
}

export function AudioPreview(props: { preview: LoadedInspectorPreview; title: string }) {
  return (
    <div className={inspectorStyles.audioPreview} aria-label={`Audio preview of ${props.title}`}>
      <div className={inspectorStyles.audioIcon} aria-hidden="true">
        <Music size={25} />
      </div>
      <audio
        className={inspectorStyles.audioControl}
        src={props.preview.url}
        controls
        preload="metadata"
      />
    </div>
  );
}

export function ArchiveContentsPreview(props: { preview: LoadedInspectorPreview }) {
  const entries = props.preview.archiveEntries ?? [];
  const totalCount = props.preview.archiveTotalCount ?? entries.length;
  if (totalCount === 0)
    return <span className={inspectorStyles.previewStatus}>Archive is empty</span>;
  return (
    <div className={inspectorStyles.folderPreview} aria-label="Archive contents preview">
      <div className={inspectorStyles.archivePreviewSummary}>
        <span>{props.preview.archiveFormat ?? "archive"}</span>
        <span>
          {totalCount} {totalCount === 1 ? "item" : "items"}
        </span>
      </div>
      <div className={inspectorStyles.folderPreviewList}>
        {entries.map((entry, index) => {
          const name = archiveEntryName(entry.path);
          return (
            <div
              className={inspectorStyles.folderPreviewItem}
              key={`${entry.path}-${index}`}
              title={entry.path}
            >
              <div className={inspectorStyles.folderPreviewThumb}>
                {entry.isDir ? (
                  <Folder size={20} />
                ) : archiveEntryIsArchive(entry.path) ? (
                  <Archive size={20} />
                ) : (
                  <FileText size={20} />
                )}
              </div>
              <span className={inspectorStyles.folderPreviewName} title={entry.path}>
                {name}
              </span>
              <span className={inspectorStyles.folderPreviewSize}>
                {entry.isDir ? "" : formatArchiveEntrySize(entry)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function FolderContentsPreview(props: {
  entries: FileEntry[];
  loading: boolean;
  error: string | null;
  onOpenEntry: (entry: FileEntry) => void;
}) {
  if (props.loading)
    return <span className={inspectorStyles.previewStatus}>Loading contents...</span>;
  if (props.entries.length === 0) {
    return (
      <span className={inspectorStyles.previewStatus}>
        {props.error ? "Preview unavailable" : "Folder is empty"}
      </span>
    );
  }
  return (
    <div className={inspectorStyles.folderPreview} aria-label="Directory contents preview">
      <div className={inspectorStyles.folderPreviewList}>
        {props.entries.map((entry) => (
          <Button
            variant="ghost"
            className={inspectorStyles.folderPreviewItem}
            key={entry.id}
            type="button"
            aria-label={
              entry.kind === "folder" ? `Open folder ${entry.name}` : `Open ${entry.name}`
            }
            title={entry.name}
            onClick={() => props.onOpenEntry(entry)}
          >
            <div className={inspectorStyles.folderPreviewThumb}>
              <FileIcon entry={entry} size={20} variant="table" />
            </div>
            <span className={inspectorStyles.folderPreviewName} title={entry.name}>
              {entry.name}
            </span>
            <span className={inspectorStyles.folderPreviewSize}>
              {entry.kind === "folder" ? "" : formatBytes(entry.sizeBytes)}
            </span>
          </Button>
        ))}
      </div>
    </div>
  );
}
