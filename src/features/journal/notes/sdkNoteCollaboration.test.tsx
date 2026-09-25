import { StrictMode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { createMistyAppSDK } from "@misty/sdk";
import { createSdkNoteCollaboration, useSdkNoteCollaborationRoom } from "./sdkNoteCollaboration";

const cleanup: Array<() => void> = [];
afterEach(() => {
  cleanup.splice(0).forEach((close) => close());
  vi.useRealTimers();
});
function fixture() {
  const lifetime = new AbortController();
  const handlers = new Map<string, (event: unknown) => void>();
  const request = vi.fn(async (message: { method: string; params?: unknown }): Promise<unknown> => {
    if (message.method === "collaboration.open")
      return { handle: crypto.randomUUID(), role: "editor" };
    return undefined;
  });
  const sdk = createMistyAppSDK({
    request,
    subscribe: async (topic, listener) => {
      handlers.set(topic, listener);
      return () => {
        handlers.delete(topic);
      };
    },
  });
  const owner = createSdkNoteCollaboration(sdk, "space-a", lifetime.signal);
  cleanup.push(() => lifetime.abort());
  return { owner, request, handlers, lifetime };
}
it("shares one actual SDK Yjs provider between title/body consumers and cleans up after repeated reopen", async () => {
  const f = fixture();
  vi.useFakeTimers();
  const [title, body] = await Promise.all([
    f.owner.acquire("space-a", "note-a"),
    f.owner.acquire("space-a", "note-a"),
  ]);
  expect(title).toBe(body);
  expect(title.role).toBe("editor");
  expect(f.request.mock.calls.filter(([x]) => x.method === "collaboration.open")).toHaveLength(1);
  f.owner.release("space-a", "note-a");
  f.owner.release("space-a", "note-a");
  await vi.advanceTimersByTimeAsync(1000);
  expect(await f.owner.acquire("space-a", "note-a")).toBe(title);
  f.owner.release("space-a", "note-a");
  await vi.advanceTimersByTimeAsync(30_001);
  expect(f.owner.read("note-a")).toBeNull();
  expect(f.request.mock.calls.filter(([x]) => x.method === "collaboration.close")).toHaveLength(1);
  expect(title.doc.isDestroyed).toBe(true);
  expect(f.handlers.size).toBe(0);
});
it("cancels pending joins when the Journal view closes and rejects foreign Space requests", async () => {
  const f = fixture();
  expect(() => f.owner.acquire("space-b", "note-a")).toThrow("another Space");
  let resolve!: (value: unknown) => void;
  f.request.mockImplementation((message) =>
    message.method === "collaboration.open"
      ? new Promise((done) => {
          resolve = done;
        })
      : Promise.resolve(),
  );
  const pending = f.owner.acquire("space-a", "note-a");
  const rejected = expect(pending).rejects.toThrow("closed");
  f.lifetime.abort();
  const handle = crypto.randomUUID();
  resolve({ handle, role: "viewer" });
  await rejected;
  expect(f.request).toHaveBeenCalledWith({ method: "collaboration.close", params: { handle } });
  expect(f.owner.read("note-a")).toBeNull();
});
it("handles React strict mounting without leaking a shared provider or delivering post-close state", async () => {
  const f = fixture();
  const hook = renderHook(() => useSdkNoteCollaborationRoom(f.owner, "space-a", "note-a"), {
    wrapper: StrictMode,
  });
  await waitFor(() => expect(hook.result.current.session).not.toBeNull());
  const session = hook.result.current.session!;
  expect(f.request.mock.calls.filter(([x]) => x.method === "collaboration.open")).toHaveLength(1);
  act(() => f.owner.clear());
  expect(hook.result.current.session).toBeNull();
  expect(session.doc.isDestroyed).toBe(true);
  hook.unmount();
});
