import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ invoke: vi.fn(), plan: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("./screenActPlanner", () => ({ planScreenAction: mocks.plan }));
import { runScreenAct } from "./screenActJob";

const frame = {
  documentId: "doc",
  image: { dataUrl: "data:image/png;base64,AA", width: 800, height: 600 },
};
const job = {
  id: "job",
  scopeId: "agent-scope-1",
  contextId: "ctx",
  deadlineAt: new Date(Date.now() + 300_000).toISOString(),
  input: { goal: "Save the draft" },
  config: { agentId: "agent", taskId: "task" },
};
const calls = (operation: string) =>
  mocks.invoke.mock.calls.filter(
    ([name, args]) => name === "browser_agent_execute" && args.request.operation === operation,
  );
beforeEach(() => {
  mocks.invoke.mockReset();
  mocks.plan.mockReset();
  mocks.invoke.mockImplementation(
    async (name: string, args: { request: { operation: string } }) => {
      if (name === "browser_runtime_for_scope") return "runtime";
      if (name !== "browser_agent_execute") return undefined;
      return args.request.operation === "browser.visual" ? frame : { cursor: { x: 0.5, y: 0.25 } };
    },
  );
});

it("runs one goal locally with its own grant and reports where the cursor stopped", async () => {
  mocks.plan
    .mockResolvedValueOnce({
      action: { kind: "click", x: 0.5, y: 0.25 },
      consequential: false,
      description: "Save",
      complete: false,
      message: "",
    })
    .mockResolvedValueOnce({ complete: true, message: "The draft is saved." });
  const result = await runScreenAct(job, new AbortController().signal);
  expect(result).toMatchObject({
    status: "done",
    summary: "The draft is saved.",
    actions: 1,
    cursor: { x: 0.5, y: 0.25 },
  });
  expect(mocks.invoke).toHaveBeenCalledWith("browser_agent_grant_register", {
    request: expect.objectContaining({
      grantId: "ctx:job:act",
      capabilities: ["browser.visual", "browser.interact"],
    }),
  });
  expect(calls("browser.interact")[0][1].request.input).toMatchObject({
    documentId: "doc",
    action: { kind: "native", input: { kind: "click", x: 0.5, y: 0.25 } },
    __mistyTaskId: "task",
  });
  expect(mocks.plan.mock.calls[1][4][0]).toContain("Cursor now at (0.500, 0.250)");
  expect(mocks.invoke).toHaveBeenLastCalledWith("browser_agent_grant_revoke", {
    request: { id: "runtime", grantId: "ctx:job:act" },
  });
});

it("stops before a consequential action unless the user allowed it", async () => {
  mocks.plan.mockResolvedValue({
    action: { kind: "click", x: 0.9, y: 0.9 },
    consequential: true,
    description: "Send",
    complete: false,
    message: "",
  });
  const result = await runScreenAct(job, new AbortController().signal);
  expect(result.status).toBe("needs_confirmation");
  expect(calls("browser.interact")).toHaveLength(0);
  mocks.plan
    .mockResolvedValueOnce({
      action: { kind: "click", x: 0.9, y: 0.9 },
      consequential: true,
      description: "Send",
      complete: false,
      message: "",
    })
    .mockResolvedValueOnce({ complete: true, message: "Sent." });
  const allowed = await runScreenAct(
    { ...job, input: { goal: "Send it", allowConsequential: true } },
    new AbortController().signal,
  );
  expect(allowed.status).toBe("done");
  expect(calls("browser.interact")[0][1].request.input.consequential).toBe(true);
});

it("reports a failure before any input as not attempted", async () => {
  mocks.invoke.mockImplementation(async (name: string) => {
    if (name === "browser_runtime_for_scope") return "runtime";
    if (name === "browser_agent_execute") throw new Error("browser_context_closed");
  });
  await expect(runScreenAct(job, new AbortController().signal)).rejects.toMatchObject({
    name: "Error",
    message: "browser_context_closed",
  });
  const { DeviceOperationNotAttempted } = await import("../workerBrowserJobs");
  await expect(runScreenAct(job, new AbortController().signal)).rejects.toBeInstanceOf(
    DeviceOperationNotAttempted,
  );
});

it("feeds a malformed planner reply back once instead of ending the goal", async () => {
  mocks.plan
    .mockRejectedValueOnce(new Error("XML parse error: Invalid parameters for action click"))
    .mockResolvedValueOnce({ complete: true, message: "Done." });
  const result = await runScreenAct(job, new AbortController().signal);
  expect(result).toMatchObject({ status: "done", actions: 0 });
  expect(mocks.plan.mock.calls.map((call) => call[1])).toEqual([0, 1]);
  expect(mocks.plan.mock.calls[1][4][0]).toContain("Your last reply was invalid");
});

it("ends the goal when the page stops responding to its actions", async () => {
  mocks.plan.mockResolvedValue({
    action: { kind: "click", x: 0.3, y: 0.1 },
    consequential: false,
    description: "Click Save",
    complete: false,
    message: "",
  });
  const result = await runScreenAct(job, new AbortController().signal);
  expect(result).toMatchObject({ status: "incomplete", actions: 3 });
  expect(result.summary).toContain("did not respond after 3 tries at: Click Save");
  expect(mocks.plan.mock.calls[2][4]).toContain(
    'The screenshot did not change after "Click Save". Try something different or report that you cannot finish.',
  );
});
