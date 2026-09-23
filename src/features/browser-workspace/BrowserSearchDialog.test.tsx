import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { activeLayoutView, parseBrowserTabState, useWorkspaceStore } from "@/features/workspace";
import { BrowserSearchDialog } from "./BrowserSearchDialog";
import { useBrowserSearchStore } from "./search";
vi.mock("@/features/webviews/browserRuntime", () => ({ setBrowserWebviewsSuspended: vi.fn() }));
beforeEach(() => {
  useWorkspaceStore.getState().reset();
  useBrowserSearchStore.getState().show();
});
afterEach(() => {
  cleanup();
  useBrowserSearchStore.getState().close();
});
describe("browser search submission", () => {
  it("opens Google results as a native browser tab and closes the box", async () => {
    render(
      <MemoryRouter>
        <BrowserSearchDialog />
      </MemoryRouter>,
    );
    fireEvent.change(screen.getByRole("textbox", { name: "Search or enter a URL" }), {
      target: { value: "workspace sync" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Open in new tab" }));
    await waitFor(() => expect(useBrowserSearchStore.getState().open).toBe(false));
    const tab = activeLayoutView(useWorkspaceStore.getState().layout)!;
    expect(tab.surfaceId).toBe("browser");
    expect(tab.route).toBe("/browser");
    expect(parseBrowserTabState(tab.state).url).toBe(
      "https://www.google.com/search?q=workspace%20sync",
    );
  });
  it("does not create a tab for a blank submission", () => {
    render(
      <MemoryRouter>
        <BrowserSearchDialog />
      </MemoryRouter>,
    );
    const before = useWorkspaceStore.getState().layout;
    fireEvent.submit(screen.getByRole("textbox").closest("form")!);
    expect(useWorkspaceStore.getState().layout).toBe(before);
    expect(useBrowserSearchStore.getState().open).toBe(true);
  });
});
