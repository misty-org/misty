import type { WorkflowSchedule } from "@/api/ai/agent-methods";
import { localDocuments } from "@/features/misty/localChats";
import { changeDocument } from "../localTools/runState/documents";
import type { LocalMethod } from "./localMethods";
import { nextRun, runsBetween } from "./scheduleTiming";
import { announceWorkflowChange } from "./workflowChanges";

/**
 * Each schedule lives on the computer that made it, one document per workflow in misty.db
 * It claims by advancing its own next run in one
 * compare-and-swap, before the run starts: whoever loses the swap sees it's no longer due, so an
 * occurrence can't start twice. Times missed while the computer was off fold into that one claim.
 */

export interface LocalSchedule extends WorkflowSchedule {
  created_at: string;
  updated_at: string;
  /** While running: when the run counts as gone unless the window running it renews this. */
  lease_until?: string;
  /** The window running it, stable across launches. */
  window_id?: string;
}

export const scheduleKind = "workflow_schedule";
const leaseMs = 15 * 60_000;
const renewWithinMs = 5 * 60_000;
/** Enough to say how late a run is, without counting a year of hourly runs on the way. */
const missedLimit = 500;
export const profileProblem = "This schedule uses a profile";

export const iso = (time: number) => new Date(time).toISOString();

function parse(document: string): LocalSchedule | null {
  try {
    return JSON.parse(document) as LocalSchedule;
  } catch {
    return null;
  }
}

export async function listSchedules(account: string): Promise<LocalSchedule[]> {
  if (!localDocuments.available() || !account) return [];
  return (await localDocuments.list(account, scheduleKind)).flatMap(
    (document) => parse(document) ?? [],
  );
}

/** The same test as the server's `ClaimDueWorkflowSchedules`: a turned-off workflow never runs. */
export function isDue(schedule: LocalSchedule, methodEnabled: boolean, now: number): boolean {
  if (!schedule.enabled || !methodEnabled || !schedule.next_run_at) return false;
  if (Date.parse(schedule.next_run_at) > now) return false;
  if (schedule.state === "handed_off") return false;
  return schedule.state !== "running" || leaseLapsed(schedule, now);
}

export function leaseLapsed(schedule: LocalSchedule, now: number): boolean {
  return schedule.state === "running" && Date.parse(schedule.lease_until ?? "") <= now;
}

/** Changes a schedule as one step. A schedule that's gone stays gone. */
async function change(
  account: string,
  methodId: string,
  update: (schedule: LocalSchedule) => LocalSchedule | null,
): Promise<LocalSchedule | null> {
  const changed = await changeDocument<LocalSchedule | null, LocalSchedule | null>(
    account,
    scheduleKind,
    methodId,
    () => null,
    (current) => {
      const next = current ? update(current) : null;
      return next ? { next, result: next } : { result: null };
    },
  );
  if (changed) announceWorkflowChange();
  return changed;
}

function claimed(
  schedule: LocalSchedule,
  now: number,
  state: "running" | "handed_off",
  windowId: string,
): LocalSchedule {
  const occurrence = schedule.next_run_at!;
  const next = nextRun(schedule, now);
  return {
    ...schedule,
    state,
    last_invocation_id: undefined,
    due_at: occurrence,
    missed_count: runsBetween(schedule, Date.parse(occurrence), now, missedLimit),
    next_run_at: next === null ? undefined : iso(next),
    ...(state === "running"
      ? { lease_until: iso(now + leaseMs), window_id: windowId }
      : { lease_until: undefined, window_id: undefined }),
    last_error: schedule.last_error?.startsWith(profileProblem) ? "" : schedule.last_error,
    updated_at: iso(now),
  };
}

/**
 * Takes a due occurrence for this window, before anything starts. Null when it's no longer due, which
 * means another window or an earlier tick already took it.
 */
