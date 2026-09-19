import type { MistyAppSDK } from "@misty/sdk";
import {
  parseSdkCodeProjectReference,
  type SdkCodeProjectReference,
} from "@/features/coding-workspace/sdkCodeProjectReference";
import {
  openSdkFilesDirectory,
  transferSdkFilesEntry,
  type SdkFilesDirectory,
} from "./sdkFilesDirectory";
import type { FileEntry } from "@/native/contracts";

interface TrashRecord {
  version: 1;
  id: string;
  originalFolder: SdkCodeProjectReference;
  originalFolderName: string;
  parent: string;
  name: string;
  deletedAt: number;
}
export interface SdkFilesTrashItem {
  id: string;
  entry: FileEntry;
  originalFolderName: string;
  originalParent: string;
  deletedAt: number;
}
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
function readRecord(value: unknown, id: string): TrashRecord {
  const record = value as Partial<TrashRecord> | null;
  if (
    !record ||
    record.version !== 1 ||
    record.id !== id ||
    !uuid.test(id) ||
    typeof record.parent !== "string" ||
    (record.parent !== "" &&
      record.parent.split("/").some((part) => !part || part === "." || part === "..")) ||
    typeof record.originalFolderName !== "string" ||
    typeof record.name !== "string" ||
    !record.name ||
    /[/\0]/.test(record.name) ||
    !Number.isSafeInteger(record.deletedAt) ||
    record.deletedAt! < 0
  )
    throw new Error("This Trash item's recovery information is invalid.");
  return {
    ...record,
    originalFolder: parseSdkCodeProjectReference(record.originalFolder),
  } as TrashRecord;
}

/** Persistent recovery records and bytes share the native app/account/Space Trash grant. */
export async function createSdkFilesTrash(misty: Pick<MistyAppSDK, "files">, signal: AbortSignal) {
  if (signal.aborted) throw new Error("This Files view is closed.");
  const grant = await misty.files.openTrash();
  if (signal.aborted) {
    await misty.files.release(grant.handle);
    throw new Error("This Files view is closed.");
  }
  const directory = (await openSdkFilesDirectory(misty, { directoryGrant: grant, signal }))!;
  let closed = false;
  let tail = Promise.resolve<unknown>(undefined);
  const assert = () => {
    if (closed || signal.aborted) throw new Error("This Files view is closed.");
  };
  const container = (id: string) => {
    assert();
    if (!uuid.test(id)) throw new Error("Invalid Trash item.");
    return `${directory.root}/${id}`;
  };
  const serialize = <T>(action: () => Promise<T>): Promise<T> => {
    assert();
    const pending = tail
      .catch(() => undefined)
      .then(() => {
        assert();
        return action();
      });
    tail = pending;
    return pending;
  };
  const record = async (id: string) => {
    const text = await directory.readText(`${container(id)}/metadata.json`);
    return readRecord(JSON.parse(text.contents), id);
  };
  const payload = async (id: string) => {
    const listing = await directory.list({ path: `${container(id)}/payload`, showHidden: true });
    if (listing.entries.length > 1) throw new Error("This Trash item contains unexpected files.");
    return listing.entries[0] ?? null;
  };
  async function list(): Promise<SdkFilesTrashItem[]> {
    assert();
    const roots = await directory.list({ showHidden: true });
    const items: SdkFilesTrashItem[] = [];
    for (const root of roots.entries) {
      if (root.kind !== "folder" || !uuid.test(root.name)) continue;
      const metadata = await record(root.name);
      const entry = await payload(root.name);
      // An interrupted pre-transfer record never claims that an original was deleted.
      if (!entry) continue;
      items.push({
        id: root.name,
        entry,
        originalFolderName: metadata.originalFolderName,
        originalParent: metadata.parent,
        deletedAt: metadata.deletedAt,
      });
    }
    assert();
    return items.sort((a, b) => b.deletedAt - a.deletedAt);
  }
  async function moveFrom(source: SdkFilesDirectory, path: string) {
    return serialize(async () => {
      if (source.root === directory.root || !path.startsWith(`${source.root}/`))
        throw new Error("Choose an item outside Trash.");
      const parent = path.slice(0, path.lastIndexOf("/")),
        name = path.slice(path.lastIndexOf("/") + 1);
      const originalFolder = await source.remember();
      const id = crypto.randomUUID(),
        root = container(id),
        staging = `${directory.root}/.pending-${id}`;
      const metadata: TrashRecord = {
        version: 1,
        id,
        originalFolder,
        originalFolderName: source.name,
        parent: parent.slice(source.root.length).replace(/^\//, ""),
        name,
        deletedAt: Date.now(),
      };
      readRecord(metadata, id);
      await directory.create({ directory: directory.root, name: `.pending-${id}`, kind: "folder" });
      await directory.create({ directory: staging, name: "payload", kind: "folder" });
      await directory.create({ directory: staging, name: "metadata.json", kind: "file" });
      // Save recovery information before moving any source bytes.
      await directory.writeText(`${staging}/metadata.json`, JSON.stringify(metadata));
      await directory.rename({ path: staging, newName: id });
      const result = await transferSdkFilesEntry(
        source,
        directory,
        path,
        `${root}/payload`,
        "move",
        { signal },
      );
      if (!result.sourceRemoved)
        throw new Error("The file was copied to Trash, but the original could not be removed.");
      return { id, ...result };
    });
  }
  function restore(id: string, target?: { directory: SdkFilesDirectory; path: string }) {
    return serialize(async () => {
      const metadata = await record(id),
        entry = await payload(id);
      if (!entry) throw new Error("This Trash item has already been restored or removed.");
      const destination =
        target?.directory ??
        (await openSdkFilesDirectory(misty, { reference: metadata.originalFolder, signal }))!;
      try {
        const path =
          target?.path ?? `${destination.root}${metadata.parent ? `/${metadata.parent}` : ""}`;
        const result = await transferSdkFilesEntry(
          directory,
          destination,
          entry.path,
          path,
          "move",
          { signal },
        );
        if (!result.sourceRemoved)
          throw new Error("A restored copy was created, but the Trash copy could not be removed.");
        // Keep the empty receipt: cleanup is separate from the successful restore and
        // cannot turn a completed file move into a retry against the original path.
        return result;
      } finally {
        if (!target) await destination.close();
      }
    });
  }
  function purge(id: string) {
    return serialize(async () => {
      await record(id);
      await directory.remove(container(id), true);
    });
  }
  return {
    directory,
    list,
    moveFrom,
    restore,
    purge,
    async close() {
      closed = true;
      await directory.close();
    },
  };
}
