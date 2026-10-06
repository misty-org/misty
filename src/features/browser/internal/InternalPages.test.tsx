import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createBookmarkFolder, saveBookmark } from "@/features/bookmarks/library";
import { useWorkspaceStore } from "@/features/workspace/useWorkspaceStore";
import { useBrowserDownloadsStore } from "../library/downloadsStore";
import { browserLibrary, type BrowserDownloadEntry } from "../library/native";
import { BookmarksPage } from "./BookmarksPage";
import { DownloadsPage } from "./DownloadsPage";
import { HistoryPage } from "./HistoryPage";

const actions = {
  navigate: vi.fn(),
  openInNewView: vi.fn(),
  openPage: vi.fn(),
  clearBrowsingData: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  useWorkspaceStore.getState().reset();
  useBrowserDownloadsStore.setState({ entries: [], loaded: false, error: null });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("opens folders with a breadcrumb and searches every folder without losing link actions", () => {
  const folderId = createBookmarkFolder("Research");
  saveBookmark({ title: "Reference", url: "https://example.com/reference", folderId });
  saveBookmark({ title: "Other", url: "https://example.com/other" });
  render(<BookmarksPage {...actions} />);
  expect(screen.getByRole("button", { name: "Other bookmarks" }).getAttribute("aria-pressed")).toBe(
    "true",
  );
  fireEvent.click(screen.getByRole("button", { name: /^Research/ }));
  expect(screen.getByRole("navigation", { name: "Folder path" }).textContent).toContain("Research");
  expect(screen.queryByText("Other")).toBeNull();
  fireEvent.change(screen.getByRole("searchbox", { name: "Search bookmarks" }), {
    target: { value: "missing" },
  });
  expect(screen.getByText("No matching bookmarks")).toBeTruthy();
  fireEvent.change(screen.getByRole("searchbox", { name: "Search bookmarks" }), {
    target: { value: "Reference" },
  });
  expect(screen.getByText("Other bookmarks / Research")).toBeTruthy();
  fireEvent.click(screen.getByTitle("https://example.com/reference"), { metaKey: true });
  expect(actions.openInNewView).toHaveBeenCalledWith("https://example.com/reference");
  fireEvent.change(screen.getByRole("searchbox", { name: "Search bookmarks" }), {
    target: { value: "" },
  });
  const path = screen.getByRole("navigation", { name: "Folder path" });
  fireEvent.click(within(path).getByRole("button", { name: "Other bookmarks" }));
  expect(screen.getByText("Other")).toBeTruthy();
  expect(screen.getAllByRole("heading").map((heading) => heading.textContent)).toEqual([
    "Bookmarks",
  ]);
  expect(screen.queryByText("Reference")).toBeNull();
});

it("keeps download search, opening, and removal wired to the existing library", async () => {
  const entry: BrowserDownloadEntry = {
    id: "download-1",
    fileName: "Report.pdf",
    url: "https://example.com/report.pdf",
    path: "/tmp/Report.pdf",
    state: "finished",
    received: 2048,
    total: 2048,
    error: null,
    startedAt: 1,
    finishedAt: 2,
    exists: true,
  };
  vi.spyOn(browserLibrary, "downloads").mockResolvedValue([entry]);
  const open = vi.spyOn(browserLibrary, "openDownload").mockResolvedValue();
  const remove = vi.spyOn(browserLibrary, "removeDownloads").mockResolvedValue();
  render(<DownloadsPage {...actions} />);
  fireEvent.click(await screen.findByRole("button", { name: "Report.pdf" }));
  expect(open).toHaveBeenCalledWith(entry.id);
  fireEvent.change(screen.getByRole("searchbox", { name: "Search downloads" }), {
    target: { value: "missing" },
  });
  expect(screen.getByText("No matching downloads")).toBeTruthy();
  fireEvent.change(screen.getByRole("searchbox", { name: "Search downloads" }), {
    target: { value: "Report" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Remove Report.pdf from the list" }));
  expect(remove).toHaveBeenCalledWith({ ids: [entry.id] });
  await waitFor(() => expect(browserLibrary.downloads).toHaveBeenCalledTimes(3));
});

it("preserves history selection, deletion and browsing-data controls", async () => {
  vi.spyOn(browserLibrary, "history").mockResolvedValue([
    { id: 1, title: "Example page", url: "https://example.com", visitedAt: Date.now() },
  ]);
  const remove = vi.spyOn(browserLibrary, "deleteVisits").mockResolvedValue();
  render(<HistoryPage {...actions} />);
  fireEvent.click(await screen.findByRole("checkbox", { name: "Select Example page" }));
  fireEvent.click(screen.getByRole("button", { name: "Delete 1 selected" }));
  expect(remove).toHaveBeenCalledWith([1]);
  await screen.findByText("No history yet");
  fireEvent.click(screen.getByRole("button", { name: "Clear browsing data…" }));
  expect(actions.clearBrowsingData).toHaveBeenCalledOnce();
});
