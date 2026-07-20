import { emitTo } from "@tauri-apps/api/event";
import { LogicalSize, PhysicalPosition } from "@tauri-apps/api/dpi";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { currentMonitor, primaryMonitor } from "@tauri-apps/api/window";
import { hasTauriInternals } from "@/shared/tauri";

export const cloudFolderBotLabel = "misty-bot-cloud-folder";
export const cloudFolderBotChatLabel = "misty-bot-cloud-folder-chat";
export const cloudFolderBotNotifyEvent = "misty-bot-cloud-folder-notify";
export const cloudFolderBotDismissEvent = "misty-bot-cloud-folder-dismiss";
export const cloudFolderBotReturnToAppEvent = "misty-bot-cloud-folder-return-to-app";
export const cloudFolderBotOpenAssistantEvent = "misty-bot-cloud-folder-open-assistant";
export const cloudFolderBotContextRequestEvent = "misty-bot-cloud-folder-context-request";
export const cloudFolderBotContextEvent = "misty-bot-cloud-folder-context";
export const cloudFolderBotChatVisibilityEvent = "misty-bot-cloud-folder-chat-visibility";
export const cloudFolderBotWindowSize = { width: 148, height: 101 };
export const cloudFolderBotChatWindowSize = { width: 470, height: 620 };

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

export interface CloudFolderBotChatVisibility {
  visible: boolean;
}

let botWindowOpening: Promise<WebviewWindow | null> | null = null;
let chatWindowOpening: Promise<WebviewWindow | null> | null = null;
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
  const [bot, chat] = await Promise.all([
    WebviewWindow.getByLabel(cloudFolderBotLabel).catch(() => null),
    WebviewWindow.getByLabel(cloudFolderBotChatLabel).catch(() => null),
  ]);
  await Promise.all([bot?.close().catch(() => undefined), chat?.close().catch(() => undefined)]);
}

export async function setCloudFolderBotWindowVisible(visible: boolean): Promise<void> {
  if (!canUseCloudFolderBotOverlay()) return;
  const bot = await WebviewWindow.getByLabel(cloudFolderBotLabel).catch(() => null);
  if (!bot) return;
  if (visible) {
    await bot.show().catch(() => undefined);
    await bot.setAlwaysOnTop(true).catch(() => undefined);
    await bot.setFocus().catch(() => undefined);
  } else {
    await bot.hide().catch(() => undefined);
  }
}

export async function openCloudFolderBotChatWindow(): Promise<WebviewWindow | null> {
  if (!canUseCloudFolderBotOverlay()) return null;
  if (chatWindowOpening) return chatWindowOpening;
  chatWindowOpening = openCloudFolderBotChatWindowInternal().finally(() => {
    chatWindowOpening = null;
  });
  return chatWindowOpening;
}

async function openCloudFolderBotChatWindowInternal(): Promise<WebviewWindow | null> {
  const existing = await WebviewWindow.getByLabel(cloudFolderBotChatLabel).catch(() => null);
  if (existing) {
    await positionCloudFolderBotChatWindow();
    await existing.show().catch(() => undefined);
    await existing.setFocus().catch(() => undefined);
    return existing;
  }

  const position = await cloudFolderBotChatPosition();
  const url = new URL("/bot/cloud-folder-chat", globalThis.window.location.href);
  const window = new WebviewWindow(cloudFolderBotChatLabel, {
    url: url.toString(),
    title: "Mika Chat",
    width: cloudFolderBotChatWindowSize.width,
    height: cloudFolderBotChatWindowSize.height,
    x: position.x,
    y: position.y,
    resizable: false,
    maximizable: false,
    minimizable: false,
    decorations: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    shadow: false,
    focus: true,
    acceptFirstMouse: true,
    visible: true,
  });
  window.once("tauri://created", () => {
    void window.setResizable(false).catch(() => undefined);
    void window.setMaximizable(false).catch(() => undefined);
    void window.setAlwaysOnTop(true).catch(() => undefined);
  });
  return window;
}

