import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SaveAgentMethod } from "@/features/agents/api/agent-methods";

const mocks = vi.hoisted(() => ({ request: vi.fn(), cached: vi.fn() }));

vi.mock("@tauri-apps/api/core", async () => {
  const { fakeDocuments } = await import("./fakeDocuments");
  return { invoke: fakeDocuments.invoke };
});
vi.mock("@tauri-apps/api/event", () => ({
  emit: async () => undefined,
  listen: async () => () => undefined,
}));
vi.mock("@/shared/platform/tauri", () => ({ hasTauriInternals: () => true }));
vi.mock("@/api/ai/workflows-location", () => ({ workflowsOnThisComputer: () => true }));
vi.mock("@/api/client", () => ({ apiRequest: mocks.request }));
vi.mock("@/api/cache/cached-request", () => ({ cachedRequest: mocks.cached }));
vi.mock("@/features/agents/conversations/state/useMistyStore", () => ({
  useMistyStore: { getState: () => ({ accountId: "account" }) },
}));

const { fakeDocuments } = await import("./fakeDocuments");
const { agentMethodsApi } = await import("@/features/agents/api/agent-methods");

const input: SaveAgentMethod = {
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
};
const timing = {
  timezone: "UTC",
  rules: [{ frequency: "daily" as const, times: ["09:00"] }],
  skip_dates: [],
  inputs: { topic: "Tea" },
  enabled: true,
  profile: "work",
};

beforeEach(() => {
  fakeDocuments.reset();
  mocks.request.mockReset();
  mocks.cached.mockReset();
});

describe("agentMethodsApi on this computer", () => {
  it("saves, lists and schedules without asking the server", async () => {
    const { method } = await agentMethodsApi.save(input);
    const { schedule } = await agentMethodsApi.saveSchedule(method.id, timing);
    expect(schedule).toMatchObject({ method_id: method.id, profile: "work", state: "idle" });
    const { methods } = await agentMethodsApi.list("agent");
    expect(methods).toHaveLength(1);
    expect(methods[0]).toMatchObject({ id: method.id, schedule: { id: schedule.id } });
    expect(methods[0]).not.toHaveProperty("versions");
    expect((await agentMethodsApi.list("other")).methods).toEqual([]);
    expect((await agentMethodsApi.upcoming()).runs[0]).toMatchObject({
      title: "Brief",
      agent_id: "agent",
    });
    await agentMethodsApi.removeSchedule(method.id);
    expect((await agentMethodsApi.list("agent")).methods[0]?.schedule).toBeUndefined();
    expect(mocks.request).not.toHaveBeenCalled();
    expect(mocks.cached).not.toHaveBeenCalled();
  });

  it("renders a version's instructions", async () => {
    const { method } = await agentMethodsApi.save(input);
    await expect(
      agentMethodsApi.instantiate(method.version_id, { topic: "Tea" }),
    ).resolves.toMatchObject({
      prompt: expect.stringContaining('{"topic":"Tea"}'),
      method: { id: method.id },
    });
    await expect(agentMethodsApi.instantiate(method.version_id, {})).rejects.toMatchObject({
      status: 400,
    });
    await expect(agentMethodsApi.instantiate("gone", {})).rejects.toMatchObject({ status: 404 });
  });

  it("refuses with the statuses the page reads", async () => {
    const { method } = await agentMethodsApi.save(input);
    await agentMethodsApi.save({ ...input, id: method.id, expected_version: 1 });
    await expect(
      agentMethodsApi.save({ ...input, id: method.id, expected_version: 1 }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      agentMethodsApi.saveSchedule(method.id, { ...timing, inputs: {} }),
    ).rejects.toMatchObject({ status: 400, code: "invalid_schedule" });
    await expect(agentMethodsApi.removeSchedule(method.id)).rejects.toMatchObject({ status: 404 });
  });
});
