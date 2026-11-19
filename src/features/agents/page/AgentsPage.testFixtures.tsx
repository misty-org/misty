import "@/tests/ports/spaces";
import type * as Actual1 from "../personal/agentAccount";
import type * as Actual2 from "@/features/agents/conversations/state/localChats";
import "../personal/agentCloudAvatars.testFixtures";
import type * as AgentsRuntimeModule from "../AgentsRuntime";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";
import { MemoryRouter, useLocation, useNavigate, type NavigateFunction } from "react-router-dom";
import { useMistyStore } from "@/features/agents/conversations/state/useMistyStore";
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
    /** Its home Space; empty for one made before agents had one. */
    space_id: "",
  },
}));
vi.mock("@/features/account", () => ({ useAuth: () => ({ user: { id: "owner" } }) }));
vi.mock("../personal/agentAccount", async (original) => ({
  ...(await original<typeof Actual1>()),
  useAgentAccountId: () => "owner",
}));
// A chat's load reads misty.db, which holds what the test put in the store.
vi.mock("@/features/agents/conversations/state/localChats", async (original) => {
  const actual = await original<typeof Actual2>();
  return {
    ...actual,
    localChats: {
      ...actual.localChats,
      conversations: async () =>
        (
          await import("@/features/agents/conversations/state/useMistyStore")
        ).useMistyStore.getState().conversations,
    },
  };
});
vi.mock("../AgentsRuntime", async (original) => ({
  ...(await original<typeof AgentsRuntimeModule>()),
  useAgentsAuth: () => ({ user: { id: "owner" } }),
  runtimeAiApi: { activity: async () => ({ entries: [] }) },
}));
vi.mock("../personal/personalAgentsStore", () => ({
  defaultAgentOf: (agents: { system_managed?: boolean; engine?: string }[]) =>
    agents.find((agent) => agent.engine) ?? agents.find((agent) => agent.system_managed),
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
vi.mock("@/features/agents/personal/personalAgentsApi", () => ({
  personalAgentsApi: {
    save: fixture.save,
    apps: async () => ({ app_ids: [] }),
    memories: async () => ({ memories: [] }),
  },
}));
vi.mock("@/features/agents/conversations/ask/handoff", () => ({ openMisty: async () => {} }));
// The Code page is its own editor; these tests only need to tell which page shows.
vi.mock("../code/CodePage", () => ({ CodePage: () => <div>Code page</div> }));

beforeEach(() => {
  fixture.includeSecond = false;
  fixture.save.mockClear();
  fixture.submit.mockClear();
  fixture.agent.avatar = {};
  fixture.agent.space_id = "";
  Element.prototype.scrollIntoView = vi.fn();
  useMistyStore.setState({
    accountId: "owner",
    selectedAgentId: undefined,
    conversations: [],
    activeConversationId: "",
    working: false,
    error: null,
    loadConversations: async () => {},
    submitAnswer: fixture.submit,
  });
});
afterEach(cleanup);
export { fixture };

let navigateTo: NavigateFunction | undefined;
let location = "";
function NavigationProbe() {
  navigateTo = useNavigate();
  const here = useLocation();
  location = `${here.pathname}${here.search}`;
  return null;
}

/** Where the page's router is now: its path and query. */
export const currentLocation = () => location;

export function renderAgentsPage(entry = "/agents") {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <NavigationProbe />
      <AgentsPage />
    </MemoryRouter>,
  );
}

/** Follows a link to the page, as the window's sidebar does. */
export function openPage(page: "lab" | "code") {
  act(() => void navigateTo?.(`/agents?view=${page}`));
}

/** Follows a link back to an agent's chat, as a chat row in the sidebar does. */
export function openChat(agentId = "communications", conversationId?: string) {
  const params = new URLSearchParams({ agent: agentId });
  if (conversationId) params.set("conversation", conversationId);
  act(() => void navigateTo?.(`/agents?${params}`));
}

/**
 * An agent's settings open by a link that keeps the page where it is and names the agent, never
 * from the chat.
 */
export function openAgentSettings(agent = "Communications") {
  const id = agent === "Research" ? "research" : fixture.agent.id;
  const [path, query = ""] = location.split("?");
  const params = new URLSearchParams(query);
  params.set("agentSettings", id);
  act(() => void navigateTo?.(`${path}?${params}`));
}

/** Opens the ⋯ menu in the conversation header (Recents has its own) and chooses an action. */
export const composer = () => screen.getByLabelText("Message") as HTMLTextAreaElement;

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
