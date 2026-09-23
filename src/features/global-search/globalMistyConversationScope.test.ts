import { expect, it, vi } from "vitest";
import type { GlobalSearchState } from "./globalSearchState";
import { conversationForGlobalPrompt } from "./globalMistyConversationScope";
vi.mock("@/features/agents/personalAgentsStore", () => ({
  usePersonalAgentsStore: { getState: () => ({ agents: [] }) },
}));
function fixture() {
  const newConversation = vi.fn(async () => "new");
  const state = {
    activeConversationId: "",
    conversations: [],
    context: [],
    newConversation,
  } as unknown as GlobalSearchState;
  return { state, newConversation };
}
it("starts personal work regardless of Space names mentioned in the prompt", async () => {
  const f = fixture();
  await conversationForGlobalPrompt(() => f.state, "Work in Family Space");
  expect(f.newConversation).toHaveBeenCalledExactlyOnceWith();
});
it("preserves an explicitly reopened historical conversation without retargeting it", async () => {
  const f = fixture();
  f.state.activeConversationId = "old";
  f.state.conversations = [
    { id: "old", spaceId: "history", agentId: "agent" },
  ] as GlobalSearchState["conversations"];
  expect(await conversationForGlobalPrompt(() => f.state, "Switch to Work Space")).toBe("old");
  expect(f.newConversation).not.toHaveBeenCalled();
  f.state.selectedAgentId = "another-agent";
  expect(await conversationForGlobalPrompt(() => f.state, "Continue")).toBe("new");
});
it("rejects historical content from a different conversation", async () => {
  const f = fixture();
  f.state.activeConversationId = "old";
  f.state.conversations = [{ id: "old", spaceId: "history" }] as GlobalSearchState["conversations"];
  f.state.context = [
    { id: "doc", kind: "note", title: "Note", source: "current", spaceId: "other" },
  ];
  await expect(conversationForGlobalPrompt(() => f.state, "Summarize")).rejects.toThrow(
    /another conversation/,
  );
});
