import type { SpaceLibraryItem } from "@/api/spaces/dto/interfaces/types";
import { formatBytes, formatTime } from "../libraryFormat";
import { LibraryMetadataRow } from "../SpaceLibraryViewerUtils";

/** Intrinsic file facts — type, size, capture data — below the editable fields. */
export function LibraryMetadataList({
  item,
  mimeType,
}: {
  item: SpaceLibraryItem;
  mimeType: string;
}) {
  const metadata = item.file.intrinsic_metadata;
  const hasLocation =
    item.location_override && Object.keys(item.location_override).length > 0
      ? JSON.stringify(item.location_override)
      : "";

  return (
    <dl className="mt-6 grid gap-3 border-t border-charcoal-border/60 pt-5 text-xs">
      <LibraryMetadataRow label="Type" value={mimeType} />
      <LibraryMetadataRow label="Size" value={formatBytes(Number(metadata.byte_size ?? 0))} />
      <LibraryMetadataRow label="Added" value={formatTime(item.added_at)} />
      <LibraryMetadataRow label="Uploaded" value={formatTime(item.file.original_uploaded_at)} />
      {metadata.capture_timestamp ? (
        <LibraryMetadataRow
          label="Captured"
          value={formatTime(String(metadata.capture_timestamp))}
        />
      ) : null}
      {metadata.width && metadata.height ? (
        <LibraryMetadataRow label="Dimensions" value={`${metadata.width} × ${metadata.height}`} />
      ) : null}
      {metadata.duration ? (
        <LibraryMetadataRow label="Duration" value={`${Number(metadata.duration).toFixed(2)} s`} />
      ) : null}
      {Array.isArray(metadata.codecs) ? (
        <LibraryMetadataRow label="Codecs" value={metadata.codecs.join(", ")} />
      ) : null}
      {metadata.frame_rate ? (
        <LibraryMetadataRow
          label="Frame rate"
          value={`${Number(metadata.frame_rate).toFixed(2)} fps`}
        />
      ) : null}
      <LibraryMetadataRow label="Original name" value={item.file.original_filename} />
      {item.date_override ? (
        <LibraryMetadataRow label="Adjusted date" value={formatTime(item.date_override)} />
      ) : null}
      {hasLocation ? <LibraryMetadataRow label="Location" value={hasLocation} /> : null}
    </dl>
  );
}
