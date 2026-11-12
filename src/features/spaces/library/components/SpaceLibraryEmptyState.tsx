import { Button, EmptyState } from "@/shared/ui";
import { Upload } from "lucide-react";

export function SpaceLibraryEmptyState(props: SpaceLibraryEmptyStateProps) {
  if (props.searching)
    return (
      <div className="flex items-center gap-3 text-xs text-cream-muted">
        No matching items
        {props.onClearSearch && (
          <Button variant="quiet" onClick={props.onClearSearch}>
            Clear search
          </Button>
        )}
      </div>
    );
  if (props.collection === "deleted") return null;
  // Nothing uploaded yet: centered in the page, with Upload as the page's one primary button.
  return (
    <EmptyState
      title="No files yet"
      line={
        props.uploadAvailable
          ? "Files uploaded here are shared with everyone in the Space and its agents."
          : "Files shared with this Space will show here."
      }
      action={
        props.uploadAvailable
          ? {
              label: props.uploading ? "Uploading…" : "Upload files",
              icon: Upload,
              onClick: props.onUpload,
              disabled: props.uploadDisabled || props.uploading,
            }
          : undefined
      }
    />
  );
}
interface SpaceLibraryEmptyStateProps {
  collection: string;
  searching?: boolean;
  uploadAvailable: boolean;
  uploading: boolean;
  uploadDisabled: boolean;
  onUpload: () => void;
  onClearSearch?: () => void;
}
