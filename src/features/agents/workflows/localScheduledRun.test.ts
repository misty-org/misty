import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GlobalAiMessage } from "@/features/misty/types";
import type { LocalMethod } from "./localMethods";
import type { LocalSchedule } from "./localSchedules";

const mocks = vi.hoisted(() => {
  const state: Record<string, unknown> = {};
  return {
    state,
    submit: vi.fn(),
    create: vi.fn(),
    runState: vi.fn(),
    store: {
      getState: () => state,
      setState: (patch: unknown) =>
        Object.assign(state, typeof patch === "function" ? patch(state) : patch),
    },
  };
});

vi.mock("@tauri-apps/api/core", async () => {
  const { fakeDocuments } = await import("./fakeDocuments");
  return { invoke: fakeDocuments.invoke };
});
vi.mock("@tauri-apps/api/event", () => ({
  emit: async () => undefined,
  listen: async () => () => undefined,
}));
vi.mock("@/shared/platform/tauri", () => ({ hasTauriInternals: () => true }));
vi.mock("@/features/misty/useMistyStore", () => ({ useMistyStore: mocks.store }));
vi.mock("@/features/misty/localConversation", () => ({ newLocalConversation: mocks.create }));
vi.mock("@/features/ai-surface/invocationSubscription", () => ({ readRunState: mocks.runState }));
vi.mock("../store/useAgentsStore", () => ({ adoptFolderChanges: async () => undefined }));
vi.mock("../store/useConversationFolder", () => ({
  useConversationFolder: { getState: () => ({ setFolder: vi.fn(), setWritable: vi.fn() }) },
}));

const { fakeDocuments } = await import("./fakeDocuments");
const { saveMethod } = await import("./localMethods");
const { claimSchedule, listSchedules } = await import("./localSchedules");
const { saveSchedule } = await import("./scheduleEdits");
const { lateNotice, scheduledRunOutcome, scheduledRunPrompt, startScheduledRun } =
  await import("./localScheduledRun");

const account = "account";
const start = Date.UTC(2026, 8, 25, 17);
const hour = 3_600_000;

async function claimedRun(input: Record<string, string> = { topic: "Tea" }) {
  const method = (await saveMethod(account, {
    agent_id: "agent",
    kind: "workflow",
    enabled: true,
    definition: {
      title: "Brief",
      description: "",
      instructions: "Write the brief.",
      inputs: [{ key: "topic", label: "Topic", type: "text", required: true }],
      target: "cloud",
      required_tools: [],
    },
  })) as LocalMethod;
  await saveSchedule(
    account,
    method.id,
    { timezone: "UTC", rules: [{ frequency: "hourly", minute: 0 }], skip_dates: [], inputs: input },
    start,
  );
  const schedule = (await claimSchedule(account, method, start + hour, "window")) as LocalSchedule;
  return { method, schedule };
}

beforeEach(() => {
  fakeDocuments.reset();
  mocks.submit.mockReset();
  mocks.create.mockReset();
  mocks.create.mockReturnValue({ id: "chat" });
  for (const key of Object.keys(mocks.state)) delete mocks.state[key];
  Object.assign(mocks.state, {
    accountId: account,
    working: false,
    conversations: [],
    selectedAgentId: "other-agent",
    activeConversationId: "open-chat",
    error: null,
    submitAnswer: mocks.submit,
  });
  mocks.submit.mockImplementation(async () => {
    Object.assign(mocks.state, { invocationId: "run-1", invocationConversationId: "chat" });
  });
});

describe("starting a claimed run", () => {
  it("sends the rendered workflow as an ordinary scheduled turn that won't stop at Ask", async () => {
    const { method, schedule } = await claimedRun();
    await startScheduledRun(account, schedule, method, start + hour);
    expect(mocks.create).toHaveBeenCalledWith("Brief", "", "agent");
    const [prompt, , , presentation, , origin, companion] = mocks.submit.mock.calls[0]!;
    expect(prompt).toContain("they are not watching it run");
    expect(prompt).toContain('{"topic":"Tea"}');
    expect(presentation).toBe("workspace");
    expect(origin).toEqual({ conversationId: "chat", context: [] });
    expect(companion).toEqual({
      executionMode: "user",
      methodVersionId: method.version_id,
      idempotencyKey: `workflow-schedule:${schedule.id}:${schedule.due_at}`,
      permissionMode: "auto",
      collaborationMode: "act",
      schedule: { id: schedule.id, claim: "" },
      spaceId: "",
    });
    const [saved] = await listSchedules(account);
    expect(saved).toMatchObject({
      state: "running",
      conversation_id: "chat",
      last_invocation_id: "run-1",
    });
  });

  it("doesn't take over what the person has open", async () => {
    const { method, schedule } = await claimedRun();
    await startScheduledRun(account, schedule, method, start + hour);
    expect(mocks.state.selectedAgentId).toBe("other-agent");
    expect(mocks.state.activeConversationId).toBe("open-chat");
  });

  it("keeps using the schedule's own chat", async () => {
    const { method, schedule } = await claimedRun();
    mocks.state.conversations = [{ id: "kept", messages: [] }];
    await startScheduledRun(
      account,
      { ...schedule, conversation_id: "kept" },
      method,
      start + hour,
    );
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.submit.mock.calls[0]![5]).toMatchObject({ conversationId: "kept" });
  });

  it("gives the occurrence back when a task started meanwhile, so it isn't steered in", async () => {
    const { method, schedule } = await claimedRun();
    mocks.state.working = true;
    await startScheduledRun(account, schedule, method, start + hour);
    expect(mocks.submit).not.toHaveBeenCalled();
    const [saved] = await listSchedules(account);
    expect(saved).toMatchObject({ state: "idle", next_run_at: schedule.due_at });
  });

  it("ends the occurrence when the turn didn't start, without trying it again", async () => {
    const { method, schedule } = await claimedRun();
    mocks.submit.mockImplementation(async () => {
      mocks.state.error = "No model key.";
    });
    await startScheduledRun(account, schedule, method, start + hour);
    const [saved] = await listSchedules(account);
    expect(saved).toMatchObject({ state: "failed", last_error: "No model key.", run_count: 1 });
    expect(Date.parse(saved!.next_run_at!)).toBeGreaterThan(start + hour);
  });

  it("says so when saved inputs no longer fit", async () => {
    const { method, schedule } = await claimedRun();
    await startScheduledRun(account, { ...schedule, inputs: {} }, method, start + hour);
    expect(mocks.submit).not.toHaveBeenCalled();
    const [saved] = await listSchedules(account);
    expect(saved?.last_error).toBe(
      "Its saved inputs no longer fit this workflow. Edit the schedule's inputs.",
    );
  });
});

