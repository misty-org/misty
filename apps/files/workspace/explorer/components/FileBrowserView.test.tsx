import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { createSdkCodeFileFixture } from "@/features/coding-workspace/sdkCodeProject.fixture";
import { openSdkFilesDirectory } from "../../sdkFilesDirectory";
import { FileBrowserView } from "./FileBrowserView";
import { FileBrowserRuntimeProvider } from "./fileBrowser/FileBrowserRuntime";
import type { FileBrowserProps } from "../model/interfaces/components/FileBrowser";

it("renders the existing list/grid and filtering with SDK data and owning-view services", async () => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  const fixture = createSdkCodeFileFixture();
  const directory = (await openSdkFilesDirectory(fixture.sdk))!;
  const listing = await directory.list({ path: `${directory.root}/src` });
  const element = document.createElement("div");
  document.body.append(element);
  const root = createRoot(element);
  const opened = vi.fn();
  const runtime = {
    thumbnailPreviewsEnabled: true,
    compactModeEnabled: false,
    prewarmThumbnails: vi.fn(),
    requestThumbnail: vi.fn(() => () => undefined),
    Error: ({ error }: { error: string }) => <div role="alert">{error}</div>,
  };
  const props: FileBrowserProps = {
    paneId: "sdk-files-pane",
    listing,
    selectedIds: [],
    loading: false,
    error: null,
    viewMode: "list",
    sort: { column: "name", direction: "asc" },
    showHidden: false,
    commandQuery: "",
    commandQueryMode: "filter",
    directorySizes: {},
    cutPaths: new Set(),
    inlineEdit: null,
    onSort: vi.fn(),
    onToggleHidden: vi.fn(),
    onSelect: vi.fn(),
    onClearSelection: vi.fn(),
    onOpen: opened,
    onContextMenu: vi.fn(),
    onBackgroundContextMenu: vi.fn(),
    onDropItems: vi.fn(),
    onInlineEditChange: vi.fn(),
    onInlineEditCommit: vi.fn(),
    onInlineEditCancel: vi.fn(),
  };
  const render = async () =>
    act(async () =>
      root.render(
        <FileBrowserRuntimeProvider value={runtime}>
          <FileBrowserView {...props} />
        </FileBrowserRuntimeProvider>,
      ),
    );
  try {
    await render();
    expect(element.textContent).toContain(fixture.file.name);
    expect(runtime.prewarmThumbnails).toHaveBeenCalledWith(listing.entries);
    const row = [...element.querySelectorAll("tr")].find((row) =>
      row.textContent?.includes(fixture.file.name),
    )!;
    await act(async () => row.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
    expect(opened).toHaveBeenCalledWith(listing.entries[0]);
    props.commandQuery = "missing-file";
    await render();
    expect(element.textContent).not.toContain(fixture.file.name);
    props.commandQuery = "";
    props.viewMode = "grid";
    await render();
    expect(element.textContent).toContain(fixture.file.name);
    props.error = "Folder disconnected";
    await render();
    expect(element.querySelector('[role="alert"]')?.textContent).toBe("Folder disconnected");
  } finally {
    await act(async () => root.unmount());
    element.remove();
    await directory.close();
    vi.unstubAllGlobals();
  }
});
