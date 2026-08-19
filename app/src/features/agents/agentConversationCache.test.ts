import { beforeEach, describe, expect, it, vi } from "vitest";
import { spacesApi } from "@/api/spaces/api";
import {
  cachedAgentConversation,
  clearAgentConversationCache,
  invalidateAgentConversation,
  loadAgentConversation,
  mergeCachedAgentConversationMessages,
} from "./agentConversationCache";

vi.mock("@/api/spaces/api", () => ({
  spacesApi: {
    directAgentConversation: vi.fn(),
    conversationMessages: vi.fn(),
  },
}));

describe("agent conversation cache", () => {
  beforeEach(() => {
    clearAgentConversationCache();
    vi.clearAllMocks();
    vi.mocked(spacesApi.directAgentConversation).mockResolvedValue({
      id: "conversation-1",
    } as never);
    vi.mocked(spacesApi.conversationMessages).mockResolvedValue({ messages: [] });
  });

  it("deduplicates concurrent mounts and does not reopen a known direct conversation", async () => {
    await Promise.all([
      loadAgentConversation("space-1", "agent-1"),
      loadAgentConversation("space-1", "agent-1"),
      loadAgentConversation("space-1", "agent-1"),
    ]);
    expect(spacesApi.directAgentConversation).toHaveBeenCalledOnce();
    expect(spacesApi.conversationMessages).toHaveBeenCalledOnce();

    invalidateAgentConversation("space-1", "agent-1");
    await loadAgentConversation("space-1", "agent-1", { force: true });
    expect(spacesApi.directAgentConversation).toHaveBeenCalledOnce();
    expect(spacesApi.conversationMessages).toHaveBeenCalledTimes(2);
  });

  it("keeps different Space conversations isolated", async () => {
    await Promise.all([
      loadAgentConversation("space-1", "agent-1"),
      loadAgentConversation("space-2", "agent-1"),
    ]);
    expect(spacesApi.directAgentConversation).toHaveBeenCalledTimes(2);
  });

  it("lets a forced refresh supersede an older in-flight response", async () => {
    let resolveStale!: (value: { messages: never[] }) => void;
    vi.mocked(spacesApi.conversationMessages)
      .mockImplementationOnce(
        () => new Promise((resolve) => (resolveStale = resolve as typeof resolveStale)),
      )
      .mockResolvedValueOnce({
        messages: [{ id: "message-new", seq: 2, content: [] } as never],
      });

    const stale = loadAgentConversation("space-1", "agent-1");
    await vi.waitFor(() => expect(spacesApi.conversationMessages).toHaveBeenCalledOnce());
    const fresh = loadAgentConversation("space-1", "agent-1", { force: true });
    await expect(fresh).resolves.toMatchObject({ messages: [{ id: "message-new" }] });
    resolveStale({ messages: [] });
    await stale;

    expect(cachedAgentConversation("space-1", "agent-1")?.messages).toMatchObject([
      { id: "message-new" },
    ]);
  });

  it("keeps optimistic messages in the shared conversation cache", async () => {
    await loadAgentConversation("space-1", "agent-1");
    mergeCachedAgentConversationMessages("space-1", "agent-1", [
      {
        id: "optimistic-1",
        seq: 1,
        client_nonce: "nonce-1",
        local_delivery_state: "sending",
        content: [{ type: "text", text: "Hello" }],
      } as never,
    ]);
    expect(cachedAgentConversation("space-1", "agent-1")?.messages).toMatchObject([
      { id: "optimistic-1", local_delivery_state: "sending" },
    ]);
  });
});
