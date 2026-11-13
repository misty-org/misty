import type * as Actual1 from "@/shared/platform/tauri";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", async () => {
  const { fakeInvoke } = await import("./run-state/fakeMistyDb.test-support");
  return { invoke: fakeInvoke };
});
vi.mock("@/shared/platform/tauri", async (actual) => ({
  ...(await actual<typeof Actual1>()),
  hasTauriInternals: () => true,
}));
const published = vi.hoisted(() => [] as { runId: string; event: { type: string } }[]);
vi.mock("@/features/agents/runs/local-run/localRunEvents", () => ({
  publishLocalRunEvent: (runId: string, event: { type: string }) =>
    published.push({ runId, event }),
}));

import { LocalToolRejected } from "./host";
import { changeConversationState, readConversationState } from "./run-state/conversationState";
import { setRunStateAccount } from "./run-state/documents";
import { beforeSwap, rows } from "./run-state/fakeMistyDb.test-support";
import { approvePlan } from "./run-state/plans";
import { forgetKnownRunsForTests, noteRunOwner as rememberRun } from "./runContexts";
import { runStateTools } from "./runStateTools";

const call = (
  name: string,
  input: unknown,
  {
    callId = crypto.randomUUID() as string,
    runId = "run",
    signal = new AbortController().signal,
  } = {},
) =>
  runStateTools[name]!({
    runId,
    callId,
    name,
    input: input as Record<string, unknown>,
    signal,
  }) as Promise<Record<string, unknown>>;

const events = () => published.map((item) => item.event.type);
const state = () => readConversationState("me", "chat");

const refusal = async (work: Promise<unknown>) => {
  const error = (await work.then(
    () => undefined,
    (failure: unknown) => failure,
  )) as LocalToolRejected | undefined;
  expect(error).toBeInstanceOf(LocalToolRejected);
  return error!.message;
};

const planInput = {
  title: "Tidy up",
  summary: "Two steps.",
  steps: [
    { id: "a", title: "Read", risk: "read" },
    { id: "b", title: "Write", risk: "write" },
  ],
};

const proposeAndApprove = async () => {
  await call("plan.propose", planInput);
  await changeConversationState("me", "chat", (current) =>
    approvePlan(current, current.plans[0]!.id, current.plans[0]!.version, Date.now()),
  );
};

beforeEach(async () => {
  rows.clear();
  published.length = 0;
  forgetKnownRunsForTests();
  setRunStateAccount("me");
  await rememberRun("run", { account: "me", conversationId: "chat" });
});
afterEach(() => vi.useRealTimers());

describe("plan tools", () => {
  it("proposes versions, repeats nothing, and ends the run with the server's status", async () => {
    const first = await call("plan.propose", planInput);
    expect(first).toMatchObject({ status: "plan_proposed", version: 1 });
    expect(await call("plan.propose", planInput)).toMatchObject({ plan: first.plan, version: 1 });
    const revised = await call("plan.propose", { ...planInput, title: "Tidy up well" });
    expect(revised).toMatchObject({ version: 2 });
    expect((await state()).plans.map((plan) => [plan.version, plan.state])).toEqual([
      [2, "proposed"],
      [1, "superseded"],
    ]);
    expect(events().filter((type) => type === "plan.proposed")).toHaveLength(3);
  });

  it("refuses a duplicate step id, and fills in a missing one", async () => {
    expect(
      await refusal(
        call("plan.propose", {
          ...planInput,
          steps: [
            { id: "a", title: "One", risk: "read" },
            { id: "a", title: "Two", risk: "read" },
          ],
        }),
      ),
    ).toContain("unique id");
    await call("plan.propose", { ...planInput, steps: [{ title: "One", risk: "read" }] });
    expect((await state()).plans[0]!.plan.steps[0]!.id).toBe("step-1");
  });

  it("records progress on the approved plan, feeds the checklist, and completes", async () => {
    expect(await refusal(call("plan.update", { steps: [{ id: "a", status: "done" }] }))).toContain(
      "no approved plan",
    );
    await proposeAndApprove();
    expect(await refusal(call("plan.update", { steps: [{ id: "z", status: "done" }] }))).toContain(
      "step ids",
    );
    published.length = 0;
    expect(await call("plan.update", { steps: [{ id: "a", status: "done" }] })).toEqual({
      status: "recorded",
      plan_state: "approved",
      remaining: ["b"],
    });
    expect(events()).toEqual(["plan.updated", "checklist.updated"]);
    expect((await state()).checklists[0]!.items.map((item) => [item.id, item.status])).toEqual([
      ["a", "done"],
      ["b", "pending"],
    ]);
    expect(await call("plan.update", { steps: [{ id: "b", status: "skipped" }] })).toEqual({
      status: "recorded",
      plan_state: "completed",
      remaining: [],
    });
  });
});

