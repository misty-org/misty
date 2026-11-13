import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GlobalAiConversation } from "../state/conversationTypes";
import type * as TurnFiles from "../../checkpoints/turnFiles";

const files = vi.hoisted(() => ({ plan: vi.fn(), restore: vi.fn() }));
const store = vi.hoisted(() => ({
  working: false,
  rewindConversation: vi.fn(),
  setMessageLedger: vi.fn(),
}));
vi.mock("../../checkpoints/turnFiles", async (original) => ({
  ...(await original<typeof TurnFiles>()),
  rewindFiles: files.plan,
  restoreTurnFiles: files.restore,
}));
vi.mock("../state/useMistyStore", () => ({ useMistyStore: { getState: () => store } }));

import { useConversationTurnActions } from "./useConversationTurnActions";

const conversation = {
  id: "chat",
  messages: [
    { id: "u1", role: "user", mode: "ask", content: "Fix it", createdAt: "" },
    {
      id: "a1",
      role: "assistant",
      mode: "ask",
      content: "Done",
      createdAt: "",
      invocationId: "run-1",
    },
  ],
} as unknown as GlobalAiConversation;

const plan = {
  incomplete: false,
  folders: [
    {
      folder: "/work",
      files: [
        { path: "a.ts", change: "restore", changedByYou: false },
        { path: "b.ts", change: "restore", changedByYou: true },
      ],
    },
  ],
};

function setup() {
  const send = vi.fn();
  const view = renderHook(() => useConversationTurnActions(conversation, send));
  return { send, view };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  store.working = false;
});

describe("retrying past turns that changed files", () => {
  it("sends nothing and keeps the chat when the person cancels", async () => {
    files.plan.mockResolvedValue(plan);
    const { send, view } = setup();
    act(() => view.result.current.retryPrompt("Fix it", "u1"));
    await waitFor(() => expect(view.result.current.filesAsk).toEqual(plan));
    act(() => view.result.current.chooseFiles({ kind: "cancel" }));
    await Promise.resolve();
    expect(files.plan).toHaveBeenCalledWith(["run-1"]);
    expect(files.restore).not.toHaveBeenCalled();
    expect(store.rewindConversation).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    expect(view.result.current.filesAsk).toBeNull();
  });

  it("puts back only the files the person chose, then sends again", async () => {
    files.plan.mockResolvedValue(plan);
    files.restore.mockResolvedValue({ restored: 1, failed: [] });
    const { send, view } = setup();
    act(() => view.result.current.retryPrompt("Fix it", "u1"));
    await waitFor(() => expect(view.result.current.filesAsk).not.toBeNull());
    act(() =>
      view.result.current.chooseFiles({
        kind: "restore",
        files: [{ folder: "/work", path: "a.ts" }],
      }),
    );
    await waitFor(() => expect(send).toHaveBeenCalledWith("Fix it", false));
    expect(files.restore).toHaveBeenCalledWith(["run-1"], [{ folder: "/work", path: "a.ts" }]);
    expect(store.rewindConversation).toHaveBeenCalledWith("chat", "u1");
  });

  it("can keep the files and still go back", async () => {
    files.plan.mockResolvedValue(plan);
    const { send, view } = setup();
    act(() => view.result.current.retryPrompt("Fix it", "u1"));
    await waitFor(() => expect(view.result.current.filesAsk).not.toBeNull());
    act(() => view.result.current.chooseFiles({ kind: "keep" }));
    await waitFor(() => expect(send).toHaveBeenCalled());
    expect(files.restore).not.toHaveBeenCalled();
    expect(store.rewindConversation).toHaveBeenCalledWith("chat", "u1");
  });

  it("asks nothing when the removed turns changed no files", async () => {
    files.plan.mockResolvedValue({ incomplete: false, folders: [] });
    const { send, view } = setup();
    act(() => view.result.current.retryPrompt("Fix it", "u1"));
    await waitFor(() => expect(send).toHaveBeenCalled());
    expect(view.result.current.filesAsk).toBeNull();
    expect(store.rewindConversation).toHaveBeenCalledWith("chat", "u1");
  });

  it("stops before sending when the files can't be put back", async () => {
    files.plan.mockResolvedValue(plan);
    files.restore.mockRejectedValue(new Error("Misty isn't ready yet."));
    const send = vi.fn();
    const reportError = vi.fn();
    const view = renderHook(() => useConversationTurnActions(conversation, send, reportError));
    act(() => view.result.current.retryPrompt("Fix it", "u1"));
    await waitFor(() => expect(view.result.current.filesAsk).not.toBeNull());
    act(() =>
      view.result.current.chooseFiles({
        kind: "restore",
        files: [{ folder: "/work", path: "a.ts" }],
      }),
    );
    await waitFor(() => expect(reportError).toHaveBeenCalledWith("Misty isn't ready yet."));
    expect(send).not.toHaveBeenCalled();
    expect(store.rewindConversation).not.toHaveBeenCalled();
  });
});
