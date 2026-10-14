import { activityStateLabels, formatActivityTime } from "../page/useAgentActivity";

/** A conversation's latest run, for its row's status badge. */
export type RecentStatus = {
  state: string;
  updatedAt: string;
  /** The run changed after the user last read the conversation. */
  unread?: boolean;
};

type Dot = "idle" | "working" | "waiting" | "needs-you" | "failed" | "partial" | "canceled";

/** Queued, waiting for a device or working: the dot pulses and read state doesn't apply. */
export const isRunInProgress = (state?: string) =>
  state === "running" || state === "queued" || state === "awaiting_device";

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
 * gray at rest, pulsing while queued or working, amber when it needs you, red when it
 * failed. A settled run is filled until the conversation is read, then hollow, so a
 * hollow dot means nothing new. The tooltip and screen-reader label always name the
 * state, so color and fill are never the only signal.
 */
export function RecentStatusBadge({ status }: { status?: RecentStatus }) {
  const dot = dotForState(status?.state);
  const fresh = Boolean(status?.unread) && !isRunInProgress(status?.state);
  // Needing you stays filled until it is answered; nothing new is hollow.
  const filled = fresh || dot === "needs-you" || isRunInProgress(status?.state);
  const label = status
    ? `${activityStateLabels[status.state] ?? status.state.replace(/_/g, " ")} · ${formatActivityTime(status.updatedAt)}${fresh ? " · New" : ""}`
    : undefined;
  return (
    <span
      className="agent-studio-recent-status"
      data-status={dot}
      data-read={filled ? undefined : "true"}
      title={label}
    >
      <span className="agent-studio-recent-dot" aria-hidden="true" />
      {label && <span className="sr-only">, {label}</span>}
    </span>
  );
}
