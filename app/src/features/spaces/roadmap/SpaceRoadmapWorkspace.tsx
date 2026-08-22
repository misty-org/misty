import { deploymentStorageKey } from "@/api/deployment/api";
import { useAuth } from "@/features/auth";
import {
  useAiSurfaceAdapter,
  type AiArtifact,
  type AiSurfaceAdapter,
} from "@/features/ai-surface/AiPaneHost";
import { SpaceRequestError, spacesApi } from "@/api/spaces/api";
import type {
  SpaceRoadmap,
  SpaceRoadmapNode,
  SpaceRoadmapSaveState,
  SpaceRoadmapSnapshot,
} from "@/api/spaces/dto/interfaces/plannerExpansionTypes";
import type { SpaceTask } from "@/api/spaces/dto/interfaces/types";
import { errorText } from "@/shared/lib/format";
import { Button, Input } from "@/shared/ui";
import { GitFork, LoaderCircle, Plus, SquarePen } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import type { RoadmapNode } from "./spaceRoadmap/RoadmapCanvasNodes";
import { ErrorBanner, RoadmapEditor } from "./spaceRoadmap/RoadmapEditor";
import {
  applyRoadmapLayout,
  milestoneAt,
  normalizeRoadmapSnapshot,
  readExpandedGoals,
} from "./spaceRoadmap/RoadmapWorkspaceHelpers";
import { roadmapPalette, type RoadmapPaletteItem } from "./spaceRoadmap/roadmapNodeCatalog";

