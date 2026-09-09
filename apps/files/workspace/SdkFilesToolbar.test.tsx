import { act, render, renderHook, screen, fireEvent } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { createSdkCodeFileFixture } from "@/features/coding-workspace/sdkCodeProject.fixture";
import { createSdkFilesStore } from "./sdkFilesStore";
import {
  SdkFilesToolbar,
  useSdkFilesToolbarProps,
  type SdkFilesToolbarServices,
} from "./SdkFilesToolbar";
import { resolveSdkFilesPath } from "./sdkFilesNavigation";

const services = (): SdkFilesToolbarServices => ({
  canUndo: false,
  canRedo: false,
  undoTitle: "Undo",
  redoTitle: "Redo",
  onUndo: vi.fn(),
  onRedo: vi.fn(),
  canOpenWithSelected: false,
  canCalculateDirectorySizes: false,
  onOpenWith: vi.fn(),
  onCalculateDirectorySizes: vi.fn(),
  onCopyPath: vi.fn(),
  onDownload: vi.fn(),
  pluginCommands: [],
  onRunCommand: vi.fn(),
});
it("renders granted-folder labels and wires the shared toolbar's real SDK navigation and edits", async () => {
  const fixture = createSdkCodeFileFixture(),
    files = createSdkFilesStore(fixture.sdk, new AbortController().signal);
  const folder = (await files.openFolder())!;
  const dependencies = services();
  const hook = renderHook(() => useSdkFilesToolbarProps(files, "files", dependencies));
  const view = render(
    <SdkFilesToolbar
      files={files}
      paneId="files"
      services={dependencies}
      runtime={{
        DropTarget: ({ children }) => <>{children}</>,
        Search: (props) => (
          <input
            aria-label="Search files"
            value={props.commandQuery}
            onChange={(event) => props.onCommandQuery(event.target.value)}
          />
        ),
      }}
    />,
  );
  try {
    expect(screen.getByRole("button", { name: "Project" })).toBeTruthy();
    expect(view.container.textContent).not.toContain("misty-project");
    await act(async () => hook.result.current.onNavigateLocation("Project/src"));
    await vi.waitFor(() =>
      expect(files.store.getState().pane.listing?.path).toBe(`${folder.root}/src`),
    );
    act(() => hook.result.current.onCreateFile());
    expect(files.store.getState().inlineEdit?.kind).toBe("create");
    await act(async () => {
      files.updateInlineEdit("toolbar.txt");
      await files.commitInlineEdit();
    });
    act(() => files.select(`${folder.root}/src/toolbar.txt`));
    act(() => hook.result.current.onRunCommand("explorer.batch_rename"));
    expect(files.store.getState().dialog?.kind).toBe("batchRename");
    act(() => files.closeDialog());
    act(() => hook.result.current.onRunCommand("plugin.example"));
    expect(dependencies.onRunCommand).toHaveBeenCalledWith("plugin.example");
    await act(async () => hook.result.current.onDelete());
    await vi.waitFor(() =>
      expect(
        files.store.getState().pane.listing?.entries.some((entry) => entry.name === "toolbar.txt"),
      ).toBe(false),
    );
    await act(async () => files.openTrash());
    expect(files.store.getState().pane.listing?.entries.map((entry) => entry.name)).toContain(
      "toolbar.txt",
    );
    expect(hook.result.current.canCreateFile).toBe(false);
    expect(screen.getByRole("button", { name: "Trash" })).toBeTruthy();
    act(() => files.select(files.store.getState().pane.listing!.entries[0].id));
    await act(async () => screen.getByRole("button", { name: "Restore" }).click());
    await vi.waitFor(() => expect(fixture.nested.children!.has("toolbar.txt")).toBe(true));
    fireEvent.change(screen.getByRole("textbox", { name: "Search files" }), {
      target: { value: "toolbar" },
    });
    expect(files.store.getState().pane.commandQuery).toBe("toolbar");
  } finally {
    view.unmount();
    hook.unmount();
    await files.close();
  }
  expect(fixture.handles.size).toBe(0);
});
it("resolves edited folder paths within their grants and rejects traversal outside them", () => {
  const folders = [{ root: "/misty-project/chosen", name: "Project" }];
  expect(resolveSdkFilesPath(folders, "/misty-project/chosen/src", "../docs")).toBe(
    "/misty-project/chosen/docs",
  );
  expect(() => resolveSdkFilesPath(folders, "/misty-project/chosen", "../elsewhere")).toThrow(
    "outside",
  );
  expect(() => resolveSdkFilesPath(folders, "/misty-project/chosen", "/Users/another")).toThrow(
    "Choose",
  );
});
