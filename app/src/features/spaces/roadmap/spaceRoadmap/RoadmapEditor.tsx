import { spacesApi } from "@/api/spaces/api";
import type {
  SpaceRoadmapSaveState,
  SpaceRoadmapSnapshot,
} from "@/api/spaces/dto/interfaces/plannerExpansionTypes";
import type { SpaceTask } from "@/api/spaces/dto/interfaces/types";
import { SystemErrorActivity } from "@/features/activity";
import { Button } from "@/shared/ui";
import { useShortcutHandler } from "@/features/shortcuts";
import {
  ArrowLeft,
  Check,
  CircleAlert,
  LoaderCircle,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  RefreshCcw,
  X,
} from "lucide-react";
import { useCallback, useState, type Dispatch, type SetStateAction } from "react";
import type { NavigateFunction } from "react-router-dom";
import { RoadmapCanvas } from "./RoadmapCanvas";
import type { RoadmapNode } from "./RoadmapCanvasNodes";
import { RoadmapExecutionRail } from "./RoadmapExecutionRail";
import { RoadmapInspector } from "./RoadmapInspector";
import type { RoadmapPaletteItem } from "./roadmapNodeCatalog";
import { RoadmapNodeDrawer } from "./RoadmapNodeDrawer";
import { RoadmapOutline } from "./RoadmapOutline";
import { roadmapEndpoint } from "./RoadmapWorkspaceHelpers";

export type RoadmapMutation = <T>(
  action: (version: number) => Promise<T>,
  apply?: (current: SpaceRoadmapSnapshot, result: T) => SpaceRoadmapSnapshot,
  optimistic?: (current: SpaceRoadmapSnapshot) => SpaceRoadmapSnapshot,
) => Promise<void>;

