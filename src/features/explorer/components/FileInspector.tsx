import { formatBytes, formatDate } from "@/features/explorer/utils/fileFormat";
import { GlobalPreviewDialog } from "@/features/explorer/components/GlobalPreview";
import {
  ArchiveContentsPreview,
  AudioPreview,
  FolderContentsPreview,
  PreviewImage,
  useFileMetadata,
  useFilePreview,
  useFolderPreview,
} from "@/features/explorer/components/FileInspectorPreview";
import { inspectorStyles } from "@/features/explorer/components/FileInspectorStyles";
import { FileSearch, Maximize2 } from "lucide-react";
import { lazy, Suspense, useState, type ReactNode } from "react";
import { Button } from "@/ui";
import type {
  DirectoryListing,
  DirectorySizeRecord,
  FileEntry,
} from "@/models/interfaces/services/misty-api";
import { directorySizeRecordForPath } from "@/stores/explorer";

const PdfViewer = lazy(() => import("./PdfViewer"));

export function FileInspector(props: FileInspectorProps) {
  const displayEntry = props.selectedEntry;
  const multiple = props.selectedCount > 1;
  const title = multiple ? "Multiple Items" : (displayEntry?.name ?? "No Selection");
  const { preview, previewError, previewLoading } = useFilePreview(props.selectedEntry);
  const { metadata, metadataError } = useFileMetadata(multiple ? null : displayEntry);
  const folderPreview = useFolderPreview(!multiple ? displayEntry : null, props.listing);
  const displayDirectorySize =
    displayEntry?.kind === "folder"
      ? directorySizeRecordForPath(props.directorySizes, displayEntry.path)
      : undefined;
  const [previewOpen, setPreviewOpen] = useState(false);

  const showPreviewTransition = previewLoading && displayEntry?.kind !== "folder" && !multiple;
  const canOpenPreview = Boolean(
    displayEntry && displayEntry.kind !== "folder" && displayEntry.kind !== "symlink" && !multiple,
  );

  if (!displayEntry && !multiple) {
    return (
      <aside className={inspectorStyles.root}>
        <div className={inspectorStyles.emptyState}>
          <span className={inspectorStyles.emptyStateIcon} aria-hidden="true">
            <FileSearch size={22} />
          </span>
          <p className={inspectorStyles.emptyStateText}>
            Select a file to preview it and view its details.
          </p>
        </div>
      </aside>
    );
  }

  return (
    <aside className={inspectorStyles.root}>
      <div
        className={`${inspectorStyles.previewCard} group`}
        aria-busy={showPreviewTransition || undefined}
      >
        {displayEntry?.kind === "folder" && !multiple ? (
          <FolderContentsPreview
            entries={folderPreview.entries}
            error={folderPreview.error}
            loading={folderPreview.loading}
            onOpenEntry={props.onOpenEntry}
          />
        ) : null}
        {preview?.kind === "archive" ? (
          <ArchiveContentsPreview preview={preview} />
        ) : preview?.kind === "pdf" ? (
          <Suspense fallback={<div className={inspectorStyles.previewMedia} />}>
            <PdfViewer url={preview.url} name={title} compact />
          </Suspense>
        ) : preview?.text != null ? (
          <pre className={inspectorStyles.previewText}>{preview.text}</pre>
        ) : preview?.kind === "video" ? (
          <video
            className={inspectorStyles.previewMedia}
            src={preview.url}
            controls
            autoPlay
            muted
            playsInline
            preload="metadata"
          />
        ) : preview?.kind === "audio" ? (
          <AudioPreview preview={preview} title={title} />
        ) : preview ? (
          <PreviewImage
            className={inspectorStyles.previewMedia}
            src={preview.url}
            alt={`Preview of ${title}`}
          />
        ) : previewError ? (
          <span className={inspectorStyles.previewStatus}>{previewError}</span>
        ) : !showPreviewTransition && (displayEntry?.kind !== "folder" || multiple) ? (
          <span className={inspectorStyles.previewStatus}>Open the full reader</span>
        ) : null}
        {canOpenPreview ? (
          <Button
            variant="secondary"
            size="icon"
            className={inspectorStyles.previewOpenButton}
            type="button"
            aria-label={`Open preview of ${title}`}
            onClick={() => setPreviewOpen(true)}
          >
            <Maximize2 size={15} />
          </Button>
        ) : null}
        {showPreviewTransition ? (
          <span className={inspectorStyles.previewLoadingOverlay} aria-hidden="true" />
        ) : null}
      </div>

      {previewOpen && displayEntry && canOpenPreview ? (
        <GlobalPreviewDialog
          source={{
            path: displayEntry.path,
            name: displayEntry.name,
            extension: displayEntry.extension,
            mimeType: displayEntry.mimeType,
            sizeBytes: displayEntry.sizeBytes,
            modifiedMs: displayEntry.modifiedMs,
            createdMs: displayEntry.createdMs,
            originalName: displayEntry.name,
            readonly: displayEntry.readonly,
            remote: displayEntry.location.kind === "remote",
          }}
          onClose={() => setPreviewOpen(false)}
          onSaved={() => props.onPreviewSaved?.()}
        />
      ) : null}

      <section className={inspectorStyles.detailsCard}>
        {multiple ? (
          <>
            <Detail label="Name" value={title} />
            <Detail label="Selection" value={`${props.selectedCount} items`} />
          </>
        ) : (
          <>
            <Detail label="Name" value={title} />
            <Detail label="Size" valueNode={sizeDetailValue(displayEntry, displayDirectorySize)} />
            <Detail label="Path" value={displayEntry?.path ?? "-"} />
            <Detail label="Items" value={itemsLabel(displayEntry, props.listing)} />
            <Detail
              label="Modified"
              value={formatDate(
                metadata?.modifiedMs ?? displayEntry?.remoteModified ?? displayEntry?.modifiedMs,
              )}
            />
            <Detail
              label="Created"
              value={formatDate(metadata?.createdMs ?? displayEntry?.createdMs)}
            />
            <Detail label="Accessed" value={formatDate(metadata?.accessedMs)} />
          </>
        )}
      </section>
      {!multiple && displayEntry && metadataError ? (
        <section className={inspectorStyles.detailsCard} aria-label="Stat metadata">
          <Detail label="Stat" value={metadataError} />
        </section>
      ) : null}
    </aside>
  );
}

