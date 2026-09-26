import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  pause: vi.fn(),
  watch: vi.fn(() => vi.fn()),
  focus: vi.fn(),
  open: vi.fn(),
  resume: vi.fn().mockResolvedValue(undefined),
  finish: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ onFocusChanged: mocks.focus, isFocused: async () => false }),
}));
vi.mock("./workspaceAutopilot", () => ({ watchWorkspaceAutopilot: mocks.watch }));
vi.mock("./localExecution", () => ({
  pauseLocalExecution: mocks.pause,
  finishLocalExecution: mocks.finish,
  steerLocalExecution: mocks.resume,
}));
vi.mock("@/features/misty/useMistyStore", () => ({
  useMistyStore: { setState: vi.fn(), getState: () => ({ openPanel: mocks.open }) },
}));
import { WorkspaceAutopilotBar } from "./WorkspaceAutopilotBar";
const execution = {
  taskId: "task",
  agentId: "agent",
  accountId: "account",
  spaceId: "space",
  mode: "agent" as const,
  state: "running" as const,
  views: [],
  context: [],
  deviceContexts: [],
  autopilot: true,
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.pause.mockResolvedValue(undefined);
  mocks.focus.mockResolvedValue(vi.fn());
});
afterEach(cleanup);
it("does not watch or revoke authority while startup is still preparing", () => {
  const { rerender } = render(<WorkspaceAutopilotBar execution={execution} name="Misty" />);
  expect(mocks.watch).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Pause" })).toBeDefined();
  rerender(<WorkspaceAutopilotBar execution={{ ...execution, ready: true }} name="Misty" />);
  expect(mocks.watch).toHaveBeenCalledWith("task", "account", "space", expect.any(Function));
});
it("Pause revokes the current task and a late error cannot replace another task's status", async () => {
  render(<WorkspaceAutopilotBar execution={{ ...execution, ready: true }} name="Misty" />);
  fireEvent(
    window,
    new CustomEvent("misty:autopilot-error", { detail: { taskId: "old", message: "old error" } }),
  );
  expect(screen.queryByText("old error")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Pause" }));
  await waitFor(() => expect(mocks.pause).toHaveBeenCalledWith("task"));
});

it("exposes playback state and resumes a paused task", async () => {
  const { rerender } = render(<WorkspaceAutopilotBar execution={execution} name="Misty" />);
  expect((screen.getByRole("button", { name: "Resume" }) as HTMLButtonElement).disabled).toBe(true);
  rerender(<WorkspaceAutopilotBar execution={{ ...execution, state: "paused" }} name="Misty" />);
  expect((screen.getByRole("button", { name: "Pause" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Resume" }));
  await waitFor(() => expect(mocks.resume).toHaveBeenCalledOnce());
});
it("stops the task from the control center", async () => {
  render(<WorkspaceAutopilotBar execution={execution} name="Misty" />);
  fireEvent.click(screen.getByRole("button", { name: "Stop task" }));
  await waitFor(() => expect(mocks.finish).toHaveBeenCalledOnce());
});
