import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { useWorkspaceStore } from "@/features/workspace";

const fixture = vi.hoisted(() => ({
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
vi.mock("./personalAgentsStore", () => ({
  usePersonalAgentsStore: () => ({
    agents: [fixture.agent],
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
  fireEvent.click(screen.getByRole("button", { name: /Communications/ }));
  fireEvent.click(screen.getByRole("button", { name: "Agent settings" }));
  await waitFor(() =>
    expect(
      (screen.getByRole("button", { name: "Save changes" }) as HTMLButtonElement).disabled,
    ).toBe(false),
  );
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
  fireEvent.click(screen.getByRole("button", { name: "New chat" }));
  fireEvent.click(screen.getByRole("button", { name: "Create new agent" }));
  fireEvent.click(screen.getByText("Instructions and memory"));
  expect(screen.queryByRole("group", { name: "Personal apps" })).toBeNull();
  expect(screen.queryByRole("checkbox", { name: "browser" })).toBeNull();
  expect(screen.queryByLabelText("Model")).toBeNull();
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
  );
  await waitFor(() =>
    expect((screen.getByLabelText("Message Misty") as HTMLTextAreaElement).value).toBe(""),
  );
  fireEvent.click(screen.getByRole("button", { name: "New chat" }));
  fireEvent.click(
    within(screen.getByRole("group", { name: "Choose an agent" })).getByRole("button", {
      name: /Communications/,
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
  );
  expect(useMistyStore.getState().selectedSpaceId).toBe("");
});

it("preserves an unsent message until a new chat is explicitly confirmed", () => {
  render(
    <MemoryRouter>
      <AgentsPage />
    </MemoryRouter>,
  );
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
  fireEvent.click(screen.getAllByRole("button", { name: "Communications" })[1]);
  expect((screen.getByLabelText("Message Misty") as HTMLTextAreaElement).value).toBe("");
});

it("previews and saves a cloud variant while preserving unrelated avatar metadata", async () => {
  fixture.agent.avatar = { emoji: "✏️", custom: "preserved" };
  render(
    <MemoryRouter>
      <AgentsPage />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Agent settings" }));
  await waitFor(() =>
    expect(
      (screen.getByRole("button", { name: "Save changes" }) as HTMLButtonElement).disabled,
    ).toBe(false),
  );
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
