import { beforeEach, describe, expect, it, vi } from "vitest";

const stored = vi.hoisted(() => ({
  linked: ["/a", "/b", "/c"] as string[],
  prefs: { revision: 0, state: null as unknown },
}));
vi.mock("@/shared/platform/nativeInvoke", () => ({
  invoke: vi.fn(async (command: string, args: Record<string, unknown>) => {
    if (command === "space_folder_list") return stored.linked;
    if (command === "settings_session_state") return stored.prefs;
    if (command === "settings_session_commit") {
      stored.prefs = { revision: stored.prefs.revision + 1, state: args.document };
      return stored.prefs;
    }
    return null;
  }),
}));
vi.mock("@/features/app-windows", () => ({ spaceWindow: () => ({ spaceId: "space" }) }));
vi.mock("../personal/agentAccount", () => ({ agentAccountId: () => "me" }));

import {
  folderLabel,
  folderOf,
  orderFolders,
  spaceFolderList,
  useSpaceFolders,
} from "./enginesApi";

describe("a Space's linked folders on this device", () => {
  beforeEach(() => {
    stored.linked = ["/a", "/b", "/c"];
    stored.prefs = { revision: 0, state: null };
    useSpaceFolders.setState({ folders: {}, chosen: {}, prefs: {} });
  });

  it("orders folders as placed, with ones linked since at the end", () => {
    expect(orderFolders(["/a", "/b", "/c"], { order: ["/c", "/gone", "/a"] })).toEqual([
      "/c",
      "/a",
      "/b",
    ]);
  });

  it("remembers the chosen folder across windows", async () => {
    await useSpaceFolders.getState().load("space");
    useSpaceFolders.getState().choose("space", "/b");
    await vi.waitFor(() => expect((stored.prefs.state as { chosen?: string })?.chosen).toBe("/b"));
    useSpaceFolders.setState({ folders: {}, chosen: {}, prefs: {} });
    await useSpaceFolders.getState().load("space");
    expect(folderOf(useSpaceFolders.getState(), "space")).toBe("/b");
  });

  it("names, moves and archives folders, and an archived one is never worked in", async () => {
    await useSpaceFolders.getState().load("space");
    const store = useSpaceFolders.getState();
    await store.rename("space", "/a", "Website");
    await store.move("space", "/c", 0);
    useSpaceFolders.getState().choose("space", "/c");
    await useSpaceFolders.getState().archive("space", "/c", true);
    const state = useSpaceFolders.getState();
    expect(folderLabel(state, "space", "/a")).toBe("Website");
    expect(folderLabel(state, "space", "/b")).toBe("b");
    expect(spaceFolderList(state, "space")).toEqual(["/a", "/b"]);
    expect(spaceFolderList(state, "space", true)).toEqual(["/c", "/a", "/b"]);
    expect(folderOf(state, "space")).toBe("/a");
    await useSpaceFolders.getState().archive("space", "/c", false);
    expect(spaceFolderList(useSpaceFolders.getState(), "space")).toEqual(["/c", "/a", "/b"]);
  });

  it("a blank name gives a folder back its own", async () => {
    await useSpaceFolders.getState().load("space");
    await useSpaceFolders.getState().rename("space", "/a", "Site");
    await useSpaceFolders.getState().rename("space", "/a", "  ");
    expect(folderLabel(useSpaceFolders.getState(), "space", "/a")).toBe("a");
  });
});
