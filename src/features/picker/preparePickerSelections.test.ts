import type { FileEntry } from "@/native/contracts";
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

describe("local and LAN file picker preparation", () => {
  it("rejects retired cloud locations before materializing", async () => {
    const prepare = vi.fn();
    await expect(preparePickerSelections([remoteEntry], prepare)).rejects.toThrow(
      "Only local and LAN",
    );
    expect(prepare).not.toHaveBeenCalled();
  });

  it("materializes paired device files without a cloud connection", async () => {
    const peer = {
      ...remoteEntry,
      path: "misty://device/laptop/docs/plan.pdf",
      location: {
        kind: "peer_device" as const,
        peerDeviceId: "laptop",
        peerRootId: "docs",
        providerType: null,
        remoteName: null,
        remotePath: "plan.pdf",
      },
    };
    const prepare = vi.fn().mockResolvedValue("/private/cache/plan.pdf");
    await expect(preparePickerSelections([peer], prepare)).resolves.toEqual([
      {
        localPath: "/private/cache/plan.pdf",
        source: { provider: "misty_peer", remoteName: "laptop", remotePath: "plan.pdf" },
      },
    ]);
    expect(prepare).toHaveBeenCalledWith(peer);
  });

  it("does not stage or invent provenance for local files", async () => {
    const local = {
      ...remoteEntry,
      path: "/Users/misty/plan.pdf",
      location: { ...remoteEntry.location, kind: "local" as const },
    };
    const prepare = vi.fn();
    await expect(preparePickerSelections([local], prepare)).resolves.toEqual([
      { localPath: "/Users/misty/plan.pdf" },
    ]);
    expect(prepare).not.toHaveBeenCalled();
  });
});
