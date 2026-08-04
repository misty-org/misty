import type { Dispatch, SetStateAction } from "react";
import { LibraryBig, RefreshCcw } from "lucide-react";
import type { NavigateFunction } from "react-router-dom";
import type { SpaceTask } from "@/models/interfaces/features/spaces/types";
import type {
  SpaceRoadmapSaveState,
  SpaceRoadmapSnapshot,
} from "@/models/interfaces/features/spaces/plannerExpansionTypes";
import { spacesApi } from "@/stores/spaces/useSpacesBackendStore";
import { Button } from "@/ui";
import { RoadmapCanvas } from "./RoadmapCanvas";
import type { RoadmapNode } from "./RoadmapCanvasNodes";
import { RoadmapInspector } from "./RoadmapInspector";
import { RoadmapNodeDrawer } from "./RoadmapNodeDrawer";
import { RoadmapOutline } from "./RoadmapOutline";
import type { RoadmapPaletteItem } from "./roadmapNodeCatalog";
import { roadmapEndpoint } from "./RoadmapWorkspaceHelpers";

export type RoadmapMutation = <T>(
  action: (version: number) => Promise<T>,
  apply?: (current: SpaceRoadmapSnapshot, result: T) => SpaceRoadmapSnapshot,
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
  nodeDrawerPinned: boolean;
  placementRequest?: { paletteId: string; token: string };
  palette: RoadmapPaletteItem[];
  navigate: NavigateFunction;
  mutate: RoadmapMutation;
  load: () => Promise<void>;
  retryConflict: () => Promise<void>;
  archiveRoadmap: () => Promise<void>;
  addPaletteItem: (item: RoadmapPaletteItem, position?: { x: number; y: number }) => void;
  saveLayout: (nodes: RoadmapNode[]) => void;
  setSaveState: Dispatch<SetStateAction<SpaceRoadmapSaveState>>;
  setSelectedId: Dispatch<SetStateAction<string>>;
  setExpandedGoalIds: Dispatch<SetStateAction<Set<string>>>;
  setNodeDrawerOpen: Dispatch<SetStateAction<boolean>>;
  setNodeDrawerPinned: Dispatch<SetStateAction<boolean>>;
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
    nodeDrawerPinned,
    placementRequest,
    palette,
    navigate,
    mutate,
    load,
    retryConflict,
    archiveRoadmap,
    addPaletteItem,
    saveLayout,
    setSaveState,
    setSelectedId,
    setExpandedGoalIds,
    setNodeDrawerOpen,
    setNodeDrawerPinned,
    setPlacementRequest,
  } = props;
  return (
    <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)]">
      <header className="misty-spaces-toolbar flex min-h-12 items-center gap-2 px-4">
        <Button
          variant="ghost"
          className="h-auto min-w-0 justify-start px-1 py-0 text-left"
          onClick={() => setSelectedId(snapshot.roadmap.id)}
        >
          <div className="min-w-0">
            <h1 className="m-0 truncate text-sm font-semibold">{snapshot.roadmap.name}</h1>
            <p className="m-0 text-[11px] text-muted-foreground">
              {snapshot.goal_done}/{snapshot.goal_total} goals · {snapshot.progress_percentage}%
            </p>
          </div>
        </Button>
        <span
          className={`ml-auto text-[11px] ${saveState === "conflict" ? "text-destructive" : "text-muted-foreground"}`}
        >
          {saveState[0].toUpperCase() + saveState.slice(1)}
        </span>
        <Button
          size="icon"
          variant="ghost"
          aria-label="Refresh roadmap"
          onClick={() => void load()}
        >
          <RefreshCcw className="size-4" />
        </Button>
        {canManage ? (
          <Button size="sm" onClick={() => setNodeDrawerOpen(true)}>
            <LibraryBig className="size-4" />
            Add node
          </Button>
        ) : null}
      </header>
      {error ? (
        <ErrorBanner
          message={error}
          onRetry={() => void (saveState === "conflict" ? retryConflict() : load())}
          retryLabel={saveState === "conflict" ? "Refresh and retry" : "Retry"}
        />
      ) : null}
      <div className="grid min-h-0 grid-cols-1 overflow-auto xl:grid-cols-[minmax(0,1fr)_300px] xl:overflow-hidden">
        <div className="relative flex min-h-0 min-w-0">
          <RoadmapNodeDrawer
            open={nodeDrawerOpen}
            pinned={nodeDrawerPinned}
            canManage={canManage}
            definitions={snapshot.node_definitions}
            onClose={() => setNodeDrawerOpen(false)}
            onPinnedChange={setNodeDrawerPinned}
            onAdd={(item) =>
              setPlacementRequest({ paletteId: item.id, token: crypto.randomUUID() })
            }
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
              placementRequest={placementRequest}
              onPlacementHandled={() => setPlacementRequest(undefined)}
              onToggleGoal={(goalId) =>
                setExpandedGoalIds((current) => {
                  const next = new Set(current);
                  if (next.has(goalId)) next.delete(goalId);
                  else next.add(goalId);
                  return next;
                })
              }
              onOpenTask={(taskId) =>
                navigate(
                  `/spaces/${encodeURIComponent(spaceId)}/planner/tasks/board?task=${encodeURIComponent(taskId)}`,
                )
              }
              onSelect={setSelectedId}
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
              onSelect={setSelectedId}
              onOpenTask={(taskId) =>
                navigate(
                  `/spaces/${encodeURIComponent(spaceId)}/planner/tasks/board?task=${encodeURIComponent(taskId)}`,
                )
              }
            />
          </div>
        </div>
        <RoadmapInspector
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
                          manual === true ? "done" : manual === false ? "not_started" : item.status,
                      }
                    : item,
                ),
              }),
            )
          }
          onTasks={(goal, ids) =>
            void mutate((version) => spacesApi.replaceRoadmapGoalTasks(spaceId, goal, ids, version))
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
            )
          }
          onArchiveNode={(value) =>
            void mutate((version) => spacesApi.archiveRoadmapNode(spaceId, value, version))
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
            )
          }
          onDeleteEdge={(edge) =>
            void mutate((version) => spacesApi.deleteRoadmapEdge(spaceId, edge, version))
          }
          onDirty={() => setSaveState("unsaved")}
          onUpdateRoadmap={(roadmap) =>
            void mutate(
              (version) => spacesApi.updateRoadmap(spaceId, { ...roadmap, graph_version: version }),
              (current, result) => ({ ...current, roadmap: result }),
            )
          }
          onArchiveRoadmap={() => void archiveRoadmap()}
        />
      </div>
    </div>
  );
}

export function ErrorBanner({
  message,
  onRetry,
  retryLabel = "Retry",
}: {
  message: string;
  onRetry: () => void;
  retryLabel?: string;
}) {
  return (
    <div className="flex items-center justify-between border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-xs text-destructive">
      <span>{message}</span>
      <Button size="sm" variant="ghost" onClick={onRetry}>
        {retryLabel}
      </Button>
    </div>
  );
}
