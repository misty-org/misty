import { act, render, screen, waitFor } from "@testing-library/react";
import { expect, it } from "vitest";
import { createSdkCodeFileFixture } from "@/features/coding-workspace/sdkCodeProject.fixture";
import { createSdkFilesStore } from "./sdkFilesStore";
import { createSdkFilesPreviewRuntime } from "./sdkFilesPreview";
import { createSdkFilesInspector } from "./sdkFilesInspector";
import { FileInspectorView } from "./explorer/components/FileInspectorView";

it("previews a selected file and clears its content for multiple or empty selections", async () => {
  const fixture = createSdkCodeFileFixture();
  const lifetime = new AbortController();
  const files = createSdkFilesStore(fixture.sdk, lifetime.signal);
  const preview = createSdkFilesPreviewRuntime(files, {
    Error: ({ error }) => <p role="alert">{String(error)}</p>,
  });
  const runtime = createSdkFilesInspector(files, preview);
  const folder = (await files.openFolder())!;
  await files.navigate(`${folder.root}/src`);
  const listing = files.store.getState().pane.listing!;
  const entry = listing.entries[0];
  const props = { runtime, listing, directorySizes: {}, onOpenEntry: () => {} };
  const view = render(<FileInspectorView {...props} selectedEntry={entry} selectedCount={1} />);
  try {
    await screen.findByText("const value = 1;");
    expect(screen.getByRole("button", { name: `Open preview of ${entry.name}` })).toBeTruthy();
    view.rerender(<FileInspectorView {...props} selectedEntry={entry} selectedCount={2} />);
    await waitFor(() => expect(screen.queryByText("const value = 1;")).toBeNull());
    expect(screen.getByText("2 items")).toBeTruthy();
    expect(screen.queryByRole("button", { name: `Open preview of ${entry.name}` })).toBeNull();
    view.rerender(<FileInspectorView {...props} selectedEntry={null} selectedCount={0} />);
    expect(screen.getByText("Select a file to preview it and view its details.")).toBeTruthy();
  } finally {
    view.unmount();
    await act(async () => lifetime.abort());
  }
});
