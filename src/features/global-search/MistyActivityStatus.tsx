import { Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

const calmPhrases = [
  "Thinking it through…",
  "Checking the details…",
  "Putting the pieces together…",
  "Working on your answer…",
];

const patientPhrases = [
  "Still with you — this one needs a little more thought…",
  "Misty is following the trail…",
  "A few more pieces to check…",
];

function taskAwarePhrase(value?: string) {
  const status = value?.trim();
  if (!status || status === "On it." || status === "thinking") return "";
  const lower = status.toLocaleLowerCase();
  if (lower.includes("weather")) return "Checking the weather…";
  if (lower.includes("file") || lower.includes("library")) return "Searching your files…";
  if (lower.includes("message")) return "Searching your messages…";
  if (lower.includes("calendar")) return "Checking your calendar…";
  if (lower.includes("task")) return "Checking your tasks…";
  if (lower.includes("note")) return "Reading your notes…";
  if (lower.includes("approval")) return "Waiting for your approval…";
  return status.replace(/^Using\s+/i, "Using ");
}

export function useMistyActivityPhrase(activity?: string, active = true) {
  const [tick, setTick] = useState(0);
  const specific = useMemo(() => taskAwarePhrase(activity), [activity]);
  useEffect(() => {
    setTick(0);
    if (!active || specific) return;
    const timer = window.setInterval(() => setTick((value) => value + 1), 4_000);
    return () => window.clearInterval(timer);
  }, [active, specific]);
  if (specific) return specific;
  if (tick >= 3) return patientPhrases[(tick - 3) % patientPhrases.length];
  return calmPhrases[tick % calmPhrases.length];
}

export function MistyActivityStatus({
  activity,
  compact = false,
}: {
  activity?: string;
  compact?: boolean;
}) {
  const phrase = useMistyActivityPhrase(activity);
  return (
    <div
      className={`flex items-center gap-2 text-cream-muted ${compact ? "py-1 text-xs" : "text-[13px]"}`}
      role="status"
      aria-live="polite"
    >
      <Loader2 className="size-3.5 shrink-0 animate-spin" />
      <span>{phrase}</span>
    </div>
  );
}
