import { beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({
  list: [] as Array<{ command: string; args: any }>,
  fail: new Set<string>(),
  pressure: "normal",
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (command: string, args: any) => {
    calls.list.push({ command, args });
    if (calls.fail.has(command)) throw new Error(`${command} failed`);
    if (command === "system_memory_pressure") return calls.pressure;
    if (command === "browser_webview_sleep")
      return { closed: true, url: "https://example.com/item", title: "Item" };
    return undefined;
  }),
}));
vi.mock("@/features/workspace/browserHome", () => ({ browserHomeUrl: () => "misty://home" }));

import { resetAgentBrowser, useAgentBrowser } from "./agentBrowser/agentBrowserStore";
import {
  agentTab,
  noteAgentPage,
  noteAgentTabJob,
  resetAgentTabs,
  sleepIdleAgentTabs,
  sleepAgentTab,
  sleepTaskTabs,
  trackAgentTab,
  wakeAgentTab,
} from "./agentTabs";

const commands = (name: string) => calls.list.filter((call) => call.command === name);

beforeEach(() => {
  resetAgentTabs();
  resetAgentBrowser();
  calls.list.length = 0;
  calls.fail.clear();
  calls.pressure = "normal";
});

describe("agent tabs", () => {
  it("keeps every idle tab awake until memory pressure, then sleeps all but those in use", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      trackAgentTab({ scopeId: "old", viewId: "v-old", taskId: "t", runId: "r" });
      trackAgentTab({ scopeId: "busy", viewId: "v-busy", taskId: "t", runId: "r" });
      noteAgentTabJob("busy", "r", true);
      vi.setSystemTime(Date.now() + 10_000);
      await sleepIdleAgentTabs();
      expect(commands("browser_webview_sleep")).toHaveLength(0);
      calls.pressure = "critical";
      vi.setSystemTime(Date.now() + 10_000);
      await sleepIdleAgentTabs();
      expect(commands("browser_webview_sleep").map((call) => call.args.request.id)).toEqual([
        "v-old",
      ]);
      expect(agentTab("old")).toMatchObject({
        viewId: "",
        url: "https://example.com/item",
        title: "Item",
      });
      expect(agentTab("busy")!.viewId).toBe("v-busy");
      calls.pressure = "normal";
      vi.setSystemTime(Date.now() + 10_000);
    } finally {
      vi.useRealTimers();
    }
  });

  it("wakes a sleeping tab under the same scope and run before a job", async () => {
    trackAgentTab({ scopeId: "s", viewId: "v", taskId: "t", runId: "run-1" });
    await sleepAgentTab("s");
    expect(await wakeAgentTab("s")).toBe(true);
    const created = commands("browser_webview_create")[0]!.args.request;
    expect(created).toMatchObject({
      scopeId: "s",
      url: "https://example.com/item",
      agentRunId: "run-1",
    });
    expect(commands("agent_workspace_bind_scope")[0]!.args).toEqual({ taskId: "t", scopeId: "s" });
    expect(commands("browser_webview_hide")[0]!.args.request).toEqual({
      id: created.id,
      keepLive: true,
    });
    expect(agentTab("s")!.viewId).toBe(created.id);
    // Awake already: nothing opens twice.
    expect(await wakeAgentTab("s")).toBe(true);
    expect(commands("browser_webview_create")).toHaveLength(1);
  });

  it("opens a finished run's proof tab for viewing, with no agent bound", async () => {
    trackAgentTab({
      scopeId: "proof",
      viewId: "v",
      taskId: "done-task",
      runId: "run-2",
      conversationId: "c",
    });
    await sleepTaskTabs("done-task");
    await sleepAgentTab("proof");
    expect(await wakeAgentTab("proof")).toBe(true);
    expect(commands("browser_webview_create")[0]!.args.request.agentRunId).toBeUndefined();
    expect(commands("agent_workspace_bind_scope")).toHaveLength(0);
  });

  it("closes a half-opened page when its task's lease is gone", async () => {
    trackAgentTab({ scopeId: "s", viewId: "v", taskId: "t", runId: "r" });
    await sleepAgentTab("s");
    calls.fail.add("agent_workspace_bind_scope");
    expect(await wakeAgentTab("s")).toBe(false);
    const created = commands("browser_webview_create")[0]!.args.request.id;
    expect(commands("browser_webview_close").map((call) => call.args.request.id)).toEqual([
      created,
    ]);
    expect(agentTab("s")!.viewId).toBe("");
    expect(await wakeAgentTab("unknown")).toBe(false);
  });

  it("keeps the agent browser's tab in step with its live page, asleep or awake", async () => {
    trackAgentTab({
      scopeId: "s",
      viewId: "v",
      taskId: "t",
      runId: "r",
      url: "https://example.com/",
      conversationId: "c",
    });
    const shown = () => useAgentBrowser.getState().tabs.s!;
    expect(shown().viewId).toBe("v");
    noteAgentPage("v", { url: "https://example.com/next", loading: true, title: undefined });
    noteAgentPage("v", { title: "Next", faviconUrl: "https://example.com/icon.png" });
    noteAgentPage("someone-else", { url: "https://elsewhere.test/" });
    expect(shown()).toMatchObject({
      url: "https://example.com/next",
      title: "Next",
      loading: true,
    });
    expect(agentTab("s")!.url).toBe("https://example.com/next");
    await sleepAgentTab("s");
    expect(shown()).toMatchObject({ viewId: "", loading: false });
    // The old page's late events no longer reach the tab.
    noteAgentPage("v", { url: "https://example.com/late" });
    expect(shown().url).toBe("https://example.com/item");
    await wakeAgentTab("s");
    expect(shown().viewId).toBe(agentTab("s")!.viewId);
    expect(shown().viewId).not.toBe("");
  });

  it("leaves the tabs a run used last awake when it ends, and sleeps the rest", async () => {
    for (let index = 0; index < 10; index++) {
      trackAgentTab({ scopeId: `s${index}`, viewId: `v${index}`, taskId: "t", runId: "r" });
      agentTab(`s${index}`)!.lastUsed = index;
    }
    noteAgentTabJob("s0", "r", true);
    trackAgentTab({ scopeId: "other", viewId: "vo", taskId: "u", runId: "r2" });
    await sleepTaskTabs("t");
    expect(
      commands("browser_webview_sleep")
        .map((call) => call.args.request.id)
        .sort(),
    ).toEqual(["v1", "v2"]);
    // The busy tab was used last, so it stays awake with the newest.
    expect(agentTab("s0")!.viewId).toBe("v0");
    expect(agentTab("s9")!.viewId).toBe("v9");
    expect(agentTab("other")!.viewId).toBe("vo");
  });
});
