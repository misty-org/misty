// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { settleDeviceSettings } from "@/tests/fakeDeviceSettings";

const mocks = vi.hoisted(() => ({
  listDir: vi.fn(),
  readFile: vi.fn(async () => ({ kind: "text", text: "", dataUrl: null, truncated: false })),
  writeFile: vi.fn(),
  gitTreeStatus: vi.fn(),
}));
const db = await vi.hoisted(async () =>
  (await import("@/tests/fakeDeviceSettings")).fakeDeviceSettings(),
);
vi.mock("@/shared/platform/nativeInvoke", () => ({ invoke: db.invoke }));
vi.mock("./filesApi", () => ({ filesApi: mocks }));
vi.mock("./fileIndex", () => ({ useFileIndex: { getState: () => ({ invalidate: () => {} }) } }));
vi.mock("./treePreferences", async () => {
  const { create } = await import("zustand");
  return { useTreePreferences: create(() => ({ hideIgnored: false })) };
});

import { tabsKey, useFilesStore } from "./filesStore";

const emptyStatus = () => ({ repositories: [], fileColors: {} });

/** What `misty.db` keeps for one folder under a per-folder scope, once saves have landed. */
async function saved(scope: "editor-tabs", root: string) {
  await settleDeviceSettings();
  return (db.read(scope) as Record<string, unknown> | null)?.[root];
}

describe("open files as tabs", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.listDir.mockResolvedValue([]);
    mocks.gitTreeStatus.mockResolvedValue(emptyStatus());
    mocks.readFile.mockImplementation(async () => ({
      kind: "text",
      text: "body",
      dataUrl: null,
      truncated: false,
    }));
    // Each folder's tabs are remembered in `misty.db`; start these folders with none open.
    for (const root of ["/tabs", "/other"]) {
      useFilesStore.setState({ root, openFiles: [], activeFilePath: null });
    }
    useFilesStore.setState({ root: "" });
    useFilesStore.getState().setRoot("/tabs");
  });

  it("opens a file once and shows its tab again on the next open", async () => {
    await useFilesStore.getState().openFile("/tabs/a.ts");
    await useFilesStore.getState().openFile("/tabs/b.ts");
    await useFilesStore.getState().openFile("/tabs/a.ts");
    expect(useFilesStore.getState().openFiles).toEqual(["/tabs/a.ts", "/tabs/b.ts"]);
    expect(useFilesStore.getState().activeFilePath).toBe("/tabs/a.ts");
    expect(mocks.readFile).toHaveBeenCalledTimes(2);
  });

  it("closing the shown tab shows the one that slid into its place, then the tree", async () => {
    await useFilesStore.getState().openFile("/tabs/a.ts");
    await useFilesStore.getState().openFile("/tabs/b.ts");
    useFilesStore.getState().activateFile("/tabs/a.ts");
    useFilesStore.getState().closeFile("/tabs/a.ts");
    expect(useFilesStore.getState().activeFilePath).toBe("/tabs/b.ts");
    useFilesStore.getState().closeFile("/tabs/b.ts");
    expect(useFilesStore.getState().activeFilePath).toBeNull();
  });

  it("keeps each folder's tabs, and reads a restored tab only when it shows", async () => {
    await useFilesStore.getState().openFile("/tabs/a.ts");
    await useFilesStore.getState().openFile("/tabs/b.ts");
    useFilesStore.getState().setRoot("/other");
    expect(useFilesStore.getState().openFiles).toEqual([]);
    mocks.readFile.mockClear();
    useFilesStore.getState().setRoot("/tabs");
    expect(useFilesStore.getState().openFiles).toEqual(["/tabs/a.ts", "/tabs/b.ts"]);
    expect(useFilesStore.getState().activeFilePath).toBe("/tabs/b.ts");
    // Only the shown tab is read back.
    expect(mocks.readFile).toHaveBeenCalledTimes(1);
    useFilesStore.getState().activateFile("/tabs/a.ts");
    expect(mocks.readFile).toHaveBeenCalledTimes(2);
  });

  it("remembers each folder's tabs in misty.db", async () => {
    await useFilesStore.getState().openFile("/tabs/a.ts");
    expect(await saved("editor-tabs", "/tabs")).toEqual({
      open: ["/tabs/a.ts"],
      active: "/tabs/a.ts",
      at: expect.any(Number),
    });
  });

  it("moves a folder's tabs out of webview storage, never restoring one from outside the folder", async () => {
    localStorage.setItem(
      tabsKey("/legacy"),
      JSON.stringify({ open: ["/elsewhere/x.ts", "/legacy/y.ts"], active: "/elsewhere/x.ts" }),
    );
    useFilesStore.getState().setRoot("/legacy");
    expect(useFilesStore.getState().openFiles).toEqual(["/legacy/y.ts"]);
    expect(useFilesStore.getState().activeFilePath).toBeNull();
    expect(localStorage.getItem(tabsKey("/legacy"))).toBeNull();
    expect(await saved("editor-tabs", "/legacy")).toMatchObject({ open: ["/legacy/y.ts"] });
  });

  it("a rename moves open tabs and unsaved marks with the file", async () => {
    await useFilesStore.getState().openFile("/tabs/src/a.ts");
    useFilesStore.getState().setFileDirty("/tabs/src/a.ts", true);
    useFilesStore.getState().remapTreePath("/tabs/src", "/tabs/lib");
    const state = useFilesStore.getState();
    expect(state.openFiles).toEqual(["/tabs/lib/a.ts"]);
    expect(state.activeFilePath).toBe("/tabs/lib/a.ts");
    expect(state.dirtyPaths).toEqual({ "/tabs/lib/a.ts": true });
    expect(state.fileStates["/tabs/lib/a.ts"].path).toBe("/tabs/lib/a.ts");
  });

  it("moving a path to the trash closes its tabs", async () => {
    await useFilesStore.getState().openFile("/tabs/src/a.ts");
    await useFilesStore.getState().openFile("/tabs/b.ts");
    useFilesStore.getState().removeTreePath("/tabs/src");
    expect(useFilesStore.getState().openFiles).toEqual(["/tabs/b.ts"]);
  });

  it("saves only a text file that was read whole", async () => {
    await useFilesStore.getState().openFile("/tabs/a.ts");
    await useFilesStore.getState().saveFile("/tabs/a.ts", "new");
    expect(mocks.writeFile).toHaveBeenCalledWith("/tabs/a.ts", "new");
    expect(useFilesStore.getState().fileStates["/tabs/a.ts"].content?.text).toBe("new");
    mocks.readFile.mockImplementationOnce(async () => ({
      kind: "text",
      text: "x",
      dataUrl: null,
      truncated: true,
    }));
    await useFilesStore.getState().openFile("/tabs/long.txt");
    await expect(useFilesStore.getState().saveFile("/tabs/long.txt", "y")).rejects.toThrow();
  });
});
