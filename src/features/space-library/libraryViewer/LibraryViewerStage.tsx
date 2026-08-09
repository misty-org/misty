import { EmbeddedUniversalPreview } from "@/features/file-explorer";
import type { LibraryAssetStack } from "@/services/spaces/dto/interfaces/types";
import { Button } from "@/shared/ui";
import { ChevronLeft, ChevronRight, ClipboardCopy } from "lucide-react";
import type { CSSProperties, RefObject } from "react";
import { LibraryStackChips, LibraryStackEffectChips } from "./LibraryStackChips";

const arrowClass =
  "absolute top-1/2 z-20 grid size-10 -translate-y-1/2 place-items-center rounded-full border border-charcoal-border/10 bg-charcoal-workspace text-cream-bright disabled:opacity-20";

export interface LibraryViewerStageProps {
  displayName: string;
  mimeType: string;
  contentUrl: string;
  contentLoading: boolean;
  contentError: string;
  mediaStyle: CSSProperties | undefined;
  assetStack: LibraryAssetStack | null;
  stackMediaID: string;
  primaryItemID: string;
  canEdit: boolean;
  canCopy: boolean;
  index: number;
  itemCount: number;
  imageRef: RefObject<HTMLImageElement | null>;
  videoRef: RefObject<HTMLVideoElement | null>;
  onSelectStackMember: (itemId: string) => void;
  onSetStackEffect: (effect: LibraryAssetStack["effect"]) => void;
  onVideoEnded: () => void;
  onVideoTime: () => void;
  onCopyStackMedia: () => void;
  onPrevious: () => void;
  onNext: () => void;
}

/** The media half of the viewer: the preview, stack chips and paging arrows. */
export function LibraryViewerStage(props: LibraryViewerStageProps) {
  const { assetStack, index, itemCount } = props;

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
          autoPlay={assetStack?.kind === "live_photo"}
          loop={assetStack?.kind === "live_photo" && assetStack.effect === "loop"}
          onVideoEnded={props.onVideoEnded}
          onVideoMetadata={props.onVideoTime}
          onVideoTime={props.onVideoTime}
          fallbackAction={
            props.canCopy ? (
              <Button size="sm" variant="outline" type="button" onClick={props.onCopyStackMedia}>
                <ClipboardCopy size={14} />
                Copy
              </Button>
            ) : undefined
          }
        />
      </div>

      {assetStack ? (
        <LibraryStackChips
          stack={assetStack}
          activeItemID={props.stackMediaID}
          primaryItemID={props.primaryItemID}
          onSelect={props.onSelectStackMember}
        />
      ) : null}
      {props.canEdit && assetStack?.kind === "live_photo" ? (
        <LibraryStackEffectChips stack={assetStack} onSelect={props.onSetStackEffect} />
      ) : null}

      {itemCount > 1 ? (
        <>
          <Button
            className={`${arrowClass} left-4`}
            type="button"
            disabled={index <= 0}
            onClick={props.onPrevious}
            aria-label="Previous item"
          >
            <ChevronLeft size={20} />
          </Button>
          <Button
            className={`${arrowClass} right-4`}
            type="button"
            disabled={index < 0 || index >= itemCount - 1}
            onClick={props.onNext}
            aria-label="Next item"
          >
            <ChevronRight size={20} />
          </Button>
        </>
      ) : null}
    </div>
  );
}