describe("log.work.checklist", () => {
  const steps = [
    { id: "s1", title: "First", status: "in_progress" },
    { id: "s2", title: "Second", status: "pending" },
  ];

  it("merges by id, keeps titles and delegation, and bumps the version", async () => {
    expect(await call("log.work.checklist", { items: steps, minutes: 5 })).toEqual({
      status: "recorded",
      version: 1,
      remaining: ["s1", "s2"],
      estimateMinutes: 5,
    });
    await call("log.work.checklist", { items: [{ id: "s2", status: "pending", delegated: true }] });
    await call("log.work.checklist", { items: [{ id: "s1", status: "done", note: "ok" }] });
    expect(await call("log.work.checklist", { items: [{ id: "s2", status: "done" }] })).toEqual({
      status: "recorded",
      version: 4,
      remaining: [],
    });
    expect((await state()).checklists[0]!.items).toEqual([
      { id: "s1", title: "First", status: "done", note: "ok" },
      { id: "s2", title: "Second", status: "done", delegated: true },
    ]);
    expect(events().every((type) => type === "checklist.updated")).toBe(true);
  });

  it("replace swaps the list, and the limits hold", async () => {
    await call("log.work.checklist", { items: steps });
    await call("log.work.checklist", {
      items: [{ id: "only", title: "Only", status: "done" }],
      replace: true,
    });
    expect((await state()).checklists[0]!.items.map((item) => item.id)).toEqual(["only"]);
    expect(
      await refusal(call("log.work.checklist", { items: [{ id: "new", status: "pending" }] })),
    ).toContain("a title when new");
    const many = Array.from({ length: 21 }, (_, index) => ({
      id: `s${index}`,
      title: "Step",
      status: "pending",
    }));
    expect(await refusal(call("log.work.checklist", { items: many }))).toContain("input schema");
    expect(await refusal(call("log.work.checklist", { items: steps, minutes: 500 }))).toContain(
      "input schema",
    );
    expect(
      await refusal(
        call("log.work.checklist", { items: [{ id: "s1", title: "T", status: "someday" }] }),
      ),
    ).toContain("input schema");
  });

  it("starts from an approved plan's steps", async () => {
    await proposeAndApprove();
    await call("log.work.checklist", { items: [{ id: "a", status: "in_progress" }] });
    expect((await state()).checklists[0]!.items.map((item) => [item.title, item.status])).toEqual([
      ["Read", "in_progress"],
      ["Write", "pending"],
    ]);
  });

  it("a sub-agent's checklist nests under its parent and reaches both streams", async () => {
    await rememberRun("child", { account: "me", conversationId: "chat", parentRunId: "run" });
    await call("log.work.checklist", { items: steps }, { runId: "child" });
    expect((await state()).checklists[0]!.parentInvocationId).toBe("run");
    expect(published.map((item) => item.runId)).toEqual(["child", "run"]);
  });

  it("two windows writing at once both land", async () => {
    await call("log.work.checklist", { items: steps });
    beforeSwap.hook = () =>
      rows.set(
        "me/collaboration/chat",
        JSON.stringify({ ...JSON.parse(rows.get("me/collaboration/chat")!), mode: "plan" }),
      );
    await call("log.work.checklist", { items: [{ id: "s1", status: "done" }] });
    const after = await state();
    expect(after.mode).toBe("plan");
    expect(after.checklists[0]!.version).toBe(2);
  });
});

describe("log.work notebook", () => {
  it("appends findings and replaces the plan by default, and shows only findings", async () => {
    await expect(call("log.work.read", {})).resolves.toEqual({ plan: "", findings: "" });
    expect(await call("log.work.write", { section: "plan", content: "- one" })).toEqual({
      saved: true,
      section: "plan",
      chars: 5,
    });
    expect(events()).toEqual([]);
    await call("log.work.write", { section: "plan", content: "- two" });
    await call("log.work.write", { section: "findings", content: "first\n" });
    await call("log.work.write", { section: "findings", content: "é" });
    await expect(call("log.work.read", {})).resolves.toEqual({
      plan: "- two",
      findings: "first\né",
    });
    expect(published[published.length - 1]!.event).toMatchObject({
      type: "notebook.updated",
      notebook: { findings: "first\né" },
    });
    await expect(
      call("log.work.write", { section: "findings", content: "new", mode: "replace" }),
    ).resolves.toEqual({ saved: true, section: "findings", chars: 3 });
  });

  it("refuses a section over its limit, a blank write and a bad section", async () => {
    await call("log.work.write", { section: "plan", content: "x".repeat(20_000) });
    expect(
      await refusal(call("log.work.write", { section: "plan", content: "y", mode: "append" })),
    ).toContain("notebook section is full");
    expect(await refusal(call("log.work.write", { section: "plan", content: "  " }))).toContain(
      "input schema",
    );
    expect(await refusal(call("log.work.write", { section: "other", content: "x" }))).toContain(
      "input schema",
    );
    for (let index = 0; index < 4; index++)
      await call("log.work.write", { section: "findings", content: "y".repeat(20_000) });
    expect(
      await refusal(call("log.work.write", { section: "findings", content: "y".repeat(20_000) })),
    ).toContain("notebook section is full");
  });

  it("a sub-agent writes to its parent's notebook and shows in its parent's chat", async () => {
    await rememberRun("child", {
      account: "me",
      conversationId: "chat",
      parentRunId: "run",
      notebookKey: "conversation:chat",
    });
    await call("log.work.write", { section: "findings", content: "found" }, { runId: "child" });
    await expect(call("log.work.read", {})).resolves.toMatchObject({ findings: "found" });
    expect(published.map((item) => item.runId)).toEqual(["run"]);
  });

  it("a run outside any chat keeps its own", async () => {
    await rememberRun("loose", { account: "me", conversationId: "" });
    await call("log.work.write", { section: "plan", content: "mine" }, { runId: "loose" });
    expect(rows.has("me/notebook/invocation:loose")).toBe(true);
  });
});
