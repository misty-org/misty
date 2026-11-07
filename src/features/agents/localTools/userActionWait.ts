import { holdLocalWait } from "@/features/agent-interventions/localWaits";
import { publishLocalRunEvent } from "@/features/ai-surface/localRunEvents";
import { notAllowed } from "./deviceFailures";
import type { LocalToolRequest } from "./host";
import { contextAllows, type RunEntry } from "./runContexts";

/**
 * browser.request_user_action: the call stays open until the person has signed in or finished what
 * it asked for, and the Waiting for you card takes their answer. Native code gives a call 20 minutes,
 * after which the run stops as if Misty had closed, so a wait gives up just before that and counts
 * as an unanswered request the model can read.
 */
const waitMs = 19 * 60_000;

function status(runId: string, phase: string, text: string) {
  publishLocalRunEvent(runId, {
    id: `local-${crypto.randomUUID()}`,
    type: "assistant.status",
    phase,
    text,
  });
}

export async function requestUserAction(request: LocalToolRequest, entry: RunEntry) {
  const { scopeId, action, reason } = request.input as Record<string, string>;
  const screens = entry.contexts.filter(
    (item) =>
      item.opaqueRef === scopeId &&
      item.kind === "browser_tab" &&
      Date.parse(item.expiresAt) > Date.now() &&
      (contextAllows(item, "browser.inspect") || contextAllows(item, "browser.workspace.visual")),
  );
  // Waiting on a screen the run can't see, or can't name exactly, proves nothing.
  if (screens.length !== 1) throw notAllowed();
  const [screen] = screens;
  const id = crypto.randomUUID();
  status(
    entry.runId,
    "awaiting_intervention",
    "Misty is waiting for you. Finish what it asked for on screen, then continue in the conversation.",
  );
  const answer = await holdLocalWait(
    {
      id,
      runId: entry.runId,
      scopeId,
      deviceId: screen.deviceId,
      targetLabel: screen.displayName,
      action: action as Parameters<typeof holdLocalWait>[0]["action"],
      reason,
      state: "pending",
      expiresAt: new Date(
        Math.min(Date.now() + waitMs, Date.parse(screen.expiresAt)),
      ).toISOString(),
    },
    request.signal,
  );
  status(
    entry.runId,
    "intervention_resume_pending",
    "The user-action wait ended. Rechecking the original target before continuing.",
  );
  if (answer !== "ready") {
    return { denied: true, reason: "user_action_declined_or_expired", waitId: id };
  }
  return {
    ready: true,
    waitId: id,
    scopeId,
    requiresFreshInspection: true,
    message:
      "The user confirmed readiness. Inspect the original target again; this is not verification of account identity or any browser effect.",
  };
}
