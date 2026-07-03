import type { PluginBrowserEntry } from "./types";

export const SAMPLE_PLUGINS: PluginBrowserEntry[] = [
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
      "Choose an output format, quality, and destination before exporting",
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
    changelog: ["v0.1.0 - Initial extension template for media conversion workflows."],
    links: [],
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
    capabilities: [
      "Apply curated presets instantly",
      "Edit named theme tokens",
      "Persist theme changes across restarts",
    ],
    whereItAppears: ["Settings view", "Extensions view", "Global extension launcher"],
    permissions: ["Write access to Misty appearance settings", "No network access required"],
    gettingStarted: [
      "Install Themes.",
      "Open Themes from Settings or the extension launcher.",
      "Apply a preset or adjust token colors.",
    ],
    changelog: ["v0.1.0 - Added the first theme builder with curated presets."],
    links: [],
    launcher: {
      views: ["Settings", "Extensions"],
      show_in_launcher: true,
      requires_selected_file: false,
      open_mode: "tab",
    },
    rootLabel: "private",
  },
];
