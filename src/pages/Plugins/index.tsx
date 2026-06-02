import { useState } from "react";
import { PluginBrowser } from "./PluginBrowser";
import { SAMPLE_PLUGINS } from "./data";

export default function Plugins() {
  const [plugins, setPlugins] = useState(SAMPLE_PLUGINS);
  const [query, setQuery] = useState("");
  const [selectedPluginId, setSelectedPluginId] = useState(SAMPLE_PLUGINS[0]?.id ?? "");
  const [notice, setNotice] = useState("");

  return (
    <PluginBrowser
      installedPlugins={plugins.filter((plugin) => plugin.installed)}
      marketplacePlugins={plugins}
      notice={notice}
      onInstall={(plugin) => {
        setPlugins((current) =>
          current.map((entry) =>
            entry.id === plugin.id ? { ...entry, installed: true, enabled: true } : entry,
          ),
        );
        setNotice(`Installed ${plugin.name}.`);
      }}
      onOpenLink={(url) => window.open(url, "_blank", "noopener,noreferrer")}
      onQueryChange={setQuery}
      onSelect={setSelectedPluginId}
      onToggle={(plugin, enabled) => {
        setPlugins((current) =>
          current.map((entry) => (entry.id === plugin.id ? { ...entry, enabled } : entry)),
        );
        setNotice(`${enabled ? "Enabled" : "Disabled"} ${plugin.name}.`);
      }}
      onUninstall={(plugin) => {
        setPlugins((current) =>
          current.map((entry) =>
            entry.id === plugin.id ? { ...entry, installed: false, enabled: false } : entry,
          ),
        );
        setNotice(`Removed ${plugin.name}.`);
      }}
      query={query}
      selectedPluginId={selectedPluginId}
      title="Plugins"
    />
  );
}
