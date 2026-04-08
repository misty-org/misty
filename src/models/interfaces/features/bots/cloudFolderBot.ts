import { emitTo } from "@tauri-apps/api/event";
import { LogicalSize, PhysicalPosition } from "@tauri-apps/api/dpi";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { currentMonitor, primaryMonitor } from "@tauri-apps/api/window";
import { hasTauriInternals } from "@/platform/tauri";

import type { CloudFolderBotNotificationType } from "@/models/types/features/bots/cloudFolderBot";

export interface CloudFolderBotNotification {
  id: number;
  message: string;
  type: CloudFolderBotNotificationType;
  createdAtMs: number;
}

export interface CloudFolderBotContext {
  workingDirectory: string;
  selectedPaths: string[];
}

export interface CloudFolderBotChatVisibility {
  visible: boolean;
}
