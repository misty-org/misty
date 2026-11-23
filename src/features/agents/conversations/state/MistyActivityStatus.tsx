import { Text } from "@misty/ui";

function taskAwarePhrase(value?: string) {
  const status = value?.trim();
  if (!status || status === "On it." || status === "thinking") return "Thinking";
  const lower = status.toLocaleLowerCase();
  if (lower.includes("file") || lower.includes("library")) return "Searching your files";
  if (lower.includes("message")) return "Searching your messages";
  if (lower.includes("calendar")) return "Checking your calendar";
  if (lower.includes("task")) return "Checking your tasks";
  if (lower.includes("note")) return "Reading your notes";
  if (lower.includes("approval")) return "Waiting for your approval";
  return status.replace(/\s*(?:…|\.{3})\s*$/, "");
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
    <Text
      bare
      as="div"
      tone="muted"
      className={`flex items-center ${compact ? "py-1 text-meta" : "text-control"}`}
      role="status"
      aria-live="polite"
    >
      <span className="misty-shimmer">{useMistyActivityPhrase(activity)}</span>
    </Text>
  );
}
