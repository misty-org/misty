import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it } from "vitest";
import { AgentMessageChecklist } from "./AgentChecklist";
import { useCollaborationStore } from "./store";
import type { AgentChecklist, ConversationCollaboration } from "./types";

const checklist: AgentChecklist = {
  invocationId: "inv_1",
  conversationId: "c1",
  items: [
    { id: "s1", title: "Read the code", status: "done" },
    { id: "s2", title: "Edit tests", status: "in_progress" },
    { id: "s3", title: "Run tests", status: "pending" },
  ],
  version: 1,
  updatedAt: "2026-10-14T10:00:00Z",
};

const state = (checklists: AgentChecklist[]): ConversationCollaboration => ({
  mode: "act",
  permissionMode: "",
  agentPermissionMode: "ask",
  checklists,
  plan: null,
  planHistory: [],
  goal: null,
  questionSets: [],
  runningInvocationId: "",
});

beforeEach(() => useCollaborationStore.setState({ byConversation: {} }));
afterEach(cleanup);

it("shows a skeleton, not loading text, while the conversation first loads", () => {
  render(<AgentMessageChecklist conversationId="c1" invocationId="inv_1" running />);
  expect(screen.getByRole("status", { name: "Checklist" })).toBeTruthy();
  expect(screen.queryByText(/Loading/)).toBeNull();
});

it("summarizes, then lists steps with their status in words", async () => {
  useCollaborationStore.setState({ byConversation: { c1: state([checklist]) } });
  render(<AgentMessageChecklist conversationId="c1" invocationId="inv_1" running />);
  const summary = screen.getByRole("button", { name: /1 of 3 · Edit tests/ });
  await act(async () => fireEvent.click(summary));
  expect(screen.getByRole("list")).toBeTruthy();
  expect(screen.getByRole("listitem", { name: "Edit tests: In progress" })).toBeTruthy();
  expect(screen.getByRole("listitem", { name: "Read the code: Done" })).toBeTruthy();
});

it("says Stopped for the active step of a run that ended, and Waiting for you on a card", () => {
  useCollaborationStore.setState({ byConversation: { c1: state([checklist]) } });
  const { rerender } = render(
    <AgentMessageChecklist conversationId="c1" invocationId="inv_1" running={false} />,
  );
  expect(screen.getByRole("button", { name: /Stopped: Edit tests/ })).toBeTruthy();
  rerender(
    <AgentMessageChecklist
      conversationId="c1"
      invocationId="inv_1"
      running
      hold="waiting_for_you"
    />,
  );
  expect(screen.getByRole("button", { name: /Waiting for you: Edit tests/ })).toBeTruthy();
});

it("applies checklist events and ignores stale replays", () => {
  const store = useCollaborationStore.getState();
  store.applyEvent("c1", { type: "checklist.updated", checklist: { ...checklist, version: 2 } });
  store.applyEvent("c1", { type: "checklist.updated", checklist: { ...checklist, items: [] } });
  expect(useCollaborationStore.getState().byConversation.c1?.checklists[0]?.items).toHaveLength(3);
});