export function claimSchedule(
  account: string,
  method: LocalMethod,
  now: number,
  windowId: string,
): Promise<LocalSchedule | null> {
  return change(account, method.id, (schedule) =>
    isDue(schedule, method.enabled, now) ? claimed(schedule, now, "running", windowId) : null,
  );
}

/** Takes a due occurrence and leaves it for a window of the schedule's profile to start. */
export function handOffSchedule(
  account: string,
  method: LocalMethod,
  now: number,
): Promise<LocalSchedule | null> {
  return change(account, method.id, (schedule) =>
    isDue(schedule, method.enabled, now) ? claimed(schedule, now, "handed_off", "") : null,
  );
}

/** This window starts a run handed to its profile. Of two windows of that profile, one wins. */
export function takeHandedOff(
  account: string,
  methodId: string,
  now: number,
  windowId: string,
): Promise<LocalSchedule | null> {
  return change(account, methodId, (schedule) =>
    schedule.state === "handed_off" && schedule.enabled
      ? {
          ...schedule,
          state: "running",
          lease_until: iso(now + leaseMs),
          window_id: windowId,
          updated_at: iso(now),
        }
      : null,
  );
}

/** Gives back an occurrence that never started, so it's due again. It may say why. */
export function releaseSchedule(
  account: string,
  methodId: string,
  now: number,
  reason = "",
): Promise<LocalSchedule | null> {
  return change(account, methodId, (schedule) =>
    schedule.state === "running" && schedule.due_at
      ? {
          ...schedule,
          state: reason ? "failed" : "idle",
          next_run_at: schedule.due_at,
          due_at: undefined,
          missed_count: 0,
          lease_until: undefined,
          window_id: undefined,
          last_error: reason || schedule.last_error,
          updated_at: iso(now),
        }
      : null,
  );
}

/** Records the chat and run an occurrence started. */
export function bindScheduleRun(
  account: string,
  methodId: string,
  conversationId: string,
  invocationId: string | undefined,
  now: number,
): Promise<LocalSchedule | null> {
  return change(account, methodId, (schedule) => ({
    ...schedule,
    conversation_id: conversationId,
    last_invocation_id: invocationId,
    updated_at: iso(now),
  }));
}

/** Keeps a live run's claim, only when it's close to lapsing. */
export function renewScheduleLease(
  account: string,
  methodId: string,
  now: number,
): Promise<LocalSchedule | null> {
  return change(account, methodId, (schedule) =>
    schedule.state === "running" && Date.parse(schedule.lease_until ?? "") - now < renewWithinMs
      ? { ...schedule, lease_until: iso(now + leaseMs), updated_at: iso(now) }
      : null,
  );
}

/** Ends a run and plans the next occurrence. A rule with no more runs stays on with no next run. */
export function completeScheduleRun(
  account: string,
  methodId: string,
  error: string,
  now: number,
): Promise<LocalSchedule | null> {
  return change(account, methodId, (schedule) => {
    if (schedule.state !== "running") return null;
    const next = schedule.enabled ? nextRun(schedule, now) : null;
    return {
      ...schedule,
      state: error ? "failed" : "idle",
      next_run_at: next === null ? undefined : iso(next),
      lease_until: undefined,
      window_id: undefined,
      due_at: undefined,
      missed_count: 0,
      last_error: error.slice(0, 2000),
      last_run_at: iso(now),
      run_count: schedule.run_count + 1,
      updated_at: iso(now),
    };
  });
}

/** A computer without the schedule's profile can't run it. It keeps waiting and says why. */
export function noteMissingProfile(
  account: string,
  methodId: string,
  profile: string,
  now: number,
): Promise<LocalSchedule | null> {
  const message = `${profileProblem} this computer doesn't have ("${profile}"). Open that profile here, or change the schedule's profile.`;
  return change(account, methodId, (schedule) =>
    schedule.last_error === message
      ? null
      : { ...schedule, last_error: message, updated_at: iso(now) },
  );
}
