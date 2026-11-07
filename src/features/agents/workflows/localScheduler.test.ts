import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LocalSchedule } from "./localSchedules";
import type { LocalMethod } from "./localMethods";

vi.mock("@tauri-apps/api/core", async () => {
  const { fakeDocuments } = await import("./fakeDocuments");
  return { invoke: fakeDocuments.invoke };
});
vi.mock("@tauri-apps/api/event", () => ({
  emit: async () => undefined,
  listen: async () => () => undefined,
}));
vi.mock("@/shared/platform/tauri", () => ({ hasTauriInternals: () => true }));
vi.mock("@/features/misty/useMistyStore", () => ({ useMistyStore: { getState: () => ({}) } }));
vi.mock("./localScheduledRun", () => ({
  scheduledRunOutcome: vi.fn(),
  startScheduledRun: vi.fn(),
}));
vi.mock("../keepAwake", () => ({ holdAwake: vi.fn(), releaseAwake: vi.fn() }));

const { fakeDocuments } = await import("./fakeDocuments");
const { saveMethod } = await import("./localMethods");
const { claimSchedule, completeScheduleRun, isDue, listSchedules, releaseSchedule } =
  await import("./localSchedules");
const { saveSchedule } = await import("./scheduleEdits");
const { runSchedulerPass } = await import("./localScheduler");

const account = "account";
const hour = 3_600_000;
const start = Date.UTC(2026, 8, 25, 17);

async function workflow(enabled = true): Promise<LocalMethod> {
  return saveMethod(account, {
    agent_id: "agent",
    kind: "workflow",
    enabled,
    definition: {
      title: "Brief",
      description: "",
      instructions: "Write the brief.",
      inputs: [],
      target: "cloud",
      required_tools: [],
    },
  });
}

/** Runs every hour on the hour, in the first profile. */
const hourly = (profile = "personal") => ({
  timezone: "UTC",
  rules: [{ frequency: "hourly" as const, minute: 0 }],
  skip_dates: [],
  profile,
});

function app(overrides: Record<string, unknown> = {}) {
  const started: LocalSchedule[] = [];
  const opened: string[] = [];
  let clock = start;
  const scheduler = {
    account,
    now: () => clock,
    windowId: () => "window-a",
    profileId: () => "personal",
    isHost: async () => true,
    profiles: async () => ["personal", "work"],
    openProfile: async (id: string) => void opened.push(id),
    working: () => false,
    outcome: async () => ({ live: true }) as const,
    start: async (schedule: LocalSchedule) => void started.push(schedule),
    holdAwake: async () => undefined,
    ...overrides,
  };
  return { scheduler, started, opened, at: (time: number) => (clock = time) };
}

beforeEach(() => fakeDocuments.reset());

describe("what's due", () => {
  it("follows the server's claim rules", async () => {
    const method = await workflow();
    const schedule = await saveSchedule(account, method.id, hourly(), start);
    const due = Date.parse(schedule.next_run_at!);
    expect(due).toBe(start + hour);
    expect(isDue(schedule, true, due - 1)).toBe(false);
    expect(isDue(schedule, true, due)).toBe(true);
    // A turned-off workflow keeps its schedule but never runs.
    expect(isDue(schedule, false, due)).toBe(false);
    expect(isDue({ ...schedule, enabled: false }, true, due)).toBe(false);
    expect(isDue({ ...schedule, state: "handed_off" }, true, due)).toBe(false);
    expect(
      isDue(
        { ...schedule, state: "running", lease_until: new Date(due + 1).toISOString() },
        true,
        due,
      ),
    ).toBe(false);
    expect(
      isDue({ ...schedule, state: "running", lease_until: new Date(due).toISOString() }, true, due),
    ).toBe(true);
  });

  it("starts nothing before its time", async () => {
    const method = await workflow();
    await saveSchedule(account, method.id, hourly(), start);
    const { scheduler, started } = app();
    await runSchedulerPass(scheduler);
    expect(started).toEqual([]);
  });
});

