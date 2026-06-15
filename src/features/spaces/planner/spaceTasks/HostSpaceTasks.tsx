import { useCallback, useMemo } from "react";
import { spacesApi } from "@/api/spaces/api";
import type { SpaceAgentMembership, SpaceMember } from "@/api/spaces/dto/interfaces/types";
import { useAuth } from "@/features/auth";
import { useSpacesStore } from "@/features/spaces";
import { SystemErrorActivity } from "@/features/activity";
import { useAiSurfaceAdapter } from "@/features/ai-surface/AiPaneHost";
import { useWorkspaceTabTitle } from "@/features/workspace";
import { SpaceTasksView } from "../SpaceTasksView";
import { useCreateTaskShortcut } from "./useCreateTaskShortcut";
import type { PlannerTaskIntegration } from "./taskRuntime";

const emptyMembers: SpaceMember[] = [];
const emptyAgents: SpaceAgentMembership[] = [];

/** Transitional embedded route. The downloadable task UI imports only SpaceTasksView. */
export function HostSpaceTasks(props: {
  spaceId: string;
  canManage: boolean;
  workspaceTabId?: string;
}) {
  const { user } = useAuth();
  const members = useSpacesStore((state) => state.membersBySpace[props.spaceId] ?? emptyMembers);
  const agents = useSpacesStore(
    (state) => state.agentMembershipsBySpace[props.spaceId] ?? emptyAgents,
  );
  const subscribeChanges = useCallback(
    (listener: () => void) => {
      const receive = (event: Event) => {
        if ((event as CustomEvent<{ space_id?: string }>).detail?.space_id === props.spaceId)
          listener();
      };
      window.addEventListener("misty:space-coordination-event", receive);
      return () => window.removeEventListener("misty:space-coordination-event", receive);
    },
    [props.spaceId],
  );
  return (
    <SpaceTasksView
      spaceId={props.spaceId}
      canManage={props.canManage}
      runtime={{
        api: spacesApi,
        userId: user?.id,
        members,
        agents,
        subscribeChanges,
        renderIntegration: (input) => (
          <HostTaskIntegration {...input} workspaceTabId={props.workspaceTabId} />
        ),
        renderError: (message) => (
          <SystemErrorActivity
            error={message}
            scope="planner:tasks"
            title="Tasks could not be loaded"
          />
        ),
      }}
    />
  );
}

function HostTaskIntegration(props: PlannerTaskIntegration & { workspaceTabId?: string }) {
  const adapter = useMemo(
    () => ({
      ...props.adapter,
      openCitation: (citation: import("@misty/sdk").MistyAiCitation) => {
        window.dispatchEvent(new CustomEvent("misty:open-ai-citation", { detail: citation }));
      },
    }),
    [props.adapter],
  );
  useAiSurfaceAdapter(adapter);
  useWorkspaceTabTitle(props.workspaceTabId, props.title);
  useCreateTaskShortcut(props.canCreate, props.onCreate);
  return null;
}
