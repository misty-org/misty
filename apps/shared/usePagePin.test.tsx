import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { MistyAppSDK } from "@misty/sdk";
import { usePagePin } from "./usePagePin";
import { uniquePagePins, pagePinKey } from "./pagePins";

afterEach(cleanup);
function fixture() {
  const rows = new Map<string, unknown>();
  const storage = {
    get: async (key: string) => rows.get(key) ?? null,
    set: vi.fn(async (key: string, value: unknown) => {
      rows.set(key, value);
    }),
    delete: vi.fn(async (key: string) => {
      rows.delete(key);
    }),
    keys: async () => [...rows.keys()],
  };
  const misty = { storage: { local: storage } } as unknown as MistyAppSDK;
  const props = {
    misty,
    appId: "chat" as const,
    provider: "instagram" as const,
    accountId: "session",
    url: "https://www.instagram.com/direct/inbox/",
    title: "(1) Instagram · Messages",
    label: "Instagram",
    report: vi.fn(),
  };
  return { rows, storage, props };
}
it("keeps two panes in sync and uses one record when both pin concurrently", async () => {
  const f = fixture();
  const a = renderHook(() => usePagePin(f.props));
  const b = renderHook(() => usePagePin(f.props));
  await waitFor(() =>
    expect(a.result.current.ready && b.result.current.ready).toBe(true),
  );
  await act(async () => {
    await Promise.all([a.result.current.toggle(), b.result.current.toggle()]);
  });
  await waitFor(() =>
    expect(a.result.current.pinned && b.result.current.pinned).toBe(true),
  );
  expect([...f.rows.values()]).toHaveLength(1);
  expect([...f.rows.values()][0]).toMatchObject({ label: "Messages" });
  await act(async () => {
    await b.result.current.toggle();
  });
  await waitFor(() =>
    expect(a.result.current.pinned || b.result.current.pinned).toBe(false),
  );
  expect(f.rows.size).toBe(0);
});
it("keeps the old state on save failure and allows retry", async () => {
  const f = fixture();
  const hook = renderHook(() => usePagePin(f.props));
  await waitFor(() => expect(hook.result.current.ready).toBe(true));
  f.storage.set.mockRejectedValueOnce(new Error("Storage unavailable"));
  await act(async () => {
    await hook.result.current.toggle();
  });
  expect(hook.result.current.pinned).toBe(false);
  expect(hook.result.current.busy).toBe(false);
  expect(f.props.report).toHaveBeenCalledWith(
    expect.objectContaining({ message: "Storage unavailable" }),
  );
  await act(async () => {
    await hook.result.current.toggle();
  });
  expect(hook.result.current.pinned).toBe(true);
});
it("blocks repeated clicks during a pending write", async () => {
  const f = fixture();
  const hook = renderHook(() => usePagePin(f.props));
  await waitFor(() => expect(hook.result.current.ready).toBe(true));
  let finish!: () => void;
  f.storage.set.mockImplementationOnce(async (key, value) => {
    await new Promise<void>((resolve) => {
      finish = resolve;
    });
    f.rows.set(key, value);
  });
  let pending!: Promise<void>;
  act(() => {
    pending = hook.result.current.toggle();
  });
  await waitFor(() => expect(finish).toBeTypeOf("function"));
  await act(async () => {
    await hook.result.current.toggle();
  });
  expect(f.storage.set).toHaveBeenCalledTimes(1);
  await act(async () => {
    finish();
    await pending;
  });
  expect(hook.result.current.pinned).toBe(true);
});
it("never pins a sign-in page, even when called directly", async () => {
  const f = fixture();
  const hook = renderHook(() =>
    usePagePin({
      ...f.props,
      url: "https://www.instagram.com/accounts/login/",
    }),
  );
  await waitFor(() => expect(hook.result.current.ready).toBe(true));
  await act(async () => {
    await hook.result.current.toggle();
  });
  expect(f.storage.set).not.toHaveBeenCalled();
});
it.each([
  ["journal", "google-docs", "https://docs.google.com/document/d/one/edit"],
  ["planner", "todoist", "https://app.todoist.com/app/today"],
  ["library", "dropbox", "https://www.dropbox.com/home"],
] as const)(
  "persists and restores a direct pin in %s",
  async (appId, provider, url) => {
    const f = fixture();
    f.rows.set(
      `website-integration-v1:service:${provider}`,
      JSON.stringify({ id: provider, order: 1 }),
    );
    f.rows.set(
      "website-integration-v1:account:session",
      JSON.stringify({
        id: "session",
        provider,
        label: "Existing session",
        websiteUrl: url,
      }),
    );
    const props = { ...f.props, appId, provider, url, title: "Saved page" };
    const hook = renderHook(() => usePagePin(props));
    await waitFor(() => expect(hook.result.current.ready).toBe(true));
    await act(async () => {
      await hook.result.current.toggle();
    });
    expect(hook.result.current.pinned).toBe(true);
    hook.unmount();
    const reopened = renderHook(() => usePagePin(props));
    await waitFor(() => expect(reopened.result.current.pinned).toBe(true));
    await act(async () => {
      await reopened.result.current.toggle();
    });
    expect(reopened.result.current.pinned).toBe(false);
    expect([...f.rows.keys()].some((key) => key.includes(":pin:"))).toBe(false);
  },
);
it("deduplicates destinations without merging hash routes or legacy native sessions", () => {
  const a = {
    provider: "google" as const,
    accountId: "one",
    url: "https://mail.google.com/mail/u/0/#inbox",
  };
  const b = { ...a, url: "https://mail.google.com/mail/u/0/#sent" };
  const c = { ...a, accountId: "two" };
  expect(uniquePagePins([a, { ...a }, b, c])).toEqual([a, b, c]);
  expect(pagePinKey(a)).not.toBe(pagePinKey(b));
});
