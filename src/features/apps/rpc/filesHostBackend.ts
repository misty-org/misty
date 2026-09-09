import { allLayoutPanes } from "@/features/workspace/layoutTabs";
import { createSpacePeerTransfers } from "../spacePeerTransfers";
import { createSharedSpacePeerBridge } from "../sharedSpacePeerBridge";
import { createSpacePeerBackend } from "../spacePeerBackend";
import { createSpacePeerFileAccess } from "../spacePeerFiles";
import { useWorkspaceStore } from "@/features/workspace";
import { appOwnedRoute } from "../appCapabilityGateway";
import { reportSystemError } from "@/features/activity/systemActivity";
import { createFileDropHost } from "./fileDropHost";
import { invoke } from "@tauri-apps/api/core";
import type {
  AppEnvironmentSnapshot,
  DeviceSnapshot,
  ProvidersSnapshot,
  ConnectedDevicesSnapshot,
  PeerRoot,
  DirectoryListing,
} from "@/native/contracts";
import type { AppRpcScope } from "./session";
import type { FilesHostBackend, FilesHostSource, FilesSourceBookmark } from "./filesHost";

export function createFilesHostBackend(
  scope: AppRpcScope,
  options: {
    peer?: { installedVersion: string; authorityGeneration: number };
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
  const unavailable = (service: string, error: unknown) =>
    reportSystemError({
      title: `Files could not load ${service}`,
      error,
      scope: `files-sources:${service}`,
      intent: "background",
      accountId: scope.identity.accountId,
    });
  const peerBridge = options.peer ? createSharedSpacePeerBridge(scope, options.serverBase, {
    ...options.peer, instance: options.instance, folders: [],
    backend: createSpacePeerBackend(scope, { invoke, native: options.native }),
  }) : undefined;
  const peerFiles = peerBridge ? createSpacePeerFileAccess(scope, peerBridge, { call: options.native }) : undefined;
  const peerTransfers = peerFiles ? createSpacePeerTransfers(scope, peerFiles, options.native) : undefined;
  const sharedFolders = new Set<string>();
  const drops = createFileDropHost(scope, { root: options.root, native: options.native, file });
  return {
    subscribeDrop: drops.subscribe,
    importDrop: drops.importDrop,
    close() { peerTransfers?.close(); peerBridge?.dispose(); drops.close(); },
    copyPeer: peerTransfers?.start,
    async shareSource(directory, shared) {
      if (!peerBridge) throw new Error("Folder sharing is unavailable on this device.");
      scope.assert("connections.write");
      // A package can name only an owned native directory; the native peer start validates it again.
      await options.native("files.listDirectory", { directory, limit: 1 });
      const next = new Set(sharedFolders);
      if (shared) next.add(directory); else next.delete(directory);
      await peerBridge.setFolders([...next]);
      sharedFolders.clear(); next.forEach(handle => sharedFolders.add(handle));
    },
    invoke,
    native: peerTransfers?.call ?? options.native,
    file,
    async list(path, force = false) {
      scope.assert("files.read");
      if (peerFiles && path.startsWith("misty://device/")) return peerFiles.list(path);
      const result = await invoke<DirectoryListing>("explorer_list_directory", {
        request: { path, showHidden: true, forceRemoteRefresh: force },
      });
      scope.assert("files.read");
      return result;
    },
    async prepare(entry) {
      scope.assert("files.read");
      if (peerFiles && entry.path.startsWith("misty://device/")) return peerFiles.prepare(entry);
      const prepared = await invoke<{ localPath: string }>("explorer_prepare_open_item", {
        request: {
          path: entry.path,
          sizeBytes: entry.sizeBytes,
          remoteModified: entry.remoteModified,
        },
      });
      scope.assert("files.read");
      const result = await file<{ handle: string; bytes: number }>("adoptPrepared", {
        path: prepared.localPath,
      });
      try {
        scope.assert("files.read");
        return result;
      } catch (error) {
        await options.native("files.release", { handle: result.handle }).catch(() => undefined);
        throw error;
      }
    },
    legacyLocation() {
      scope.assert("files.read");
      if (scope.identity.appId !== "files") return null;
      const tab = allLayoutPanes(useWorkspaceStore.getState().layout)
        .flatMap((pane) => pane.tabs)
        .find((tab) => tab.id === scope.identity.instanceId && tab.groupKey === "app:files");
      if (!tab) return null;
      appOwnedRoute(tab.route, "files", scope.identity.spaceId);
      const stored = tab.state as {
        version?: unknown;
        path?: unknown;
        mistyAppView?: unknown;
      } | null;
      if (
        stored?.mistyAppView ||
        stored?.version !== 1 ||
        typeof stored.path !== "string" ||
        !stored.path ||
        stored.path.length > 4096 ||
        stored.path.includes("\0")
      )
        return null;
      return stored.path;
    },
    async sources() {
      await options.native("files.sources.list", {});
      // Local folders remain usable when optional remote/device services are unavailable.
      const [environment, providers, devices, local] = await Promise.all([
        invoke<AppEnvironmentSnapshot>("app_environment_snapshot"),
        invoke<ProvidersSnapshot>("providers_snapshot").catch((error) => {
          unavailable("remote sources", error);
          return { remotes: [] };
        }),
        (peerBridge ? Promise.resolve({ peers: [] }) : invoke<ConnectedDevicesSnapshot>("connected_devices_snapshot")).catch((error) => {
          unavailable("network devices", error);
          return { peers: [] };
        }),
        invoke<DeviceSnapshot>("devices_snapshot").catch((error) => {
          unavailable("volumes", error);
          return { devices: [] };
        }),
      ]);
      scope.assert("files.read");
      const root = environment.mountPath.replace(/\/$/, "");
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
      const home = environment.homeDir.replace(/\/$/, "");
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
      if (peerBridge && peerFiles) {
        const peers = await peerBridge.refresh().catch(error => { unavailable("Space network devices", error); return []; });
        for (const peer of peers) {
          scope.assert();
          const roots = await peerFiles.roots(peer.deviceId).catch(error => { unavailable("Space device folders", error); return []; });
          result.push(...roots);
        }
      }
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
        }).catch((error) => {
          unavailable("device folders", error);
          return [];
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
    async preview(handle, maxDimension, name) {
      await options.native("files.stat", { handle });
      if (!name) {
        const owned = await file<{ path: string }>("resolve", { handle });
        name = owned.path.split(/[\\/]/).pop();
      }
      if (!name) throw new Error("The image name is unavailable.");
      const extension = name.includes(".")
        ? name.slice(name.lastIndexOf(".") + 1).toLowerCase()
        : "png";
      const result = await invoke<{ data: string }>("mini_app_device_call", {
        instance: await options.instance(),
        method: "files.renderOwnedImage",
        params: { handle, displayName: name, extension, maxDimension },
      });
      scope.assert("files.read");
      if (result.data.length > 24 * 1024 * 1024) throw new Error("Image preview is too large.");
      const binary = atob(result.data);
      return Uint8Array.from(binary, (character) => character.charCodeAt(0)).buffer;
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
