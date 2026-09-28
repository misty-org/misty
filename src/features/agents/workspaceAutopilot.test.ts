import { initialCompanionPresentation, useCompanionState } from "./companion/companionState";
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  state: { accountId: "account", spaceId: "" },
  watch: [] as Array<() => void>,
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@/shared/platform/tauri", () => ({ hasTauriInternals: () => true }));
vi.mock("@/features/misty/screenContext", () => ({
  screenStatus: async () => ({ supported: true, allowed: true }),
}));
vi.mock("@/features/auth/core", () => ({
  useUserStore: {
    getState: () => ({ me: { id: mocks.state.accountId } }),
    subscribe: (cb: () => void) => {
      mocks.watch.push(cb);
      return () => {};
    },
  },
}));
vi.mock("@/features/workspace/useWorkspaceStore", () => ({
  useWorkspaceStore: {
    getState: () => ({
      activeScopeKey: "global",
      activeVirtualWindowId: "window",
      layout: { focusedPaneId: "pane", activeLayoutTabId: "tab" },
    }),
    subscribe: (cb: () => void) => {
      mocks.watch.push(cb);
      return () => {};
    },
  },
}));
vi.mock("@/features/workspace/virtualWindows", () => ({
  currentVirtualWindows: () => [{ id: "window", title: "Work", layout: {} }],
}));
vi.mock("@/features/workspace/layoutTabs", () => ({
  layoutTabs: () => [{ id: "tab", title: "Notes", root: {} }],
}));
vi.mock("@/features/workspace/dockTree", () => ({
  dockLeaves: () => [
    {
      id: "pane",
      activeTabId: "current",
      tabs: [{ id: "current", surfaceId: "official-app", title: "Brief", route: "/notes/brief" }],
      history: { entries: [{ title: "Private old view" }] },
    },
  ],
}));
import {
  betaExecutionMode,
  startWorkspaceAutopilot,
  watchWorkspaceAutopilot,
  workspaceAutopilotContext,
} from "./workspaceAutopilot";
beforeEach(() => {
  vi.clearAllMocks();
  useCompanionState.setState({ presentation: initialCompanionPresentation });
  mocks.state.accountId = "account";
  mocks.state.spaceId = "";
  mocks.watch = [];
  mocks.invoke.mockResolvedValue(undefined);
  Object.defineProperty(navigator, "platform", { configurable: true, value: "MacIntel" });
});
it("describes the browser workspace and open panes without closed history", () => {
  const context = workspaceAutopilotContext("account", "");
  expect(context.spaceName).toBe("");
  expect(context.windows[0].tabs[0].panes[0].title).toBe("Brief");
  expect(JSON.stringify(context)).not.toContain("Private old view");
  expect(() => workspaceAutopilotContext("other", "")).toThrow("account changed");
});
it("binds explicit control to a task and stops on an account change", async () => {
  await startWorkspaceAutopilot("task", "account", "");
  expect(mocks.invoke).toHaveBeenCalledWith(
    "agent_workspace_context",
    expect.objectContaining({ taskId: "task", start: true }),
  );
  const stop = vi.fn();
  const dispose = watchWorkspaceAutopilot("task", "account", "", stop);
  mocks.state.accountId = "other";
  mocks.watch[0]();
  expect(stop).toHaveBeenCalledOnce();
  dispose();
});
it("closes the other beta modes without changing non-native behavior", () => {
  expect(betaExecutionMode("team")).toBe("agent");
  Object.defineProperty(navigator, "platform", { configurable: true, value: "Linux" });
  expect(betaExecutionMode("user")).toBe("user");
});

it("preserves desktop ownership and Ask across live context updates", async () => {
  useCompanionState.setState({ presentation: { ...initialCompanionPresentation, ask: true } });
  await startWorkspaceAutopilot("desktop", "account", "", true);
  const dispose = watchWorkspaceAutopilot("desktop", "account", "", vi.fn(), true);
  await vi.waitFor(() => expect(mocks.invoke).toHaveBeenCalledTimes(2));
  for (const [, args] of mocks.invoke.mock.calls) {
    expect(args).toMatchObject({
      taskId: "desktop",
      context: { desktopControl: true, askBeforeControl: true },
    });
  }
  dispose();
});
