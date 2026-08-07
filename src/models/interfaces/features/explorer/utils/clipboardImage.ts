import { readImage } from "@tauri-apps/plugin-clipboard-manager";

export interface ClipboardPngImage {
  bytes: Uint8Array;
  width: number;
  height: number;
}
