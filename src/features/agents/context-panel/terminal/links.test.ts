// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ILink, Terminal } from "@xterm/xterm";

const originalPlatform = window.navigator.platform;
afterAll(() => {
  Object.defineProperty(window.navigator, "platform", {
    value: originalPlatform,
    configurable: true,
  });
});

function setPlatform(platform: string) {
  Object.defineProperty(window.navigator, "platform", { value: platform, configurable: true });
}

const mocks = vi.hoisted(() => ({
  // Folder path → its entries; the probe lists the candidate's parent.
  dirs: new Map<string, { name: string; isDir: boolean }[]>(),
  listDir: vi.fn(),
}));
vi.mock("../files/filesApi", () => ({
  filesApi: {
    listDir: (path: string) => {
      mocks.listDir(path);
      const entries = mocks.dirs.get(path.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase());
      if (!entries) return Promise.reject(new Error("no such folder"));
      return Promise.resolve(entries);
    },
  },
}));

import {
  clearLinkCache,
  createPathLinkProvider,
  createUrlLinkProvider,
  holdsLinkModifier,
  isPathUnder,
  type ResolvedPath,
} from "./links";

const file = (name: string) => ({ name, isDir: false });

/** A minimal buffer: rows padded to `cols`, like xterm's translateToString(false). */
function fakeTerm(rows: string[], wrapped: boolean[], cols: number): Terminal {
  const lines = rows.map((text, i) => ({
    isWrapped: wrapped[i],
    translateToString: (trimRight: boolean) => {
      const padded = text.padEnd(cols, " ");
      return trimRight ? padded.trimEnd() : padded;
    },
  }));
  return { buffer: { active: { getLine: (i: number) => lines[i] } } } as unknown as Terminal;
}

function getLinks(
  term: Terminal,
  y: number,
  cwd: string,
  onActivate: (target: ResolvedPath) => void = () => {},
): Promise<ILink[] | undefined> {
  const provider = createPathLinkProvider({ term, cwd, onActivate });
  return new Promise((resolve) => provider.provideLinks(y, resolve));
}

const CWD = "/Users/x/Desktop";

