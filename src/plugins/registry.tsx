import { Beaker, Download, HardDrive, Palette, Wand2 } from "lucide-react";
import { PreviewPanelPlugin } from "./previewPanel/PreviewPanelPlugin";
import { QuickConvertPlugin } from "./quickConvert/QuickConvertPlugin";
import { ThemesPlugin } from "./themes/ThemesPlugin";
import { VaultPlugin } from "./vault/VaultPlugin";
import { YtdlpPlugin } from "./ytdlp/YtdlpPlugin";
import type { PluginDefinition } from "./types";

export const plugins: PluginDefinition[] = [
  {
    id: "quick_convert",
    name: "Quick Convert",
    description: "Convert selected images, audio, and video with a web-native panel.",
    accent: "#4ade80",
    icon: Wand2,
    panels: [
      {
        id: "quick-convert.panel",
        title: "Quick Convert",
        defaultWidth: 520,
        defaultHeight: 420,
        component: QuickConvertPlugin,
      },
    ],
  },
  {
    id: "themes",
    name: "Themes",
    description: "Apply Misty theme presets and edit color tokens.",
    accent: "#60a5fa",
    icon: Palette,
    panels: [
      {
        id: "themes.panel",
        title: "Themes",
        defaultWidth: 560,
        defaultHeight: 620,
        component: ThemesPlugin,
      },
    ],
  },
  {
    id: "vault",
    name: "Vault",
    description: "Plan and manage restic-powered backup surfaces.",
    accent: "#f59e0b",
    icon: HardDrive,
    panels: [
      {
        id: "vault.panel",
        title: "Vault",
        defaultWidth: 720,
        defaultHeight: 520,
        component: VaultPlugin,
      },
    ],
  },
  {
    id: "ytdlp",
    name: "yt-dlp",
    description: "Prepare YouTube downloads and media extraction jobs.",
    accent: "#f43f5e",
    icon: Download,
    panels: [
      {
        id: "ytdlp.panel",
        title: "yt-dlp",
        defaultWidth: 640,
        defaultHeight: 540,
        component: YtdlpPlugin,
      },
    ],
  },
  {
    id: "preview-panel",
    name: "Preview Panel",
    description: "Sandbox plugin panel compositions with React.",
    accent: "#a78bfa",
    icon: Beaker,
    panels: [
      {
        id: "preview-panel.panel",
        title: "Preview Panel",
        defaultWidth: 720,
        defaultHeight: 520,
        component: PreviewPanelPlugin,
      },
    ],
  },
];

export function pluginById(pluginId: string | null) {
  return plugins.find((plugin) => plugin.id === pluginId) ?? plugins[0];
}
