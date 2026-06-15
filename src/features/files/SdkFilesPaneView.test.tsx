import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { createSdkCodeFileFixture } from "@/features/coding-workspace/sdkCodeProject.fixture";
import { createSdkFilesStore } from "./sdkFilesStore";
import { createSdkFilesThumbnails } from "./sdkFilesThumbnails";
import { SdkFilesPaneView } from "./SdkFilesPaneView";

it("keeps Trash contents when deletion is cancelled and removes them only after confirmation", async () => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  const fixture = createSdkCodeFileFixture(),
    lifetime = new AbortController();
  const files = createSdkFilesStore(fixture.sdk, lifetime.signal);
  const thumbnails = createSdkFilesThumbnails(files, lifetime.signal);
  const element = document.createElement("div");
  document.body.append(element);
  const root = createRoot(element);
  try {
    const folder = (await files.openFolder())!;
    await files.navigate(`${folder.root}/src`);
    files.select(`${folder.root}/src/${fixture.file.name}`);
    await files.deleteSelected();
    await files.openTrash();
    files.select(files.store.getState().pane.listing!.entries[0].id);
    await act(async () =>
      root.render(
        <SdkFilesPaneView
          files={files}
          paneId="files"
          runtime={{
            ...thumbnails,
            thumbnailPreviewsEnabled: true,
            compactModeEnabled: false,
            Error: ({ error }) => <p role="alert">{error}</p>,
          }}
          itemScale={1}
          directorySizes={{}}
          cutPaths={new Set()}
          onOpenFile={vi.fn()}
          onDropItems={vi.fn()}
          menuEntries={() => []}
        />,
      ),
    );
    const button = (label: string) =>
      [...document.querySelectorAll<HTMLButtonElement>("[role=alertdialog] button")].find(
        (button) => button.textContent === label,
      )!;
    await act(async () => {
      await files.deleteSelected();
    });
    expect(document.querySelector("[role=alertdialog]")?.textContent).toContain(
      "Delete Permanently",
    );
    await act(async () => button("Cancel").click());
    expect(files.store.getState().dialog).toBeNull();
    expect(files.store.getState().pane.listing!.entries).toHaveLength(1);
    await act(async () => {
      await files.deleteSelected();
    });
    await act(async () => {
      button("Delete").click();
    });
    await act(async () => {
      await vi.waitFor(() => expect(files.store.getState().pane.listing!.entries).toHaveLength(0));
    });
    expect(document.querySelector("[role=alertdialog]")).toBeNull();
  } finally {
    await act(async () => root.unmount());
    thumbnails.close();
    lifetime.abort();
    await files.close();
    element.remove();
    vi.unstubAllGlobals();
  }
  expect(fixture.handles.size).toBe(0);
});
