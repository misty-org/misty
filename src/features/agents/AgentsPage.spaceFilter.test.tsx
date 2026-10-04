import {
  composer,
  conversation,
  fixture,
  openCommunications,
  renderAgentsPage,
  typeDraft,
} from "./AgentsPage.testFixtures";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { useWorkspaceStore } from "@/features/workspace";
import { useMistyStore } from "@/features/misty/useMistyStore";

it("edits a global agent without requiring a work Space", async () => {
  renderAgentsPage();
  openCommunications();
  fireEvent.click(screen.getByRole("button", { name: "Agent settings" }));
  await waitFor(() => expect(screen.getByLabelText("Name")).toBeTruthy());
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Launch coordinator" } });
  expect(screen.queryByLabelText("Agent work Space")).toBeNull();
  expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("Launch coordinator");
  expect(useWorkspaceStore.getState().activeScopeKey).toBe("space:Studio");
});

it("omits model and app permission setup for a new global agent", async () => {
  useWorkspaceStore.setState({ activeScopeKey: "global" });
  renderAgentsPage();
  fireEvent.click(screen.getByRole("button", { name: "New agent" }));
  fireEvent.click(screen.getByText("Instructions", { selector: "summary" }));
  expect(screen.queryByRole("group", { name: "Personal apps" })).toBeNull();
  expect(screen.queryByRole("checkbox", { name: "browser" })).toBeNull();
  expect(within(screen.getByRole("dialog")).queryByLabelText("Model")).toBeNull();
  expect(screen.queryByText("Select a Space to assign apps.")).toBeNull();
});

it("reopens historical conversations and starts new personal work without their old scope", async () => {
  useMistyStore.setState({
    conversations: [
      { ...conversation("draft", "Launch draft"), spaceId: "Studio" },
      { ...conversation("private", "Other Space draft"), spaceId: "Launch" },
    ],
  });
  renderAgentsPage();
  fireEvent.click(screen.getByRole("button", { name: "Conversations" }));
  expect(screen.getByText("Launch draft")).toBeTruthy();
  expect(screen.getByText("Other Space draft")).toBeTruthy();
  fireEvent.click(screen.getByText("Other Space draft"));
  typeDraft("Continue this conversation");
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Send to Misty" }));
  });
  await waitFor(() => expect(fixture.submit).toHaveBeenCalledOnce());
  expect(fixture.submit).toHaveBeenLastCalledWith(
    "Continue this conversation",
    [],
    undefined,
    "workspace",
    [],
    expect.objectContaining({ conversationId: "private" }),
    { executionMode: "user", interactionMode: "auto", model: "" },
  );
  await waitFor(() => expect(composer().value).toBe(""));
  fireEvent.click(screen.getByRole("button", { name: "New task" }));
  typeDraft("Start personal work");
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Send to Misty" }));
  });
  await waitFor(() => expect(fixture.submit).toHaveBeenCalledTimes(2));
  expect(fixture.submit).toHaveBeenLastCalledWith(
    "Start personal work",
    [],
    undefined,
    "workspace",
    [],
    { conversationId: "", context: [] },
    { executionMode: "user", interactionMode: "auto", model: "" },
  );
  expect(useMistyStore.getState().selectedSpaceId).toBe("");
});

