import { ErrorState, ListRowSkeleton, PaneLoading, SetupState } from "@misty/ui";
import { SpaceLabSkeleton } from "@/features/agents";
import { ConversationLoadState } from "../chat/components/ConversationStates";

/** Which page of a Space is on its way, so its placeholder takes that page's shape. */
export interface SpacePageShape {
  section: string;
}

/**
 * Stands in for a Space page while it first loads: the Space being read, or the page's own code
 * arriving just before its data does. Either way it draws the page's own placeholder (`shape`): a
 * skeleton where the page's shape is known, a spinner where it isn't. A retry offer replaces it
 * once the Space's read has failed, and switching accounts (`label`) says so in words.
 */
export function SpacePageLoadingPlaceholder(props: {
  label?: string;
  onRetry?: () => void;
  shape?: SpacePageShape;
}) {
  // These callers supply retry only after a request has failed.
  if (props.onRetry) {
    return (
      <ErrorState
        title="Spaces could not be loaded"
        action={{ label: "Try again", onClick: props.onRetry }}
      />
    );
  }
  if (!props.shape) return <SetupState tool="account switch" label={props.label} />;
  return <SpacePageSkeleton {...props.shape} />;
}

function SpacePageSkeleton({ section }: SpacePageShape) {
  switch (section) {
    // A Space's own address opens its chat.
    case "home":
    case "settings":
    case "social":
    case "chat":
      return <ConversationLoadState error="" onRetry={() => undefined} />;
    case "files":
      // The Space drives, as Files lists them.
      return (
        <div className="mx-auto grid w-full max-w-xl gap-4 p-6">
          <ListRowSkeleton label="Files" rows={2} state />
        </div>
      );
    case "lab":
      return <SpaceLabSkeleton />;
    default:
      // Any other page: its shape isn't known here, so one spinner in its middle.
      return <PaneLoading label="Loading page" />;
  }
}
