import { describe, expect, it, vi } from "vitest";
import type { GlobalSearchState } from "./globalSearchState";
import { conversationForGlobalPrompt } from "./globalMistyConversationScope";

vi.mock("@/features/agents/agentsRuntime", () => ({
  useAgentsSpaces: { getState: () => ({ spaces: [
    { id: "work", name: "Work" }, { id: "family", name: "Family" },
  ] }) },
}));

function fixture(spaceId?: string, contextSpace?: string) {
  const newConversation = vi.fn(async () => "new");
  const bindConversationSpace = vi.fn(async () => undefined);
  const state = {
    activeConversationId: spaceId ? "existing" : undefined,
    conversations: spaceId ? [{ id: "existing", spaceId, messages: [] }] : [],
    context: contextSpace ? [{ kind: "route", spaceId: contextSpace }] : [],
    newConversation, bindConversationSpace,
  } as unknown as GlobalSearchState;
  return { state, newConversation, bindConversationSpace };
}

describe("global Ask Space capture", () => {
  it("does not pick the first accessible Space when context is absent", async () => {
    const f = fixture();
    await conversationForGlobalPrompt(() => f.state, "Help me plan");
    expect(f.newConversation).toHaveBeenCalledWith(undefined);
  });
  it("starts separate work when the originating Space differs from the old conversation", async () => {
    const f = fixture("work", "family");
    await conversationForGlobalPrompt(() => f.state, "Create a task");
    expect(f.newConversation).toHaveBeenCalledWith("family");
  });
  it("resolves an explicitly requested accessible Space", async () => {
    const f = fixture("work", "work");
    await conversationForGlobalPrompt(() => f.state, "Work in Family Space");
    expect(f.newConversation).toHaveBeenCalledWith("family");
  });
  it("does not interpret an incidental name as permission to retarget", async () => {
    const f = fixture("work", "work");
    expect(await conversationForGlobalPrompt(() => f.state, "Email my family")).toBe("existing");
    expect(f.newConversation).not.toHaveBeenCalled();
  });
  it("rejects mixed originating Spaces", async () => {
    const f = fixture("work", "work");
    f.state.context.push({ kind: "route", id: "family", title: "Family", spaceId: "family", source: "current" });
    await expect(conversationForGlobalPrompt(() => f.state, "Create a task")).rejects.toThrow("Choose one Space");
  });
  it("captures the origin before asynchronous conversation creation", async () => {
    const f = fixture(undefined, "work");
    let finish!: (id: string) => void;
    f.newConversation.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const pending = conversationForGlobalPrompt(() => f.state, "Create a task");
    f.state.context[0].spaceId = "family";
    finish("created-in-work");
    expect(await pending).toBe("created-in-work");
    expect(f.newConversation).toHaveBeenCalledWith("work");
  });
});
