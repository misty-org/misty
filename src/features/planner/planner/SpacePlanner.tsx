import { useLocation, useNavigate } from "react-router-dom";
import { Button } from "@/shared/ui";
import { ArrowLeft } from "lucide-react";
import { PlannerCollection } from "./PlannerCollection";
export type { DueFilter, TaskViewMode } from "@/api/spaces/dto/types/SpacePlanner";
import { useSpacePanelRoute } from "@/features/spaces";
import { SpaceRoadmapWorkspace } from "@/features/planner/roadmap";
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
  const location = useLocation();
  const navigate = useNavigate();
  const route = useSpacePanelRoute();
  const section = location.pathname.split("/")[4];
  if (!section) return <PlannerCollection key={spaceId} spaceId={spaceId} canManage={canManage} />;
  const wrap = (content: React.ReactNode) => (
    <div className="flex h-full min-h-0 flex-col">
      <div className="px-3 py-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() =>
            navigate(
              `/spaces/${encodeURIComponent(spaceId)}/planner${route.plannerSection === "tasks" ? "" : `?section=${route.plannerSection}`}`,
            )
          }
        >
          <ArrowLeft />
          Planner
        </Button>
      </div>
      <div className="min-h-0 flex-1">{content}</div>
    </div>
  );
  if (route.plannerSection === "agenda") {
    return wrap(
      <SpaceAgenda
        spaceId={spaceId}
        view={route.agendaView}
        canManage={canManage}
        canManageIntegrations={canManageIntegrations}
        workspaceTabId={workspaceTabId}
      />,
    );
  }
  if (
    route.plannerSection === "roadmaps" ||
    route.plannerSection === "goals" ||
    route.plannerSection === "milestones"
  ) {
    return wrap(
      <SpaceRoadmapWorkspace
        spaceId={spaceId}
        roadmapId={route.plannerSection === "roadmaps" ? route.roadmapId : ""}
        canManage={canManage}
        workspaceTabId={workspaceTabId}
      />,
    );
  }
  return wrap(
    <HostSpaceTasks spaceId={spaceId} canManage={canManage} workspaceTabId={workspaceTabId} />,
  );
}
