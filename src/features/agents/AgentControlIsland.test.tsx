import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  pause: vi.fn(),
  watch: vi.fn(() => vi.fn()),
  steer: vi.fn().mockResolvedValue(undefined),
  finish: vi.fn().mockResolvedValue(undefined),
  route: vi.fn().mockResolvedValue("Follow-up applied to this task."),
  queue: vi.fn().mockResolvedValue(undefined),
  release: vi.fn().mockResolvedValue(true),
  endHosted: vi.fn().mockResolvedValue(undefined),
  invoke: vi.fn().mockResolvedValue(undefined),
  listeners: new Map<string, (event: { payload: unknown }) => void>(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    listen: async (name: string, handler: (event: { payload: unknown }) => void) => {
      mocks.listeners.set(name, handler);
      return () => mocks.listeners.delete(name);
    },
  }),
}));
vi.mock("./workspaceAutopilot", () => ({
  watchWorkspaceAutopilot: mocks.watch,
  autopilotStopShortcut: () => "Cmd+Shift+Escape",
}));
vi.mock("./localExecution", async () => {
  const { create } = await import("zustand");
  return {
    useLocalExecution: create(() => ({ execution: null as unknown })),
    pauseLocalExecution: mocks.pause,
    finishLocalExecution: mocks.finish,
    steerLocalExecution: mocks.steer,
    routeLocalFollowup: mocks.route,
    queueLocalFollowup: mocks.queue,
  };
});
vi.mock("@/features/misty/useMistyStore", async () => {
  const { create } = await import("zustand");
  return {
    useMistyStore: create(() => ({
      conversations: [] as unknown[],
      activeConversationId: "conversation",
      invocationId: "invocation",
      error: "",
    })),
  };
});
vi.mock("./personalAgentsStore", async () => {
  const { create } = await import("zustand");
  return { usePersonalAgentsStore: create(() => ({ agents: [{ id: "agent", name: "Misty" }] })) };
});
vi.mock("./hostedSessionsState", async () => {
  const { create } = await import("zustand");
  return { useHostedSessions: create(() => ({ sessions: [] as unknown[] })) };
});
vi.mock("./hostedSessions", () => ({ endHostedSession: mocks.endHosted }));
vi.mock("@/features/agent-interventions/store", async () => {
  const { create } = await import("zustand");
  return { useAgentInterventions: create(() => ({ items: [] as unknown[] })) };
});
vi.mock("@/features/agent-interventions/api", () => ({
  interventionLabels: { sign_in: "Sign in so Misty can continue" },
}));
vi.mock("@/features/agent-interventions/WaitingForYouCard", () => ({
  releasePendingWait: mocks.release,
}));
import { useAgentInterventions } from "@/features/agent-interventions/store";
import { useMistyStore } from "@/features/misty/useMistyStore";
import { AgentControlIsland } from "./AgentControlIsland";
import { useHostedSessions } from "./hostedSessionsState";
import { useLocalExecution, type Execution } from "./localExecution";

const execution: Execution = {
  taskId: "task",
  agentId: "agent",
  accountId: "account",
  spaceId: "space",
  mode: "agent",
  state: "running",
  views: [],
  context: [],
  deviceContexts: [],
  autopilot: true,
};
const show = (next: Partial<Execution> | null) =>
  act(() => useLocalExecution.setState({ execution: next && { ...execution, ...next } }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.pause.mockResolvedValue(undefined);
  mocks.listeners.clear();
  useMistyStore.setState({ conversations: [], error: "" });
  useHostedSessions.setState({ sessions: [] });
  useAgentInterventions.setState({ items: [] });
});
afterEach(() => {
  cleanup();
  useLocalExecution.setState({ execution: null });
});

it("does not watch or revoke authority while startup is still preparing", () => {
  show({});
  render(<AgentControlIsland />);
  expect(mocks.watch).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Take over" })).toBeDefined();
  show({ ready: true });
  expect(mocks.watch).toHaveBeenCalledWith(
    "task",
    "account",
    "space",
    expect.any(Function),
    undefined,
  );
});