describe("terminal path links", () => {
  beforeEach(() => {
    mocks.dirs.clear();
    clearLinkCache();
  });

  it("links a path with trailing prose, covering only the path", async () => {
    mocks.dirs.set("/users/x/desktop/out", [file("app.dmg")]);
    const term = fakeTerm(["Signing /Users/x/Desktop/out/app.dmg ok"], [false], 80);
    const links = await getLinks(term, 1, CWD);
    expect(links).toHaveLength(1);
    expect(links?.[0].text).toBe("/Users/x/Desktop/out/app.dmg");
    expect(links?.[0].range).toEqual({ start: { x: 9, y: 1 }, end: { x: 36, y: 1 } });
  });

  it("links spaced CJK paths with a cell-correct range", async () => {
    mocks.dirs.set("/users/x/desktop/my app 项目", [file("app.app")]);
    const line = "/Users/x/Desktop/My App 项目/app.app";
    const term = fakeTerm([line], [false], 80);
    const links = await getLinks(term, 1, CWD);
    expect(links?.[0].text).toBe(line);
    // 24 narrow cells, two wide characters at two cells each, then "/app.app".
    expect(links?.[0].range).toEqual({ start: { x: 1, y: 1 }, end: { x: 36, y: 1 } });
  });

  it("strips sentence punctuation before probing", async () => {
    mocks.dirs.set("/users/x/desktop/my app", [file("app_1.0.6_aarch64.dmg")]);
    const term = fakeTerm(
      ["Bundling /Users/x/Desktop/My App/app_1.0.6_aarch64.dmg)"],
      [false],
      120,
    );
    const links = await getLinks(term, 1, CWD);
    expect(links?.[0].text).toBe("/Users/x/Desktop/My App/app_1.0.6_aarch64.dmg");
  });

  it("joins soft-wrapped rows so long paths still link", async () => {
    mocks.dirs.set("/users/x/desktop/my app 项目", [file("app.app")]);
    const term = fakeTerm(["/Users/x/Desktop/My ", "App 项目/app.app"], [false, true], 20);
    const links = await getLinks(term, 2, CWD);
    expect(links).toHaveLength(1);
    expect(links?.[0].range.start).toEqual({ x: 1, y: 1 });
    expect(links?.[0].range.end).toEqual({ x: 16, y: 2 });
  });

  it("ignores URLs and word-glued relative tokens", async () => {
    const term = fakeTerm(["see https://example.com/a/b and github.com/foo/bar"], [false], 120);
    expect(await getLinks(term, 1, CWD)).toBeUndefined();
  });

  it("does not link paths that fail the probe", async () => {
    mocks.dirs.set("/users/x/desktop", [file("real.txt")]);
    const term = fakeTerm(["missing /Users/x/Desktop/nope.txt here"], [false], 80);
    expect(await getLinks(term, 1, CWD)).toBeUndefined();
  });

  it("never probes or links a path outside the terminal's folder", async () => {
    const term = fakeTerm(["at /usr/local/bin/node done"], [false], 80);
    const callsBefore = mocks.listDir.mock.calls.length;
    expect(await getLinks(term, 1, CWD)).toBeUndefined();
    expect(mocks.listDir.mock.calls.length).toBe(callsBefore);
  });

  it("says whether a link is a folder", async () => {
    mocks.dirs.set("/users/x/desktop", [{ name: "dist", isDir: true }]);
    const term = fakeTerm(["wrote /Users/x/Desktop/dist"], [false], 80);
    const onActivate = vi.fn();
    const links = await getLinks(term, 1, CWD, onActivate);
    setPlatform("MacIntel");
    links?.[0].activate({ metaKey: true, altKey: false, ctrlKey: false } as MouseEvent, "");
    expect(onActivate).toHaveBeenLastCalledWith({ path: "/Users/x/Desktop/dist", isDir: true });
  });

  it("opens only with the platform modifier: ⌘ or ⌥ on a Mac, Ctrl elsewhere", async () => {
    mocks.dirs.set("/users/x/desktop", [file("artifact.dmg")]);
    const term = fakeTerm(["built /Users/x/Desktop/artifact.dmg now"], [false], 80);
    const onActivate = vi.fn();
    const link = (await getLinks(term, 1, CWD, onActivate))?.[0];
    if (!link) throw new Error("expected a link");
    const click = (modifiers: { altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean }) =>
      link.activate(modifiers as MouseEvent, link.text);

    setPlatform("MacIntel");
    click({});
    click({ ctrlKey: true });
    expect(onActivate).not.toHaveBeenCalled();
    click({ altKey: true });
    click({ metaKey: true });
    expect(onActivate).toHaveBeenCalledTimes(2);

    onActivate.mockClear();
    setPlatform("Win32");
    click({});
    click({ altKey: true });
    expect(onActivate).not.toHaveBeenCalled();
    click({ ctrlKey: true });
    expect(onActivate).toHaveBeenCalledExactlyOnceWith({
      path: "/Users/x/Desktop/artifact.dmg",
      isDir: false,
    });
  });
});

describe("terminal URL links", () => {
  it("links web addresses without their trailing punctuation", async () => {
    const term = fakeTerm(["Local: http://localhost:5173/ (ready)."], [false], 80);
    const onActivate = vi.fn();
    const provider = createUrlLinkProvider({ term, onActivate });
    const links = await new Promise<ILink[] | undefined>((resolve) =>
      provider.provideLinks(1, resolve),
    );
    expect(links?.map((link) => link.text)).toEqual(["http://localhost:5173/"]);
    expect(links?.[0].range).toEqual({ start: { x: 8, y: 1 }, end: { x: 29, y: 1 } });
    links?.[0].activate({ ctrlKey: true, metaKey: true, altKey: false } as MouseEvent, "");
    expect(onActivate).toHaveBeenCalledWith("http://localhost:5173/");
  });
});

describe("link helpers", () => {
  it("knows what is inside a folder", () => {
    expect(isPathUnder("/a/b/c", "/a/b")).toBe(true);
    expect(isPathUnder("/a/bc", "/a/b")).toBe(false);
    expect(isPathUnder("C:\\Work\\x", "c:/work")).toBe(true);
  });

  it("reads the modifier per platform", () => {
    expect(holdsLinkModifier({ altKey: true, ctrlKey: false, metaKey: false }, true)).toBe(true);
    expect(holdsLinkModifier({ altKey: true, ctrlKey: false, metaKey: false }, false)).toBe(false);
  });
});
