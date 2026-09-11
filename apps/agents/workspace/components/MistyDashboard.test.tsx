import {
  render,
  screen,
  waitFor,
  fireEvent,
  within,
  cleanup,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({
  user: "a",
  activity: vi.fn(),
  cancelInvocation: vi.fn(async () => {}),
  cancelRun: vi.fn(async () => {}),
  openMisty: vi.fn(async () => {}),
}));
vi.mock("../agentsRuntime", () => ({
  runtimeAiApi: {
    activity: fixture.activity,
    cancelInvocation: fixture.cancelInvocation,
  },
  runtimeAgentsApi: { cancelRun: fixture.cancelRun },
  useAgentsAuth: () => ({ user: { id: fixture.user } }),
  useAgentsWorkspace: (
    select: (state: { activeScopeKey: string }) => unknown,
  ) => select({ activeScopeKey: "space:s" }),
  openAgentsMisty: fixture.openMisty,
}));
import { MistyDashboard } from "./MistyDashboard";
beforeEach(() => {
  fixture.user = "a";
  vi.clearAllMocks();
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
  render(<MistyDashboard onManageConnections={() => {}} />);
  const parent = (await screen.findByText("Parent")).closest("section")!;
  fireEvent.click(within(parent).getByText("Cancel"));
  await waitFor(() =>
    expect(fixture.cancelInvocation).toHaveBeenCalledWith("invocation-a"),
  );
  const child = screen.getByText("Child").closest("section")!;
  await waitFor(() =>
    expect(
      (within(child).getByText("Cancel") as HTMLButtonElement).disabled,
    ).toBe(false),
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
  const view = render(<MistyDashboard onManageConnections={() => {}} />);
  fixture.user = "b";
  view.rerender(<MistyDashboard onManageConnections={() => {}} />);
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
it("opens Misty for the active space or specific conversation", async () => {
  fixture.activity.mockResolvedValue({
    entries: [
      {
        id: "invocation-a",
        kind: "invocation",
        title: "Agent Task",
        state: "completed",
        run_id: "",
        conversation_id: "conversation-123",
        parent_run_id: "",
        events: [],
        updated_at: new Date().toISOString(),
      },
    ],
  });
  render(<MistyDashboard onManageConnections={() => {}} />);
  const openMistyButton = await screen.findByText("Open Misty");
  fireEvent.click(openMistyButton);
  await waitFor(() =>
    expect(fixture.openMisty).toHaveBeenCalledWith({ spaceId: "s" }),
  );

  const conversationButton = await screen.findByText("Conversation");
  fireEvent.click(conversationButton);
  await waitFor(() =>
    expect(fixture.openMisty).toHaveBeenCalledWith({
      spaceId: "s",
      conversationId: "conversation-123",
    }),
  );
});
it("displays errors if opening Misty fails", async () => {
  fixture.activity.mockResolvedValue({ entries: [] });
  fixture.openMisty.mockRejectedValueOnce(
    new Error("AppRpcError: This App does not have ai.use permission."),
  );
  render(<MistyDashboard onManageConnections={() => {}} />);
  const openMistyButton = await screen.findByText("Open Misty");
  fireEvent.click(openMistyButton);
  expect(
    await screen.findByText(/This App does not have ai\.use permission\./),
  ).toBeTruthy();
});

