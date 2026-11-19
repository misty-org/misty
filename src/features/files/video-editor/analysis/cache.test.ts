import { describe, expect, it } from "vitest";
import { footageKey, keep, readKept, RecentMap } from "./cache";

describe("kept analyses", () => {
  it("forgets the least recently used past its limit", () => {
    const recent = new RecentMap<number>(2);
    recent.set("a", 1);
    recent.set("b", 2);
    expect(recent.get("a")).toBe(1);
    recent.set("c", 3);
    expect(recent.get("b")).toBeUndefined();
    expect(recent.get("a")).toBe(1);
    expect(recent.get("c")).toBe(3);
  });

  it("keys a file by what it holds, not by its name", async () => {
    const bytes = new Uint8Array(3 * 1024 * 1024).map((_, i) => i % 251);
    const original = await footageKey(new File([bytes], "a.mp4"));
    expect(await footageKey(new File([bytes], "renamed.mp4"))).toBe(original);
    const changed = bytes.slice();
    changed[changed.length - 1] ^= 1;
    expect(await footageKey(new File([changed], "a.mp4"))).not.toBe(original);
    expect(await footageKey(new File([bytes.subarray(1)], "a.mp4"))).not.toBe(original);
  });

  it("reads back what was kept, nothing included", async () => {
    await keep("test:nothing", null);
    expect(await readKept("test:nothing")).toEqual({ value: null });
    expect(await readKept("test:unknown")).toBeUndefined();
  });
});
