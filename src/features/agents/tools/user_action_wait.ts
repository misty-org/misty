import { holdLocalWait } from "../interventions/local_waits";
import { publishLocalRunEvent } from "../runs/local-run/local_run_events";
import { notAllowed } from "./device_failures";
import type { LocalToolRequest } from "./host";
import { contextAllows, type RunEntry } from "./run_contexts";

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
