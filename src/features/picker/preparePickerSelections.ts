import type { FileEntry } from "@/native/ipc";

export interface MistyFilePickerPreparedSelection {
  localPath: string;
  source?: {
    provider: string;
    remoteName: string;
    remotePath: string;
  };
}

export async function preparePickerSelections(
  entries: FileEntry[],
  prepareDevice: (entry: FileEntry) => Promise<string>,
): Promise<MistyFilePickerPreparedSelection[]> {
  return Promise.all(
    entries.map(async (entry) => {
      if (entry.location.kind === "local") return { localPath: entry.path };
      if (entry.location.kind !== "peer_device")
        throw new Error("Only local and LAN device files are supported.");
      return {
        localPath: await prepareDevice(entry),
        source: {
          provider: "misty_peer",
          remoteName: entry.location.peerDeviceId || "Device",
          remotePath: entry.location.remotePath || entry.path,
        },
      };
    }),
  );
}