function Detail(props: { label: string; value?: string; valueNode?: ReactNode }) {
  return (
    <div className={inspectorStyles.detailRow}>
      <span className={inspectorStyles.detailLabel}>{props.label}</span>
      <div className={inspectorStyles.detailValue}>{props.valueNode ?? props.value}</div>
    </div>
  );
}

function sizeDetailValue(
  entry: FileEntry | null,
  directorySize: DirectorySizeRecord | undefined,
): ReactNode {
  if (!entry) return "-";
  if (entry.kind !== "folder") return formatBytes(entry.sizeBytes);
  if (directorySize?.status === "ready") return formatBytes(directorySize.sizeBytes);
  if (directorySize?.status === "calculating") return <DirectorySizeDots />;
  return "-";
}

function DirectorySizeDots() {
  return (
    <span className={inspectorStyles.dots} aria-label="Calculating folder size">
      {[0, 1, 2].map((index) => (
        <span
          key={index}
          className={inspectorStyles.dot}
          style={{ animationDelay: `${index * 110}ms` }}
        />
      ))}
    </span>
  );
}

function itemsLabel(entry: FileEntry | null, listing: DirectoryListing | null): string {
  if (!entry) return "-";
  if (listing && entry.path === listing.path) {
    return `${listing.totalCount} ${listing.totalCount === 1 ? "item" : "items"}`;
  }
  return entry.kind === "folder" ? "-" : "1 item";
}

export interface FileInspectorProps {
  listing: DirectoryListing | null;
  selectedEntry: FileEntry | null;
  selectedCount: number;
  directorySizes: Record<string, DirectorySizeRecord>;
  onOpenEntry: (entry: FileEntry) => void;
  onPreviewSaved?: () => void | Promise<void>;
}
