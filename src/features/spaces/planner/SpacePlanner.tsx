export type { DueFilter, TaskViewMode } from "@/api/spaces/dto/types/SpacePlanner";
import { useSpacePanelRoute } from "@/features/spaces";
import { SpaceRoadmapWorkspace } from "@/features/spaces/roadmap";
import { SpaceAgenda } from "./SpaceAgenda";
import { HostSpaceTasks } from "./spaceTasks/HostSpaceTasks";

export function SpacePlanner({
  spaceId,
  canManage,
  canManageIntegrations,
  workspaceTabId,
}: {
  spaceId: string;
  canManage: boolean;
  canManageIntegrations: boolean;
  workspaceTabId?: string;
}) {
  const route = useSpacePanelRoute();
  if (route.plannerSection === "agenda") {
    return (
      <SpaceAgenda
        spaceId={spaceId}
        view={route.agendaView}
        canManage={canManage}
        canManageIntegrations={canManageIntegrations}
        workspaceTabId={workspaceTabId}
      />
    );
  }
  if (
    route.plannerSection === "roadmaps" ||
    route.plannerSection === "goals" ||
    route.plannerSection === "milestones"
  ) {
    return (
      <SpaceRoadmapWorkspace
        spaceId={spaceId}
        roadmapId={route.plannerSection === "roadmaps" ? route.roadmapId : ""}
        canManage={canManage}
        workspaceTabId={workspaceTabId}
      />
    );
  }
  return <HostSpaceTasks spaceId={spaceId} canManage={canManage} workspaceTabId={workspaceTabId} />;
}
