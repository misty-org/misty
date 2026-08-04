import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/features/auth/AuthContext", () => ({ useAuth: () => ({ user: { id: "user-1" } }) }));

import AgentsPage from "@/pages/Agents";
// Statically import the lazily-loaded route module so Vite transforms it at
// collection time. Awaiting the dynamic import inside a test instead makes the
// first test pay that cost against its own 5s timeout, which flakes under a
// full-suite run.
import "@/pages/Agents/desktop";
import { spaceAgentScopeKey, useAgentSessionStore } from "@/stores/agent/useAgentSessionStore";
import { usePersonalAgentsStore } from "@/stores/agents/usePersonalAgentsStore";
import type { PersonalAgent } from "@/models/interfaces/features/agents/personal";
import { useSpacesStore } from "@/stores/spaces/useSpacesStore";
import type { SpaceAgentMembership } from "@/models/interfaces/features/spaces/types";

function personalAgent(overrides: Partial<PersonalAgent> = {}): PersonalAgent {
  return {
    id: "agent-1",
    owner_user_id: "user-1",
    name: "Research Agent",
    description: "",
    icon: "",
    instructions: "",
    model_mode: "automatic",
    context_permissions: {},
    tool_permissions: { read: true, write: false, integrations: [] },
    enabled: true,
    version: 1,
    created_at: "2026-07-01T00:00:00Z",
    updated_at: "2026-07-01T00:00:00Z",
    ...overrides,
  };
}

function spaceAgent(overrides: Partial<SpaceAgentMembership> = {}): SpaceAgentMembership {
  return {
    id: "membership-1",
    space_id: "space-1",
    agent_id: "agent-1",
    owner_user_id: "user-1",
    name: "Research Agent",
    description: "",
    icon: "",
    enabled: true,
    approved_version_id: "version-1",
    approved_version: 1,
    latest_version_id: "version-1",
    latest_version: 1,
    update_available: false,
    permissions: {},
    membership_version: 1,
    created_at: "2026-07-01T00:00:00Z",
    updated_at: "2026-07-01T00:00:00Z",
    ...overrides,
  };
}

describe("AgentsPage", () => {
  let container: HTMLDivElement;
  let root: Root;
  let fetchMock: ReturnType<typeof vi.fn>;

  async function renderPage(initialEntry = "/agents") {
    // The route lazy-loads ./desktop; the static import above has already
    // cached it, so Suspense resolves on the macrotask flush below.
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={[initialEntry]}>
          <AgentsPage />
        </MemoryRouter>,
      );
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    fetchMock = vi.fn(() => Promise.resolve(new Response("{}")));
    vi.stubGlobal("fetch", fetchMock);
    // Seed store state directly so the page renders its real surface without
    // reaching the network; the store actions it calls on mount are stubbed.
    useAgentSessionStore.setState({
      status: { configured: true, running: false },
      messages: [],
      plans: [],
      toolApprovals: [],
      conversations: [],
      error: null,
      refreshStatus: vi.fn().mockResolvedValue(undefined),
      hydrateConversations: vi.fn().mockResolvedValue(undefined),
      activateConversationScope: vi.fn().mockResolvedValue(undefined),
      sendPrompt: vi.fn().mockResolvedValue(undefined),
    } as unknown as Parameters<typeof useAgentSessionStore.setState>[0]);
    usePersonalAgentsStore.setState({
      agents: [personalAgent()],
      models: [{ id: "model-1", name: "Test Model", capabilities: [] }],
      loading: false,
      error: null,
      load: vi.fn().mockResolvedValue(undefined),
    } as unknown as Parameters<typeof usePersonalAgentsStore.setState>[0]);
    useSpacesStore.setState({
      spaces: [],
      agentMembershipsBySpace: { "space-1": [spaceAgent()] },
      loadMembers: vi.fn().mockResolvedValue(undefined),
    } as unknown as Parameters<typeof useSpacesStore.setState>[0]);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("renders the real agents surface, not a coming-soon placeholder", async () => {
    await renderPage();

    expect(container.textContent).not.toContain("coming soon");
    expect(container.textContent).toContain("Research Agent");
  });

  it("exposes an interactive agent configuration surface", async () => {
    await renderPage();

    expect(container.querySelectorAll("button").length).toBeGreaterThan(0);
  });

  it("renders the composer once an agent is selected", async () => {
    await renderPage("/agents?agent=agent-1");

    const composer = container.querySelector("textarea");
    expect(composer).not.toBeNull();
    expect(composer?.disabled).toBe(false);
  });

  it("shows an animated chat typing indicator while the agent responds", async () => {
    useAgentSessionStore.setState({
      status: { configured: true, running: true },
    } as unknown as Parameters<typeof useAgentSessionStore.setState>[0]);

    await renderPage("/agents?agent=agent-1");

    expect(container.querySelector('[aria-label="Agent is responding"]')).not.toBeNull();
    expect(container.textContent).not.toContain("Running");
  });

  it("sends raw requests to server-owned tools for a Space conversation", async () => {
    await renderPage("/agents?agent=agent-1&spaceId=space-1");

    const composer = container.querySelector("textarea");
    const form = composer?.closest("form");
    expect(composer).not.toBeNull();
    expect(form).not.toBeNull();
    await act(async () => {
      if (!composer || !form) return;
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
      setter?.call(composer, "Create a task called Review brief");
      composer.dispatchEvent(new Event("input", { bubbles: true }));
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    expect(useAgentSessionStore.getState().sendPrompt).toHaveBeenCalledWith({
      displayPrompt: "Create a task called Review brief",
      prompt: "Create a task called Review brief",
      cwd: null,
      selectedPaths: [],
      spaceSection: "agents",
    });
    expect(container.querySelector('[aria-label="Add context"]')).toBeNull();
    expect(container.textContent).toContain("Tools scoped to space-1");
  });

  it("offers the built-in Space Agent even without an installed custom Agent", async () => {
    useSpacesStore.setState({ agentMembershipsBySpace: { "space-1": [] } });

    await renderPage("/agents?spaceId=space-1");

    expect(container.textContent).toContain("Misty");
    expect(container.querySelector("textarea")).not.toBeNull();
    expect(useAgentSessionStore.getState().activateConversationScope).toHaveBeenCalledWith(
      spaceAgentScopeKey("user-1", "space-1"),
    );
  });

  it("uses the installed Space roster, including Agents owned by teammates", async () => {
    useSpacesStore.setState({
      agentMembershipsBySpace: {
        "space-1": [
          spaceAgent({
            id: "membership-2",
            agent_id: "agent-2",
            owner_user_id: "user-2",
            name: "Teammate Agent",
          }),
        ],
      },
    });

    await renderPage("/agents?agent=agent-2&spaceId=space-1");

    expect(container.textContent).toContain("Teammate Agent");
    expect(container.textContent).not.toContain("Research Agent");
    expect(container.textContent).not.toContain("Preferences");
    expect(container.textContent).not.toContain("Delete");
  });
});
