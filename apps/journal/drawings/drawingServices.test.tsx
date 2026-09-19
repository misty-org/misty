import { act, renderHook, waitFor } from "@testing-library/react";
import { createMistyAppSDK } from "@misty/sdk";
import { expect, it, vi } from "vitest";
import { createSdkDrawingServices } from "./drawingServices";
import { useSpaceDrawingsView } from "./hooks/useSpaceDrawingsView";
import type { SpaceDrawing } from "./types";

const drawing = {
  id: "drawing-a",
  space_id: "space-a",
  creator_user_id: "user-a",
  title: "Canvas",
  lifecycle_state: "active",
  collaboration_revision: 0,
  acl_version: 1,
  created_at: "2026-09-05T00:00:00Z",
  updated_at: "2026-09-05T00:00:00Z",
  role: "creator",
  can_delete: true,
  audience_kind: "space",
} as const;
it("keeps a refreshed SDK list from being overwritten by an older response and closes subscriptions", async () => {
  let resolveOld!: (value: unknown) => void;
  const remove = vi.fn(),
    report = vi.fn(),
    abort = new AbortController();
  const request = vi.fn(async (message: { method: string; params?: unknown }): Promise<unknown> => {
    if (message.method === "drawings.list")
      return new Promise((resolve) => {
        resolveOld = resolve;
      });
    return undefined;
  });
  const data = createSdkDrawingServices(
    createMistyAppSDK({ request, subscribe: async () => remove }),
    "space-a",
    abort.signal,
    vi.fn(),
    report,
  );
  const view = renderHook(() => useSpaceDrawingsView("space-a", data.services));
  await waitFor(() => expect(resolveOld).toBeTypeOf("function"));
  request.mockImplementation(async (message) =>
    message.method === "drawings.list"
      ? { drawings: [{ ...drawing, title: "Latest canvas" }] }
      : undefined,
  );
  await act(async () => {
    await view.result.current.reload();
  });
  expect(view.result.current.drawings[0].title).toBe("Latest canvas");
  await act(async () => {
    resolveOld({ drawings: [drawing] });
  });
  expect(view.result.current.drawings[0].title).toBe("Latest canvas");
  await expect(data.services.list("space-b")).rejects.toThrow("another Space");
  act(() => data.close());
  expect(remove).toHaveBeenCalledOnce();
  view.unmount();
  abort.abort();
  expect(report).not.toHaveBeenCalled();
});
it("does not put a completed creation into a different mounted Space", async () => {
  let finish!: (drawing: SpaceDrawing) => void;
  const services = {
    list: vi.fn(async () => ({ drawings: [] })),
    create: vi.fn(
      () =>
        new Promise<SpaceDrawing>((resolve) => {
          finish = resolve;
        }),
    ),
    rename: vi.fn(async () => drawing),
    remove: vi.fn(async () => undefined),
    subscribe: () => () => {},
    changed: vi.fn(),
    closeDocument: vi.fn(),
  };
  const view = renderHook(({ space }) => useSpaceDrawingsView(space, services), {
    initialProps: { space: "space-a" },
  });
  await waitFor(() => expect(view.result.current.loading).toBe(false));
  const pending = view.result.current.create("Canvas");
  const rejected = expect(pending).rejects.toThrow("closed while creating");
  view.rerender({ space: "space-b" });
  await act(async () => {
    finish(drawing);
    await rejected;
  });
  expect(view.result.current.drawings).toEqual([]);
  expect(services.changed).not.toHaveBeenCalled();
  view.unmount();
});
