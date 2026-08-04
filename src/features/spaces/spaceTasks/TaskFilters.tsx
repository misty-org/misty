import {
  Button,
  Checkbox,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/ui";
import type { SpaceAgentMembership, SpaceMember } from "@/models/interfaces/features/spaces/types";

type Option = [value: string, label: string];

const statusOptions: Option[] = [
  ["all", "Any status"],
  ["todo", "To do"],
  ["in_progress", "In progress"],
  ["done", "Done"],
  ["canceled", "Canceled"],
];
const priorityOptions: Option[] = [
  ["all", "Any priority"],
  ["high", "High"],
  ["medium", "Medium"],
  ["low", "Low"],
];
const dueOptions: Option[] = [
  ["all", "Any due date"],
  ["overdue", "Overdue"],
  ["today", "Today"],
  ["week", "Next 7 days"],
  ["no_due", "No due date"],
];
const sortOptions: Option[] = [
  ["rank", "Rank"],
  ["due", "Due date"],
  ["updated", "Updated"],
];

export interface TaskFiltersProps {
  members: SpaceMember[];
  agents: SpaceAgentMembership[];
  status: string;
  assignee: string;
  priority: string;
  due: string;
  mine: boolean;
  sort: string;
  onChange: (key: string, value?: string) => void;
  onClear: () => void;
}

export function TaskFilters(props: TaskFiltersProps) {
  const assigneeOptions: Option[] = [
    ["all", "Any assignee"],
    ["unassigned", "Unassigned"],
    ...props.members.map((member): Option => [`person:${member.user_id}`, member.name]),
    ...props.agents
      .filter((agent) => agent.enabled)
      .map((agent): Option => [`agent:${agent.agent_id}`, `${agent.name} · Agent`]),
  ];

  return (
    <div className="grid gap-3" aria-label="Task filters">
      <div>
        <h3 className="m-0 text-sm font-semibold">Filter tasks</h3>
        <p className="mb-0 mt-1 text-xs text-muted-foreground">Narrow the current task view.</p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <TaskFilterSelect
          label="Status"
          value={props.status}
          options={statusOptions}
          onChange={(value) => props.onChange("status", value)}
        />
        <TaskFilterSelect
          label="Assignee"
          value={props.assignee}
          options={assigneeOptions}
          onChange={(value) => props.onChange("assignee", value)}
        />
        <TaskFilterSelect
          label="Priority"
          value={props.priority}
          options={priorityOptions}
          onChange={(value) => props.onChange("priority", value)}
        />
        <TaskFilterSelect
          label="Due date"
          value={props.due}
          options={dueOptions}
          onChange={(value) => props.onChange("due", value)}
        />
        <TaskFilterSelect
          label="Sort"
          value={props.sort}
          options={sortOptions}
          onChange={(value) => props.onChange("sort", value)}
        />
        <label className="flex h-9 items-center gap-2 rounded-md border px-3 text-xs">
          <Checkbox
            checked={props.mine}
            onCheckedChange={(checked) =>
              props.onChange("mine", checked === true ? "1" : undefined)
            }
          />
          Assigned to me
        </label>
      </div>
      <Button
        className="justify-self-end"
        size="sm"
        variant="ghost"
        type="button"
        onClick={props.onClear}
      >
        Clear filters
      </Button>
    </div>
  );
}

function TaskFilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Option[];
  onChange: (value: string) => void;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-9 w-full text-xs" aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map(([id, name]) => (
          <SelectItem value={id} key={id}>
            {name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
