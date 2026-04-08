import { emitTo } from "@tauri-apps/api/event";
import { LogicalSize, PhysicalPosition } from "@tauri-apps/api/dpi";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { currentMonitor, primaryMonitor } from "@tauri-apps/api/window";
import { hasTauriInternals } from "@/platform/tauri";

import type {
  CloudFolderBotNotification,
  CloudFolderBotContext,
  CloudFolderBotChatVisibility,
} from "@/models/interfaces/features/bots/cloudFolderBot";

export type CloudFolderBotNotificationType = "info" | "success" | "error";