describe("saying it started late", () => {
  const schedule = {
    due_at: new Date(start).toISOString(),
    timezone: "UTC",
    missed_count: 0,
  } as LocalSchedule;
  it("stays quiet when it's on time", () => {
    expect(lateNotice(schedule, start + 60_000)).toBe("");
  });
  it("says when it was due and what it covers", () => {
    expect(lateNotice(schedule, start + hour)).toContain(
      "started now, when this computer was back.",
    );
    expect(lateNotice({ ...schedule, missed_count: 1 }, start + hour)).toContain(
      "One later run passed",
    );
    expect(lateNotice({ ...schedule, missed_count: 4 }, start + hour)).toContain(
      "4 later runs passed",
    );
  });
  it("reaches the turn", async () => {
    const { method, schedule: claimed } = await claimedRun();
    expect(scheduledRunPrompt(claimed, method, start + 3 * hour)).toContain("This run was due");
  });
});

describe("how a run ended", () => {
  const schedule = { conversation_id: "chat", last_invocation_id: "run" } as LocalSchedule;
  const replying = (extra: Partial<GlobalAiMessage>) => {
    mocks.state.conversations = [
      { id: "chat", messages: [{ role: "assistant", invocationId: "run", ...extra }] },
    ];
  };
  it("goes by native code while it knows the run, whatever this window holds", async () => {
    // A window just reopened holds no chats yet, and the run outlived the app.
    mocks.runState.mockResolvedValue("running");
    expect(await scheduledRunOutcome(schedule)).toEqual({ live: true });
    mocks.runState.mockResolvedValue("completed");
    expect(await scheduledRunOutcome(schedule)).toEqual({ live: false, error: "" });
    mocks.runState.mockResolvedValue("canceled");
    expect(await scheduledRunOutcome(schedule)).toEqual({
      live: false,
      error: "This run was stopped.",
    });
    mocks.runState.mockResolvedValue("failed");
    replying({ state: "failed", content: "It broke." });
    expect(await scheduledRunOutcome(schedule)).toEqual({ live: false, error: "It broke." });
  });
  it("keeps a run going when native code can't answer", async () => {
    mocks.runState.mockRejectedValue(new Error("busy"));
    expect(await scheduledRunOutcome(schedule)).toEqual({ live: true });
  });
  it("reads the reply of a run that ended before this launch", async () => {
    mocks.runState.mockResolvedValue("missing");
    replying({ state: "completed" });
    expect(await scheduledRunOutcome(schedule)).toEqual({ live: false, error: "" });
    replying({ state: "failed", content: "It broke." });
    expect(await scheduledRunOutcome(schedule)).toEqual({ live: false, error: "It broke." });
    replying({ state: "streaming" });
    expect(await scheduledRunOutcome(schedule)).toEqual({
      live: false,
      error: "Misty closed before this run finished.",
    });
  });
  it("reads that reply from the saved chat when this window hasn't loaded it", async () => {
    mocks.runState.mockResolvedValue("missing");
    await fakeDocuments.invoke("agent_chats_swap", {
      account,
      kind: "conversation",
      id: "chat",
      document: JSON.stringify({
        messages: [{ role: "assistant", invocationId: "run", state: "completed" }],
      }),
    });
    expect(await scheduledRunOutcome(schedule, account)).toEqual({ live: false, error: "" });
  });
  it("treats a claim with no run as closed partway, never as finished", async () => {
    expect(await scheduledRunOutcome({ conversation_id: "chat" } as LocalSchedule)).toEqual({
      live: false,
      error: "Misty closed before this run finished.",
    });
  });
});
