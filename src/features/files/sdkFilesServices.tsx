import { useEffect, useState } from "react";
import { create } from "zustand";
import type { MistyAppSDK, MistyFileSource } from "@misty/sdk";
import { Button, TreeBranch } from "@/shared/ui";
import { MonitorSmartphone, Plus } from "lucide-react";
import type { SdkFilesWorkspace } from "./sdkFilesWorkspace";
import type { SdkFilesWorkspaceServices } from "./SdkFilesWorkspaceView";
import { createSdkFilesSidebarPreferences } from "./sdkFilesSidebarPreferences";
import { useSidebarQuickAccess } from "./explorer/components/explorerSidebar/useSidebarQuickAccess";
import { Home, Monitor, FileText, Download, Folder, Trash2, Clock3, Star } from "lucide-react";
import { createSdkFilesSmartFolders } from "./sdkFilesSmartFolders";
import {
  SidebarDeviceGroupHeader,
  sidebarStyles,
} from "./explorer/components/ExplorerSidebarSupport";

export async function createSdkFilesServices(
  misty: MistyAppSDK,
  workspace: SdkFilesWorkspace,
  signal: AbortSignal,
  report: (error: unknown) => void,
): Promise<SdkFilesWorkspaceServices & { close(): Promise<void> }> {
  const files = workspace.files;
  const preferences = await createSdkFilesSidebarPreferences(misty, signal, report);
  const sources = create<{ items: readonly MistyFileSource[]; loading: boolean }>(() => ({
    items: [],
    loading: true,
  }));
  const run = (action: () => unknown) => {
    void Promise.resolve().then(action).catch(files.error);
  };
  const refreshSources = async () => {
    try {
      const items = await misty.files.sources();
      if (!signal.aborted) sources.setState({ items, loading: false });
    } catch (error) {
      if (!signal.aborted) {
        sources.setState({ loading: false });
        report(error);
      }
    }
  };
  const sourcePath = (source: MistyFileSource) =>
    `/sources/${source.kind === "remote" ? source.name : encodeURIComponent(source.id)}`;
  const openSource = async (source: MistyFileSource, activate = true) => {
    const current = files.store
      .getState()
      .folders.find((folder) => folder.source?.id === source.id);
    if (current) {
      if (activate) await files.navigate(current.root);
      return current;
    }
    const grant = await misty.files.openSource(source.id, { write: source.writable });
    if (signal.aborted) {
      await misty.files.release(grant.handle);
      return;
    }
    return files.openFolder({ directoryGrant: grant, source, activate });
  };
  const resolvePath = async (path: string) => {
    const source = sources
      .getState()
      .items.find((item) => path === sourcePath(item) || path.startsWith(`${sourcePath(item)}/`));
    if (!source) return path;
    const folder = await openSource(source, false);
    if (!folder) throw new Error("The source is unavailable.");
    return folder.root + path.slice(sourcePath(source).length);
  };
  const navigate = (path: string) => run(async () => files.navigate(await resolvePath(path)));
  const manage = (kind: "remote" | "device") =>
    run(async () => {
      await misty.files.manageSources(kind);
      await refreshSources();
    });
  const smartFolders = createSdkFilesSmartFolders(misty, signal, async (path, query) => {
    await files.navigate(path);
    files.setQueryMode("search");
    files.setQuery(query);
  });
  const ConnectedDevices: SdkFilesWorkspaceServices["sidebarRuntime"]["ConnectedDevices"] = () => {
    const [open, setOpen] = useState(true);
    const items = sources((state) => state.items).filter((item) => item.kind === "device");
    return (
      <div className={sidebarStyles.deviceGroup}>
        <SidebarDeviceGroupHeader
          title="Network"
          collapsed={!open}
          first={false}
          last
          onToggle={() => setOpen((value) => !value)}
          actions={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Connect another device"
              onClick={() => manage("device")}
            >
              <Plus size={13} />
            </Button>
          }
        />
        {open &&
          (items.length ? (
            items.map((item, index) => (
              <div className={sidebarStyles.deviceNestedTreeRow} key={item.id}>
                <TreeBranch
                  className={sidebarStyles.treeBranch}
                  last={index === items.length - 1}
                />
                <Button
                  variant="ghost"
                  className={sidebarStyles.deviceButton}
                  disabled={!item.online}
                  onClick={() => run(() => openSource(item))}
                >
                  <span className={sidebarStyles.deviceIcon}>
                    <MonitorSmartphone />
                  </span>
                  <span className={sidebarStyles.deviceCopy}>
                    <strong className={sidebarStyles.deviceName}>{item.name}</strong>
                    <small>{item.online ? "Online" : "Offline"}</small>
                  </span>
                </Button>
              </div>
            ))
          ) : (
            <div className={sidebarStyles.deviceGroupEmpty}>No network devices</div>
          ))}
      </div>
    );
  };
  try {
    await refreshSources();
    await workspace.ready;
    if (!files.store.getState().pane.listing) {
      const home = sources.getState().items.find((item) => item.id === "local:home");
      if (home) await openSource(home);
    }
  } catch (error) {
    await preferences.close();
    throw error;
  }
  return {
    async close() {
      await preferences.close();
    },
    resolvePath,
    useSidebar() {
      const state = files.store(),
        available = sources(),
        prefs = preferences.useSidebarPreferences();
      useEffect(() => {
        const refresh = () => void refreshSources();
        window.addEventListener("focus", refresh);
        return () => window.removeEventListener("focus", refresh);
      }, []);
      const path = state.pane.listing?.path ?? "";
      const folder = state.folders.find(
        (folder) => path === folder.root || path.startsWith(`${folder.root}/`),
      );
      const activePath = folder?.source
        ? sourcePath(folder.source) + path.slice(folder.root.length)
        : path;
      return {
        homePath: state.folders[0]?.root ?? "misty://choose-folder",
        activePath,
        mountRoot: "/sources",
        remotes: available.items
          .filter((item) => item.kind === "remote")
          .map((item) => ({
            name: item.name,
            type: item.providerType,
            statusLabel: item.online ? "Connected" : "Offline",
            needsReconnect: !item.online,
            error: null,
            configSource: "sdk",
          })),
        remoteLoading: available.loading,
        library: null,
        devices: available.items
          .filter((item) => item.kind === "local" && item.providerType === "volume")
          .map((item) => ({
            id: item.id,
            volumeId: item.id,
            name: item.name,
            mountPath: sourcePath(item),
            fsType: "",
            isRemovable: !!item.removable,
            isExternal: !!item.removable,
            isSystem: !item.removable,
            isNetwork: false,
            writable: item.writable,
            totalBytes: item.totalBytes ?? 0,
            freeBytes: item.freeBytes ?? 0,
          })),
        devicesLoading: available.loading,
        pinnedPaths: [],
        onNavigate: navigate,
        onRefreshDevices: () => run(refreshSources),
        onOpenInNewTab: (path) =>
          run(async () => {
            const source = sources.getState().items.find((item) => sourcePath(item) === path);
            const folder = source ? await openSource(source, false) : null;
            await workspace.openView(folder?.root ?? path);
          }),
        onManageRemotes: () => manage("remote"),
        onAddRemote: () => manage("remote"),
        androidLocal: false,
        androidAllFilesAccess: null,
        androidGrantedFolders: [],
        onGrantLocalFolder: () => run(() => files.openFolder()),
        onChooseFolder: () => run(() => files.openFolder()),
        onUnpinPinnedPath: (path) => prefs.setHiddenQuickAccessPaths((items) => [...items, path]),
      };
    },
    sidebarRuntime: {
      ConnectedDevices,
      useSidebarPreferences: preferences.useSidebarPreferences,
      useSidebarQuickAccess(options) {
        const available = sources((state) => state.items),
          folders = files.store((state) => state.folders);
        const icons = {
          "local:home": Home,
          "local:desktop": Monitor,
          "local:documents": FileText,
          "local:downloads": Download,
        };
        return useSidebarQuickAccess({
          ...options,
          items: [
            ...available
              .filter((item) => item.kind === "local" && item.providerType === "folder")
              .map((item) => ({
                label: item.name,
                path: sourcePath(item),
                icon: icons[item.id as keyof typeof icons] ?? Folder,
              })),
            ...folders
              .filter((folder) => !folder.source)
              .map((folder) => ({ label: folder.name, path: folder.root, icon: Folder })),
            { label: "Recent", path: "misty://recent", icon: Clock3 },
            { label: "Starred", path: "misty://starred", icon: Star },
            { label: "Trash", path: "misty://trash", icon: Trash2 },
          ],
        });
      },
      useSidebarSmartFolders: smartFolders.useSidebarSmartFolders,
      confirmUnmount: async (message) => window.confirm(message),
      unmount: async (request) => {
        await misty.files.unmountSource(request.volumeId);
        await refreshSources();
      },
    },
    drag: {
      prepare: async (request) => ({
        items: request.items.map((item) => ({
          sourcePath: item.path,
          localPath: item.path,
          isDirectory: item.isDirectory,
          cached: false,
        })),
        skipped: [],
      }),
      cancelPreparation: async () => {},
      notify: files.error,
      refresh: () => run(files.refresh),
      subscribeNative: (listener) => misty.files.subscribeDrop(listener),
      async startDrag(paths, _icon, mode, done) {
        const collect = (index: number, handles: string[]): Promise<{ dropped: boolean }> =>
          index === paths.length
            ? misty.files.startDrag(handles, mode)
            : files
                .owner(paths[index])
                .withDragHandle(paths[index], mode, (handle) =>
                  collect(index + 1, [...handles, handle]),
                );
        done((await collect(0, [])).dropped);
      },
    },
    async dropExternal(payload, path, _storage, modifiers) {
      path = await resolvePath(path);
      await files.owner(path).importDrop(
        payload.items.map((item) => item.path),
        path,
        modifiers.moveRequested ? "move" : "copy",
      );
      await files.refresh();
    },
    async download(entries) {
      const destination = await files.openFolder({ activate: false });
      if (destination)
        await files.transfer(
          entries.map((entry) => entry.path),
          destination.root,
          "copy",
        );
    },
    async runCommand(command) {
      const actions: Record<string, () => unknown> = {
        "explorer.new_folder": () => files.startInlineCreate("folder", workspace.paneId),
        "explorer.search": () => files.setQueryMode("search"),
        "explorer.copy": () => files.copy("copy"),
        "explorer.cut": () => files.copy("move"),
        "explorer.paste": () => files.paste(),
        "explorer.delete": () => files.deleteSelected(),
        "explorer.undo": files.undo,
        "explorer.redo": files.redo,
      };
      if (!actions[command]) throw new Error(`Unknown Files command: ${command}`);
      await actions[command]();
    },
  };
}
