import { useState } from "react";
import { PluginBrowser } from "../features/plugins/PluginBrowser";
import type { PluginBrowserEntry } from "../features/plugins/types";

const SAMPLE_PLUGINS: PluginBrowserEntry[] = [
  {
    id: "preview_manager",
    name: "Preview Manager",
    version: "1.0.0",
    author: "Misty",
    overview:
      "Preview Manager lets users inspect screenshots, illustrations, and other image assets directly inside Misty while keeping the current workspace context intact.",
    installed: true,
    enabled: true,
    verified: true,
    capabilities: [
      "Inline image preview for common asset formats",
      "Fast inspection flow for screenshots and design files",
      "Stays inside the current browser context while previewing",
    ],
    whereItAppears: ["Files panel", "Preview workflow", "Selected file actions"],
    permissions: [
      "Read access to workspace files",
      "Read access to mounted files",
      "No network access required",
    ],
    gettingStarted: [
      "Install or enable Preview Manager.",
      "Select an image file in Files.",
      "Open the preview action to inspect the selected asset.",
    ],
    changelog: [
      "v1.0.0 - Added image preview support for local and mounted files.",
      "v0.9.0 - Initial internal prototype.",
    ],
    links: [
      { label: "Documentation", url: "https://mistysys.com/docs" },
      { label: "Source", url: "https://github.com/misty-org/misty" },
    ],
    launcher: {
      views: ["Files"],
      show_in_launcher: true,
      requires_selected_file: false,
      open_mode: "tab",
    },
    rootLabel: "public",
  },
  {
    id: "quick_convert",
    name: "Quick Convert",
    version: "0.1.0",
    author: "Misty",
    overview:
      "Quick Convert helps users convert images, audio, and video into common formats without leaving Misty.",
    installed: true,
    enabled: true,
    verified: true,
    capabilities: [
      "Convert files between common image, audio, and video formats",
      "Batch process selected assets in one pass",
      "Choose output format, quality, and destination before exporting",
    ],
    whereItAppears: ["Files panel", "Selected file actions", "Batch actions"],
    permissions: [
      "Read access to selected files",
      "Write access to export destinations",
      "Optional shell access for converter backends",
    ],
    gettingStarted: [
      "Select one or more media files in Files.",
      "Open Quick Convert from the available file actions.",
      "Choose an output format and destination, then start the conversion.",
    ],
    changelog: ["v0.1.0 - Initial plugin template for media conversion workflows."],
    links: [{ label: "Documentation", url: "https://mistysys.com/docs" }],
    launcher: {
      views: ["Files"],
      show_in_launcher: true,
      requires_selected_file: false,
      open_mode: "split",
    },
    rootLabel: "private",
  },
  {
    id: "themes",
    name: "Themes",
    version: "0.1.0",
    author: "Misty",
    overview: "Themes is Misty's built-in theme builder for presets and token editing.",
    installed: false,
    enabled: false,
    verified: true,
    capabilities: ["Apply curated presets instantly", "Edit named theme tokens", "Persist theme changes across restarts"],
    whereItAppears: ["Settings view", "Plugins view", "Global plugin launcher"],
    permissions: ["Write access to Misty appearance settings", "No network access required"],
    gettingStarted: [
      "Install Themes.",
      "Open Themes from Settings or the plugin launcher.",
      "Apply a preset or adjust token colors.",
    ],
    changelog: ["v0.1.0 - Added the first theme builder with curated presets."],
    links: [{ label: "Documentation", url: "https://mistysys.com/docs" }],
    launcher: {
      views: ["Settings", "Plugins"],
      show_in_launcher: true,
      requires_selected_file: false,
      open_mode: "tab",
    },
    rootLabel: "private",
  },
];

export default function Plugins() {
  const [plugins, setPlugins] = useState(SAMPLE_PLUGINS);
  const [query, setQuery] = useState("");
  const [selectedPluginId, setSelectedPluginId] = useState(SAMPLE_PLUGINS[0]?.id ?? "");
  const [notice, setNotice] = useState("");

  return (
    <PluginBrowser
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
      onRefresh={() => setNotice("Refreshed plugin catalog.")}
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
      plugins={plugins}
      query={query}
      selectedPluginId={selectedPluginId}
      subtitle="Browse what Misty can do, then install the pieces you want."
      title="Plugins"
    />
  );
}