describe("catching up", () => {
  it("runs a schedule missed while the computer was off once, and says how many it covers", async () => {
    const method = await workflow();
    await saveSchedule(account, method.id, hourly(), start);
    const { scheduler, started, at } = app();
    at(start + 5.5 * hour);
    await runSchedulerPass(scheduler);
    expect(started).toHaveLength(1);
    expect(started[0]).toMatchObject({
      state: "running",
      due_at: new Date(start + hour).toISOString(),
      missed_count: 4,
      next_run_at: new Date(start + 6 * hour).toISOString(),
    });
    await runSchedulerPass(scheduler);
    expect(started).toHaveLength(1);
  });
});

describe("the claim", () => {
  it("lets one of two racing claims win", async () => {
    const method = await workflow();
    await saveSchedule(account, method.id, hourly(), start);
    const at = start + hour;
    const claims = await Promise.all([
      claimSchedule(account, method, at, "window-a"),
      claimSchedule(account, method, at, "window-b"),
    ]);
    expect(claims.filter(Boolean)).toHaveLength(1);
  });

  it("is recorded before the run starts, so a restart can't repeat it", async () => {
    const method = await workflow();
    await saveSchedule(account, method.id, hourly(), start);
    const { scheduler, started, at } = app({
      start: async () => {
        throw new Error("Misty closed");
      },
    });
    at(start + hour);
    await expect(runSchedulerPass(scheduler)).rejects.toThrow("Misty closed");
    expect(started).toEqual([]);
    const [saved] = await listSchedules(account);
    expect(saved).toMatchObject({
      state: "running",
      next_run_at: new Date(start + 2 * hour).toISOString(),
    });
    const second = app();
    second.at(start + hour + 60_000);
    await runSchedulerPass(second.scheduler);
    expect(second.started).toEqual([]);
  });

  it("gives back an occurrence that never started", async () => {
    const method = await workflow();
    await saveSchedule(account, method.id, hourly(), start);
    await claimSchedule(account, method, start + hour, "window-a");
    await releaseSchedule(account, method.id, start + hour, "The server can't be reached.");
    const [saved] = await listSchedules(account);
    expect(saved).toMatchObject({
      state: "failed",
      last_error: "The server can't be reached.",
      next_run_at: new Date(start + hour).toISOString(),
    });
    expect(isDue(saved!, true, start + hour)).toBe(true);
  });

  it("only the host window decides what's due", async () => {
    const method = await workflow();
    await saveSchedule(account, method.id, hourly(), start);
    const { scheduler, started, at } = app({ isHost: async () => false });
    at(start + hour);
    await runSchedulerPass(scheduler);
    expect(started).toEqual([]);
  });

  it("waits for the current task and stays due", async () => {
    const method = await workflow();
    await saveSchedule(account, method.id, hourly(), start);
    const busy = app({ working: () => true });
    busy.at(start + hour);
    await runSchedulerPass(busy.scheduler);
    expect(busy.started).toEqual([]);
    const [saved] = await listSchedules(account);
    expect(saved).toMatchObject({ state: "idle" });
    const free = app();
    free.at(start + 3.5 * hour);
    await runSchedulerPass(free.scheduler);
    expect(free.started[0]).toMatchObject({ missed_count: 2 });
  });
});

describe("a run ending", () => {
  it("plans the next occurrence and counts the run", async () => {
    const method = await workflow();
    await saveSchedule(account, method.id, hourly(), start);
    const { scheduler, at } = app({
      outcome: async () => ({ live: false, error: "" }) as const,
    });
    at(start + hour);
    await runSchedulerPass(scheduler);
    at(start + 1.5 * hour);
    await runSchedulerPass(scheduler);
    const [saved] = await listSchedules(account);
    expect(saved).toMatchObject({
      state: "idle",
      run_count: 1,
      last_run_at: new Date(start + 1.5 * hour).toISOString(),
      next_run_at: new Date(start + 2 * hour).toISOString(),
    });
    expect(saved?.due_at).toBeUndefined();
  });

  it("says why a run failed", async () => {
    const method = await workflow();
    await saveSchedule(account, method.id, hourly(), start);
    await claimSchedule(account, method, start + hour, "window-a");
    await completeScheduleRun(account, method.id, "No model key.", start + hour);
    const [saved] = await listSchedules(account);
    expect(saved).toMatchObject({ state: "failed", last_error: "No model key." });
  });

  it("ends a run whose window is gone once its lease lapses, without running it again", async () => {
    const method = await workflow();
    await saveSchedule(account, method.id, hourly(), start);
    await claimSchedule(account, method, start + hour, "window-gone");
    const { scheduler, started, at } = app();
    at(start + hour + 16 * 60_000);
    await runSchedulerPass(scheduler);
    const [saved] = await listSchedules(account);
    expect(saved).toMatchObject({
      state: "failed",
      last_error: "Misty closed before this run finished.",
    });
    expect(started).toEqual([]);
  });

  it("keeps a live run's lease from lapsing", async () => {
    const method = await workflow();
    await saveSchedule(account, method.id, hourly(), start);
    const { scheduler, at } = app();
    at(start + hour);
    await runSchedulerPass(scheduler);
    at(start + hour + 12 * 60_000);
    await runSchedulerPass(scheduler);
    const [saved] = await listSchedules(account);
    expect(saved).toMatchObject({
      state: "running",
      lease_until: new Date(start + hour + 27 * 60_000).toISOString(),
    });
  });
});

