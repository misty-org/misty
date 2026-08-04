import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  cancelAgentSession: vi.fn().mockResolvedValue(undefined),
  createAgentSession: vi.fn().mockResolvedValue({ session_id: "session-files" }),
  delegate: vi.fn(),
  deleteAgentSession: vi.fn().mockResolvedValue(undefined),
  fetchAgentEvents: vi.fn().mockResolvedValue({ events: [] }),
  fetchAgentStatus: vi.fn().mockResolvedValue({
    configured: true,
    model: "tier-low",
    model_name: "Tier Low",
    running: false,
    session_id: null,
    error: null,
  }),
  fetchAgentTranscript: vi.fn().mockResolvedValue({ messages: [] }),
  listAgentSessions: vi.fn().mockResolvedValue({ sessions: [] }),
  renameAgentSession: vi.fn().mockResolvedValue(undefined),
  sendAgentMessage: vi.fn(),
  submitToolResults: vi.fn().mockResolvedValue(undefined),
}));
const preferences = vi.hoisted(() => ({ enabled: true }));

vi.mock("@/stores/app", () => ({
  selectAgentPreferences: () => ({
    enabled: preferences.enabled,
    scopes: { filesAllowed: true, cleanupAllowed: true, searchAllowed: true },
  }),
  useSettingsStore: {
    getState: () => ({ loaded: true, settings: { document: {} }, load: vi.fn() }),
  },
}));

vi.mock("@/stores/agent/useAiServerStore", () => ({
  cancelAgentSession: api.cancelAgentSession,
  createAgentSession: api.createAgentSession,
  deleteAgentSession: api.deleteAgentSession,
  fetchAgentEvents: api.fetchAgentEvents,
  fetchAgentStatus: api.fetchAgentStatus,
  fetchAgentTranscript: api.fetchAgentTranscript,
  listAgentSessions: api.listAgentSessions,
  renameAgentSession: api.renameAgentSession,
  sendAgentMessage: api.sendAgentMessage,
  submitToolResults: api.submitToolResults,
}));

vi.mock("@/stores/agent/useAgentDelegationStore", () => ({
  publicAgentDisplayName: () => "Gemini 2.5 Flash-Lite",
  publicAgentModel: () => "google/gemini-2.5-flash-lite",
  tryAgentSpaceDelegation: api.delegate,
}));

import {
  agentScopeKey,
  requiresAgentActionPreview,
  resetAgentAccountState,
  spaceAgentScopeKey,
  useAgentSessionStore,
} from "@/stores/agent/useAgentSessionStore";

