import "@/tests/ports/spaces";
import type * as Actual1 from "../personal/agentAccount";
import type * as Actual2 from "@/features/agents/conversations/state/localChats";
import "../personal/agentCloudAvatars.testFixtures";
import type * as AgentsRuntimeModule from "../AgentsRuntime";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";
import { MemoryRouter, useNavigate, type NavigateFunction } from "react-router-dom";
import { useMistyStore } from "@/features/agents/conversations/state/useMistyStore";
import { Button } from "@/shared/ui";
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
// The room itself is three.js; the page only needs each agent's card and its settings button.
vi.mock("../virtual/VirtualStudio", () => ({
  VirtualStudio: (props: { onAgentSettings(agentId: string): void }) => (
    <div>
      {[
        fixture.agent,
        ...(fixture.includeSecond ? [{ id: "research", name: "Research" }] : []),
      ].map((agent) => (
        <Button key={agent.id} onClick={() => props.onAgentSettings(agent.id)}>
          {`${agent.name} settings`}
        </Button>
      ))}
    </div>
  ),
}));

beforeEach(() => {
  fixture.includeSecond = false;
  fixture.save.mockClear();
  fixture.submit.mockClear();
  fixture.agent.avatar = {};
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
function NavigationProbe() {
  navigateTo = useNavigate();
  return null;
}

export function renderAgentsPage(entry = "/agents") {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <NavigationProbe />
      <AgentsPage />
    </MemoryRouter>,
  );
}

/** Follows a link to the page, as the window's sidebar does. */
export function openPage(page: "studio" | "integrations" | "lab") {
  act(() => void navigateTo?.(`/agents?view=${page}`));
}

/** Follows a link back to an agent's chat, as a chat row in the sidebar does. */
export function openChat(agentId = "communications", conversationId?: string) {
  const params = new URLSearchParams({ agent: agentId });
  if (conversationId) params.set("conversation", conversationId);
  act(() => void navigateTo?.(`/agents?${params}`));
}

/** An agent's settings open from its card in the Studio, never from the chat. */
export function openAgentSettings(agent = "Communications") {
  openPage("studio");
  fireEvent.click(screen.getByRole("button", { name: `${agent} settings` }));
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
