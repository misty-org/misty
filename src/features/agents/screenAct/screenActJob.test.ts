import { beforeEach, expect, it, vi } from "vitest";
import type { MistyScreenDevice } from "./screenDevice";
type Script = (device: MistyScreenDevice, goal: string) => Promise<string | undefined>;
const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  script: undefined as unknown as Script,
  options: undefined as unknown,
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@/api/client", () => ({ apiRequest: vi.fn() }));
// Midscene's Agent plans; these tests script its plans against the real device.
vi.mock("@midscene/core/agent", () => ({
  Agent: class {
    constructor(
      readonly device: MistyScreenDevice,
      options: unknown,
    ) {
      mocks.options = options;
    }
    aiAct(goal: string) {
      return mocks.script(this.device, goal);
    }
  },
}));
import { runScreenAct } from "./screenActJob";

let frames = 0;
let changing = true;
const frame = () => ({
  documentId: `doc-${frames}`,
  image: { dataUrl: `data:image/png;base64,${changing ? frames++ : 0}`, width: 800, height: 600 },
});
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
/** Runs one planned action the way Midscene does and returns its planning note. */
async function act(device: MistyScreenDevice, name: string, param: Record<string, unknown>) {
  await device.size();
  await device.screenshotBase64();
  const action = device.actionSpace().find((candidate) => candidate.name === name)!;
  const context = { task: {} as { planningFeedback?: string } };
  await action.call(param, context as never);
  return context.task.planningFeedback;
}
beforeEach(() => {
  frames = 0;
  changing = true;
  mocks.invoke.mockReset();
  mocks.invoke.mockImplementation(
    async (name: string, args: { request: { operation: string } }) => {
      if (name === "browser_runtime_for_scope") return "runtime";
      if (name !== "browser_agent_execute") return undefined;
      return args.request.operation.endsWith(".visual") ? frame() : { cursor: { x: 0.5, y: 0.25 } };
    },
  );
});

it("runs one goal with Midscene's Agent under its own grant", async () => {
  let note: string | undefined;
  mocks.script = async (device) => {
    note = await act(device, "click", {
      x: 0.5,
      y: 0.25,
      consequential: false,
      description: "Save",
    });
    return "The draft is saved.";
  };
  const result = await runScreenAct(job, new AbortController().signal);
  expect(result).toMatchObject({
    status: "done",
    summary: "The draft is saved.",
    actions: 1,
    cursor: { x: 0.5, y: 0.25 },
  });
  expect(mocks.options).toMatchObject({ generateReport: false, waitAfterAction: 0 });
  expect(mocks.invoke).toHaveBeenCalledWith("browser_agent_grant_register", {
    request: expect.objectContaining({
      grantId: "ctx:job:act",
      capabilities: ["browser.visual", "browser.interact"],
    }),
  });
  expect(calls("browser.interact")[0][1].request.input).toMatchObject({
    documentId: "doc-0",
    action: { kind: "native", input: { kind: "click", x: 0.5, y: 0.25 } },
    __mistyTaskId: "task",
  });
  expect(note).toContain("Cursor now at (0.500, 0.250)");
  expect(mocks.invoke).toHaveBeenLastCalledWith("browser_agent_grant_revoke", {
    request: { id: "runtime", grantId: "ctx:job:act" },
  });
});

it("stops before a consequential action unless the user allowed it", async () => {
  const send = { x: 0.9, y: 0.9, consequential: true, description: "Send" };
  mocks.script = async (device) => {
    await act(device, "click", send);
    return "Sent.";
  };
  const result = await runScreenAct(job, new AbortController().signal);
  expect(result.status).toBe("needs_confirmation");
  expect(calls("browser.interact")).toHaveLength(0);
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
  mocks.script = async (device) => {
    await device.size();
    return undefined;
  };
  await expect(runScreenAct(job, new AbortController().signal)).rejects.toMatchObject({
    message: "browser_context_closed",
  });
  const { DeviceOperationNotAttempted } = await import("../workerBrowserJobs");
  await expect(runScreenAct(job, new AbortController().signal)).rejects.toBeInstanceOf(
    DeviceOperationNotAttempted,
  );
});

it("answers with the planner's reason when it cannot finish", async () => {
  mocks.script = async () => {
    throw new Error("Task failed: The page asks for a sign-in code.\nlog");
  };
  const result = await runScreenAct(job, new AbortController().signal);
  expect(result).toMatchObject({
    status: "incomplete",
    summary: "The page asks for a sign-in code.",
  });
});

it("ends the goal when the page stops responding to its actions", async () => {
  changing = false;
  const notes: Array<string | undefined> = [];
  const click = { x: 0.3, y: 0.1, consequential: false, description: "Click Save" };
  mocks.script = async (device) => {
    for (;;) notes.push(await act(device, "click", click));
  };
  const result = await runScreenAct(job, new AbortController().signal);
  expect(result).toMatchObject({ status: "incomplete", actions: 3 });
  expect(result.summary).toContain("did not respond after 3 tries at: Click Save");
  expect(notes[0]).toContain('The screenshot did not change after "Click Save"');
});

it("waits on the live capture without acting", async () => {
  // The bot moves once, then the board holds still.
  mocks.invoke.mockImplementation(async (name: string) => {
    if (name === "browser_runtime_for_scope") return "runtime";
    if (name !== "browser_agent_execute") return undefined;
    const next = Math.min(frames++, 2);
    return { documentId: `doc-${next}`, image: { ...frame().image, dataUrl: `data:${next}` } };
  });
  let note: string | undefined;
  mocks.script = async (device) => {
    note = await act(device, "WaitForScreenChange", {
      timeoutSeconds: 5,
      description: "The bot's move",
    });
    return "Waited.";
  };
  const result = await runScreenAct(job, new AbortController().signal);
  expect(result).toMatchObject({ status: "done", actions: 0 });
  expect(note).toMatch(/The screen changed after \d+s and has settled/);
  expect(calls("browser.interact")).toHaveLength(0);
});

it("acts on the desktop through workspace actions with Misty's own cursor", async () => {
  const desktop = { ...job, config: { ...job.config, surface: "desktop" } };
  mocks.invoke.mockImplementation(
    async (name: string, args: { request: { operation: string } }) => {
      if (name === "browser_runtime_for_scope") return "runtime";
      if (name !== "browser_agent_execute") return undefined;
      return args.request.operation === "browser.workspace.visual" ? frame() : { attempted: true };
    },
  );
  let names: string[] = [];
  mocks.script = async (device) => {
    names = device.actionSpace().map((action) => action.name);
    await act(device, "click", {
      x: 0.4,
      y: 0.6,
      consequential: false,
      description: "Click Add Row",
    });
    await act(device, "key", {
      key: "SelectAll",
      consequential: false,
      description: "Select the cell text",
    });
    return "Row added.";
  };
  const result = await runScreenAct(desktop, new AbortController().signal);
  expect(result).toMatchObject({ status: "done", actions: 2, cursor: { x: 0.4, y: 0.6 } });
  expect(names).not.toContain("drag");
  expect(mocks.invoke).toHaveBeenCalledWith("browser_agent_grant_register", {
    request: expect.objectContaining({
      capabilities: ["browser.workspace.visual", "browser.workspace.interact"],
    }),
  });
  expect(calls("browser.workspace.interact").map(([, args]) => args.request.input.action)).toEqual([
    { kind: "point", x: 0.4, y: 0.6 },
    { kind: "key", key: "SelectAll" },
  ]);
});
