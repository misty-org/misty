import type { useMistyStore } from "@/features/misty/useMistyStore";
import { cn } from "@/shared/ui";
import type { GlobalAiMessage } from "@/features/global-search/types";
import type { Execution } from "./localExecution";
import { toolLabel } from "./progress/progressTimeline";

export const islandClass = cn(
  "pointer-events-auto fixed inset-x-0 bottom-4 layer-workspace-overlay mx-auto flex flex-col gap-2",
  "w-[min(560px,calc(100dvw-32px))] rounded-2xl border border-charcoal-border bg-charcoal-card",
  "p-2 text-cream shadow-lg",
);

export const settled = new Set(["completed", "failed", "canceled", "cancelled"]);

export function liveReply(
  state: ReturnType<typeof useMistyStore.getState>,
): GlobalAiMessage | undefined {
  const conversation = state.conversations.find((c) => c.id === state.activeConversationId);
  const messages = conversation?.messages ?? [];
  let reply: GlobalAiMessage | undefined;
  for (let index = messages.length - 1; index >= 0 && !reply; index--)
    if (messages[index].role === "assistant") reply = messages[index];
  return reply?.state === "streaming" || reply?.state === "pending" ? reply : undefined;
}

/** What the run is doing now, from the live reply: its activity or latest step. */
export function liveStep(state: ReturnType<typeof useMistyStore.getState>) {
  const reply = liveReply(state);
  if (!reply) return "";
  if (reply.activity) return reply.activity;
  const last = reply.progress?.[reply.progress.length - 1];
  if (last?.type === "tool") return toolLabel(last.name, last.state === "running");
  return last?.text ?? "";
}

export function statusText(
  execution: Execution,
  name: string,
  step: string,
  waiting: string,
  stopped: boolean,
) {
  if (execution.state === "running")
    return (
      step ||
      (execution.desktopControl
        ? `${name} is working with its own cursor`
        : execution.autopilot
          ? `${name} is controlling Misty`
          : `${name} is working`)
    );
  if (execution.state === "waiting")
    return waiting || `${name} is waiting for you. Press Done when you're finished.`;
  if (execution.state === "paused")
    return stopped
      ? "Stopped. Completed changes have not been undone."
      : "Paused. You have control.";
  return "Task finished. Review the result, then press Done.";
}
