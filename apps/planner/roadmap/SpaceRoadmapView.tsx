import { useRoadmapRuntime, isPlannerConflict } from "./spaceRoadmap/roadmapRuntime";
import {
  type MistyAiArtifact as AiArtifact,
  type MistySurfaceAdapter as AiSurfaceAdapter,
} from "@misty/sdk";
import type {
  SpaceRoadmap,
  SpaceRoadmapNode,
  SpaceRoadmapSaveState,
  SpaceRoadmapSnapshot,
} from "@/api/spaces/dto/interfaces/plannerExpansionTypes";
import type { SpaceTask } from "@/api/spaces/dto/interfaces/types";
import { errorText } from "@/shared/lib/format";
import { LoaderCircle } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import type { RoadmapNode } from "./spaceRoadmap/RoadmapCanvasNodes";
import { ErrorBanner, RoadmapEditor } from "./spaceRoadmap/RoadmapEditor";
import { RoadmapHome } from "./spaceRoadmap/RoadmapHome";
import {
  applyRoadmapLayout,
  milestoneAt,
  normalizeRoadmapSnapshot,
  readExpandedGoals,
} from "./spaceRoadmap/RoadmapWorkspaceHelpers";
import { roadmapPalette, type RoadmapPaletteItem } from "./spaceRoadmap/roadmapNodeCatalog";

export function SpaceRoadmapView(props: {
  spaceId: string; roadmapId: string; canManage: boolean; workspaceTabId?: string;
}) {
  return <RoadmapDocument key={`${props.spaceId}:${props.roadmapId}`} {...props} />;
}

