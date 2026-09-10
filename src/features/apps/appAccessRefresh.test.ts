import { afterEach, expect, it, vi } from "vitest";
import { retainAppAccessRefresh } from "./appAccessRefresh";
const load = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("./useAppsStore", () => ({ useAppsStore: { getState: () => ({ load }) } }));
afterEach(() => {
  vi.useRealTimers();
  load.mockClear();
});
it("shares polling and focus refreshes until the last view leaves", () => {
  vi.useFakeTimers();
  const release = Array.from({ length: 20 }, () => retainAppAccessRefresh("one", "family"));
  expect(load).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(15000);
  expect(load).toHaveBeenCalledTimes(2);
  window.dispatchEvent(new Event("focus"));
  expect(load).toHaveBeenCalledTimes(2);
  release.slice(1).forEach((stop) => stop());
  vi.advanceTimersByTime(15000);
  expect(load).toHaveBeenCalledTimes(3);
  release[0]();
  vi.advanceTimersByTime(30000);
  window.dispatchEvent(new Event("focus"));
  expect(load).toHaveBeenCalledTimes(3);
});
