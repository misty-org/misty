import { cleanup, fireEvent, render as renderBare, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LibraryEntryHeader, mediaTab } from "./LibraryEntryHeader";
import { createVideoProject } from "../library-viewer/videoProjects";
import { SpaceLibraryEmptyState } from "./SpaceLibraryEmptyState";
import { SpaceLibraryItems } from "./SpaceLibraryItems";
const fixture = vi.hoisted(() => ({
  data: {} as Record<string, unknown>,
  select: vi.fn(),
  restore: vi.fn(),
  picker: vi.fn(),
}));
/** The header names its Space with a link back to it, so it renders inside a router. */
const render = (ui: ReactElement) => renderBare(<MemoryRouter>{ui}</MemoryRouter>);

vi.mock("../library-viewer/videoProjects", () => ({ createVideoProject: vi.fn() }));
// jsdom has no WebCodecs; New offers videos as on a computer that has them.
vi.mock("@/features/files", async (original) => ({
  ...(await original<object>()),
  canEditVideo: () => true,
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
/** Opens Media's New menu, as a pointer press does. */
const openNew = () =>
  fireEvent.pointerDown(screen.getByRole("button", { name: "New" }), { button: 0, ctrlKey: false });

it("opens the existing uploader and routes Trash through Media collection actions", () => {
  render(<LibraryEntryHeader />);
  openNew();
  fireEvent.click(screen.getByRole("menuitem", { name: "Upload files" }));
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
  expect(screen.queryByRole("button", { name: "New" })).toBeNull();
  fireEvent.contextMenu(screen.getByRole("button", { name: "Reading.pdf" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "Restore" }));
  expect(fixture.restore).toHaveBeenCalledWith((fixture.data.displayItems as unknown[])[0]);
});
it("leaves Upload to the empty state while Media has no files", () => {
  fixture.data.displayItems = [];
  render(<LibraryEntryHeader />);
  expect(screen.queryByRole("button", { name: "New" })).toBeNull();
});
it("shows Media's empty state with Upload when it has no files", () => {
  fixture.data.displayItems = [];
  render(<SpaceLibraryEmptyState {...emptyProps} />);
  fireEvent.click(screen.getByRole("button", { name: "Upload files" }));
  expect(emptyProps.onUpload).toHaveBeenCalled();
  expect(screen.getByRole("heading", { name: "No files yet" })).toBeTruthy();
});
it("hides upload while Media is read-only", () => {
  fixture.data.canUploadLibrary = false;
  render(<LibraryEntryHeader />);
  expect(screen.queryByRole("button", { name: "New" })).toBeNull();
});

it("shows a tab for each kind of file, and a kind tab filters to that kind", () => {
  fixture.data.setMediaType = vi.fn();
  render(<LibraryEntryHeader />);
  for (const name of ["All", "Photos", "Videos", "Audio", "Documents", "Trash"])
    expect(screen.getByRole("button", { name })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Videos" }));
  expect(fixture.select).toHaveBeenCalledWith("recent");
  expect(fixture.data.setMediaType).toHaveBeenCalledWith("video");
  fireEvent.click(screen.getByRole("button", { name: "All" }));
  expect(fixture.data.setMediaType).toHaveBeenLastCalledWith("");
});

it.each([
  ["recent", "", "recent"],
  ["recent", "image", "image"],
  ["recent", "selfies", "recent"],
  ["deleted", "video", "deleted"],
] as const)("in %s with %s, the %s tab is open", (collection, mediaType, tab) => {
  expect(mediaTab(collection, mediaType)).toBe(tab);
});

it("makes a video, empty or from the photos and videos selected, and opens it", async () => {
  const made = { id: "p9" };
  vi.mocked(createVideoProject).mockResolvedValue(made as never);
  fixture.data.setItems = vi.fn();
  fixture.data.setSelectedItemId = vi.fn();
  fixture.data.selectedItems = [
    {
      id: "v1",
      file: {
        original_filename: "a.mp4",
        intrinsic_metadata: { client_declared_mime_type: "video/mp4" },
      },
    },
    { id: "d1", file: { original_filename: "notes.pdf", intrinsic_metadata: {} } },
  ];
  render(<LibraryEntryHeader />);
  openNew();
  fireEvent.click(screen.getByRole("menuitem", { name: "Video from selection" }));
  await waitFor(() => expect(fixture.data.setSelectedItemId).toHaveBeenCalledWith("p9"));
  expect(createVideoProject).toHaveBeenCalledWith("test", "Untitled video", ["v1"]);
});

it("offers a video from the selection only when photos or videos are selected", () => {
  fixture.data.selectedItems = [];
  render(<LibraryEntryHeader />);
  openNew();
  expect(screen.getByRole("menuitem", { name: "New video" })).toBeTruthy();
  expect(screen.queryByRole("menuitem", { name: "Video from selection" })).toBeNull();
});
