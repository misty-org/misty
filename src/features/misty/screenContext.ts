import { invoke } from "@tauri-apps/api/core";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { captureAttachmentFromDataUrl } from "@/features/ai-surface/captureAttachment";

export interface MistyScreenStatus {
  supported: boolean;
  allowed: boolean;
  external?: boolean;
  shortcutRegistered?: boolean;
}
export async function screenStatus(request = false): Promise<MistyScreenStatus> {
  if (!hasTauriInternals()) return { supported: false, allowed: false };
  return invoke("misty_screen_status", { request });
}
export async function captureMistyScreen() {
  const result = await invoke<{
    error?: string;
    dataUrl: string;
    width: number;
    height: number;
    appName: string;
    title: string;
  }>("misty_screen_capture");
  if (result.error) throw new Error(result.error);
  return {
    capture: await captureAttachmentFromDataUrl(result.dataUrl, result.width, result.height),
    label: `${result.appName} · ${result.title}`,
  };
}
