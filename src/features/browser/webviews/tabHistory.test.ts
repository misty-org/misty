import { beforeEach, expect, it } from "vitest";
import { useBrowserRuntimeStore } from "./browserRuntime";
import { configureTabHistoryBudget, decodeTabHistory, encodeTabHistory } from "./tabHistory";

beforeEach(() => useBrowserRuntimeStore.setState({ histories: {} }));

const page = (n: number) => `https://example.com/${n}`;

it("keeps web pages only and trims the oldest entries to the budget", () => {
  const history = { entries: [page(0), "misty://history", page(1), page(2)], index: 3 };
  expect(JSON.parse(encodeTabHistory(history)!)).toEqual({
    v: 1,
    entries: [page(0), page(1), page(2)],
    index: 2,
  });
  const long = { entries: Array.from({ length: 5000 }, (_, i) => page(i)), index: 4999 };
  const encoded = encodeTabHistory(long, 16 * 1024)!;
  expect(new TextEncoder().encode(encoded).length).toBeLessThanOrEqual(16 * 1024);
  const trimmed = JSON.parse(encoded);
  expect(trimmed.entries.at(-1)).toBe(page(4999));
  expect(trimmed.entries[trimmed.index]).toBe(page(4999));
  expect(encodeTabHistory({ entries: [page(0)], index: 0 })).toBeNull();
});

it("clamps the budget to the 1 MB ceiling", () => {
  configureTabHistoryBudget(50_000);
  const huge = { entries: Array.from({ length: 40_000 }, (_, i) => page(i)), index: 39_999 };
  expect(new TextEncoder().encode(encodeTabHistory(huge)!).length).toBeLessThanOrEqual(1024 * 1024);
  configureTabHistoryBudget(256);
});

it("lines a saved history up with the page the tab shows now", () => {
  const raw = JSON.stringify({ v: 1, entries: [page(0), page(1), page(2)], index: 2 });
  expect(decodeTabHistory(raw, page(1))).toEqual({
    entries: [page(0), page(1), page(2)],
    index: 1,
  });
  expect(decodeTabHistory(raw, page(9))).toEqual({
    entries: [page(0), page(1), page(2), page(9)],
    index: 3,
  });
  expect(decodeTabHistory("{", page(0))).toBeNull();
  expect(
    decodeTabHistory(JSON.stringify({ v: 1, entries: ["javascript:alert(1)"], index: 0 }), page(0)),
  ).toBeNull();
});

it("uses the webview's history inside its range and direct loads outside it", () => {
  const store = useBrowserRuntimeStore.getState();
  // Synced history: the new webview only knows the current page.
  store.replaceHistory("t", { entries: [page(0), page(1), page(2)], index: 2 });
  expect(store.travelHistory("t", -1)).toEqual({ url: page(1), native: false });
  // After a direct load, the page's own navigation extends what the webview knows.
  useBrowserRuntimeStore.getState().pushHistory("t", page(5));
  expect(useBrowserRuntimeStore.getState().travelHistory("t", -1)).toEqual({
    url: page(1),
    native: true,
  });
  expect(useBrowserRuntimeStore.getState().travelHistory("t", -1)).toEqual({
    url: page(0),
    native: false,
  });
  expect(useBrowserRuntimeStore.getState().travelHistory("t", -1)).toBeNull();
});
