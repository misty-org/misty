import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { MemoryRouter, useSearchParams } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import type { PropsWithChildren } from "react";
import type { SpaceLibraryItem } from "@/api/spaces/dto/interfaces/types";
import { useLibraryItemLink } from "./useLibraryItemLink";

function wrapper({ children }: PropsWithChildren) {
  return (
    <MemoryRouter initialEntries={["/spaces/one/library?item=target&sort=updated"]}>
      {children}
    </MemoryRouter>
  );
}
const item = (extra = {}) =>
  ({ id: "target", hidden: false, trashed_at: undefined, ...extra }) as SpaceLibraryItem;
const fixture = () => ({
  spaceId: "one",
  items: [] as SpaceLibraryItem[],
  loading: true,
  loadingMore: false,
  nextAfter: "",
  setSelectedItemId: vi.fn(),
  setLocalError: vi.fn(),
});
afterEach(cleanup);
it("waits for the list, selects the linked item and preserves other query parameters", async () => {
  const data = fixture();
  const loadMore = vi.fn(async () => {});
  const { result, rerender } = renderHook(
    () => {
      useLibraryItemLink(data, loadMore);
      return useSearchParams()[0];
    },
    { wrapper },
  );
  expect(data.setLocalError).not.toHaveBeenCalled();
  expect(result.current.get("item")).toBe("target");
  data.loading = false;
  data.items = [item()];
  rerender();
  await waitFor(() => expect(data.setSelectedItemId).toHaveBeenCalledWith("target"));
  expect(result.current.get("item")).toBeNull();
  expect(result.current.get("sort")).toBe("updated");
});
it("pages through the authorized list without repeatedly requesting the same cursor", async () => {
  const data = { ...fixture(), loading: false, nextAfter: "page2" };
  const loadMore = vi.fn(async () => {});
  const { rerender } = renderHook(() => useLibraryItemLink(data, loadMore), { wrapper });
  await waitFor(() => expect(loadMore).toHaveBeenCalledTimes(1));
  rerender();
  expect(loadMore).toHaveBeenCalledTimes(1);
  data.nextAfter = "";
  data.items = [item()];
  rerender();
  await waitFor(() => expect(data.setSelectedItemId).toHaveBeenCalledWith("target"));
});
it.each([{ hidden: true }, { trashed_at: "2026-09-30T12:00:00Z" }])(
  "does not select hidden or deleted content: %j",
  async (flags) => {
    const data = { ...fixture(), loading: false, items: [item(flags)] };
    const { result } = renderHook(
      () => {
        useLibraryItemLink(
          data,
          vi.fn(async () => {}),
        );
        return useSearchParams()[0];
      },
      { wrapper },
    );
    await waitFor(() =>
      expect(data.setLocalError).toHaveBeenCalledWith("This Library item isn’t available."),
    );
    expect(data.setSelectedItemId).not.toHaveBeenCalled();
    expect(result.current.get("item")).toBeNull();
  },
);
