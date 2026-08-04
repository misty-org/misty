import { LoaderCircle } from "lucide-react";
import { Button } from "@/ui";
import type { TaskViewMode } from "@/models/types/features/spaces/SpacePlanner";
import type { SpaceAgentMembership, SpaceMember } from "@/models/interfaces/features/spaces/types";
import { TaskErrorState } from "../SpaceTaskPrimitives";
import { SpaceTaskBoard, SpaceTaskList } from "../SpacePlannerViews";
import type { SpaceTasksData } from "./useSpaceTasksData";
import type { SpaceTaskActions } from "./useSpaceTaskActions";
import { matchesDueFilter } from "./taskFiltering";
import type { DueFilter } from "@/models/types/features/spaces/SpacePlanner";

export interface SpacePlannerBodyProps {
  view: TaskViewMode;
  members: SpaceMember[];
  agents: SpaceAgentMembership[];
  canManage: boolean;
  assignee: string;
  due: DueFilter;
  data: SpaceTasksData;
  actions: SpaceTaskActions;
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
      {data.error ? (
        <TaskErrorState message={data.error} onDismiss={() => data.setError("")} />
      ) : null}
      {data.calendarNotice ? (
        <p
          className="mx-0 mb-3 mt-0 rounded-md bg-muted/55 px-3 py-2 text-xs text-muted-foreground"
          role="status"
        >
          {data.calendarNotice}
        </p>
      ) : null}

      {isEmptyLoad ? (
        <div className="grid h-full min-h-56 place-items-center text-muted-foreground">
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
          onCreate={actions.quickCreate}
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
