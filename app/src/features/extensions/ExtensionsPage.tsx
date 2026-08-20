import { useSetupStore } from "@/features/installer";
import {
  useAiSurfaceAdapter,
  type AiArtifact,
  type AiSurfaceAdapter,
} from "@/features/ai-surface/AiPaneHost";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import { PluginBrowser } from "./components/PluginBrowser";
import type { PluginBrowserEntry } from "./components/types";
import type { PluginEntry } from "./model/types";
import { currentPluginPlatform, usePluginsStore } from "./store/usePluginsStore";

function toBrowserEntry(plugin: PluginEntry): PluginBrowserEntry {
  return {
    id: plugin.id,
    name: plugin.name,
    version: plugin.version,
    author: plugin.author,
    overview: plugin.overview,
    installed: plugin.installed,
    enabled: plugin.enabled,
    verified: plugin.verified,
    logoSrc: plugin.logo_path,
    capabilities: plugin.capabilities,
    whereItAppears: plugin.where_it_appears,
    permissions: plugin.permissions,
    gettingStarted: plugin.getting_started,
    changelog: plugin.changelog,
    includedTools: plugin.included_tools,
    links: plugin.links,
    placement: {
      views: plugin.launcher.views,
      openMode: plugin.launcher.open_mode,
      requiresSelection: plugin.launcher.requires_selected_file,
    },
  };
}

