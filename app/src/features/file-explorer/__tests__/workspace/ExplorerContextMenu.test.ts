import type { FileEntry } from "@/services/misty/model/misty-api";
import { describe, expect, it, vi } from "vitest";

const backendMocks = vi.hoisted(() => ({
  archiveExtract: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({
  writeText: vi.fn(),
}));

vi.mock("@/services/backend", () => ({
  archiveList: vi.fn(),
  archiveCreate: vi.fn(),
  archiveExtract: backendMocks.archiveExtract,
  fileToolsChecksum: vi.fn(),
  fileToolsCreateSymlink: vi.fn(),
  fileToolsReadSymlink: vi.fn(),
  openTerminalAtPath: vi.fn(),
  providersJobStatus: vi.fn(),
  providersVerifyResult: vi.fn(),
  providersVerifyStart: vi.fn(),
}));

const explorerStoreMocks = vi.hoisted(() => ({
  pushNotification: vi.fn(),
  refreshPane: vi.fn(),
}));

vi.mock("../../store", () => ({
  selectedDeletePathsForPane: vi.fn(() => []),
  selectedPathsForPane: vi.fn(() => []),
  useExplorerStore: {
    getState: () => ({
      panes: {},
      pushNotification: explorerStoreMocks.pushNotification,
      refreshPane: explorerStoreMocks.refreshPane,
    }),
  },
}));

vi.mock("@/features/app-shell", () => ({
  selectShortcutPreferences: vi.fn(() => ({ shortcutHintsEnabled: false })),
  useSettingsStore: vi.fn(),
}));

vi.mock("./ExplorerAgentPanels", () => ({
  clearSelectionsAcrossPanes: vi.fn(),
  selectedCountAcrossPanes: vi.fn(() => 0),
}));

const { canActOnLocalArchiveFile, extractArchiveHere, extractArchiveTo } =
  await import("../../workspace/ExplorerContextMenu");

function archiveEntry(overrides: Partial<FileEntry> = {}): FileEntry {
  return {
    id: "entry-1",
    name: "backup.zip",
    path: "/Users/misty/Downloads/backup.zip",
    kind: "file",
    isDeleted: false,
    location: { kind: "local", providerType: null, remoteName: null, remotePath: null },
    sizeBytes: 1024,
    modifiedMs: 0,
    ...overrides,
  } as FileEntry;
}

describe("canActOnLocalArchiveFile", () => {
  it("allows a local archive file when nothing in the selection is remote", () => {
    expect(canActOnLocalArchiveFile(archiveEntry(), false)).toBe(true);
  });

  it("blocks a remote archive file — local archive tools cannot read a misty:// path", () => {
    const remoteEntry = archiveEntry({
      location: {
        kind: "remote",
        providerType: "drive",
        remoteName: "gdrive",
        remotePath: "/backup.zip",
      },
    });
    expect(canActOnLocalArchiveFile(remoteEntry, true)).toBe(false);
  });

  it("blocks when the selection contains a remote item even if the target entry itself is local", () => {
    // Mirrors how hasRemoteSelection is derived from the whole pane selection,
    // not just the right-clicked entry — matches the gate every other local-only
    // action (compress, symlink, terminal) already uses.
    expect(canActOnLocalArchiveFile(archiveEntry(), true)).toBe(false);
  });

  it("blocks a non-archive file", () => {
    expect(canActOnLocalArchiveFile(archiveEntry({ path: "/Users/misty/notes.txt" }), false)).toBe(
      false,
    );
  });

  it("blocks a folder even if its name ends in an archive extension", () => {
    expect(
      canActOnLocalArchiveFile(
        archiveEntry({ kind: "folder", path: "/Users/misty/old.zip" }),
        false,
      ),
    ).toBe(false);
  });

  it("blocks when there is no target entry", () => {
    expect(canActOnLocalArchiveFile(null, false)).toBe(false);
  });
});

describe("archive extraction refreshes the pane it was invoked from", () => {
  // Regression test: the context menu closes (and clears its stored paneId)
  // before these functions run their async work. They used to read paneId back
  // out of the already-cleared store state, so refreshPane never fired even
  // though the extract itself succeeded. Passing paneId as an argument fixed it.

  it("extractArchiveHere refreshes the pane it was extracted into", async () => {
    backendMocks.archiveExtract.mockResolvedValue({ message: "Extracted 3 files." });

    await extractArchiveHere("/Users/misty/Downloads/backup.zip", "pane-42");

    expect(explorerStoreMocks.refreshPane).toHaveBeenCalledWith("pane-42");
    expect(explorerStoreMocks.pushNotification).toHaveBeenCalledWith(
      "Extracted 3 files.",
      "success",
      4500,
    );
  });

  it("extractArchiveTo refreshes the pane it was extracted into", async () => {
    backendMocks.archiveExtract.mockResolvedValue({ message: "Extracted 3 files." });
    vi.stubGlobal(
      "window",
      Object.assign(Object.create(window), { prompt: () => "/Users/misty/Documents/backup" }),
    );

    await extractArchiveTo("/Users/misty/Downloads/backup.zip", "pane-42");

    expect(explorerStoreMocks.refreshPane).toHaveBeenCalledWith("pane-42");
    vi.unstubAllGlobals();
  });

  it("does not refresh when the archive extraction fails", async () => {
    explorerStoreMocks.refreshPane.mockClear();
    backendMocks.archiveExtract.mockRejectedValue(new Error("disk full"));

    await extractArchiveHere("/Users/misty/Downloads/backup.zip", "pane-42");

    expect(explorerStoreMocks.refreshPane).not.toHaveBeenCalled();
    expect(explorerStoreMocks.pushNotification).toHaveBeenCalledWith(
      "Extract failed: disk full",
      "error",
      5500,
    );
  });
});
