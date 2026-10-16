import { withoutEllipsis } from "@/shared/ui";

/** What the run is doing, in one shimmering word or phrase; "Thinking" until it says more. */
function taskAwarePhrase(value?: string) {
  const status = value?.trim();
  if (!status || status === "On it." || status === "thinking") return "Thinking";
  const lower = status.toLocaleLowerCase();
  if (lower.includes("weather")) return "Checking the weather";
  if (lower.includes("file") || lower.includes("library")) return "Searching your files";
  if (lower.includes("message")) return "Searching your messages";
  if (lower.includes("calendar")) return "Checking your calendar";
  if (lower.includes("task")) return "Checking your tasks";
  if (lower.includes("note")) return "Reading your notes";
  if (lower.includes("approval")) return "Waiting for your approval";
  return withoutEllipsis(status);
}

export function useMistyActivityPhrase(activity?: string) {
  return taskAwarePhrase(activity);
}

export function MistyActivityStatus({
  activity,
  compact = false,
}: {
  activity?: string;
  compact?: boolean;
}) {
  return (
    <div
      className={`flex items-center text-cream-muted ${compact ? "py-1 text-xs" : "text-[14px]"}`}
      role="status"
      aria-live="polite"
    >
      <span className="misty-shimmer">{useMistyActivityPhrase(activity)}</span>
    </div>
  );
}
