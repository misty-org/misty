import type * as Actual1 from "@/shared/platform/tauri";
import { beforeEach, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", async () => {
  const { fakeInvoke } = await import("./runState/fakeMistyDb.test-support");
  return { invoke: fakeInvoke };
});
vi.mock("@/shared/platform/tauri", async (actual) => ({
  ...(await actual<typeof Actual1>()),
  hasTauriInternals: () => true,
}));
const run = vi.hoisted(() => ({
  created: [] as Record<string, unknown>[],
  follow: vi.fn(),
  published: [] as { type: string; delegation?: { children: unknown[] } }[],
}));
vi.mock("@/features/ai-surface/api", () => ({
  aiSurfaceApi: {
    createInvocation: async (input: Record<string, unknown>) => {
      run.created.push(input);
      return { invocationId: `child-${run.created.length}` };
    },
  },
}));
vi.mock("@/features/ai-surface/invocationSubscription", () => ({ readRunFollow: run.follow }));
vi.mock("@/features/ai-surface/localRunEvents", () => ({
  followLocalRunEvents: () => () => undefined,
  publishLocalRunEvent: (_run: string, event: (typeof run.published)[number]) =>
    run.published.push(event),
}));
vi.mock("./deviceJob", () => ({
  buildDeviceJob: () => ({}),
  settleDeviceJob: async () => ({ ok: false }),
  deviceJobMs: 1000,
}));

import { delegatedPrompt, delegationTools } from "./delegationTools";
import { LocalToolRejected } from "./host";
import { noteRunOwner, rememberRun } from "./runContexts";
import type { AiInvocationRequest } from "@/features/ai-surface/types";

const call = (name: string, input: Record<string, unknown>, callId = "call") =>
  delegationTools[name]!({
    runId: "parent",
    callId,
    name,
    input,
    signal: new AbortController().signal,
  });

beforeEach(async () => {
  const { rows, settings } = await import("./runState/fakeMistyDb.test-support");
  rows.clear();
  settings.clear();
  run.created.length = 0;
  run.published.length = 0;
  run.follow.mockReset();
  await rememberRun(
    "parent",
    "chat",
    { agentId: "agent", permissionMode: "auto" } as AiInvocationRequest,
    [],
    { account: "me" },
  );
});

it("gives a sub-agent everything it knows, and no way to ask anyone", () => {
  const prompt = delegatedPrompt({ goal: " Find it ", context: "Facts" });
  expect(prompt).toContain("there is no one to ask");
  expect(prompt).toContain("Goal: Find it");
  expect(prompt).toContain("Context:\nFacts");
  expect(prompt).toContain("End with agent_finish: a concise answer");
});

it("refuses tasks it can't start", async () => {
  await expect(call("agent.delegate", { tasks: [] })).rejects.toBeInstanceOf(LocalToolRejected);
  await expect(
    call("agent.delegate", { tasks: [{ goal: "a" }, { goal: "b" }, { goal: "c" }, { goal: "d" }] }),
  ).rejects.toThrow("give 1–3 tasks");
  await expect(
    call("agent.delegate", { tasks: [{ goal: "a", output_schema: { type: "array" } }] }),
  ).rejects.toThrow("type object");
  await expect(call("agent.wait", {})).rejects.toThrow("no sub-agents");
});

it("starts children under the parent, shows them, and returns their answers", async () => {
  run.follow.mockImplementation(async () => ({
    state: "completed",
    events: [{ type: "assistant.message", text: '{"capital":"Paris"}' }],
  }));
  const result = (await call("agent.delegate", {
    tasks: [{ goal: "France", output_schema: { type: "object" } }, { goal: "Japan" }],
    browser: false,
  })) as { subagents: Record<string, unknown>[]; still_running: number };
  expect(run.created).toHaveLength(2);
  expect(run.created[0]).toMatchObject({
    trigger: "delegated",
    delegatedFrom: "parent",
    parentRunId: "parent",
    notebookKey: "conversation:chat",
    agentId: "agent",
    permissionMode: "auto",
    idempotencyKey: "delegate:parent:call:0",
    deviceContexts: [],
  });
  expect(result.still_running).toBe(0);
  expect(result.subagents[0]).toMatchObject({ task: 1, state: "completed", output: { capital: "Paris" } });
  expect(result.subagents[1]).toMatchObject({ task: 2, answer: '{"capital":"Paris"}' });
  expect(run.published[run.published.length - 1]).toMatchObject({ type: "delegation.updated" });
});

it("a retried call waits for the children it already started", async () => {
  run.follow.mockResolvedValue({ state: "completed", events: [] });
  await call("agent.delegate", { tasks: [{ goal: "One" }], browser: false });
  await call("agent.delegate", { tasks: [{ goal: "One" }], browser: false });
  expect(run.created).toHaveLength(1);
});

it("a sub-agent can't start its own", async () => {
  await noteRunOwner("parent", { account: "me", conversationId: "", parentRunId: "root" });
  await expect(call("agent.delegate", { tasks: [{ goal: "a" }], browser: false })).rejects.toThrow(
    "Sub-agents can't",
  );
});
