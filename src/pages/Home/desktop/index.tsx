import { useEffect, useMemo, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import { devicesSnapshot, savedSearchesSnapshot } from "../../../api/misty";
import type {
  ExplorerLibrarySnapshot,
  MountedDevice,
  ProviderRemote,
  SavedSearch,
  SavedSearchRule,
} from "../../../api/types";
import { useAuth } from "../../../auth/AuthContext";
import { releases } from "../../../data/releases";
import { useMultiPanelStore } from "../../../shared/multipanel/useMultiPanelStore";
import { useAppStore } from "../../../stores/useAppStore";
import { useExplorerStore } from "../../../stores/useExplorerStore";
import { usePluginsStore } from "../../../stores/usePluginsStore";
import { useProvidersStore } from "../../../stores/useProvidersStore";
import { useSearchStore } from "../../../stores/useSearchStore";
import {
  selectAdvancedPreferences,
  selectGeneralPreferences,
  useSettingsStore,
} from "../../../stores/useSettingsStore";
import { useSetupStore } from "../../../stores/useSetupStore";
import { changelog } from "../../Changelog/desktop/data";
import { posts } from "../../Website/pages/Blog/data";
import { DesktopWorkspacePanel } from "./DesktopWorkspacePanel";
import { HomeFooter } from "./HomeFooter";
import { HomeLoading } from "./HomeLoading";
import {
  buildHomeQuickAccessItems,
  HomeSidebarPanels,
  type HomeQuickAccessItem,
  type HomeSmartFolderItem,
  type HomeTagItem,
} from "./HomeSidebarPanels";
import {
  joinPath,
  resolveMountRoot,
  resolvePreferredWorkspaceRoot,
  titleFromPath,
} from "./recentFileUtils";

const emptyProviderRemotes: ProviderRemote[] = [];

export default function HomePage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { status, systemError } = useSetupStore(
    useShallow((state) => ({
      status: state.status,
      systemError: state.systemError,
    })),
  );
  const { user } = useAuth();
  const {
    loadPlugins,
    marketplacePluginCount,
    installedPluginCount,
    loading: pluginsLoading,
  } = usePluginsStore(
    useShallow((state) => ({
      loadPlugins: state.loadPlugins,
      marketplacePluginCount: state.marketplacePlugins.length,
      installedPluginCount: state.installedPlugins.length,
      loading: state.loading,
    })),
  );
  const currentUser = status?.current_user ?? user;
  const app = useAppStore((state) => state.app);
  const { preferredWorkspaceRoot, settingsMountPath } = useSettingsStore(
    useShallow((state) => ({
      preferredWorkspaceRoot: selectGeneralPreferences(state.settings?.document).preferredWorkspaceRoot,
      settingsMountPath: selectAdvancedPreferences(state.settings?.document).mountPath,
    })),
  );
  const {
    library,
    loadLibrary,
    pinnedPaths,
  } = useExplorerStore(
    useShallow((state) => ({
      library: state.library,
      loadLibrary: state.loadLibrary,
      pinnedPaths: state.pinnedPaths,
    })),
  );
  const { loadProviders, remotes, remotesLoading } = useProvidersStore(
    useShallow((state) => ({
      loadProviders: state.load,
      remotes: state.providers?.remotes ?? emptyProviderRemotes,
      remotesLoading: state.loading,
    })),
  );
  const [smartFolders, setSmartFolders] = useState<HomeSmartFolderItem[]>([]);
  const [smartFoldersLoading, setSmartFoldersLoading] = useState(true);
  const [devices, setDevices] = useState<MountedDevice[]>([]);
  const [devicesLoading, setDevicesLoading] = useState(true);
  const homePath = resolvePreferredWorkspaceRoot(
    preferredWorkspaceRoot,
    app?.environment.homeDir ?? "/",
  );
  const mountRoot = resolveMountRoot(
    homePath,
    settingsMountPath || app?.environment.mountPath || ".misty/mnt",
  );
  const quickAccessItems = useMemo(
    () => buildHomeQuickAccessItems(homePath, pinnedPaths),
    [homePath, pinnedPaths],
  );
  const tags = useMemo(() => buildHomeTagItems(library), [library]);

  useEffect(() => {
    if (
      !status ||
      marketplacePluginCount > 0 ||
      installedPluginCount > 0 ||
      pluginsLoading
    ) {
      return;
    }

    void loadPlugins(`${status.os}-${status.arch}`);
  }, [
    installedPluginCount,
    loadPlugins,
    marketplacePluginCount,
    pluginsLoading,
    status?.arch,
    status?.os,
  ]);

  useEffect(() => {
    if (!library) void loadLibrary();
  }, [library, loadLibrary]);

  useEffect(() => {
    let disposed = false;
    setSmartFoldersLoading(true);
    void savedSearchesSnapshot()
      .then((snapshot) => {
        if (disposed) return;
        setSmartFolders(
          sortSavedSearches(snapshot.searches).map((search) => ({
            id: search.id,
            name: search.name,
            query: smartFolderQuery(search),
          })),
        );
      })
      .catch(() => {
        if (!disposed) setSmartFolders([]);
      })
      .finally(() => {
        if (!disposed) setSmartFoldersLoading(false);
      });

    return () => {
      disposed = true;
    };
  }, []);

  useEffect(() => {
    void loadProviders();
  }, [loadProviders]);

  useEffect(() => {
    let disposed = false;
    setDevicesLoading(true);
    void devicesSnapshot()
      .then((snapshot) => {
        if (!disposed) setDevices(snapshot.devices);
      })
      .catch(() => {
        if (!disposed) setDevices([]);
      })
      .finally(() => {
        if (!disposed) setDevicesLoading(false);
      });

    return () => {
      disposed = true;
    };
  }, []);

  if (!currentUser) {
    if (!status && !systemError) {
      return <HomeLoading />;
    }

    return (
      <Navigate replace state={{ from: location.pathname }} to="/signin" />
    );
  }

  const latestChangelog = changelog[0] ?? {
    version: releases[0].version,
    date: releases[0].date,
    summary: releases[0].summary,
    changes: releases[0].changes,
  };
  const latestPost = posts[0] ?? null;

  const openPathInFiles = (path: string, title?: string) => {
    const targetPath = path || homePath;
    const multi = useMultiPanelStore.getState();

    if (multi.tabs.length === 0) {
      multi.initialize(targetPath, title || titleFromPath(targetPath));
    }

    const paneId = useMultiPanelStore.getState().activePaneId || "explorer-pane-0";
    void useExplorerStore.getState().navigatePane(paneId, targetPath);
    navigate("/files");
  };
  const openQuickAccessItem = (item: HomeQuickAccessItem) => {
    openPathInFiles(item.path, item.label);
  };
  const openSmartFolder = (smartFolder: HomeSmartFolderItem) => {
    openSearchInFiles(smartFolder.query);
  };
  const openTag = (tag: HomeTagItem) => {
    openSearchInFiles(`tag:${quoteTagQueryValue(tag.name)}`);
  };
  const openRemote = (remote: ProviderRemote) => {
    openPathInFiles(joinPath(mountRoot, remote.name), remote.name);
  };
  const openDevice = (device: MountedDevice) => {
    openPathInFiles(device.mountPath, device.name);
  };
  const openSearchInFiles = (query: string) => {
    const trimmed = query.trim();
    if (!trimmed) return;
    const searchStore = useSearchStore.getState();
    void searchStore.openSearch(homePath).then(() => {
      searchStore.setScope("everything");
      searchStore.setQuery(trimmed);
      navigate("/files");
    });
  };

  return (
    <div className="misty-scrollbar box-border h-full min-h-0 overflow-x-hidden overflow-y-scroll overscroll-contain p-5">
      <section className="mx-auto grid min-h-full w-full max-w-[1500px] auto-rows-min gap-4 xl:h-full xl:min-h-[680px] xl:grid-cols-12 xl:grid-rows-7 xl:auto-rows-fr">
        <DesktopWorkspacePanel homePath={homePath} />
        <HomeSidebarPanels
          devices={devices}
          devicesLoading={devicesLoading}
          onOpenDevice={openDevice}
          onOpenQuickAccess={openQuickAccessItem}
          onOpenRemote={openRemote}
          onOpenSmartFolder={openSmartFolder}
          onOpenTag={openTag}
          quickAccessItems={quickAccessItems}
          remotes={remotes}
          remotesLoading={remotesLoading}
          smartFolders={smartFolders}
          smartFoldersLoading={smartFoldersLoading}
          tags={tags}
          tagsLoading={!library}
        />
        <HomeFooter
          latestChangelog={latestChangelog}
          latestPost={latestPost}
        />
      </section>
    </div>
  );
}

