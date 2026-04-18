import { LoaderCircle } from "lucide-react";
import { Button } from "@/ui";
import type { TaskViewMode } from "@/models/types/features/spaces/SpaceTasksCalendar";
import type { SpaceCalendarEvent, SpaceMember } from "@/models/interfaces/features/spaces/types";
import { TaskErrorState } from "../SpaceTaskPrimitives";
import { SpaceTaskBoard, SpaceTaskCalendar, SpaceTaskList } from "../SpaceTasksViews";
import type { SpaceTasksData } from "./useSpaceTasksData";
import type { SpaceTaskActions } from "./useSpaceTaskActions";
import { matchesDueFilter } from "./taskFiltering";
import type { DueFilter } from "@/models/types/features/spaces/SpaceTasksCalendar";

export interface SpaceTasksBodyProps {
  view: TaskViewMode;
  members: SpaceMember[];
  canManage: boolean;
  assignee: string;
  due: DueFilter;
  data: SpaceTasksData;
  actions: SpaceTaskActions;
  onOpenEvent: (event: SpaceCalendarEvent) => void;
}

/** The task surface itself — board, list or calendar — plus its loading and error states. */
export function SpaceTasksBody(props: SpaceTasksBodyProps) {
  const { view, data, actions, members } = props;
  const visibleTasks = data.tasks.filter(
    (task) =>
      !(props.assignee === "unassigned" && task.assignee_user_id) &&
      matchesDueFilter(task, props.due),
  );
  const isEmptyLoad = data.loading && !data.tasks.length && !data.events.length;

  return (
    // The board owns its own scrolling (horizontal columns, vertical cards); the list does not.
    <section className={`min-h-0 p-4 ${view === "board" ? "overflow-hidden" : "overflow-auto"}`}>
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
          totals={data.statusTotals}
          busy={actions.busy}
          canManage={props.canManage}
          onOpen={actions.openEdit}
          onMove={actions.moveTask}
          onCreate={actions.quickCreate}
        />
      ) : view === "list" ? (
        <SpaceTaskList
          tasks={visibleTasks}
          members={members}
          busy={actions.busy}
          canManage={props.canManage}
          onOpen={actions.openEdit}
          onUpdate={actions.updateTask}
        />
      ) : (
        <SpaceTaskCalendar
          month={data.month}
          tasks={visibleTasks}
          events={data.events}
          members={members}
          onMonth={data.setMonth}
          onOpenTask={actions.openEdit}
          onOpenEvent={props.onOpenEvent}
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
