import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it } from "vitest";
import { AgentMessageChecklist } from "./AgentChecklist";
import { useCollaborationStore } from "./store";
import type { AgentChecklist, ConversationCollaboration } from "./plan_types";

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
  questionSets: [],
  runningInvocationId: "",
});

beforeEach(() => useCollaborationStore.setState({ byConversation: {} }));
afterEach(cleanup);

it("shows nothing, not a placeholder or loading text, until it knows whether a checklist exists", () => {
  const { container } = render(
    <AgentMessageChecklist conversationId="c1" invocationId="inv_1" running />,
  );
  expect(screen.queryByRole("status", { name: "Checklist" })).toBeNull();
  expect(screen.queryByText(/Loading/)).toBeNull();
  expect(container.childElementCount).toBe(0);
});

it("lists every step with its status in words, on the same card as an engine's tasks", () => {
  useCollaborationStore.setState({ byConversation: { c1: state([checklist]) } });
  render(<AgentMessageChecklist conversationId="c1" invocationId="inv_1" running />);
  const list = screen.getByRole("list", { name: "Checklist" });
  expect(within(list).getByText("In progress")).toBeTruthy();
  expect(within(list).getByText("Edit tests")).toBeTruthy();
  expect(within(list).getByText("Done")).toBeTruthy();
  expect(within(list).getByText("Read the code")).toBeTruthy();
  expect(within(list).getByText("Not started")).toBeTruthy();
});

it("leaves a finished checklist out once the run ends", () => {
  const finished = {
    ...checklist,
    items: checklist.items.map((item) => ({ ...item, status: "done" as const })),
  };
  useCollaborationStore.setState({ byConversation: { c1: state([finished]) } });
  const { container } = render(
    <AgentMessageChecklist conversationId="c1" invocationId="inv_1" running={false} />,
  );
  expect(container.childElementCount).toBe(0);
});

it("says Stopped for the active step of a run that ended, and Waiting for you on a card", () => {
  useCollaborationStore.setState({ byConversation: { c1: state([checklist]) } });
  const { rerender } = render(
    <AgentMessageChecklist conversationId="c1" invocationId="inv_1" running={false} />,
  );
  expect(screen.getByRole("list", { name: "Checklist" })).toBeTruthy();
  expect(screen.getByText("Stopped")).toBeTruthy();
  rerender(
    <AgentMessageChecklist
      conversationId="c1"
      invocationId="inv_1"
      running
      hold="waiting_for_you"
    />,
  );
  expect(screen.getByText("Waiting for you")).toBeTruthy();
});

it("applies checklist events and ignores stale replays", () => {
  const store = useCollaborationStore.getState();
  store.applyEvent("c1", { type: "checklist.updated", checklist: { ...checklist, version: 2 } });
  store.applyEvent("c1", { type: "checklist.updated", checklist: { ...checklist, items: [] } });
  expect(useCollaborationStore.getState().byConversation.c1?.checklists[0]?.items).toHaveLength(3);
});
