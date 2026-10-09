import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { globalMistyApi } from "@/features/global-search/globalMistyApi";
import type { AiArtifact } from "@/features/ai-surface/types";
import { useMistyStore } from "./useMistyStore";
import { usePersonalAgentsStore } from "@/features/agents/personalAgentsStore";
import type { GlobalAiConversation } from "@/features/global-search/types";

const windowMocks = vi.hoisted(() => ({
  getByLabel: vi.fn(),
  getCurrentWindow: vi.fn(),
}));
// Conversations open on the Agents page.
const workspace = vi.hoisted(() => ({
  openDestination: vi.fn((request: { route: string }) => ({ id: "agents", route: request.route })),
  updateViewRoute: vi.fn(),
}));
vi.mock("@/features/workspace/useWorkspaceStore", () => ({
  useWorkspaceStore: { getState: () => workspace },
}));
const last = <T>(items: T[]) => items[items.length - 1];
const openedRoute = () =>
  last(workspace.updateViewRoute.mock.calls)?.[1] ??
  last(workspace.openDestination.mock.calls)?.[0].route;

vi.mock("@tauri-apps/api/window", () => ({
  Window: {
    getByLabel: windowMocks.getByLabel,
  },
  getCurrentWindow: windowMocks.getCurrentWindow,
}));

import { openMisty } from "./handoff";

