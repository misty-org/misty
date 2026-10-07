import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { FolderLibraryStatus, SmartLibraryAsset } from "@/native/ipc";
import { LibraryWorkspace } from "./LibraryWorkspace";

const fixture = vi.hoisted(() => ({
  loaded: true,
  phase: "idle",
  library: null as FolderLibraryStatus | null,
  error: null,
  pendingDrop: null,
  load: vi.fn(),
  addFiles: vi.fn(),
  analyzeFolder: vi.fn(),
  setAssetTags: vi.fn(),
  confirmDroppedFiles: vi.fn(),
  cancelDroppedFiles: vi.fn(),
}));
vi.mock("@/features/library/library", () => ({
  useSmartLibraryStore: (select: (state: typeof fixture) => unknown) => select(fixture),
}));
vi.mock("./libraryWorkspace/useSemanticAssetSearch", () => ({
  useSemanticAssetSearch: () => ({ semanticAssetIds: null, semanticSearching: false }),
}));
vi.mock("./libraryWorkspace/useSmartFolders", () => ({
  useSmartFolders: () => ({ savedSearches: [], folderResults: [] }),
}));
vi.mock("@/features/picker", () => ({
  MistyFilePicker: ({ onSelect }: { onSelect: (path: string) => void }) => (
    <button onClick={() => onSelect("/files/photo.png")}>Choose photo</button>
  ),
}));
vi.mock("./libraryWorkspace/LibraryGallery", () => ({
  LibraryGallery: () => <div>File gallery</div>,
  LibraryAssetViewer: ({ asset }: { asset: SmartLibraryAsset }) => <div>Preview: {asset.name}</div>,
}));

beforeEach(() => {
  fixture.loaded = true;
  fixture.library = null;
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it("keeps the shared controls and table headers visible for an empty catalog, and adds files", () => {
  render(<LibraryWorkspace />);
  expect(screen.getByRole("textbox", { name: "Search Smart Library" })).toBeTruthy();
  expect(screen.getByRole("table")).toBeTruthy();
  expect(screen.getByRole("columnheader", { name: "Size" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Choose columns" })).toBeTruthy();
  expect(screen.getByText("No files in Library")).toBeTruthy();
  expect(screen.getAllByRole("button", { name: "Add files" })).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "Add files" }));
  fireEvent.click(screen.getByRole("button", { name: "Choose photo" }));
  expect(fixture.addFiles).toHaveBeenCalledWith(["/files/photo.png"]);
});

it("sorts sizes numerically, searches local assets, opens previews, and switches view", () => {
  const assets = [
    { assetId: "large", name: "A.png", sizeBytes: 10000 },
    { assetId: "small", name: "B.png", sizeBytes: 2000 },
  ].map((asset): SmartLibraryAsset => ({
    ...asset,
    status: "analyzed",
    extension: "png",
    tags: ["Travel"],
    collections: [],
    modifiedMs: 0,
    relativePath: asset.name,
    mimeType: "image/png",
    fingerprint: asset.assetId,
    sourceKind: "local",
    previewSupported: true,
    unsupportedReason: null,
    description: null,
    confidence: null,
    failure: null,
  }));
  fixture.library = {
    assets,
    rootPath: "/files",
    preflight: { pilotCappedImages: 0 },
  } as FolderLibraryStatus;
  render(<LibraryWorkspace />);
  fireEvent.click(screen.getByRole("button", { name: "Size" }));
  const rows = within(screen.getByRole("table")).getAllByRole("row");
  expect(rows[1].textContent).toContain("B.png");
  fireEvent.click(screen.getByText("B.png"));
  expect(screen.getByText("Preview: B.png")).toBeTruthy();
  fireEvent.change(screen.getByRole("textbox", { name: "Search Smart Library" }), {
    target: { value: "A.png" },
  });
  expect(within(screen.getByRole("table")).queryByText("B.png")).toBeNull();
  expect(within(screen.getByRole("table")).getByText("A.png")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Grid view" }));
  expect(screen.queryByRole("table")).toBeNull();
  expect(screen.getByText("File gallery")).toBeTruthy();
});

it("uses the selected layout for initial loading", () => {
  fixture.loaded = false;
  render(<LibraryWorkspace />);
  expect(
    screen.getByRole("status", { name: "Loading Smart Library" }).getAttribute("aria-busy"),
  ).toBe("true");
  expect(screen.queryByText("No files in Library")).toBeNull();
});
