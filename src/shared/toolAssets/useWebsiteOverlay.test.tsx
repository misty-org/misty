import { act, renderHook, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { MistyAppSDK } from "@misty/sdk";
import { useWebsiteOverlay } from "./useWebsiteOverlay";

type View = Awaited<ReturnType<MistyAppSDK["browser"]["create"]>>;
const view = (handle: string) => ({ handle }) as View;
function fixture() {
  const pending = new Map<string, () => void>();
  const overlay = vi.fn(
    async (handle: string, _reason: string, active: boolean) => {
      if (active)
        await new Promise<void>((resolve) => pending.set(handle, resolve));
    },
  );
  const misty = { browser: { overlay } } as unknown as MistyAppSDK;
  return { misty, overlay, pending };
}
it("waits for the Browser stacking handoff before showing a panel and releases it on close", async () => {
  const f = fixture();
  const { result, rerender, unmount } = renderHook(
    ({ requested }) => useWebsiteOverlay(f.misty, view("one"), requested, true),
    { initialProps: { requested: true } },
  );
  expect(result.current).toBe(false);
  expect(f.overlay).toHaveBeenCalledWith("one", "website-panels", true);
  await act(async () => f.pending.get("one")!());
  expect(result.current).toBe(true);
  rerender({ requested: false });
  expect(result.current).toBe(false);
  expect(f.overlay).toHaveBeenLastCalledWith("one", "website-panels", false);
  unmount();
});
it("does not reopen a dismissed panel when the native handoff finishes late", async () => {
  const f = fixture();
  const { result, rerender, unmount } = renderHook(
    ({ requested }) => useWebsiteOverlay(f.misty, view("one"), requested, true),
    { initialProps: { requested: true } },
  );
  rerender({ requested: false });
  await act(async () => f.pending.get("one")!());
  expect(result.current).toBe(false);
  unmount();
});
it("binds the overlay to the current account and ignores a stale account handoff", async () => {
  const f = fixture();
  const { result, rerender, unmount } = renderHook(
    ({ account }) => useWebsiteOverlay(f.misty, view(account), true, true),
    { initialProps: { account: "old" } },
  );
  rerender({ account: "new" });
  expect(result.current).toBe(false);
  await act(async () => f.pending.get("new")!());
  expect(result.current).toBe(true);
  await act(async () => f.pending.get("old")!());
  expect(result.current).toBe(true);
  expect(f.overlay).toHaveBeenCalledWith("old", "website-panels", false);
  unmount();
  expect(f.overlay).toHaveBeenLastCalledWith("new", "website-panels", false);
});
it("releases overlays for inactive panes and does not show a panel after a failed handoff", async () => {
  const f = fixture();
  const { result, rerender, unmount } = renderHook(
    ({ active }) => useWebsiteOverlay(f.misty, view("one"), true, active),
    { initialProps: { active: true } },
  );
  await act(async () => f.pending.get("one")!());
  rerender({ active: false });
  expect(result.current).toBe(false);
  expect(f.overlay).toHaveBeenLastCalledWith("one", "website-panels", false);
  f.overlay.mockImplementation(async (_handle, _reason, enabled) => {
    if (enabled) throw new Error("native handoff unavailable");
  });
  rerender({ active: true });
  await waitFor(() =>
    expect(f.overlay).toHaveBeenLastCalledWith("one", "website-panels", false),
  );
  expect(result.current).toBe(false);
  unmount();
});
