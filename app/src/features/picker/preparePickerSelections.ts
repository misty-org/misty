import type { FileEntry, ProviderRemote } from "@/native/contracts";

export interface MistyFilePickerPreparedSelection {
  localPath: string;
  source?: {
    provider: string;
    remoteName: string;
    remotePath: string;
    connectionId?: string;
    connectionSource?: "connected_account" | "legacy_cloud";
  };
}

export async function preparePickerSelections(
  entries: FileEntry[],
  remotes: ProviderRemote[],
  prepareRemote: (entry: FileEntry) => Promise<string>,
): Promise<MistyFilePickerPreparedSelection[]> {
  return Promise.all(
    entries.map(async (entry) => {
      if (entry.location.kind === "local") return { localPath: entry.path };
      const remote = remotes.find((candidate) => candidate.name === entry.location.remoteName);
      return {
        localPath: await prepareRemote(entry),
        source: {
          provider: entry.location.providerType || remote?.type || "remote",
          remoteName: entry.location.remoteName || remote?.name || "Remote",
          remotePath: entry.location.remotePath || entry.path,
          connectionId: remote?.connectionId || undefined,
          connectionSource: remote?.connectionSource || undefined,
        },
      };
    }),
  );
}
