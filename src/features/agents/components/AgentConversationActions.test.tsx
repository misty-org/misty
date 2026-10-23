import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MemoryRouter, useLocation } from "react-router-dom";
import { useMistyStore } from "@/features/misty/useMistyStore";
import { globalMistyApi } from "@/features/misty/globalMistyApi";
import { useMistyDraftAttachments } from "@/features/misty/draftAttachments";
import { AgentConversationActions } from "./AgentConversationActions";

const conversation = {
  id: "chat-1",
  agentId: "agent-1",
  title: "Launch plan",
  remote: true,
  messages: [],
  createdAt: "2026-10-03",
  updatedAt: "2026-10-03",
};
function Harness() {
  const chats = useMistyStore((s) => s.conversations);
  const location = useLocation();
  return (
    <>
      <output data-testid="route">{location.search}</output>
      {chats.map((chat) => (
        <AgentConversationActions key={chat.id} conversation={chat} />
      ))}
    </>
  );
}
function mount() {
  render(
    <MemoryRouter initialEntries={["/agents?agent=agent-1&conversation=chat-1"]}>
      <Harness />
    </MemoryRouter>,
  );
}
async function choose(action: string) {
  fireEvent.keyDown(screen.getByRole("button", { name: "More actions for Launch plan" }), {
    key: "Enter",
  });
  fireEvent.click(await screen.findByRole("menuitem", { name: action }));
}
beforeEach(() => {
  useMistyDraftAttachments.setState({ accountId: "account-1", drafts: { "chat-1": [] } });
  useMistyStore.setState({
    accountId: "account-1",
    selectedAgentId: "agent-1",
    conversations: [conversation],
    activeConversationId: "chat-1",
    working: false,
    query: "draft",
    error: null,
    invocationConversationId: "chat-1",
    invocationId: "finished-run",
    artifactConversationId: "chat-1",
    artifactPaneId: "pane-1",
  });
});
afterEach(cleanup);

it("renames the chat here even when the server cannot be reached", async () => {
  const rename = vi
    .spyOn(globalMistyApi, "renameConversation")
    .mockRejectedValue(new Error("Connection lost. Try again."));
  mount();
  await choose("Rename");
  const input = await screen.findByRole("textbox", { name: "Conversation name" });
  fireEvent.change(input, { target: { value: "   " } });
  expect(screen.getByRole("button", { name: "Save" }).hasAttribute("disabled")).toBe(true);
  fireEvent.change(input, { target: { value: "  New title  " } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(rename).toHaveBeenLastCalledWith("chat-1", "New title");
  expect(useMistyStore.getState().conversations[0].title).toBe("New title");
});

it("confirms deletion, then clears the active route and draft without waiting for the server", async () => {
  let resolve!: () => void;
  const remove = vi.spyOn(globalMistyApi, "deleteConversation").mockImplementation(
    () =>
      new Promise<void>((done) => {
        resolve = done;
      }),
  );
  mount();
  await choose("Delete");
  expect(remove).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(remove).not.toHaveBeenCalled();
  await waitFor(() =>
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "More actions for Launch plan" }),
    ),
  );
  await choose("Delete");
  fireEvent.click(screen.getByRole("button", { name: "Delete" }));
  await waitFor(() => expect(screen.getByTestId("route").textContent).toBe("?agent=agent-1"));
  expect(remove).toHaveBeenCalledTimes(1);
  expect(useMistyStore.getState()).toMatchObject({
    conversations: [],
    activeConversationId: "",
    selectedAgentId: "agent-1",
    query: "",
    artifactConversationId: undefined,
    artifactPaneId: undefined,
    invocationConversationId: undefined,
    invocationId: undefined,
  });
  await act(async () => resolve());
});

it("deletes the chat here even when the server cannot be reached", async () => {
  vi.spyOn(globalMistyApi, "deleteConversation").mockRejectedValue(
    new Error("Could not delete. Try again."),
  );
  mount();
  await choose("Delete");
  fireEvent.click(screen.getByRole("button", { name: "Delete" }));
  await waitFor(() => expect(useMistyStore.getState().conversations).toEqual([]));
  expect(screen.queryByRole("alert")).toBeNull();
});

it("preserves another conversation selected while deletion is pending", async () => {
  let resolve!: () => void;
  vi.spyOn(globalMistyApi, "deleteConversation").mockImplementation(
    () =>
      new Promise<void>((done) => {
        resolve = done;
      }),
  );
  const removal = useMistyStore.getState().deleteConversation("chat-1");
  useMistyStore.setState({
    conversations: [conversation, { ...conversation, id: "chat-2", agentId: "agent-2" }],
    activeConversationId: "chat-2",
    selectedAgentId: "agent-2",
    query: "another draft",
  });
  await removal;
  resolve?.();
  expect(useMistyStore.getState()).toMatchObject({
    activeConversationId: "chat-2",
    selectedAgentId: "agent-2",
    query: "another draft",
  });
  expect(useMistyStore.getState().conversations.map((chat) => chat.id)).toEqual(["chat-2"]);
});

it("ignores a rename response after switching accounts", async () => {
  let resolve!: (result: { id: string; title: string }) => void;
  vi.spyOn(globalMistyApi, "renameConversation").mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const rename = useMistyStore.getState().renameConversation("chat-1", "Old account title");
  useMistyStore.setState({ accountId: "account-2", conversations: [conversation] });
  resolve({ id: "chat-1", title: "Old account title" });
  await rename;
  expect(useMistyStore.getState().conversations[0].title).toBe("Launch plan");
});

it("does not delete a conversation with a running response", async () => {
  const remove = vi.spyOn(globalMistyApi, "deleteConversation");
  useMistyStore.setState({ working: true, invocationConversationId: "chat-1" });
  await expect(useMistyStore.getState().deleteConversation("chat-1")).rejects.toThrow(
    "Stop the response",
  );
  expect(remove).not.toHaveBeenCalled();
});