describe("openMisty", () => {
  beforeEach(() => {
    window.localStorage.clear();
    useMistyStore.setState({
      accountId: "account",
      working: false,
      activeConversationId: "",
      selectedAgentId: undefined,
      selectedSpaceId: "",
      handoff: undefined,
      panel: "closed",
      mode: "ask",
      query: "",
      context: [],
      conversations: [],
      conversationsLoading: false,
    });
    usePersonalAgentsStore.setState({ accountId: "account", agents: [], selected: {} });
    workspace.openDestination.mockClear();
    workspace.updateViewRoute.mockClear();
    windowMocks.getByLabel.mockReset();
    windowMocks.getCurrentWindow.mockReset().mockReturnValue({
      label: "main",
      listen: vi.fn(),
    });
    (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {
      invoke: vi.fn(),
    };
  });

  afterEach(() => {
    delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  });

  it("opens the Agents page without throwing when desktop companion window is unavailable", async () => {
    windowMocks.getByLabel.mockResolvedValue(null);

    await expect(openMisty({ prompt: "What is the status of my tasks?" })).resolves.toBeUndefined();

    expect(openedRoute()).toBe("/agents");
    expect(useMistyStore.getState().query).toBe("What is the status of my tasks?");
  });

  it("keeps handoffs in-app even if a legacy companion window exists", async () => {
    const companion = { emit: vi.fn(), show: vi.fn() };
    windowMocks.getByLabel.mockResolvedValue(companion);
    await openMisty({
      prompt: "Hello Misty",
      context: [{ kind: "file", id: "file-1", title: "Notes", source: "local" }],
    });
    expect(windowMocks.getByLabel).not.toHaveBeenCalled();
    expect(companion.emit).not.toHaveBeenCalled();
    expect(openedRoute()).toBe("/agents");
    expect(useMistyStore.getState().query).toBe("Hello Misty");
    expect(useMistyStore.getState().context).toEqual([
      { kind: "file", id: "file-1", title: "Notes", source: "local" },
    ]);
  });

  it("opens the Agents page directly when running outside Tauri", async () => {
    delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;

    await openMisty({ prompt: "Web prompt" });

    expect(openedRoute()).toBe("/agents");
    expect(useMistyStore.getState().query).toBe("Web prompt");
  });

  const conversation = (id = "conversation", agentId = "agent") =>
    ({
      id,
      agentId,
      title: "Research",
      spaceId: "historical-space",
      createdAt: "2026-10-02",
      updatedAt: "2026-10-02",
      messages: [],
      remote: true,
    }) as GlobalAiConversation;

  it("reopens the running conversation without replacing its context or invocation", async () => {
    const handoff = { paneId: "files-pane", prompt: "Organize" };
    useMistyStore.setState({
      working: true,
      invocationId: "invocation",
      selectedAgentId: "agent",
      activeConversationId: "conversation",
      conversations: [conversation()],
      handoff,
    });
    await openMisty();
    expect(openedRoute()).toBe("/agents?agent=agent&conversation=conversation");
    expect(useMistyStore.getState()).toMatchObject({
      working: true,
      invocationId: "invocation",
      activeConversationId: "conversation",
      handoff,
    });
    await expect(openMisty({ agentId: "different" })).rejects.toThrow(/current response/);
  });

  it("attaches a different Space without creating or retargeting the conversation", async () => {
    useMistyStore.setState({
      activeConversationId: "conversation",
      conversations: [conversation()],
    });
    await openMisty({ spaceId: "another-space", context: [] });
    expect(useMistyStore.getState().activeConversationId).toBe("conversation");
    expect(useMistyStore.getState().conversations).toHaveLength(1);
    await openMisty({ conversationId: "conversation" });
    expect(useMistyStore.getState().activeConversationId).toBe("conversation");
  });

  it("does not overwrite a pending draft or its context when opening the panel", async () => {
    const handoff = { paneId: "selected-files" };
    useMistyStore.setState({ query: "Unsent", handoff });
    await openMisty();
    expect(useMistyStore.getState()).toMatchObject({ query: "Unsent", handoff });
    await expect(openMisty({ prompt: "Replace draft" })).rejects.toThrow(/current draft/);
    expect(useMistyStore.getState().query).toBe("Unsent");
  });

  it("reuses the most recent conversation for the requested agent", async () => {
    usePersonalAgentsStore.setState({ agents: [{ id: "agent", enabled: true }] as never });
    useMistyStore.setState({ conversations: [conversation()] });
    await openMisty({ agentId: "agent" });
    expect(useMistyStore.getState()).toMatchObject({
      activeConversationId: "conversation",
      selectedAgentId: "agent",
    });
  });

  it("does not commit an agent handoff after an account switch during loading", async () => {
    const load = vi
      .spyOn(usePersonalAgentsStore.getState(), "load")
      .mockImplementation(async () => {
        useMistyStore.setState({ accountId: "other", selectedAgentId: undefined });
      });
    await expect(openMisty({ agentId: "agent" })).rejects.toThrow(/account changed/);
    expect(useMistyStore.getState().selectedAgentId).toBeUndefined();
    load.mockRestore();
  });
});

it("restores a pending review and keeps it bound to its saved conversation", async () => {
  const artifact = { id: "proposal", kind: "file_plan", state: "proposed" } as AiArtifact;
  const base = {
    agentId: "agent",
    title: "Folder task",
    createdAt: "2026-10-02",
    updatedAt: "2026-10-02",
    remote: true,
  };
  const conversations = [
    {
      ...base,
      id: "files",
      messages: [
        { id: "reply", role: "assistant", content: "Review", state: "completed", artifact },
      ],
    },
    { ...base, id: "other", messages: [] },
  ] as GlobalAiConversation[];
  const request = vi.spyOn(globalMistyApi, "conversations").mockResolvedValue({ conversations });
  useMistyStore.setState({
    accountId: "owner",
    activeConversationId: "files",
    working: false,
    conversations: [],
    selectedAgentId: "agent",
  });
  await useMistyStore.getState().loadConversations();
  expect(useMistyStore.getState()).toMatchObject({
    pendingArtifact: artifact,
    artifactConversationId: "files",
  });
  useMistyStore.getState().selectConversation("other");
  expect(useMistyStore.getState().pendingArtifact).toBeUndefined();
  useMistyStore.getState().selectConversation("files");
  expect(useMistyStore.getState().pendingArtifact?.id).toBe("proposal");
  request.mockRestore();
});
