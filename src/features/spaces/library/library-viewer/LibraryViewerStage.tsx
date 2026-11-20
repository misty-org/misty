import { EmbeddedUniversalPreview } from "@/features/files";
import { Button, IconButton, Surface } from "@misty/ui";
import { ChevronLeft, ChevronRight, ClipboardCopy } from "lucide-react";

interface LibraryViewerStageProps {
  displayName: string;
  mimeType: string;
  contentUrl: string;
  contentLoading: boolean;
  contentError: string;
  canCopy: boolean;
  index: number;
  itemCount: number;
  onCopy: () => void;
  onPrevious: () => void;
  onNext: () => void;
}

/** The media half of the viewer: the preview and paging arrows. */
export function LibraryViewerStage(props: LibraryViewerStageProps) {
  const { index, itemCount } = props;

  return (
    <Surface tone="page" className="relative isolate min-h-0 min-w-0 overflow-hidden">
      <div className="absolute inset-6 flex min-h-0 min-w-0 items-center justify-center overflow-hidden">
        <EmbeddedUniversalPreview
          name={props.displayName}
          mimeType={props.mimeType}
          url={props.contentUrl}
          loading={props.contentLoading}
          error={props.contentError}
          fallbackAction={
            props.canCopy ? (
              <Button variant="secondary" type="button" onClick={props.onCopy}>
                <ClipboardCopy />
                Copy
              </Button>
            ) : undefined
          }
        />
      </div>

      {itemCount > 1 ? (
        <>
          <IconButton
            variant="overlay"
            label="Previous item"
            className="absolute inset-y-0 left-4 z-20 my-auto disabled:opacity-20"
            disabled={index <= 0}
            onClick={props.onPrevious}
          >
            <ChevronLeft />
          </IconButton>
          <IconButton
            variant="overlay"
            label="Next item"
            className="absolute inset-y-0 right-4 z-20 my-auto disabled:opacity-20"
            disabled={index < 0 || index >= itemCount - 1}
            onClick={props.onNext}
          >
            <ChevronRight />
          </IconButton>
        </>
      ) : null}
    </Surface>
  );
}