function RoadmapDocument({
  spaceId,
  roadmapId,
  canManage,
}: {
  spaceId: string;
  roadmapId: string;
  canManage: boolean;
  workspaceTabId?: string;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const runtime = useRoadmapRuntime();
  const { api: spacesApi, userId, storage, subscribeChanges } = runtime;
  const [roadmaps, setRoadmaps] = useState<SpaceRoadmap[]>([]);
  const [snapshot, setSnapshot] = useState<SpaceRoadmapSnapshot>();
  const [tasks, setTasks] = useState<SpaceTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saveState, setSaveState] = useState<SpaceRoadmapSaveState>("saved");
  const [nodeDrawerOpen, setNodeDrawerOpen] = useState(true);
  const [placementRequest, setPlacementRequest] = useState<{
    paletteId: string;
    token: string;
  }>();
  const expansionKey = `misty:roadmap-expanded-goals:${userId ?? "anonymous"}:${spaceId}:${roadmapId}`;
  const [expandedGoalIds, setExpandedGoalIds] = useState<Set<string>>(() =>
    readExpandedGoals(storage, expansionKey),
  );
  const selectedFromQuery =
    new URLSearchParams(location.search).get("node") ??
    new URLSearchParams(location.search).get("goal") ??
    new URLSearchParams(location.search).get("milestone") ??
    "";
  const [selectedId, setSelectedId] = useState(selectedFromQuery);
  const creatingRef = useRef(false);
  const savingRef = useRef(false);
  const snapshotRef = useRef<SpaceRoadmapSnapshot | undefined>(undefined);
  const serverVersionRef = useRef(0);
  const pendingMutationCountRef = useRef(0);
  const mutationQueueRef = useRef<Promise<void>>(Promise.resolve());
  const failedMutationRef = useRef<(() => Promise<void>) | undefined>(undefined);
  const updateSnapshot = useCallback(
    (updater: (current: SpaceRoadmapSnapshot) => SpaceRoadmapSnapshot) => {
      setSnapshot((current) => {
        if (!current) return current;
        const next = updater(current);
        snapshotRef.current = next;
        return next;
      });
    },
    [],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [list, taskPage, graph] = await Promise.all([
        spacesApi.roadmaps(spaceId),
        roadmapId
          ? spacesApi.tasks(spaceId, { limit: 200 })
          : Promise.resolve({ tasks: [] as SpaceTask[] }),
        roadmapId ? spacesApi.roadmap(spaceId, roadmapId) : Promise.resolve(undefined),
      ]);
      setRoadmaps(list.roadmaps);
      setTasks(taskPage.tasks.filter((task) => !task.archived_at && task.status !== "canceled"));
      const nextSnapshot = graph ? normalizeRoadmapSnapshot(graph) : undefined;
      snapshotRef.current = nextSnapshot;
      serverVersionRef.current = nextSnapshot?.roadmap.graph_version ?? 0;
      setSnapshot(nextSnapshot);
      setError("");
      setSaveState("saved");
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setLoading(false);
    }
  }, [roadmapId, spaceId, spacesApi]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    snapshotRef.current = snapshot;
    if (snapshot && !savingRef.current) serverVersionRef.current = snapshot.roadmap.graph_version;
  }, [snapshot]);
  useEffect(() => {
    setExpandedGoalIds(readExpandedGoals(storage, expansionKey));
  }, [storage, expansionKey]);
  useEffect(() => {
    try {
      storage.setItem(expansionKey, JSON.stringify([...expandedGoalIds]));
    } catch {
      // Personal expansion state is optional.
    }
  }, [storage, expandedGoalIds, expansionKey]);
  useEffect(
    () =>
      subscribeChanges(() => {
        if (!savingRef.current) void load();
      }),
    [load, subscribeChanges],
  );
  useEffect(() => {
    if (saveState === "saved") return;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, [saveState]);

  const mutate = async <T,>(
    action: (version: number) => Promise<T>,
    apply?: (current: SpaceRoadmapSnapshot, result: T) => SpaceRoadmapSnapshot,
    optimistic?: (current: SpaceRoadmapSnapshot) => SpaceRoadmapSnapshot,
  ) => {
    const current = snapshotRef.current;
    if (!current) return;
    if (optimistic) updateSnapshot(optimistic);
    pendingMutationCountRef.current += 1;
    savingRef.current = true;
    setSaveState("saving");
    setError("");

    const run = async () => {
      try {
        let result: T;
        try {
          result = await action(serverVersionRef.current || current.roadmap.graph_version);
        } catch (reason) {
          if (!isPlannerConflict(reason)) throw reason;
          const latest = await spacesApi.roadmap(spaceId, current.roadmap.id);
          serverVersionRef.current = latest.roadmap.graph_version;
          result = await action(serverVersionRef.current);
        }

        const graphVersion = mutationGraphVersion(result);
        if (graphVersion) serverVersionRef.current = graphVersion;
        if (optimistic) {
          if (graphVersion)
            updateSnapshot((latest) => ({
              ...latest,
              roadmap: { ...latest.roadmap, graph_version: graphVersion },
            }));
        } else if (apply) updateSnapshot((latest) => apply(latest, result));
        else await load();

        failedMutationRef.current = undefined;
        setError("");
      } catch (reason) {
        failedMutationRef.current = () => mutate(action, apply);
        setError(errorText(reason));
        setSaveState(isPlannerConflict(reason) ? "conflict" : "unsaved");
      } finally {
        pendingMutationCountRef.current = Math.max(0, pendingMutationCountRef.current - 1);
        savingRef.current = pendingMutationCountRef.current > 0;
        if (savingRef.current) setSaveState("saving");
        else if (!failedMutationRef.current) setSaveState("saved");
      }
    };

    const queued = mutationQueueRef.current.then(run);
    mutationQueueRef.current = queued.catch(() => undefined);
    await queued;
  };
  const retrySave = async () => {
    const retry = failedMutationRef.current;
    if (!retry) {
      await load();
      return;
    }
    failedMutationRef.current = undefined;
    await retry();
  };
  const aiAdapter = useMemo<AiSurfaceAdapter | null>(() => {
    if (!snapshot) return null;
    const applicablePatch = (artifact: AiArtifact) => {
      if (
        artifact.kind !== "roadmap_patch" ||
        !canManage ||
        savingRef.current ||
        artifact.target?.id !== snapshot.roadmap.id ||
        artifact.target?.spaceId !== spaceId ||
        Number(artifact.baseRevision) !== snapshot.roadmap.graph_version
      )
        return null;
      const operations = artifact.operations as {
        base_revision?: string | number;
        changes?: Array<{
          op?: string;
          kind?: string;
          id?: string;
          fields?: Record<string, unknown>;
        }>;
      };
      if (
        Number(operations.base_revision) !== snapshot.roadmap.graph_version ||
        operations.changes?.length !== 1
      )
        return null;
      const change = operations.changes[0];
      if (change.op !== "update" || !change.id || !change.fields) return null;
      const keys = Object.keys(change.fields);
      if (
        keys.length === 0 ||
        keys.some((key) => !["title", "description", "target_date"].includes(key))
      )
        return null;
      const title = change.fields.title;
      const description = change.fields.description;
      const targetDate = change.fields.target_date;
      if (
        (title !== undefined &&
          (typeof title !== "string" || !title.trim() || title.length > 240)) ||
        (description !== undefined &&
          (typeof description !== "string" || description.length > 20_000)) ||
        (targetDate !== undefined &&
          (typeof targetDate !== "string" ||
            (targetDate !== "" && !/^\d{4}-\d{2}-\d{2}$/.test(targetDate))))
      )
        return null;
      const collection =
        change.kind === "milestone"
          ? snapshot.milestones
          : change.kind === "goal"
            ? snapshot.goals
            : change.kind === "node"
              ? snapshot.nodes
              : [];
      const current = collection.find((item) => item.id === change.id);
      return current
        ? { kind: change.kind as "milestone" | "goal" | "node", current, fields: change.fields }
        : null;
    };
    return {
      surfaceId: "planner.roadmap",
      label: snapshot.roadmap.name,
      getContext: () => [
        {
          kind: "roadmap",
          id: snapshot.roadmap.id,
          title: snapshot.roadmap.name,
          privacy: "shared",
          spaceId,
          href: `/spaces/${encodeURIComponent(spaceId)}/planner/roadmaps/${encodeURIComponent(snapshot.roadmap.id)}`,
          revision: snapshot.roadmap.graph_version,
        },
      ],
      getSuggestedActions: () => [
        {
          id: "roadmap-status",
          label: "Status summary",
          prompt:
            "Summarize progress, blockers, and the most important next moves in this roadmap.",
        },
        {
          id: "roadmap-risks",
          label: "Find risks",
          prompt:
            "Analyze dependency, sequencing, target-date, and scope risks in this roadmap graph.",
        },
        {
          id: "roadmap-scenario",
          label: "Explore scenario",
          prompt:
            "Propose a better sequencing scenario and explain tradeoffs. Do not change the roadmap.",
        },
        {
          id: "roadmap-update",
          label: "Propose graph update",
          prompt:
            "Propose exactly one revision-anchored update to the title, description, or target date of an existing " +
            "milestone, goal, or node. Use its exact visible identifier. Do not apply it.",
          requestedArtifactKind: "roadmap_patch",
        },
        {
          id: "roadmap-tasks",
          label: "Next tasks",
          prompt:
            "Propose a reviewed set of concrete next tasks that advances this roadmap. Do not assign or schedule them.",
          requestedArtifactKind: "task_set",
        },
      ],
      canApply: (artifact) => Boolean(applicablePatch(artifact)),
      applyArtifact: async (artifact) => {
        const patch = applicablePatch(artifact);
        if (!patch) throw new Error("The roadmap changed. Ask Misty to regenerate this update.");
        savingRef.current = true;
        setSaveState("saving");
        try {
          const fields = patch.fields as {
            title?: string;
            description?: string;
            target_date?: string;
          };
          const updated = {
            ...patch.current,
            ...(fields.title === undefined ? {} : { title: fields.title.trim() }),
            ...(fields.description === undefined ? {} : { description: fields.description }),
            ...(fields.target_date === undefined
              ? {}
              : { target_date: fields.target_date || undefined }),
          };
          if (patch.kind === "milestone")
            await spacesApi.updateRoadmapMilestone(
              spaceId,
              updated as SpaceRoadmapSnapshot["milestones"][number],
              snapshot.roadmap.graph_version,
            );
          else if (patch.kind === "goal")
            await spacesApi.updateRoadmapGoal(
              spaceId,
              updated as SpaceRoadmapSnapshot["goals"][number],
              snapshot.roadmap.graph_version,
            );
          else
            await spacesApi.updateRoadmapNode(
              spaceId,
              updated as SpaceRoadmapSnapshot["nodes"][number],
              snapshot.roadmap.graph_version,
            );
          await load();
          setSaveState("saved");
        } catch (reason) {
          setSaveState(isPlannerConflict(reason) ? "conflict" : "unsaved");
          if (isPlannerConflict(reason))
            throw new Error("The roadmap changed. Ask Misty to regenerate this update.");
          throw reason;
        } finally {
          savingRef.current = false;
        }
      },
    };
  }, [canManage, load, snapshot, spaceId]);
  const withIntegration = (content: import("react").ReactNode) => (
    <>
      {runtime.renderIntegration({
        title: snapshot?.roadmap.name?.trim() || "Roadmaps",
        adapter: aiAdapter,
      })}
      {content}
    </>
  );
  const createRoadmap = async () => {
    if (creatingRef.current) return;
    creatingRef.current = true;
    setLoading(true);
    setError("");
    try {
      const graph = await spacesApi.createRoadmap(spaceId, "Untitled roadmap");
      navigate(
        `/spaces/${encodeURIComponent(spaceId)}/planner/roadmaps/${encodeURIComponent(graph.roadmap.id)}`,
        { replace: true },
      );
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      creatingRef.current = false;
      setLoading(false);
    }
  };
  const archiveRoadmap = async () => {
    if (!snapshot || savingRef.current) return;
    savingRef.current = true;
    setSaveState("saving");
    try {
      await spacesApi.archiveRoadmap(spaceId, snapshot.roadmap);
      navigate(`/spaces/${encodeURIComponent(spaceId)}/planner/roadmaps`, { replace: true });
    } catch (reason) {
      setError(errorText(reason));
      setSaveState(isPlannerConflict(reason) ? "conflict" : "unsaved");
    } finally {
      savingRef.current = false;
    }
  };

  if (!roadmapId)
    return withIntegration(
      <RoadmapHome
        spaceId={spaceId}
        roadmaps={roadmaps}
        canManage={canManage}
        loading={loading}
        error={error}
        onCreate={() => void createRoadmap()}
        onOpen={(id) =>
          navigate(
            `/spaces/${encodeURIComponent(spaceId)}/planner/roadmaps/${encodeURIComponent(id)}`,
          )
        }
        onRetry={() => void load()}
      />,
    );
  if (loading && !snapshot)
    return withIntegration(
      <div className="grid h-full place-items-center">
        <LoaderCircle className="size-5 animate-spin text-cream-muted" />
      </div>,
    );
  if (!snapshot)
    return withIntegration(
      <div className="p-6">
        <ErrorBanner
          message={error || "This roadmap is unavailable."}
          onRetry={() => void load()}
        />
      </div>,
    );

  const palette = roadmapPalette(snapshot.node_definitions);
  const addPaletteItem = (item: RoadmapPaletteItem, position?: { x: number; y: number }) => {
    if (!canManage) return;
    const absolute = position ?? {
      x: 100 + (snapshot.goals.length + snapshot.nodes.length) * 28,
      y: 100 + (snapshot.goals.length + snapshot.nodes.length) * 22,
    };
    if (item.kind === "milestone") {
      void mutate((version) =>
        spacesApi.createRoadmapMilestone(
          spaceId,
          snapshot.roadmap.id,
          {
            title: "New milestone",
            position_x: absolute.x,
            position_y: absolute.y,
            width: 460,
            height: 340,
            rank: snapshot.milestones.length,
          },
          version,
        ),
      );
      return;
    }
    const milestone = milestoneAt(snapshot.milestones, absolute) ?? snapshot.milestones[0];
    if (item.kind === "goal") {
      if (!milestone) return;
      void mutate((version) =>
        spacesApi.createRoadmapGoal(
          spaceId,
          snapshot.roadmap.id,
          {
            milestone_id: milestone.id,
            title: "New goal",
            position_x: Math.max(24, absolute.x - milestone.position_x),
            position_y: Math.max(72, absolute.y - milestone.position_y),
            rank: snapshot.goals.length,
          },
          version,
        ),
      );
      return;
    }
    const grouped = milestoneAt(snapshot.milestones, absolute);
    void mutate((version) =>
      spacesApi.createRoadmapNode(
        spaceId,
        snapshot.roadmap.id,
        {
          node_kind: item.kind as SpaceRoadmapNode["node_kind"],
          definition_id: item.definition?.id,
          milestone_id: grouped?.id,
          title: item.label,
          description: "",
          position_x: grouped ? Math.max(24, absolute.x - grouped.position_x) : absolute.x,
          position_y: grouped ? Math.max(72, absolute.y - grouped.position_y) : absolute.y,
          field_values: {},
        },
        version,
      ),
    );
  };
  const saveLayout = (nodes: RoadmapNode[]) => {
    const layoutSnapshot = snapshotRef.current ?? snapshot;
    const layout = {
      milestones: layoutSnapshot.milestones.map((item) => {
        const node = nodes.find((candidate) => candidate.id === item.id);
        return {
          id: item.id,
          position_x: node?.position.x ?? item.position_x,
          position_y: node?.position.y ?? item.position_y,
          width: Number(node?.measured?.width ?? node?.style?.width ?? item.width),
          height: Number(node?.measured?.height ?? node?.style?.height ?? item.height),
        };
      }),
      goals: layoutSnapshot.goals.map((item) => {
        const node = nodes.find((candidate) => candidate.id === item.id);
        return {
          id: item.id,
          milestone_id: node?.parentId ?? item.milestone_id,
          position_x: node?.position.x ?? item.position_x,
          position_y: node?.position.y ?? item.position_y,
        };
      }),
      nodes: layoutSnapshot.nodes.map((item) => {
        const node = nodes.find((candidate) => candidate.id === item.id);
        return {
          id: item.id,
          milestone_id: node?.parentId,
          position_x: node?.position.x ?? item.position_x,
          position_y: node?.position.y ?? item.position_y,
        };
      }),
    };
    void mutate(
      (version) =>
        spacesApi.updateRoadmapLayout(spaceId, layoutSnapshot.roadmap.id, layout, version),
      undefined,
      (current) => applyRoadmapLayout(current, nodes, current.roadmap.graph_version),
    );
  };

  return withIntegration(
    <RoadmapEditor
      spaceId={spaceId}
      canManage={canManage}
      snapshot={snapshot}
      tasks={tasks}
      saveState={saveState}
      error={error}
      selectedId={selectedId}
      expandedGoalIds={expandedGoalIds}
      nodeDrawerOpen={nodeDrawerOpen}
      placementRequest={placementRequest}
      palette={palette}
      navigate={navigate}
      mutate={mutate}
      load={load}
      retrySave={retrySave}
      archiveRoadmap={archiveRoadmap}
      addPaletteItem={addPaletteItem}
      saveLayout={saveLayout}
      setSaveState={setSaveState}
      setSelectedId={setSelectedId}
      setExpandedGoalIds={setExpandedGoalIds}
      setNodeDrawerOpen={setNodeDrawerOpen}
      setPlacementRequest={setPlacementRequest}
    />,
  );
}

function mutationGraphVersion(result: unknown): number | undefined {
  if (!result || typeof result !== "object" || !("graph_version" in result)) return undefined;
  const graphVersion = (result as { graph_version?: unknown }).graph_version;
  return typeof graphVersion === "number" && Number.isFinite(graphVersion)
    ? graphVersion
    : undefined;
}
