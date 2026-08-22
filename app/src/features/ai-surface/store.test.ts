import { beforeEach, describe, expect, it } from "vitest";
import { useAiSurfaceStore } from "./store";

describe("AI surface pane isolation", () => {
  beforeEach(() => useAiSurfaceStore.setState({ sessions: {} }));

  it("keeps drawer state isolated by account and pane", () => {
    const store = useAiSurfaceStore.getState();
    store.setOpen("account-a", "pane-a", true);
    store.setPrompt("account-a", "pane-a", "private prompt");
    store.setOpen("account-a", "pane-b", true);
    expect(useAiSurfaceStore.getState().sessions["account-a:pane-a"]?.prompt).toBe(
      "private prompt",
    );
    expect(useAiSurfaceStore.getState().sessions["account-a:pane-b"]?.prompt).toBe("");
    expect(useAiSurfaceStore.getState().sessions["account-b:pane-a"]).toBeUndefined();
  });

  it("drops a conversation when context crosses a privacy boundary", () => {
    useAiSurfaceStore.setState({
      sessions: {
        "account-a:pane-a": {
          accountId: "account-a",
          paneId: "pane-a",
          open: true,
          prompt: "carry this",
          conversationId: "private-conversation",
          state: "idle",
          contextBoundary: "private",
          messages: [
            {
              id: "message",
              role: "user",
              content: "secret",
              createdAt: new Date(0).toISOString(),
              citations: [],
              artifacts: [],
            },
          ],
        },
      },
    });
    useAiSurfaceStore.getState().setContextBoundary("account-a", "pane-a", "shared:space-a");
    expect(useAiSurfaceStore.getState().sessions["account-a:pane-a"]).toMatchObject({
      contextBoundary: "shared:space-a",
      prompt: "",
      messages: [],
    });
    expect(
      useAiSurfaceStore.getState().sessions["account-a:pane-a"]?.conversationId,
    ).toBeUndefined();
  });
});
