import { render, screen, waitFor, fireEvent, within, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({
  user: "a",
  activity: vi.fn(),
  cancelInvocation: vi.fn(async () => {}),
  cancelRun: vi.fn(async () => {}),
  run: vi.fn(),
  decideApproval: vi.fn(async () => {}),
}));
vi.mock("../AgentsRuntime", () => ({
  runtimeAiApi: {
    activity: fixture.activity,
    cancelInvocation: fixture.cancelInvocation,
  },
  runtimeAgentsApi: {
    cancelRun: fixture.cancelRun,
    run: fixture.run,
    decideApproval: fixture.decideApproval,
  },
  useAgentsAuth: () => ({ user: { id: fixture.user } }),
}));
import { MistyDashboard } from "./MistyDashboard";
beforeEach(() => {
  fixture.user = "a";
  vi.clearAllMocks();
  fixture.run.mockResolvedValue({
    instruction: "Task instructions",
    result: {},
    approvals: [],
    summary: { run_id: "child" },
  });
});
afterEach(cleanup);
it("cancels the original invocation or delegated run using their durable IDs", async () => {
  fixture.activity.mockResolvedValue({
    entries: [
      {
        id: "invocation-a",
        kind: "invocation",
        title: "Parent",
        state: "running",
        run_id: "",
        conversation_id: "conversation-a",
        parent_run_id: "",
        events: [],
        updated_at: new Date().toISOString(),
      },
      {
        id: "child",
        kind: "run",
        title: "Child",
        state: "running",
        run_id: "child",
        conversation_id: "conversation-a",
        parent_run_id: "invocation-a",
        delegation_depth: 1,
        events: [],
        updated_at: new Date().toISOString(),
      },
    ],
  });
  render(<MistyDashboard />);
  const parent = (await screen.findByText("Parent")).closest("section")!;
  fireEvent.click(within(parent).getByRole("button"));
  fireEvent.click(within(parent).getByText("Cancel"));
  await waitFor(() => expect(fixture.cancelInvocation).toHaveBeenCalledWith("invocation-a"));
  const child = screen.getByText("Child").closest("section")!;
  fireEvent.click(within(child).getByRole("button"));
  await waitFor(() =>
    expect((within(child).getByText("Cancel") as HTMLButtonElement).disabled).toBe(false),
  );
  fireEvent.click(within(child).getByText("Cancel"));
  await waitFor(() => expect(fixture.cancelRun).toHaveBeenCalledWith("child"));
});
it("discards a previous account's pending activity response", async () => {
  let finish!: (value: unknown) => void;
  fixture.activity
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    )
    .mockResolvedValue({ entries: [] });
  const view = render(<MistyDashboard />);
  fixture.user = "b";
  view.rerender(<MistyDashboard />);
  await waitFor(() => expect(fixture.activity).toHaveBeenCalledTimes(2));
  finish({
    entries: [
      {
        id: "private",
        title: "Other account secret",
        state: "running",
        events: [],
        updated_at: new Date().toISOString(),
      },
    ],
  });
  await waitFor(() => expect(screen.getByText(/No activity yet/)).toBeTruthy());
  expect(screen.queryByText("Other account secret")).toBeNull();
});
it("opens task details without any conversation navigation", async () => {
  fixture.activity.mockResolvedValue({
    entries: [
      {
        id: "invocation-a",
        kind: "invocation",
        title: "Organize Downloads",
        state: "completed",
        run_id: "",
        conversation_id: "conversation-123",
        parent_run_id: "",
        result: "Sorted 12 files.",
        events: [],
        updated_at: new Date().toISOString(),
      },
    ],
  });
  render(<MistyDashboard />);
  fireEvent.click(await screen.findByRole("button", { name: /Organize Downloads/ }));
  expect(await screen.findByText("Sorted 12 files.")).toBeTruthy();
  expect(screen.queryByRole("button", { name: /Conversation|Open Misty|Connections/ })).toBeNull();
});

it("shows a recoverable error when activity cannot be loaded", async () => {
  fixture.activity
    .mockRejectedValueOnce(new Error("Could not load activity"))
    .mockResolvedValue({ entries: [] });
  render(<MistyDashboard />);
  expect(await screen.findByRole("alert")).toHaveProperty(
    "textContent",
    expect.stringContaining("Could not load activity"),
  );
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(await screen.findByText("No activity yet.")).toBeTruthy();
});

it("uses an explicit historical filter only when requested", async () => {
  fixture.activity.mockResolvedValue({ entries: [] });
  const view = render(<MistyDashboard spaceId="launch" agentId="communications" />);
  await waitFor(() => expect(fixture.activity).toHaveBeenCalledWith("launch", "communications"));
  view.rerender(<MistyDashboard spaceId="studio" agentId="communications" />);
  await waitFor(() =>
    expect(fixture.activity).toHaveBeenLastCalledWith("studio", "communications"),
  );
});

it("loads personal activity without a Space", async () => {
  fixture.activity.mockResolvedValue({ entries: [] });
  render(<MistyDashboard />);
  await waitFor(() => expect(fixture.activity).toHaveBeenCalledWith("", undefined));
  expect(await screen.findByText("No activity yet.")).toBeTruthy();
});

it("keeps approvals attached to their task run", async () => {
  fixture.activity.mockResolvedValue({
    entries: [
      {
        id: "run-entry",
        run_id: "approval-run",
        kind: "run",
        title: "Rename files",
        state: "awaiting_approval",
        events: [],
        updated_at: new Date().toISOString(),
      },
    ],
  });
  fixture.run.mockResolvedValue({
    instruction: "Rename screenshots",
    result: {},
    approvals: [{ id: "approval-1", state: "pending", summary: "Rename 6 files?" }],
    summary: { run_id: "approval-run" },
  });
  render(<MistyDashboard />);
  fireEvent.click(await screen.findByRole("button", { name: /Rename files/ }));
  fireEvent.click(await screen.findByRole("button", { name: "Approve" }));
  await waitFor(() =>
    expect(fixture.decideApproval).toHaveBeenCalledWith("approval-run", "approval-1", "approve"),
  );
});