export function SpaceRoadmapWorkspace({
  spaceId,
  roadmapId,
  canManage,
}: {
  spaceId: string;
  roadmapId: string;
  canManage: boolean;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
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
  const expansionKey = `misty:roadmap-expanded-goals:${user?.id ?? "anonymous"}:${spaceId}:${roadmapId}`;
  const [expandedGoalIds, setExpandedGoalIds] = useState<Set<string>>(() =>
    readExpandedGoals(expansionKey),
  );
  const selectedFromQuery =
    new URLSearchParams(location.search).get("node") ??
    new URLSearchParams(location.search).get("goal") ??
    new URLSearchParams(location.search).get("milestone") ??
    "";
  const [selectedId, setSelectedId] = useState(selectedFromQuery);
  const [name, setName] = useState("");
  const createRequested = new URLSearchParams(location.search).get("create") === "roadmap";
  const savingRef = useRef(false);
  const conflictActionRef = useRef<((version: number) => Promise<unknown>) | undefined>(undefined);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [list, taskPage, graph] = await Promise.all([
        spacesApi.roadmaps(spaceId),
        spacesApi.tasks(spaceId, { limit: 200 }),
        roadmapId ? spacesApi.roadmap(spaceId, roadmapId) : Promise.resolve(undefined),
      ]);
      setRoadmaps(list.roadmaps);
      setTasks(taskPage.tasks.filter((task) => !task.archived_at && task.status !== "canceled"));
      setSnapshot(graph ? normalizeRoadmapSnapshot(graph) : undefined);
      setError("");
      setSaveState("saved");
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setLoading(false);
    }
  }, [roadmapId, spaceId]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    setExpandedGoalIds(readExpandedGoals(expansionKey));
  }, [expansionKey]);
  useEffect(() => {
    try {
      window.localStorage.setItem(
        deploymentStorageKey(expansionKey),
        JSON.stringify([...expandedGoalIds]),
      );
    } catch {
      // Personal expansion state is optional.
    }
  }, [expandedGoalIds, expansionKey]);
  useEffect(() => {
    const refresh = (event: Event) => {
      const detail = (
        event as CustomEvent<{
          type?: string;
          event_type?: string;
          space_id?: string;
          graph_version?: number;
          payload?: { type?: string; graph_version?: number };
        }>
      ).detail;
      const incomingVersion = detail?.graph_version ?? detail?.payload?.graph_version ?? 0;
      const eventType = detail?.type ?? detail?.event_type ?? detail?.payload?.type ?? "";
      const definitionChanged = eventType.startsWith("roadmap.node_definition.");
      if (
        detail?.space_id === spaceId &&
        !savingRef.current &&
        (definitionChanged || !snapshot || incomingVersion > snapshot.roadmap.graph_version)
      )
        void load();
    };
    window.addEventListener("misty:space-roadmap-event", refresh);
    return () => window.removeEventListener("misty:space-roadmap-event", refresh);
  }, [load, snapshot, spaceId]);
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
  ) => {
    if (!snapshot || savingRef.current) return;
    savingRef.current = true;
    setSaveState("saving");
    try {
      const result = await action(snapshot.roadmap.graph_version);
      conflictActionRef.current = undefined;
      if (apply) setSnapshot((current) => (current ? apply(current, result) : current));
      else await load();
      setSaveState("saved");
    } catch (reason) {
      setError(errorText(reason));
      if (reason instanceof SpaceRequestError && reason.status === 409) {
        conflictActionRef.current = action;
        setSaveState("conflict");
      } else setSaveState("unsaved");
    } finally {
      savingRef.current = false;
    }
  };
  const retryConflict = async () => {
    const action = conflictActionRef.current;
    if (!snapshot || !action || savingRef.current) return;
    savingRef.current = true;
    setSaveState("saving");
    try {
      const latest = await spacesApi.roadmap(spaceId, snapshot.roadmap.id);
      setSnapshot(normalizeRoadmapSnapshot(latest));
      await action(latest.roadmap.graph_version);
      conflictActionRef.current = undefined;
      await load();
      setSaveState("saved");
      setError("");
    } catch (reason) {
      setError(errorText(reason));
      setSaveState(
        reason instanceof SpaceRequestError && reason.status === 409 ? "conflict" : "unsaved",
      );
    } finally {
      savingRef.current = false;
    }
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
          setSaveState(
            reason instanceof SpaceRequestError && reason.status === 409 ? "conflict" : "unsaved",
          );
          if (reason instanceof SpaceRequestError && reason.status === 409)
            throw new Error("The roadmap changed. Ask Misty to regenerate this update.");
          throw reason;
        } finally {
          savingRef.current = false;
        }
      },
    };
  }, [canManage, load, snapshot, spaceId]);
  useAiSurfaceAdapter(aiAdapter);
  const createRoadmap = async () => {
    if (!name.trim()) return;
    setLoading(true);
    try {
      const graph = await spacesApi.createRoadmap(spaceId, name.trim());
      navigate(
        `/spaces/${encodeURIComponent(spaceId)}/planner/roadmaps/${encodeURIComponent(graph.roadmap.id)}`,
        { replace: true },
      );
    } catch (reason) {
      setError(errorText(reason));
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
      setSaveState(
        reason instanceof SpaceRequestError && reason.status === 409 ? "conflict" : "unsaved",
      );
    } finally {
      savingRef.current = false;
    }
  };
  if (!roadmapId)
    return (
      <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] bg-charcoal-bg">
        <header className="flex min-h-11 flex-wrap items-center gap-2 border-b border-charcoal-border bg-charcoal-bg px-3 py-1.5">
          <h1 className="m-0 shrink-0 text-sm font-semibold">Views</h1>
          {canManage && !(createRequested || !roadmaps.length) ? (
            <div className="ml-auto flex items-center gap-3">
              <Button
                className="h-8 gap-1.5 text-xs"
                onClick={() => navigate({ pathname: location.pathname, search: "?create=roadmap" })}
              >
                <Plus className="size-3.5" />
                New roadmap
              </Button>
            </div>
          ) : null}
        </header>
        <main className="min-h-0 overflow-auto p-6">
          <div className="mx-auto max-w-4xl">
            {error ? <ErrorBanner message={error} onRetry={() => void load()} /> : null}
            {canManage && (createRequested || !roadmaps.length) ? (
              <div className="mb-6 flex max-w-lg gap-2 rounded-xl border border-charcoal-border/70 bg-charcoal-card p-4">
                <Input
                  autoFocus
                  placeholder="Roadmap name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  onKeyDown={(event) => event.key === "Enter" && void createRoadmap()}
                />
                <Button disabled={!name.trim() || loading} onClick={() => void createRoadmap()}>
                  {loading ? (
                    <LoaderCircle className="size-4 animate-spin" />
                  ) : (
                    <Plus className="size-4" />
                  )}
                  Create
                </Button>
              </div>
            ) : null}
            <div className="overflow-hidden rounded-xl border border-charcoal-border/70 bg-charcoal-card">
              {roadmaps.map((roadmap) => (
                <article
                  className="flex min-h-20 items-center gap-3 border-t border-charcoal-border/60 px-4 py-3 first:border-t-0"
                  key={roadmap.id}
                >
                  <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-charcoal-card text-cream-muted">
                    <GitFork className="size-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <strong className="block truncate text-sm font-medium">{roadmap.name}</strong>
                    <span className="mt-0.5 block truncate text-xs text-cream-muted">
                      {roadmap.description || "No description yet"}
                    </span>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      navigate(
                        `/spaces/${encodeURIComponent(spaceId)}/planner/roadmaps/${encodeURIComponent(roadmap.id)}`,
                      )
                    }
                  >
                    <SquarePen className="size-4" />
                    Open editor
                  </Button>
                </article>
              ))}
              {!roadmaps.length && !loading ? (
                <div className="p-10 text-center text-sm text-cream-muted">No roadmaps yet.</div>
              ) : null}
            </div>
          </div>
        </main>
      </div>
    );
  if (loading && !snapshot)
    return (
      <div className="grid h-full place-items-center">
        <LoaderCircle className="size-5 animate-spin text-cream-muted" />
      </div>
    );
  if (!snapshot)
    return (
      <div className="p-6">
        <ErrorBanner
          message={error || "This roadmap is unavailable."}
          onRetry={() => void load()}
        />
      </div>
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
  const saveLayout = (nodes: RoadmapNode[]) =>
    void mutate(
      async (version) => {
        const layout = {
          milestones: snapshot.milestones.map((item) => {
            const node = nodes.find((candidate) => candidate.id === item.id);
            return {
              id: item.id,
              position_x: node?.position.x ?? item.position_x,
              position_y: node?.position.y ?? item.position_y,
              width: Number(node?.measured?.width ?? node?.style?.width ?? item.width),
              height: Number(node?.measured?.height ?? node?.style?.height ?? item.height),
            };
          }),
          goals: snapshot.goals.map((item) => {
            const node = nodes.find((candidate) => candidate.id === item.id);
            return {
              id: item.id,
              milestone_id: node?.parentId ?? item.milestone_id,
              position_x: node?.position.x ?? item.position_x,
              position_y: node?.position.y ?? item.position_y,
            };
          }),
          nodes: snapshot.nodes.map((item) => {
            const node = nodes.find((candidate) => candidate.id === item.id);
            return {
              id: item.id,
              milestone_id: node?.parentId,
              position_x: node?.position.x ?? item.position_x,
              position_y: node?.position.y ?? item.position_y,
            };
          }),
        };
        try {
          return await spacesApi.updateRoadmapLayout(spaceId, snapshot.roadmap.id, layout, version);
        } catch (reason) {
          if (!(reason instanceof SpaceRequestError) || reason.status !== 409) throw reason;
          const latest = await spacesApi.roadmap(spaceId, snapshot.roadmap.id);
          return spacesApi.updateRoadmapLayout(
            spaceId,
            snapshot.roadmap.id,
            layout,
            latest.roadmap.graph_version,
          );
        }
      },
      (current, result) => applyRoadmapLayout(current, nodes, result.graph_version),
    );

  return (
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
      retryConflict={retryConflict}
      archiveRoadmap={archiveRoadmap}
      addPaletteItem={addPaletteItem}
      saveLayout={saveLayout}
      setSaveState={setSaveState}
      setSelectedId={setSelectedId}
      setExpandedGoalIds={setExpandedGoalIds}
      setNodeDrawerOpen={setNodeDrawerOpen}
      setPlacementRequest={setPlacementRequest}
    />
  );
}
