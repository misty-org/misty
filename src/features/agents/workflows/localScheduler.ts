import { useMistyStore } from "@/features/misty/useMistyStore";
import {
  currentProfile,
  currentWindowId,
  isHostWindow,
  listProfiles,
  openProfile,
} from "@/features/workspace/profileWindow";
import { holdAwake, releaseAwake } from "../keepAwake";
import { allMethods, methodById, type LocalMethod } from "./localMethods";
import { scheduledRunOutcome, startScheduledRun } from "./localScheduledRun";
import {
  claimSchedule,
  completeScheduleRun,
  handOffSchedule,
  isDue,
  leaseLapsed,
  listSchedules,
  noteMissingProfile,
  renewScheduleLease,
  takeHandedOff,
  type LocalSchedule,
} from "./localSchedules";

/**
 * The scheduler, in the window that runs the computer's background work: every 60 seconds it works out
 * what's due and claims it, and a schedule missed while the computer was off runs once when it next
 * opens. The host alone decides, so two windows can't both fire one.
 *
 * A run works in a window of the schedule's profile, with that profile's sign-ins. When the host isn't
 * one, it claims the occurrence as handed off and opens that profile; that window only starts what it
 * was handed. Every window settles its own runs, since only it knows how they ended.
 */

/** What the scheduler needs from the app, so a test can stand in for it. */
export interface SchedulerApp {
  account: string;
  now(): number;
  windowId(): string;
  profileId(): string;
  isHost(): Promise<boolean>;
  profiles(): Promise<string[]>;
  openProfile(id: string): Promise<unknown>;
  /** A turn is going in this window; a scheduled run waits for it. */
  working(): boolean;
  outcome(schedule: LocalSchedule): Promise<{ live: true } | { live: false; error: string }>;
  start(schedule: LocalSchedule, method: LocalMethod, now: number): Promise<void>;
  holdAwake(soon: boolean): Promise<unknown>;
}

/** How long before a run this computer stays awake for it. */
const awakeAheadMs = 15 * 60_000;

/** Occurrences a profile's window was already asked to pick up, so it comes forward once. */
const openedFor = new Set<string>();

/** Ends this window's finished runs and keeps its live ones. */
async function settleOwnRuns(app: SchedulerApp, schedules: LocalSchedule[]) {
  const now = app.now();
  for (const schedule of schedules) {
    if (schedule.state !== "running" || schedule.window_id !== app.windowId()) continue;
    const outcome = await app.outcome(schedule);
    if (outcome.live) await renewScheduleLease(app.account, schedule.method_id, now);
    else await completeScheduleRun(app.account, schedule.method_id, outcome.error, now);
  }
}

/** Starts one run handed to this window's profile. The swap decides between its windows. */
async function startHandedOff(app: SchedulerApp, schedules: LocalSchedule[]): Promise<boolean> {
  for (const schedule of schedules) {
    if (schedule.state !== "handed_off" || schedule.profile !== app.profileId()) continue;
    if (app.working()) return false;
    const now = app.now();
    const method = await methodById(app.account, schedule.method_id);
    // A workflow turned off since it was handed over waits, like any other.
    if (method && !method.enabled) continue;
    const taken = await takeHandedOff(app.account, schedule.method_id, now, app.windowId());
    if (!taken) continue;
    if (!method) {
      await completeScheduleRun(app.account, schedule.method_id, "This workflow is gone.", now);
      continue;
    }
    await app.start(taken, method, now);
    return true;
  }
  return false;
}

async function holdAwakeForSchedules(app: SchedulerApp, schedules: LocalSchedule[]) {
  const now = app.now();
  const soon = schedules.some(
    (schedule) =>
      schedule.enabled &&
      (schedule.state === "running" ||
        schedule.state === "handed_off" ||
        (schedule.next_run_at !== undefined &&
          Date.parse(schedule.next_run_at) - now < awakeAheadMs)),
  );
  await app.holdAwake(soon).catch(() => undefined);
}

/** The host's part: ends runs whose window is gone, then claims what's due. */
async function runDue(app: SchedulerApp, schedules: LocalSchedule[]) {
  const started = app.now();
  for (const schedule of schedules)
    if (leaseLapsed(schedule, started))
      await completeScheduleRun(
        app.account,
        schedule.method_id,
        "Misty closed before this run finished.",
        started,
      );
  const current = await listSchedules(app.account);
  await holdAwakeForSchedules(app, current);
  const methods = new Map((await allMethods(app.account)).map((method) => [method.id, method]));
  const profiles = await app.profiles().catch(() => [] as string[]);
  for (const schedule of current) {
    if (schedule.state === "handed_off") {
      if (!profiles.length) continue;
      if (!profiles.includes(schedule.profile)) {
        await noteMissingProfile(app.account, schedule.method_id, schedule.profile, app.now());
        continue;
      }
      // After a restart the window it was handed to may not be open.
      const key = `${schedule.id}:${schedule.due_at ?? ""}`;
      if (schedule.profile !== app.profileId() && !openedFor.has(key)) {
        openedFor.add(key);
        await app.openProfile(schedule.profile).catch(() => undefined);
      }
      continue;
    }
    const method = methods.get(schedule.method_id);
    const now = app.now();
    if (!method || !isDue(schedule, method.enabled, now)) continue;
    // Nothing to compare against yet, so it can't say this computer lacks the profile.
    if (!profiles.length) continue;
    if (!profiles.includes(schedule.profile)) {
      await noteMissingProfile(app.account, schedule.method_id, schedule.profile, now);
      continue;
    }
    if (schedule.profile !== app.profileId()) {
      const handed = await handOffSchedule(app.account, method, now);
      if (handed) {
        openedFor.add(`${handed.id}:${handed.due_at ?? ""}`);
        await app.openProfile(handed.profile).catch(() => undefined);
      }
      continue;
    }
    // One turn at a time: the rest stay due, and later times fold into them.
    if (app.working()) continue;
    const claim = await claimSchedule(app.account, method, now, app.windowId());
    if (!claim) continue;
    await app.start(claim, method, now);
    if (app.working()) return;
  }
}

/** One pass. Safe to call often: only what's due and still unclaimed does anything. */
export async function runSchedulerPass(app: SchedulerApp): Promise<void> {
  const schedules = await listSchedules(app.account);
  await settleOwnRuns(app, schedules);
  const current = schedules.length ? await listSchedules(app.account) : schedules;
  if (await startHandedOff(app, current)) return;
  if (await app.isHost()) await runDue(app, current);
}

/** This window's pass over the local schedules of an account. */
export function runLocalSchedules(account: string): Promise<void> {
  return runSchedulerPass({
    account,
    now: () => Date.now(),
    windowId: currentWindowId,
    profileId: () => currentProfile().id,
    isHost: isHostWindow,
    profiles: async () => (await listProfiles()).map((profile) => profile.id),
    openProfile: async (id) => openProfile(id),
    working: () => {
      const store = useMistyStore.getState();
      // While the chats load, a run has no chat to go in, and loading them could replace the one it made.
      return store.working || store.conversationsLoading || store.accountId !== account;
    },
    outcome: (schedule) => scheduledRunOutcome(schedule, account),
    start: (schedule, method, now) => startScheduledRun(account, schedule, method, now),
    holdAwake: (soon) => (soon ? holdAwake("schedule") : releaseAwake("schedule")),
  });
}
