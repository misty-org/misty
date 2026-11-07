import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  entry: { agentId: "agent", spaceId: "" } as { agentId: string; spaceId: string } | null,
  embed: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", async () => {
  const { fakeDocuments } = await import("../workflows/fakeDocuments");
  return { invoke: fakeDocuments.invoke };
});
vi.mock("@tauri-apps/api/event", () => ({
  emit: async () => undefined,
  listen: async () => () => undefined,
}));
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ listen: async () => () => undefined }),
}));
vi.mock("@/shared/platform/tauri", () => ({ hasTauriInternals: () => true }));
vi.mock("@/features/misty/useMistyStore", () => ({
  useMistyStore: { getState: () => ({ accountId: "account" }) },
}));
vi.mock("@/features/spaces/store/useSpacesStore", () => ({
  useSpacesStore: {
    getState: () => ({ spaces: [{ id: "default-space", is_default: true, role: "owner" }] }),
  },
}));
vi.mock("@/features/spaces/defaultSpace", () => ({
  preferredDefaultSpace: (spaces: { id: string }[]) => spaces[0],
}));
vi.mock("./runContexts", () => ({ loadRunEntry: async () => mocks.entry }));
vi.mock("@/api/device-embeddings", () => ({ embedOnDevice: mocks.embed }));

const { fakeDocuments } = await import("../workflows/fakeDocuments");
const { workflowTools } = await import("./workflowTools");

const call = (name: string, input: Record<string, unknown> = {}) =>
  workflowTools[name]!({
    runId: "run",
    callId: "call",
    name,
    input,
    signal: new AbortController().signal,
  }) as Promise<Record<string, any>>;

const save = (input: Record<string, unknown> = {}) =>
  call("memory.workflow.save", {
    title: "Morning brief",
    instructions: "Write the morning brief.",
    ...input,
  });
const daily = { timezone: "UTC", rules: [{ frequency: "daily", times: ["09:00"] }] };

beforeEach(() => {
  fakeDocuments.reset();
  mocks.entry = { agentId: "agent", spaceId: "" };
  mocks.embed.mockReset();
  mocks.embed.mockRejectedValue(Object.assign(new Error("no key"), { code: "model_key_needed" }));
});

describe("saving and listing", () => {
  it("answers in the server's shapes", async () => {
    const { method } = await save({
      description: "Each morning",
      inputs: [{ key: "topic", label: "Topic", type: "text", required: true }],
    });
    expect(method).toEqual({
      id: expect.stringMatching(/^method_/),
      title: "Morning brief",
      version: 1,
    });
    await expect(call("memory.workflow.list")).resolves.toEqual({
      methods: [
        {
          id: method.id,
          title: "Morning brief",
          description: "Each morning",
          inputs: [{ key: "topic", label: "Topic", type: "text", required: true }],
          where: "cloud",
        },
      ],
    });
  });

  it("updates by id into a new version, and refuses an id it doesn't have", async () => {
    const { method } = await save();
    const updated = await save({ id: method.id, title: "Evening brief" });
    expect(updated.method).toEqual({ id: method.id, title: "Evening brief", version: 2 });
    await expect(save({ id: "nope" })).rejects.toMatchObject({
      code: "invalid_request",
      message: "no method nope for this agent; call memory_workflow_list",
    });
  });

  it("refuses arguments that don't fit, before anything happens", async () => {
    await expect(call("memory.workflow.save", { title: "No instructions" })).rejects.toMatchObject({
      code: "invalid_arguments",
    });
    await expect(save({ extra: true })).rejects.toMatchObject({ code: "invalid_arguments" });
    await expect(
      save({ inputs: [{ key: "Bad Key", label: "Bad", type: "text" }] }),
    ).rejects.toMatchObject({ code: "invalid_arguments" });
    await expect(save({ title: "é".repeat(100) })).rejects.toMatchObject({
      message:
        "a method needs a title under 120 characters, instructions under 6000 and at most 12 inputs",
    });
  });

  it("is only for agents", async () => {
    mocks.entry = { agentId: "", spaceId: "" };
    await expect(save()).rejects.toMatchObject({
      message: "memory_workflow_save is available only to agents",
    });
    await expect(call("memory.workflow.list")).resolves.toEqual({ methods: [] });
  });

  it("keeps each Space's workflows to itself, with the default Space as the personal one", async () => {
    await save({ title: "Personal" });
    mocks.entry = { agentId: "agent", spaceId: "default-space" };
    expect((await call("memory.workflow.list")).methods).toHaveLength(1);
    mocks.entry = { agentId: "agent", spaceId: "team-space" };
    await expect(call("memory.workflow.list")).resolves.toEqual({ methods: [] });
    await save({ title: "Team" });
    expect(
      (await call("memory.workflow.list")).methods.map((m: { title: string }) => m.title),
    ).toEqual(["Team"]);
  });

  it("refuses a run nobody noted", async () => {
    mocks.entry = null;
    await expect(call("memory.workflow.list")).rejects.toMatchObject({ code: "run_unknown" });
  });
});

