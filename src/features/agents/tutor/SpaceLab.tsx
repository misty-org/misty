import { Settings2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { openSettings } from "@/features/settings";
import {
  CollectionHeading,
  CollectionPage,
  EmptyState,
  ErrorState,
  HomeSection,
  spaceHomeClass,
  Surface,
} from "@misty/ui";
import { defaultEngineAgent, useDefaultEngine } from "../engines/defaultEngine";
import { NotebookCardsSkeleton } from "./TutorHome";
import { TutorPage } from "./TutorPage";

/**
 * The Lab as a page of a Space (`/spaces/:id/lab`): its notebooks are this Space's, and all its
 * work runs on the default engine, with no agent chat behind it. Until there's a default engine,
 * it says where to pick one.
 */
/** The Lab in its first-load shape, framed as its home is: its bar over the notebooks' cards. */
export function SpaceLabSkeleton() {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col" aria-busy="true">
      <Surface tone="sidebar" className="shrink-0">
        <CollectionHeading title="Lab" />
      </Surface>
      <Surface tone="page" className="flex min-h-0 min-w-0 flex-1 flex-col">
        <CollectionPage className="flex-1">
          <div className={spaceHomeClass}>
            <HomeSection title="Notebooks">
              <NotebookCardsSkeleton />
            </HomeSection>
          </div>
        </CollectionPage>
      </Surface>
    </div>
  );
}

export function SpaceLab({ spaceId }: { spaceId: string }) {
  const navigate = useNavigate();
  const { engine, ready, failed, retry } = useDefaultEngine();
  if (failed)
    return (
      <ErrorState
        title="Couldn't read your engines"
        line="Something went wrong on this computer. Try again in a moment."
        action={{ label: "Try again", onClick: retry }}
      />
    );
  if (!ready) return <SpaceLabSkeleton />;
  if (!engine)
    return (
      <EmptyState
        title="Pick a default engine"
        line="The Lab runs on the engine you pick in Settings."
        action={{
          label: "Open settings",
          icon: Settings2,
          onClick: () => openSettings("models"),
        }}
      />
    );
  return (
    <TutorPage
      agentId={defaultEngineAgent(engine.id) ?? engine.id}
      agentSpaceId={spaceId}
      onLesson={(agentId, conversationId) =>
        navigate(`/agents?${new URLSearchParams({ agent: agentId, conversation: conversationId })}`)
      }
      onLearn={() => undefined}
    />
  );
}
