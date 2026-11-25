import { TurnTasks, type TurnTask, type TurnTaskState } from "@misty/ui";
import { checklistForInvocation, nestChildren } from "./checklists";
import { useCollaborationStore } from "./store";
import type { AgentChecklist as Checklist, ChecklistItem } from "./plan_types";

type ChecklistHold = "stopped" | "waiting_for_you" | { device: string } | undefined;

function holdText(hold: ChecklistHold) {
  if (!hold) return undefined;
  if (hold === "stopped") return "Stopped";
  if (hold === "waiting_for_you") return "Waiting for you";
  return `Waiting for ${hold.device}`;
}

const stateOf: Record<ChecklistItem["status"], TurnTaskState> = {
  pending: "pending",
  in_progress: "working",
  done: "done",
  skipped: "skipped",
  blocked: "failed",
};

function tasksOf(
  items: ChecklistItem[],
  hold: ChecklistHold,
  nested?: Map<string, Checklist[]>,
  depth = 0,
): TurnTask[] {
  const held = holdText(hold);
  return items.flatMap((item) => {
    const paused = item.status === "in_progress" && held;
    const task: TurnTask = {
      id: `${depth}:${item.id}`,
      title: item.title,
      state: paused ? (hold === "stopped" ? "pending" : "waiting") : stateOf[item.status],
      note: paused ? [held, item.note].filter(Boolean).join(", ") : item.note,
      depth,
    };
    const children = (nested?.get(item.id) ?? []).flatMap((child) =>
      tasksOf(child.items, hold, undefined, depth + 1),
    );
    return [task, ...children];
  });
}

export function AgentMessageChecklist(props: {
  conversationId?: string;
  invocationId?: string;
  running: boolean;
  hold?: ChecklistHold;
}) {
  const state = useCollaborationStore((s) =>
    props.conversationId ? s.byConversation[props.conversationId] : undefined,
  );
  if (!props.invocationId || !state) return null;
  const { checklist, children } = checklistForInvocation(state.checklists, props.invocationId);
  if (!checklist?.items.length) return null;
  const unfinished = checklist.items.some(
    (item) => item.status !== "done" && item.status !== "skipped",
  );
  if (!props.running && !unfinished) return null;
  const stopped = !props.running && checklist.items.some((item) => item.status === "in_progress");
  return (
    <TurnTasks
      label="Checklist"
      tasks={tasksOf(
        checklist.items,
        props.hold ?? (stopped ? "stopped" : undefined),
        nestChildren(checklist.items, children),
      )}
    />
  );
}