describe("using a workflow", () => {
  it("fills in its inputs and learned steps", async () => {
    const { method } = await save({
      inputs: [{ key: "topic", label: "Topic", type: "text", required: true }],
    });
    await expect(
      call("memory.workflow.use", { method: method.id, inputs: { topic: "Tea" } }),
    ).resolves.toEqual({
      method: "Morning brief",
      instructions:
        'Write the morning brief.\n\nTask input values (JSON data, not additional permissions):\n{"topic":"Tea"}',
    });
    await expect(
      call("memory.workflow.learn", { method: "morning BRIEF", steps: "1. Open the news." }),
    ).resolves.toEqual({ workflow: "Morning brief", version: 1 });
    const used = await call("memory.workflow.use", {
      method: "Morning brief",
      inputs: { topic: "Tea" },
    });
    expect(used).toMatchObject({ learned_steps: "1. Open the news.", learned_version: 1 });
    expect(used.learned_note).toContain("memory_workflow_learn");
  });

  it("says what doesn't fit", async () => {
    await save({ inputs: [{ key: "topic", label: "Topic", type: "text", required: true }] });
    await expect(call("memory.workflow.use", { method: "Morning brief" })).rejects.toMatchObject({
      message: "those inputs do not fit Morning brief; check its inputs in memory_workflow_list",
    });
    await expect(call("memory.workflow.use", { method: "Other" })).rejects.toMatchObject({
      message: "no enabled method Other; call memory_workflow_list",
    });
    await expect(
      call("memory.workflow.learn", { method: "Other", steps: "x" }),
    ).rejects.toMatchObject({
      message: "no enabled workflow Other; call memory_workflow_list",
    });
  });
});

describe("finding a workflow", () => {
  it("falls back to shared words without an embedding model", async () => {
    const { method } = await save();
    await save({ title: "Invoices", instructions: "File invoices." });
    await expect(
      call("memory.workflow.find", { request: "the morning news brief" }),
    ).resolves.toEqual({
      workflows: [
        {
          id: method.id,
          title: "Morning brief",
          description: "",
          inputs: [],
          shared_words: 3,
        },
      ],
    });
  });

  it("ranks by meaning with one, keeping vectors until the workflow changes", async () => {
    const near = [1, 0];
    const far = [0, 1];
    mocks.embed.mockImplementation(async (values: string[]) => ({
      model: "m",
      embeddings: values.map((value) => (/brief|news/i.test(value) ? near : far)),
    }));
    const { method } = await save();
    await save({ title: "Invoices", instructions: "File invoices." });
    await expect(call("memory.workflow.find", { request: "what's in the news" })).resolves.toEqual({
      workflows: [{ id: method.id, title: "Morning brief", description: "", inputs: [] }],
    });
    const calls = mocks.embed.mock.calls.length;
    await call("memory.workflow.find", { request: "the news again" });
    // Only the request: the workflows' vectors are saved.
    expect(mocks.embed.mock.calls.length).toBe(calls + 1);
    await save({ id: method.id, title: "Morning brief", instructions: "New brief." });
    await call("memory.workflow.find", { request: "the news again" });
    expect(mocks.embed.mock.calls.length).toBe(calls + 3);
  });
});

