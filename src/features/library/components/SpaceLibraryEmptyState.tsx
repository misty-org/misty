import { Button } from "@/shared/ui";

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