describe("the schedule's profile", () => {
  it("refuses on a computer without it, says why, and clears once it's there", async () => {
    const method = await workflow();
    await saveSchedule(account, method.id, hourly("gone"), start);
    const missing = app();
    missing.at(start + hour);
    await runSchedulerPass(missing.scheduler);
    expect(missing.started).toEqual([]);
    let [saved] = await listSchedules(account);
    expect(saved).toMatchObject({ state: "idle" });
    expect(saved?.last_error).toBe(
      `This schedule uses a profile this computer doesn't have ("gone"). Open that profile here, or change the schedule's profile.`,
    );
    const here = app({ profiles: async () => ["personal", "gone"], profileId: () => "gone" });
    here.at(start + 2.5 * hour);
    await runSchedulerPass(here.scheduler);
    expect(here.started).toHaveLength(1);
    [saved] = await listSchedules(account);
    expect(saved?.last_error).toBe("");
  });

  it("hands the run to a window of that profile, and only one of its windows takes it", async () => {
    const method = await workflow();
    await saveSchedule(account, method.id, hourly("work"), start);
    const host = app();
    host.at(start + hour);
    await runSchedulerPass(host.scheduler);
    expect(host.started).toEqual([]);
    expect(host.opened).toEqual(["work"]);
    const [handed] = await listSchedules(account);
    expect(handed).toMatchObject({
      state: "handed_off",
      next_run_at: new Date(start + 2 * hour).toISOString(),
    });
    const first = app({
      isHost: async () => false,
      profileId: () => "work",
      windowId: () => "window-b",
    });
    const second = app({
      isHost: async () => false,
      profileId: () => "work",
      windowId: () => "window-c",
    });
    first.at(start + hour + 1000);
    second.at(start + hour + 1000);
    await Promise.all([runSchedulerPass(first.scheduler), runSchedulerPass(second.scheduler)]);
    expect(first.started.length + second.started.length).toBe(1);
    await runSchedulerPass(host.scheduler);
    expect(host.started).toEqual([]);
  });
});

describe("a hand-off that can't go ahead", () => {
  it("says why when the profile is removed after the hand-off", async () => {
    const method = await workflow();
    await saveSchedule(account, method.id, hourly("work"), start);
    const host = app();
    host.at(start + hour);
    await runSchedulerPass(host.scheduler);
    const removed = app({ profiles: async () => ["personal"] });
    removed.at(start + hour + 60_000);
    await runSchedulerPass(removed.scheduler);
    const [saved] = await listSchedules(account);
    expect(saved).toMatchObject({ state: "handed_off" });
    expect(saved?.last_error).toContain(`("work")`);
  });

  it("stops with a pause", async () => {
    const method = await workflow();
    await saveSchedule(account, method.id, hourly("work"), start);
    const host = app();
    host.at(start + hour);
    await runSchedulerPass(host.scheduler);
    await saveSchedule(account, method.id, { ...hourly("work"), enabled: false }, start + hour);
    const [saved] = await listSchedules(account);
    expect(saved).toMatchObject({ state: "idle", enabled: false });
    expect(saved?.next_run_at).toBeUndefined();
    expect(saved?.due_at).toBeUndefined();
  });
});
