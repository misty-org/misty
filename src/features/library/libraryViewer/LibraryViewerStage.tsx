import { EmbeddedUniversalPreview } from "@/features/resource-preview/EmbeddedUniversalPreview";
import { Button, IconButton } from "@/shared/ui";
import { ChevronLeft, ChevronRight, ClipboardCopy } from "lucide-react";
import type { CSSProperties, RefObject } from "react";

export interface LibraryViewerStageProps {
  displayName: string;
  mimeType: string;
  contentUrl: string;
  contentLoading: boolean;
  contentError: string;
  mediaStyle: CSSProperties | undefined;
  canCopy: boolean;
  index: number;
  itemCount: number;
  imageRef: RefObject<HTMLImageElement | null>;
  videoRef: RefObject<HTMLVideoElement | null>;
  onVideoTime: () => void;
  onCopy: () => void;
  onPrevious: () => void;
  onNext: () => void;
}

/** The media half of the viewer: the preview and paging arrows. */
export function LibraryViewerStage(props: LibraryViewerStageProps) {
  const { index, itemCount } = props;

  return (
    <div className="relative isolate min-h-0 min-w-0 overflow-hidden bg-charcoal-workspace">
      <div className="absolute inset-6 flex min-h-0 min-w-0 items-center justify-center overflow-hidden">
        <EmbeddedUniversalPreview
          name={props.displayName}
          mimeType={props.mimeType}
          url={props.contentUrl}
          loading={props.contentLoading}
          error={props.contentError}
          imageRef={props.imageRef}
          videoRef={props.videoRef}
          mediaStyle={props.mediaStyle}
          onVideoMetadata={props.onVideoTime}
          onVideoTime={props.onVideoTime}
          fallbackAction={
            props.canCopy ? (
              <Button size="sm" variant="outline" type="button" onClick={props.onCopy}>
                <ClipboardCopy size={14} />
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
            shape="round"
            size="lg"
            label="Previous item"
            className="absolute inset-y-0 left-4 z-20 my-auto disabled:opacity-20"
            disabled={index <= 0}
            onClick={props.onPrevious}
          >
            <ChevronLeft size={20} />
          </IconButton>
          <IconButton
            variant="overlay"
            shape="round"
            size="lg"
            label="Next item"
            className="absolute inset-y-0 right-4 z-20 my-auto disabled:opacity-20"
            disabled={index < 0 || index >= itemCount - 1}
            onClick={props.onNext}
          >
            <ChevronRight size={20} />
          </IconButton>
        </>
      ) : null}
    </div>
  );
}
