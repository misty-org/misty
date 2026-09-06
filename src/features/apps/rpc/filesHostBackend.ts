import { createFileDropHost } from "./fileDropHost";
import { invoke } from "@tauri-apps/api/core";
import type {
  AppSnapshot,
  DeviceSnapshot,
  ProvidersSnapshot,
  ConnectedDevicesSnapshot,
  PeerRoot,
} from "@/native/contracts";
import type { AppRpcScope } from "./session";
import type { FilesHostBackend, FilesHostSource, FilesSourceBookmark } from "./filesHost";

export function createFilesHostBackend(
  scope: AppRpcScope,
  options: {
    serverBase: string;
    root(): HTMLElement | null;
    native(method: string, params?: unknown): Promise<unknown>;
    instance(): Promise<string>;
    navigate(route: string): void;
  },
): FilesHostBackend {
  const key = `misty:host:file-source-bookmarks:v1:${encodeURIComponent(JSON.stringify([options.serverBase, scope.identity.accountId, scope.identity.appId, scope.identity.spaceId ?? ""]))}`;
  const file = async <T>(operation: string, params: Record<string, unknown>): Promise<T> => {
    scope.assert();
    const instance = await options.instance();
    scope.assert();
    const value = await invoke<T>("mini_app_host_file", { instance, operation, params });
    scope.assert();
    return value;
  };
  const drops = createFileDropHost(scope, { root: options.root, native: options.native, file });
  return {
    subscribeDrop: drops.subscribe,
    importDrop: drops.importDrop,
    close: drops.close,
    invoke,
    native: options.native,
    file,
    async sources() {
      await options.native("files.sources.list", {});
      const [app, providers, devices, local] = await Promise.all([
        invoke<AppSnapshot>("app_snapshot"),
        invoke<ProvidersSnapshot>("providers_snapshot"),
        invoke<ConnectedDevicesSnapshot>("connected_devices_snapshot"),
        invoke<DeviceSnapshot>("devices_snapshot"),
      ]);
      scope.assert("files.read");
      if (providers.error) throw new Error(providers.error);
      const root = app.environment.mountPath.replace(/\/$/, "");
      const result: FilesHostSource[] = providers.remotes.map((remote) => {
        if (!remote.name || /[/\\\0]/.test(remote.name) || [".", ".."].includes(remote.name))
          throw new Error("A connected source has an invalid name.");
        return {
          id: `remote:${remote.name}`,
          name: remote.name,
          kind: "remote",
          providerType: remote.type,
          online: !remote.needsReconnect && !remote.error,
          writable: true,
          path: `${root}/${remote.name}`,
        };
      });
      const home = app.environment.homeDir.replace(/\/$/, "");
      for (const [id, name, suffix] of [
        ["home", "Home", ""],
        ["desktop", "Desktop", "/Desktop"],
        ["documents", "Documents", "/Documents"],
        ["downloads", "Downloads", "/Downloads"],
      ]) {
        result.push({
          id: `local:${id}`,
          name,
          kind: "local",
          providerType: "folder",
          online: true,
          writable: true,
          path: home + suffix,
        });
      }
      for (const volume of local.devices)
        result.push({
          id: `volume:${volume.volumeId}`,
          name: volume.name,
          kind: "local",
          providerType: "volume",
          online: true,
          writable: volume.writable,
          path: volume.mountPath,
          totalBytes: volume.totalBytes,
          freeBytes: volume.freeBytes,
          removable: volume.isRemovable || volume.isExternal,
        });
      for (const peer of devices.peers) {
        if (peer.state !== "online") {
          result.push({
            id: `peer:${peer.deviceId}`,
            name: `Device ${peer.deviceId.slice(0, 8)}`,
            kind: "device",
            providerType: "peer",
            online: false,
            writable: false,
            path: "",
          });
          continue;
        }
        const roots = await invoke<PeerRoot[]>("connected_devices_roots", {
          deviceId: peer.deviceId,
        });
        scope.assert();
        for (const entry of roots)
          result.push({
            id: `peer:${peer.deviceId}:${entry.id}`,
            name: `${entry.name} · ${peer.deviceId.slice(0, 8)}`,
            kind: "device",
            providerType: "peer",
            online: true,
            writable: false,
            path: `misty://device/${peer.deviceId}/${entry.id}`,
          });
      }
      return result;
    },
    async manage(kind) {
      scope.assert();
      options.navigate(kind === "remote" ? "/providers" : "/settings?section=devices");
    },
    async preview(handle, maxDimension) {
      await options.native("files.stat", { handle });
      const owned = await file<{ path: string }>("resolve", { handle });
      const image = await invoke<{ path: string }>("explorer_generate_image_thumbnail", {
        path: owned.path,
        maxDimension,
      });
      scope.assert();
      const prepared = await file<{ handle: string; bytes: number }>("adoptPrepared", {
        path: image.path,
      });
      try {
        if (prepared.bytes > 16 * 1024 * 1024) throw new Error("Image preview is too large.");
        const bytes = new Uint8Array(prepared.bytes);
        for (let offset = 0; offset < bytes.length; offset += 64 * 1024) {
          const length = Math.min(64 * 1024, bytes.length - offset);
          const chunk = (await options.native("files.readBytes", {
            handle: prepared.handle,
            offset,
            length,
          })) as ArrayBuffer;
          scope.assert();
          if (chunk.byteLength !== length) throw new Error("Image preview changed while reading.");
          bytes.set(new Uint8Array(chunk), offset);
        }
        return bytes.buffer;
      } finally {
        await options.native("files.release", { handle: prepared.handle }).catch(() => undefined);
      }
    },
    async drag(handles, mode) {
      const paths: string[] = [];
      for (const handle of handles) {
        await options.native("files.stat", { handle });
        paths.push(
          (await file<{ path: string }>("resolve", { handle, write: mode === "move" })).path,
        );
      }
      scope.assert(mode === "move" ? "files.write" : "files.read");
      const { startDrag } = await import("@crabnebula/tauri-plugin-drag");
      return new Promise<{ dropped: boolean }>((resolve, reject) => {
        let settled = false;
        const complete = (error: unknown, dropped = false) => {
          if (settled) return;
          settled = true;
          scope.signal.removeEventListener("abort", abort);
          if (error) reject(error);
          else resolve({ dropped });
        };
        const abort = () => complete(new Error("This Files view closed during drag."));
        scope.signal.addEventListener("abort", abort, { once: true });
        void startDrag(
          {
            item: paths,
            icon: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==",
            mode,
          },
          (result) => complete(null, result.result === "Dropped"),
        ).catch((error) => complete(error));
      });
    },
    bookmarks() {
      scope.assert("files.read");
      const records: unknown = JSON.parse(localStorage.getItem(key) ?? "{}");
      if (
        !records ||
        typeof records !== "object" ||
        Array.isArray(records) ||
        Object.keys(records).length > 32
      )
        throw new Error("Saved connected folders are invalid.");
      for (const [id, value] of Object.entries(records)) {
        const item = value as FilesSourceBookmark;
        if (
          !/^[0-9a-f-]{36}$/.test(id) ||
          !item ||
          typeof item.sourceId !== "string" ||
          !Array.isArray(item.relative) ||
          item.relative.length > 256 ||
          item.relative.some(
            (part) =>
              typeof part !== "string" || !part || /[/\0]/.test(part) || [".", ".."].includes(part),
          ) ||
          typeof item.name !== "string" ||
          typeof item.writable !== "boolean"
        )
          throw new Error("Saved connected folder data is invalid.");
      }
      return records as Record<string, FilesSourceBookmark>;
    },
    saveBookmarks(records) {
      scope.assert("files.read");
      localStorage.setItem(key, JSON.stringify(records));
    },
  };
}
