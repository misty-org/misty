import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { useSpacesStore } from "@/features/spaces";
import { useAppsStore } from "@/features/apps/useAppsStore";
import { useWorkspaceStore } from "@/features/workspace";

const fixture = vi.hoisted(() => ({
  load: vi.fn(async () => {}),
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
  fixture.agent.avatar = {};
  Element.prototype.scrollIntoView = vi.fn();
  useMistyStore.setState({
    accountId: "owner",
    conversations: [],
    activeConversationId: "",
    working: false,
    error: null,
    loadConversations: async () => {},
  });
  useSpacesStore.setState({
    spaces: ["Studio", "Launch"].map((name) => ({
      id: name,
      name,
      owner_user_id: "owner",
      role: "owner" as const,
      member_count: 1,
      pending_count: 0,
      is_shared: false,
      is_default: name === "Studio",
      created_at: "",
      updated_at: "",
    })),
  });
  useWorkspaceStore.setState({ activeScopeKey: "space:Studio" });
  useAppsStore.setState({ catalog: [], installations: [], load: async () => {} });
});
afterEach(cleanup);

it("keeps unsaved agent fields until a Space switch is explicitly discarded", async () => {
  render(
    <MemoryRouter>
      <AgentsPage />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole("button", { name: /Communications/ }));
  fireEvent.click(screen.getByRole("button", { name: "Agent details" }));
  fireEvent.click(screen.getByRole("button", { name: "Agent settings" }));
  await waitFor(() =>
    expect(
      (screen.getByRole("button", { name: "Save changes" }) as HTMLButtonElement).disabled,
    ).toBe(false),
  );
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Launch coordinator" } });
  const filter = screen.getByLabelText("Agent work Space") as HTMLSelectElement;
  fireEvent.change(filter, { target: { value: "Launch" } });
  expect(filter.value).toBe("Studio");
  expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("Launch coordinator");
  expect(screen.getByRole("alert").textContent).toContain("unsaved changes");
  fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
  expect(screen.queryByRole("alert")).toBeNull();
  expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("Launch coordinator");
  fireEvent.change(filter, { target: { value: "Launch" } });
  fireEvent.click(screen.getByRole("button", { name: "Discard and switch" }));
  expect(filter.value).toBe("Launch");
  expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("Communications");
  expect(useWorkspaceStore.getState().activeScopeKey).toBe("space:Studio");
});

it("offers personal app assignments without a Space", async () => {
  useSpacesStore.setState({ spaces: [] });
  useWorkspaceStore.setState({ activeScopeKey: "global" });
  useAppsStore.setState({
    installations: [
      {
        app_id: "browser",
        state: "installed",
        installed_version: "1",
        permission_version: 1,
        granted_scopes: [],
        authority_generation: 1,
        pin_rank: 0,
        installed_at: "",
        updated_at: "",
      },
    ],
  });
  render(
    <MemoryRouter>
      <AgentsPage />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole("button", { name: "New chat" }));
  fireEvent.click(screen.getByRole("button", { name: "Create new agent" }));
  fireEvent.click(screen.getByText("Instructions, model, and apps"));
  expect(screen.getByRole("group", { name: "Personal apps" })).toBeTruthy();
  expect(screen.getByRole("checkbox", { name: "browser" })).toBeTruthy();
  expect(screen.queryByText("Select a Space to assign apps.")).toBeNull();
});

it("searches agents and only the current Space's conversations, with no-match recovery", async () => {
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
  fireEvent.click(screen.getByRole("button", { name: "Search" }));
  const search = screen.getByRole("combobox", { name: "Search agents and conversations" });
  fireEvent.change(search, { target: { value: " DRAFT " } });
  expect(screen.getByRole("option", { name: /Launch draft/ })).toBeTruthy();
  expect(screen.queryByRole("option", { name: /Other Space/ })).toBeNull();
  fireEvent.change(search, { target: { value: "no-such-agent" } });
  expect(screen.getByText("No results. Try another name or conversation.")).toBeTruthy();
  fireEvent.change(search, { target: { value: "  COMMUNICATIONS  " } });
  await waitFor(() => expect(screen.getByRole("option", { name: "Communications" })).toBeTruthy());
  fireEvent.keyDown(search, { key: "Enter", code: "Enter" });
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(screen.getByRole("heading", { name: "Communications" })).toBeTruthy();
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
  fireEvent.click(screen.getByRole("button", { name: "Agent details" }));
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
