import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useUserStore } from "@/features/account/core";
import { AppLogo } from "@misty/ui";
import { officialAppRoute } from "../apps/appRoutes";
import { plannerApi, type SpaceTask } from "../planner/api";
import { OverviewCard, OverviewEmpty, OverviewRow, OverviewRowsSkeleton } from "./OverviewCard";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** The tasks assigned to the person that are open and due within a week, or already late. */
export function tasksDueSoon(tasks: SpaceTask[], me: string, now: number): SpaceTask[] {
  return tasks
    .filter(
      (task) =>
        task.assignee_user_id === me &&
        task.status !== "done" &&
        task.status !== "canceled" &&
        task.due_at !== undefined &&
        new Date(task.due_at).getTime() <= now + WEEK_MS,
    )
    .sort((left, right) => (left.due_at ?? "").localeCompare(right.due_at ?? ""));
}

/**
 * What is waiting for the person in this Space: for now, their tasks due this week, opening the Planner. A
 * mention of them in a channel and a handoff another member passed them join it as they get a source.
 */
export function ForYouCard({ spaceId }: { spaceId: string }) {
  const navigate = useNavigate();
  const me = useUserStore((state) => state.me?.id ?? "");
  const [tasks, setTasks] = useState<SpaceTask[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    setFailed(false);
    plannerApi.tasks(spaceId).then(
      (result) => live && setTasks(result.tasks),
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
  }, [spaceId]);

  // A Space whose planner can't be read leaves the card out rather than saying nothing is due.
  if (failed) return null;
  if (!tasks)
    return (
      <OverviewCard title="For you">
        <OverviewRowsSkeleton rows={2} trailing={false} />
      </OverviewCard>
    );
  const due = tasksDueSoon(tasks, me, Date.now());
  return (
    <OverviewCard title="For you">
      {due.length ? (
        <OverviewRow
          leading={<AppLogo app="planner" size="row" />}
          title={`${due.length} ${due.length === 1 ? "task" : "tasks"} due this week`}
          detail={due
            .slice(0, 2)
            .map((task) => task.title)
            .join(" · ")}
          trailing="Planner"
          onOpen={() => navigate(officialAppRoute(spaceId, "planner"))}
        />
      ) : (
        <OverviewEmpty>Nothing is waiting for you.</OverviewEmpty>
      )}
    </OverviewCard>
  );
}
