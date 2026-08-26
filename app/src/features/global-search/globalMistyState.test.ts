import { useGlobalSearchStore } from "@/features/global-search";
import { aiSurfaceApi } from "@/features/ai-surface";
import { useSpacesStore } from "@/features/spaces";
import { globalMistyApi } from "./globalMistyApi";
import { beforeEach, describe, expect, it } from "vitest";
import { vi } from "vitest";

describe("Global Misty state", () => {
  beforeEach(() => {
    window.localStorage.clear();
    useGlobalSearchStore.getState().setAccount("");
    useGlobalSearchStore.setState({ panel: "closed", working: false });
    useSpacesStore.setState({ spaces: [] });
  });

  it("remembers the last mode independently for each account", () => {
    useGlobalSearchStore.getState().setAccount("account-a");
    useGlobalSearchStore.getState().setMode("action");
    useGlobalSearchStore.getState().setAccount("account-b");
    expect(useGlobalSearchStore.getState().mode).toBe("search");

    useGlobalSearchStore.getState().setAccount("account-a");
    expect(useGlobalSearchStore.getState().mode).toBe("action");
  });

  it("collapses without canceling background work", () => {
    useGlobalSearchStore.setState({ panel: "results", working: true });
    useGlobalSearchStore.getState().closePanel();
    expect(useGlobalSearchStore.getState()).toMatchObject({ panel: "closed", working: true });
  });

  it("never rewrites the user's query while normalizing a search term", async () => {
    useGlobalSearchStore.getState().setAccount("account-a");
    useGlobalSearchStore.getState().setQuery("a ");

    await useGlobalSearchStore.getState().search("a ");

    expect(useGlobalSearchStore.getState().query).toBe("a ");
  });

  it("invalidates an in-flight search as soon as the user types again", () => {
    const before = useGlobalSearchStore.getState().requestId;

    useGlobalSearchStore.getState().setQuery("newer query");

    expect(useGlobalSearchStore.getState().requestId).toBe(before + 1);
  });

  it("keeps Agent workspace answers out of the global Search panel", async () => {
    const createInvocation = vi
      .spyOn(aiSurfaceApi, "createInvocation")
      .mockRejectedValueOnce(new Error("stop after presentation state"));
    useGlobalSearchStore.setState({
      accountId: "account-a",
      panel: "closed",
      activeConversationId: "conversation-a",
      conversations: [
        {
          id: "conversation-a",
          title: "Agent chat",
          createdAt: "2026-08-25T00:00:00.000Z",
          updatedAt: "2026-08-25T00:00:00.000Z",
          messages: [],
          remote: true,
        },
      ],
    });

    await useGlobalSearchStore.getState().submitAnswer("hello", undefined, undefined, "workspace");

    expect(useGlobalSearchStore.getState().panel).toBe("closed");
    expect(useGlobalSearchStore.getState().conversations[0]?.messages[0]?.content).toBe("hello");
    createInvocation.mockRestore();
  });

  it("binds a global Ask follow-up from its recent uniquely named Space", async () => {
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
    useGlobalSearchStore.setState({
      accountId: "account-a",
      panel: "answer",
      activeConversationId: "conversation-a",
      conversations: [
        {
          id: "conversation-a",
          title: "hello",
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

    await useGlobalSearchStore.getState().submitAnswer("can you check again");

    expect(bindConversation).toHaveBeenCalledWith("conversation-a", "family-space");
    expect(createInvocation).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: "conversation-a" }),
    );
    expect(useGlobalSearchStore.getState().conversations[0]?.spaceId).toBe("family-space");
    bindConversation.mockRestore();
    createInvocation.mockRestore();
  });

  it("keeps Agent workspace tasks out of the global Search panel", async () => {
    const createRun = vi
      .spyOn(aiSurfaceApi, "createRun")
      .mockRejectedValueOnce(new Error("stop after presentation state"));
    useGlobalSearchStore.setState({
      accountId: "account-a",
      panel: "closed",
      activeConversationId: "conversation-a",
      conversations: [
        {
          id: "conversation-a",
          title: "Agent chat",
          createdAt: "2026-08-25T00:00:00.000Z",
          updatedAt: "2026-08-25T00:00:00.000Z",
          messages: [],
          remote: true,
        },
      ],
    });

    await useGlobalSearchStore.getState().submitAgentTask("draw a diagram", "agents", "workspace");

    expect(useGlobalSearchStore.getState().panel).toBe("closed");
    expect(useGlobalSearchStore.getState().conversations[0]?.messages[0]?.content).toBe(
      "draw a diagram",
    );
    createRun.mockRestore();
  });

  it("deduplicates context by its semantic destination", () => {
    useGlobalSearchStore.getState().setContext([
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

    expect(useGlobalSearchStore.getState().context).toHaveLength(2);
  });
});
