import { invoke } from "./invoke";

/**
 * The shared clipboard across this account's devices (docs/design/clipboard/BRIEF.md). Clips
 * travel through sync as a small ring; "unavailable" means sync can't be reached.
 */
export type CloudClipboardStatus = "off" | "locked" | "connecting" | "ready" | "unavailable";

export interface CloudClip {
  clipId: string;
  deviceId: string;
  deviceName: string;
  fromThisDevice: boolean;
  kind: "empty" | "text" | "html" | "image";
  preview: string;
  /** The names of copied files, when the clip came from a file copy (shared as text). */
  fileNames: string[];
  size: number;
  createdAt: number;
}

export interface CloudClipboardView {
  status: CloudClipboardStatus;
  clips: CloudClip[];
  /** Plain words about the last copy that could not be shared, if any. */
  notice: string | null;
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
