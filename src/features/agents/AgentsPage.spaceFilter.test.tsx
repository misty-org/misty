import "./components/agentCloudAvatars.testFixtures";
import type * as AgentsRuntimeModule from "./AgentsRuntime";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { useWorkspaceStore } from "@/features/workspace";

const fixture = vi.hoisted(() => ({
  includeSecond: false,
  load: vi.fn(async () => {}),
  submit: vi.fn(async () => {}),
  save: vi.fn(async () => ({ id: "communications" })),
  agent: {
    id: "communications",
    name: "Communications",
    role: "Coordinate launches",
    instructions: "",
    avatar: {},
    model_mode: "automatic",
    model_id: "",
    enabled: true,
  },
}));
vi.mock("@/features/auth", () => ({ useAuth: () => ({ user: { id: "owner" } }) }));
vi.mock("./AgentsRuntime", async (original) => ({
  ...(await original<typeof AgentsRuntimeModule>()),
  useAgentsAuth: () => ({ user: { id: "owner" } }),
  runtimeAiApi: { activity: async () => ({ entries: [] }) },
}));
vi.mock("./personalAgentsStore", () => ({
  usePersonalAgentsStore: () => ({
    agents: [
      fixture.agent,
      ...(fixture.includeSecond ? [{ ...fixture.agent, id: "research", name: "Research" }] : []),
    ],
    loading: false,
    error: "",
    load: fixture.load,
  }),
}));
vi.mock("@/api/agents/native", () => ({
  personalAgentsApi: {
    save: fixture.save,
    apps: async () => ({ app_ids: [] }),
    memories: async () => ({ memories: [] }),
  },
}));
vi.mock("@/api/assistant/api", () => ({
  assistantApi: { frontierModels: async () => ({ models: [] }) },
}));
vi.mock("./components/MistyDashboard", () => ({ MistyDashboard: () => null }));
vi.mock("./mcp/McpConnectionsSheet", () => ({ McpConnectionsSheet: () => null }));
vi.mock("@/features/misty/handoff", () => ({ openMisty: async () => {} }));
import AgentsPage from "./AgentsPage";
import { useMistyStore } from "@/features/misty/useMistyStore";

beforeEach(() => {
  fixture.includeSecond = false;
  fixture.save.mockClear();
  fixture.submit.mockClear();
  fixture.agent.avatar = {};
  Element.prototype.scrollIntoView = vi.fn();
  useMistyStore.setState({
    accountId: "owner",
    conversations: [],
    activeConversationId: "",
    working: false,
    error: null,
    loadConversations: async () => {},
    submitAnswer: fixture.submit,
  });
  useWorkspaceStore.setState({ activeScopeKey: "space:Studio" });
});
afterEach(cleanup);

