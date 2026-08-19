import { describe, expect, it } from "vitest";
import {
  legacyNavigatorCollapsedStorageKey,
  navigatorLayoutStorageKey,
  navigatorModeStorageKey,
  navigatorWidths,
  nextNavigatorWidth,
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
      width: "icons",
      visibility: "sticky",
    });
    expect(readNavigatorLayout(storage({ [legacyNavigatorCollapsedStorageKey]: "false" }))).toEqual(
      {
        width: "full",
        visibility: "sticky",
      },
    );
  });

  it("migrates the older single three-state mode", () => {
    expect(readNavigatorLayout(storage({ [navigatorModeStorageKey]: "hidden" }))).toEqual({
      width: "full",
      visibility: "hidden",
    });
    expect(readNavigatorLayout(storage({ [navigatorModeStorageKey]: "icons" }))).toEqual({
      width: "icons",
      visibility: "sticky",
    });
  });

  it("prefers and persists the versioned layout", () => {
    const target = storage({ [navigatorModeStorageKey]: "hidden" });
    writeNavigatorLayout({ width: "icons", visibility: "hidden" }, target);
    expect(target.values.get(navigatorLayoutStorageKey)).toBe(
      JSON.stringify({ width: "icons", visibility: "hidden" }),
    );
    expect(readNavigatorLayout(target)).toEqual({ width: "icons", visibility: "hidden" });
  });

  it("falls back to the older keys when the stored layout is corrupt", () => {
    expect(
      readNavigatorLayout(
        storage({ [navigatorLayoutStorageKey]: "{{", [navigatorModeStorageKey]: "icons" }),
      ),
    ).toEqual({ width: "icons", visibility: "sticky" });
  });

  it("cycles the width between full and icons", () => {
    expect(nextNavigatorWidth("full")).toBe("icons");
    expect(nextNavigatorWidth("icons")).toBe("full");
  });

  it("resolves the expected shell widths", () => {
    expect(navigatorWidths).toEqual({ full: 264, icons: 72, hidden: 0 });
  });
});
