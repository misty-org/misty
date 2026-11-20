import { useNavigate } from "react-router-dom";
import { useAuth } from "@/features/account";
import { useWorkspaceViewTitle } from "@/features/app-windows";
import { SetupState, Skeleton, Surface, EmptyState } from "@misty/ui";
import { useSpacesStore } from "../list/useSpacesStore";
import type { SpaceDeck } from "./api";
import { DeckEditor } from "./editor/DeckEditor";
import { useDeckRoom, type DeckUser } from "./hooks/useDeckRoom";
import { useSpaceDecks } from "./hooks/useSpaceDecks";

export interface SpaceSlidesProps {
  spaceId: string;
  deckId: string;
  workspaceTabId?: string;
}

/** The Slides page for one deck: the editor once its live room has joined. */
export function SpaceSlides(props: SpaceSlidesProps) {
  const { user } = useAuth();
  const readOnly = useSpacesStore((state) => state.referenceOnly);
  const decks = useSpaceDecks(props.spaceId);
  const navigate = useNavigate();
  const deck = decks.decks.find((item) => item.id === props.deckId);
  useWorkspaceViewTitle(props.workspaceTabId, deck?.title?.trim() || "Slides");
  const back = () => navigate(`/spaces/${encodeURIComponent(props.spaceId)}/slides`);

  if (!user)
    return <EmptyState title="Sign in to open slides" line="Sign in to make decks with others." />;
  if (!deck && decks.loading) return <DeckSkeleton />;
  if (!deck && decks.error)
    return (
      <EmptyState
        title="Slides are unavailable"
        line="They couldn't be loaded. Try again."
        action={{ label: "Try again", variant: "secondary", onClick: () => void decks.reload() }}
      />
    );
  if (!deck)
    return (
      <EmptyState
        title="This deck isn’t here"
        line="It may have been deleted, or you may no longer have access."
        action={{ label: "Back to slides", variant: "secondary", onClick: back }}
      />
    );
  return (
    <DeckWorkspace
      key={deck.id}
      deck={deck}
      user={user}
      readOnly={readOnly}
      onBack={back}
      onRename={(title) => decks.rename(deck.id, title).then(() => undefined)}
      onDelete={async () => {
        await decks.remove(deck.id);
        back();
      }}
    />
  );
}

function DeckWorkspace(props: {
  deck: SpaceDeck;
  user: DeckUser;
  readOnly: boolean;
  onBack(): void;
  onRename(title: string): Promise<void>;
  onDelete(): Promise<void>;
}) {
  const room = useDeckRoom(props.deck.space_id, props.deck.id, props.user);
  if (room.error)
    return (
      <SetupState tool="deck" error="The live deck couldn't be opened." onRetry={room.retry} />
    );
  if (!room.session || !room.synced)
    return (
      <SetupState
        tool="deck"
        label="Joining the deck"
        error={
          room.connection === "error"
            ? "The live deck couldn't be reached. Check your connection."
            : null
        }
        onRetry={room.retry}
      />
    );
  return (
    <div className="relative h-full min-h-0">
      <DeckEditor
        deck={props.deck}
        session={room.session}
        user={props.user}
        role={room.role ?? props.deck.role}
        readOnly={props.readOnly}
        onBack={props.onBack}
        onRename={props.onRename}
        onDelete={props.onDelete}
      />
      {room.notice ? (
        <Surface
          tone="card"
          edge="hairline"
          radius="md"
          role="status"
          className="absolute inset-x-0 top-14 z-30 mx-auto w-fit max-w-xl px-3 py-2 text-control"
        >
          {room.notice}
        </Surface>
      ) : null}
    </div>
  );
}

/** The deck page's shape while its list first loads: the bar, the thumbnails and the slide. */
function DeckSkeleton() {
  return (
    <Surface
      tone="page"
      className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)]"
      aria-hidden="true"
    >
      <div className="flex h-12 items-center gap-2 border-b px-3">
        <Skeleton className="h-5 w-48" />
        <Skeleton className="ml-auto h-8 w-24" />
      </div>
      <div className="grid min-h-0 grid-cols-[auto_minmax(0,1fr)]">
        <div className="flex w-46 flex-col gap-2.5 px-3 pt-3 pl-8">
          {[0, 1, 2, 3].map((index) => (
            <Skeleton key={index} className="aspect-video w-full" />
          ))}
        </div>
        <div className="grid place-items-center px-9 pt-7 pb-12">
          <Skeleton className="aspect-video w-full max-w-5xl" />
        </div>
      </div>
    </Surface>
  );
}
