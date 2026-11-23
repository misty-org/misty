import { ErrorState, ListRowSkeleton, PaneLoading, SetupState } from "@misty/ui";
import { ConversationLoadState } from "../chat/components/ConversationStates";

export interface SpacePageShape {
  section: string;
}

export function SpacePageLoadingPlaceholder(props: {
  label?: string;
  onRetry?: () => void;
  shape?: SpacePageShape;
}) {
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
    case "home":
    case "settings":
    case "social":
    case "chat":
      return <ConversationLoadState error="" onRetry={() => undefined} />;
    case "files":
      return (
        <div className="mx-auto grid w-full max-w-xl gap-4 p-6">
          <ListRowSkeleton label="Files" rows={2} state />
        </div>
      );
    default:
      return <PaneLoading label="Loading page" />;
  }
}
