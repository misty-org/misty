import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LibraryEntryHeader } from "./LibraryEntryHeader";
import { SpaceLibraryEmptyState } from "./SpaceLibraryEmptyState";
import { SpaceLibraryItems } from "./SpaceLibraryItems";
const fixture = vi.hoisted(() => ({
  data: {} as Record<string, unknown>,
  select: vi.fn(),
  restore: vi.fn(),
  picker: vi.fn(),
}));
vi.mock("../SpaceLibraryContext", () => ({
  useSpaceLibraryContext: () => ({
    data: fixture.data,
    collectionActions: { selectCollection: fixture.select },
    itemActions: { restoreItem: fixture.restore },
  }),
}));
vi.mock("@/features/spaces/overview/useSpaceItemCreator", () => ({
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
        tags: [],
        file: { original_filename: "Reading.pdf", intrinsic_metadata: {} },
      },
    ],
  };
});
const emptyProps = {
  collection: "recent",
  searching: false,
  uploadAvailable: true,
  uploading: false,
  uploadDisabled: false,
  onUpload: vi.fn(),
};
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
  fireEvent.contextMenu(screen.getByRole("button", { name: "Reading.pdf" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "Restore" }));
  expect(fixture.restore).toHaveBeenCalledWith((fixture.data.displayItems as unknown[])[0]);
});
it("leaves Upload to the empty state while the Library has no files", () => {
  fixture.data.displayItems = [];
  render(<LibraryEntryHeader />);
  expect(screen.queryByRole("button", { name: "Upload files" })).toBeNull();
});
it("shows the Library's empty state with Upload when it has no files", () => {
  fixture.data.displayItems = [];
  render(<SpaceLibraryEmptyState {...emptyProps} />);
  fireEvent.click(screen.getByRole("button", { name: "Upload files" }));
  expect(emptyProps.onUpload).toHaveBeenCalled();
  expect(screen.getByRole("heading", { name: "No files yet" })).toBeTruthy();
});
it("hides upload while the Library is read-only", () => {
  fixture.data.canUploadLibrary = false;
  render(<LibraryEntryHeader />);
  expect(screen.queryByRole("button", { name: "Upload files" })).toBeNull();
});
