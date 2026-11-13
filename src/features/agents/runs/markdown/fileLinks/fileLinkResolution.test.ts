// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveChatFileLink } from "./fileLinkResolution";

type Found = { path: string; relative: string; isDir: boolean };
const mocks = vi.hoisted(() => ({
  listDir: vi.fn(async (_path: string): Promise<{ name: string }[]> => []),
  findFiles: vi.fn(async (_folder: string, _query: string): Promise<Found[]> => []),
}));

vi.mock("../../../context-panel/projectApi", () => ({
  projectApi: { listDir: mocks.listDir },
}));
vi.mock("../../../engines/enginesApi", () => ({ findFiles: mocks.findFiles }));

const WS = "/Users/me/Work";
const found = (relative: string): Found => ({ relative, path: `${WS}/${relative}`, isDir: false });

beforeEach(() => {
  mocks.listDir.mockReset();
  mocks.findFiles.mockReset();
  mocks.listDir.mockResolvedValue([]);
  mocks.findFiles.mockResolvedValue([]);
});

describe("resolveChatFileLink", () => {
  it("keeps the folder-anchored candidate when its file shows up in the parent listing", async () => {
    mocks.listDir.mockResolvedValueOnce([{ name: "app.exe" }]);
    expect(await resolveChatFileLink("release/app.exe", WS)).toBe(`${WS}/release/app.exe`);
    expect(mocks.findFiles).not.toHaveBeenCalled();
  });

  it("finds a file nested below the folder through the file search", async () => {
    mocks.listDir.mockRejectedValueOnce(new Error("missing"));
    mocks.findFiles.mockResolvedValueOnce([
      found("project/release/project.exe"),
      found("project/dist/project.exe"),
    ]);
    expect(await resolveChatFileLink("release/project.exe", WS)).toBe(
      `${WS}/project/release/project.exe`,
    );
    expect(mocks.findFiles).toHaveBeenCalledWith(WS, "project.exe");
  });

  it("applies the same fallback to an absolute link under the folder", async () => {
    mocks.listDir.mockRejectedValueOnce(new Error("missing"));
    mocks.findFiles.mockResolvedValueOnce([found("project/release/project.exe")]);
    expect(await resolveChatFileLink(`${WS}/release/project.exe`, WS)).toBe(
      `${WS}/project/release/project.exe`,
    );
  });

  it("does not guess when the file name alone is ambiguous", async () => {
    mocks.findFiles.mockResolvedValueOnce([found("dist/app.exe"), found("release/app.exe")]);
    expect(await resolveChatFileLink("app.exe", WS)).toBe(`${WS}/app.exe`);
  });

  it("leaves paths outside the folder as written and never probes them", async () => {
    expect(await resolveChatFileLink("/opt/tool/run.sh", WS)).toBe("/opt/tool/run.sh");
    expect(mocks.listDir).not.toHaveBeenCalled();
    expect(mocks.findFiles).not.toHaveBeenCalled();
  });

  it("returns null for what isn't a path, and decodes URL-encoded names", async () => {
    expect(await resolveChatFileLink("~/notes.txt", WS)).toBeNull();
    expect(await resolveChatFileLink("   ", WS)).toBeNull();
    mocks.listDir.mockResolvedValueOnce([{ name: "my notes.md" }]);
    expect(await resolveChatFileLink("docs/my%20notes.md", WS)).toBe(`${WS}/docs/my notes.md`);
  });
});
