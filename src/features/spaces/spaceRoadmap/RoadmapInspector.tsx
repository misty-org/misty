import { useEffect, useState } from "react";
import { Archive, CheckCircle2 } from "lucide-react";
import type { SpaceTask } from "@/models/interfaces/features/spaces/types";
import type {
  SpaceRoadmapEdge,
  SpaceRoadmapGoal,
  SpaceRoadmapMilestone,
  SpaceRoadmapNode,
  SpaceRoadmapSnapshot,
} from "@/models/interfaces/features/spaces/plannerExpansionTypes";
import {
  Button,
  Checkbox,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from "@/ui";
import { allowedRoadmapEdgeTypes, roadmapEdgeLabels } from "./roadmapNodeCatalog";
import { RoadmapNodeForm } from "./RoadmapNodeInspectorForm";
import { useRoadmapAutosave } from "./useRoadmapAutosave";
export function RoadmapInspector(props: {
  snapshot: SpaceRoadmapSnapshot;
  selectedId: string;
  canManage: boolean;
  tasks: SpaceTask[];
  onUpdateMilestone: (value: SpaceRoadmapMilestone) => void;
  onUpdateGoal: (value: SpaceRoadmapGoal, manual?: boolean) => void;
  onTasks: (goal: SpaceRoadmapGoal, taskIds: string[]) => void;
  onArchive: (value: SpaceRoadmapMilestone | SpaceRoadmapGoal) => void;
  onUpdateNode: (value: SpaceRoadmapNode) => void;
  onArchiveNode: (value: SpaceRoadmapNode) => void;
  onUpdateEdge: (value: SpaceRoadmapEdge) => void;
  onDeleteEdge: (value: SpaceRoadmapEdge) => void;
  onDirty: () => void;
  onUpdateRoadmap: (value: SpaceRoadmapSnapshot["roadmap"]) => void;
  onArchiveRoadmap: () => void;
}) {
  const selectedRoadmap =
    props.selectedId === props.snapshot.roadmap.id ? props.snapshot.roadmap : undefined;
  const selectedGoal = props.snapshot.goals.find((item) => item.id === props.selectedId);
  const selectedMilestone = props.snapshot.milestones.find((item) => item.id === props.selectedId);
  const selectedNode = props.snapshot.nodes.find((item) => item.id === props.selectedId);
  const selectedEdge = props.snapshot.edges.find((item) => item.id === props.selectedId);
  if (!selectedRoadmap && !selectedGoal && !selectedMilestone && !selectedNode && !selectedEdge)
    return (
      <aside className="grid h-full place-items-center border-t border-border/70 p-5 text-center text-xs text-muted-foreground xl:border-l xl:border-t-0">
        <span>Select a milestone, goal, planning node, or connection to inspect it.</span>
      </aside>
    );
  return (
    <aside className="min-h-0 overflow-auto border-t border-border/70 bg-background p-4 xl:border-l xl:border-t-0">
      {selectedRoadmap ? (
        <RoadmapForm
          roadmap={selectedRoadmap}
          canManage={props.canManage}
          onSave={props.onUpdateRoadmap}
          onArchive={props.onArchiveRoadmap}
          onDirty={props.onDirty}
        />
      ) : selectedEdge ? (
        <EdgeForm
          edge={selectedEdge}
          canManage={props.canManage}
          onSave={props.onUpdateEdge}
          onDelete={() => props.onDeleteEdge(selectedEdge)}
          onDirty={props.onDirty}
          snapshot={props.snapshot}
        />
      ) : selectedNode ? (
        <RoadmapNodeForm
          key={`${selectedNode.id}:${selectedNode.version}`}
          node={selectedNode}
          snapshot={props.snapshot}
          canManage={props.canManage}
          onSave={props.onUpdateNode}
          onArchive={() => props.onArchiveNode(selectedNode)}
          onDirty={props.onDirty}
        />
      ) : selectedGoal ? (
        <GoalForm
          key={`${selectedGoal.id}:${selectedGoal.version}`}
          goal={selectedGoal}
          tasks={props.tasks}
          canManage={props.canManage}
          onSave={props.onUpdateGoal}
          onTasks={props.onTasks}
          onArchive={() => props.onArchive(selectedGoal)}
          onDirty={props.onDirty}
        />
      ) : selectedMilestone ? (
        <MilestoneForm
          key={`${selectedMilestone.id}:${selectedMilestone.version}`}
          milestone={selectedMilestone}
          canManage={props.canManage}
          onSave={props.onUpdateMilestone}
          onArchive={() => props.onArchive(selectedMilestone)}
          onDirty={props.onDirty}
        />
      ) : null}
    </aside>
  );
}

function RoadmapForm({
  roadmap,
  canManage,
  onSave,
  onArchive,
  onDirty,
}: {
  roadmap: SpaceRoadmapSnapshot["roadmap"];
  canManage: boolean;
  onSave: (value: SpaceRoadmapSnapshot["roadmap"]) => void;
  onArchive: () => void;
  onDirty: () => void;
}) {
  const [draft, setDraft] = useState(roadmap);
  const autosave = useRoadmapAutosave(draft, onSave, onDirty);
  return (
    <div className="grid gap-4">
      <Header title="Roadmap" status={`Version ${roadmap.graph_version}`} />
      <Field label="Name">
        <Input
          value={draft.name}
          disabled={!canManage}
          onChange={(event) => {
            autosave.markDirty();
            setDraft({ ...draft, name: event.target.value });
          }}
          onBlur={() => draft.name.trim() && autosave.flush()}
        />
      </Field>
      <Field label="Description">
        <Textarea
          value={draft.description}
          disabled={!canManage}
          onChange={(event) => {
            autosave.markDirty();
            setDraft({ ...draft, description: event.target.value });
          }}
          onBlur={autosave.flush}
        />
      </Field>
      {canManage ? (
        <Button variant="ghost" className="justify-start text-destructive" onClick={onArchive}>
          <Archive className="size-4" />
          Archive roadmap
        </Button>
      ) : null}
    </div>
  );
}

function EdgeForm({
  edge,
  canManage,
  onSave,
  onDelete,
  onDirty,
  snapshot,
}: {
  edge: SpaceRoadmapEdge;
  canManage: boolean;
  onSave: (value: SpaceRoadmapEdge) => void;
  onDelete: () => void;
  onDirty: () => void;
  snapshot: SpaceRoadmapSnapshot;
}) {
  const [draft, setDraft] = useState(edge);
  const autosave = useRoadmapAutosave(draft, onSave, onDirty);
  const sourceNodeKind = snapshot.nodes.find((item) => item.id === edge.source.id)?.node_kind;
  const allowedTypes = allowedRoadmapEdgeTypes(edge.source, edge.target, sourceNodeKind);
  return (
    <div className="grid gap-4">
      <Header title="Connection" status={edge.edge_type} />
      <Field label="Type">
        <div className="grid grid-cols-2 gap-2">
          {allowedTypes.map((type) => (
            <Button
              key={type}
              size="sm"
              variant={draft.edge_type === type ? "secondary" : "outline"}
              disabled={!canManage}
              onClick={() => {
                const next = { ...draft, edge_type: type };
                setDraft(next);
                onSave(next);
              }}
            >
              {roadmapEdgeLabels[type]}
            </Button>
          ))}
        </div>
      </Field>
      <Field label="Label">
        <Input
          value={draft.label}
          disabled={!canManage}
          placeholder="Optional label"
          onChange={(event) => {
            autosave.markDirty();
            setDraft({ ...draft, label: event.target.value });
          }}
          onBlur={autosave.flush}
        />
      </Field>
      {canManage ? (
        <Button variant="ghost" className="justify-start text-destructive" onClick={onDelete}>
          <Archive className="size-4" />
          Remove connection
        </Button>
      ) : null}
    </div>
  );
}

function MilestoneForm({
  milestone,
  canManage,
  onSave,
  onArchive,
  onDirty,
}: {
  milestone: SpaceRoadmapMilestone;
  canManage: boolean;
  onSave: (value: SpaceRoadmapMilestone) => void;
  onArchive: () => void;
  onDirty: () => void;
}) {
  const [draft, setDraft] = useState(milestone);
  useEffect(() => setDraft(milestone), [milestone]);
  const autosave = useRoadmapAutosave(draft, onSave, onDirty);
  return (
    <div className="grid gap-4">
      <Header title="Milestone" status={`${milestone.goal_done}/${milestone.goal_total} goals`} />
      <Field label="Title">
        <Input
          value={draft.title}
          disabled={!canManage}
          onChange={(event) => {
            autosave.markDirty();
            setDraft({ ...draft, title: event.target.value });
          }}
          onBlur={() => draft.title.trim() && autosave.flush()}
        />
      </Field>
      <Field label="Description">
        <Textarea
          value={draft.description}
          disabled={!canManage}
          onChange={(event) => {
            autosave.markDirty();
            setDraft({ ...draft, description: event.target.value });
          }}
          onBlur={autosave.flush}
        />
      </Field>
      <Field label="Target date">
        <Input
          type="date"
          value={draft.target_date?.slice(0, 10) ?? ""}
          disabled={!canManage}
          onChange={(event) => {
            autosave.markDirty();
            setDraft({
              ...draft,
              target_date: event.target.value ? `${event.target.value}T00:00:00Z` : undefined,
            });
          }}
          onBlur={autosave.flush}
        />
      </Field>
      {canManage ? (
        <Button variant="ghost" className="justify-start text-destructive" onClick={onArchive}>
          <Archive className="size-4" />
          Archive milestone
        </Button>
      ) : null}
    </div>
  );
}

function GoalForm({
  goal,
  tasks,
  canManage,
  onSave,
  onTasks,
  onArchive,
  onDirty,
}: {
  goal: SpaceRoadmapGoal;
  tasks: SpaceTask[];
  canManage: boolean;
  onSave: (value: SpaceRoadmapGoal, manual?: boolean) => void;
  onTasks: (goal: SpaceRoadmapGoal, ids: string[]) => void;
  onArchive: () => void;
  onDirty: () => void;
}) {
  const [draft, setDraft] = useState(goal);
  const autosave = useRoadmapAutosave(draft, (value) => onSave(value), onDirty);
  const linked = new Set(goal.tasks.map((task) => task.id));
  return (
    <div className="grid gap-4">
      <Header title="Goal" status={`${goal.progress_percentage}% complete`} />
      <Field label="Title">
        <Input
          value={draft.title}
          disabled={!canManage}
          onChange={(event) => {
            autosave.markDirty();
            setDraft({ ...draft, title: event.target.value });
          }}
          onBlur={() => draft.title.trim() && autosave.flush()}
        />
      </Field>
      <Field label="Description">
        <Textarea
          value={draft.description}
          disabled={!canManage}
          onChange={(event) => {
            autosave.markDirty();
            setDraft({ ...draft, description: event.target.value });
          }}
          onBlur={autosave.flush}
        />
      </Field>
      <Field label="Target date">
        <Input
          type="date"
          value={draft.target_date?.slice(0, 10) ?? ""}
          disabled={!canManage}
          onChange={(event) => {
            autosave.markDirty();
            setDraft({
              ...draft,
              target_date: event.target.value ? `${event.target.value}T00:00:00Z` : undefined,
            });
          }}
          onBlur={autosave.flush}
        />
      </Field>
      {canManage && goal.task_total === 0 ? (
        <Button variant="outline" onClick={() => onSave(draft, goal.status !== "done")}>
          <CheckCircle2 className="size-4" />
          {goal.status === "done" ? "Reopen goal" : "Mark complete"}
        </Button>
      ) : null}
      <Field label="Linked tasks">
        <div className="max-h-48 overflow-auto rounded-md border border-border/70 p-1">
          {tasks.map((task) => (
            <label
              className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-muted/50"
              key={task.id}
            >
              <Checkbox
                checked={linked.has(task.id)}
                disabled={!canManage}
                onCheckedChange={(checked) => {
                  const next = new Set(linked);
                  if (checked === true) next.add(task.id);
                  else next.delete(task.id);
                  onTasks(goal, [...next]);
                }}
              />
              <span className="truncate">{task.title}</span>
            </label>
          ))}
          {!tasks.length ? (
            <p className="px-2 text-xs text-muted-foreground">No active tasks.</p>
          ) : null}
        </div>
      </Field>
      {canManage ? (
        <Button variant="ghost" className="justify-start text-destructive" onClick={onArchive}>
          <Archive className="size-4" />
          Archive goal
        </Button>
      ) : null}
    </div>
  );
}

function Header({ title, status }: { title: string; status: string }) {
  return (
    <div>
      <p className="m-0 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">{status}</p>
    </div>
  );
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1.5 text-xs font-medium">
      {label}
      {children}
    </label>
  );
}
