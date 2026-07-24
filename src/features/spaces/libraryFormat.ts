import type { LibraryItemQuery, SpaceLibraryItem } from "@/models/interfaces/features/spaces/types";

export const LIBRARY_ITEM_SCALE_MIN = 0;
export const LIBRARY_ITEM_SCALE_MAX = 2;

export function normalizeLibraryItemScale(scale: number | undefined) {
  if (!Number.isFinite(scale)) return 1;
  return Math.min(LIBRARY_ITEM_SCALE_MAX, Math.max(LIBRARY_ITEM_SCALE_MIN, Math.round(scale ?? 1)));
}

export function compareLibraryItems(
  left: SpaceLibraryItem,
  right: SpaceLibraryItem,
  sort: NonNullable<LibraryItemQuery["sort"]>,
  direction: NonNullable<LibraryItemQuery["direction"]>,
) {
  const multiplier = direction === "asc" ? 1 : -1;
  let result = 0;
  if (sort === "name") result = left.display_name.localeCompare(right.display_name);
  else if (sort === "size")
    result =
      Number(left.file.intrinsic_metadata.byte_size ?? 0) -
      Number(right.file.intrinsic_metadata.byte_size ?? 0);
  else if (sort === "date-captured")
    result =
      new Date(
        left.date_override ??
          String(left.file.intrinsic_metadata.capture_timestamp ?? left.file.original_uploaded_at),
      ).getTime() -
      new Date(
        right.date_override ??
          String(
            right.file.intrinsic_metadata.capture_timestamp ?? right.file.original_uploaded_at,
          ),
      ).getTime();
  else result = new Date(left.added_at).getTime() - new Date(right.added_at).getTime();
  return result === 0 ? left.id.localeCompare(right.id) * multiplier : result * multiplier;
}

export function libraryDateGroupLabel(
  item: SpaceLibraryItem,
  sort: NonNullable<LibraryItemQuery["sort"]>,
) {
  if (sort === "name" || sort === "size" || sort === "album-order") return "";
  const value =
    sort === "date-captured"
      ? (item.date_override ??
        String(item.file.intrinsic_metadata.capture_timestamp ?? item.file.original_uploaded_at))
      : item.added_at;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown date";
  const today = new Date();
  const day = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const currentDay = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  if (day === currentDay) return "Today";
  if (day === currentDay - 86_400_000) return "Yesterday";
  return date.toLocaleDateString([], { month: "long", year: "numeric" });
}

export function libraryFacetPrefix(input: string) {
  const tokens = input.trim().split(/\s+/);
  const token = tokens[tokens.length - 1] ?? "";
  const value = token.includes(":") ? token.slice(token.indexOf(":") + 1) : token;
  return value.replace(/"/g, "").slice(0, 120);
}

export function formatTime(value: string) {
  return new Date(value).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
export function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  if (value >= 1_000_000_000)
    return `${(value / 1_000_000_000).toFixed(value >= 10_000_000_000 ? 0 : 1)} GB`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)} MB`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)} KB`;
  return `${value} B`;
}
