import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  useAllOpenTabs,
  useCodingWorkspaceStore,
  useDirtyPaths,
  type OpenTab,
} from "./useCodingWorkspaceStore";

interface Snapshot {
  tabs: ReturnType<typeof useAllOpenTabs>;
  dirtyPaths: ReturnType<typeof useDirtyPaths>;
}

let snapshot: Snapshot | null = null;

function Probe() {
  snapshot = {
    tabs: useAllOpenTabs(),
    dirtyPaths: useDirtyPaths(),
  };
  return null;
}

describe("coding workspace derived store hooks", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    snapshot = null;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    useCodingWorkspaceStore.setState({
      projects: {},
      projectBuffers: {},
      views: {},
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
  });

  it("keeps derived snapshots stable when workspace groups have not changed", async () => {
    await act(async () => root.render(<Probe />));
    const first = snapshot;

    await act(async () => root.render(<Probe />));
    const second = snapshot;

    expect(first).not.toBeNull();
    expect(second?.tabs).toBe(first?.tabs);
    expect(second?.dirtyPaths).toBe(first?.dirtyPaths);
  });

  it("switches a viewport without discarding its previous buffer", () => {
    const store = useCodingWorkspaceStore.getState();
    store.openFile("/repo", "code-one", tab("a"));
    store.updateBufferContents("/repo", "/a.ts", "unsaved");
    store.openFile("/repo", "code-one", tab("b"));

    const state = useCodingWorkspaceStore.getState();
    expect(state.views["code-one"]?.activeFilePath).toBe("/b.ts");
    expect(state.projectBuffers["/repo"]?.["/a.ts"]?.contents).toBe("unsaved");
  });

  it("shares one project buffer between global Code views", () => {
    const store = useCodingWorkspaceStore.getState();
    store.openFile("/repo", "code-one", tab("a"));
    store.openFile("/repo", "code-two", { ...tab("a"), contents: "duplicate" });
    store.updateBufferContents("/repo", "/a.ts", "shared");

    const state = useCodingWorkspaceStore.getState();
    expect(state.projectBuffers["/repo"]?.["/a.ts"]?.contents).toBe("shared");
    expect(state.views["code-one"]?.activeFilePath).toBe("/a.ts");
    expect(state.views["code-two"]?.activeFilePath).toBe("/a.ts");
    expect(Object.keys(state.projectBuffers["/repo"] ?? {})).toEqual(["/a.ts"]);
  });

  it("persists ordered project marks and capped MRU recents", () => {
    const store = useCodingWorkspaceStore.getState();
    store.toggleMark("/repo", "/repo/a.ts");
    store.toggleMark("/repo", "/repo/b.ts");
    store.moveMark("/repo", "/repo/b.ts", -1);
    store.recordRecent("/repo", "/repo/a.ts");
    store.recordRecent("/repo", "/repo/b.ts");
    store.recordRecent("/repo", "/repo/a.ts");

    expect(useCodingWorkspaceStore.getState().projects["/repo"]).toEqual({
      expandedFolders: [],
      marks: ["/repo/b.ts", "/repo/a.ts"],
      recents: ["/repo/a.ts", "/repo/b.ts"],
    });
  });
});

function tab(stem: string): OpenTab {
  return {
    path: `/${stem}.ts`,
    name: `${stem}.ts`,
    contents: stem,
    savedContents: stem,
    lineEnding: "lf",
    readonly: false,
    loading: false,
    error: null,
  };
}
