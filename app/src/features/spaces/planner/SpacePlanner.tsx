export type { DueFilter, TaskViewMode } from "@/api/spaces/dto/types/SpacePlanner";
import { useAuth } from "@/features/auth";
import {
  useAiSurfaceAdapter,
  type AiContextReference,
  type AiSurfaceAdapter,
} from "@/features/ai-surface/AiPaneHost";
import { useSpacePanelRoute, useSpacesStore } from "@/features/spaces";
import { SpaceRoadmapWorkspace } from "@/features/spaces/roadmap";
import { useWorkspaceTabTitle } from "@/features/workspace";
import type {
  SpaceAgentMembership,
  SpaceMember,
  SpaceTask,
} from "@/api/spaces/dto/interfaces/types";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/shared/ui";
import { useEffect, useMemo, useRef, useState } from "react";
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
  return (
    <SpaceTasksPlanner spaceId={spaceId} canManage={canManage} workspaceTabId={workspaceTabId} />
  );
}

function SpaceTasksPlanner({
  spaceId,
  canManage,
  workspaceTabId,
}: {
  spaceId: string;
  canManage: boolean;
  workspaceTabId?: string;
}) {
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
  const [deleteTarget, setDeleteTarget] = useState<SpaceTask | null>(null);
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
  useWorkspaceTabTitle(
    workspaceTabId,
    actions.editing?.title?.trim() || (view === "list" ? "Task list" : "Task board"),
  );
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
        view={view}
        onViewChange={(nextView) =>
          navigate({
            pathname: `/spaces/${encodeURIComponent(spaceId)}/planner/tasks/${nextView}`,
            search: location.search,
          })
        }
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
        onDeleteRequest={setDeleteTarget}
      />

      {actions.editing !== undefined ? (
        <SpaceTaskDrawer
          draft={actions.draft}
          setDraft={actions.setDraft}
          editing={actions.editing}
          members={members}
          agents={agents}
          busy={actions.busy === "task" || actions.busy === actions.editing?.id}
          canManage={canManage}
          onClose={() => actions.setEditing(undefined)}
          onSave={actions.save}
          onArchive={actions.editing ? () => setDeleteTarget(actions.editing!) : undefined}
        />
      ) : null}

      <TaskDeleteDialog
        task={deleteTarget}
        busy={Boolean(deleteTarget && actions.busy === deleteTarget.id)}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        onConfirm={async () => {
          if (!deleteTarget) return false;
          return actions.archive(deleteTarget);
        }}
      />
    </div>
  );
}

function TaskDeleteDialog(props: {
  task: SpaceTask | null;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => Promise<boolean>;
}) {
  const [error, setError] = useState("");

  useEffect(() => {
    setError("");
  }, [props.task?.id]);

  const remove = async () => {
    if (props.busy) return;
    setError("");
    const removed = await props.onConfirm();
    if (removed) props.onOpenChange(false);
    else setError("This task could not be deleted. Try again.");
  };

  return (
    <AlertDialog
      open={Boolean(props.task)}
      onOpenChange={(open) => {
        if (!props.busy) props.onOpenChange(open);
      }}
    >
      <AlertDialogContent className="max-w-sm">
        <AlertDialogHeader>
          <AlertDialogTitle>Delete task?</AlertDialogTitle>
          <AlertDialogDescription className="break-words">
            “{props.task?.title || "Untitled task"}” will be removed from Tasks. This action cannot
            be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error ? (
          <p className="m-0 text-sm text-notification-red" role="alert">
            {error}
          </p>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={props.busy}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className="bg-notification-red text-white hover:bg-notification-red/90"
            disabled={props.busy}
            onClick={(event) => {
              event.preventDefault();
              void remove();
            }}
          >
            {props.busy ? "Deleting…" : "Delete"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
