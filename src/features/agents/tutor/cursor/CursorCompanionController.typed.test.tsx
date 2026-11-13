import "./CompanionController.testFixtures";
import { act, render, waitFor } from "@testing-library/react";
import { expect, it } from "vitest";
import { mocks, mounted } from "./CompanionController.testFixtures";
import { useCompanionState } from "./companionState";
import { CursorCompanionController } from "./CursorCompanionController";
it("ignores a stale native Stop and stops only the matching task", async () => {
  const view = await mounted();
  await act(async () => {
    mocks.listeners.get("misty://desktop-control-stopped")?.({
      payload: { taskId: "old-task", reason: "Old stop" },
    });
  });
  expect(mocks.pause).not.toHaveBeenCalled();
  expect(useCompanionState.getState().presentation.error).not.toBe("Old stop");
  await act(async () => {
    mocks.listeners.get("misty://desktop-control-stopped")?.({
      payload: { taskId: "desktop-task", reason: "Stopped with Escape" },
    });
  });
  expect(mocks.pause).toHaveBeenCalledWith("desktop-task");
  expect(useCompanionState.getState().presentation.error).toBe("Stopped with Escape");
  view.unmount();
});
it("restores Ask only when explicitly enabled for this account", async () => {
  localStorage.setItem("misty.cursor-companion:account", JSON.stringify({ ask: true }));
  const view = await mounted();
  expect(useCompanionState.getState().presentation.ask).toBe(true);
  view.unmount();
});

it("sends and completes plain text while the realtime provider is unavailable", async () => {
  mocks.conversationCommit.mockRejectedValue(
    new Error("The realtime voice provider is unavailable"),
  );
  mocks.speech.mockRejectedValue(new Error("The realtime voice provider is unavailable"));
  mocks.submit.mockImplementation(async () => {
    mocks.state.invocationId = "text-task";
    mocks.state.working = true;
  });
  const view = await mounted();
  await act(async () =>
    useCompanionState.getState().submit!({
      prompt: "How are you?",
      conversationId: "conversation",
    }),
  );
  expect(mocks.submit).toHaveBeenCalledWith(
    "How are you?",
    [],
    undefined,
    [],
    { conversationId: "conversation", context: [] },
    expect.objectContaining({ executionMode: "user" }),
  );
  expect(mocks.conversationOpen).not.toHaveBeenCalled();
  expect(mocks.conversationCommit).not.toHaveBeenCalled();
  expect(mocks.invoke.mock.calls.some(([name]) => name === "cursor_companion_capture")).toBe(true);
  await act(async () => {
    mocks.state.working = false;
    mocks.state.conversations = [
      {
        id: "conversation",
        messages: [{ role: "assistant", state: "completed", content: "Ready to help." }],
      },
    ];
    mocks.subscribers.forEach((notify) => notify());
  });
  expect(useCompanionState.getState().presentation).toMatchObject({
    phase: "idle",
    error: undefined,
  });
  expect(mocks.state.error).toBeNull();
  expect(mocks.state.conversations).toEqual([
    expect.objectContaining({ messages: [expect.objectContaining({ content: "Ready to help." })] }),
  ]);
  expect(mocks.speech).not.toHaveBeenCalled();
  expect(mocks.conversationOpen).not.toHaveBeenCalled();
  view.unmount();
});

it.each(["user", "agent"] as const)(
  "sends typed web work unchanged in user mode after a %s task",
  async (previous) => {
    mocks.state.executionMode = previous;
    mocks.submit.mockImplementation(async () => {
      mocks.state.invocationId = "browser-task";
      mocks.state.working = true;
    });
    const view = await mounted();
    await act(async () =>
      useCompanionState.getState().submit!({
        prompt: "can you open instagram on the browser, find a person called Stone",
        conversationId: "conversation",
      }),
    );
    // The screens go with the request; the task opens a browser only if it must act.
    expect(mocks.submit).toHaveBeenCalledWith(
      expect.stringContaining("open instagram"),
      [],
      undefined,
      [],
      { conversationId: "conversation", context: [] },
      expect.objectContaining({ executionMode: "user" }),
    );
    expect(mocks.conversationOpen).not.toHaveBeenCalled();
    expect(mocks.invoke.mock.calls.some(([name]) => name === "cursor_companion_capture")).toBe(
      true,
    );
    view.unmount();
  },
);

it("sends a typed screen question with the screens", async () => {
  mocks.submit.mockImplementation(async () => {
    mocks.state.invocationId = "screen-task";
    mocks.state.working = true;
  });
  const view = await mounted();
  await act(async () =>
    useCompanionState.getState().submit!({
      prompt: "Explain my screen",
      conversationId: "conversation",
    }),
  );
  expect(mocks.invoke).toHaveBeenCalledWith("cursor_companion_capture", expect.anything());
  expect(mocks.submit).toHaveBeenCalledOnce();
  expect(mocks.conversationOpen).not.toHaveBeenCalled();
  view.unmount();
});

it("admits ordinary text even when the native companion fails to start", async () => {
  const native = mocks.invoke.getMockImplementation()!;
  mocks.invoke.mockImplementation((name, args) =>
    name === "cursor_companion_configure"
      ? Promise.reject(new Error("Native overlay failed"))
      : native(name, args),
  );
  mocks.submit.mockImplementation(async () => {
    mocks.state.invocationId = "text-task";
    mocks.state.working = true;
  });
  const view = render(<CursorCompanionController accountId="account" />);
  await waitFor(() =>
    expect(useCompanionState.getState().presentation.error).toBe("Native overlay failed"),
  );
  await act(async () =>
    useCompanionState.getState().submit!({
      prompt: "Hello",
      conversationId: "conversation",
    }),
  );
  expect(mocks.submit).toHaveBeenCalledOnce();
  expect(mocks.conversationOpen).not.toHaveBeenCalled();
  view.unmount();
});

it("rejects a stale typed conversation before capturing or admitting work", async () => {
  const view = await mounted();
  await expect(
    useCompanionState.getState().submit!({
      prompt: "Hello",
      conversationId: "previous-conversation",
    }),
  ).rejects.toThrow("conversation changed");
  expect(mocks.submit).not.toHaveBeenCalled();
  expect(mocks.conversationOpen).not.toHaveBeenCalled();
  expect(mocks.invoke.mock.calls.some(([name]) => name === "cursor_companion_capture")).toBe(false);
  view.unmount();
});
