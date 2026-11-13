import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// The Space's folders as a real store, so its selectors run as they do in the app.
vi.mock("../engines/enginesApi", async () => {
  const { create } = await import("zustand");
  const useSpaceFolders = create(() => ({
    folders: { "space-1": ["/work/app", "/work/site"] } as Record<string, string[]>,
    chosen: {} as Record<string, string>,
    prefs: { "space-1": { archived: ["/work/site"] } } as Record<string, { archived?: string[] }>,
    load: async () => [],
  }));
  const ordered = (state: { folders: Record<string, string[]> }, space: string) =>
    state.folders[space] ?? [];
  return {
    useSpaceFolders,
    currentSpaceKey: () => "space-1",
    folderName: (path: string) => path.split("/").pop() ?? path,
    folderLabel: (_state: unknown, _space: string, path: string) => path.split("/").pop() ?? path,
    folderOf: (state: { folders: Record<string, string[]> }, space: string) =>
      ordered(state, space)[0] ?? "",
    spaceFolderList: (
      state: { folders: Record<string, string[]>; prefs: Record<string, { archived?: string[] }> },
      space: string,
      includeArchived = false,
    ) =>
      ordered(state, space).filter(
        (path) => includeArchived || !state.prefs[space]?.archived?.includes(path),
      ),
  };
});
vi.mock("./folders/FolderAvatars", () => ({ FolderAvatar: () => null }));

import { FolderPicker } from "./FolderPicker";

afterEach(cleanup);

describe("FolderPicker", () => {
  it("renders the folder in use without rendering forever", async () => {
    const errors = vi.spyOn(console, "error");
    render(<FolderPicker compact />);
    await act(async () => {});
    expect(screen.getByRole("button", { name: "Project folder" }).textContent).toContain("app");
    expect(errors).not.toHaveBeenCalled();
  });
});
