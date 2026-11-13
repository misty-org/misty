import { Button, EmptyState, Text } from "@/shared/ui";
import { Upload } from "lucide-react";

export function SpaceLibraryEmptyState(props: SpaceLibraryEmptyStateProps) {
  if (props.searching)
    return (
      <Text bare as="div" tone="muted" className="flex items-center gap-3 text-xs">
        No matching items
        {props.onClearSearch && (
          <Button variant="quiet" onClick={props.onClearSearch}>
            Clear search
          </Button>
        )}
      </Text>
    );
  if (props.collection === "deleted") return null;
  // Nothing uploaded yet: centered in the page, with Upload as the page's one primary button.
  return (
    <span data-tour="library-upload" className="contents">
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
                label: "Upload files",
                icon: Upload,
                onClick: props.onUpload,
                disabled: props.uploadDisabled,
                loading: props.uploading,
              }
            : undefined
        }
      />
    </span>
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
