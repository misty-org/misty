import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useWorkspaceStore, type WorkspaceView } from "@/features/app-windows";
import { browserLibrary } from "../library/native";
import { ClearBrowsingDataDialog } from "./BrowserClearDataDialog";

const closed = {
  view: { id: "v", title: "Google" } as WorkspaceView,
  windowId: "window-1",
  paneId: "p",
};

afterEach(() => vi.restoreAllMocks());

describe("clearing browsing data", () => {
  it("empties the recently closed tabs along with the history", async () => {
    const clear = vi.spyOn(browserLibrary, "clearHistory").mockResolvedValue();
    vi.spyOn(browserLibrary, "clearWebsiteData").mockResolvedValue();
    useWorkspaceStore.setState({ closedItems: [closed] });
    render(<ClearBrowsingDataDialog open onOpenChange={() => undefined} onCleared={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: "Clear data" }));
    await waitFor(() => expect(clear).toHaveBeenCalled());
    await waitFor(() => expect(useWorkspaceStore.getState().closedItems).toEqual([]));
  });
});