function buildHomeTagItems(library: ExplorerLibrarySnapshot | null): HomeTagItem[] {
  if (!library) return [];
  const tags = new Map<string, HomeTagItem>();
  const seenByPath = new Map<string, Set<string>>();

  for (const item of [...library.recentFiles, ...library.starredFiles]) {
    const pathKey = normalizePanelPath(item.path);
    if (!pathKey) continue;
    const pathTags = seenByPath.get(pathKey) ?? new Set<string>();
    for (const rawTag of item.tags ?? []) {
      const name = rawTag.trim();
      const key = name.toLowerCase();
      if (!name || pathTags.has(key)) continue;
      pathTags.add(key);
      const current = tags.get(key);
      tags.set(key, {
        key,
        name: current?.name ?? name,
        count: (current?.count ?? 0) + 1,
      });
    }
    seenByPath.set(pathKey, pathTags);
  }

  return [...tags.values()].sort((left, right) =>
    right.count - left.count || left.name.localeCompare(right.name),
  );
}

function smartFolderQuery(search: SavedSearch): string {
  return search.query.trim() || smartFolderQueryFromRules(search.rules, smartFolderMatchMode(search.rules));
}

function sortSavedSearches(searches: SavedSearch[]): SavedSearch[] {
  return [...searches].sort((left, right) =>
    right.updatedAtMs - left.updatedAtMs || left.name.localeCompare(right.name),
  );
}

