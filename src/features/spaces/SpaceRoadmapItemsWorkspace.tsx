import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CalendarDays,
  CheckCircle2,
  Flag,
  GitFork,
  LoaderCircle,
  Plus,
  Target,
} from "lucide-react";
import { errorText } from "@/lib/format";
import type { SpaceTask } from "@/models/interfaces/features/spaces/types";
import type {
  SpaceRoadmap,
  SpaceRoadmapGoal,
  SpaceRoadmapMilestone,
  SpaceRoadmapSnapshot,
} from "@/models/interfaces/features/spaces/plannerExpansionTypes";
import { spacesApi } from "@/stores/spaces/useSpacesBackendStore";
import {
  Button,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/ui";
import { ErrorBanner } from "./spaceRoadmap/RoadmapEditor";
import { GoalForm, MilestoneForm } from "./spaceRoadmap/RoadmapInspector";

type ItemKind = "goal" | "milestone";

export function SpaceRoadmapItemsWorkspace({
  spaceId,
  kind,
  canManage,
}: {
  spaceId: string;
  kind: ItemKind;
  canManage: boolean;
}) {
  const [roadmaps, setRoadmaps] = useState<SpaceRoadmap[]>([]);
  const [snapshots, setSnapshots] = useState<SpaceRoadmapSnapshot[]>([]);
  const [tasks, setTasks] = useState<SpaceTask[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = await spacesApi.roadmaps(spaceId);
      const [graphs, taskPage] = await Promise.all([
        Promise.all(list.roadmaps.map((roadmap) => spacesApi.roadmap(spaceId, roadmap.id))),
        kind === "goal"
          ? spacesApi.tasks(spaceId, { limit: 200 })
          : Promise.resolve({ tasks: [] as SpaceTask[] }),
      ]);
      setRoadmaps(list.roadmaps);
      setSnapshots(graphs);
      setTasks(taskPage.tasks.filter((task) => !task.archived_at && task.status !== "canceled"));
      setError("");
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setLoading(false);
    }
  }, [kind, spaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = useMemo(
    () =>
      snapshots
        .flatMap((snapshot) =>
          (kind === "goal" ? snapshot.goals : snapshot.milestones).map((item) => ({
            item,
            snapshot,
            roadmap: snapshot.roadmap,
          })),
        )
        .sort((left, right) => left.item.rank - right.item.rank),
    [kind, snapshots],
  );

  const mutate = async (roadmapId: string, action: (version: number) => Promise<unknown>) => {
    const graph = snapshots.find((snapshot) => snapshot.roadmap.id === roadmapId);
    if (!graph || saving) return;
    setSaving(true);
    try {
      await action(graph.roadmap.graph_version);
      await load();
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setSaving(false);
    }
  };

  const title = kind === "goal" ? "Goals" : "Milestones";
  const Icon = kind === "goal" ? Target : Flag;

  return (
    <main className="h-full overflow-auto bg-background p-6">
      <div className="mx-auto max-w-5xl">
        <header className="mb-6 flex items-start gap-3">
          <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
            <Icon className="size-4" />
          </div>
          <div>
            <h1 className="m-0 text-xl font-semibold">{title}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Configure {title.toLowerCase()} across every roadmap in this Space.
            </p>
          </div>
          {canManage ? (
            <CreateRoadmapItem
              className="ml-auto"
              kind={kind}
              roadmaps={roadmaps}
              snapshots={snapshots}
              saving={saving}
              onCreate={(roadmapId, values) =>
                mutate(roadmapId, (version) =>
                  kind === "goal"
                    ? spacesApi.createRoadmapGoal(spaceId, roadmapId, values, version)
                    : spacesApi.createRoadmapMilestone(spaceId, roadmapId, values, version),
                )
              }
            />
          ) : null}
        </header>

        {error ? <ErrorBanner message={error} onRetry={() => void load()} /> : null}
        {loading && !snapshots.length ? (
          <div className="grid min-h-48 place-items-center">
            <LoaderCircle className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : rows.length ? (
          <div className="overflow-hidden rounded-xl border border-border/70 bg-card">
            {rows.map(({ item, snapshot, roadmap }, index) => {
              const goal = kind === "goal" ? (item as SpaceRoadmapGoal) : undefined;
              const milestone = kind === "milestone" ? (item as SpaceRoadmapMilestone) : undefined;
              const status = goal?.status ?? milestone?.status ?? "not_started";
              return (
                <Popover
                  key={item.id}
                  open={selectedId === item.id}
                  onOpenChange={(open) => setSelectedId(open ? item.id : "")}
                >
                  <PopoverTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      className={[
                        "h-auto w-full justify-start gap-3 rounded-none px-4 py-3 text-left",
                        "whitespace-normal transition-colors hover:bg-muted/35",
                        index ? "border-t border-border/60" : "",
                      ].join(" ")}
                    >
                      <StatusIcon status={status} />
                      <span className="min-w-0 flex-1">
                        <strong className="block truncate text-sm font-medium">{item.title}</strong>
                        <span className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                          <span className="inline-flex items-center gap-1 truncate">
                            <GitFork className="size-3" />
                            {roadmap.name}
                          </span>
                          {item.target_date ? (
                            <span className="inline-flex shrink-0 items-center gap-1">
                              <CalendarDays className="size-3" />
                              {formatDate(item.target_date)}
                            </span>
                          ) : null}
                        </span>
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {goal
                          ? `${goal.progress_percentage}%`
                          : `${milestone?.goal_done ?? 0}/${milestone?.goal_total ?? 0} goals`}
                      </span>
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent
                    side="right"
                    align="start"
                    collisionPadding={16}
                    className="max-h-[min(620px,calc(100vh-32px))] w-[min(360px,calc(100vw-32px))] overflow-auto p-4"
                  >
                    {goal ? (
                      <GoalForm
                        key={`${goal.id}:${goal.version}`}
                        goal={goal}
                        tasks={tasks}
                        canManage={canManage}
                        onDirty={() => {}}
                        onSave={(value, manual) =>
                          void mutate(roadmap.id, (version) =>
                            spacesApi.updateRoadmapGoal(spaceId, value, version, manual),
                          )
                        }
                        onTasks={(value, ids) =>
                          void mutate(roadmap.id, (version) =>
                            spacesApi.replaceRoadmapGoalTasks(spaceId, value, ids, version),
                          )
                        }
                        onArchive={() =>
                          void mutate(roadmap.id, (version) =>
                            spacesApi.archiveRoadmapGoal(spaceId, goal, version),
                          )
                        }
                      />
                    ) : milestone ? (
                      <MilestoneForm
                        key={`${milestone.id}:${milestone.version}`}
                        milestone={milestone}
                        canManage={canManage}
                        onDirty={() => {}}
                        onSave={(value) =>
                          void mutate(snapshot.roadmap.id, (version) =>
                            spacesApi.updateRoadmapMilestone(spaceId, value, version),
                          )
                        }
                        onArchive={() =>
                          void mutate(snapshot.roadmap.id, (version) =>
                            spacesApi.archiveRoadmapMilestone(spaceId, milestone, version),
                          )
                        }
                      />
                    ) : null}
                  </PopoverContent>
                </Popover>
              );
            })}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-border p-10 text-center">
            <Icon className="mx-auto mb-3 size-5 text-muted-foreground" />
            <p className="m-0 text-sm font-medium">No {title.toLowerCase()} yet</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {roadmaps.length
                ? `Create the first ${kind} from this list.`
                : "Create a roadmap first, then add its planning structure here."}
            </p>
          </div>
        )}
      </div>
    </main>
  );
}

function CreateRoadmapItem({
  className,
  kind,
  roadmaps,
  snapshots,
  saving,
  onCreate,
}: {
  className?: string;
  kind: ItemKind;
  roadmaps: SpaceRoadmap[];
  snapshots: SpaceRoadmapSnapshot[];
  saving: boolean;
  onCreate: (roadmapId: string, values: Partial<SpaceRoadmapGoal | SpaceRoadmapMilestone>) => void;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [roadmapId, setRoadmapId] = useState(roadmaps[0]?.id ?? "");
  const milestones =
    snapshots.find((snapshot) => snapshot.roadmap.id === roadmapId)?.milestones ?? [];
  const [milestoneId, setMilestoneId] = useState("");

  useEffect(() => {
    if (!roadmapId && roadmaps[0]) setRoadmapId(roadmaps[0].id);
  }, [roadmapId, roadmaps]);
  useEffect(() => {
    if (kind === "goal" && !milestones.some((item) => item.id === milestoneId))
      setMilestoneId(milestones[0]?.id ?? "");
  }, [kind, milestoneId, milestones]);

  const canCreate = Boolean(title.trim() && roadmapId && (kind === "milestone" || milestoneId));
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button className={className} disabled={!roadmaps.length}>
          <Plus className="size-4" />
          New {kind}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <div className="grid gap-3">
          <div>
            <p className="m-0 text-sm font-semibold">New {kind}</p>
            <p className="mt-1 text-xs text-muted-foreground">Choose where it belongs.</p>
          </div>
          <Input
            autoFocus
            value={title}
            placeholder={`${kind === "goal" ? "Goal" : "Milestone"} title`}
            onChange={(event) => setTitle(event.target.value)}
          />
          <Select value={roadmapId} onValueChange={setRoadmapId}>
            <SelectTrigger>
              <SelectValue placeholder="Roadmap" />
            </SelectTrigger>
            <SelectContent>
              {roadmaps.map((roadmap) => (
                <SelectItem key={roadmap.id} value={roadmap.id}>
                  {roadmap.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {kind === "goal" ? (
            milestones.length ? (
              <Select value={milestoneId} onValueChange={setMilestoneId}>
                <SelectTrigger>
                  <SelectValue placeholder="Milestone" />
                </SelectTrigger>
                <SelectContent>
                  {milestones.map((milestone) => (
                    <SelectItem key={milestone.id} value={milestone.id}>
                      {milestone.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <p className="m-0 rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
                Add a milestone to this roadmap before creating a goal.
              </p>
            )
          ) : null}
          <Button
            disabled={!canCreate || saving}
            onClick={() => {
              const snapshot = snapshots.find((item) => item.roadmap.id === roadmapId);
              if (!snapshot) return;
              const rank = kind === "goal" ? snapshot.goals.length : snapshot.milestones.length;
              onCreate(roadmapId, {
                title: title.trim(),
                rank,
                ...(kind === "goal"
                  ? {
                      milestone_id: milestoneId,
                      position_x: 80 + rank * 24,
                      position_y: 100 + rank * 24,
                    }
                  : {
                      position_x: 80 + rank * 32,
                      position_y: 80 + rank * 32,
                      width: 460,
                      height: 340,
                    }),
              });
              setTitle("");
              setOpen(false);
            }}
          >
            {saving ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              <Plus className="size-4" />
            )}
            Create
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function StatusIcon({ status }: { status: "not_started" | "in_progress" | "done" }) {
  return status === "done" ? (
    <CheckCircle2 className="size-4 shrink-0 text-emerald-500" />
  ) : status === "in_progress" ? (
    <span className="size-4 shrink-0 rounded-full border-4 border-blue-500/70" />
  ) : (
    <span className="size-4 shrink-0 rounded-full border border-muted-foreground/50" />
  );
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      }).format(date);
}
