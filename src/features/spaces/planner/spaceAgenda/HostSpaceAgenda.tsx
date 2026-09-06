import { useCallback } from "react";
import { spacesApi } from "@/api/spaces/api";
import { connectionsApi } from "@/api/connections";
import type { SpaceAgentMembership, SpaceMember } from "@/api/spaces/dto/interfaces/types";
import { useAuth } from "@/features/auth";
import { useSpaceAgendaPreferences, useSpacesStore } from "@/features/spaces";
import { useAiSurfaceAdapter } from "@/features/ai-surface/AiPaneHost";
import { useWorkspaceTabTitle } from "@/features/workspace";
import { SystemErrorActivity } from "@/features/activity";
import { confirmAction } from "@/shared/lib/confirmAction";
import { openProviderAuthorizationLink } from "@/shared/platform/openExternalLink";
import { SpaceAgendaView } from "../SpaceAgendaView";
import type { AgendaView } from "./agendaDates";
import type { PlannerTaskIntegration } from "../spaceTasks/taskRuntime";

const emptyMembers: SpaceMember[] = [];
const emptyAgents: SpaceAgentMembership[] = [];

/** Host-only adapter retained until the entire Planner package is migrated. */
export function HostSpaceAgenda(props: {
  spaceId: string;
  view: AgendaView;
  canManage: boolean;
  canManageIntegrations?: boolean;
  workspaceTabId?: string;
}) {
  const { user } = useAuth();
  const members = useSpacesStore((state) => state.membersBySpace[props.spaceId] ?? emptyMembers);
  const agents = useSpacesStore(
    (state) => state.agentMembershipsBySpace[props.spaceId] ?? emptyAgents,
  );
  const preferences = useSpaceAgendaPreferences(user?.id ?? "", props.spaceId);
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
    <SpaceAgendaView
      {...props}
      runtime={{
        api: spacesApi,
        connections: connectionsApi,
        members,
        agents,
        ...preferences,
        subscribeChanges,
        confirm: confirmAction,
        openAuthorization: async (url) => {
          await openProviderAuthorizationLink(url);
        },
        renderIntegration: (input) => (
          <HostAgendaIntegration {...input} workspaceTabId={props.workspaceTabId} />
        ),
        renderError: (error) => (
          <SystemErrorActivity
            accountId={user?.id}
            error={error}
            scope={`planner:agenda:${props.spaceId}`}
            title="Agenda could not be refreshed"
            target={{
              kind: "route",
              href: `/spaces/${encodeURIComponent(props.spaceId)}/planner/agenda/${props.view}`,
            }}
          />
        ),
      }}
    />
  );
}
function HostAgendaIntegration(
  props: Pick<PlannerTaskIntegration, "title" | "adapter"> & { workspaceTabId?: string },
) {
  useAiSurfaceAdapter(props.adapter);
  useWorkspaceTabTitle(props.workspaceTabId, props.title);
  return null;
}
