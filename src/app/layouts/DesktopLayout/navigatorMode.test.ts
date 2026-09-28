import { describe, expect, it } from "vitest";
import {
  navigatorLayoutStorageKey,
  readNavigatorLayout,
  writeNavigatorLayout,
} from "./navigatorMode";
function storage(entries: Record<string, string> = {}) {
  const values = new Map(Object.entries(entries));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
}
describe("navigator visibility", () => {
  it("defaults to the always-visible rail", () => {
    expect(readNavigatorLayout(storage())).toEqual({ autoHide: false });
  });
  it("does not restore the retired wide layout", () => {
    expect(
      readNavigatorLayout(
        storage({
          "misty:global-navigator-layout:v5": JSON.stringify({ compact: false }),
          "misty:global-navigator-layout:v4": JSON.stringify({ widthPx: 320 }),
        }),
      ),
    ).toEqual({ autoHide: false });
  });
  it.each([false, true])("persists auto-hide %s", (autoHide) => {
    const target = storage();
    writeNavigatorLayout({ autoHide }, target);
    expect(readNavigatorLayout(target)).toEqual({ autoHide });
  });
  it.each(["{{", "null", '{"autoHide":"true"}'])("recovers invalid settings: %s", (saved) => {
    expect(readNavigatorLayout(storage({ [navigatorLayoutStorageKey]: saved }))).toEqual({
      autoHide: false,
    });
  });
});