describe("useAgentSessionStore runtime isolation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    preferences.enabled = true;
    resetAgentAccountState();
  });

  it("does not route a private Files prompt through Space-agent delegation", async () => {
    api.sendAgentMessage.mockResolvedValue(undefined);
    const send = useAgentSessionStore.getState().sendPrompt({
      displayPrompt: "Hello agent",
      prompt: "Hello agent",
      cwd: null,
      selectedPaths: [],
    });

    await send;

    expect(api.delegate).not.toHaveBeenCalled();
    expect(api.sendAgentMessage).toHaveBeenCalled();
  });

  it("rechecks Space-session support after scope activation races the initial status request", async () => {
    api.fetchAgentStatus.mockResolvedValue({
      configured: true,
      model: "tier-low",
      model_name: "Tier Low",
      running: false,
      session_id: null,
      error: null,
      space_scoped_sessions: true,
    });
    api.sendAgentMessage.mockResolvedValue(undefined);
    await useAgentSessionStore
      .getState()
      .activateConversationScope(agentScopeKey("account-a", "agent-a", "space-a"));

    await useAgentSessionStore.getState().sendPrompt({
      displayPrompt: "Hello from the Space",
      prompt: "Hello from the Space",
      cwd: null,
      selectedPaths: [],
    });

    expect(api.fetchAgentStatus).toHaveBeenCalled();
    expect(api.createAgentSession).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: "agent-a", spaceId: "space-a" }),
    );
    expect(api.sendAgentMessage).toHaveBeenCalled();
    expect(api.sendAgentMessage).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        user_message: "Hello from the Space",
        capabilities: { tools: [] },
        space_id: "space-a",
      }),
    );
    expect(
      api.sendAgentMessage.mock.calls[api.sendAgentMessage.mock.calls.length - 1]?.[1].user_message,
    ).not.toContain("Permission boundary");
    expect(useAgentSessionStore.getState().messages).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ text: expect.stringContaining("unavailable") }),
      ]),
    );
  });

  it("loads an existing Space Agent transcript as soon as the dock scope opens", async () => {
    api.listAgentSessions.mockResolvedValueOnce({
      sessions: [
        {
          id: "session-existing",
          title: "Existing teammate chat",
          active: true,
          agent_id: "agent-a",
          space_id: "space-a",
          created_at: "2026-08-03T20:00:00Z",
          updated_at: "2026-08-03T21:00:00Z",
        },
      ],
    });
    api.fetchAgentTranscript.mockResolvedValueOnce({
      messages: [
        { role: "user", content: "Earlier question" },
        { role: "agent", content: "Earlier answer" },
      ],
    });

    await useAgentSessionStore
      .getState()
      .activateConversationScope(agentScopeKey("account-a", "agent-a", "space-a"));

    expect(api.fetchAgentTranscript).toHaveBeenCalledWith("session-existing");
    expect(useAgentSessionStore.getState().messages).toEqual([
      expect.objectContaining({ role: "user", text: "Earlier question" }),
      expect.objectContaining({ role: "agent", text: "Earlier answer" }),
    ]);
  });

  it("previews a Space action and executes it only after approval", async () => {
    api.fetchAgentStatus.mockResolvedValue({
      configured: true,
      model: "tier-low",
      model_name: "Tier Low",
      running: false,
      session_id: null,
      error: null,
      space_scoped_sessions: true,
    });
    api.fetchAgentEvents
      .mockResolvedValueOnce({
        events: [
          {
            sequence: 1,
            type: "agent_message",
            text: "Plan: post ‘I’m sick today’ to the shared Space chat. Approve or change it.",
            created_at: "2026-08-03T22:00:00Z",
          },
        ],
      })
      .mockResolvedValueOnce({
        events: [
          {
            sequence: 2,
            type: "agent_message",
            text: "Done — I posted it.",
            created_at: "2026-08-03T22:01:00Z",
          },
        ],
      });
    api.sendAgentMessage.mockResolvedValue(undefined);
    await useAgentSessionStore
      .getState()
      .activateConversationScope(agentScopeKey("account-a", "agent-a", "space-a"));
    useAgentSessionStore.setState({
      messages: [{ id: "earlier", role: "user", text: "Earlier message" }],
    });

    await useAgentSessionStore.getState().sendPrompt({
      displayPrompt: "Let Stone know I'm sick today",
      prompt: "Let Stone know I'm sick today",
      cwd: null,
      selectedPaths: [],
    });

    expect(api.sendAgentMessage.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        user_message: "Let Stone know I'm sick today",
        plan_only: true,
      }),
    );
    const [plan] = useAgentSessionStore.getState().actionPlans;
    expect(plan).toMatchObject({ status: "pending" });
    expect(useAgentSessionStore.getState().messages).toEqual(
      expect.arrayContaining([expect.objectContaining({ actionPlanId: plan.id })]),
    );

    await useAgentSessionStore.getState().approveActionPlan(plan.id);

    expect(api.sendAgentMessage.mock.calls[1]?.[1]).toEqual(
      expect.objectContaining({
        user_message: expect.stringContaining("Let Stone know I'm sick today"),
      }),
    );
    expect(api.sendAgentMessage.mock.calls[1]?.[1].plan_only).toBeUndefined();
    expect(useAgentSessionStore.getState().actionPlans[0]?.status).toBe("approved");
  });

  it("previews concrete actions but not ordinary questions", () => {
    expect(requiresAgentActionPreview("Let Stone know I'm sick today")).toBe(true);
    expect(requiresAgentActionPreview("Create a task called Pack bags")).toBe(true);
    expect(requiresAgentActionPreview("What tasks are due today?")).toBe(false);
    expect(requiresAgentActionPreview("What can you do here?")).toBe(false);
  });

  it("does not disable every Agent when the status check is temporarily rate limited", async () => {
    useAgentSessionStore.setState({
      status: {
        configured: true,
        spaceScopedSessions: true,
        model: "tier-low",
        modelName: "Tier Low",
        running: false,
        sessionId: null,
        error: null,
      },
      error: null,
    });
    api.fetchAgentStatus.mockRejectedValueOnce(new Error("too many requests"));

    await useAgentSessionStore.getState().refreshStatus();

    expect(useAgentSessionStore.getState()).toMatchObject({
      status: {
        configured: true,
        spaceScopedSessions: true,
        error: "too many requests",
      },
      error: null,
    });
  });

  it("keeps the built-in Space Agent on server-owned tools", async () => {
    api.fetchAgentStatus.mockResolvedValue({
      configured: true,
      model: "tier-low",
      model_name: "Tier Low",
      running: false,
      session_id: null,
      error: null,
      space_scoped_sessions: true,
    });
    api.sendAgentMessage.mockResolvedValue(undefined);
    await useAgentSessionStore
      .getState()
      .activateConversationScope(spaceAgentScopeKey("account-a", "space-a"));

    await useAgentSessionStore.getState().sendPrompt({
      displayPrompt: "Search the Space for launch notes",
      prompt: "Search the Space for launch notes",
      cwd: null,
      selectedPaths: [],
      spaceSection: "tasks",
      contextTaskId: "task-17",
    });

    expect(api.createAgentSession).toHaveBeenCalledWith(
      expect.objectContaining({ spaceId: "space-a" }),
    );
    expect(api.sendAgentMessage).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        user_message: "Search the Space for launch notes",
        capabilities: { tools: [] },
        space_id: "space-a",
        space_section: "tasks",
        context_task_id: "task-17",
      }),
    );
    expect(
      api.sendAgentMessage.mock.calls[api.sendAgentMessage.mock.calls.length - 1]?.[1].user_message,
    ).not.toContain("Permission boundary");
  });

  it("does not apply the device Files toggle to permission-checked Space Agents", async () => {
    preferences.enabled = false;
    api.fetchAgentStatus.mockResolvedValue({
      configured: true,
      model: "tier-low",
      model_name: "Tier Low",
      running: false,
      session_id: null,
      error: null,
      space_scoped_sessions: true,
    });
    api.sendAgentMessage.mockResolvedValue(undefined);
    await useAgentSessionStore
      .getState()
      .activateConversationScope(agentScopeKey("account-a", "agent-a", "space-a"));

    await useAgentSessionStore.getState().sendPrompt({
      displayPrompt: "Plan the assigned Space task",
      prompt: "Plan the assigned Space task",
      cwd: null,
      selectedPaths: [],
    });

    expect(api.sendAgentMessage).toHaveBeenCalled();
    expect(useAgentSessionStore.getState().messages).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ text: expect.stringContaining("Agents are disabled") }),
      ]),
    );
  });

  it("discards a delayed Files response after switching to a Space conversation", async () => {
    let releaseSend!: () => void;
    api.sendAgentMessage.mockImplementation(
      () => new Promise<void>((resolve) => (releaseSend = resolve)),
    );
    const send = useAgentSessionStore.getState().sendPrompt({
      displayPrompt: "Hello from Files",
      prompt: "Hello from Files",
      cwd: null,
      selectedPaths: [],
    });
    await vi.waitFor(() => expect(api.sendAgentMessage).toHaveBeenCalledOnce());

    const spaceScope = spaceAgentScopeKey("account-a", "space-a");
    await useAgentSessionStore.getState().activateConversationScope(spaceScope);
    expect(useAgentSessionStore.getState()).toMatchObject({
      conversationScopeKey: spaceScope,
      messages: [],
    });

    releaseSend();
    await send;

    expect(useAgentSessionStore.getState()).toMatchObject({
      conversationScopeKey: spaceScope,
      messages: [],
    });
  });
});
