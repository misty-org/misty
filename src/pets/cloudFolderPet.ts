import { emitTo } from "@tauri-apps/api/event";
import { LogicalSize } from "@tauri-apps/api/dpi";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { primaryMonitor } from "@tauri-apps/api/window";
import { hasTauriInternals } from "../shared/tauri";

export const cloudFolderPetLabel = "misty-pet-cloud-folder";
export const cloudFolderPetNotifyEvent = "misty-pet-cloud-folder-notify";
export const cloudFolderPetDismissEvent = "misty-pet-cloud-folder-dismiss";
export const cloudFolderPetReturnToAppEvent = "misty-pet-cloud-folder-return-to-app";
export const cloudFolderPetCompactWindowSize = { width: 150, height: 122 };
export const cloudFolderPetChatWindowSize = { width: 390, height: 122 };

export type CloudFolderPetNotificationType = "info" | "success" | "error";

export interface CloudFolderPetNotification {
  id: number;
  message: string;
  type: CloudFolderPetNotificationType;
  createdAtMs: number;
}

let petWindowOpening: Promise<WebviewWindow | null> | null = null;

export function canUseCloudFolderPetOverlay(): boolean {
  return hasTauriInternals();
}

export async function openCloudFolderPetWindow(assetsDir?: string): Promise<WebviewWindow | null> {
  if (!canUseCloudFolderPetOverlay()) return null;
  if (petWindowOpening) return petWindowOpening;

  petWindowOpening = openCloudFolderPetWindowInternal(assetsDir).finally(() => {
    petWindowOpening = null;
  });
  return petWindowOpening;
}

export async function closeCloudFolderPetWindow(): Promise<void> {
  if (!canUseCloudFolderPetOverlay()) return;
  const existing = await WebviewWindow.getByLabel(cloudFolderPetLabel).catch(() => null);
  await existing?.close().catch(() => undefined);
}

export async function publishCloudFolderPetNotification(
  notification: CloudFolderPetNotification,
): Promise<void> {
  if (!canUseCloudFolderPetOverlay()) return;
  await emitTo(cloudFolderPetLabel, cloudFolderPetNotifyEvent, notification).catch(() => undefined);
}

export async function dismissCloudFolderPetFromOverlay(): Promise<void> {
  if (!canUseCloudFolderPetOverlay()) return;
  await emitTo("main", cloudFolderPetDismissEvent, {}).catch(() => undefined);
}

export async function returnToMistyAppFromPet(): Promise<void> {
  if (!canUseCloudFolderPetOverlay()) return;
  await emitTo("main", cloudFolderPetReturnToAppEvent, {}).catch(() => undefined);
}

async function openCloudFolderPetWindowInternal(assetsDir?: string): Promise<WebviewWindow | null> {
  const existing = await WebviewWindow.getByLabel(cloudFolderPetLabel).catch(() => null);
  if (existing) {
    await existing.setSize(new LogicalSize(cloudFolderPetCompactWindowSize.width, cloudFolderPetCompactWindowSize.height)).catch(() => undefined);
    await existing.show().catch(() => undefined);
    await existing.setAlwaysOnTop(true).catch(() => undefined);
    return existing;
  }

  const position = await defaultPetWindowPosition();
  const url = new URL("/pet/cloud-folder", globalThis.window.location.href);
  if (assetsDir) url.searchParams.set("assetsDir", assetsDir);
  const window = new WebviewWindow(cloudFolderPetLabel, {
    url: url.toString(),
    title: "Misty Pet",
    width: cloudFolderPetCompactWindowSize.width,
    height: cloudFolderPetCompactWindowSize.height,
    minWidth: cloudFolderPetCompactWindowSize.width,
    minHeight: cloudFolderPetCompactWindowSize.height,
    maxWidth: cloudFolderPetChatWindowSize.width,
    maxHeight: cloudFolderPetChatWindowSize.height,
    x: position.x,
    y: position.y,
    resizable: false,
    decorations: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    shadow: false,
    focus: false,
    visible: true,
  });

  window.once("tauri://created", () => {
    void window.setSize(new LogicalSize(cloudFolderPetCompactWindowSize.width, cloudFolderPetCompactWindowSize.height)).catch(() => undefined);
    void window.setAlwaysOnTop(true).catch(() => undefined);
  });

  return window;
}

async function defaultPetWindowPosition(): Promise<{ x: number; y: number }> {
  const monitor = await primaryMonitor().catch(() => null);
  if (!monitor) return { x: 96, y: 96 };
  const position = monitor.workArea.position.toLogical(monitor.scaleFactor);
  const size = monitor.workArea.size.toLogical(monitor.scaleFactor);
  return {
    x: Math.max(position.x + 16, position.x + size.width - cloudFolderPetCompactWindowSize.width - 28),
    y: Math.max(position.y + 16, position.y + size.height - cloudFolderPetCompactWindowSize.height - 28),
  };
}
