import {
  composer,
  conversation,
  fixture,
  openAgentSettings,
  openChat,
  renderAgentsPage,
  typeDraft,
} from "./AgentsPage.testFixtures";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { expect, it } from "vitest";
import { useMistyStore } from "@/features/agents/conversations/state/useMistyStore";

it("edits a global agent without requiring a work Space", async () => {
  renderAgentsPage();
  openAgentSettings();
  await waitFor(() => expect(screen.getByLabelText("Name")).toBeTruthy());
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Launch coordinator" } });
  expect(screen.queryByLabelText("Agent work Space")).toBeNull();
  expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("Launch coordinator");
});

it("continues the open chat and starts new work", async () => {
  useMistyStore.setState({
    conversations: [
      { ...conversation("draft", "Launch draft"), spaceId: "home", personalSpace: true },
      { ...conversation("private", "Other draft"), spaceId: "home", personalSpace: true },
      { ...conversation("shared", "Team draft"), spaceId: "team" },
    ],
  });
  // The window's sidebar lists the Space's chats now; a chat is opened by its address.
  useMistyStore.setState({ activeConversationId: "private" });
  renderAgentsPage();
  typeDraft("Continue this conversation");
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
  });
  await waitFor(() => expect(fixture.submit).toHaveBeenCalledOnce());
  expect(fixture.submit).toHaveBeenLastCalledWith(
    "Continue this conversation",
    [],
    undefined,
    [],
    expect.objectContaining({ conversationId: "private" }),
    { executionMode: "user", interactionMode: "auto" },
  );
  await waitFor(() => expect(composer().value).toBe(""));
  fireEvent.click(screen.getByRole("button", { name: "New task" }));
  typeDraft("Start personal work");
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
  });
  await waitFor(() => expect(fixture.submit).toHaveBeenCalledTimes(2));
  expect(fixture.submit).toHaveBeenLastCalledWith(
    "Start personal work",
    [],
    undefined,
    [],
    { conversationId: "", context: [] },
    { executionMode: "user", interactionMode: "auto" },
  );
  expect(useMistyStore.getState().selectedSpaceId).toBe("");
});

it("preserves an unsent message until a new task is explicitly confirmed", () => {
  renderAgentsPage();
  typeDraft("Keep this message");
  fireEvent.click(screen.getByRole("button", { name: "New task" }));
  expect(screen.getByRole("alertdialog")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
  expect(composer().value).toBe("Keep this message");
  fireEvent.click(screen.getByRole("button", { name: "New task" }));
  fireEvent.click(screen.getByRole("button", { name: "Discard and switch" }));
  expect(composer().value).toBe("");
});

it("previews and saves a cloud avatar while preserving unrelated avatar metadata", async () => {
  fixture.agent.avatar = { emoji: "✏️", custom: "preserved" };
  renderAgentsPage();
  openAgentSettings();
  await waitFor(() => expect(screen.getByLabelText("Name")).toBeTruthy());
  fireEvent.click(screen.getByRole("button", { name: "Edit agent avatar" }));
  fireEvent.click(screen.getByRole("button", { name: "Lavender, Wink" }));
  expect(screen.getByRole("button", { name: "Lavender, Wink" }).getAttribute("aria-pressed")).toBe(
    "true",
  );
  expect((screen.getByLabelText("Avatar emoji") as HTMLInputElement).value).toBe("");
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() =>
    expect(fixture.save).toHaveBeenCalledWith(
      expect.objectContaining({
        avatar: { emoji: "", custom: "preserved", cloudVariant: "lavender" },
      }),
      "communications",
    ),
  );
});

it("names the chat, not its agent, with nothing to switch", () => {
  fixture.includeSecond = true;
  renderAgentsPage();
  // The tab names the agent; the chat's bar shows only the chat's title.
  expect(screen.getByRole("heading", { name: "New chat" })).toBeTruthy();
  expect(screen.queryByText("Communications")).toBeNull();
  openChat("research");
  expect(screen.queryByText("Research")).toBeNull();
  expect(screen.queryByRole("button", { name: /^Switch agent/ })).toBeNull();
  expect(useMistyStore.getState().selectedAgentId).toBe("research");
});
