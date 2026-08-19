import { useWorkspaceStore } from "@/features/workspace";
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useHomeRecents } from "./useHomeRecents";

describe("home recents", () => {
  beforeEach(() => {
    useWorkspaceStore.persist.clearStorage();
    useWorkspaceStore.getState().reset();
  });

  it("lists tabs from every Space, most recently focused first, without Home", () => {
    const store = useWorkspaceStore.getState();
    store.setScope("space:family");
    store.openSurface({
      surfaceId: "terminal",
      groupKey: "tool:terminal",
      title: "Terminal",
      route: "/terminal",
      instancePolicy: "single",
    });
    useWorkspaceStore.getState().setScope("space:work");
    useWorkspaceStore.getState().openSurface({
      surfaceId: "files",
      groupKey: "tool:files",
      title: "Files",
      route: "/files",
      instancePolicy: "single",
    });

    const { result } = renderHook(() => useHomeRecents());

    // Home is where this list is shown, so it is never a recent.
    expect(result.current.map((item) => item.surfaceId)).not.toContain("home");
    // Both Spaces contribute, and the newest focus wins.
    expect(result.current.map((item) => item.title)).toEqual(["Files", "Terminal"]);
    expect(result.current.map((item) => item.scopeKey)).toEqual(["space:work", "space:family"]);
  });
});
