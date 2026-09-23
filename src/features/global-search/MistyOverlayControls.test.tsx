import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  approve: vi.fn().mockResolvedValue(undefined),
  confirm: vi.fn().mockResolvedValue(undefined),
  deny: vi.fn(),
  close: vi.fn(),
  proposal: {
    id: "proposal-1",
    title: "Create the note",
    summary: "Save a note in this Space.",
    state: "awaiting_approval",
    approvalId: "approval-1",
    requiresConfirmation: true,
  },
}));
vi.mock("@/features/agents/localExecution", () => ({
  useLocalExecution: (select: (state: unknown) => unknown) => select({ execution: null }),
}));
vi.mock("@/features/agents/personalAgentsStore", () => ({
  usePersonalAgentsStore: (select: (state: unknown) => unknown) => select({ agents: [] }),
}));
vi.mock("@/features/agents/WorkspaceAutopilotBar", () => ({
  agentOverlayBarClass: "fixed bottom-4",
  WorkspaceAutopilotBar: () => null,
}));
vi.mock("@/features/misty/useMistyStore", () => {
  const state = () => ({
    panel: "closed",
    activeConversationId: "conversation-1",
    conversations: [{ id: "conversation-1", messages: [{ action: mocks.proposal }] }],
    approveAgentTask: mocks.approve,
    confirmAction: mocks.confirm,
    rejectAction: mocks.deny,
    closePanel: mocks.close,
  });
  return {
    useMistyStore: Object.assign((select: (value: unknown) => unknown) => select(state()), {
      getState: state,
    }),
  };
});
import { MistyApprovalReview } from "./MistyOverlayControls";
beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);
it("reviews a pending approval independently of playback and approves only the displayed action", async () => {
  render(<MistyApprovalReview />);
  expect(screen.getByText("Create the note")).toBeDefined();
  expect(mocks.approve).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Approve" }));
  await waitFor(() => expect(mocks.approve).toHaveBeenCalledWith("proposal-1"));
  expect(mocks.confirm).not.toHaveBeenCalled();
});
it("denies the displayed action without approving it", async () => {
  render(<MistyApprovalReview />);
  fireEvent.click(screen.getByRole("button", { name: "Deny" }));
  await waitFor(() => expect(mocks.deny).toHaveBeenCalledWith("proposal-1"));
  expect(mocks.approve).not.toHaveBeenCalled();
});
