import { useEffect, useState } from "react";
import { openExternalLink } from "../../../../../shared/openExternalLink";
import { PluginBrowser } from "./PluginBrowser";
import { loadPluginCatalog, pluginCatalogBaseUrl } from "./catalog";
import { SAMPLE_PLUGINS } from "./data";

const WEBSITE_FALLBACK_PLUGINS = SAMPLE_PLUGINS.map((plugin) => ({
  ...plugin,
  installed: false,
  enabled: false,
}));

export default function Plugins() {
  const [plugins, setPlugins] = useState(WEBSITE_FALLBACK_PLUGINS);
  const [query, setQuery] = useState("");
  const [selectedPluginId, setSelectedPluginId] = useState(
    WEBSITE_FALLBACK_PLUGINS[0]?.id ?? "",
  );
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function loadCatalog() {
      try {
        const catalogPlugins = await loadPluginCatalog();
        if (cancelled) {
          return;
        }
        setPlugins(catalogPlugins);
        setSelectedPluginId(catalogPlugins[0]?.id ?? "");
        setNotice(`Loaded plugin catalog from ${pluginCatalogBaseUrl}.`);
      } catch (error) {
        if (cancelled) {
          return;
        }
        setPlugins(WEBSITE_FALLBACK_PLUGINS);
        setSelectedPluginId(WEBSITE_FALLBACK_PLUGINS[0]?.id ?? "");
        setNotice(
          error instanceof Error
            ? `Using sample plugins. ${error.message}`
            : "Using sample plugins. Could not load plugin catalog.",
        );
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadCatalog();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <PluginBrowser
      installedPlugins={[]}
      marketplacePlugins={plugins}
      notice={loading ? "Loading plugin catalog..." : notice}
      onOpenLink={(url) => void openExternalLink(url)}
      onPrimaryAction={() => {
        window.location.assign("/download");
      }}
      onQueryChange={setQuery}
      onSelect={setSelectedPluginId}
      primaryActionLabel="Open Misty Hub"
      query={query}
      selectedPluginId={selectedPluginId}
      title="Plugins"
    />
  );
}