it("Take over pauses the current task and a late error cannot replace another task's status", async () => {
  show({ ready: true });
  render(<AgentControlIsland />);
  fireEvent(
    window,
    new CustomEvent("misty:autopilot-error", { detail: { taskId: "old", message: "old error" } }),
  );
  expect(screen.queryByText("old error")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Take over" }));
  await waitFor(() => expect(mocks.pause).toHaveBeenCalledWith("task"));
});

it("resumes a paused task and finishes a waiting one with Done", async () => {
  show({ state: "paused" });
  render(<AgentControlIsland />);
  expect(screen.getByRole("status").textContent).toBe("Paused. You have control.");
  fireEvent.click(screen.getByRole("button", { name: "Resume" }));
  await waitFor(() => expect(mocks.steer).toHaveBeenCalledOnce());
  show({ state: "waiting" });
  act(() =>
    useAgentInterventions.setState({
      items: [{ runId: "invocation", action: "sign_in", targetLabel: "GitHub" }] as never,
    }),
  );
  expect(screen.getByRole("status").textContent).toBe("Sign in so Misty can continue · GitHub");
  expect(screen.queryByRole("textbox")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Done" }));
  await waitFor(() => expect(mocks.release).toHaveBeenCalledWith("account", "invocation"));
});

it("Stop ends a task without tabs, and keeps a task's own tabs open for review", async () => {
  show({});
  render(<AgentControlIsland />);
  fireEvent.click(screen.getByRole("button", { name: "Stop" }));
  await waitFor(() => expect(mocks.finish).toHaveBeenCalledOnce());
  show({ autopilot: false, views: ["tab"] });
  fireEvent.click(screen.getByRole("button", { name: "Stop" }));
  await waitFor(() => expect(mocks.pause).toHaveBeenCalledWith("task"));
  show({ autopilot: false, views: ["tab"], state: "paused" });
  expect(screen.getByRole("status").textContent).toBe(
    "Stopped. Completed changes have not been undone.",
  );
  fireEvent.click(screen.getByRole("button", { name: "Done" }));
  await waitFor(() => expect(mocks.finish).toHaveBeenCalledTimes(2));
});

it("shows what the run is doing and how many sub-agents work for it", () => {
  show({ ready: true });
  act(() =>
    useMistyStore.setState({
      conversations: [
        {
          id: "conversation",
          messages: [
            {
              id: "reply",
              role: "assistant",
              state: "streaming",
              progress: [{ type: "tool", id: "1", name: "browser_snapshot", state: "running" }],
              subagents: [
                { invocationId: "a", goal: "one", state: "running" },
                { invocationId: "b", goal: "two", state: "completed" },
              ],
            },
          ],
        },
      ] as never,
    }),
  );
  render(<AgentControlIsland />);
  expect(screen.getByRole("status").textContent).not.toBe("Misty is controlling Misty");
  expect(screen.getByText("1 helper")).toBeDefined();
});

it("sends a message to steer the task, or queues it as a new task", async () => {
  show({ autopilot: false, normalTabs: true });
  render(<AgentControlIsland />);
  const field = screen.getByRole("textbox", { name: "Message Misty" });
  fireEvent.change(field, { target: { value: "Use the second sheet" } });
  fireEvent.keyDown(field, { key: "Enter" });
  await waitFor(() => expect(mocks.route).toHaveBeenCalledWith("Use the second sheet"));
  expect(await screen.findByText("Follow-up applied to this task.")).toBeDefined();
  fireEvent.change(field, { target: { value: "Then email Ana" } });
  fireEvent.click(screen.getByRole("button", { name: "New task" }));
  await waitFor(() => expect(mocks.queue).toHaveBeenCalledWith("Then email Ana"));
  expect(await screen.findByText("Queued after this task.")).toBeDefined();
});

it("says which agents work here for another device, with Stop", async () => {
  useHostedSessions.setState({ sessions: [{ taskId: "hosted", agentId: "agent" }] as never });
  render(<AgentControlIsland />);
  expect(screen.getByRole("status").textContent).toBe(
    "Misty is working here for one of your other devices",
  );
  fireEvent.click(screen.getByRole("button", { name: "Stop" }));
  await waitFor(() => expect(mocks.endHosted).toHaveBeenCalledWith("hosted"));
});

it("mirrors itself on the desktop island and acts on its presses", async () => {
  show({ ready: true, desktopControl: true });
  render(<AgentControlIsland />);
  await waitFor(() =>
    expect(mocks.invoke).toHaveBeenCalledWith("agent_control_island", {
      taskId: "task",
      island: { status: "Misty is working with its own cursor", meta: "", waiting: "" },
    }),
  );
  await waitFor(() => expect(mocks.listeners.has("misty://agent-island")).toBe(true));
  const press = mocks.listeners.get("misty://agent-island")!;
  act(() => press({ payload: { taskId: "other", action: "takeover" } }));
  expect(mocks.pause).not.toHaveBeenCalled();
  act(() => press({ payload: { taskId: "task", action: "queue", text: "Next one" } }));
  await waitFor(() => expect(mocks.queue).toHaveBeenCalledWith("Next one"));
});

it("shows the exact desktop blocker without relying on a tooltip", () => {
  show({ ready: true, desktopControl: true });
  render(<AgentControlIsland />);
  fireEvent(
    window,
    new CustomEvent("misty:autopilot-error", {
      detail: { taskId: "task", message: "Allow dev1 in Accessibility" },
    }),
  );
  expect(screen.getByRole("alert").textContent).toBe("Allow dev1 in Accessibility");
});
