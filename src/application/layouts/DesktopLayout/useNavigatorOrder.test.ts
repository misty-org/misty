import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useSettingsStore } from "@/features/settings";
import { orderedNavigatorIds, useNavigatorOrder } from "./useNavigatorOrder";
const original = useSettingsStore.getState();
afterEach(() => useSettingsStore.setState(original));
it("hydrates saved order, appends new items, and ignores duplicates or removed items", () => {
  expect(orderedNavigatorIds(["a", "b", "new"], ["gone", "b", "b", "a"])).toEqual([
    "b",
    "a",
    "new",
  ]);
});
it("keeps separate orders for accounts and each parent section, including before settings load", () => {
  const document = { navigation: { orders_by_account: { other: { sections: ["b", "a"] } } } };
  const update = vi.fn((section: string, key: string, value: unknown) => {
    useSettingsStore.setState({
      settings: { document: { ...document, [section]: { [key]: value } } } as never,
    });
  });
  useSettingsStore.setState({ loaded: false, settings: null, updateSetting: update });
  const { result, rerender, unmount } = renderHook(
    ({ account, section }) => useNavigatorOrder(account, section, ["a", "b"]),
    { initialProps: { account: "one", section: "sections" } },
  );
  act(() => result.current.move("a", "b", true));
  expect(result.current.ids).toEqual(["b", "a"]);
  expect(update).not.toHaveBeenCalled();
  act(() => useSettingsStore.setState({ loaded: true, settings: { document } as never }));
  expect(update).toHaveBeenCalledWith("navigation", "orders_by_account", {
    other: { sections: ["b", "a"] },
    one: { sections: ["b", "a"] },
  });
  rerender({ account: "one", section: "social" });
  expect(result.current.ids).toEqual(["a", "b"]);
  rerender({ account: "another", section: "sections" });
  expect(result.current.ids).toEqual(["a", "b"]);
  unmount();
  const restored = renderHook(() => useNavigatorOrder("one", "sections", ["a", "b"]));
  expect(restored.result.current.ids).toEqual(["b", "a"]);
});
