import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useAllOpenTabs, useDirtyPaths } from "./useCodingWorkspaceStore";

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
});
