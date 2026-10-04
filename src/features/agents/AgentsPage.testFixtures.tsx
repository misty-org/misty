import "./components/agentCloudAvatars.testFixtures";
import type * as AgentsRuntimeModule from "./AgentsRuntime";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { useWorkspaceStore } from "@/features/workspace";
import { useMistyStore } from "@/features/misty/useMistyStore";
import AgentsPage from "./AgentsPage";

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
    avatar: {} as Record<string, string>,
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
export { fixture };

export function renderAgentsPage() {
  return render(
    <MemoryRouter>
      <AgentsPage />
    </MemoryRouter>,
  );
}

/** Opens the agent's workspace from the directory. */
export function openCommunications() {
  fireEvent.click(screen.getByRole("button", { name: "Communications" }));
}

export const composer = () => screen.getByLabelText("Message Misty") as HTMLTextAreaElement;

export function typeDraft(value: string) {
  fireEvent.change(composer(), { target: { value } });
}

export const conversation = (id: string, title: string, agentId = "communications") => ({
  id,
  title,
  agentId,
  spaceId: "",
  createdAt: "2026-09-18",
  updatedAt: "2026-09-18",
  messages: [],
  remote: true,
});
