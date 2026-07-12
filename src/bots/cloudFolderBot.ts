import { emitTo } from "@tauri-apps/api/event";
import { LogicalSize } from "@tauri-apps/api/dpi";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { primaryMonitor } from "@tauri-apps/api/window";
import { hasTauriInternals } from "../shared/tauri";

export const cloudFolderBotLabel = "misty-bot-cloud-folder";
export const cloudFolderBotNotifyEvent = "misty-bot-cloud-folder-notify";
export const cloudFolderBotDismissEvent = "misty-bot-cloud-folder-dismiss";
export const cloudFolderBotReturnToAppEvent = "misty-bot-cloud-folder-return-to-app";
export const cloudFolderBotOpenAssistantEvent = "misty-bot-cloud-folder-open-assistant";
export const cloudFolderBotContextRequestEvent = "misty-bot-cloud-folder-context-request";
export const cloudFolderBotContextEvent = "misty-bot-cloud-folder-context";
export const cloudFolderBotWindowSize = { width: 190, height: 184 };
export const cloudFolderBotChatWindowSize = { width: 470, height: 760 };
export const cloudFolderBotBubbleTransitionMs = 260;

export type CloudFolderBotNotificationType = "info" | "success" | "error";

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

let botWindowOpening: Promise<WebviewWindow | null> | null = null;
let botWindowConfiguredInThisSession = false;

export function canUseCloudFolderBotOverlay(): boolean {
  return hasTauriInternals();
}

export async function openCloudFolderBotWindow(assetsDir?: string): Promise<WebviewWindow | null> {
  if (!canUseCloudFolderBotOverlay()) return null;
  if (botWindowOpening) return botWindowOpening;

  botWindowOpening = openCloudFolderBotWindowInternal(assetsDir).finally(() => {
    botWindowOpening = null;
  });
  return botWindowOpening;
}

export async function closeCloudFolderBotWindow(): Promise<void> {
  if (!canUseCloudFolderBotOverlay()) return;
  const bot = await WebviewWindow.getByLabel(cloudFolderBotLabel).catch(() => null);
  await bot?.close().catch(() => undefined);
}

export async function publishCloudFolderBotNotification(
  notification: CloudFolderBotNotification,
): Promise<void> {
  if (!canUseCloudFolderBotOverlay()) return;
  await emitTo(cloudFolderBotLabel, cloudFolderBotNotifyEvent, notification).catch(() => undefined);
}

export async function dismissCloudFolderBotFromOverlay(): Promise<void> {
  if (!canUseCloudFolderBotOverlay()) return;
  await emitTo("main", cloudFolderBotDismissEvent, {}).catch(() => undefined);
}

export async function returnToMistyAppFromBot(): Promise<void> {
  if (!canUseCloudFolderBotOverlay()) return;
  await emitTo("main", cloudFolderBotReturnToAppEvent, {}).catch(() => undefined);
}

export async function openMikaAssistantFromBot(): Promise<void> {
  if (!canUseCloudFolderBotOverlay()) return;
  await emitTo("main", cloudFolderBotOpenAssistantEvent, {}).catch(() => undefined);
}

export async function requestCloudFolderBotContext(): Promise<void> {
  if (!canUseCloudFolderBotOverlay()) return;
  await emitTo("main", cloudFolderBotContextRequestEvent, {}).catch(() => undefined);
}

export async function publishCloudFolderBotContext(context: CloudFolderBotContext): Promise<void> {
  if (!canUseCloudFolderBotOverlay()) return;
  await emitTo(cloudFolderBotLabel, cloudFolderBotContextEvent, context).catch(() => undefined);
}

async function openCloudFolderBotWindowInternal(assetsDir?: string): Promise<WebviewWindow | null> {
  const existing = await WebviewWindow.getByLabel(cloudFolderBotLabel).catch(() => null);
  if (existing && botWindowConfiguredInThisSession) {
    await existing.setMaxSize(new LogicalSize(cloudFolderBotChatWindowSize.width, cloudFolderBotChatWindowSize.height)).catch(() => undefined);
    await existing.show().catch(() => undefined);
    await existing.setAlwaysOnTop(true).catch(() => undefined);
    return existing;
  }
  if (existing) {
    await existing.close().catch(() => undefined);
  }

  const position = await defaultBotWindowPosition();
  const url = new URL("/bot/cloud-folder", globalThis.window.location.href);
  if (assetsDir) url.searchParams.set("assetsDir", assetsDir);
  const window = new WebviewWindow(cloudFolderBotLabel, {
    url: url.toString(),
    title: "Mika Assistant",
    width: cloudFolderBotWindowSize.width,
    height: cloudFolderBotWindowSize.height,
    minWidth: cloudFolderBotWindowSize.width,
    minHeight: cloudFolderBotWindowSize.height,
    maxWidth: cloudFolderBotChatWindowSize.width,
    maxHeight: cloudFolderBotChatWindowSize.height,
    x: position.x,
    y: position.y,
    resizable: false,
    decorations: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    shadow: false,
    focus: false,
    acceptFirstMouse: true,
    visible: true,
  });

  window.once("tauri://created", () => {
    void window.setMaxSize(new LogicalSize(cloudFolderBotChatWindowSize.width, cloudFolderBotChatWindowSize.height)).catch(() => undefined);
    void window.setSize(new LogicalSize(cloudFolderBotWindowSize.width, cloudFolderBotWindowSize.height)).catch(() => undefined);
    void window.setAlwaysOnTop(true).catch(() => undefined);
  });

  botWindowConfiguredInThisSession = true;
  return window;
}

async function defaultBotWindowPosition(): Promise<{ x: number; y: number }> {
  const monitor = await primaryMonitor().catch(() => null);
  if (!monitor) return { x: 96, y: 96 };
  const position = monitor.workArea.position.toLogical(monitor.scaleFactor);
  const size = monitor.workArea.size.toLogical(monitor.scaleFactor);
  return {
    x: Math.max(position.x + 16, position.x + size.width - cloudFolderBotWindowSize.width - 28),
    y: Math.max(position.y + 16, position.y + size.height - cloudFolderBotWindowSize.height - 28),
  };
}
