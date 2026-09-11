import { assertMistyAvailable } from "@/features/misty/availability";
import { initializeHostAgentsRuntime } from "@/features/agents/hostAgentsRuntime";
import { useMistyStore } from "@/features/misty/useMistyStore";
import { useGlobalSearchStore } from "./useGlobalSearchStore";
vi.mock("@/features/misty/availability", () => ({
  assertMistyAvailable: vi.fn(async () => {}),
  currentMistySpace: () => "work",
}));
vi.mock("@/features/misty/contextBridge", () => ({
  requestHostContext: vi.fn(async () => ({ context: [] })),
}));
import { aiSurfaceApi } from "@/features/ai-surface";
import { useSpacesStore } from "@/features/spaces";
import { globalMistyApi } from "./globalMistyApi";
import { beforeEach, describe, expect, it } from "vitest";
import { vi } from "vitest";

initializeHostAgentsRuntime();

describe("Global Misty state", () => {
  beforeEach(() => {
    window.localStorage.clear();
    useMistyStore.getState().setAccount("");
    useMistyStore.setState({
      panel: "closed",
      working: false,
      context: [],
      handoff: undefined,
      targets: [],
      captureEnabled: false,
    });
    useSpacesStore.setState({ spaces: [] });
  });

  it("keeps Search independent of Misty's draft and conversation mode", () => {
    useGlobalSearchStore.getState().setAccount("account-a");
    useGlobalSearchStore.getState().setMode("ask");
    useMistyStore.getState().setAccount("account-a");
    useMistyStore.getState().setQuery("private draft");
    useGlobalSearchStore.getState().setQuery("file query");
    expect(useGlobalSearchStore.getState().mode).toBe("search");
    expect(useMistyStore.getState().query).toBe("private draft");
  });

  it("preserves the draft and prevents model work when Agents admission fails", async () => {
    const create = vi.spyOn(aiSurfaceApi, "createInvocation");
    vi.mocked(assertMistyAvailable).mockRejectedValueOnce(new Error("Agents unavailable"));
    useMistyStore.setState({ accountId: "account-a", query: "keep this draft", working: false });
    await useMistyStore.getState().submitAnswer("keep this draft");
    expect(create).not.toHaveBeenCalled();
    expect(useMistyStore.getState()).toMatchObject({
      query: "keep this draft",
      working: false,
      error: "Agents unavailable",
    });
  });

  it("keeps an explicit selection handoff when the focused view changes", async () => {
    const create = vi
      .spyOn(aiSurfaceApi, "createInvocation")
      .mockRejectedValueOnce(new Error("stop after admission"));
    const selected = {
      kind: "text" as const,
      content: "selected source",
      contentHash: "revision-1",
      object: { kind: "note", id: "source", spaceId: "work" },
    };
    useMistyStore.setState({
      accountId: "account-a",
      activeConversationId: "conversation-a",
      conversations: [
        {
          id: "conversation-a",
          title: "Misty",
          spaceId: "work",
          createdAt: "2026-09-10",
          updatedAt: "2026-09-10",
          messages: [],
          remote: true,
        },
      ],
      context: [],
      handoff: {
        spaceId: "work",
        selection: selected,
        context: [
          {
            id: "source",
            kind: "note",
            title: "Source",
            attached: true,
            spaceId: "work",
            source: "current",
            privacy: "private",
          },
        ],
      },
    });
    await useMistyStore.getState().submitAnswer("Explain this");
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        selection: selected,
        context: expect.arrayContaining([expect.objectContaining({ id: "source" })]),
      }),
    );
  });

  it("collapses without canceling background work", () => {
    useMistyStore.setState({ panel: "results", working: true });
    useMistyStore.getState().closePanel();
    expect(useMistyStore.getState()).toMatchObject({ panel: "closed", working: true });
  });

  it("does not install a pending browser conversation into a different account", async () => {
    let finish!: (value: Awaited<ReturnType<typeof globalMistyApi.createConversation>>) => void;
    const create = vi.spyOn(globalMistyApi, "createConversation").mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    useMistyStore.getState().setAccount("account-a");
    const pending = useMistyStore.getState().newConversation("family");
    useMistyStore.getState().setAccount("account-b");
    const current = useMistyStore.getState();
    finish({
      id: "old-account-conversation",
      title: "Ask",
      spaceId: "family",
      createdAt: "2026-09-08T00:00:00Z",
      updatedAt: "2026-09-08T00:00:00Z",
      messages: [],
      remote: true,
    });
    await pending;
    expect(useMistyStore.getState().conversations).toEqual(current.conversations);
    expect(useMistyStore.getState().activeConversationId).toBe(current.activeConversationId);
    create.mockRestore();
  });

  it("never rewrites the user's query while normalizing a search term", async () => {
    useMistyStore.getState().setAccount("account-a");
    useMistyStore.getState().setQuery("a ");

    await useMistyStore.getState().search("a ");

    expect(useMistyStore.getState().query).toBe("a ");
  });

  it("invalidates an in-flight search as soon as the user types again", () => {
    const before = useMistyStore.getState().requestId;

    useMistyStore.getState().setQuery("newer query");

    expect(useMistyStore.getState().requestId).toBe(before + 1);
  });

  it("keeps Agent workspace answers out of the global Search panel", async () => {
    const createInvocation = vi
      .spyOn(aiSurfaceApi, "createInvocation")
      .mockRejectedValueOnce(new Error("stop after presentation state"));
    useMistyStore.setState({
      accountId: "account-a",
      panel: "closed",
      activeConversationId: "conversation-a",
      conversations: [
        {
          id: "conversation-a",
          title: "Misty",
          spaceId: "work",
          createdAt: "2026-08-25T00:00:00.000Z",
          updatedAt: "2026-08-25T00:00:00.000Z",
          messages: [],
          remote: true,
        },
      ],
    });

    await useMistyStore.getState().submitAnswer("hello", undefined, undefined, "workspace");

    expect(useMistyStore.getState().panel).toBe("closed");
    expect(useMistyStore.getState().conversations[0]?.messages[0]?.content).toBe("hello");
    createInvocation.mockRestore();
  });

  it("uses the originating conversation after workspace preparation changes the active view", async () => {
    const createInvocation = vi
      .spyOn(aiSurfaceApi, "createInvocation")
      .mockRejectedValueOnce(new Error("stop after admission"));
    const base = {
      title: "Ask",
      createdAt: "2026-09-08T00:00:00Z",
      updatedAt: "2026-09-08T00:00:00Z",
      messages: [],
      remote: true,
    };
    useMistyStore.setState({
      accountId: "account-a",
      working: false,
      activeConversationId: "other",
      conversations: [
        { ...base, id: "origin", spaceId: "work" },
        { ...base, id: "other", spaceId: "family" },
      ],
      context: [],
    });
    await useMistyStore.getState().submitAnswer("Create a task", [], undefined, "workspace", [], {
      conversationId: "origin",
      context: [],
    });
    expect(createInvocation).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: "origin" }),
    );
    expect(
      useMistyStore.getState().conversations.find((item) => item.id === "other")?.messages,
    ).toEqual([]);
  });

  it("does not retarget a global Ask follow-up based on old message text", async () => {
    useSpacesStore.setState({
      spaces: [
        {
          id: "family-space",
          name: "Family",
          kind: "workspace",
        } as never,
      ],
    });
    const bindConversation = vi
      .spyOn(globalMistyApi, "bindConversationSpace")
      .mockResolvedValue({ id: "conversation-a", spaceId: "family-space" });
    const createInvocation = vi
      .spyOn(aiSurfaceApi, "createInvocation")
      .mockRejectedValueOnce(new Error("stop after binding"));
    useMistyStore.setState({
      accountId: "account-a",
      panel: "answer",
      activeConversationId: "conversation-a",
      conversations: [
        {
          id: "conversation-a",
          title: "hello",
          spaceId: "work",
          createdAt: "2026-08-25T00:00:00.000Z",
          updatedAt: "2026-08-25T00:00:00.000Z",
          messages: [
            {
              id: "message-a",
              role: "user",
              mode: "ask",
              content: "how many people are currently in family space?",
              createdAt: "2026-08-25T00:00:00.000Z",
              state: "completed",
            },
          ],
          remote: true,
        },
      ],
    });

    await useMistyStore.getState().submitAnswer("can you check again");

    expect(bindConversation).not.toHaveBeenCalled();
    expect(createInvocation).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: "conversation-a" }),
    );
    expect(useMistyStore.getState().conversations[0]?.spaceId).toBe("work");
    bindConversation.mockRestore();
    createInvocation.mockRestore();
  });

  it("keeps Agent workspace tasks out of the global Search panel", async () => {
    const createRun = vi
      .spyOn(aiSurfaceApi, "createInvocation")
      .mockRejectedValueOnce(new Error("stop after presentation state"));
    useMistyStore.setState({
      accountId: "account-a",
      panel: "closed",
      activeConversationId: "conversation-a",
      conversations: [
        {
          id: "conversation-a",
          title: "Misty",
          spaceId: "work",
          createdAt: "2026-08-25T00:00:00.000Z",
          updatedAt: "2026-08-25T00:00:00.000Z",
          messages: [],
          remote: true,
        },
      ],
    });

    await useMistyStore.getState().submitAgentTask("draw a diagram", "agents", "workspace");

    expect(useMistyStore.getState().panel).toBe("closed");
    expect(useMistyStore.getState().conversations[0]?.messages[0]?.content).toBe("draw a diagram");
    createRun.mockRestore();
  });

  it("deduplicates context by its semantic destination", () => {
    useMistyStore.getState().setContext([
      {
        id: "route:/spaces/space-1/chat",
        kind: "route",
        title: "Current Space view",
        href: "/spaces/space-1/chat",
        source: "current",
        spaceId: "space-1",
      },
      {
        id: "route:/spaces/space-1/planner",
        kind: "route",
        title: "Current Space view",
        href: "/spaces/space-1/planner",
        source: "current",
        spaceId: "space-1",
      },
      {
        id: "file-one",
        kind: "file",
        title: "Plan.md",
        source: "current",
        localPath: "/tmp/Plan.md",
      },
      {
        id: "file-two",
        kind: "file",
        title: "Plan.md",
        source: "current",
        localPath: "/tmp/Plan.md",
      },
    ]);

    expect(useMistyStore.getState().context).toHaveLength(2);
  });
});