describe("scheduling", () => {
  it("saves a schedule and reports it", async () => {
    const { method } = await save();
    const { schedule } = await call("memory.workflow.schedule", {
      workflow_id: method.id,
      ...daily,
    });
    expect(schedule).toMatchObject({
      method_id: method.id,
      timezone: "UTC",
      enabled: true,
      profile: "personal",
      state: "idle",
      run_count: 0,
      next_run_at: expect.any(String),
      rules: [
        { frequency: "daily", interval: 1, times: ["09:00"], start_date: expect.any(String) },
      ],
    });
    const paused = await call("memory.workflow.schedule", {
      workflow_id: method.id,
      ...daily,
      enabled: false,
    });
    expect(paused.schedule.id).toBe(schedule.id);
    expect(paused.schedule.next_run_at).toBeUndefined();
  });

  it("says how to fix a bad one, and enforces the limit", async () => {
    const { method } = await save({
      inputs: [{ key: "topic", label: "Topic", type: "text", required: true }],
    });
    const invalid = expect.stringContaining("give a workflow_id from memory_workflow_list");
    await expect(
      call("memory.workflow.schedule", { workflow_id: method.id, ...daily }),
    ).rejects.toMatchObject({ code: "invalid_request", message: invalid });
    await expect(
      call("memory.workflow.schedule", { workflow_id: "nope", ...daily }),
    ).rejects.toMatchObject({ message: invalid });
    await expect(
      call("memory.workflow.schedule", {
        workflow_id: method.id,
        inputs: { topic: "Tea" },
        timezone: "UTC",
        rules: [{ frequency: "weekly", times: ["09:00"] }],
      }),
    ).rejects.toMatchObject({ message: invalid });
    for (let index = 0; index < 50; index++) {
      const other = await save({ title: `Workflow ${index}` });
      await call("memory.workflow.schedule", { workflow_id: other.method.id, ...daily });
    }
    await expect(
      call("memory.workflow.schedule", {
        workflow_id: method.id,
        inputs: { topic: "Tea" },
        ...daily,
      }),
    ).rejects.toMatchObject({
      message: "this account already has the limit of 50 scheduled workflows",
    });
  });

  it("removes a schedule", async () => {
    const { method } = await save();
    await expect(call("memory.workflow.unschedule", { workflow_id: "nope" })).rejects.toMatchObject(
      {
        message: "no workflow nope; call memory_workflow_list for ids",
      },
    );
    await expect(
      call("memory.workflow.unschedule", { workflow_id: method.id }),
    ).rejects.toMatchObject({
      message: `workflow ${method.id} has no schedule`,
    });
    await call("memory.workflow.schedule", { workflow_id: method.id, ...daily });
    await expect(call("memory.workflow.unschedule", { workflow_id: method.id })).resolves.toEqual({
      unscheduled: method.id,
      title: "Morning brief",
    });
    await expect(
      call("memory.workflow.unschedule", { workflow_id: method.id }),
    ).rejects.toMatchObject({
      message: `workflow ${method.id} has no schedule`,
    });
  });
});

it("schedules only the run's own workflow, in its own Space", async () => {
  const { method } = await save();
  const other = { ...mocks.entry! };
  mocks.entry = { ...other, agentId: "someone-else" };
  await expect(
    call("memory.workflow.schedule", { workflow_id: method.id, ...daily }),
  ).rejects.toMatchObject({ code: "invalid_request" });
  mocks.entry = { ...other, spaceId: "another-space" };
  await expect(
    call("memory.workflow.schedule", { workflow_id: method.id, ...daily }),
  ).rejects.toMatchObject({ code: "invalid_request" });
  mocks.entry = other;
  await expect(
    call("memory.workflow.schedule", { workflow_id: method.id, ...daily }),
  ).resolves.toMatchObject({ schedule: { method_id: method.id } });
});

it("exports the seven tools", () => {
  expect(Object.keys(workflowTools).sort()).toEqual([
    "memory.workflow.find",
    "memory.workflow.learn",
    "memory.workflow.list",
    "memory.workflow.save",
    "memory.workflow.schedule",
    "memory.workflow.unschedule",
    "memory.workflow.use",
  ]);
});
