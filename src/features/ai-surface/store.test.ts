import { beforeEach, describe, expect, it } from "vitest";
import { testingConciseSpeech, useAiSurfaceStore } from "./store";
import { consumeInvocationEvent } from "./storeRuntime";
import type { AiSurfaceAdapter } from "./types";

describe("embodied Misty state", () => {
  beforeEach(() =>
    useAiSurfaceStore.setState({
      sessions: {},
      registrations: {},
      companion: { phase: "home", completedCount: 0 },
    }),
  );

  it("keeps drafts isolated by account and pane", () => {
    const store = useAiSurfaceStore.getState();
    store.setPrompt("account-a", "pane-a", "private prompt");
    store.setPrompt("account-a", "pane-b", "another prompt");
    expect(useAiSurfaceStore.getState().sessions["account-a:pane-a"]?.prompt).toBe(
      "private prompt",
    );
    expect(useAiSurfaceStore.getState().sessions["account-a:pane-b"]?.prompt).toBe(
      "another prompt",
    );
    expect(useAiSurfaceStore.getState().sessions["account-b:pane-a"]).toBeUndefined();
  });

  it("summons into composing and returns home without canceling work", () => {
    const element = document.createElement("div");
    document.body.appendChild(element);
    const adapter: AiSurfaceAdapter = {
      surfaceId: "notes",
      label: "Note",
      getContext: () => [],
    };
    const stop = useAiSurfaceStore
      .getState()
      .registerPane({ accountId: "account-a", paneId: "pane-a", adapter, element });
    useAiSurfaceStore.getState().summon("account-a", "pane-a", {
      kind: "pointer",
      paneId: "pane-a",
      x: 20,
      y: 30,
    });
    expect(useAiSurfaceStore.getState().companion).toMatchObject({
      phase: "composing",
      paneId: "pane-a",
    });
    useAiSurfaceStore.getState().returnHome();
    expect(useAiSurfaceStore.getState().companion.phase).toBe("home");
    stop();
    element.remove();
  });

  it("releases Misty into cursor-following mode before opening the composer", () => {
    const element = document.createElement("div");
    document.body.appendChild(element);
    const adapter: AiSurfaceAdapter = {
      surfaceId: "notes",
      label: "Note",
      getContext: () => [],
    };
    const stop = useAiSurfaceStore
      .getState()
      .registerPane({ accountId: "account-a", paneId: "pane-generated", adapter, element });

    useAiSurfaceStore.getState().follow("account-a", "pane-generated", {
      kind: "pointer",
      paneId: "pane-generated",
      x: 20,
      y: 30,
    });

    expect(useAiSurfaceStore.getState().companion).toMatchObject({
      phase: "following",
      accountId: "account-a",
      paneId: "pane-generated",
    });

    useAiSurfaceStore.getState().summon("account-a", "pane-generated");
    expect(useAiSurfaceStore.getState().companion.phase).toBe("composing");
    stop();
    element.remove();
  });

  it("keeps a live surface registration on its newest adapter", () => {
    const element = document.createElement("div");
    const first: AiSurfaceAdapter = {
      surfaceId: "drawings",
      label: "Canvas",
      getContext: () => [{ kind: "drawing", id: "one", title: "Old", privacy: "shared" }],
    };
    const latest: AiSurfaceAdapter = {
      ...first,
      getContext: () => [{ kind: "drawing", id: "one", title: "Live", privacy: "shared" }],
    };
    useAiSurfaceStore
      .getState()
      .registerPane({ accountId: "account-a", paneId: "pane-a", adapter: first, element });

    useAiSurfaceStore.getState().updatePaneAdapter("account-a", "pane-a", latest);

    expect(
      useAiSurfaceStore.getState().registrations["account-a:pane-a"].adapter.getContext()[0].title,
    ).toBe("Live");
  });

  it("keeps an in-flight task bound while Misty is dismissed to the island", () => {
    useAiSurfaceStore.setState({
      companion: {
        phase: "working",
        accountId: "account-a",
        paneId: "pane-a",
        completedCount: 0,
      },
      sessions: {
        "account-a:pane-a": {
          accountId: "account-a",
          paneId: "pane-a",
          prompt: "",
          state: "running",
          interactionOpen: true,
          messages: [],
        },
      },
    });
    useAiSurfaceStore.getState().returnHome();
    expect(useAiSurfaceStore.getState().companion).toMatchObject({
      phase: "home",
      accountId: "account-a",
      paneId: "pane-a",
    });
    expect(useAiSurfaceStore.getState().sessions["account-a:pane-a"]?.interactionOpen).toBe(true);
  });

  it("drops a conversation when context crosses a privacy boundary", () => {
    useAiSurfaceStore.setState({
      companion: {
        phase: "composing",
        accountId: "account-a",
        paneId: "pane-a",
        completedCount: 0,
      },
      sessions: {
        "account-a:pane-a": {
          accountId: "account-a",
          paneId: "pane-a",
          prompt: "carry this",
          conversationId: "private-conversation",
          state: "idle",
          contextBoundary: "private",
          messages: [],
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
    expect(useAiSurfaceStore.getState().companion.phase).toBe("composing");
  });

  it("settles a completed interaction back into persistent following", () => {
    useAiSurfaceStore.setState({
      companion: {
        phase: "speaking",
        accountId: "account-a",
        paneId: "pane-a",
        completedCount: 1,
      },
    });

    useAiSurfaceStore.getState().settle();

    expect(useAiSurfaceStore.getState().companion.phase).toBe("following");
  });

  it("stores a region capture with the originating session", () => {
    const capture = {
      id: "capture-a",
      name: "Selected region",
      mimeType: "image/jpeg" as const,
      dataUrl: "data:image/jpeg;base64,AA==",
      width: 20,
      height: 10,
      contentHash: "abc",
    };

    useAiSurfaceStore.getState().setCapture("account-a", "pane-a", capture);

    expect(useAiSurfaceStore.getState().sessions["account-a:pane-a"]?.capture).toEqual(capture);
  });

  it("keeps spoken summaries compact", () => {
    expect(testingConciseSpeech("x".repeat(300))).toHaveLength(240);
    expect(testingConciseSpeech("**Done**\n\n- first\n- `second`")).toBe("Done first second");
  });

  it("keeps the durable personal-agent run link", () => {
    const adapter: AiSurfaceAdapter = {
      surfaceId: "global",
      label: "Global",
      getContext: () => [],
    };
    consumeInvocationEvent(
      useAiSurfaceStore.setState,
      useAiSurfaceStore.getState,
      "account-a",
      "pane-a",
      adapter,
      { id: "1", type: "run.started", runId: "run-123" },
    );
    expect(useAiSurfaceStore.getState().sessions["account-a:pane-a"]?.runId).toBe("run-123");
  });
});