export default function PluginsPage(props: { embedded?: boolean }) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [embeddedPluginId, setEmbeddedPluginId] = useState("");
  const routePluginId = props.embedded
    ? embeddedPluginId
    : (searchParams.get("plugin")?.trim() ?? "");
  const pluginPlatform = useSetupStore((state) =>
    state.status ? currentPluginPlatform(state.status.os, state.status.arch) : "",
  );
  const {
    actionPluginId,
    error,
    installedPlugins,
    loading,
    loadPlugins,
    marketplacePlugins,
    notice,
    query,
    selectPlugin,
    selectedPluginId,
    setPluginEnabled,
    setQuery,
    uninstallPlugin,
    installPlugin,
  } = usePluginsStore(
    useShallow((state) => ({
      actionPluginId: state.actionPluginId,
      error: state.error,
      installedPlugins: state.installedPlugins,
      loading: state.loading,
      loadPlugins: state.loadPlugins,
      marketplacePlugins: state.marketplacePlugins,
      notice: state.notice,
      query: state.query,
      selectPlugin: state.selectPlugin,
      selectedPluginId: state.selectedPluginId,
      setPluginEnabled: state.setPluginEnabled,
      setQuery: state.setQuery,
      uninstallPlugin: state.uninstallPlugin,
      installPlugin: state.installPlugin,
    })),
  );

  useEffect(() => {
    if (!pluginPlatform) {
      return;
    }

    void loadPlugins(pluginPlatform);
  }, [loadPlugins, pluginPlatform]);

  const browserMarketplacePlugins = useMemo(
    () => marketplacePlugins.map(toBrowserEntry),
    [marketplacePlugins],
  );
  const browserInstalledPlugins = useMemo(
    () => installedPlugins.map(toBrowserEntry),
    [installedPlugins],
  );
  const routePluginAvailable = useMemo(
    () =>
      Boolean(routePluginId) &&
      [...marketplacePlugins, ...installedPlugins].some((plugin) => plugin.id === routePluginId),
    [installedPlugins, marketplacePlugins, routePluginId],
  );

  useEffect(() => {
    if (routePluginAvailable && routePluginId !== selectedPluginId) {
      selectPlugin(routePluginId);
    }
  }, [routePluginAvailable, routePluginId, selectPlugin, selectedPluginId]);

  const aiAdapter = useMemo<AiSurfaceAdapter>(() => {
    const all = [...marketplacePlugins, ...installedPlugins];
    const selected = all.find((plugin) => plugin.id === selectedPluginId);
    const relevant = selected
      ? [selected]
      : all
          .filter((plugin) => {
            const needle = query.trim().toLowerCase();
            return (
              !needle ||
              `${plugin.name} ${plugin.overview} ${plugin.author}`.toLowerCase().includes(needle)
            );
          })
          .slice(0, 24);
    const content = JSON.stringify(
      relevant.map((plugin) => ({
        extension_id: plugin.id,
        name: plugin.name,
        version: plugin.version,
        author: plugin.author,
        overview: plugin.overview,
        installed: plugin.installed,
        enabled: plugin.enabled,
        verified: plugin.verified,
        capabilities: plugin.capabilities,
        permissions: plugin.permissions,
        where_it_appears: plugin.where_it_appears,
        included_tools: plugin.included_tools,
      })),
    ).slice(0, 32 << 10);
    const applicablePlugin = (artifact: AiArtifact) => {
      const operations = artifact.operations as {
        extension_id?: string;
        action?: string;
        permissions?: unknown;
      };
      const plugin = all.find((entry) => entry.id === operations.extension_id);
      if (!plugin || plugin.installed || operations.action !== "install") return null;
      if (!Array.isArray(operations.permissions)) return null;
      const proposed = [...operations.permissions]
        .filter((permission): permission is string => typeof permission === "string")
        .sort();
      const manifest = [...plugin.permissions].sort();
      return proposed.length === manifest.length &&
        proposed.every((value, index) => value === manifest[index])
        ? plugin
        : null;
    };
    return {
      surfaceId: "extensions",
      label: selected?.name ?? "Extensions",
      getContext: () => [
        {
          kind: "extensions.catalog",
          id: pluginPlatform || "unavailable-platform",
          title: selected?.name ?? "Visible extension catalog",
          privacy: "device",
          opaqueScopeId: pluginPlatform || "unavailable-platform",
          metadata: {
            selected_extension: selected?.id ?? "",
            visible_count: relevant.length,
            query: query.slice(0, 200),
          },
        },
      ],
      getSelection: () =>
        relevant.length
          ? {
              kind: "objects",
              content,
              object: {
                kind: selected ? "extension" : "extensions.catalog",
                id: selected?.id ?? (pluginPlatform || "unavailable-platform"),
              },
              anchors: { count: relevant.length, selected: Boolean(selected) },
              contentHash: extensionAiHash(content),
            }
          : null,
      getSuggestedActions: () => [
        {
          id: "extension-explain",
          label: "Explain",
          prompt:
            "Explain what the selected or visible extensions do, where they appear, and what their declared permissions mean.",
        },
        {
          id: "extension-compare",
          label: "Compare",
          prompt:
            "Compare the visible extensions for the current need. Use only the supplied catalog metadata and call out missing information.",
        },
        {
          id: "extension-configure",
          label: "Configuration help",
          prompt:
            "Explain how to configure and safely use the selected extension based on its declared capabilities. Do not change settings or run it.",
        },
        {
          id: "extension-install",
          label: "Review install",
          prompt:
            "Propose installing the selected extension. Repeat its exact extension identifier, every declared permission, " +
            "and the expected effect. Do not install it yet.",
          requestedArtifactKind: "extension_action",
        },
      ],
      canApply: (artifact) =>
        artifact.kind === "extension_action" && Boolean(applicablePlugin(artifact)),
      applyArtifact: async (artifact) => {
        const plugin = applicablePlugin(artifact);
        if (!plugin) {
          throw new Error(
            "The extension catalog or declared permissions changed. Ask Misty to regenerate this proposal.",
          );
        }
        await installPlugin(plugin);
      },
    };
  }, [
    installPlugin,
    installedPlugins,
    marketplacePlugins,
    pluginPlatform,
    query,
    selectedPluginId,
  ]);
  useAiSurfaceAdapter(aiAdapter);

  // The detail dialog is driven by the selection, so the deep-link param has to
  // travel with it. Otherwise closing the dialog would let the effect above
  // immediately reopen it from the still-present `?plugin=` value.
  const selectAndSyncRoute = useCallback(
    (pluginId: string) => {
      selectPlugin(pluginId);
      if (props.embedded) {
        setEmbeddedPluginId(pluginId);
        return;
      }
      setSearchParams(
        (previous) => {
          const next = new URLSearchParams(previous);
          if (pluginId) next.set("plugin", pluginId);
          else next.delete("plugin");
          return next;
        },
        { replace: true },
      );
    },
    [props.embedded, selectPlugin, setSearchParams],
  );

  return (
    <PluginBrowser
      error={error}
      installedPlugins={browserInstalledPlugins}
      loading={loading || actionPluginId.length > 0}
      marketplacePlugins={browserMarketplacePlugins}
      notice={notice}
      onInstall={(plugin) => {
        const match =
          marketplacePlugins.find((entry) => entry.id === plugin.id) ??
          installedPlugins.find((entry) => entry.id === plugin.id);
        if (match) {
          void installPlugin(match);
        }
      }}
      onPrimaryAction={(plugin) => navigate(`/files?extension=${encodeURIComponent(plugin.id)}`)}
      onQueryChange={(value) => {
        setQuery(value);
      }}
      onRefresh={() => {
        if (pluginPlatform) {
          void loadPlugins(pluginPlatform, true);
        }
      }}
      onSelect={selectAndSyncRoute}
      onToggle={(plugin, enabled) => {
        const match =
          marketplacePlugins.find((entry) => entry.id === plugin.id) ??
          installedPlugins.find((entry) => entry.id === plugin.id);
        if (match) {
          void setPluginEnabled(match, enabled);
        }
      }}
      onUninstall={(plugin) => {
        const match =
          installedPlugins.find((entry) => entry.id === plugin.id) ??
          marketplacePlugins.find((entry) => entry.id === plugin.id);
        if (match) {
          void uninstallPlugin(match);
        }
      }}
      query={query}
      selectedPluginId={selectedPluginId}
    />
  );
}

function extensionAiHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a-${(hash >>> 0).toString(16)}`;
}
