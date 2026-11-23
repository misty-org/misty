import { cn, Text, type TextTone } from "@misty/ui";
import type { RunRow } from "./activity_api";

const stateLabel: Record<RunRow["state"], string> = {
  running: "Working",
  "needs-you": "Waiting for you",
  completed: "Done",
  failed: "Didn't finish",
  canceled: "Stopped",
};

const dotTone: Partial<Record<RunRow["state"] | "idle", TextTone>> = {
  running: "working",
  "needs-you": "waiting",
  failed: "failed",
};

export function RunStateBadge({
  state,
  tone = "muted",
}: {
  state: RunRow["state"] | "idle";
  tone?: "muted" | "default";
}) {
  const label = state === "idle" ? "Idle" : stateLabel[state];
  const dot = dotTone[state];
  return (
    <Text
      bare
      size="caption"
      tone={tone}
      className="inline-flex shrink-0 items-center gap-1.5"
      data-state={state}
    >
      <Text
        bare
        tone={dot ?? "muted"}
        aria-hidden="true"
        className={cn("size-2 rounded-full bg-current", !dot && "opacity-70")}
      />
      {label}
    </Text>
  );
}

export function runWhen(at: number, now: number): string {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return "";
  const time = date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (new Date(now).toDateString() === date.toDateString()) return time;
  return `${date.toLocaleDateString(undefined, { month: "short", day: "numeric" })}, ${time}`;
}
