import { describe, expect, it } from "vitest";
import {
  legacyNavigatorCollapsedStorageKey,
  navigatorModeStorageKey,
  navigatorWidths,
  readNavigatorMode,
  writeNavigatorMode,
} from "./navigatorMode";

function storage(entries: Record<string, string> = {}) {
  const values = new Map(Object.entries(entries));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    values,
  };
}

describe("navigator modes", () => {
  it("defaults to the full drawer", () => {
    expect(readNavigatorMode(storage())).toBe("full");
  });

  it("migrates the legacy collapsed preference", () => {
    expect(readNavigatorMode(storage({ [legacyNavigatorCollapsedStorageKey]: "true" }))).toBe(
      "icons",
    );
    expect(readNavigatorMode(storage({ [legacyNavigatorCollapsedStorageKey]: "false" }))).toBe(
      "full",
    );
  });

  it("prefers and persists the versioned three-state value", () => {
    const target = storage({
      [legacyNavigatorCollapsedStorageKey]: "false",
      [navigatorModeStorageKey]: "hidden",
    });
    expect(readNavigatorMode(target)).toBe("hidden");
    writeNavigatorMode("icons", target);
    expect(target.values.get(navigatorModeStorageKey)).toBe("icons");
  });

  it("resolves the expected shell widths", () => {
    expect(navigatorWidths).toEqual({ full: 232, icons: 72, hidden: 0 });
  });
});
