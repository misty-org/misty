export type { DueFilter, TaskViewMode } from "@/api/spaces/dto/types/SpacePlanner";
import { useAuth } from "@/features/auth";
import {
  useAiSurfaceAdapter,
  type AiContextReference,
  type AiSurfaceAdapter,
} from "@/features/ai-surface/AiPaneHost";
import { SpaceRoadmapItemsWorkspace, SpaceRoadmapWorkspace } from "@/features/spaces/roadmap";
import { useSpacePanelRoute, useSpacesStore } from "@/features/spaces";
import type { SpaceAgentMembership, SpaceMember } from "@/api/spaces/dto/interfaces/types";
import { useEffect, useMemo, useRef } from "react";
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
  const reloadTasks = data.load;
  const aiAdapter = useMemo<AiSurfaceAdapter>(() => {
    const metadata: Record<string, string> = { sort: filters.sort };
    if (filters.status !== "all") metadata.status = filters.status;
    if (filters.priority !== "all") metadata.priority = filters.priority;
    if (filters.query.trim()) metadata.search = filters.query.trim();
    if (filters.effectiveAssignee.startsWith("person:"))
      metadata.assignee_user_id = filters.effectiveAssignee.slice(7);
    if (filters.effectiveAssignee.startsWith("agent:"))
      metadata.assignee_agent_id = filters.effectiveAssignee.slice(6);
    if (filters.dueRange?.from) metadata.due_from = filters.dueRange.from;
    if (filters.dueRange?.to) metadata.due_to = filters.dueRange.to;
    const visible: AiContextReference = {
      kind: "planner.query",
      id: spaceId,
      title: filters.activeFilterCount
        ? `Visible tasks (${filters.activeFilterCount} filters)`
        : "Visible tasks",
      privacy: "shared",
      spaceId,
      metadata,
    };
    const selected = actions.editing
      ? ({
          kind: "task",
          id: actions.editing.id,
          title: actions.editing.title,
          privacy: "shared",
          spaceId,
          revision: actions.editing.version,
        } satisfies AiContextReference)
      : null;
    return {
      surfaceId: "planner.tasks",
      label: selected?.title ?? "visible tasks",
      getContext: () => (selected ? [selected, visible] : [visible]),
      getSuggestedActions: () => [
        {
          id: "planner.status",
          label: "Summarize status",
          prompt: "Summarize status, progress, risks, and blockers across these visible tasks.",
          trigger: "object",
        },
        {
          id: "planner.risks",
          label: "Identify risks",
          prompt:
            "Identify delivery risks, bottlenecks, and tasks that need attention in this visible plan.",
          trigger: "object",
        },
        ...(canManage
          ? [
              {
                id: "planner.breakdown",
                label: "Draft task breakdown",
                prompt:
                  "Draft a concrete, non-duplicative task breakdown that complements the visible plan.",
                trigger: "object" as const,
                requestedArtifactKind: "task_set" as const,
              },
            ]
          : []),
      ],
      onArtifactApplied: (artifact) => {
        if (artifact.kind === "task_set") void reloadTasks(false);
      },
      openCitation: (citation) =>
        window.dispatchEvent(new CustomEvent("misty:open-ai-citation", { detail: citation })),
    };
  }, [
    actions.editing,
    canManage,
    reloadTasks,
    filters.activeFilterCount,
    filters.dueRange?.from,
    filters.dueRange?.to,
    filters.effectiveAssignee,
    filters.priority,
    filters.query,
    filters.sort,
    filters.status,
    spaceId,
  ]);
  useAiSurfaceAdapter(aiAdapter);
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
