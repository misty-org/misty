import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({ upload: vi.fn(), session: 0 }));
vi.mock("@/api/spaces/api", () => ({ spacesApi: { uploadLibraryPath: api.upload } }));
vi.mock("@/api/client/session", () => ({ readApiSessionGeneration: () => api.session }));
import { useSpaceChatDraft } from "./useSpaceChatDraft";
afterEach(() => {
  cleanup();
  api.session++;
  vi.clearAllMocks();
});
it("restores text, reply and attachment selections per conversation and clears across accounts", () => {
  const { result, rerender } = renderHook(
    ({ conversation }) => useSpaceChatDraft("s", conversation),
    { initialProps: { conversation: "a" } },
  );
  act(() => {
    result.current.setText("Unsent in A");
    result.current.setReplyToMessageId("m");
    result.current.setSelectedLibraryIds(["f"]);
  });
  rerender({ conversation: "b" });
  expect(result.current.text).toBe("");
  act(() => result.current.setText("B"));
  rerender({ conversation: "a" });
  expect([
    result.current.text,
    result.current.replyToMessageId,
    result.current.selectedLibraryIds,
  ]).toEqual(["Unsent in A", "m", ["f"]]);
  const reset = result.current.reset;
  rerender({ conversation: "a" });
  expect(result.current.reset).toBe(reset);
  api.session++;
  rerender({ conversation: "a" });
  expect(result.current.isEmpty).toBe(true);
});
it("keeps an upload finishing after navigation attached to its original conversation", async () => {
  let finish!: (value: unknown) => void;
  api.upload.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const { result, rerender } = renderHook(
    ({ conversation }) => useSpaceChatDraft("s", conversation),
    { initialProps: { conversation: "a" } },
  );
  let upload!: Promise<void>;
  act(() => {
    upload = result.current.uploadAttachments(["/test/file"]);
  });
  rerender({ conversation: "b" });
  await act(async () => {
    finish({ attachment: { id: "f" } });
    await upload;
  });
  expect(result.current.pendingAttachments).toEqual([]);
  rerender({ conversation: "a" });
  expect(result.current.pendingAttachments.map((a) => a.id)).toEqual(["f"]);
});
it("stops a multi-file upload when the account session changes during the first request", async () => {
  let finish!: (value: unknown) => void;
  api.upload.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const { result, rerender } = renderHook(() => useSpaceChatDraft("s", "a"));
  let upload!: Promise<void>;
  act(() => {
    upload = result.current.uploadAttachments(["/old-account/first", "/old-account/second"]);
  });
  api.session++;
  rerender();
  await act(async () => {
    finish({ attachment: { id: "old" } });
    await upload;
  });
  expect(api.upload).toHaveBeenCalledTimes(1);
  expect(result.current.pendingAttachments).toEqual([]);
});
