import { activityStateLabels, formatActivityTime } from "../page/useAgentActivity";

/** A conversation's latest run, for its row's status badge. */
export type RecentStatus = { state: string; updatedAt: string };

type Dot = "idle" | "working" | "waiting" | "needs-you" | "failed" | "partial" | "canceled";

const dotForState = (state?: string): Dot => {
  switch (state) {
    case "running":
      return "working";
    case "queued":
    case "awaiting_device":
      return "waiting";
    case "awaiting_approval":
    case "awaiting_intervention":
      return "needs-you";
    case "failed":
      return "failed";
    case "completed_with_errors":
      return "partial";
    case "canceled":
      return "canceled";
    default:
      return "idle";
  }
};

/**
 * A small dot on the left of every recent row, in the style of Claude's session list:
 * gray at rest, pulsing while working, amber when it needs you, red when it failed.
 * The tooltip and screen-reader label always name the state, so color is never the
 * only signal.
 */
export function RecentStatusBadge({ status }: { status?: RecentStatus }) {
  const label = status
    ? `${activityStateLabels[status.state] ?? status.state.replace(/_/g, " ")} · ${formatActivityTime(status.updatedAt)}`
    : undefined;
  return (
    <span
      className="agent-studio-recent-status"
      data-status={dotForState(status?.state)}
      title={label}
    >
      <span className="agent-studio-recent-dot" aria-hidden="true" />
      {label && <span className="sr-only">, {label}</span>}
    </span>
  );
}
