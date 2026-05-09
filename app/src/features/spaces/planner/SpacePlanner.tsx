export type { DueFilter, TaskViewMode } from "@/api/spaces/dto/types/SpacePlanner";
import { useAuth } from "@/features/auth";
import { SpaceRoadmapItemsWorkspace, SpaceRoadmapWorkspace } from "@/features/spaces/roadmap";
import { useSpacePanelRoute, useSpacesStore } from "@/features/spaces";
import type { SpaceAgentMembership, SpaceMember } from "@/api/spaces/dto/interfaces/types";
import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { SpaceAgenda } from "./SpaceAgenda";
import { SpaceTaskDrawer } from "./SpacePlannerViews";
import { SpacePlannerHeader } from "./components/SpacePlannerHeader";
import { SpacePlannerBody } from "./spaceTasks/SpacePlannerBody";
import { TaskFilters } from "./spaceTasks/TaskFilters";
import { normalizeView } from "./spaceTasks/taskFiltering";
import { useCreateTaskShortcut } from "./spaceTasks/useCreateTaskShortcut";
import { useSpaceTaskActions } from "./spaceTasks/useSpaceTaskActions";
import { useSpaceTasksData } from "./spaceTasks/useSpaceTasksData";
import { useTaskFilterParams } from "./spaceTasks/useTaskFilterParams";

const emptyMembers: SpaceMember[] = [];
const emptyAgents: SpaceAgentMembership[] = [];

export function SpacePlanner({
  spaceId,
  canManage,
}: {
  spaceId: string;
  canManage: boolean;
  canManageIntegrations: boolean;
}) {
  const route = useSpacePanelRoute();
  if (route.plannerSection === "agenda") {
    return <SpaceAgenda spaceId={spaceId} view={route.agendaView} canManage={canManage} />;
  }
  if (route.plannerSection === "roadmaps") {
    return (
      <SpaceRoadmapWorkspace spaceId={spaceId} roadmapId={route.roadmapId} canManage={canManage} />
    );
  }
  if (route.plannerSection === "goals" || route.plannerSection === "milestones") {
    return (
      <SpaceRoadmapItemsWorkspace
        spaceId={spaceId}
        kind={route.plannerSection === "goals" ? "goal" : "milestone"}
        canManage={canManage}
      />
    );
  }
  return <SpaceTasksPlanner spaceId={spaceId} canManage={canManage} />;
}

function SpaceTasksPlanner({ spaceId, canManage }: { spaceId: string; canManage: boolean }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const members = useSpacesStore((state) => state.membersBySpace[spaceId] ?? emptyMembers);
  const agents = useSpacesStore((state) => state.agentMembershipsBySpace[spaceId] ?? emptyAgents);
  const routeParts = location.pathname.split("/").filter(Boolean);
  const view = normalizeView(routeParts[routeParts.length - 1]);

  const filters = useTaskFilterParams({ view, currentUserId: user?.id });
  const data = useSpaceTasksData({ spaceId, view, filters });
  const actions = useSpaceTaskActions({ spaceId, canManage, data });
  const createQueryConsumedRef = useRef(false);

  const openCreate = actions.openCreate;
  const openEdit = actions.openEdit;
  useCreateTaskShortcut(canManage, openCreate);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get("create") !== "task") {
      createQueryConsumedRef.current = false;
      return;
    }
    if (createQueryConsumedRef.current) return;
    createQueryConsumedRef.current = true;
    params.delete("create");
    navigate(
      { pathname: location.pathname, search: params.size ? `?${params}` : "" },
      { replace: true },
    );
    if (canManage) openCreate();
  }, [canManage, location.pathname, location.search, navigate, openCreate]);

  useEffect(() => {
    const taskId = new URLSearchParams(location.search).get("task");
    if (!taskId || data.loading) return;
    const task = data.tasks.find((item) => item.id === taskId);
    if (!task) return;
    openEdit(task);
    const params = new URLSearchParams(location.search);
    params.delete("task");
    navigate(
      { pathname: location.pathname, search: params.size ? `?${params}` : "" },
      { replace: true },
    );
  }, [data.loading, data.tasks, location.pathname, location.search, navigate, openEdit]);

  return (
    <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] bg-charcoal-bg">
      <SpacePlannerHeader
        query={filters.query}
        activeFilterCount={filters.activeFilterCount}
        loading={data.loading}
        canManage={canManage}
        onQuery={(value: string) => filters.updateParam("q", value)}
        onSync={() => void data.load(false)}
        onCreate={openCreate}
        filters={
          <TaskFilters
            members={members}
            agents={agents}
            status={filters.status}
            assignee={filters.assignee}
            priority={filters.priority}
            due={filters.due}
            mine={filters.mine}
            sort={filters.sort}
            onChange={filters.updateParam}
            onClear={filters.clearFilters}
          />
        }
      />

      <SpacePlannerBody
        view={view}
        members={members}
        agents={agents}
        canManage={canManage}
        assignee={filters.assignee}
        due={filters.due}
        data={data}
        actions={actions}
      />

      {actions.editing !== undefined ? (
        <SpaceTaskDrawer
          spaceId={spaceId}
          draft={actions.draft}
          setDraft={actions.setDraft}
          editing={actions.editing}
          members={members}
          agents={agents}
          busy={actions.busy === "task" || actions.busy === actions.editing?.id}
          canManage={canManage}
          onClose={() => actions.setEditing(undefined)}
          onSave={actions.save}
          onArchive={actions.editing ? () => void actions.archive(actions.editing!) : undefined}
        />
      ) : null}
    </div>
  );
}