export async function positionCloudFolderBotChatWindow(): Promise<void> {
  if (!canUseCloudFolderBotOverlay()) return;
  const [chat, position] = await Promise.all([
    WebviewWindow.getByLabel(cloudFolderBotChatLabel).catch(() => null),
    cloudFolderBotChatPositionPhysical(),
  ]);
  if (!chat || !position) return;
  await chat.setPosition(new PhysicalPosition(position.x, position.y)).catch(() => undefined);
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
  await Promise.all([
    emitTo(cloudFolderBotLabel, cloudFolderBotContextEvent, context).catch(() => undefined),
    emitTo(cloudFolderBotChatLabel, cloudFolderBotContextEvent, context).catch(() => undefined),
  ]);
}

export async function publishCloudFolderBotChatVisibility(visible: boolean): Promise<void> {
  if (!canUseCloudFolderBotOverlay()) return;
  await Promise.all([
    emitTo(cloudFolderBotLabel, cloudFolderBotChatVisibilityEvent, { visible }).catch(
      () => undefined,
    ),
    emitTo("main", cloudFolderBotChatVisibilityEvent, { visible }).catch(() => undefined),
  ]);
}

async function openCloudFolderBotWindowInternal(assetsDir?: string): Promise<WebviewWindow | null> {
  const existing = await WebviewWindow.getByLabel(cloudFolderBotLabel).catch(() => null);
  if (existing && botWindowConfiguredInThisSession) {
    await existing.setResizable(false).catch(() => undefined);
    await existing.setMaximizable(false).catch(() => undefined);
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
    x: position.x,
    y: position.y,
    resizable: false,
    maximizable: false,
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
    void window
      .setSize(new LogicalSize(cloudFolderBotWindowSize.width, cloudFolderBotWindowSize.height))
      .catch(() => undefined);
    void window.setResizable(false).catch(() => undefined);
    void window.setMaximizable(false).catch(() => undefined);
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

async function cloudFolderBotChatPosition(): Promise<{ x: number; y: number }> {
  const physical = await cloudFolderBotChatPositionPhysical();
  const monitor = await currentMonitor()
    .then((current) => current ?? primaryMonitor())
    .catch(() => null);
  const scaleFactor = monitor?.scaleFactor ?? 1;
  if (!physical) return { x: 96, y: 96 };
  return { x: physical.x / scaleFactor, y: physical.y / scaleFactor };
}

async function cloudFolderBotChatPositionPhysical(): Promise<{ x: number; y: number } | null> {
  const bot = await WebviewWindow.getByLabel(cloudFolderBotLabel).catch(() => null);
  if (!bot) return null;
  const [botPosition, botSize, monitor] = await Promise.all([
    bot.outerPosition(),
    bot.outerSize(),
    currentMonitor().then((current) => current ?? primaryMonitor()),
  ]);
  if (!monitor) return null;

  const scaleFactor = monitor.scaleFactor;
  const width = Math.round(cloudFolderBotChatWindowSize.width * scaleFactor);
  const height = Math.round(cloudFolderBotChatWindowSize.height * scaleFactor);
  const gap = Math.round(10 * scaleFactor);
  const minX = monitor.workArea.position.x;
  const minY = monitor.workArea.position.y;
  const maxX = minX + monitor.workArea.size.width - width;
  const maxY = minY + monitor.workArea.size.height - height;
  const x = Math.min(Math.max(botPosition.x + botSize.width - width, minX), Math.max(minX, maxX));
  const aboveY = botPosition.y - height - gap;
  const belowY = botPosition.y + botSize.height + gap;
  const preferredY = aboveY >= minY ? aboveY : belowY;
  const y = Math.min(Math.max(preferredY, minY), Math.max(minY, maxY));
  return { x: Math.round(x), y: Math.round(y) };
}
