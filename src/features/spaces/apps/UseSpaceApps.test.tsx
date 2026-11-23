import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { InstalledSpaceApp } from "./server_apps";

const api = vi.hoisted(() => ({ list: vi.fn(), install: vi.fn(), remove: vi.fn() }));
vi.mock("./server_apps", () => ({ spaceAppsApi: api }));
vi.mock("../api/api", () => ({ SpaceRequestError: class extends Error {} }));

import { useSpaceApps } from "./use_space_apps";

const app = (appId: string): InstalledSpaceApp => ({
  space_id: "s",
  app_id: appId,
  version: "1",
  permissions: [],
  installed_by: "u",
  installed_at: "2026-11-23T00:00:00Z",
});

const later = <T,>() => {
  let settle!: (value: T) => void;
  const promise = new Promise<T>((resolve) => {
    settle = resolve;
  });
  return { promise, settle };
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it("asks once when two views open the same Space together", async () => {
  const first = later<InstalledSpaceApp[]>();
  api.list.mockReturnValueOnce(first.promise);
  const one = renderHook(() => useSpaceApps("together"));
  renderHook(() => useSpaceApps("together"));
  await act(async () => first.settle([app("draw")]));
  await waitFor(() => expect(one.result.current.apps).toEqual([app("draw")]));
  expect(api.list).toHaveBeenCalledTimes(1);
});

it("asks again when the Space's apps change while a list is on its way", async () => {
  const first = later<InstalledSpaceApp[]>();
  api.list.mockReturnValueOnce(first.promise).mockResolvedValueOnce([app("draw"), app("notes")]);
  const { result } = renderHook(() => useSpaceApps("changing"));
  window.dispatchEvent(
    new CustomEvent("misty:space-apps-changed", { detail: { spaceId: "changing" } }),
  );
  await act(async () => first.settle([app("draw")]));
  await waitFor(() => expect(result.current.apps).toEqual([app("draw"), app("notes")]));
  expect(api.list).toHaveBeenCalledTimes(2);
});

it("keeps an install made while an older list was on its way", async () => {
  const first = later<InstalledSpaceApp[]>();
  api.list
    .mockResolvedValueOnce([])
    .mockReturnValueOnce(first.promise)
    .mockResolvedValueOnce([app("draw")]);
  api.install.mockResolvedValueOnce(app("draw"));
  const { result } = renderHook(() => useSpaceApps("installing"));
  await waitFor(() => expect(result.current.apps).toEqual([]));
  act(() => result.current.reload());
  await act(async () => result.current.install("draw", "1", []));
  expect(result.current.apps).toEqual([app("draw")]);
  await act(async () => first.settle([]));
  await waitFor(() => expect(api.list).toHaveBeenCalledTimes(3));
  expect(result.current.apps).toEqual([app("draw")]);
});
