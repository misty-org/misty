import { beforeEach, describe, expect, it, vi } from "vitest";
import { call, failure, grant, lastJob, mocks, resetDeviceTools, scope, start, tab, workspace } from "./deviceTools.testFixtures";
import { useAgentInterventions } from "@/features/agent-interventions/store";
import { followLocalRunEvents } from "@/features/ai-surface/localRunEvents";
import type { AiInvocationDeviceContext, AiInvocationRequest } from "@/features/ai-surface/types";
import { LocalToolRejected, LocalToolUncertain } from "./host";

beforeEach(resetDeviceTools);

describe("screen requests", () => {
  const events = () => {
    const seen: unknown[] = [];
    followLocalRunEvents("run", (event) => seen.push(event));
    return seen;
  };

  it("raises a request for a look, and ends the response", async () => {
    await start();
    const seen = events();
    await expect(call("screen.look", { reason: "see this" })).resolves.toMatchObject({
      status: "screen_requested",
      kind: "look",
    });
    expect(seen).toEqual([
      expect.objectContaining({
        type: "screen.request",
        screenRequest: { kind: "look", reason: "see this", location: "window" },
      }),
    ]);
  });

  it("has nothing to add when the screen came with the request", async () => {
    await start({ capture: {} as AiInvocationRequest["capture"] });
    const seen = events();
    await expect(call("screen.look", { reason: "see this" })).resolves.toMatchObject({
      status: "open",
    });
    expect(seen).toEqual([]);
  });

  it("never works in the person's own tab, whatever the setting says", async () => {
    await start({}, [tab()]);
    mocks.apiRequest.mockResolvedValue({ settings: { screen_location: "current" } });
    const seen = events();
    await call("screen.open", { reason: "for the desktop", target: "desktop" });
    expect(seen).toEqual([
      expect.objectContaining({
        screenRequest: { kind: "desktop", reason: "for the desktop", location: "window", chosen: true },
      }),
    ]);
  });
});

describe("waiting for the person", () => {
  const input = { scopeId: scope, action: "sign_in", reason: "Sign in to continue" };

  beforeEach(() => useAgentInterventions.getState().setAccount("account"));

  const pending = () => useAgentInterventions.getState().items.find((item) => item.runId === "run");

  it("holds the call until they continue, with no trip to the server", async () => {
    await start();
    const statuses: string[] = [];
    followLocalRunEvents("run", (event) => {
      if (event.type === "assistant.status") statuses.push(event.phase ?? "");
    });
    let settled = false;
    const held = call("browser.request_user_action", input).finally(() => {
      settled = true;
    });
    await vi.waitFor(() => expect(pending()).toBeTruthy());
    expect(pending()).toMatchObject({ action: "sign_in", targetLabel: "Browser" });
    expect(settled).toBe(false);
    mocks.apiRequest.mockClear();
    await useAgentInterventions.getState().decide("account", pending()!.id, true);
    await expect(held).resolves.toMatchObject({
      ready: true,
      scopeId: scope,
      requiresFreshInspection: true,
    });
    expect(mocks.apiRequest).not.toHaveBeenCalled();
    expect(pending()).toBeUndefined();
    expect(statuses).toEqual(["awaiting_intervention", "intervention_resume_pending"]);
  });

  it("tells the model when they stop", async () => {
    await start();
    const held = call("browser.request_user_action", input);
    await vi.waitFor(() => expect(pending()).toBeTruthy());
    await useAgentInterventions.getState().decide("account", pending()!.id, false);
    await expect(held).resolves.toMatchObject({
      denied: true,
      reason: "user_action_declined_or_expired",
    });
  });

  it("closes the card when the run stops waiting", async () => {
    await start();
    const stop = new AbortController();
    const held = call("browser.request_user_action", input, stop.signal);
    await vi.waitFor(() => expect(pending()).toBeTruthy());
    stop.abort();
    await expect(held).resolves.toMatchObject({ denied: true });
    expect(pending()).toBeUndefined();
  });

  it("refuses to wait on a screen the run can't see", async () => {
    await start({}, [{ ...tab(), capabilities: ["browser.navigate"] }]);
    const error = await failure(call("browser.request_user_action", input));
    expect((error as LocalToolRejected).code).toBe("tool_not_allowed");
  });
});

describe("the computer's own tools", () => {
  const folder: AiInvocationDeviceContext = {
    deviceId: "device",
    kind: "local_folder",
    opaqueRef: "folder-scope",
    displayName: "Docs",
    capabilities: ["folder.list", "folder.read", "folder.send"],
    metadata: { source: "shared-folder" },
    runGrant: grant,
  };

  it("finds a folder by its name or label and keeps paths inside it", async () => {
    await start({}, [folder]);
    await call("folder.list", { folder: "Docs (Mac)", path: "/Reports/" });
    expect(lastJob().input).toEqual({ scopeId: "folder-scope", relativePath: "Reports" });
    await expect(call("folder.read", { folder: "docs", path: "../secret" })).rejects.toThrow(
      "use a path inside the folder",
    );
    await expect(call("folder.read", { folder: "Other", path: "a" })).rejects.toThrow(
      "shared folders: Docs (Mac)",
    );
  });

  it("refuses a folder tool to a run with no folder", async () => {
    await start({}, [workspace]);
    await expect(call("folder.list", { folder: "Docs" })).rejects.toThrow("not allowed");
  });

  it("passes a command with the chat's folder, in the job's own words", async () => {
    await start({}, [workspace, { ...folder, capabilities: ["folder.read"] }]);
    await call("shell.run", { command: "ls", timeout_seconds: 5 });
    expect(lastJob().input).toEqual({
      command: "ls",
      timeoutSeconds: 5,
      folderScopeId: "folder-scope",
    });
  });

  it("makes a shell failure correctable, and a command that ran out of time uncertain", async () => {
    await start({}, [workspace]);
    mocks.execute.mockRejectedValueOnce(new Error("shell_job_invalid"));
    const error = await failure(call("shell.run", { command: "ls" }));
    expect(error).toBeInstanceOf(LocalToolRejected);
    expect(error.message).toContain("could not do that");
    mocks.execute.mockReturnValueOnce(new Promise(() => undefined));
    const stop = new AbortController();
    const running = failure(call("shell.run", { command: "ls" }, stop.signal));
    await vi.waitFor(() => expect(mocks.execute).toHaveBeenCalledTimes(2));
    stop.abort();
    expect(await running).toBeInstanceOf(LocalToolUncertain);
  });
});
