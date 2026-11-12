import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../profiles/profileWindow", () => ({ currentProfile: () => ({ id: "personal" }) }));

import {
  isUnseenPreload,
  keepPreloads,
  mayPreload,
  preloadArrived,
  preloadSeen,
} from "./tabPreload";
import { markFromElsewhere } from "./tabsFromElsewhere";

const views = (...ids: string[]) => ids.map((id) => ({ id, view: id }));

describe("tab preload", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    keepPreloads(new Set());
  });
  afterEach(() => vi.useRealTimers());

  it("leaves tabs opened here alone, and holds tabs from elsewhere back", () => {
    expect(mayPreload("opened-here")).toBe(true);
    markFromElsewhere(["arrived"]);
    expect(mayPreload("arrived")).toBe(false);
  });

  it("waits for the sign-in before letting a tab load", () => {
    markFromElsewhere(["gmail"]);
    const ready = vi.fn();
    preloadArrived(views("gmail"), ready);
    vi.advanceTimersByTime(7_999);
    expect(ready).not.toHaveBeenCalled();
    expect(mayPreload("gmail")).toBe(false);
    vi.advanceTimersByTime(1);
    expect(ready).toHaveBeenCalledOnce();
    expect(mayPreload("gmail")).toBe(true);
    expect(isUnseenPreload("gmail")).toBe(true);
  });

  it("loads only the newest few of a big sync", () => {
    const ids = Array.from({ length: 200 }, (_, index) => `tab${index}`);
    markFromElsewhere(ids);
    preloadArrived(views(...ids), () => undefined);
    vi.advanceTimersByTime(8_000);
    expect(ids.filter(mayPreload)).toEqual(["tab195", "tab196", "tab197", "tab198", "tab199"]);
  });

  it("never waits on more than five, until one is opened", () => {
    const first = ["a", "b", "c", "d", "e"];
    markFromElsewhere([...first, "f"]);
    preloadArrived(views(...first), () => undefined);
    vi.advanceTimersByTime(8_000);
    const ready = vi.fn();
    preloadArrived(views("f"), ready);
    vi.advanceTimersByTime(8_000);
    expect(ready).not.toHaveBeenCalled();
    expect(mayPreload("f")).toBe(false);
    preloadSeen("a");
    preloadArrived(views("f"), ready);
    vi.advanceTimersByTime(8_000);
    expect(mayPreload("f")).toBe(true);
  });

  it("drops a tab opened or closed before its wait is over", () => {
    markFromElsewhere(["opened", "closed", "waiting"]);
    preloadArrived(views("opened", "closed", "waiting"), () => undefined);
    preloadSeen("opened");
    keepPreloads(new Set(["opened", "waiting"]));
    vi.advanceTimersByTime(8_000);
    expect(isUnseenPreload("opened")).toBe(false);
    expect(isUnseenPreload("closed")).toBe(false);
    expect(isUnseenPreload("waiting")).toBe(true);
  });
});
