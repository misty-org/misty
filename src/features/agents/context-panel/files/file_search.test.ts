// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import { describe, expect, it } from "vitest";
import { scopeEntries, searchEntries, workspaceRelativePrefix } from "./file_search";
import type { IndexEntry as MentionEntry } from "./file_index";

const WS = "S:/AIWorker/proj";

function entry(rel: string): MentionEntry {
  const name = rel.split("/").pop() ?? rel;
  return {
    rel,
    name,
    isDir: rel.endsWith("/"),
    depth: rel.split("/").length - 1,
    key: rel.toLowerCase(),
    nameStart: rel.length - name.length,
  } as MentionEntry;
}

const INDEX = [
  entry("src/features/files/store.ts"),
  entry("src/features/files/deep/nested/FileSearchOverlay.tsx"),
  entry("src-extra/sibling.ts"),
  entry("docs/readme.md"),
  entry("README.md"),
];

describe("workspaceRelativePrefix", () => {
  it("returns '' when the target IS the root", () => {
    expect(workspaceRelativePrefix(WS, WS)).toBe("");
  });

  it("returns the child prefix with '/' separators", () => {
    expect(workspaceRelativePrefix(WS, `${WS}/src/features`)).toBe("src/features");
  });

  it("normalizes Windows backslashes to '/' before comparing", () => {
    expect(workspaceRelativePrefix("S:\\AIWorker\\proj", "S:/AIWorker/proj/src")).toBe("src");
    expect(workspaceRelativePrefix(WS, `${WS}\\src`)).toBe("src");
  });

  it("tolerates a trailing separator on either side", () => {
    expect(workspaceRelativePrefix(`${WS}/`, `${WS}/src/`)).toBe("src");
  });

  it("returns null for a path outside the workspace", () => {
    expect(workspaceRelativePrefix(WS, "S:/AIWorker/other")).toBeNull();
    expect(workspaceRelativePrefix("S:/AIWorker/proj", "S:/AIWorker/proj-extra")).toBeNull();
  });
});

describe("scopeEntries", () => {
  it("passes every entry through when the scope is the workspace root", () => {
    expect(scopeEntries(INDEX, WS, WS).map((e) => e.rel)).toEqual(INDEX.map((e) => e.rel));
  });

  it("keeps only the entries inside the scoped folder", () => {
    const out = scopeEntries(INDEX, WS, `${WS}/src/features`);
    expect(out.map((e) => e.rel)).toEqual([
      "src/features/files/store.ts",
      "src/features/files/deep/nested/FileSearchOverlay.tsx",
    ]);
  });

  it("does not leak a sibling whose name shares the prefix (src vs src-extra)", () => {
    const out = scopeEntries(INDEX, WS, `${WS}/src`);
    const rels = out.map((e) => e.rel);
    expect(rels).not.toContain("src-extra/sibling.ts");
    expect(rels).toContain("src/features/files/store.ts");
  });

  it("returns [] when the scope is outside the workspace", () => {
    expect(scopeEntries(INDEX, WS, "S:/AIWorker/other")).toEqual([]);
  });
});

describe("searchEntries", () => {
  it("shows nothing for an empty or whitespace-only query", () => {
    expect(searchEntries(INDEX, WS, WS, "")).toEqual([]);
    expect(searchEntries(INDEX, WS, WS, "   ")).toEqual([]);
  });

  it("finds a file nested two levels inside the scoped folder", () => {
    const out = searchEntries(INDEX, WS, `${WS}/src/features`, "overlay");
    expect(out.map((e) => e.rel)).toEqual(["src/features/files/deep/nested/FileSearchOverlay.tsx"]);
  });

  it("never returns a match outside the scope", () => {
    expect(searchEntries(INDEX, WS, `${WS}/src`, "sibling")).toEqual([]);
  });

  it("returns [] for a query with no matches", () => {
    expect(searchEntries(INDEX, WS, WS, "zzz-no-such-file")).toEqual([]);
  });
});

describe("searchEntries ranking", () => {
  const RN = "S:/AIWorker/open-reverselab";
  const RINDEX = [
    "open-reverselab/DISCLAIMER.md",
    "open-reverselab/DISCLAIMER.zh.md",
    "open-reverselab/README.md",
    "open-reverselab/README.zh.md",
    "open-reverselab/kb/README.md",
    "open-reverselab/gui/README.md",
    "open-reverselab/IdolLive!Underichigo -read me-.txt",
  ].map(entry);

  it("puts a name match above a folder-path match", () => {
    const rels = searchEntries(RINDEX, RN, RN, "readme").map((e) => e.rel);
    expect(rels[0]).toBe("open-reverselab/README.md");
    expect(rels.indexOf("open-reverselab/DISCLAIMER.md")).toBeGreaterThan(
      rels.indexOf("open-reverselab/kb/README.md"),
    );
  });

  it("orders same-tier matches by shallower path", () => {
    const rels = searchEntries(RINDEX, RN, RN, "readme").map((e) => e.rel);
    expect(rels.indexOf("open-reverselab/README.md")).toBeLessThan(
      rels.indexOf("open-reverselab/kb/README.md"),
    );
  });

  it("puts an exact file name first", () => {
    const rels = searchEntries(RINDEX, RN, RN, "README.md").map((e) => e.rel);
    expect(rels[0]).toBe("open-reverselab/README.md");
  });

  it("ranks a name subsequence above a folder-only match", () => {
    const rels = searchEntries(RINDEX, RN, RN, "readme").map((e) => e.rel);
    expect(rels.indexOf("open-reverselab/IdolLive!Underichigo -read me-.txt")).toBeLessThan(
      rels.indexOf("open-reverselab/DISCLAIMER.md"),
    );
  });

  it("matches case-insensitively", () => {
    expect(searchEntries(RINDEX, RN, RN, "ReAdMe.Md")[0]?.rel).toBe("open-reverselab/README.md");
  });
});
