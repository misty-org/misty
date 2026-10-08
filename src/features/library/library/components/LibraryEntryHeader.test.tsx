import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LibraryEntryHeader } from "./LibraryEntryHeader";
import { SpaceLibraryItems } from "./SpaceLibraryItems";
const fixture = vi.hoisted(() => ({
  data: {} as Record<string, unknown>,
  select: vi.fn(),
  restore: vi.fn(),
  picker: vi.fn(),
  album: vi.fn(),
}));
vi.mock("../SpaceLibraryContext", () => ({
  useSpaceLibraryContext: () => ({
    data: fixture.data,
    collectionActions: { selectCollection: fixture.select, openCreateAlbum: fixture.album },
    itemActions: { restoreItem: fixture.restore },
  }),
}));
vi.mock("@/features/spaces/useSpaceItemCreator", () => ({
  useSpaceItemCreator: () => () => "Alex",
}));
beforeEach(() => {
  fixture.data = {
    collection: "recent",
    spaceId: "test",
    searchInput: "",
    setSearchInput: vi.fn(),
    setSearchFocused: vi.fn(),
    canUploadLibrary: true,
    canEditLibrary: true,
    canCopyLibrary: true,
    uploadJobs: [],
    setUploadJobs: vi.fn(),
    setFilePickerOpen: fixture.picker,
    mediaType: "",
    sort: "added_at",
    direction: "desc",
    libraryViewMode: "list",
    setLibraryViewMode: vi.fn(),
    displayItems: [
      {
        id: "file",
        display_name: "Reading.pdf",
        added_at: "2026-09-30T00:00:00Z",
        file: { original_filename: "Reading.pdf", intrinsic_metadata: {} },
      },
    ],
  };
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
it("opens the existing uploader and routes Trash through Library collection actions", () => {
  render(<LibraryEntryHeader />);
  fireEvent.click(screen.getByRole("button", { name: "Upload files" }));
  expect(fixture.picker).toHaveBeenCalledWith(true);
  fireEvent.click(screen.getByRole("button", { name: "Trash" }));
  expect(fixture.select).toHaveBeenCalledWith("deleted");
});
it("restores a trashed item through the existing mutation", () => {
  fixture.data.collection = "deleted";
  render(
    <>
      <LibraryEntryHeader />
      <SpaceLibraryItems />
    </>,
  );
  expect(screen.queryByRole("button", { name: "Upload files" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Restore" }));
  expect(fixture.restore).toHaveBeenCalledWith((fixture.data.displayItems as unknown[])[0]);
});
it("respects upload permissions and exposes album creation separately", () => {
  fixture.data.canUploadLibrary = false;
  fixture.data.collection = "albums";
  render(<LibraryEntryHeader />);
  expect(screen.queryByRole("button", { name: "Upload files" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "New album" }));
  expect(fixture.album).toHaveBeenCalled();
});
