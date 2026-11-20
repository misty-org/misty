import { useEffect, useState } from "react";
import { useUserStore } from "@/features/account/core";
import { plannerApi } from "../planner/api";
import { subscribeToPlannerChanges } from "../planner/plannerEvents";
import { tasksDueSoon } from "./ForYouCard";

/**
 * How many of the person's tasks in a Space are open and due within a week, kept current as the planner
 * changes, for the Planner's badge. Zero until read, and when the planner can't be read.
 */
export function useTasksDueCount(spaceId: string): number {
  const me = useUserStore((state) => state.me?.id ?? "");
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!spaceId || !me) return;
    let live = true;
    const load = () =>
      plannerApi.tasks(spaceId).then(
        (result) => live && setCount(tasksDueSoon(result.tasks, me, Date.now()).length),
        () => live && setCount(0),
      );
    void load();
    const stop = subscribeToPlannerChanges(spaceId, "task", () => void load());
    return () => {
      live = false;
      stop();
    };
  }, [spaceId, me]);
  return count;
}
