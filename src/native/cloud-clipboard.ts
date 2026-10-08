import { invoke } from "./invoke";

/** The shared clipboard across this account's devices (docs/design/clipboard/BRIEF.md). */
export type CloudClipboardStatus = "off" | "locked" | "connecting" | "ready" | "unavailable";

export interface CloudClip {
  clipId: string;
  deviceId: string;
  deviceName: string;
  fromThisDevice: boolean;
  kind: "empty" | "text" | "html" | "image" | "file_refs";
  preview: string;
  fileNames: string[];
  size: number;
  createdAt: number;
}

export interface CloudClipboardView {
  status: CloudClipboardStatus;
  clips: CloudClip[];
}

/** Emitted natively whenever the clip list or its status changes. */
export const cloudClipboardChangedEvent = "misty://clipboard-history";

export function cloudClipboardView(): Promise<CloudClipboardView> {
  return invoke("clipboard_cloud_view");
}

export function cloudClipboardCopy(clipId: string): Promise<void> {
  return invoke("clipboard_cloud_copy", { clipId });
}

export function cloudClipboardSave(clipId: string): Promise<string[]> {
  return invoke("clipboard_cloud_save", { clipId });
}
