import { Archive, Download, FolderSearch, Images, Palette, Wand2 } from "lucide-react";
import { BackupsPlugin } from "./backups/BackupsPlugin";
import { ImageOptimizerPlugin } from "./imageOptimizer/ImageOptimizerPlugin";
import { QuickConvertPlugin } from "./quickConvert/QuickConvertPlugin";
import { ThemesPlugin } from "./themes/ThemesPlugin";
import { StorageReportPlugin } from "./storageReport/StorageReportPlugin";
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
    id: "storage_report",
    name: "Storage Report",
    description: "Inspect a folder's size, largest files, and file-type distribution.",
    accent: "#38bdf8",
    icon: FolderSearch,
    panels: [{ id: "storage-report.panel", title: "Storage Report", defaultWidth: 680, defaultHeight: 620, component: StorageReportPlugin }],
  },
  {
    id: "image_optimizer",
    name: "Image Optimizer",
    description: "Create smaller JPEG, PNG, and WebP copies without changing originals.",
    accent: "#34d399",
    icon: Images,
    panels: [{ id: "image-optimizer.panel", title: "Image Optimizer", defaultWidth: 620, defaultHeight: 600, component: ImageOptimizerPlugin }],
  },
  {
    id: "backups",
    name: "Backups",
    description: "Create encrypted Restic snapshots on local volumes or cloud remotes.",
    accent: "#f59e0b",
    icon: Archive,
    panels: [
      {
        id: "backups.panel",
        title: "Backups",
        defaultWidth: 720,
        defaultHeight: 520,
        component: BackupsPlugin,
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
];

export function pluginById(pluginId: string | null) {
  return plugins.find((plugin) => plugin.id === pluginId) ?? plugins[0];
}
