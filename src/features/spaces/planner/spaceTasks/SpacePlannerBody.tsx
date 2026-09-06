import type {
  SpaceAgentMembership,
  SpaceMember,
  SpaceTask,
} from "@/api/spaces/dto/interfaces/types";
import type { DueFilter, TaskViewMode } from "@/api/spaces/dto/types/SpacePlanner";
import { Button } from "@/shared/ui";
import { LoaderCircle } from "lucide-react";
import { SpaceTaskBoard, SpaceTaskList } from "../SpacePlannerViews";
import type { ReactNode } from "react";
import { matchesDueFilter } from "./taskFiltering";
import type { SpaceTaskActions } from "./useSpaceTaskActions";
import type { SpaceTasksData } from "./useSpaceTasksData";

export interface SpacePlannerBodyProps {
  renderError(message: string): ReactNode;
  view: TaskViewMode;
  members: SpaceMember[];
  agents: SpaceAgentMembership[];
  canManage: boolean;
  assignee: string;
  due: DueFilter;
  data: SpaceTasksData;
  actions: SpaceTaskActions;
  onDeleteRequest: (task: SpaceTask) => void;
}

/** The task surface itself — board, list or calendar — plus its loading and error states. */
export function SpacePlannerBody(props: SpacePlannerBodyProps) {
  const { view, data, actions, members } = props;
  const visibleTasks = data.tasks.filter(
    (task) =>
      !(props.assignee === "unassigned" && (task.assignee_user_id || task.assignee_agent_id)) &&
      matchesDueFilter(task, props.due),
  );
  const isEmptyLoad = data.loading && !data.tasks.length;

  return (
    // The board owns its own scrolling (horizontal columns, vertical cards); the list does not.
    <section
      className={`min-h-0 ${view === "board" ? "overflow-hidden p-0" : "overflow-auto p-3"}`}
    >
      {data.error ? props.renderError(data.error) : null}
      {isEmptyLoad ? (
        <div className="grid h-full min-h-56 place-items-center text-cream-muted">
          <LoaderCircle className="size-5 animate-spin" aria-label="Loading tasks" />
        </div>
      ) : view === "board" ? (
        <SpaceTaskBoard
          tasks={visibleTasks.filter((task) => task.status !== "canceled")}
          members={members}
          agents={props.agents}
          totals={data.statusTotals}
          busy={actions.busy}
          canManage={props.canManage}
          onOpen={actions.openEdit}
          onMove={actions.moveTask}
          onDelete={props.onDeleteRequest}
          onCreate={actions.quickCreate}
          onOpenFullCreate={actions.openCreate}
        />
      ) : (
        <SpaceTaskList
          tasks={visibleTasks}
          members={members}
          agents={props.agents}
          busy={actions.busy}
          canManage={props.canManage}
          onOpen={actions.openEdit}
          onUpdate={actions.updateTask}
          onDelete={props.onDeleteRequest}
        />
      )}

      {data.nextCursor && view === "list" ? (
        <Button
          className="mx-auto mt-4 flex"
          variant="outline"
          disabled={data.loading}
          type="button"
          onClick={() => void data.load(true)}
        >
          {data.loading ? <LoaderCircle className="size-4 animate-spin" /> : null}Load more
        </Button>
      ) : null}
    </section>
  );
}
