import {
  CollectionHeading,
  CollectionPage,
  CollectionSkeleton,
  ErrorState,
  Skeleton,
  Surface,
} from "@/shared/ui";
import { ConversationLoadState } from "../chat/components/ConversationStates";
import { SpaceHomeSkeleton } from "../home/SpaceHomeSkeleton";
import { DrawingCanvasSkeleton } from "../journal/drawings/components/DrawingCanvasSkeleton";
import { NoteDocumentSkeleton } from "../journal/notes/components/NoteDocumentSkeleton";
import { LibraryItemsSkeleton } from "../library/components/LibraryItemSkeletons";

/** Which page of a Space is on its way, so its placeholder takes that page's shape. */
export interface SpacePageShape {
  section: string;
  /** The page opens one item (a doc, a drawing) rather than the list of them. */
  item?: boolean;
}

/**
 * Stands in for a Space page. Only a true first load, the Space itself being read with nothing
 * saved, draws a skeleton, shaped like the page it opens (`shape`). A retry offer replaces it once
 * that read has failed. Waits that aren't a read, such as switching accounts or the page's own
 * code arriving, show the quiet page alone.
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
  if (!props.shape) return <Surface tone="page" className="h-full" aria-busy="true" />;
  return <SpacePageSkeleton {...props.shape} />;
}

function SpacePageSkeleton({ section, item = false }: SpacePageShape) {
  switch (section) {
    case "home":
    case "settings":
      return <SpaceHomeSkeleton />;
    case "social":
    case "chat":
      return <ConversationLoadState error="" onRetry={() => undefined} />;
    case "notes":
      return item ? (
        <NoteDocumentSkeleton label="Opening doc" toolbar className="h-full" />
      ) : (
        <JournalSkeleton />
      );
    case "drawings":
      return item ? <DrawingCanvasSkeleton label="Opening drawing" header /> : <JournalSkeleton />;
    case "library":
      return (
        <CollectionPage>
          <CollectionHeading title={<Skeleton className="h-4 w-24" />} />
          <LibraryItemsSkeleton view="grid" scale={1} />
        </CollectionPage>
      );
    default:
      // The planner and calendar: their top bar, with the board or month filling in below.
      return (
        <CollectionPage aria-busy="true">
          <CollectionHeading title={<Skeleton className="h-4 w-24" />} />
        </CollectionPage>
      );
  }
}

/** The Journal: the home's collection of docs and drawings, as rows with their icons. */
function JournalSkeleton() {
  return (
    <CollectionPage>
      <CollectionHeading title={<Skeleton className="h-4 w-16" />} />
      <CollectionSkeleton label="Loading journal" view="list" icons />
    </CollectionPage>
  );
}
