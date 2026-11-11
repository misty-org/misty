import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  call,
  failure,
  grant,
  lastJob,
  mocks,
  resetDeviceTools,
  scope,
  start,
  tab,
} from "./deviceTools.testFixtures";
import { DeviceOperationNotAttempted } from "../runs/jobs/workerBrowserJobs";
import { deviceTools } from "./deviceTools";
import { LocalToolRejected, LocalToolUncertain } from "./host";

beforeEach(resetDeviceTools);

describe("the run", () => {
  it("covers every device tool", () => {
    expect(Object.keys(deviceTools)).toHaveLength(24);
  });

  it("refuses a run this computer has no record of, and does nothing", async () => {
    const error = await failure(call("browser.snapshot", { scopeId: scope }));
    expect(error).toBeInstanceOf(LocalToolRejected);
    expect((error as LocalToolRejected).code).toBe("run_context_unknown");
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it("checks the input as the server's registry does", async () => {
    await start();
    for (const input of [{}, { scopeId: "short" }, { scopeId: scope, extra: 1 }]) {
      const error = await failure(call("browser.snapshot", input));
      expect((error as LocalToolRejected).code).toBe("invalid_arguments");
    }
    expect(mocks.execute).not.toHaveBeenCalled();
  });
});

describe("scopes", () => {
  it("refuses a scope the run wasn't given", async () => {
    await start();
    const error = await failure(call("browser.snapshot", { scopeId: "agent-scope-other" }));
    expect(error.message).toBe("This tool call is not allowed for the current run.");
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it("refuses a tab that works for another window", async () => {
    await start({}, [tab(scope, { window_label: "other" })]);
    const error = await failure(call("browser.snapshot", { scopeId: scope }));
    expect((error as LocalToolRejected).code).toBe("tool_not_allowed");
  });

  it("refuses the Misty window and desktop to anything but the foreground task", async () => {
    await start({ executionMode: "user" }, [tab(scope, { workspace_control: true })]);
    const error = await failure(call("browser.act", { scopeId: scope, goal: "draw a house" }));
    expect((error as LocalToolRejected).code).toBe("tool_not_allowed");
    await start({ executionMode: "agent", taskId: "task" }, [
      tab(scope, { workspace_control: true }),
    ]);
    await call("browser.act", { scopeId: scope, goal: "draw a house" });
    expect(lastJob().config.surface).toBe("workspace");
  });
});

describe("the job", () => {
  it("is the envelope the worker receives, within what native code accepts", async () => {
    await start({ taskId: "task" }, [tab(scope, { task_id: "own-task" })]);
    await call("browser.snapshot", { scopeId: scope });
    const job = lastJob();
    expect(job).toMatchObject({
      runId: "run",
      nodeId: "browser_tool_call",
      scopeId: scope,
      operation: "browser.snapshot",
      attempt: 1,
      controlVersion: 2,
      input: { scopeId: scope },
    });
    expect(job.config).toMatchObject({
      agentId: "agent",
      taskId: "own-task",
      runGrant: grant,
      contextId: job.contextId,
    });
    // Native code reads what stops, what's blocked and what's remembered itself.
    for (const field of ["confirmKinds", "grantSet", "siteBlocks"])
      expect(job.config).not.toHaveProperty(field);
    expect(job.leaseExpiresAt).toBe(job.deadlineAt);
    expect(Date.parse(job.deadlineAt) - Date.now()).toBeLessThanOrEqual(301_000);
  });

  it("gives a program its 170 seconds at the workspace scope", async () => {
    await start();
    await call("browser.run", { code: "return 1" });
    const job = lastJob();
    expect(job.scopeId).toBe("workspace:device");
    expect(job.input).toMatchObject({ conversationId: "conversation", code: "return 1" });
    const left = Date.parse(job.deadlineAt) - Date.now();
    expect(left).toBeGreaterThan(160_000);
    expect(left).toBeLessThanOrEqual(170_000);
  });
});

describe("failures", () => {
  const fails = async (name: string, input: Record<string, unknown>, error: unknown) => {
    await start();
    mocks.execute.mockRejectedValue(error);
    return failure(call(name, { scopeId: scope, ...input }));
  };

  it("makes an action that may have happened uncertain", async () => {
    const error = await fails("browser.navigate", { url: "https://a.co" }, new Error("lost it"));
    expect(error).toBeInstanceOf(LocalToolUncertain);
    expect(error.message).toContain("may have completed");
  });

  it("lets the model correct what certainly never ran", async () => {
    const error = await fails(
      "browser.navigate",
      { url: "https://a.co" },
      new DeviceOperationNotAttempted(new Error("browser_context_closed")),
    );
    expect(error).toBeInstanceOf(LocalToolRejected);
    expect(error.message).toBe(
      "browser_tab_closed: That tab is closed. List your tabs, or open the page again.",
    );
  });

  it("gives a stale page the server's words", async () => {
    const error = await fails(
      "browser.steps",
      { documentId: "document-1", steps: [{ action: "click", ref: "e1" }] },
      new DeviceOperationNotAttempted(new Error("browser_snapshot_stale: changed")),
    );
    expect((error as LocalToolRejected).code).toBe("browser_snapshot_stale");
    expect(error.message).toContain("No action was dispatched");
  });

  it("never makes an observation uncertain", async () => {
    const error = await fails(
      "browser.snapshot",
      {},
      new Error("failed to send message to the webview"),
    );
    expect(error).toBeInstanceOf(LocalToolRejected);
    expect((error as LocalToolRejected).code).toBe("browser_webview_unavailable");
  });

  it("counts a stopped look as a failed look, and a stopped action as uncertain", async () => {
    await start();
    mocks.execute.mockReturnValue(new Promise(() => undefined));
    const stop = new AbortController();
    const look = failure(call("browser.snapshot", { scopeId: scope }, stop.signal));
    const act = failure(
      call("browser.navigate", { scopeId: scope, url: "https://a.co" }, stop.signal),
    );
    await vi.waitFor(() => expect(mocks.execute).toHaveBeenCalledTimes(2));
    stop.abort(new Error("agent_tool_cancelled"));
    expect(((await look) as LocalToolRejected).code).toBe("browser_observation_failed");
    expect(await act).toBeInstanceOf(LocalToolUncertain);
  });

  it("ends the run when this computer can't open a browser", async () => {
    await start();
    mocks.execute.mockRejectedValue(new Error("agent_busy: taken"));
    const error = await failure(call("screen.open", { reason: "to read", url: "https://a.co" }));
    expect((error as LocalToolRejected).code).toBe("device_offline");
    expect(error.message).toContain("is busy with another task");
  });

  it("reports an unfinished program without stopping the run", async () => {
    await start();
    mocks.execute.mockRejectedValue(new Error("agent_task_paused"));
    await expect(call("browser.run", { code: "return 1" })).resolves.toMatchObject({ ok: false });
  });
});
