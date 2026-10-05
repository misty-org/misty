import {
  chooseFromSwitcher,
  composer,
  conversation,
  fixture,
  openAgentSettings,
  renderAgentsPage,
  typeDraft,
} from "./AgentsPage.testFixtures";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { useWorkspaceStore } from "@/features/workspace";
import { useMistyStore } from "@/features/misty/useMistyStore";

it("edits a global agent without requiring a work Space", async () => {
  renderAgentsPage();
  openAgentSettings();
  await waitFor(() => expect(screen.getByLabelText("Name")).toBeTruthy());
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Launch coordinator" } });
  expect(screen.queryByLabelText("Agent work Space")).toBeNull();
  expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("Launch coordinator");
  expect(useWorkspaceStore.getState().activeScopeKey).toBe("space:Studio");
});

it("omits model and app permission setup for a new global agent", async () => {
  useWorkspaceStore.setState({ activeScopeKey: "global" });
  renderAgentsPage();
  chooseFromSwitcher("New agent");
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
  const recents = screen.getByRole("region", { name: "Recent conversations" });
  expect(within(recents).getByRole("button", { name: "Launch draft" })).toBeTruthy();
  fireEvent.click(within(recents).getByRole("button", { name: "Other Space draft" }));
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

it("searches conversations from the switcher without changing the active conversation", () => {
  useMistyStore.setState({
    activeConversationId: "draft",
    conversations: [{ ...conversation("draft", "Launch draft"), remote: false }],
  });
  renderAgentsPage();
  fireEvent.click(screen.getByRole("button", { name: "Switch agent: Communications" }));
  // Conversations join the switcher only while searching; the sidebar lists recents.
  expect(screen.queryByRole("option", { name: /Launch draft/ })).toBeNull();
  const search = screen.getByRole("combobox", { name: "Switch agent or conversation" });
  fireEvent.change(search, { target: { value: "launch" } });
  expect(screen.getByRole("option", { name: /Launch draft/ })).toBeTruthy();
  fireEvent.change(search, { target: { value: "unmatched" } });
  expect(screen.queryByRole("option", { name: /Launch draft/ })).toBeNull();
  expect(useMistyStore.getState().activeConversationId).toBe("draft");
});

it("keeps recent conversations beside a draft and guards opening one", () => {
  useMistyStore.setState({ conversations: [conversation("draft", "Launch draft")] });
  renderAgentsPage();
  typeDraft("Keep my draft");
  const recents = screen.getByRole("region", { name: "Recent conversations" });
  expect(screen.queryByRole("alertdialog")).toBeNull();
  fireEvent.click(within(recents).getByRole("button", { name: "Launch draft" }));
  expect(screen.getByRole("button", { name: "Keep editing" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
  expect(composer().value).toBe("Keep my draft");
});

it("switches agents in place, guarding drafts and leaving the current agent untouched", async () => {
  fixture.includeSecond = true;
  renderAgentsPage();
  typeDraft("Keep my work");
  fireEvent.click(screen.getByRole("button", { name: "Switch agent: Communications" }));
  fireEvent.click(screen.getByRole("option", { name: /^Communications(?! settings)/ }));
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
  act(() => useMistyStore.setState({ working: true }));
  fireEvent.click(screen.getByRole("button", { name: "Switch agent: Communications" }));
  const research = screen.getByRole("option", { name: "Research" });
  expect(research.getAttribute("aria-disabled")).toBe("true");
  fireEvent.click(research);
  expect(useMistyStore.getState().selectedAgentId).not.toBe("research");
  expect(screen.getByRole("button", { name: "Switch agent: Communications" })).toBeTruthy();
});
