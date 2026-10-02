import { Button } from "@/shared/ui";
export const mediaTypeOptions = [
  {
    value: "",
    label: "All media",
  },
  {
    value: "image",
    label: "Images",
  },
  {
    value: "video",
    label: "Videos",
  },
  {
    value: "audio",
    label: "Audio",
  },
  {
    value: "document",
    label: "Documents",
  },
  {
    value: "selfies",
    label: "Selfies",
  },
  {
    value: "live-photos",
    label: "Live Photos",
  },
  {
    value: "portraits",
    label: "Portraits",
  },
  {
    value: "panoramas",
    label: "Panoramas",
  },
  {
    value: "slo-mo",
    label: "Slo-mo",
  },
  {
    value: "cinematic",
    label: "Cinematic",
  },
  {
    value: "bursts",
    label: "Bursts",
  },
  {
    value: "raw",
    label: "RAW",
  },
  {
    value: "screenshots",
    label: "Screenshots",
  },
  {
    value: "screen-recordings",
    label: "Screen Recordings",
  },
  {
    value: "spatial",
    label: "Spatial",
  },
];
export const sortOptions = [
  {
    value: "recently-added:desc",
    label: "Newest added",
  },
  {
    value: "recently-added:asc",
    label: "Oldest added",
  },
  {
    value: "date-captured:desc",
    label: "Newest captured",
  },
  {
    value: "date-captured:asc",
    label: "Oldest captured",
  },
  {
    value: "name:asc",
    label: "Name A–Z",
  },
  {
    value: "name:desc",
    label: "Name Z–A",
  },
  {
    value: "size:desc",
    label: "Largest",
  },
  {
    value: "size:asc",
    label: "Smallest",
  },
];
export function SpaceLibraryEmptyState(props: SpaceLibraryEmptyStateProps) {
  if (!props.searching) return null;
  return (
    <div className="flex items-center gap-3 text-xs text-cream-muted">
      No matching items
      {props.onClearSearch && (
        <Button variant="ghost" size="sm" onClick={props.onClearSearch}>
          Clear search
        </Button>
      )}
    </div>
  );
}
export interface SpaceLibraryEmptyStateProps {
  collection: string;
  searching?: boolean;
  uploadAvailable: boolean;
  uploading: boolean;
  uploadDisabled: boolean;
  onUpload: () => void;
  onClearSearch?: () => void;
}