it("preserves an unsent message until a new task is explicitly confirmed", () => {
  renderAgentsPage();
  openCommunications();
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
  openCommunications();
  fireEvent.click(screen.getByRole("button", { name: "Agent settings" }));
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

it("searches chat titles and clears the filter without changing the active conversation", () => {
  useMistyStore.setState({
    activeConversationId: "draft",
    conversations: [{ ...conversation("draft", "Launch draft"), remote: false }],
  });
  renderAgentsPage();
  fireEvent.click(screen.getByRole("button", { name: "Conversations" }));
  const search = screen.getByRole("textbox", { name: "Search conversations" });
  fireEvent.change(search, { target: { value: "launch" } });
  expect(screen.getByText("Launch draft")).toBeTruthy();
  fireEvent.change(search, { target: { value: "unmatched" } });
  expect(screen.queryByText("No matching items")).toBeNull();
  expect(screen.getAllByRole("row")).toHaveLength(1);
  expect(useMistyStore.getState().activeConversationId).toBe("draft");
  fireEvent.keyDown(search, { key: "Escape" });
  expect(screen.getByText("Launch draft")).toBeTruthy();
});

it("keeps recent conversations beside a draft and guards returning to the collection", () => {
  useMistyStore.setState({ conversations: [conversation("draft", "Launch draft")] });
  renderAgentsPage();
  openCommunications();
  typeDraft("Keep my draft");
  const recents = screen.getByRole("region", { name: "Recent conversations" });
  expect(within(recents).getByRole("button", { name: "Launch draft" })).toBeTruthy();
  expect(screen.queryByRole("alertdialog")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Back to agents" }));
  expect(screen.getByRole("button", { name: "Keep editing" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
  expect(composer().value).toBe("Keep my draft");
});

it("switches agents in place, guarding drafts and leaving the current agent untouched", async () => {
  fixture.includeSecond = true;
  renderAgentsPage();
  openCommunications();
  typeDraft("Keep my work");
  fireEvent.click(screen.getByRole("button", { name: "Switch agent: Communications" }));
  fireEvent.click(screen.getByRole("option", { name: /Communications/ }));
  expect(screen.queryByRole("alertdialog")).toBeNull();
  expect(composer().value).toBe("Keep my work");
  fireEvent.click(screen.getByRole("button", { name: "Switch agent: Communications" }));
  fireEvent.click(screen.getByRole("option", { name: "Research" }));
  expect(screen.getByRole("alertdialog")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
  expect(composer().value).toBe("Keep my work");
  fireEvent.click(screen.getByRole("button", { name: "Switch agent: Communications" }));
  fireEvent.click(screen.getByRole("option", { name: "Research" }));
  fireEvent.click(screen.getByRole("button", { name: "Discard and switch" }));
  expect(screen.getByRole("button", { name: "Switch agent: Research" })).toBeTruthy();
  expect(screen.queryByRole("heading", { name: "Agents" })).toBeNull();
  expect(useMistyStore.getState().selectedAgentId).toBe("research");
});

it("finds and opens another agent's historical conversation through the switcher", async () => {
  fixture.includeSecond = true;
  const selectConversation = vi.fn(async (id: string) => {
    useMistyStore.setState({ activeConversationId: id });
  });
  useMistyStore.setState({
    selectConversation,
    conversations: [
      { ...conversation("research-chat", "Solar research", "research"), updatedAt: "2026-09-30" },
    ],
  });
  renderAgentsPage();
  openCommunications();
  fireEvent.click(screen.getByRole("button", { name: "Switch agent: Communications" }));
  fireEvent.change(screen.getByRole("combobox", { name: "Switch agent or conversation" }), {
    target: { value: "Solar" },
  });
  fireEvent.click(screen.getByRole("option", { name: /Solar research/ }));
  expect(selectConversation).toHaveBeenCalledWith("research-chat");
  expect(useMistyStore.getState().activeConversationId).toBe("research-chat");
  expect(screen.getByRole("button", { name: "Switch agent: Research" })).toBeTruthy();
});

it("prevents switching while a response is running", () => {
  fixture.includeSecond = true;
  renderAgentsPage();
  openCommunications();
  act(() => useMistyStore.setState({ working: true }));
  fireEvent.click(screen.getByRole("button", { name: "Switch agent: Communications" }));
  const research = screen.getByRole("option", { name: "Research" });
  expect(research.getAttribute("aria-disabled")).toBe("true");
  fireEvent.click(research);
  expect(useMistyStore.getState().selectedAgentId).toBe("communications");
});
