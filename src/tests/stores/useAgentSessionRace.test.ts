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

vi.mock("@/stores/app", () => ({
  selectAgentPreferences: () => ({
    enabled: true,
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
  resetAgentAccountState,
  spaceAgentScopeKey,
  useAgentSessionStore,
} from "@/stores/agent/useAgentSessionStore";

describe("useAgentSessionStore runtime isolation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
    expect(api.sendAgentMessage).toHaveBeenCalledOnce();
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