it("edits a global agent without requiring a work Space", async () => {
  render(
    <MemoryRouter>
      <AgentsPage />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Communications" }));
  fireEvent.click(screen.getByRole("button", { name: "Profile" }));
  await waitFor(() => expect(screen.getByLabelText("Name")).toBeTruthy());
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Launch coordinator" } });
  expect(screen.queryByLabelText("Agent work Space")).toBeNull();
  expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("Launch coordinator");
  expect(useWorkspaceStore.getState().activeScopeKey).toBe("space:Studio");
});

it("omits model and app permission setup for a new global agent", async () => {
  useWorkspaceStore.setState({ activeScopeKey: "global" });
  render(
    <MemoryRouter>
      <AgentsPage />
    </MemoryRouter>,
  );
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
      {
        id: "draft",
        title: "Launch draft",
        agentId: "communications",
        spaceId: "Studio",
        createdAt: "2026-09-18",
        updatedAt: "2026-09-18",
        messages: [],
        remote: true,
      },
      {
        id: "private",
        title: "Other Space draft",
        agentId: "communications",
        spaceId: "Launch",
        createdAt: "2026-09-18",
        updatedAt: "2026-09-18",
        messages: [],
        remote: true,
      },
    ],
  });
  render(
    <MemoryRouter>
      <AgentsPage />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Conversations" }));
  expect(screen.getByText("Launch draft")).toBeTruthy();
  expect(screen.getByText("Other Space draft")).toBeTruthy();
  fireEvent.click(screen.getByText("Other Space draft"));
  fireEvent.change(screen.getByLabelText("Message Misty"), {
    target: { value: "Continue this conversation" },
  });
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
  await waitFor(() =>
    expect((screen.getByLabelText("Message Misty") as HTMLTextAreaElement).value).toBe(""),
  );
  fireEvent.click(screen.getByRole("button", { name: "New chat" }));
  fireEvent.click(
    within(screen.getByRole("group", { name: "Choose an agent" })).getByRole("button", {
      name: "Communications",
    }),
  );
  fireEvent.change(screen.getByLabelText("Message Misty"), {
    target: { value: "Start personal work" },
  });
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

it("preserves an unsent message until a new chat is explicitly confirmed", () => {
  render(
    <MemoryRouter>
      <AgentsPage />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Communications" }));
  fireEvent.change(screen.getByLabelText("Message Misty"), {
    target: { value: "Keep this message" },
  });
  fireEvent.click(screen.getByRole("button", { name: "New chat" }));
  expect(screen.queryByLabelText("Search or create agents")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
  expect((screen.getByLabelText("Message Misty") as HTMLTextAreaElement).value).toBe(
    "Keep this message",
  );
  fireEvent.click(screen.getByRole("button", { name: "New chat" }));
  fireEvent.click(screen.getByRole("button", { name: "Discard and switch" }));
  fireEvent.click(
    within(screen.getByRole("group", { name: "Choose an agent" })).getByRole("button", {
      name: "Communications",
    }),
  );
  expect((screen.getByLabelText("Message Misty") as HTMLTextAreaElement).value).toBe("");
});

it("previews and saves a cloud avatar while preserving unrelated avatar metadata", async () => {
  fixture.agent.avatar = { emoji: "✏️", custom: "preserved" };
  render(
    <MemoryRouter>
      <AgentsPage />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Communications" }));
  fireEvent.click(screen.getByRole("button", { name: "Profile" }));
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
    conversations: [
      {
        id: "draft",
        title: "Launch draft",
        agentId: "communications",
        spaceId: "",
        createdAt: "2026-09-18",
        updatedAt: "2026-09-18",
        messages: [],
        remote: false,
      },
    ],
  });
  render(
    <MemoryRouter>
      <AgentsPage />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Conversations" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Search conversations" }), {
    target: { value: "launch" },
  });
  expect(screen.getByText("Launch draft")).toBeTruthy();
  fireEvent.change(screen.getByRole("textbox", { name: "Search conversations" }), {
    target: { value: "unmatched" },
  });
  expect(screen.queryByText("No matching items")).toBeNull();
  expect(screen.getAllByRole("row")).toHaveLength(1);
  expect(useMistyStore.getState().activeConversationId).toBe("draft");
  fireEvent.keyDown(screen.getByRole("textbox", { name: "Search conversations" }), {
    key: "Escape",
  });
  expect(screen.getByText("Launch draft")).toBeTruthy();
});