function smartFolderMatchMode(rules: SavedSearchRule[]): "all" | "any" {
  const matchModeRule = rules.find((rule) => rule.field === "__match");
  return matchModeRule?.value === "any" ? "any" : "all";
}

function visibleSmartFolderRules(rules: SavedSearchRule[]): SavedSearchRule[] {
  return rules.filter((rule) => rule.field !== "__match");
}

function smartFolderQueryFromRules(rules: SavedSearchRule[], matchMode: "all" | "any"): string {
  const parts = visibleSmartFolderRules(rules)
    .filter((rule) => rule.value.trim())
    .map(smartFolderRuleQuery)
    .filter(Boolean);
  return matchMode === "any" && parts.length > 1 ? parts.join(" OR ") : parts.join(" ");
}

function smartFolderRuleQuery(rule: SavedSearchRule): string {
  const value = quoteSearchToken(rule.value.trim());
  if (!value) return "";
  switch (rule.field) {
    case "path":
      return `path:${value}`;
    case "kind":
      return `kind:${value}`;
    case "extension":
      return `ext:${value.replace(/^\./, "")}`;
    case "size":
      return `size${operatorSymbol(rule.operator)}${value}`;
    case "modified":
      return `modified${operatorSymbol(rule.operator)}${value}`;
    case "hidden":
      return `hidden:${value}`;
    case "tag":
      return `tag:${value}`;
    case "text":
    default:
      return rule.operator === "is_not" ? `-${value}` : value;
  }
}

function operatorSymbol(operator: string): string {
  if (operator === "gt" || operator === "after") return ":>";
  if (operator === "lt" || operator === "before") return ":<";
  if (operator === "is_not") return ":!";
  return ":";
}

function quoteSearchToken(value: string): string {
  if (!value) return "";
  return /\s/.test(value) ? `"${value.replace(/"/g, "\\\"")}"` : value;
}

function quoteTagQueryValue(value: string): string {
  const trimmed = value.replace(/"/g, "").trim();
  return /\s/.test(trimmed) ? `"${trimmed}"` : trimmed;
}

function normalizePanelPath(path: string): string {
  const trimmed = path.trim();
  const normalized = trimmed.replace(/\/+$/, "");
  return normalized || (trimmed === "/" ? "/" : "");
}
