const localEvent = "misty:space-planner-changed";
/** Dispatched for every `task.` and `calendar.` realtime event of a Space. */
export const realtimePlannerEvent = "misty:space-planner-event";

type Kind = "task" | "calendar";

/** Tells this window's other planner views that a Space's tasks or events changed here. */
export function notifyPlannerChanged(spaceId: string, kind: Kind): void {
  window.dispatchEvent(new CustomEvent(localEvent, { detail: { spaceId, kind } }));
}

/** Calls `listener` when a Space's tasks or events change, here or on someone else's computer. */
export function subscribeToPlannerChanges(
  spaceId: string,
  kind: Kind,
  listener: () => void,
): () => void {
  const local = (event: Event) => {
    const detail = (event as CustomEvent<{ spaceId?: string; kind?: Kind }>).detail;
    if (detail?.spaceId === spaceId && detail.kind === kind) listener();
  };
  const realtime = (event: Event) => {
    const detail = (event as CustomEvent<{ space_id?: string; type?: string }>).detail;
    if (detail?.space_id === spaceId && detail.type?.startsWith(`${kind}.`)) listener();
  };
  window.addEventListener(localEvent, local);
  window.addEventListener(realtimePlannerEvent, realtime);
  return () => {
    window.removeEventListener(localEvent, local);
    window.removeEventListener(realtimePlannerEvent, realtime);
  };
}
