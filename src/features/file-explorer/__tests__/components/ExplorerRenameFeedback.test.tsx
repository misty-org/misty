import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { InlineNameEditor } from "../../components/FileBrowserInline";
import { ExplorerNotifications, ExplorerRenameStatus } from "../../workspace/ExplorerDesktopStatus";
import { useExplorerStore, type ExplorerInlineEditState } from "../../store";

const invalidRename: ExplorerInlineEditState = {
  paneId: "pane",
  kind: "rename",
  itemKind: "file",
  entryId: "entry",
  originalName: "before.txt",
  value: "",
  lockedExtension: ".txt",
  error: "Name cannot be empty.",
};

describe("Explorer rename feedback", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    useExplorerStore.setState({ inlineEdit: null, notifications: [], panes: {} });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it("keeps validation text out of the inline editor", async () => {
    await act(async () =>
      root.render(
        <InlineNameEditor
          edit={invalidRename}
          onChange={() => undefined}
          onCommit={() => undefined}
          onCancel={() => undefined}
        />,
      ),
    );
    expect(container.textContent).not.toContain(invalidRename.error);
    expect(container.querySelector('input[aria-label="Rename item"]')).not.toBeNull();
    await act(async () => root.render(<ExplorerRenameStatus edit={invalidRename} />));
    expect(container.textContent).toBe("");
  });

  it("pushes invalid rename feedback into the top notification stack", async () => {
    useExplorerStore.setState({ inlineEdit: invalidRename, notifications: [], panes: {} });
    await act(async () => useExplorerStore.getState().commitInlineEdit());
    const currentNotifications = useExplorerStore.getState().notifications;
    const notification = currentNotifications[currentNotifications.length - 1];
    expect(notification).toMatchObject({ message: invalidRename.error, type: "error" });

    await act(async () =>
      root.render(
        <ExplorerNotifications
          notifications={notification ? [notification] : []}
          onDismiss={() => undefined}
        />,
      ),
    );
    expect(container.firstElementChild?.className).toContain("top-3");
    expect(container.firstElementChild?.className).not.toContain("top-[58px]");
  });
});
