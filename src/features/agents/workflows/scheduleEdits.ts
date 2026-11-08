import type { AgentMethodInputs, ScheduleTiming } from "../api/agent-methods";
import { localDocuments } from "../conversations/state/localChats";
import { firstProfileId } from "@/features/app-windows";
import { changeDocument, RunStateError } from "../tools/run-state/documents";
import { allMethods, methodById } from "./localMethods";
import {
  iso,
  listSchedules,
  profileProblem,
  scheduleKind,
  type LocalSchedule,
} from "./localSchedules";
import { renderMethod } from "./methodDefinition";
import { nextRun, normalizeTiming, validTiming } from "./scheduleTiming";
import { announceWorkflowChange } from "./workflowChanges";

/** Making, changing and listing schedules, by a person or an agent. */

export type ScheduleInput = ScheduleTiming & {
  inputs?: AgentMethodInputs;
  enabled?: boolean;
  profile?: string;
};

const maxSchedules = 50;
const profilePattern = /^[A-Za-z0-9_-]{1,100}$/;

/**
 * Checks the workflow is the account's and its inputs fit, then stores the schedule and plans its next
 * run from now. An agent's call has already checked the workflow is its own (`workflowTools.ts`); the
 * person's page can schedule any of theirs.
 */
export async function saveSchedule(
  account: string,
  methodId: string,
  input: ScheduleInput,
  now: number,
): Promise<LocalSchedule> {
  const method = await methodById(account, methodId);
  if (!method) throw new RunStateError("not_found");
  if (method.kind !== "workflow" || renderMethod(method.definition, input.inputs ?? {}) === null)
    throw new RunStateError("invalid");
  const timing = normalizeTiming(
    {
      timezone: input.timezone,
      rules: input.rules,
      skip_dates: input.skip_dates ?? [],
    } as ScheduleTiming,
    now,
  );
  if (!validTiming(timing)) throw new RunStateError("invalid");
  const profile = input.profile?.trim();
  if (profile !== undefined && !profilePattern.test(profile)) throw new RunStateError("invalid");
  const others = (await listSchedules(account)).filter((item) => item.method_id !== methodId);
  if (others.length >= maxSchedules) throw new RunStateError("conflict");
  const saved = await changeDocument<LocalSchedule | null, LocalSchedule>(
    account,
    scheduleKind,
    methodId,
    () => null,
    (existing) => {
      const enabled = input.enabled ?? existing?.enabled ?? true;
      const next = enabled ? nextRun(timing, now) : null;
      const nextProfile = profile ?? existing?.profile ?? firstProfileId;
      // One handed to a window but not started yet stops with the pause.
      const keeps = existing?.state === "running" || (existing?.state === "handed_off" && enabled);
      const schedule: LocalSchedule = {
        id: existing?.id ?? `workflow_schedule_${crypto.randomUUID()}`,
        method_id: methodId,
        run_count: existing?.run_count ?? 0,
        created_at: existing?.created_at ?? iso(now),
        ...(existing?.conversation_id ? { conversation_id: existing.conversation_id } : {}),
        ...(existing?.last_invocation_id
          ? { last_invocation_id: existing.last_invocation_id }
          : {}),
        ...(existing?.last_run_at ? { last_run_at: existing.last_run_at } : {}),
        ...timing,
        inputs: input.inputs ?? {},
        enabled,
        profile: nextProfile,
        // A run already going keeps going, and plans the next occurrence when it ends.
        state: keeps ? existing!.state : "idle",
        ...(existing?.lease_until ? { lease_until: existing.lease_until } : {}),
        ...(existing?.window_id ? { window_id: existing.window_id } : {}),
        ...(keeps && existing?.due_at ? { due_at: existing.due_at } : {}),
        ...(keeps && existing?.missed_count ? { missed_count: existing.missed_count } : {}),
        last_error: existing?.last_error?.startsWith(profileProblem)
          ? ""
          : (existing?.last_error ?? ""),
        ...(next === null ? {} : { next_run_at: iso(next) }),
        updated_at: iso(now),
      };
      return { next: schedule, result: schedule };
    },
  );
  announceWorkflowChange();
  return saved;
}

export async function removeSchedule(account: string, methodId: string): Promise<void> {
  const existing =
    localDocuments.available() && account
      ? await localDocuments.get(account, scheduleKind, methodId)
      : null;
  if (existing === null) throw new RunStateError("not_found");
  await localDocuments.remove(account, scheduleKind, methodId);
  announceWorkflowChange();
}

/** The account's schedules on turned-on workflows, soonest first, with each workflow's name. */
export async function upcomingSchedules(account: string) {
  const [schedules, methods] = await Promise.all([listSchedules(account), allMethods(account)]);
  const names = new Map(
    methods
      .filter((method) => method.kind === "workflow" && method.enabled)
      .map((method) => [method.id, method]),
  );
  const at = (schedule: LocalSchedule) =>
    schedule.next_run_at ? Date.parse(schedule.next_run_at) : Infinity;
  return schedules
    .flatMap((schedule) => {
      const method = names.get(schedule.method_id);
      return method
        ? [{ ...schedule, title: method.definition.title, agent_id: method.agent_id }]
        : [];
    })
    .sort((a, b) => at(a) - at(b) || Date.parse(a.created_at) - Date.parse(b.created_at));
}