it("discloses chat history without resetting a draft and guards returning to the collection", () => {
  render(
    <MemoryRouter>
      <AgentsPage />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Communications" }));
  fireEvent.change(screen.getByLabelText("Message Misty"), { target: { value: "Keep my draft" } });
  fireEvent.click(screen.getByRole("button", { name: "Conversations" }));
  fireEvent.click(screen.getByRole("button", { name: "Conversations" }));
  expect(screen.queryByRole("button", { name: "Keep editing" })).toBeNull();
  expect((screen.getByLabelText("Message Misty") as HTMLTextAreaElement).value).toBe(
    "Keep my draft",
  );
  fireEvent.click(screen.getByRole("button", { name: "Back to agents" }));
  expect(screen.getByRole("button", { name: "Keep editing" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
  expect((screen.getByLabelText("Message Misty") as HTMLTextAreaElement).value).toBe(
    "Keep my draft",
  );
});

it("protects unsaved profile edits when closing settings while preserving the conversation draft", () => {
  render(
    <MemoryRouter>
      <AgentsPage />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Communications" }));
  fireEvent.change(screen.getByLabelText("Message Misty"), { target: { value: "Unsent draft" } });
  fireEvent.click(screen.getByRole("button", { name: "Profile" }));
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Unsaved name" } });
  fireEvent.click(screen.getByRole("button", { name: "Profile" }));
  expect(screen.getByRole("alertdialog")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
  expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("Unsaved name");
  fireEvent.click(screen.getByRole("button", { name: "Profile" }));
  fireEvent.click(screen.getByRole("button", { name: "Discard and switch" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect((screen.getByLabelText("Message Misty") as HTMLTextAreaElement).value).toBe(
    "Unsent draft",
  );
});

it("toggles the text-only navigation island without losing the conversation draft", () => {
  render(
    <MemoryRouter>
      <AgentsPage />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Communications" }));
  fireEvent.change(screen.getByLabelText("Message Misty"), { target: { value: "Keep my draft" } });
  const identity = screen.getByRole("button", { name: "Show agent panel" });
  expect(identity.getAttribute("aria-pressed")).toBe("true");
  const island = screen.getByRole("navigation", { name: "Agent navigation" });
  expect(island.querySelector("svg")).toBeNull();
  fireEvent.click(within(island).getByRole("button", { name: "Conversations" }));
  expect(screen.getByRole("dialog", { name: "Conversations" })).toBeTruthy();
  fireEvent.click(identity);
  expect(screen.queryByRole("navigation", { name: "Agent navigation" })).toBeNull();
  expect(screen.queryByRole("dialog")).toBeNull();
  expect((screen.getByLabelText("Message Misty") as HTMLTextAreaElement).value).toBe(
    "Keep my draft",
  );
  fireEvent.click(identity);
  expect(screen.getByRole("navigation", { name: "Agent navigation" })).toBeTruthy();
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("guards profile edits when switching dropdowns or hiding the island", async () => {
  render(
    <MemoryRouter>
      <AgentsPage />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Communications" }));
  fireEvent.click(screen.getByRole("button", { name: "Profile" }));
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Keep this name" } });
  fireEvent.click(screen.getByRole("button", { name: "Conversations" }));
  expect(screen.getByRole("alertdialog")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
  await waitFor(() => expect(document.activeElement?.getAttribute("aria-label")).toBe("Profile"));
  expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("Keep this name");
  fireEvent.click(screen.getByRole("button", { name: "Show agent panel" }));
  fireEvent.click(screen.getByRole("button", { name: "Discard and switch" }));
  expect(screen.queryByRole("navigation", { name: "Agent navigation" })).toBeNull();
  expect(screen.queryByLabelText("Name")).toBeNull();
});

it("keeps the requested chat action when discarding profile edits", async () => {
  render(
    <MemoryRouter>
      <AgentsPage />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Communications" }));
  fireEvent.click(screen.getByRole("button", { name: "Profile" }));
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Unsaved name" } });
  const newChat = screen.getByRole("button", { name: "New chat" });
  fireEvent.pointerDown(newChat);
  fireEvent.click(newChat);
  fireEvent.click(screen.getByRole("button", { name: "Discard and switch" }));
  await waitFor(() =>
    expect(document.activeElement).toBe(screen.getByLabelText("Search or create agents")),
  );
  expect(screen.queryByLabelText("Name")).toBeNull();
});

it("switches agents in place, guarding drafts and leaving the current agent untouched", async () => {
  fixture.includeSecond = true;
  render(
    <MemoryRouter>
      <AgentsPage />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Communications" }));
  fireEvent.change(screen.getByLabelText("Message Misty"), { target: { value: "Keep my work" } });
  fireEvent.click(screen.getByRole("button", { name: "Switch agent: Communications" }));
  fireEvent.click(screen.getByRole("option", { name: /Communications/ }));
  expect(screen.queryByRole("alertdialog")).toBeNull();
  expect((screen.getByLabelText("Message Misty") as HTMLTextAreaElement).value).toBe(
    "Keep my work",
  );
  fireEvent.click(screen.getByRole("button", { name: "Switch agent: Communications" }));
  fireEvent.click(screen.getByRole("option", { name: "Research" }));
  expect(screen.getByRole("alertdialog")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
  expect((screen.getByLabelText("Message Misty") as HTMLTextAreaElement).value).toBe(
    "Keep my work",
  );
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
      {
        id: "research-chat",
        agentId: "research",
        title: "Solar research",
        spaceId: "",
        createdAt: "2026-09-30",
        updatedAt: "2026-09-30",
        messages: [],
        remote: true,
      },
    ],
  });
  render(
    <MemoryRouter>
      <AgentsPage />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Communications" }));
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
  render(
    <MemoryRouter>
      <AgentsPage />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Communications" }));
  act(() => useMistyStore.setState({ working: true }));
  fireEvent.click(screen.getByRole("button", { name: "Switch agent: Communications" }));
  const research = screen.getByRole("option", { name: "Research" });
  expect(research.getAttribute("aria-disabled")).toBe("true");
  fireEvent.click(research);
  expect(useMistyStore.getState().selectedAgentId).toBe("communications");
});
