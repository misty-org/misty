/** Which AI limit refused a request, as the server reports it. */
export type UsageLimitName =
  "window" | "weekly" | "monthly" | "command" | "service" | "model" | "email";

function when(resetsAt: Date, now = new Date()): string {
  const sameDay = resetsAt.toDateString() === now.toDateString();
  const time = resetsAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (sameDay) return `at ${time}`;
  const withinWeek = resetsAt.getTime() - now.getTime() < 6 * 24 * 60 * 60 * 1000;
  const day = withinWeek
    ? resetsAt.toLocaleDateString([], { weekday: "long" })
    : resetsAt.toLocaleDateString([], { month: "short", day: "numeric" });
  return `${day} at ${time}`;
}

/**
 * Plain-language text for a usage refusal, with its refill time. The server's
 * own message is the fallback for limits without a reset.
 */
export function usageLimitText(
  limit: string | undefined,
  resetsAt: string | undefined,
  fallback: string,
): string {
  const reset = resetsAt ? new Date(resetsAt) : undefined;
  const valid = reset && !Number.isNaN(reset.getTime());
  switch (limit) {
    case "window":
      return valid ? `You've used this session's AI. It refills ${when(reset)}.` : fallback;
    case "weekly":
      return valid ? `You've used this week's AI. It refills ${when(reset)}.` : fallback;
    case "monthly":
      return valid
        ? `You've reached this month's AI limit. Room frees up ${when(reset)}.`
        : fallback;
    default:
      return fallback;
  }
}
