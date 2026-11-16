import { Settings2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { openSettings } from "@/features/settings";
import { EmptyState } from "@/shared/ui";
import { defaultEngineAgent, useDefaultEngine } from "../engines/defaultEngine";
import { TutorPage } from "./TutorPage";

/**
 * The Lab as a page of a Space (`/spaces/:id/lab`): its notebooks are this Space's, and all its
 * work runs on the default engine, with no agent chat behind it. Until there's a default engine,
 * it says where to pick one.
 */
export function SpaceLab({ spaceId }: { spaceId: string }) {
  const navigate = useNavigate();
  const { engine, ready } = useDefaultEngine();
  if (!ready) return null;
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
