import { describe, expect, it } from "vitest";
import {
  legacyNavigatorCollapsedStorageKey,
  navigatorLayoutStorageKey,
  navigatorModeStorageKey,
  navigatorWidths,
  readNavigatorLayout,
  writeNavigatorLayout,
} from "./navigatorMode";

function storage(entries: Record<string, string> = {}) {
  const values = new Map(Object.entries(entries));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    values,
  };
}

describe("navigator layout", () => {
  it("defaults to a sticky full drawer", () => {
    expect(readNavigatorLayout(storage())).toEqual({ width: "full", visibility: "sticky" });
  });

  it("migrates the legacy collapsed preference", () => {
    expect(readNavigatorLayout(storage({ [legacyNavigatorCollapsedStorageKey]: "true" }))).toEqual({
      width: "full",
      visibility: "sticky",
    });
    expect(readNavigatorLayout(storage({ [legacyNavigatorCollapsedStorageKey]: "false" }))).toEqual(
      {
        width: "full",
        visibility: "sticky",
      },
    );
  });

  it("migrates the older single mode keys", () => {
    expect(readNavigatorLayout(storage({ [navigatorModeStorageKey]: "hidden" }))).toEqual({
      width: "full",
      visibility: "hidden",
    });
    expect(readNavigatorLayout(storage({ [navigatorModeStorageKey]: "icons" }))).toEqual({
      width: "full",
      visibility: "sticky",
    });
  });

  it("prefers and persists the versioned layout", () => {
    const target = storage({ [navigatorModeStorageKey]: "hidden" });
    writeNavigatorLayout({ width: "full", visibility: "hidden" }, target);
    expect(target.values.get(navigatorLayoutStorageKey)).toBe(
      JSON.stringify({ width: "full", visibility: "hidden" }),
    );
    expect(readNavigatorLayout(target)).toEqual({ width: "full", visibility: "hidden" });
  });

  it("falls back to the older keys when the stored layout is corrupt", () => {
    expect(
      readNavigatorLayout(
        storage({ [navigatorLayoutStorageKey]: "{{", [navigatorModeStorageKey]: "hidden" }),
      ),
    ).toEqual({ width: "full", visibility: "hidden" });
  });

  it("resolves the expected shell widths", () => {
    expect(navigatorWidths).toEqual({ full: 264, hidden: 0 });
  });
});