export function RoadmapEditor(props: {
  spaceId: string;
  canManage: boolean;
  snapshot: SpaceRoadmapSnapshot;
  tasks: SpaceTask[];
  saveState: SpaceRoadmapSaveState;
  error: string;
  selectedId: string;
  expandedGoalIds: Set<string>;
  nodeDrawerOpen: boolean;
  placementRequest?: { paletteId: string; token: string };
  palette: RoadmapPaletteItem[];
  navigate: NavigateFunction;
  mutate: RoadmapMutation;
  load: () => Promise<void>;
  retrySave: () => Promise<void>;
  archiveRoadmap: () => Promise<void>;
  addPaletteItem: (item: RoadmapPaletteItem, position?: { x: number; y: number }) => void;
  saveLayout: (nodes: RoadmapNode[]) => void;
  setSaveState: Dispatch<SetStateAction<SpaceRoadmapSaveState>>;
  setSelectedId: Dispatch<SetStateAction<string>>;
  setExpandedGoalIds: Dispatch<SetStateAction<Set<string>>>;
  setNodeDrawerOpen: Dispatch<SetStateAction<boolean>>;
  setPlacementRequest: Dispatch<SetStateAction<{ paletteId: string; token: string } | undefined>>;
}) {
  const {
    spaceId,
    canManage,
    snapshot,
    tasks,
    saveState,
    error,
    selectedId,
    expandedGoalIds,
    nodeDrawerOpen,
    placementRequest,
    palette,
    navigate,
    mutate,
    load,
    retrySave,
    archiveRoadmap,
    addPaletteItem,
    saveLayout,
    setSaveState,
    setSelectedId,
    setExpandedGoalIds,
    setNodeDrawerOpen,
    setPlacementRequest,
  } = props;
  const [inspectorAnchor, setInspectorAnchor] = useState<{ x: number; y: number }>();
  const [dailyPlanOpen, setDailyPlanOpen] = useState(true);
  const [focusRequest, setFocusRequest] = useState<{ id: string; token: string }>();
  useShortcutHandler("roadmap.create", () => setNodeDrawerOpen(true), canManage);
  const toggleGoal = useCallback(
    (goalId: string) =>
      setExpandedGoalIds((current) => {
        const next = new Set(current);
        if (next.has(goalId)) next.delete(goalId);
        else next.add(goalId);
        return next;
      }),
    [setExpandedGoalIds],
  );
  const selectForEditing = (id: string, anchor?: { x: number; y: number }) => {
    setSelectedId(id);
    setInspectorAnchor(id ? anchor : undefined);
  };
  const viewportWidth = typeof window === "undefined" ? 1440 : window.innerWidth;
  const viewportHeight = typeof window === "undefined" ? 900 : window.innerHeight;
  const inspectorLeft = Math.max(
    16,
    Math.min((inspectorAnchor?.x ?? viewportWidth - 380) + 18, viewportWidth - 376),
  );
  const inspectorTop = Math.max(
    16,
    Math.min((inspectorAnchor?.y ?? 96) - 24, viewportHeight - 560),
  );
  return (
    <div className="flex h-full min-h-0 flex-col bg-charcoal-bg">
      <header className="flex min-h-11 shrink-0 items-center gap-2 border-b border-charcoal-border bg-charcoal-bg py-1.5 pl-1 pr-3">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 gap-1.5 px-2 text-cream-muted hover:text-cream-bright"
          onClick={() => navigate(`/spaces/${encodeURIComponent(spaceId)}/planner/roadmaps`)}
        >
          <ArrowLeft className="size-4" />
          <span className="text-xs font-medium">Roadmaps</span>
        </Button>
        <Button
          variant="ghost"
          className="h-8 min-w-0 max-w-md justify-start px-2 text-left"
          onClick={(event) =>
            selectForEditing(snapshot.roadmap.id, { x: event.clientX, y: event.clientY })
          }
        >
          <h1 className="m-0 truncate text-sm font-semibold text-cream-bright">
            {snapshot.roadmap.name}
          </h1>
        </Button>
        <span className="hidden text-[11px] tabular-nums text-cream-muted lg:inline">
          {snapshot.goal_done}/{snapshot.goal_total} goals · {snapshot.progress_percentage}%
        </span>
        <SaveStatus state={saveState} />
        <Button
          size="icon"
          variant="ghost"
          className="size-8"
          aria-label={
            saveState === "unsaved" || saveState === "conflict"
              ? "Retry saving roadmap"
              : "Refresh roadmap"
          }
          title={
            saveState === "unsaved" || saveState === "conflict" ? "Retry saving" : "Refresh roadmap"
          }
          onClick={() =>
            void (saveState === "unsaved" || saveState === "conflict" ? retrySave() : load())
          }
        >
          <RefreshCcw className={`size-4 ${saveState === "saving" ? "animate-spin" : ""}`} />
        </Button>
      </header>
      {error ? (
        <ErrorBanner message={error} onRetry={() => void retrySave()} retryLabel="Retry saving" />
      ) : null}
      <div className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
        <RoadmapNodeDrawer
          open={nodeDrawerOpen}
          canManage={canManage}
          definitions={snapshot.node_definitions}
          onClose={() => setNodeDrawerOpen(false)}
          onAdd={(item) => setPlacementRequest({ paletteId: item.id, token: crypto.randomUUID() })}
          onCreateDefinition={async (definition) => {
            await spacesApi.createRoadmapNodeDefinition(spaceId, definition);
            await load();
          }}
          onUpdateDefinition={async (definition) => {
            await spacesApi.updateRoadmapNodeDefinition(spaceId, definition);
            await load();
          }}
          onArchiveDefinition={async (definition) => {
            await spacesApi.archiveRoadmapNodeDefinition(spaceId, definition);
            await load();
          }}
        />
        <div className="grid min-h-0 min-w-0 flex-1 grid-rows-[minmax(0,1fr)_auto]">
          <RoadmapCanvas
            snapshot={snapshot}
            selectedId={selectedId}
            canManage={canManage}
            expandedGoalIds={expandedGoalIds}
            focusRequest={focusRequest}
            placementRequest={placementRequest}
            onPlacementHandled={() => setPlacementRequest(undefined)}
            onToggleGoal={toggleGoal}
            onOpenTask={(taskId) =>
              navigate(
                `/spaces/${encodeURIComponent(spaceId)}/planner/tasks/board?task=${encodeURIComponent(taskId)}`,
              )
            }
            onSelect={selectForEditing}
            onLayout={saveLayout}
            onAddAt={(paletteId, position) => {
              const item = palette.find((candidate) => candidate.id === paletteId);
              if (item) addPaletteItem(item, position);
            }}
            onConnect={(connection, edgeType) => {
              const source = roadmapEndpoint(snapshot, connection.source);
              const target = roadmapEndpoint(snapshot, connection.target);
              if (source && target)
                void mutate(
                  (version) =>
                    spacesApi.saveRoadmapEdge(
                      spaceId,
                      snapshot.roadmap.id,
                      {
                        source,
                        target,
                        edge_type: edgeType,
                        label: "",
                      },
                      version,
                    ),
                  (current, result) => ({
                    ...current,
                    roadmap: { ...current.roadmap, graph_version: result.graph_version },
                    edges: [...current.edges, result.edge],
                  }),
                );
            }}
            onDuplicate={(id) => {
              const goal = snapshot.goals.find((item) => item.id === id);
              const milestone = snapshot.milestones.find((item) => item.id === id);
              const supportNode = snapshot.nodes.find((item) => item.id === id);
              if (goal)
                void mutate((version) =>
                  spacesApi.createRoadmapGoal(
                    spaceId,
                    snapshot.roadmap.id,
                    {
                      milestone_id: goal.milestone_id,
                      title: `${goal.title} copy`,
                      description: goal.description,
                      target_date: goal.target_date,
                      position_x: goal.position_x + 32,
                      position_y: goal.position_y + 32,
                    },
                    version,
                  ),
                );
              else if (milestone)
                void mutate((version) =>
                  spacesApi.createRoadmapMilestone(
                    spaceId,
                    snapshot.roadmap.id,
                    {
                      title: `${milestone.title} copy`,
                      description: milestone.description,
                      target_date: milestone.target_date,
                      position_x: milestone.position_x + 48,
                      position_y: milestone.position_y + 48,
                      width: milestone.width,
                      height: milestone.height,
                    },
                    version,
                  ),
                );
              else if (supportNode)
                void mutate((version) =>
                  spacesApi.createRoadmapNode(
                    spaceId,
                    snapshot.roadmap.id,
                    {
                      ...supportNode,
                      id: undefined,
                      title: `${supportNode.title} copy`,
                      position_x: supportNode.position_x + 32,
                      position_y: supportNode.position_y + 32,
                    },
                    version,
                  ),
                );
            }}
            onDelete={(id) => {
              const goal = snapshot.goals.find((item) => item.id === id);
              const milestone = snapshot.milestones.find((item) => item.id === id);
              const supportNode = snapshot.nodes.find((item) => item.id === id);
              const edge = snapshot.edges.find((item) => item.id === id);
              if (goal)
                void mutate((version) => spacesApi.archiveRoadmapGoal(spaceId, goal, version));
              else if (milestone)
                void mutate((version) =>
                  spacesApi.archiveRoadmapMilestone(spaceId, milestone, version),
                );
              else if (supportNode)
                void mutate((version) =>
                  spacesApi.archiveRoadmapNode(spaceId, supportNode, version),
                );
              else if (edge)
                void mutate((version) => spacesApi.deleteRoadmapEdge(spaceId, edge, version));
            }}
          />
          <RoadmapOutline
            snapshot={snapshot}
            selectedId={selectedId}
            onSelect={(id) => selectForEditing(id)}
            onOpenTask={(taskId) =>
              navigate(
                `/spaces/${encodeURIComponent(spaceId)}/planner/tasks/board?task=${encodeURIComponent(taskId)}`,
              )
            }
          />
        </div>
        {dailyPlanOpen ? (
          <RoadmapExecutionRail
            snapshot={snapshot}
            selectedId={selectedId}
            onClose={() => setDailyPlanOpen(false)}
            onFocus={(id) => {
              setSelectedId(id);
              setInspectorAnchor(undefined);
              setFocusRequest({ id, token: crypto.randomUUID() });
            }}
            onOpenTask={(taskId) =>
              navigate(
                `/spaces/${encodeURIComponent(spaceId)}/planner/tasks/board?task=${encodeURIComponent(taskId)}`,
              )
            }
          />
        ) : null}
      </div>
      <footer className="flex h-10 shrink-0 items-center border-t border-charcoal-border bg-charcoal-bg px-2">
        <Button
          type="button"
          size="sm"
          variant={nodeDrawerOpen ? "secondary" : "ghost"}
          className="h-8 gap-1.5 px-2.5 text-xs"
          aria-label={nodeDrawerOpen ? "Hide node tools" : "Show node tools"}
          aria-pressed={nodeDrawerOpen}
          onClick={() => setNodeDrawerOpen((open) => !open)}
        >
          {nodeDrawerOpen ? (
            <PanelLeftClose className="size-4" />
          ) : (
            <PanelLeftOpen className="size-4" />
          )}
          Nodes
        </Button>
        <Button
          type="button"
          size="sm"
          variant={dailyPlanOpen ? "secondary" : "ghost"}
          className="ml-auto h-8 gap-1.5 px-2.5 text-xs"
          aria-label={dailyPlanOpen ? "Hide daily plan" : "Show daily plan"}
          aria-pressed={dailyPlanOpen}
          onClick={() => setDailyPlanOpen((open) => !open)}
        >
          Daily plan
          {dailyPlanOpen ? (
            <PanelRightClose className="size-4" />
          ) : (
            <PanelRightOpen className="size-4" />
          )}
        </Button>
      </footer>
      {selectedId ? (
        <div
          className={[
            "fixed z-50 overflow-auto rounded-xl bg-charcoal-card",
            "max-h-[min(540px,calc(100vh-32px))] w-[min(344px,calc(100vw-32px))]",
            "shadow-xl ring-1 ring-cream/10",
          ].join(" ")}
          style={{ left: inspectorLeft, top: inspectorTop }}
          role="dialog"
          aria-label="Edit roadmap selection"
        >
          <Button
            size="icon"
            variant="ghost"
            className="absolute right-2 top-2 z-10 size-7 rounded-full"
            aria-label="Close editor"
            onClick={() => selectForEditing("")}
          >
            <X className="size-3.5" />
          </Button>
          <RoadmapInspector
            compact
            snapshot={snapshot}
            selectedId={selectedId}
            canManage={canManage}
            tasks={tasks}
            onUpdateMilestone={(value) =>
              void mutate(
                (version) => spacesApi.updateRoadmapMilestone(spaceId, value, version),
                (current, result) => ({
                  ...current,
                  roadmap: { ...current.roadmap, graph_version: result.graph_version },
                  milestones: current.milestones.map((item) =>
                    item.id === result.milestone.id
                      ? {
                          ...item,
                          ...result.milestone,
                          goal_total: item.goal_total,
                          goal_done: item.goal_done,
                          status: item.status,
                        }
                      : item,
                  ),
                }),
                (current) => ({
                  ...current,
                  milestones: current.milestones.map((item) =>
                    item.id === value.id
                      ? {
                          ...item,
                          ...value,
                          goal_total: item.goal_total,
                          goal_done: item.goal_done,
                          status: item.status,
                        }
                      : item,
                  ),
                }),
              )
            }
            onUpdateGoal={(value, manual) =>
              void mutate(
                (version) => spacesApi.updateRoadmapGoal(spaceId, value, version, manual),
                (current, result) => ({
                  ...current,
                  roadmap: { ...current.roadmap, graph_version: result.graph_version },
                  goals: current.goals.map((item) =>
                    item.id === result.goal.id
                      ? {
                          ...item,
                          ...result.goal,
                          tasks: item.tasks,
                          task_total: item.task_total,
                          task_done: item.task_done,
                          progress_percentage:
                            manual === true ? 100 : manual === false ? 0 : item.progress_percentage,
                          status:
                            manual === true
                              ? "done"
                              : manual === false
                                ? "not_started"
                                : item.status,
                        }
                      : item,
                  ),
                }),
                (current) => ({
                  ...current,
                  goals: current.goals.map((item) =>
                    item.id === value.id
                      ? {
                          ...item,
                          ...value,
                          tasks: item.tasks,
                          task_total: item.task_total,
                          task_done: item.task_done,
                          progress_percentage:
                            manual === true ? 100 : manual === false ? 0 : item.progress_percentage,
                          status:
                            manual === true
                              ? "done"
                              : manual === false
                                ? "not_started"
                                : item.status,
                        }
                      : item,
                  ),
                }),
              )
            }
            onTasks={(goal, ids) =>
              void mutate(
                (version) => spacesApi.replaceRoadmapGoalTasks(spaceId, goal, ids, version),
                undefined,
                (current) => ({
                  ...current,
                  goals: current.goals.map((item) =>
                    item.id === goal.id
                      ? {
                          ...item,
                          tasks: tasks.filter((task) => ids.includes(task.id)),
                          task_total: ids.length,
                        }
                      : item,
                  ),
                }),
              )
            }
            onArchive={(value) =>
              void mutate((version) =>
                "milestone_id" in value
                  ? spacesApi.archiveRoadmapGoal(spaceId, value, version)
                  : spacesApi.archiveRoadmapMilestone(spaceId, value, version),
              )
            }
            onUpdateNode={(value) =>
              void mutate(
                (version) => spacesApi.updateRoadmapNode(spaceId, value, version),
                (current, result) => ({
                  ...current,
                  roadmap: { ...current.roadmap, graph_version: result.graph_version },
                  nodes: current.nodes.map((item) =>
                    item.id === result.node.id ? result.node : item,
                  ),
                }),
                (current) => ({
                  ...current,
                  nodes: current.nodes.map((item) => (item.id === value.id ? value : item)),
                }),
              )
            }
            onArchiveNode={(value) =>
              void mutate(
                (version) => spacesApi.archiveRoadmapNode(spaceId, value, version),
                undefined,
                (current) => ({
                  ...current,
                  nodes: current.nodes.filter((item) => item.id !== value.id),
                  edges: current.edges.filter(
                    (edge) => edge.source.id !== value.id && edge.target.id !== value.id,
                  ),
                }),
              )
            }
            onUpdateEdge={(edge) =>
              void mutate(
                (version) => spacesApi.saveRoadmapEdge(spaceId, snapshot.roadmap.id, edge, version),
                (current, result) => ({
                  ...current,
                  roadmap: { ...current.roadmap, graph_version: result.graph_version },
                  edges: current.edges.map((item) =>
                    item.id === result.edge.id ? result.edge : item,
                  ),
                }),
                (current) => ({
                  ...current,
                  edges: current.edges.map((item) => (item.id === edge.id ? edge : item)),
                }),
              )
            }
            onDeleteEdge={(edge) =>
              void mutate(
                (version) => spacesApi.deleteRoadmapEdge(spaceId, edge, version),
                undefined,
                (current) => ({
                  ...current,
                  edges: current.edges.filter((item) => item.id !== edge.id),
                }),
              )
            }
            onDirty={() => setSaveState("unsaved")}
            onUpdateRoadmap={(roadmap) =>
              void mutate(
                (version) =>
                  spacesApi.updateRoadmap(spaceId, { ...roadmap, graph_version: version }),
                (current, result) => ({ ...current, roadmap: result }),
                (current) => ({
                  ...current,
                  roadmap: {
                    ...current.roadmap,
                    ...roadmap,
                    graph_version: current.roadmap.graph_version,
                  },
                }),
              )
            }
            onArchiveRoadmap={() => void archiveRoadmap()}
          />
        </div>
      ) : null}
    </div>
  );
}

function SaveStatus({ state }: { state: SpaceRoadmapSaveState }) {
  const failed = state === "unsaved" || state === "conflict";
  const label =
    state === "saving"
      ? "Saving…"
      : state === "unsaved"
        ? "Not saved"
        : state === "conflict"
          ? "Save conflict"
          : "Saved";
  return (
    <span
      className={`ml-auto flex shrink-0 items-center gap-1.5 text-[11px] ${failed ? "text-red-300" : "text-cream-muted"}`}
      role="status"
      aria-live="polite"
    >
      {state === "saving" ? (
        <LoaderCircle className="size-3.5 animate-spin" />
      ) : failed ? (
        <CircleAlert className="size-3.5" />
      ) : (
        <Check className="size-3.5" />
      )}
      {label}
    </span>
  );
}

export function ErrorBanner({
  message,
}: {
  message: string;
  onRetry: () => void;
  retryLabel?: string;
}) {
  return (
    <SystemErrorActivity error={message} scope="planner:roadmap" title="Roadmap needs attention" />
  );
}
