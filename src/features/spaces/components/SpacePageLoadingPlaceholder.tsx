import {
  CollectionHeading,
  CollectionPage,
  CollectionSkeleton,
  ErrorState,
  PageHeader,
  SetupState,
  Skeleton,
  SkeletonControl,
  Surface,
} from "@/shared/ui";
import { SpaceLabSkeleton } from "@/features/agents";
import { ConversationLoadState } from "../chat/components/ConversationStates";
import { SpaceHomeSkeleton } from "../home/SpaceHomeSkeleton";
import { DrawingCanvasSkeleton } from "../journal/drawings/components/DrawingCanvasSkeleton";
import { NoteDocumentSkeleton } from "../journal/notes/components/NoteDocumentSkeleton";
import { LibraryItemsSkeleton } from "../library/components/LibraryItemSkeletons";
import { boardColumns } from "../planner/taskOrdering";

/** Which page of a Space is on its way, so its placeholder takes that page's shape. */
export interface SpacePageShape {
  section: string;
  /** The page opens one item (a doc, a drawing) rather than the list of them. */
  item?: boolean;
}

/**
 * Stands in for a Space page while it first loads: the Space being read, or the page's own code
 * arriving just before its data does. Either way it draws the page's skeleton (`shape`), so the
 * page never flashes blank between the two. A retry offer replaces it once the Space's read has
 * failed, and switching accounts (`label`) says so in words.
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
    // A deck or workbook is an editor getting ready, said in words; their lists are the home's.
    case "slides":
      return item ? <SetupState tool="deck" size="pane" /> : <JournalSkeleton />;
    case "data":
      return item ? <SetupState tool="data editor" size="pane" /> : <JournalSkeleton />;
    case "drawings":
      return item ? (
        <DrawingCanvasSkeleton label="Opening whiteboard" header />
      ) : (
        <JournalSkeleton />
      );
    case "media":
      return (
        <CollectionPage>
          <CollectionHeading title={<Skeleton className="h-4 w-24" />} />
          <LibraryItemsSkeleton view="grid" scale={1} />
        </CollectionPage>
      );
    case "planner":
      return <PlannerSkeleton />;
    case "calendar":
      return <CalendarSkeleton />;
    case "lab":
      return <SpaceLabSkeleton />;
    default:
      // Any other page: its top bar over a list of rows.
      return (
        <CollectionPage aria-busy="true">
          <CollectionHeading title={<Skeleton className="h-4 w-24" />} />
          <CollectionSkeleton label="Loading page" view="list" icons />
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

/** The planner: its bar with search and New task, over the board's columns of cards. */
function PlannerSkeleton() {
  return (
    <Surface
      tone="page"
      className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)]"
      aria-busy="true"
    >
      <PageHeader
        title={<Skeleton className="h-4 w-24" />}
        end={
          <>
            <SkeletonControl kind="field" className="w-56" />
            <SkeletonControl kind="button" className="w-24" />
          </>
        }
      />
      <div className="flex h-full min-h-0 overflow-hidden" aria-hidden="true">
        {boardColumns.map((column) => (
          <div
            key={column.id}
            className="flex h-full min-h-0 min-w-64 flex-1 basis-0 flex-col border-r px-3 py-2 last:border-r-0"
          >
            <div className="flex min-h-10 items-center gap-2 px-1">
              <Skeleton className="h-3 w-16" />
              <SkeletonControl kind="icon" className="ml-auto" />
            </div>
            <div className="grid content-start gap-2">
              <Skeleton className="h-20 rounded-lg" />
              <Skeleton className="h-20 rounded-lg" />
            </div>
          </div>
        ))}
      </div>
    </Surface>
  );
}

/** The calendar: its bar with New event, the month's controls, then the month's six weeks. */
function CalendarSkeleton() {
  return (
    <Surface
      tone="page"
      className="grid h-full min-h-0 grid-rows-[auto_auto_minmax(0,1fr)]"
      aria-busy="true"
    >
      <PageHeader
        title={<Skeleton className="h-4 w-24" />}
        end={<SkeletonControl kind="button" className="w-28" />}
      />
      <div className="flex min-h-12 min-w-0 items-center gap-2 px-4 py-1.5" aria-hidden="true">
        <SkeletonControl kind="icon" />
        <SkeletonControl kind="icon" />
        <div className="flex min-w-32 items-center">
          <Skeleton className="h-3.5 w-28" />
        </div>
        <SkeletonControl kind="button" className="w-16" />
        <SkeletonControl kind="select" className="ml-auto w-36" />
      </div>
      <div className="min-h-0 overflow-hidden" aria-hidden="true">
        <div className="grid h-full min-h-0 min-w-160 grid-rows-[auto_minmax(0,1fr)]">
          <div className="grid grid-cols-7 border-b">
            {Array.from({ length: 7 }, (_, day) => (
              <div key={day} className="flex h-7 items-center justify-center">
                <Skeleton className="h-2.5 w-6" />
              </div>
            ))}
          </div>
          <div className="grid min-h-0 grid-cols-7 grid-rows-6">
            {Array.from({ length: 42 }, (_, day) => (
              <div key={day} className="border-b border-r p-1 [&:nth-child(7n)]:border-r-0">
                <div className="flex h-6 items-center justify-center">
                  <Skeleton className="size-4 rounded-sm" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Surface>
  );
}
