import { copySpacePeerTree, type PeerTreeListing } from "./spacePeerTreeCopy";
import type { FileEntry, PeerResponse } from "@/native/contracts";
import type { AppRpcScope } from "./rpc/session";
import type { FilesHostSource } from "./rpc/filesHost";
import type { createSpacePeerBridge } from "./spacePeerBridge";

type Bridge = ReturnType<typeof createSpacePeerBridge>;
const prefix = "misty://device/";
function parts(path: string) {
  if (!path.startsWith(prefix)) throw new Error("This is not a peer file path.");
  const values = path.slice(prefix.length).split("/");
  if (
    values.length < 2 ||
    values.some((value) => !value || value === "." || value === ".." || /[\\\0]/.test(value))
  )
    throw new Error("Invalid peer file path.");
  return values;
}
/** Directory and file access from one mounted Files installation. The adapter
 * never resolves a peer path through the global explorer or its materializer. */
export function createSpacePeerFileAccess(
  scope: AppRpcScope,
  bridge: Bridge,
  native: {
    call(method: string, params: Record<string, unknown>): Promise<unknown>;
  },
) {
  let snapshots = new WeakMap<
    FileEntry,
    { snapshot: string; bytes: number | null; kind: string }
  >();
  const assert = () => {
    scope.assert("files.read");
    scope.assert("connections.read");
  };
  const checkedSnapshot = (snapshot: string, bytes: number | null) => {
    if (!snapshot || snapshot.length > 4096) throw new Error("Invalid peer file snapshot.");
    if (bytes !== null && (!Number.isSafeInteger(bytes) || bytes < 0))
      throw new Error("Invalid peer file size.");
    return { snapshot, bytes };
  };
  scope.signal.addEventListener(
    "abort",
    () => {
      snapshots = new WeakMap();
    },
    { once: true },
  );
  const access = {
    async roots(deviceId: string): Promise<FilesHostSource[]> {
      assert();
      const result = await bridge.request<PeerResponse>(deviceId, { type: "get_roots" });
      assert();
      if (result.type !== "roots") throw new Error("The peer returned an unexpected root list.");
      const seen = new Set<string>();
      return result.data.roots.map((root) => {
        if (!/^[a-zA-Z0-9_-]{1,128}$/.test(root.id) || seen.has(root.id))
          throw new Error("Invalid peer root identity.");
        seen.add(root.id);
        const path = `${prefix}${deviceId}/${root.id}`;
        parts(path);
        return {
          id: `peer:${deviceId}:${root.id}`,
          name: `${root.name} · ${deviceId.slice(0, 8)}`,
          kind: "device",
          providerType: "peer",
          online: true,
          writable: false,
          path,
        };
      });
    },
    async list(path: string): Promise<PeerTreeListing> {
      assert();
      const [deviceId, rootId, ...relative] = parts(path);
      const result = await bridge.request<PeerResponse>(deviceId, {
        type: "list_directory",
        data: { path, show_hidden: true },
      });
      assert();
      if (result.type !== "directory" || result.data.path !== path)
        throw new Error("The peer returned a different directory.");
      const location = {
        kind: "peer_device" as const,
        providerType: null,
        remoteName: null,
        remotePath: relative.join("/"),
        peerDeviceId: deviceId,
        peerRootId: rootId,
      };
      const names = new Set<string>();
      const entries: FileEntry[] = [];
      const links: FileEntry[] = [];
      for (const entry of result.data.entries) {
        if (
          !entry.name ||
          /[/\\\0]/.test(entry.name) ||
          [".", ".."].includes(entry.name) ||
          names.has(entry.name) ||
          entry.path !== `${path}/${entry.name}`
        )
          throw new Error("The peer returned an entry outside its directory.");
        names.add(entry.name);
        const snapshot = checkedSnapshot(entry.snapshot, entry.sizeBytes);
        if (entry.kind !== "symlink" && entry.kind !== "file" && entry.kind !== "directory")
          throw new Error("Unknown peer entry kind.");
        const dot = entry.name.lastIndexOf(".");
        const item: FileEntry = {
          id: entry.path,
          path: entry.path,
          name: entry.name,
          kind: entry.kind === "directory" ? "folder" : "file",
          extension: dot > 0 ? entry.name.slice(dot + 1).toLowerCase() : "",
          mimeType: null,
          remoteModified: null,
          sizeBytes: entry.sizeBytes,
          modifiedMs: entry.modifiedMs,
          createdMs: null,
          readonly: true,
          hidden: entry.hidden,
          location: { ...location, remotePath: [...relative, entry.name].join("/") },
        };
        snapshots.set(item, { ...snapshot, kind: entry.kind });
        (entry.kind === "symlink" ? links : entries).push(item);
      }
      return {
        links,
        revision: JSON.stringify([
          result.data.snapshot,
          result.data.entries
            .map((entry) => [entry.name, entry.kind, entry.snapshot])
            .sort((a, b) => a[0].localeCompare(b[0])),
        ]),
        path,
        title: relative[relative.length - 1] ?? rootId,
        parentPath: relative.length ? path.slice(0, path.lastIndexOf("/")) : null,
        location,
        entries,
        totalCount: entries.length,
        hiddenCount: entries.filter((entry) => entry.hidden).length,
      };
    },
    async prepare(entry: FileEntry) {
      assert();
      const [deviceId] = parts(entry.path);
      if (entry.kind !== "file") throw new Error("Prepare a regular peer file.");
      const snapshot = snapshots.get(entry);
      if (!snapshot || snapshot.kind !== "file" || snapshot.bytes === null)
        throw new Error("Refresh this folder before opening the file.");
      return bridge.prepare(deviceId, {
        path: entry.path,
        maxBytes: snapshot.bytes,
        expectedSnapshot: snapshot.snapshot,
      });
    },
    async copyFile(
      entry: FileEntry,
      destination: string,
      name: string,
      conflict: "error" | "rename" = "error",
    ) {
      assert();
      scope.assert("files.write");
      if (
        !name ||
        new TextEncoder().encode(name).length > 255 ||
        /[/\\\0]/.test(name) ||
        [".", ".."].includes(name)
      )
        throw new Error("Invalid copy name.");
      const [deviceId] = parts(entry.path);
      const snapshot = snapshots.get(entry);
      if (entry.kind !== "file" || !snapshot || snapshot.kind !== "file" || snapshot.bytes === null)
        throw new Error("Refresh the source folder before copying this file.");
      const prepared = await bridge.prepare(deviceId, {
        path: entry.path,
        maxBytes: snapshot.bytes,
        expectedSnapshot: snapshot.snapshot,
      });
      let jobId: string | undefined;
      let closed = false;
      const close = async () => {
        if (closed) return;
        closed = true;
        if (jobId) {
          await native.call("files.transferCancel", { jobId }).catch(() => undefined);
          await native.call("files.transferClose", { jobId }).catch(() => undefined);
        }
        await native.call("files.release", { handle: prepared.handle }).catch(() => undefined);
      };
      try {
        assert();
        scope.assert("files.write");
        const token =
          "u:" +
          btoa(String.fromCharCode(...new TextEncoder().encode(name)))
            .replace(/\+/g, "-")
            .replace(/\//g, "_")
            .replace(/=+$/, "");
        const started = (await native.call("files.transferPrepared", {
          sourceHandle: prepared.handle,
          destinationDirectory: destination,
          entry: token,
          conflict,
        })) as { jobId: string };
        jobId = started.jobId;
        assert();
        return { jobId, close };
      } catch (error) {
        await close();
        throw error;
      }
    },
  };
  const token = (name: string) =>
    "u:" +
    btoa(String.fromCharCode(...new TextEncoder().encode(name)))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  return {
    ...access,
    copyTree(
      path: string,
      destination: string,
      name: string,
      conflict: "error" | "rename",
      signal: AbortSignal,
      progress?: (bytes: number, files: number) => void,
    ) {
      const check = () => {
        assert();
        scope.assert("files.write");
      };
      const call = async <T>(method: string, params: Record<string, unknown>) => {
        check();
        const result = (await native.call(method, params)) as T;
        check();
        return result;
      };
      return copySpacePeerTree(
        {
          list: access.list,
          begin: async (destinationDirectory, name, conflict) =>
            (
              await call<{ draft: string }>("files.treeBegin", {
                destinationDirectory,
                entry: token(name),
                conflict,
              })
            ).draft,
          directory: async (draft, names) =>
            (
              await call<{ handle: string }>("files.treeDirectory", {
                draft,
                entries: names.map(token),
              })
            ).handle,
          copy: (entry, destination) => access.copyFile(entry, destination, entry.name),
          link: async (entry, draft, directory) => {
            check();
            const snapshot = snapshots.get(entry);
            if (!snapshot || snapshot.kind !== "symlink")
              throw new Error("Refresh the source folder before copying this link.");
            const [deviceId] = parts(entry.path);
            const response = await bridge.request<PeerResponse>(deviceId, {
              type: "read_link",
              data: { path: entry.path, expected_snapshot: snapshot.snapshot },
            });
            check();
            if (
              response.type !== "symlink" ||
              response.data.snapshot !== snapshot.snapshot ||
              !Array.isArray(response.data.target) ||
              !response.data.target.length ||
              response.data.target.length > 16384 ||
              response.data.target.some((byte) => !Number.isInteger(byte) || byte < 1 || byte > 255)
            )
              throw new Error("The peer returned an invalid or changed symbolic link.");
            await call("files.treeSymlink", {
              draft,
              directory,
              entry: token(entry.name),
              target: response.data.target,
            });
          },
          status: (jobId) => call("files.transferStatus", { jobId }),
          release: async (handle) => {
            await native.call("files.release", { handle });
          },
          commit: (draft) => call("files.treeCommit", { draft }),
          discard: async (draft) => {
            await native.call("files.treeDiscard", { draft });
          },
        },
        { path, destination, name, conflict, signal, assert: check, progress },
      );
    },
  };
}
export type SpacePeerFileAccess = ReturnType<typeof createSpacePeerFileAccess>;
