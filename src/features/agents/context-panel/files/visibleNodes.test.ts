// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import { describe, expect, it } from "vitest";
import type { DirEntry } from "./filesApi";
import { buildVisibleNodes, type TreeSnapshot } from "./visibleNodes";

const entry = (name: string, extra: Partial<DirEntry> = {}): DirEntry => ({
  name,
  isDir: false,
  size: 0,
  mtimeMs: 0,
  ...extra,
});

/** `/ws` with `.git` + `build` ignored; `build` expanded. */
function snapshot(overrides: Partial<TreeSnapshot> = {}): TreeSnapshot {
  return {
    root: "/ws",
    children: {
      "/ws": [
        entry(".git", { isDir: true, ignored: true }),
        entry("build", { isDir: true, ignored: true }),
        entry("src", { isDir: true }),
        entry("debug.log", { ignored: true }),
        entry("README.md"),
      ],
      "/ws/build": [entry("app.bin", { ignored: true })],
    },
    expanded: { "/ws": true, "/ws/build": true },
    loadingDirs: {},
    dirErrors: {},
    repositories: {},
    fileColors: { "/ws": { "README.md": "modified" } },
    hideIgnored: false,
    ...overrides,
  };
}

const paths = (nodes: ReturnType<typeof buildVisibleNodes>) => nodes.map((n) => n.path);

describe("buildVisibleNodes", () => {
  it("lists ignored entries by default and keeps their flag for the faded row", () => {
    const nodes = buildVisibleNodes(snapshot());
    expect(paths(nodes)).toEqual([
      "/ws",
      "/ws/.git",
      "/ws/build",
      "/ws/build/app.bin",
      "/ws/src",
      "/ws/debug.log",
      "/ws/README.md",
    ]);
    const byPath = new Map(nodes.map((n) => [n.path, n]));
    expect(byPath.get("/ws/.git")?.ignored).toBe(true);
    expect(byPath.get("/ws/build/app.bin")?.ignored).toBe(true);
    expect(byPath.get("/ws/src")?.ignored).toBeUndefined();
    expect(byPath.get("/ws/README.md")?.color).toBe("modified");
  });

  it("drops ignored entries (and everything under them) when hiding", () => {
    const nodes = buildVisibleNodes(snapshot({ hideIgnored: true }));
    expect(paths(nodes)).toEqual(["/ws", "/ws/src", "/ws/README.md"]);
    expect(nodes[1].depth).toBe(1);
  });

  it("never hides the synthetic workspace root row", () => {
    const nodes = buildVisibleNodes(
      snapshot({
        hideIgnored: true,
        children: { "/ws": [entry("only.log", { ignored: true })] },
      }),
    );
    expect(paths(nodes)).toEqual(["/ws"]);
  });

  it("renders nothing without a root", () => {
    expect(buildVisibleNodes(snapshot({ root: "" }))).toEqual([]);
  });

  it("merges a loaded single-child folder chain, judging the only child by the Git-ignore switch", () => {
    const children = {
      "/ws": [entry("src", { isDir: true })],
      "/ws/src": [entry("main", { isDir: true }), entry("cache", { ignored: true })],
      "/ws/src/main": [entry("App.java")],
    };
    const hidden = buildVisibleNodes(snapshot({ children, hideIgnored: true }));
    expect(hidden[1]).toMatchObject({
      name: "src/main",
      path: "/ws/src/main",
      compactPaths: ["/ws/src", "/ws/src/main"],
    });
    expect(buildVisibleNodes(snapshot({ children, hideIgnored: false }))[1].name).toBe("src");
  });

  it("never merges folders whose Git-ignore state differs, so only the ignored row is faded", () => {
    const children = {
      "/ws": [entry("app", { isDir: true })],
      "/ws/app": [entry("gen", { isDir: true, ignored: true })],
      "/ws/app/gen": [entry("out", { isDir: true, ignored: true })],
      "/ws/app/gen/out": [entry("bundle.js", { ignored: true })],
    };
    const rows = buildVisibleNodes(
      snapshot({ children, expanded: { "/ws": true, "/ws/app": true } }),
    );
    expect(rows.slice(1).map(({ name, ignored }) => ({ name, ignored }))).toEqual([
      { name: "app", ignored: undefined },
      { name: "gen/out", ignored: true },
    ]);
  });

  it("a merged row ending at a nested repository takes that folder's color and badge", () => {
    const repository = { path: "/ws/libs/core", branch: "main", changed: 1, untracked: 0 };
    const rows = buildVisibleNodes(
      snapshot({
        children: {
          "/ws": [entry("libs", { isDir: true })],
          "/ws/libs": [entry("core", { isDir: true })],
          "/ws/libs/core": [entry("a.ts")],
        },
        repositories: { "/ws/libs/core": repository },
        fileColors: { "/ws/libs": { core: "modified" } },
      }),
    );
    expect(rows[1]).toMatchObject({ name: "libs/core", repository, color: "modified" });
  });
});
