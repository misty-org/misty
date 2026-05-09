import type { FileEntry, ProviderRemote } from "@/native/contracts";
import { describe, expect, it, vi } from "vitest";
import { preparePickerSelections } from "./preparePickerSelections";

const remoteEntry: FileEntry = {
  id: "remote-file",
  name: "plan.pdf",
  path: "/mount/Work/plan.pdf",
  extension: "pdf",
  mimeType: "application/pdf",
  remoteModified: "2026-08-19T10:00:00Z",
  kind: "file",
  sizeBytes: 42,
  modifiedMs: null,
  createdMs: null,
  readonly: false,
  hidden: false,
  location: {
    kind: "remote",
    providerType: "drive",
    remoteName: "Work",
    remotePath: "Documents/plan.pdf",
  },
};

describe("provider-backed file picker preparation", () => {
  it("downloads remotely and preserves reusable-account provenance", async () => {
    const prepare = vi.fn().mockResolvedValue("/private/cache/plan.pdf");
    const remotes: ProviderRemote[] = [
      {
        name: "Work",
        type: "drive",
        statusLabel: "Connected",
        needsReconnect: false,
        error: null,
        configSource: "misty",
        connectionId: "cloud-1",
        connectionSource: "connected_account",
        connectedAccountId: "connection-1",
      },
    ];
    await expect(preparePickerSelections([remoteEntry], remotes, prepare)).resolves.toEqual([
      {
        localPath: "/private/cache/plan.pdf",
        source: {
          provider: "drive",
          remoteName: "Work",
          remotePath: "Documents/plan.pdf",
          connectionId: "cloud-1",
          connectionSource: "connected_account",
        },
      },
    ]);
    expect(prepare).toHaveBeenCalledWith(remoteEntry);
  });

  it("does not stage or invent provenance for local files", async () => {
    const local = {
      ...remoteEntry,
      path: "/Users/misty/plan.pdf",
      location: { ...remoteEntry.location, kind: "local" as const },
    };
    const prepare = vi.fn();
    await expect(preparePickerSelections([local], [], prepare)).resolves.toEqual([
      { localPath: "/Users/misty/plan.pdf" },
    ]);
    expect(prepare).not.toHaveBeenCalled();
  });
});
