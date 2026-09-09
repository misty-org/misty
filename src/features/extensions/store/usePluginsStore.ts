import { publishPluginCatalogChanged } from "../utils/pluginEvents";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import type { PluginRootKind } from "../model/types";
import {
  PLUGIN_CATALOG_CACHE_TTL_MS,
  resolveArtifactChecksum,
  type PluginsStore,
} from "./pluginCatalog";
import { rebuildCatalogState, refreshPlugins, scanLocalPlugins } from "./pluginCatalogState";
export const usePluginsStore = create<PluginsStore>((set, get) => ({
  loading: false,
  actionPluginId: "",
  error: "",
  notice: "",
  marketplacePlugins: [],
  installedPlugins: [],
  selectedPluginId: "",
  query: "",
  catalogIndex: [],
  catalogEntries: [],
  localPlugins: [],
  lastLoadedAt: 0,
  platform: "",
  loadPlugins: async (platform, force = false) => {
    const state = get();
    const hasFreshCatalog =
      state.platform === platform &&
      state.catalogEntries.length > 0 &&
      Date.now() - state.lastLoadedAt < PLUGIN_CATALOG_CACHE_TTL_MS;

    if ((!force && hasFreshCatalog) || state.loading) {
      return;
    }

    await refreshPlugins(set, get, platform);
  },
  installPlugin: async (plugin) => {
    if (!hasTauriInternals()) {
      set({ error: "Installing apps is only available in the Misty app." });
      return;
    }
    if (!plugin.artifact?.url) {
      set({ error: `No install bundle is configured for ${plugin.name}.` });
      return;
    }
    set({ actionPluginId: plugin.id, error: "", notice: "" });
    try {
      const sha256 = await resolveArtifactChecksum(plugin);
      const result = await invoke<string>("install_plugin_bundle", {
        pluginId: plugin.id,
        root: plugin.root,
        url: plugin.artifact.url,
        platform: plugin.artifact.platform,
        sha256,
        version: plugin.catalog_version ?? plugin.version,
      });
      set({ actionPluginId: "", notice: result });
      await rebuildCatalogState(set, get, {
        localPlugins: await scanLocalPlugins(),
      });
      publishPluginCatalogChanged();
    } catch (error) {
      set({ actionPluginId: "", error: String(error) });
    }
  },
  selectPlugin: (selectedPluginId) => set({ selectedPluginId }),
  setPluginEnabled: async (plugin, enabled) => {
    if (!hasTauriInternals()) {
      set({ error: "Managing installed apps is only available in the Misty app." });
      return;
    }
    set({ actionPluginId: plugin.id, error: "", notice: "" });
    try {
      const result = await invoke<string>("set_plugin_enabled", {
        pluginId: plugin.id,
        root: plugin.root,
        enabled,
      });
      set({ actionPluginId: "", notice: result });
      await rebuildCatalogState(set, get, {
        localPlugins: await scanLocalPlugins(),
      });
      publishPluginCatalogChanged();
    } catch (error) {
      set({ actionPluginId: "", error: String(error) });
    }
  },
  setQuery: (query) => {
    void rebuildCatalogState(set, get, { query, loading: false });
  },
  uninstallPlugin: async (plugin) => {
    if (!hasTauriInternals()) {
      set({ error: "Uninstalling apps is only available in the Misty app." });
      return;
    }
    set({ actionPluginId: plugin.id, error: "", notice: "" });
    try {
      const result = await invoke<string>("uninstall_plugin", {
        pluginId: plugin.id,
        root: plugin.root,
      });
      set({ actionPluginId: "", notice: result });
      await rebuildCatalogState(set, get, {
        localPlugins: await scanLocalPlugins(),
      });
      publishPluginCatalogChanged();
    } catch (error) {
      set({ actionPluginId: "", error: String(error) });
    }
  },
}));

export function currentPluginPlatform(os: string, arch: string) {
  return `${os}-${arch}`;
}

export function pluginRootLabel(root: PluginRootKind) {
  return root === "private" ? "private" : "public";
}
