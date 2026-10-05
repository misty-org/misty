import { clipboardSnapshot } from "@/native/runtime";
import type { PasteItem } from "@/native/ipc";
import { readText } from "@tauri-apps/plugin-clipboard-manager";
import * as H from "./index";

/**
 * Files copied on a paired device reach this device's clipboard as their names,
 * so other apps can still paste something. While those names are still what the
 * clipboard holds, a paste in Files copies the files themselves from the device.
 */
export async function sharedDevicePasteItems(): Promise<PasteItem[]> {
  const snapshot = await clipboardSnapshot().catch(() => null);
  const shared = snapshot?.shared;
  if (!shared || shared.kind !== "file_refs") return [];
  const items = shared.file_refs
    .map(H.pasteItemFromClipboardRef)
    .filter((item): item is PasteItem => item?.path.startsWith("misty://device/") === true);
  if (items.length === 0) return [];
  const text = await readText().catch(() => "");
  return text === shared.text ? items : [];
}
