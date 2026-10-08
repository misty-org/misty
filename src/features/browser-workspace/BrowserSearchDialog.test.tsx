import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { activeLayoutView, parseBrowserViewState, useWorkspaceStore } from "@/features/workspace";
import { configureBrowserSearchEngine } from "@/features/workspace/browserSearchEngine";
import { BrowserSearchDialog } from "./BrowserSearchDialog";
import { useBrowserSearchStore } from "./search";
vi.mock("@/features/webviews/browserRuntime", () => ({
  onBrowserRuntimeClose: () => () => undefined,
  setBrowserWebviewsSuspended: vi.fn(),
}));
beforeEach(() => {
  useWorkspaceStore.getState().reset();
  useBrowserSearchStore.getState().show();
});
afterEach(() => {
  cleanup();
  useBrowserSearchStore.getState().close();
  configureBrowserSearchEngine("google");
});

function renderDialog() {
  render(
    <MemoryRouter>
      <BrowserSearchDialog />
    </MemoryRouter>,
  );
  return screen.getByRole("textbox", { name: "Search or enter a URL" });
}

function openedUrl() {
  const tab = activeLayoutView(useWorkspaceStore.getState().layout)!;
  expect(tab.surfaceId).toBe("browser");
  expect(tab.route).toBe("/browser");
  return parseBrowserViewState(tab.state).url;
}

describe("browser search submission", () => {
  it("opens a search with the chosen engine as a native browser tab and closes the box", async () => {
    configureBrowserSearchEngine("duckduckgo");
    fireEvent.change(renderDialog(), { target: { value: "workspace sync" } });
    fireEvent.click(screen.getByRole("button", { name: "Open in new tab" }));
    await waitFor(() => expect(useBrowserSearchStore.getState().open).toBe(false));
    expect(openedUrl()).toBe("https://duckduckgo.com/?q=workspace%20sync");
  });

  it("does not create a tab for a blank submission", () => {
    renderDialog();
    const before = useWorkspaceStore.getState().layout;
    fireEvent.submit(screen.getByRole("textbox").closest("form")!);
    expect(useWorkspaceStore.getState().layout).toBe(before);
    expect(useBrowserSearchStore.getState().open).toBe(true);
  });
});

describe("bangs", () => {
  it("lists shortcuts for a bare exclamation mark, grouped", () => {
    fireEvent.change(renderDialog(), { target: { value: "!" } });
    expect(screen.getByText("Misty")).toBeTruthy();
    expect(screen.getByText("Web")).toBeTruthy();
    expect(screen.getByRole("option", { name: /!bookmarks/ })).toBeTruthy();
    expect(screen.getByRole("option", { name: /!yt/ })).toBeTruthy();
  });

  it("turns a leading shortcut into a chip and searches that site", async () => {
    const input = renderDialog();
    fireEvent.change(input, { target: { value: "!yt " } });
    expect(screen.getByText("!yt")).toBeTruthy();
    expect(input.getAttribute("placeholder")).toBe("Search YouTube");
    fireEvent.change(input, { target: { value: "lo fi" } });
    fireEvent.submit(input.closest("form")!);
    await waitFor(() => expect(useBrowserSearchStore.getState().open).toBe(false));
    expect(openedUrl()).toBe("https://www.youtube.com/results?search_query=lo%20fi");
  });

  it("reads a trailing shortcut on submit", async () => {
    const input = renderDialog();
    fireEvent.change(input, { target: { value: "misty !gh" } });
    expect(screen.getByRole("option", { name: /Search GitHub/ })).toBeTruthy();
    fireEvent.submit(input.closest("form")!);
    await waitFor(() => expect(useBrowserSearchStore.getState().open).toBe(false));
    expect(openedUrl()).toBe("https://github.com/search?q=misty");
  });

  it("leaves a slash command as plain text", async () => {
    fireEvent.change(renderDialog(), { target: { value: "/files report" } });
    expect(screen.queryByText("!files")).toBeNull();
    expect(screen.getByRole("heading", { name: "Search or enter a URL" })).toBeTruthy();
  });

  it("shows bookmark actions for !b and clears the chip on Backspace", async () => {
    const input = renderDialog();
    fireEvent.change(input, { target: { value: "!b " } });
    expect(await screen.findByRole("option", { name: /Open bookmark manager/ })).toBeTruthy();
    expect(screen.getByRole("option", { name: /Bookmark all tabs/ })).toBeTruthy();
    fireEvent.keyDown(input, { key: "Backspace" });
    expect(screen.queryByText("!bookmarks")).toBeNull();
  });

  it("opens the bookmark manager from !bookmarks", async () => {
    const input = renderDialog();
    fireEvent.change(input, { target: { value: "!bookmarks " } });
    await screen.findByRole("option", { name: /Open bookmark manager/ });
    fireEvent.submit(input.closest("form")!);
    await waitFor(() => expect(useBrowserSearchStore.getState().open).toBe(false));
    expect(
      parseBrowserViewState(activeLayoutView(useWorkspaceStore.getState().layout)!.state).url,
    ).toBe("misty://bookmarks");
  });
});
